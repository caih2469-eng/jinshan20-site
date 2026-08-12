/* APPROVED_720PX_BACKFILL_V1 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const TARGETS = Object.freeze({
  test: Object.freeze({
    database: 'jinshan20-test',
    bucket: 'jinshan20-test',
    config: 'cloudflare/pages-test/wrangler.jsonc'
  }),
  production: Object.freeze({
    database: 'jinshan20',
    bucket: 'jinshan20',
    config: 'cloudflare/pages-production/wrangler.jsonc'
  })
});

const wranglerCli = path.resolve('node_modules/wrangler/bin/wrangler.js');
const stripAnsi = (value) => String(value || '').replace(
  // eslint-disable-next-line no-control-regex
  /\u001b\[[0-9;]*m/g,
  ''
);
const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;

export const parseArgs = (argv) => {
  const values = {
    environment: 'test',
    apply: false,
    confirmProduction: null,
    limit: 500
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--environment') values.environment = argv[++index];
    else if (item === '--database') values.database = argv[++index];
    else if (item === '--bucket') values.bucket = argv[++index];
    else if (item === '--config') values.config = argv[++index];
    else if (item === '--limit') values.limit = Number(argv[++index]);
    else if (item === '--apply') values.apply = true;
    else if (item === '--confirm-production') values.confirmProduction = argv[++index];
    else throw new Error(`未知参数：${item}`);
  }
  const target = TARGETS[values.environment];
  if (!target) throw new Error('environment 只能是 test 或 production');
  return { ...target, ...values };
};

export const validateTarget = (options) => {
  const target = TARGETS[options.environment];
  if (!target
      || options.database !== target.database
      || options.bucket !== target.bucket
      || !path.normalize(options.config).endsWith(path.normalize(target.config))) {
    throw new Error('D1、R2或Wrangler配置与目标环境不匹配');
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000) {
    throw new Error('limit 必须是 1 到 1000 的整数');
  }
  if (options.environment === 'production') {
    if (!options.apply || options.confirmProduction !== 'jinshan20') {
      throw new Error('正式环境写入必须提供 --apply --confirm-production jinshan20');
    }
  } else if (options.confirmProduction) {
    throw new Error('测试环境不得提供正式环境确认参数');
  }
};

const runWrangler = (args, { allowMissing = false } = {}) => {
  const result = spawnSync(process.execPath, [wranglerCli, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 24 * 1024 * 1024,
    windowsHide: true
  });
  if (result.status === 0) return result.stdout;
  const message = stripAnsi(`${result.stderr || ''}\n${result.stdout || ''}`).trim();
  if (allowMissing && /specified key does not exist|not found|does not exist/i.test(message)) return null;
  throw new Error(message || `Wrangler执行失败，退出码 ${result.status}`);
};

const queryD1 = (options, sql) => {
  const output = runWrangler([
    'd1', 'execute', options.database,
    '--remote',
    '--config', options.config,
    '--command', sql,
    '--json'
  ]);
  return JSON.parse(stripAnsi(output))[0] || { results: [], meta: {} };
};

const getObject = (options, key, file, allowMissing = false) => runWrangler([
  'r2', 'object', 'get', `${options.bucket}/${key}`,
  '--remote',
  '--config', options.config,
  '--file', file
], { allowMissing }) !== null;

const putObject = (options, key, file) => runWrangler([
  'r2', 'object', 'put', `${options.bucket}/${key}`,
  '--remote',
  '--config', options.config,
  '--file', file,
  '--content-type', 'image/webp',
  '--cache-control', 'private, max-age=31536000, immutable'
]);

export const thumbnailObjectKey = (environment, displayId) => (
  `media/${environment}/thumbs-720-v1/${displayId}.webp`
);

export const createAdminThumbnail = async (input) => {
  const encode = async (edge, quality) => sharp(input, { failOn: 'warning' })
    .rotate()
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb')
    .webp({ quality, alphaQuality: 90, effort: 5, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });

  let output = await encode(720, 84);
  if (output.data.byteLength > 220 * 1024) output = await encode(720, 78);
  if (output.data.byteLength > 220 * 1024) output = await encode(640, 74);
  if (output.data.byteLength > 260 * 1024) throw new Error('缩略图压缩后仍超过260KB');
  return output;
};

const inventorySql = (limit) => `
SELECT m.id AS display_id,m.owner_user_id,m.task_id,m.business_type,m.business_id,
       m.object_key AS display_key,
       t.id AS thumb_id,t.object_key AS old_thumb_key,t.width AS old_thumb_width,
       t.mime_type AS old_thumb_type
  FROM media_objects m
  LEFT JOIN media_objects t ON t.id=(
    SELECT x.id FROM media_objects x
     WHERE x.business_id=m.id AND x.business_type=m.business_type||':thumb'
     ORDER BY x.created_at DESC LIMIT 1
  )
 WHERE m.visibility='private'
   AND m.business_id IS NOT NULL
   AND m.business_type IN ('member-checkin','meal-checkin','admin-makeup','task')
   AND (t.id IS NULL OR COALESCE(t.width,0)<680 OR COALESCE(t.mime_type,'')<>'image/webp')
 ORDER BY m.created_at,m.id
 LIMIT ${limit}
`.trim();

const saveThumbnailSql = (item, key, thumb, now) => {
  const thumbId = item.thumb_id || `thumb-720-${item.display_id}`;
  const businessType = `${item.business_type}:thumb`;
  if (item.thumb_id) {
    return `
UPDATE media_objects
   SET object_key=${sqlText(key)},mime_type='image/webp',file_size=${thumb.data.byteLength},
       width=${Number(thumb.info.width)},height=${Number(thumb.info.height)},etag=NULL,updated_at=${sqlText(now)}
 WHERE id=${sqlText(item.thumb_id)} AND business_id=${sqlText(item.display_id)};
`.trim();
  }
  return `
INSERT INTO media_objects
 (id,owner_user_id,task_id,business_type,business_id,object_key,mime_type,file_size,
  width,height,etag,visibility,created_at,updated_at)
VALUES
 (${sqlText(thumbId)},${sqlText(item.owner_user_id)},${item.task_id ? sqlText(item.task_id) : 'NULL'},
  ${sqlText(businessType)},${sqlText(item.display_id)},${sqlText(key)},'image/webp',
  ${thumb.data.byteLength},${Number(thumb.info.width)},${Number(thumb.info.height)},NULL,'private',
  ${sqlText(now)},${sqlText(now)});
`.trim();
};

export const runBackfill = async (options) => {
  validateTarget(options);
  const candidates = queryD1(options, inventorySql(options.limit)).results || [];
  const report = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: options.environment,
    candidates: candidates.length,
    completed: 0,
    failed: 0,
    totalSourceBytes: 0,
    totalThumbBytes: 0,
    results: [],
    rollback: { r2ObjectKeysToDelete: [], oldThumbObjectKeysPreserved: [] }
  };
  if (!options.apply || !candidates.length) return report;

  const workDir = await mkdtemp(path.join(tmpdir(), 'jinshan20-thumb-720-'));
  try {
    for (const item of candidates) {
      const result = { displayId: item.display_id, displayKey: item.display_key };
      report.results.push(result);
      const sourceFile = path.join(workDir, `${item.display_id}-source`);
      const thumbFile = path.join(workDir, `${item.display_id}-thumb.webp`);
      const verifyFile = path.join(workDir, `${item.display_id}-verify.webp`);
      try {
        if (!await getObject(options, item.display_key, sourceFile, true)) {
          throw new Error('展示图对象不存在');
        }
        const source = await readFile(sourceFile);
        report.totalSourceBytes += source.byteLength;
        const thumb = await createAdminThumbnail(source);
        if (thumb.info.format !== 'webp'
            || Math.max(Number(thumb.info.width), Number(thumb.info.height)) > 720) {
          throw new Error('生成的缩略图格式或尺寸不合规');
        }
        await writeFile(thumbFile, thumb.data);
        const key = thumbnailObjectKey(options.environment, item.display_id);
        putObject(options, key, thumbFile);
        if (!await getObject(options, key, verifyFile, true)) throw new Error('缩略图上传后不可读');
        const verifiedData = await readFile(verifyFile);
        const verified = await sharp(verifiedData).metadata();
        if (verified.format !== 'webp'
            || Math.max(Number(verified.width || 0), Number(verified.height || 0)) > 720
            || verifiedData.byteLength !== thumb.data.byteLength) {
          throw new Error('R2缩略图校验失败');
        }
        queryD1(options, saveThumbnailSql(item, key, thumb, new Date().toISOString()));
        const saved = queryD1(options, `SELECT id,object_key AS objectKey,mime_type AS mimeType,width,height
          FROM media_objects WHERE business_id=${sqlText(item.display_id)}
          AND business_type=${sqlText(`${item.business_type}:thumb`)} ORDER BY updated_at DESC LIMIT 1`).results?.[0];
        if (!saved || saved.objectKey !== key || saved.mimeType !== 'image/webp'
            || Math.max(Number(saved.width || 0), Number(saved.height || 0)) > 720) {
          throw new Error('D1缩略图记录校验失败');
        }
        report.completed += 1;
        report.totalThumbBytes += thumb.data.byteLength;
        report.rollback.r2ObjectKeysToDelete.push(key);
        if (item.old_thumb_key) report.rollback.oldThumbObjectKeysPreserved.push(item.old_thumb_key);
        result.result = 'completed';
        result.width = Number(thumb.info.width);
        result.height = Number(thumb.info.height);
        result.sourceBytes = source.byteLength;
        result.thumbBytes = thumb.data.byteLength;
        result.reductionPercent = source.byteLength
          ? Math.round((1 - thumb.data.byteLength / source.byteLength) * 1000) / 10
          : 0;
      } catch (error) {
        report.failed += 1;
        result.result = 'failed';
        result.error = error instanceof Error ? error.message : String(error);
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
  report.averageThumbBytes = report.completed
    ? Math.round(report.totalThumbBytes / report.completed)
    : 0;
  report.averageReductionPercent = report.totalSourceBytes
    ? Math.round((1 - report.totalThumbBytes / report.totalSourceBytes) * 1000) / 10
    : 0;
  return report;
};

const main = async () => {
  const report = await runBackfill(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.failed) process.exitCode = 1;
};

if (process.argv[1] && path.basename(process.argv[1]) === 'backfill-admin-thumbnails-540.mjs') {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
