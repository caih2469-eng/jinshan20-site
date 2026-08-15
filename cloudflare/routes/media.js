/* APPROVED_LAYOUT_TEAM_DRAFT_720_V2 */
/* APPROVED_MOBILE_EXPERIENCE_FINALIZED_V1 */
/* APPROVED_MOBILE_EXPERIENCE_BACKEND_V1 */
/* CHECKIN_WINDOW_UPLOAD_PLAZA_PAGE_V1 */
import { AwsClient } from 'aws4fetch';
import {
  cleanText,
  hasMakeupPermission,
  json,
  isD1OverloadedError,
  nowIso,
  readConfig,
  readJson,
  retryD1Overload,
  requireUser,
  shanghaiDate
} from '../lib/runtime.js';
import { verifyPrivateMediaRequest } from '../lib/media-signing.js';
import {
  applyInteractionCheckinSettings,
  taskWindowOpen,
  teamForUser
} from '../services/student-dashboard.js';

const ALLOWED_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
]);
const MAX_FINAL_BYTES = 5 * 1024 * 1024;
const THUMB_MAX_EDGE = 960;
const PLAZA_THUMB_MAX_EDGE = 960;
const DISPLAY_MAX_EDGE = 2048;
const INTENT_TTL_SECONDS = 180;
const MEMBER_FAST_MAX_BYTES = 307_200;
const MEMBER_FAST_MAX_EDGE = 960;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const noLeak = (status = 404) => json({ error: '媒体不可访问' }, status, {
  'cache-control': 'no-store',
  'x-image-cache': 'MISS'
});

const signatureMatches = (bytes, type) => {
  if (!bytes?.length) return false;
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') {
    return [...bytes.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('') === '89504e470d0a1a0a';
  }
  return new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
};

const sha256Bytes = async (bytes) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const memberFastMediaPayload = (media) => ({
  id: media.id,
  mimeType: media.mimeType,
  fileSize: Number(media.fileSize),
  width: Number(media.width),
  height: Number(media.height)
});

const loadTestContext = async (request, env, url) => {
  if (!['test', 'staging'].includes(String(env.ENVIRONMENT || '').toLowerCase())
      || String(env.ALLOW_LOAD_TESTS || '').toLowerCase() !== 'true') {
    return { error: json({ error: '负载测试接口未启用' }, 404, { 'cache-control': 'no-store' }) };
  }
  const auth = await requireUser(request, env, true);
  if (auth.error) return { error: auth.error };
  const runId = cleanText(url.searchParams.get('runId'), 40).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(runId)) {
    return { error: json({ error: 'runId格式无效' }, 400, { 'cache-control': 'no-store' }) };
  }
  return {
    runId,
    userPrefix: `load-fast-user-${runId}-`,
    teamPrefix: `load-fast-team-${runId}-`,
    adminId: `lf-admin-${runId.slice(0, 30)}`,
    taskId: `load-fast-task-${runId}`,
    objectPrefix: `media/${env.ENVIRONMENT}/load-fast-user-${runId}-`
  };
};

const listAllR2Keys = async (bucket, prefix) => {
  const keys = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    keys.push(...page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
};

const readMemberFastLoadInventory = async (env, context) => {
  const like = `${context.userPrefix}%`;
  const [
    users,
    loadAdmins,
    uploads,
    checkins,
    intents,
    thumbs,
    duplicateMedia,
    teams,
    tasks,
    r2Keys
  ] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS total FROM users WHERE id LIKE ?1').bind(like).first(),
    env.DB.prepare('SELECT COUNT(*) AS total FROM users WHERE id=?1')
      .bind(context.adminId).first(),
    env.DB.prepare('SELECT COUNT(*) AS total FROM media_objects WHERE owner_user_id LIKE ?1')
      .bind(like).first(),
    env.DB.prepare('SELECT COUNT(*) AS total FROM member_checkins WHERE user_id LIKE ?1')
      .bind(like).first(),
    env.DB.prepare('SELECT COUNT(*) AS total FROM media_upload_intents WHERE user_id LIKE ?1')
      .bind(like).first(),
    env.DB.prepare(
      "SELECT COUNT(*) AS total FROM media_objects WHERE owner_user_id LIKE ?1 AND business_type LIKE '%:thumb'"
    ).bind(like).first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total FROM (
         SELECT object_key FROM media_objects WHERE owner_user_id LIKE ?1
          GROUP BY object_key HAVING COUNT(*)>1
       )`
    ).bind(like).first(),
    env.DB.prepare('SELECT COUNT(*) AS total FROM teams WHERE id LIKE ?1')
      .bind(`${context.teamPrefix}%`).first(),
    env.DB.prepare('SELECT COUNT(*) AS total FROM tasks WHERE id=?1')
      .bind(context.taskId).first(),
    listAllR2Keys(env.UPLOADS, context.objectPrefix)
  ]);
  return {
    runId: context.runId,
    users: Number(users?.total || 0),
    loadAdmins: Number(loadAdmins?.total || 0),
    mediaObjects: Number(uploads?.total || 0),
    memberCheckins: Number(checkins?.total || 0),
    uploadIntents: Number(intents?.total || 0),
    thumbMediaObjects: Number(thumbs?.total || 0),
    duplicateMediaObjectKeys: Number(duplicateMedia?.total || 0),
    teams: Number(teams?.total || 0),
    tasks: Number(tasks?.total || 0),
    r2Objects: r2Keys.length
  };
};

const memberFastLoadInventory = async (request, env, url) => {
  const context = await loadTestContext(request, env, url);
  if (context.error) return context.error;
  const inventory = await readMemberFastLoadInventory(env, context);
  return json({ ok: true, ...inventory }, 200, { 'cache-control': 'no-store' });
};

const memberFastLoadCleanup = async (request, env, url) => {
  const context = await loadTestContext(request, env, url);
  if (context.error) return context.error;
  const like = `${context.userPrefix}%`;
  const r2Keys = await listAllR2Keys(env.UPLOADS, context.objectPrefix);
  for (let offset = 0; offset < r2Keys.length; offset += 1000) {
    await env.UPLOADS.delete(r2Keys.slice(offset, offset + 1000));
  }
  const results = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM image_variants
        WHERE source_type='member_checkin'
          AND source_id IN (SELECT id FROM member_checkins WHERE user_id LIKE ?1)`
    ).bind(like),
    env.DB.prepare('DELETE FROM member_checkins WHERE user_id LIKE ?1').bind(like),
    env.DB.prepare('DELETE FROM media_objects WHERE owner_user_id LIKE ?1').bind(like),
    env.DB.prepare('DELETE FROM media_upload_intents WHERE user_id LIKE ?1').bind(like),
    env.DB.prepare('DELETE FROM team_members WHERE user_id LIKE ?1').bind(like),
    env.DB.prepare('DELETE FROM teams WHERE id LIKE ?1').bind(`${context.teamPrefix}%`),
    env.DB.prepare('DELETE FROM users WHERE id LIKE ?1').bind(like),
    env.DB.prepare('DELETE FROM users WHERE id=?1').bind(context.adminId),
    env.DB.prepare('DELETE FROM tasks WHERE id=?1').bind(context.taskId)
  ]);
  const inventoryAfter = await readMemberFastLoadInventory(env, context);
  return json({
    ok: true,
    runId: context.runId,
    deletedR2Objects: r2Keys.length,
    d1Changes: results.map((result) => Number(result.meta?.changes || 0)),
    inventoryAfter
  }, 200, { 'cache-control': 'no-store' });
};

const memberFastUpload = async (request, env) => {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;
  if (auth.user.role !== 'student' || auth.user.trackId !== 'interaction') {
    return json({ error: '仅四校区互动赛道学生可以上传个人打卡图片' }, 403);
  }

  const taskId = cleanText(request.headers.get('x-task-id'), 80);
  const idempotencyKey = cleanText(request.headers.get('x-idempotency-key'), 80);
  const mimeType = cleanText(request.headers.get('content-type'), 80).toLowerCase().split(';')[0];
  const width = Number(request.headers.get('x-image-width'));
  const height = Number(request.headers.get('x-image-height'));
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (!taskId) return json({ error: '缺少任务编号' }, 400);
  if (!UUID_PATTERN.test(idempotencyKey)) return json({ error: '上传幂等编号格式无效' }, 400);
  if (!['image/webp', 'image/jpeg'].includes(mimeType)) {
    return json({ error: '个人打卡成品仅支持 WebP 或 JPEG' }, 415);
  }
  if (!Number.isInteger(width) || !Number.isInteger(height)
      || width < 1 || height < 1 || Math.max(width, height) > MEMBER_FAST_MAX_EDGE) {
    return json({ error: '图片尺寸无效，最长边不能超过960像素' }, 400);
  }
  if (declaredLength > MEMBER_FAST_MAX_BYTES) {
    return json({ error: '图片压缩后仍超过300KB，请先在相册中裁剪、截图或压缩后重新上传。' }, 413);
  }

  const [task, team, taskConfig] = await Promise.all([
    env.DB.prepare(
      `SELECT id,track_id AS trackId,submission_type AS submissionType,
              image_limit AS imageLimit,starts_at AS startsAt,ends_at AS endsAt,
              schedule_json AS scheduleJson,status
         FROM tasks WHERE id=?1 LIMIT 1`
    ).bind(taskId).first(),
    teamForUser(env, auth.user.id),
    readConfig(env)
  ]);
  if (!task || task.status !== 'published' || task.trackId !== 'interaction'
      || (task.submissionType && task.submissionType !== 'team')) {
    return json({ error: '任务不存在、已关闭或不支持队伍成员打卡' }, 404);
  }
  const effectiveTask = applyInteractionCheckinSettings(task, taskConfig);
  if (!team) return json({ error: '尚未分配队伍，不能上传队伍打卡图片' }, 403);
  const occurrenceDate = shanghaiDate();
  let windowOpen = taskWindowOpen(effectiveTask, occurrenceDate, false);
  if (!windowOpen) {
    const makeupAllowed = await hasMakeupPermission(env, auth.user.id, occurrenceDate);
    windowOpen = taskWindowOpen(effectiveTask, occurrenceDate, makeupAllowed);
  }
  if (!windowOpen) return json({ error: '当前不在该任务的打卡时间范围内' }, 403);

  const buffer = await request.arrayBuffer();
  if (!buffer.byteLength) return json({ error: '图片内容不能为空' }, 400);
  if (buffer.byteLength > MEMBER_FAST_MAX_BYTES) {
    return json({ error: '图片压缩后仍超过300KB，请先在相册中裁剪、截图或压缩后重新上传。' }, 413);
  }
  const bytes = new Uint8Array(buffer);
  if (!signatureMatches(bytes, mimeType)) return json({ error: '图片真实格式校验失败' }, 415);

  const digest = await sha256Bytes(buffer);
  const extension = mimeType === 'image/webp' ? 'webp' : 'jpg';
  const objectKey = `media/${env.ENVIRONMENT || 'test'}/${auth.user.id}/member-checkin/${idempotencyKey}-${digest}.${extension}`;
  const now = nowIso();
  const expiresAt = new Date(Date.now() + INTENT_TTL_SECONDS * 1000).toISOString();
  const priorObject = await env.UPLOADS.head(objectKey);
  if (priorObject && (priorObject.size !== buffer.byteLength
      || priorObject.httpMetadata?.contentType !== mimeType
      || priorObject.customMetadata?.sha256 !== digest)) {
    return json({ error: '上传对象与幂等记录不一致' }, 409);
  }
  let wroteNewObject = false;
  if (!priorObject) {
    await env.UPLOADS.put(objectKey, buffer, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { sha256: digest, idempotencyKey }
    });
    wroteNewObject = true;
  }
  try {
    const object = await env.UPLOADS.head(objectKey);
    if (!object || object.size !== buffer.byteLength
        || object.httpMetadata?.contentType !== mimeType
        || object.customMetadata?.sha256 !== digest) {
      throw Object.assign(new Error('R2图片校验失败，请重新上传'), { status: 409 });
    }
    const statements = [
      env.DB.prepare(
        `INSERT OR IGNORE INTO media_upload_intents
          (id,user_id,task_id,business_type,object_key,mime_type,expected_size,width,height,status,
           expires_at,created_at,updated_at)
         VALUES (?1,?2,?3,'member-checkin',?4,?5,?6,?7,?8,'pending',?9,?10,?10)`
      ).bind(idempotencyKey, auth.user.id, task.id, objectKey, mimeType, buffer.byteLength,
        width, height, expiresAt, now),
      env.DB.prepare(
        `INSERT OR IGNORE INTO media_objects
          (id,owner_user_id,task_id,business_type,object_key,mime_type,file_size,width,height,etag,
           visibility,business_id,created_at,updated_at)
         VALUES (?1,?2,?3,'member-checkin',?4,?5,?6,?7,?8,?9,'private',NULL,?10,?10)`
      ).bind(idempotencyKey, auth.user.id, task.id, objectKey, mimeType, buffer.byteLength,
        width, height, object.httpEtag || '', now),
      env.DB.prepare(
        `UPDATE media_upload_intents
            SET status='confirmed',confirmed_at=?1,updated_at=?1
          WHERE id=?2 AND user_id=?3 AND task_id=?4 AND business_type='member-checkin'
            AND object_key=?5 AND mime_type=?6 AND expected_size=?7 AND width=?8 AND height=?9
            AND status='pending'`
      ).bind(now, idempotencyKey, auth.user.id, task.id, objectKey, mimeType,
        buffer.byteLength, width, height)
    ];
    const results = await retryD1Overload(() => env.DB.batch(statements), {
      maxAttempts: 5,
      baseDelayMs: 500,
      maxDelayMs: 8_000
    });
    if (!results[2]?.meta?.changes) {
      const recovered = await env.DB.prepare(
        `SELECT m.id,m.owner_user_id AS ownerUserId,m.task_id AS taskId,
                m.business_type AS businessType,m.object_key AS objectKey,
                m.mime_type AS mimeType,m.file_size AS fileSize,m.width,m.height,i.status
           FROM media_objects m JOIN media_upload_intents i ON i.id=m.id
          WHERE m.id=?1 LIMIT 1`
      ).bind(idempotencyKey).first();
      const recoveredMatches = recovered?.ownerUserId === auth.user.id
        && recovered.taskId === task.id && recovered.businessType === 'member-checkin'
        && recovered.objectKey === objectKey && recovered.mimeType === mimeType
        && Number(recovered.fileSize) === buffer.byteLength
        && Number(recovered.width) === width && Number(recovered.height) === height
        && recovered.status === 'confirmed';
      if (recoveredMatches) {
        return json({ ok: true, repeated: true, media: memberFastMediaPayload(recovered) });
      }
      if (recovered && recovered.ownerUserId !== auth.user.id) {
        throw Object.assign(new Error('无权使用该上传编号'), { status: 403 });
      }
      throw Object.assign(new Error('图片确认发生冲突，请点击重试上传'), { status: 409 });
    }
    return json({
      ok: true,
      repeated: false,
      media: memberFastMediaPayload({
        id: idempotencyKey,
        mimeType,
        fileSize: buffer.byteLength,
        width,
        height
      })
    }, 201);
  } catch (error) {
    // An overloaded D1 request can have committed before the response was lost.
    // Keep the deterministic R2 object so the same idempotency key can recover it.
    if (wroteNewObject && !isD1OverloadedError(error)) {
      await env.UPLOADS.delete(objectKey).catch(() => null);
    }
    throw error;
  }
};

const rejectIntent = async (env, intent, reason) => {
  await env.UPLOADS.delete(intent.objectKey).catch(() => null);
  await env.DB.prepare(
    "UPDATE media_upload_intents SET status='rejected',updated_at=?1 WHERE id=?2 AND status='pending'"
  ).bind(nowIso(), intent.id).run();
  throw Object.assign(new Error(reason), { status: 415 });
};

export const inspectUploadedObject = async (env, objectKey) => {
  const ranged = await env.UPLOADS.get(objectKey, { range: { offset: 0, length: 16 } });
  if (!ranged) return null;
  const bytes = new Uint8Array(await new Response(ranged.body).arrayBuffer());
  let size = Number(ranged.size);
  let contentType = ranged.httpMetadata?.contentType || '';
  let etag = ranged.httpEtag || '';
  let usedHeadFallback = false;
  if (!Number.isFinite(size) || size < 1 || !contentType || !etag) {
    const metadata = await env.UPLOADS.head(objectKey);
    if (!metadata) return null;
    usedHeadFallback = true;
    size = Number(metadata.size);
    contentType = metadata.httpMetadata?.contentType || '';
    etag = metadata.httpEtag || '';
  }
  return { bytes, size, contentType, etag, usedHeadFallback };
};

const createUploadIntent = async (request, env) => {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request, 16 * 1024);
  const mimeType = cleanText(body.mimeType, 40).toLowerCase();
  const extension = ALLOWED_TYPES.get(mimeType);
  const expectedSize = Number(body.fileSize);
  const width = Number(body.width);
  const height = Number(body.height);
  const taskId = cleanText(body.taskId, 80) || null;
  const businessType = cleanText(body.businessType, 40);
  const variant = body.variant === 'thumb' ? 'thumb' : 'display';
  const storedBusinessType = variant === 'thumb' ? `${businessType}:thumb` : businessType;
  const maxEdge = variant === 'thumb'
    ? (businessType === 'task' ? PLAZA_THUMB_MAX_EDGE : THUMB_MAX_EDGE)
    : DISPLAY_MAX_EDGE;
  if (!extension || !['task', 'member-checkin', 'meal-checkin', 'material-image', 'admin-makeup'].includes(businessType)) {
    return json({ error: '不支持的图片类型或上传用途' }, 415);
  }
  if (!Number.isInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_FINAL_BYTES
      || !Number.isInteger(width) || width < 1 || width > maxEdge
      || !Number.isInteger(height) || height < 1 || height > maxEdge) {
    return json({ error: '压缩图片的大小或尺寸不符合要求' }, 400);
  }
  if (taskId) {
    const taskTable = businessType === 'material-image' ? 'material_tasks' : 'tasks';
    const task = await env.DB.prepare(`SELECT id,status FROM ${taskTable} WHERE id=?1`).bind(taskId).first();
    if (!task || task.status !== 'published') return json({ error: '任务不存在或不可提交' }, 404);
  }
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME) {
    return json({ error: '测试环境R2直传尚未配置' }, 503);
  }
  const id = crypto.randomUUID();
  const objectKey = `media/${env.ENVIRONMENT || 'test'}/${auth.user.id}/${variant}/${id}.${extension}`;
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + INTENT_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO media_upload_intents
      (id,user_id,task_id,business_type,object_key,mime_type,expected_size,width,height,status,
       expires_at,created_at,updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'pending',?10,?11,?11)`
  ).bind(id, auth.user.id, taskId, storedBusinessType, objectKey, mimeType,
    expectedSize, width, height, expiresAt, createdAt).run();
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto'
  });
  const target = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${encodeURIComponent(env.R2_BUCKET_NAME)}/${objectKey.split('/').map(encodeURIComponent).join('/')}`
  );
  target.searchParams.set('X-Amz-Expires', String(INTENT_TTL_SECONDS));
  const signed = await client.sign(target, {
    method: 'PUT',
    headers: { 'content-type': mimeType },
    aws: { signQuery: true }
  });
  return json({
    intentId: id,
    uploadUrl: signed.url,
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    expiresAt
  }, 201);
};

const directUploadPart = async (form, field, businessType) => {
  const file = form.get(field);
  const mimeType = cleanText(file?.type, 40).toLowerCase();
  const extension = ALLOWED_TYPES.get(mimeType);
  const size = Number(file?.size);
  const width = Number(form.get(`${field}Width`));
  const height = Number(form.get(`${field}Height`));
  const maxEdge = field === 'thumb'
    ? (businessType === 'task' ? PLAZA_THUMB_MAX_EDGE : THUMB_MAX_EDGE)
    : DISPLAY_MAX_EDGE;
  if (!file || typeof file.arrayBuffer !== 'function' || !extension
      || !Number.isInteger(size) || size < 1 || size > MAX_FINAL_BYTES
      || !Number.isInteger(width) || width < 1 || width > maxEdge
      || !Number.isInteger(height) || height < 1 || height > maxEdge) {
    throw Object.assign(new Error('压缩图片的大小、格式或尺寸不符合要求'), { status: 400 });
  }
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!signatureMatches(header, mimeType)) {
    throw Object.assign(new Error('图片真实格式校验失败'), { status: 415 });
  }
  return { file, mimeType, extension, size, width, height };
};

const directUploadPair = async (request, env) => {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;
  const form = await request.formData();
  const businessType = cleanText(form.get('businessType'), 40);
  const taskId = cleanText(form.get('taskId'), 80) || null;
  if (!['task', 'member-checkin', 'meal-checkin', 'material-image', 'admin-makeup'].includes(businessType)) {
    return json({ error: '不支持的图片上传用途' }, 415);
  }
  const [display, thumb] = await Promise.all([
    directUploadPart(form, 'display', businessType),
    directUploadPart(form, 'thumb', businessType)
  ]);
  if (taskId) {
    const taskTable = businessType === 'material-image' ? 'material_tasks' : 'tasks';
    const task = await env.DB.prepare(`SELECT id,status FROM ${taskTable} WHERE id=?1`).bind(taskId).first();
    if (!task || task.status !== 'published') return json({ error: '任务不存在或不可提交' }, 404);
  }

  const displayId = crypto.randomUUID();
  const thumbId = crypto.randomUUID();
  const displayKey = `media/${env.ENVIRONMENT || 'test'}/${auth.user.id}/display/${displayId}.${display.extension}`;
  const thumbKey = `media/${env.ENVIRONMENT || 'test'}/${auth.user.id}/thumb/${thumbId}.${thumb.extension}`;
  const now = nowIso();
  const expiresAt = new Date(Date.now() + INTENT_TTL_SECONDS * 1000).toISOString();
  try {
    const uploads = Promise.all([
      env.UPLOADS.put(displayKey, display.file, {
        httpMetadata: { contentType: display.mimeType }, customMetadata: { private: 'true' }
      }),
      env.UPLOADS.put(thumbKey, thumb.file, {
        httpMetadata: { contentType: thumb.mimeType }, customMetadata: { private: 'true' }
      })
    ]);
    const persistence = env.DB.batch([
      env.DB.prepare(
        `INSERT INTO media_upload_intents
          (id,user_id,task_id,business_type,object_key,mime_type,expected_size,width,height,status,
           expires_at,confirmed_at,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'confirmed',?10,?11,?11,?11)`
      ).bind(displayId, auth.user.id, taskId, businessType, displayKey, display.mimeType,
        display.size, display.width, display.height, expiresAt, now),
      env.DB.prepare(
        `INSERT INTO media_upload_intents
          (id,user_id,task_id,business_type,object_key,mime_type,expected_size,width,height,status,
           expires_at,confirmed_at,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'confirmed',?10,?11,?11,?11)`
      ).bind(thumbId, auth.user.id, taskId, `${businessType}:thumb`, thumbKey, thumb.mimeType,
        thumb.size, thumb.width, thumb.height, expiresAt, now),
      env.DB.prepare(
        `INSERT INTO media_objects
          (id,owner_user_id,task_id,business_type,object_key,mime_type,file_size,width,height,etag,
           visibility,business_id,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'private',NULL,?11,?11)`
      ).bind(displayId, auth.user.id, taskId, businessType, displayKey, display.mimeType,
        display.size, display.width, display.height, '', now),
      env.DB.prepare(
        `INSERT INTO media_objects
          (id,owner_user_id,task_id,business_type,object_key,mime_type,file_size,width,height,etag,
           visibility,business_id,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'private',?11,?12,?12)`
      ).bind(thumbId, auth.user.id, taskId, `${businessType}:thumb`, thumbKey, thumb.mimeType,
        thumb.size, thumb.width, thumb.height, '', displayId, now)
    ]);
    await Promise.all([uploads, persistence]);
  } catch (error) {
    await Promise.all([
      env.UPLOADS.delete(displayKey).catch(() => null),
      env.UPLOADS.delete(thumbKey).catch(() => null),
      env.DB.batch([
        env.DB.prepare('DELETE FROM media_objects WHERE id IN (?1,?2)').bind(displayId, thumbId),
        env.DB.prepare('DELETE FROM media_upload_intents WHERE id IN (?1,?2)').bind(displayId, thumbId)
      ]).catch(() => null)
    ]);
    throw error;
  }
  return json({
    display: { id: displayId, mimeType: display.mimeType, fileSize: display.size, width: display.width, height: display.height },
    thumb: { id: thumbId, mimeType: thumb.mimeType, fileSize: thumb.size, width: thumb.width, height: thumb.height }
  }, 201);
};

const confirmUpload = async (request, env, intentId) => {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request, 8 * 1024);
  const intent = await env.DB.prepare(
    `SELECT id,user_id AS userId,task_id AS taskId,business_type AS businessType,
            object_key AS objectKey,mime_type AS mimeType,expected_size AS expectedSize,
            width,height,status,expires_at AS expiresAt
       FROM media_upload_intents WHERE id=?1`
  ).bind(intentId).first();
  if (!intent || intent.userId !== auth.user.id) return noLeak(404);
  if (intent.status === 'confirmed') {
    const existing = await env.DB.prepare(
      'SELECT id,mime_type AS mimeType,file_size AS fileSize,width,height FROM media_objects WHERE id=?1'
    ).bind(intent.id).first();
    return existing ? json({ media: existing, imageUrl: null, repeated: true }) : json({ error: '确认状态异常' }, 409);
  }
  if (intent.status !== 'pending') return json({ error: '该上传已失效' }, 409);
  if (Date.parse(intent.expiresAt) < Date.now()) {
    await env.DB.prepare(
      "UPDATE media_upload_intents SET status='expired',updated_at=?1 WHERE id=?2 AND status='pending'"
    ).bind(nowIso(), intent.id).run();
    return json({ error: '上传地址已过期，请重新选择图片' }, 410);
  }
  if (intent.taskId) {
    const baseBusinessType = intent.businessType.replace(/:thumb$/, '');
    const taskTable = baseBusinessType === 'material-image' ? 'material_tasks' : 'tasks';
    const task = await env.DB.prepare(`SELECT status FROM ${taskTable} WHERE id=?1`).bind(intent.taskId).first();
    if (!task || task.status !== 'published') {
      await rejectIntent(env, intent, '任务已关闭，图片不能继续确认');
    }
  }
  const object = await inspectUploadedObject(env, intent.objectKey);
  if (!object) return json({ error: 'R2尚未收到图片，请重新上传' }, 409);
  const actualType = object.contentType;
  if (object.size < 1 || object.size > MAX_FINAL_BYTES || object.size !== Number(intent.expectedSize)
      || actualType !== intent.mimeType || !ALLOWED_TYPES.has(actualType)) {
    return rejectIntent(env, intent, '上传图片的大小或类型与申请信息不一致');
  }
  if (!signatureMatches(object.bytes, actualType)) return rejectIntent(env, intent, '图片真实格式校验失败');
  const now = nowIso();
  const mediaId = intent.id;
  const isThumb = intent.businessType.endsWith(':thumb');
  const parentMediaId = isThumb ? cleanText(body.parentMediaId, 80) : null;
  if (isThumb) {
    const baseBusinessType = intent.businessType.replace(/:thumb$/, '');
    const maxThumbEdge = baseBusinessType === 'task' ? PLAZA_THUMB_MAX_EDGE : THUMB_MAX_EDGE;
    const parent = parentMediaId ? await env.DB.prepare(
      `SELECT id FROM media_objects
        WHERE id=?1 AND owner_user_id=?2 AND COALESCE(task_id,'')=COALESCE(?3,'')
          AND business_type=?4 AND business_id IS NULL LIMIT 1`
    ).bind(parentMediaId, intent.userId, intent.taskId || null,
      intent.businessType.replace(/:thumb$/, '')).first() : null;
    if (!parent || Math.max(Number(intent.width), Number(intent.height)) > maxThumbEdge) {
      await env.UPLOADS.delete(intent.objectKey).catch(() => null);
      return json({ error: '缩略图与原图片不匹配' }, 403, { 'cache-control': 'no-store' });
    }
  }
  const statements = [
    env.DB.prepare(
      `INSERT INTO media_objects
        (id,owner_user_id,task_id,business_type,object_key,mime_type,file_size,width,height,etag,
          visibility,business_id,created_at,updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'private',?11,?12,?12)`
    ).bind(mediaId, intent.userId, intent.taskId, intent.businessType, intent.objectKey,
       actualType, object.size, intent.width, intent.height, object.etag, parentMediaId, now),
    env.DB.prepare(
      "UPDATE media_upload_intents SET status='confirmed',confirmed_at=?1,updated_at=?1 WHERE id=?2 AND status='pending'"
    ).bind(now, intent.id)
  ];
  const results = await env.DB.batch(statements);
  if (!results[1]?.meta?.changes) return json({ error: '上传已被其他请求确认' }, 409);
  return json({
    media: { id: mediaId, mimeType: actualType, fileSize: object.size, width: intent.width, height: intent.height }
  });
};

const confirmUploadPair = async (request, env) => {
  const body = await readJson(request, 8 * 1024);
  const displayIntentId = cleanText(body.displayIntentId, 80);
  const thumbIntentId = cleanText(body.thumbIntentId, 80);
  if (!displayIntentId || !thumbIntentId || displayIntentId === thumbIntentId) {
    return json({ error: '图片确认编号无效' }, 400);
  }
  const internalHeaders = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  for (const name of ['authorization', 'cookie']) {
    const value = request.headers.get(name);
    if (value) internalHeaders.set(name, value);
  }
  const confirmOne = (intentId, parentMediaId = null) => confirmUpload(new Request(request.url, {
    method: 'POST',
    headers: internalHeaders,
    body: JSON.stringify({ parentMediaId })
  }), env, intentId);

  const displayResponse = await confirmOne(displayIntentId);
  const displayBody = await displayResponse.clone().json().catch(() => null);
  if (!displayResponse.ok || !displayBody?.media?.id) return displayResponse;
  const thumbResponse = await confirmOne(thumbIntentId, displayBody.media.id);
  const thumbBody = await thumbResponse.clone().json().catch(() => null);
  if (!thumbResponse.ok || !thumbBody?.media?.id) return thumbResponse;
  return json({ display: displayBody.media, thumb: thumbBody.media });
};

const mediaHeaders = (object, contentType, cacheControl) => ({
  'content-type': object.httpMetadata?.contentType || contentType || 'application/octet-stream',
  'content-length': String(object.size),
  etag: object.httpEtag,
  'content-disposition': 'inline',
  'cache-control': cacheControl,
  'content-security-policy': "default-src 'none'",
  'x-content-type-options': 'nosniff'
});

const privateMedia = async (request, env, url, mediaId) => {
  const signed = await verifyPrivateMediaRequest(env, mediaId, url.searchParams);
  if (!signed) return noLeak(403);
  const auth = await requireUser(request, env);
  if (auth.error) return noLeak(403);
  if (auth.user.id !== signed.scope
      || (signed.aud === 'admin' && auth.user.role !== 'admin')
      || (signed.aud === 'owner' && auth.user.role === 'admin')) return noLeak(403);
  const object = await env.UPLOADS.get(signed.objectKey);
  if (!object) return noLeak(404);
  if (request.headers.get('if-none-match') === object.httpEtag) {
    return new Response(null, { status: 304, headers: { etag: object.httpEtag, 'cache-control': 'private, max-age=900' } });
  }
  return new Response(request.method === 'HEAD' ? null : object.body, {
    headers: mediaHeaders(object, object.httpMetadata?.contentType, 'private, max-age=900')
  });
};

const publicMedia = async (request, env, ctx, mediaId) => {
  const file = await env.DB.prepare(
    `SELECT m.object_key AS objectKey,m.mime_type AS mimeType
       FROM media_objects m
       JOIN task_submission_images i ON i.id=m.id
       JOIN task_submissions s ON s.id=i.submission_id
       JOIN plaza_posts p ON p.submission_id=s.id
      WHERE m.id=?1 AND m.visibility='public' AND s.is_public=1 AND p.status='visible'`
  ).bind(mediaId).first();
  if (!file) return noLeak(404);
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).origin + `/api/public-media/${encodeURIComponent(mediaId)}`);
  const cached = await cache.match(cacheKey);
  if (cached) {
    const response = new Response(request.method === 'HEAD' ? null : cached.body, {
      status: cached.status,
      headers: new Headers(cached.headers)
    });
    response.headers.set('x-media-cache', 'HIT');
    return response;
  }
  const object = await env.UPLOADS.get(file.objectKey);
  if (!object) return noLeak(404);
  if (request.headers.get('if-none-match') === object.httpEtag) {
    return new Response(null, { status: 304, headers: { etag: object.httpEtag, 'cache-control': 'public, max-age=31536000, immutable' } });
  }
  const response = new Response(request.method === 'HEAD' ? null : object.body, {
    headers: {
      ...mediaHeaders(object, file.mimeType, 'public, max-age=31536000, immutable'),
      'cdn-cache-control': 'public, max-age=31536000',
      'x-media-cache': 'MISS'
    }
  });
  if (request.method === 'GET') ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
};

const legacyMedia = async (request, env, ctx, mediaId) => {
  const visible = await env.DB.prepare(
    `SELECT 1 FROM media_objects m
       JOIN task_submission_images i ON i.id=m.id
       JOIN task_submissions s ON s.id=i.submission_id
       JOIN plaza_posts p ON p.submission_id=s.id
      WHERE m.id=?1 AND m.visibility='public' AND s.is_public=1 AND p.status='visible'`
  ).bind(mediaId).first();
  return visible ? publicMedia(request, env, ctx, mediaId) : noLeak(404);
};

const cleanupOrphanMedia = async (request, env) => {
  const auth = await requireUser(request, env, true);
  if (auth.error) return auth.error;
  const body = await readJson(request, 8 * 1024);
  const hours = Math.min(168, Math.max(1, Number(body.olderThanHours || 24)));
  const limit = Math.min(100, Math.max(1, Number(body.limit || 50)));
  const before = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const prefix = `media/${env.ENVIRONMENT || 'test'}/`;
  const { results } = await env.DB.prepare(
    `SELECT i.id,i.object_key AS objectKey,i.status,m.id AS mediaId
       FROM media_upload_intents i
       LEFT JOIN media_objects m ON m.id=i.id AND m.business_id IS NULL
      WHERE i.object_key LIKE ?1
        AND i.updated_at<?2
        AND (i.status IN ('pending','expired','rejected')
          OR (i.status='confirmed' AND m.id IS NOT NULL))
      ORDER BY i.updated_at LIMIT ?3`
  ).bind(`${prefix}%`, before, limit).all();
  if (body.dryRun !== false) {
    return json({ dryRun: true, count: results.length, ids: results.map((item) => item.id) });
  }
  for (const item of results) await env.UPLOADS.delete(item.objectKey);
  const statements = [];
  for (const item of results) {
    if (item.mediaId) statements.push(env.DB.prepare('DELETE FROM media_objects WHERE id=?1').bind(item.mediaId));
    statements.push(env.DB.prepare(
      "UPDATE media_upload_intents SET status='deleted',updated_at=?1 WHERE id=?2"
    ).bind(nowIso(), item.id));
  }
  if (statements.length) await env.DB.batch(statements);
  return json({ dryRun: false, deleted: results.length });
};

export const handleMediaRoutes = async (request, env, ctx, url) => {
  if (url.pathname === '/__load/member-checkin-fast/inventory' && request.method === 'GET') {
    return memberFastLoadInventory(request, env, url);
  }
  if (url.pathname === '/__load/member-checkin-fast/cleanup' && request.method === 'POST') {
    return memberFastLoadCleanup(request, env, url);
  }
  if (url.pathname === '/api/admin/media/cleanup' && request.method === 'POST') {
    return cleanupOrphanMedia(request, env);
  }
  if (url.pathname === '/api/media/upload-intents' && request.method === 'POST') {
    return createUploadIntent(request, env);
  }
  if (url.pathname === '/api/media/member-checkin-fast' && request.method === 'POST') {
    return retryD1Overload(() => memberFastUpload(request.clone(), env), {
      maxAttempts: 5,
      baseDelayMs: 500,
      maxDelayMs: 8_000
    });
  }
  if (url.pathname === '/api/media/upload-pairs/confirm' && request.method === 'POST') {
    return confirmUploadPair(request, env);
  }
  if (url.pathname === '/api/media/upload-pairs/direct' && request.method === 'POST') {
    return directUploadPair(request, env);
  }
  const confirm = url.pathname.match(/^\/api\/media\/upload-intents\/([^/]+)\/confirm$/);
  if (confirm && request.method === 'POST') return confirmUpload(request, env, decodeURIComponent(confirm[1]));
  const publicMatch = url.pathname.match(/^\/api\/public-media\/([^/]+)$/);
  if (publicMatch && ['GET', 'HEAD'].includes(request.method)) {
    return publicMedia(request, env, ctx, decodeURIComponent(publicMatch[1]));
  }
  const privateMatch = url.pathname.match(/^\/api\/private-media\/([^/]+)$/);
  if (privateMatch && ['GET', 'HEAD'].includes(request.method)) {
    return privateMedia(request, env, url, decodeURIComponent(privateMatch[1]));
  }
  const legacy = url.pathname.match(/^\/api\/media\/([^/]+)$/);
  if (legacy && ['GET', 'HEAD'].includes(request.method)) {
    return legacyMedia(request, env, ctx, decodeURIComponent(legacy[1]));
  }
  return null;
};
