/* TRACK_AWARE_ADMIN_SETTINGS_V1 */
/* APPROVED_MOBILE_EXPERIENCE_FINALIZED_V1 */
/* APPROVED_MOBILE_EXPERIENCE_BACKEND_V1 */
/* CHECKIN_WINDOW_UPLOAD_PLAZA_PAGE_V1 */
const encoder = new TextEncoder();
const requestPerformanceMetrics = new WeakMap();

export const beginRequestMetrics = (request) => {
  requestPerformanceMetrics.set(request, new Map());
};

export const recordRequestTiming = (request, name, duration) => {
  const metrics = requestPerformanceMetrics.get(request);
  const measured = Number(duration);
  if (!metrics || !/^[a-z][a-z0-9_-]*$/i.test(name) || !Number.isFinite(measured) || measured < 0) return;
  metrics.set(name, (metrics.get(name) || 0) + measured);
};

export const readRequestTimings = (request) => {
  const metrics = requestPerformanceMetrics.get(request);
  return metrics ? [...metrics.entries()] : [];
};

export const TRACKS = [
  { id: 'interaction', name: '四校区互动赛道' },
  { id: 'health', name: '自律健康赛道' }
];

export const json = (body, status = 200, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    ...extraHeaders
  }
});

export const cleanText = (value, max = 100) => String(value || '').trim().slice(0, max);
export const nowIso = () => new Date().toISOString();
export const shanghaiDate = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date);
export const shanghaiTime = (date = new Date()) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);

const makeupPermissionReady = new WeakMap();
export const ensureMakeupPermissions = (env) => {
  if (!makeupPermissionReady.has(env)) {
    makeupPermissionReady.set(env, env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS makeup_permissions (
        user_id TEXT NOT NULL,
        checkin_date TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, checkin_date)
      )`
    ).run());
  }
  return makeupPermissionReady.get(env);
};

export const hasMakeupPermission = async (env, userId, date) => {
  await ensureMakeupPermissions(env);
  const permission = await env.DB.prepare(
    'SELECT enabled FROM makeup_permissions WHERE user_id=?1 AND checkin_date=?2'
  ).bind(userId, date).first();
  return Boolean(permission?.enabled);
};

export const parseJson = (value, fallback = null) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export const readJson = async (request, maxBytes = 25 * 1024 * 1024) => {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxBytes) throw Object.assign(new Error('请求内容过大'), { status: 413 });
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw Object.assign(new Error('请求内容过大'), { status: 413 });
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw Object.assign(new Error('请求格式错误'), { status: 400 });
  }
};

const toBase64Url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

const fromBase64Url = (value) => {
  const normalized = String(value || '').replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};

const constantTimeEqual = (left, right) => {
  if (left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different |= left[index] ^ right[index];
  return different === 0;
};

export const sha256 = async (value) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const hashPassword = async (password) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100000;
  const key = await crypto.subtle.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const hash = new Uint8Array(await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt,
    iterations
  }, key, 256));
  return `pbkdf2:${iterations}:${toBase64Url(salt)}:${toBase64Url(hash)}`;
};

export const passwordMatches = async (password, stored) => {
  const value = String(stored || '');
  if (/^[a-f0-9]{64}$/i.test(value)) return value === await sha256(password);
  if (value.startsWith('sha256:')) return value.slice(7) === await sha256(password);
  const [algorithm, iterationsText, saltText, hashText] = value.split(':');
  const iterations = Number(iterationsText);
  if (algorithm !== 'pbkdf2' || !Number.isInteger(iterations)
      || iterations < 100000 || iterations > 100000) return false;
  const expected = fromBase64Url(hashText);
  const key = await crypto.subtle.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const actual = new Uint8Array(await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: fromBase64Url(saltText),
    iterations
  }, key, expected.length * 8));
  return constantTimeEqual(actual, expected);
};

const sign = async (payload, secret) => {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))));
};

export const createToken = async (user, secret) => {
  const payload = toBase64Url(encoder.encode(JSON.stringify({
    sub: user.id,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60
  })));
  return `${payload}.${await sign(payload, secret)}`;
};

export const verifySessionClaims = async (request, env) => {
  const header = request.headers.get('authorization') || '';
  const cookieToken = (request.headers.get('cookie') || '')
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith('session_token='))
    ?.slice('session_token='.length) || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : cookieToken;
  const [payload, supplied] = token.split('.');
  if (!payload || !supplied) return null;
  const expected = await sign(payload, env.SESSION_SECRET);
  if (!constantTimeEqual(encoder.encode(supplied), encoder.encode(expected))) return null;
  const decoded = parseJson(new TextDecoder().decode(fromBase64Url(payload)));
  if (!decoded?.sub || decoded.exp < Math.floor(Date.now() / 1000)) return null;
  return decoded;
};

export const authenticate = async (request, env) => {
  const decoded = await verifySessionClaims(request, env);
  if (!decoded) return null;
  const user = await env.DB.prepare(
    `SELECT id, student_id AS studentId, name, role, campus, track_id AS trackId,
            status, created_at AS createdAt
       FROM users WHERE id = ?1 LIMIT 1`
  ).bind(decoded.sub).first();
  return user?.status === 'active' ? user : null;
};

export const requireUser = async (request, env, admin = false) => {
  const startedAt = performance.now();
  try {
    const user = await authenticate(request, env);
    if (!user) return { error: json({ error: '请先登录或会话已过期' }, 401) };
    if (admin && user.role !== 'admin') return { error: json({ error: '需要管理员权限' }, 403) };
    return { user };
  } finally {
    recordRequestTiming(request, 'auth', performance.now() - startedAt);
  }
};

export const readConfig = async (env) => {
  const { results } = await env.DB.prepare('SELECT key, value_json AS valueJson FROM app_config').all();
  const values = Object.fromEntries(results.map((item) => [item.key, parseJson(item.valueJson)]));
  const checkinSettings = values.checkinSettings || {};
  const checkinSettingsConfigured = Object.prototype.hasOwnProperty.call(values, 'checkinSettings');
  const healthCheckinSettings = values.healthCheckinSettings || {};
  return {
    activityName: values.activityName || '庆福建农林大学金山学院建院20周年-设计学院',
    startDate: values.startDate || '',
    endDate: values.endDate || '',
    slots: values.slots || [
      { id: 'breakfast', label: '早餐', start: '06:50', end: '10:00' },
      { id: 'lunch', label: '午餐', start: '10:30', end: '14:00' },
      { id: 'dinner', label: '晚餐', start: '16:30', end: '19:30' }
    ],
    activityEnabled: Boolean(values.activityEnabled),
    trackEnabled: values.trackEnabled || { interaction: false, health: false },
    maxTeams: Number(values.maxTeams || 50),
    allowSelfJoin: Boolean(values.allowSelfJoin),
    checkinSettingsConfigured,
    checkinSettings: {
      configured: Boolean(values.checkinSettings),
      enabled: checkinSettings.enabled !== false && values.trackEnabled?.interaction !== false,
      activeStartDate: checkinSettings.activeStartDate || values.startDate || '',
      activeEndDate: checkinSettings.activeEndDate || values.endDate || '',
      dailyStart: checkinSettings.dailyStart || '00:00',
      dailyEnd: checkinSettings.dailyEnd || '23:59',
      weekdays: Array.isArray(checkinSettings.weekdays) && checkinSettings.weekdays.length
        ? checkinSettings.weekdays.map(Number).filter((day) => day >= 1 && day <= 7)
        : [1, 2, 3, 4, 5, 6, 7],
      personalImageLimit: Math.min(8, Math.max(1, Number(checkinSettings.personalImageLimit || 3))),
      teamImageLimit: Math.min(8, Math.max(1, Number(checkinSettings.teamImageLimit || 3)))
    },
    healthCheckinSettings: {
      enabled: healthCheckinSettings.enabled !== false && values.trackEnabled?.health !== false,
      activeStartDate: healthCheckinSettings.activeStartDate || values.startDate || '',
      activeEndDate: healthCheckinSettings.activeEndDate || values.endDate || '',
      weekdays: Array.isArray(healthCheckinSettings.weekdays) && healthCheckinSettings.weekdays.length
        ? healthCheckinSettings.weekdays.map(Number).filter((day) => day >= 1 && day <= 7)
        : [1, 2, 3, 4, 5, 6, 7],
      personalImageLimit: Math.min(8, Math.max(1, Number(healthCheckinSettings.personalImageLimit || 3))),
      slots: Array.isArray(healthCheckinSettings.slots) && healthCheckinSettings.slots.length
        ? healthCheckinSettings.slots
        : (values.slots || [
          { id: 'breakfast', label: '早餐', start: '06:50', end: '10:00' },
          { id: 'lunch', label: '午餐', start: '10:30', end: '14:00' },
          { id: 'dinner', label: '晚餐', start: '16:30', end: '19:30' }
        ])
    },
    environment: env.ENVIRONMENT || 'unknown'
  };
};

export const putConfig = (env, key, value) => env.DB.prepare(
  `INSERT INTO app_config (key, value_json, updated_at) VALUES (?1, ?2, ?3)
   ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
).bind(key, JSON.stringify(value), nowIso());

export const decodeImage = (dataUrl, maxBytes = 5 * 1024 * 1024) => {
  const match = String(dataUrl || '').match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw Object.assign(new Error('图片仅支持 JPG、PNG、WebP 格式'), { status: 415 });
  const binary = atob(match[2].replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (!bytes.length || bytes.length > maxBytes) {
    throw Object.assign(new Error('单张图片不能超过 5MB'), { status: 413 });
  }
  const valid = match[1] === 'png'
    ? [...bytes.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('') === '89504e470d0a1a0a'
    : match[1] === 'jpeg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF'
        && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
  if (!valid) throw Object.assign(new Error('图片内容与格式不一致'), { status: 415 });
  return {
    bytes,
    contentType: `image/${match[1]}`,
    extension: match[1] === 'jpeg' ? 'jpg' : match[1]
  };
};

export const uploadImages = async (env, dataUrls, prefix, limit) => {
  if (!Array.isArray(dataUrls) || !dataUrls.length || dataUrls.length > limit) {
    throw Object.assign(new Error(`图片数量必须为 1–${limit} 张`), { status: 400 });
  }
  const uploaded = [];
  try {
    for (let index = 0; index < dataUrls.length; index += 1) {
      const image = decodeImage(dataUrls[index]);
      const id = crypto.randomUUID();
      const key = `${prefix}/${id}.${image.extension}`;
      await env.UPLOADS.put(key, image.bytes, {
        httpMetadata: { contentType: image.contentType },
        customMetadata: { private: 'true' }
      });
      uploaded.push({ id, key, contentType: image.contentType, bytes: image.bytes.length, sortOrder: index });
    }
    return uploaded;
  } catch (error) {
    await Promise.all(uploaded.map((item) => env.UPLOADS.delete(item.key)));
    throw error;
  }
};

export const claimConfirmedMedia = async (
  env,
  mediaIds,
  user,
  taskId,
  businessType,
  limit,
  options = {}
) => {
  if (!Array.isArray(mediaIds) || !mediaIds.length || mediaIds.length > limit) {
    throw Object.assign(new Error(`图片数量必须为 1–${limit} 张`), { status: 400 });
  }
  const uniqueIds = [...new Set(mediaIds.map((value) => cleanText(value, 80)).filter(Boolean))];
  if (uniqueIds.length !== mediaIds.length) {
    throw Object.assign(new Error('图片列表包含重复或无效项目'), { status: 400 });
  }
  const placeholders = uniqueIds.map((_, index) => `?${index + 4}`).join(',');
  const { results: mediaRows } = await env.DB.prepare(
    `SELECT m.id,m.object_key AS objectKey,m.mime_type AS contentType,m.file_size AS bytes,
            m.width,m.height,m.business_id AS businessId,i.status AS intentStatus
       FROM media_objects m JOIN media_upload_intents i ON i.id=m.id
      WHERE m.owner_user_id=?1 AND COALESCE(m.task_id,'')=COALESCE(?2,'')
        AND m.business_type=?3 AND m.id IN (${placeholders})`
  ).bind(user.id, taskId || null, businessType, ...uniqueIds).all();
  const mediaById = new Map(mediaRows.map((media) => [media.id, media]));
  const orderedMedia = uniqueIds.map((id) => {
    const media = mediaById.get(id);
    if (!media || media.intentStatus !== 'confirmed' || media.businessId != null) {
      throw Object.assign(new Error('图片不存在、无权使用或已被其他提交占用'), { status: 403 });
    }
    return media;
  });
  if (options.loadThumb === false) {
    return orderedMedia.map((media, sortOrder) => ({ ...media, thumb: null, sortOrder }));
  }
  const thumbPlaceholders = uniqueIds.map((_, index) => `?${index + 4}`).join(',');
  const { results: thumbRows } = await env.DB.prepare(
    `SELECT id,object_key AS objectKey,mime_type AS contentType,file_size AS bytes,
            width,height,etag,business_id AS businessId
       FROM media_objects
      WHERE owner_user_id=?1 AND COALESCE(task_id,'')=COALESCE(?2,'')
        AND business_type=?3 AND business_id IN (${thumbPlaceholders})`
  ).bind(user.id, taskId || null, `${businessType}:thumb`, ...uniqueIds).all();
  const thumbByParent = new Map(thumbRows.map((thumb) => [thumb.businessId, thumb]));
  return orderedMedia.map((media, sortOrder) => ({
    ...media,
    thumb: thumbByParent.get(media.id) || null,
    sortOrder
  }));
};

export const audit = (env, actor, action, entityType, entityId = null, metadata = {}) =>
  env.DB.prepare(
    `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(crypto.randomUUID(), actor.id, action, entityType, entityId, JSON.stringify(metadata), nowIso());

export const errorResponse = (error) => {
  console.error(JSON.stringify({ level: 'error', message: error?.message, stack: error?.stack }));
  return json({ error: error?.message || '请求失败' }, Number(error?.status || error?.statusCode || 500));
};
