import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* APPROVED_MOBILE_EXPERIENCE_FINALIZED_V1 */';
const read = (relativePath) => {
  const file = path.join(root, relativePath);
  return { file, source: fs.readFileSync(file, 'utf8') };
};
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');

{
  const { file, source } = read('cloudflare/routes/media.js');
  if (!source.includes(marker)) {
    let next = source;
    if (!/\breadConfig\b/.test(next.slice(0, next.indexOf("from '../lib/runtime.js'")))) {
      next = next.replace('  nowIso,\n  readJson,', '  nowIso,\n  readConfig,\n  readJson,');
    }
    next = next.replace(/const THUMB_MAX_EDGE = (?:360|540|640);/, 'const THUMB_MAX_EDGE = 640;');
    next = marker + '\n' + next;
    write(file, next);
  }
}

{
  const { file, source } = read('cloudflare/lib/runtime.js');
  if (!source.includes(marker)) {
    let next = source;
    next = next.replace('    checkinSettings: {\n      enabled:', '    checkinSettings: {\n      configured: Boolean(values.checkinSettings),\n      enabled:');
    next = marker + '\n' + next;
    write(file, next);
  }
}

{
  const { file, source } = read('cloudflare/services/student-dashboard.js');
  if (!source.includes(marker)) {
    let next = source;
    next = next.replace(
      "  const settings = config?.checkinSettings || {};\n  const existing = task.scheduleJson ? parseJson(task.scheduleJson, {}) : {};",
      "  const settings = config?.checkinSettings || {};\n  if (!settings.configured) {\n    return { ...task, memberImageLimit: Math.min(8, Math.max(1, Number(task.imageLimit || 3))) };\n  }\n  const existing = task.scheduleJson ? parseJson(task.scheduleJson, {}) : {};"
    );
    next = marker + '\n' + next;
    write(file, next);
  }
}

{
  const { file, source } = read('public/app.js');
  if (!source.includes(marker)) {
    const next = marker + '\n' + source
      .replaceAll('正在生成540px WebP缩略图', '正在生成640px WebP缩略图')
      .replaceAll('生成540px WebP缩略图', '生成640px WebP缩略图')
      .replace(/const MEDIA_THUMB_MAX_EDGE = (?:360|540|640);/, 'const MEDIA_THUMB_MAX_EDGE = 640;');
    write(file, next);
  }
}

for (const relativePath of ['test/member-checkin-fast.test.js', 'test/mobile-admin-photo-fix.test.js']) {
  const { file, source } = read(relativePath);
  const next = source
    .replaceAll('540px WebP缩略图', '640px WebP缩略图')
    .replaceAll('最长边540px', '最长边640px')
    .replace(/MEDIA_THUMB_MAX_EDGE = (?:360|540|640)/g, 'MEDIA_THUMB_MAX_EDGE = 640')
    .replace(/THUMB_MAX_EDGE = (?:360|540|640)/g, 'THUMB_MAX_EDGE = 640');
  if (next !== source) write(file, next);
}

console.log('Finalized approved 640px media imports, labels, tests and check-in settings compatibility.');
await import('./prepare-approved-layout-team-draft-720-v2.mjs');
await import('./apply-approved-layout-team-draft-720-v2.mjs');

const target720TestFiles = [
  'test/member-checkin-fast.test.js',
  'test/mobile-admin-photo-fix.test.js',
  'test/approved-mobile-experience.test.js',
  'test/production-media-login-performance.test.js'
];

for (const relativePath of target720TestFiles) {
  const { file, source } = read(relativePath);
  const next = source
    .replaceAll('正在生成540px WebP缩略图', '正在生成720px WebP缩略图')
    .replaceAll('正在生成640px WebP缩略图', '正在生成720px WebP缩略图')
    .replaceAll('正在生成720px WebP缩略图', '正在上传缩略图')
    .replaceAll('生成540px WebP缩略图', '生成720px WebP缩略图')
    .replaceAll('生成640px WebP缩略图', '生成720px WebP缩略图')
    .replaceAll('最长边540px', '最长边720px')
    .replaceAll('最长边640px', '最长边720px')
    .replace(/MEDIA_THUMB_MAX_EDGE = (?:360|540|640|720)/g, 'MEDIA_THUMB_MAX_EDGE = 720')
    .replaceAll('MEDIA_THUMB_QUALITY = 0\\.72', 'MEDIA_THUMB_QUALITY = 0\\.84')
    .replaceAll('MEDIA_THUMB_QUALITY = 0\\.82', 'MEDIA_THUMB_QUALITY = 0\\.84')
    .replace(/MEDIA_THUMB_QUALITY = 0\.(?:72|82|84)/g, 'MEDIA_THUMB_QUALITY = 0.84')
    .replace(/(^|[^A-Z_])THUMB_MAX_EDGE = (?:360|540|640|720)/gm, '$1THUMB_MAX_EDGE = 720')
    .replaceAll('width="640" height="480"', 'width="720" height="540"')
    .replaceAll('thumbs-640-v1', 'thumbs-720-v1')
    .replaceAll('encode\\(640, 84\\)', 'encode\\(720, 84\\)');
  if (next !== source) write(file, next);
}

const replaceGeneratedTest = (relativePath, pattern, replacement, expectedTitle) => {
  const { file, source } = read(relativePath);
  // A current test is policy, not generator output. Only migrate a historical
  // test title; never rewrite an already-current assertion block.
  if (source.includes(expectedTitle)) return;
  const next = pattern.test(source) ? source.replace(pattern, replacement.trim()) : source;
  // Product generators must not rewrite or loosen test policy. Historical test
  // titles vary across branches; leave an unmatched current test intact and
  // let the normal test runner report any real implementation mismatch.
  if (!pattern.test(source) && !source.includes(expectedTitle)) return;
  if (next !== source) write(file, next);
};

const picaMemberTest = String.raw`test('单人打卡使用Pica生成2048px高清图与960px列表图', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  const memberBody = app.match(
    /function memberCheckinForm\(task\) \{([\s\S]*?)\r?\n\}\r?\n\r?\nfunction materialSubmissionForm/
  )?.[1] || '';
  assert.match(memberBody, /prepareImageVariantsMeasured\((?:sourceFile|selected\[index\])/);
  assert.match(memberBody, /uploadCompressedImage\(prepared\.display/);
  assert.match(memberBody, /variant:\s*'display'/);
  assert.match(memberBody, /uploadCompressedImage\(prepared\.thumb/);
  assert.match(memberBody, /variant:\s*'thumb'/);
  assert.match(memberBody, /parentMediaId:\s*display\.mediaId/);
  assert.match(memberBody, /正在生成高清图和列表图/);
  assert.match(memberBody, /正在上传列表图/);
  assert.doesNotMatch(memberBody, /readFiles/);
  assert.match(app, /PICA_DISPLAY_MAX_EDGE = 2048/);
  assert.match(app, /PICA_THUMB_MAX_EDGE = 960/);
});`;

replaceGeneratedTest(
  'test/approved-layout-team-draft-720.test.js',
  /test\('(?:本轮限定区域使用720px WebP缩略图且不再保留640px生成常量|图片链路使用960px列表图和2048px高清图，旧数据继续使用720px回填)',[\s\S]*?\n\}\);/,
  String.raw`test('图片链路使用960px列表图和2048px高清图，旧数据继续使用720px回填', () => {
  const app = read('public/app.js');
  const media = read('cloudflare/routes/media.js');
  const backfill = read('scripts/backfill-admin-thumbnails-540.mjs');
  assert.match(app, /\/\* PICA_IMAGE_PIPELINE_V1 \*\//);
  assert.match(app, /PICA_THUMB_MAX_EDGE = 960/);
  assert.match(app, /PICA_DISPLAY_MAX_EDGE = 2048/);
  assert.match(media, /THUMB_MAX_EDGE = 960/);
  assert.match(media, /PLAZA_THUMB_MAX_EDGE = 960/);
  assert.match(media, /DISPLAY_MAX_EDGE = 2048/);
  assert.match(backfill, /thumbs-720-v1/);
  assert.match(backfill, /encode\(720, 84\)/);
});`,
  "test('图片链路使用960px列表图和2048px高清图，旧数据继续使用720px回填'"
);

replaceGeneratedTest(
  'test/approved-mobile-experience.test.js',
  /test\('(?:活动广场、历史打卡和管理员打卡统一(?:640|720)px WebP缩略图|活动广场、历史打卡和管理员列表图统一使用960px Pica链路)',[\s\S]*?\n\}\);/,
  String.raw`test('活动广场、历史打卡和管理员列表图统一使用960px Pica链路', () => {
  const app = read('public/app.js');
  const media = read('cloudflare/routes/media.js');
  const backfill = read('scripts/backfill-admin-thumbnails-540.mjs');
  assert.match(app, /PICA_THUMB_MAX_EDGE = 960/);
  assert.match(app, /PICA_DISPLAY_MAX_EDGE = 2048/);
  assert.match(app, /data-perf-image="history-thumb"/);
  assert.match(app, /data-perf-image="plaza-thumb"/);
  assert.match(app, /data-perf-image="admin-checkin-thumb"/);
  assert.match(media, /THUMB_MAX_EDGE = 960/);
  assert.match(media, /PLAZA_THUMB_MAX_EDGE = 960/);
  assert.match(media, /DISPLAY_MAX_EDGE = 2048/);
  assert.match(backfill, /thumbs-720-v1/);
  assert.match(backfill, /encode\(720, 84\)/);
  assert.match(backfill, /'task'/);
});`,
  "test('活动广场、历史打卡和管理员列表图统一使用960px Pica链路'"
);

replaceGeneratedTest(
  'test/member-checkin-fast.test.js',
  /test\('(?:单人打卡前端只使用fast接口、最多三轮压缩且不生成缩略图|单人打卡展示图使用fast接口并生成(?:540|640|720)px WebP缩略图|单人打卡使用Pica生成2048px高清图与960px列表图)',[\s\S]*?\n\}\);/,
  picaMemberTest,
  "test('单人打卡使用Pica生成2048px高清图与960px列表图'"
);

replaceGeneratedTest(
  'test/mobile-admin-photo-fix.test.js',
  /test\('(?:所有管理端缩略图限制为最长边(?:640|720)px并优先WebP|管理端列表图使用960px Pica\/WebP并与媒体服务限制一致)',[\s\S]*?\n\}\);/,
  String.raw`test('管理端列表图使用960px Pica/WebP并与媒体服务限制一致', () => {
  const app = read('public/app.js');
  const media = read('cloudflare/routes/media.js');
  assert.match(app, /\/\* PICA_IMAGE_PIPELINE_V1 \*\//);
  assert.match(app, /PICA_THUMB_MAX_EDGE = 960/);
  assert.match(app, /PICA_DISPLAY_MAX_EDGE = 2048/);
  assert.match(app, /quality: screenshotLike \? 0\.92 : 0\.88/);
  assert.match(app, /prepareImageVariantsMeasured\((?:sourceFile|selected\[index\])/);
  assert.match(app, /uploadPreparedImagePair\(prepared,/);
  assert.match(app, /confirmPreparedImagePair\(/);
  assert.match(app, /api\('\/api\/media\/upload-pairs\/confirm'/);
  assert.doesNotMatch(app, /confirmVariantUpload\(thumbIntent, prepared\.thumb, display\.mediaId, signal\)/);
  assert.match(media, /THUMB_MAX_EDGE = 960/);
  assert.match(media, /PLAZA_THUMB_MAX_EDGE = 960/);
  assert.match(media, /DISPLAY_MAX_EDGE = 2048/);
});`,
  "test('管理端列表图使用960px Pica/WebP并与媒体服务限制一致'"
);

replaceGeneratedTest(
  'test/production-media-login-performance.test.js',
  /test\('(?:二次提速参数前后端一致，并复用已加载缩略图|Pica图片参数前后端一致，并复用已加载缩略图)',[\s\S]*?\n\}\);/,
  String.raw`test('Pica图片参数前后端一致，并复用已加载缩略图', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  const media = fs.readFileSync('cloudflare/routes/media.js', 'utf8');
  assert.match(app, /PICA_THUMB_MAX_EDGE = 960/);
  assert.match(app, /PICA_DISPLAY_MAX_EDGE = 2048/);
  assert.match(app, /PICA_THUMB_MAX_BYTES = 491520/);
  assert.match(app, /PICA_DISPLAY_MAX_BYTES = 1468006/);
  assert.match(app, /quality: screenshotLike \? 0\.92 : 0\.88/);
  assert.match(app, /quality: screenshotLike \? 0\.94 : 0\.90/);
  assert.match(app, /prepareImageVariantsMeasured\((?:sourceFile|selected\[index\])/);
  assert.match(app, /renderedImage\?\.complete/);
  assert.match(app, /await displayImage\.decode\(\)/);
  assert.match(media, /THUMB_MAX_EDGE = 960/);
  assert.match(media, /PLAZA_THUMB_MAX_EDGE = 960/);
  assert.match(media, /DISPLAY_MAX_EDGE = 2048/);
  assert.doesNotMatch(media, /variant === 'thumb' \? 480 : 1280/);
});`,
  "test('Pica图片参数前后端一致，并复用已加载缩略图'"
);

console.log('Aligned legacy media assertions with the Pica 960px list-image and 2048px display-image pipeline.');
