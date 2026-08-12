import {
  beginRequestMetrics,
  cleanText,
  createToken,
  errorResponse,
  json,
  passwordMatches,
  readConfig,
  readJson,
  readRequestTimings,
  recordRequestTiming,
  requireUser,
  sha256,
  shanghaiDate,
  shanghaiTime,
  TRACKS
} from './lib/runtime.js';
import { createMediaSigningAlignmentProof } from './lib/media-signing.js';
import { handleStudentRoutes } from './routes/student.js';
import { handlePlazaRoutes } from './routes/plaza.js';
import { buildLoginPlazaFirstPage } from './services/plaza-first-page.js';
import { handleAdminRoutes } from './routes/admin.js';
import { canAccessMaterialFile, handleMaterialRoutes } from './routes/materials.js';
import { handleMediaRoutes } from './routes/media.js';
import { buildStudentDashboard, buildStudentDashboardForLogin } from './services/student-dashboard.js';

const login = async (request, env) => {
  const body = await readJson(request, 16 * 1024);
  const studentId = cleanText(body.studentId, 40);
  const password = String(body.password || '').slice(0, 128);
  if (!studentId || !password) return json({ error: '请输入学号和密码' }, 400);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const identity = await sha256(`${ip}:${studentId}`);
  const lookupStartedAt = performance.now();
  const [attempt, user] = await Promise.all([
    env.DB.prepare(
      `SELECT attempt_count AS attemptCount,window_started_at AS windowStartedAt,
              blocked_until AS blockedUntil
         FROM login_attempts WHERE identity_hash=?1 LIMIT 1`
    ).bind(identity).first(),
    env.DB.prepare(
      `SELECT id,student_id AS studentId,name,password_hash AS passwordHash,role,campus,
              track_id AS trackId,status,created_at AS createdAt
         FROM users WHERE student_id=?1 LIMIT 1`
    ).bind(studentId).first()
  ]);
  recordRequestTiming(request, 'login_lookup', performance.now() - lookupStartedAt);
  const now = Date.now();
  if (attempt?.blockedUntil && Date.parse(attempt.blockedUntil) > now) {
    return json({ error: '登录尝试过多，请稍后再试' }, 429);
  }
  const passwordStartedAt = performance.now();
  const passwordAccepted = Boolean(user && user.status === 'active'
    && await passwordMatches(password, user.passwordHash));
  recordRequestTiming(request, 'login_password', performance.now() - passwordStartedAt);
  if (!passwordAccepted) {
    const inWindow = attempt && now - Date.parse(attempt.windowStartedAt) < 15 * 60 * 1000;
    const count = inWindow ? Number(attempt.attemptCount) + 1 : 1;
    const blockedUntil = count >= 10 ? new Date(now + 15 * 60 * 1000).toISOString() : null;
    await env.DB.prepare(
      `INSERT INTO login_attempts (identity_hash,attempt_count,window_started_at,blocked_until)
       VALUES (?1,?2,?3,?4) ON CONFLICT(identity_hash) DO UPDATE SET
        attempt_count=excluded.attempt_count,window_started_at=excluded.window_started_at,
        blocked_until=excluded.blocked_until`
    ).bind(identity, count, inWindow ? attempt.windowStartedAt : new Date().toISOString(), blockedUntil).run();
    return json({ error: '学号或密码不正确' }, 401);
  }
  if (attempt) {
    const cleanupStartedAt = performance.now();
    await env.DB.prepare('DELETE FROM login_attempts WHERE identity_hash=?1').bind(identity).run();
    recordRequestTiming(request, 'login_cleanup', performance.now() - cleanupStartedAt);
  }
  delete user.passwordHash;
  /* LOGIN_BOOTSTRAP_HANDOFF_V2 */
  const loginUser = {
    id: user.id,
    studentId: user.studentId,
    name: user.name,
    role: user.role,
    trackId: user.trackId,
    status: user.status
  };
  /* LOGIN_D1_BATCH_V6 */
  const tokenPromise = (async () => {
    const startedAt = performance.now();
    try {
      return await createToken(user, env.SESSION_SECRET);
    } finally {
      recordRequestTiming(request, 'login_session', performance.now() - startedAt);
    }
  })();
  const dashboardPromise = user.role === 'student'
    ? (async () => {
      const startedAt = performance.now();
      try {
        return await buildStudentDashboardForLogin(env, user);
      } catch {
        return null;
      } finally {
        recordRequestTiming(request, 'login_dashboard', performance.now() - startedAt);
      }
    })()
    : Promise.resolve(null);
  /* LOGIN_PLAZA_HANDOFF_V1 */
  const plazaPromise = user.role === 'student'
    ? (async () => {
      const startedAt = performance.now();
      try {
        return await buildLoginPlazaFirstPage(env, user.id);
      } catch {
        return null;
      } finally {
        recordRequestTiming(request, 'login_plaza', performance.now() - startedAt);
      }
    })()
    : Promise.resolve(null);
  const [token, dashboard, plaza] = await Promise.all([
    tokenPromise,
    dashboardPromise,
    plazaPromise
  ]);
  const bootstrap = dashboard ? {
    ok: true,
    user: {
      id: user.id,
      studentId: user.studentId,
      name: user.name,
      role: user.role,
      campus: user.campus,
      trackId: user.trackId,
      status: user.status,
      createdAt: user.createdAt
    },
    config: dashboard.config,
    tracks: TRACKS,
    date: dashboard.date || shanghaiDate(),
    time: dashboard.time || shanghaiTime(),
    dashboard,
    plaza
  } : null;
  const serializeStartedAt = performance.now();
  const response = json({
    token,
    user: loginUser,
    bootstrap
  }, 200, {
    'set-cookie': `session_token=${token}; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax`
  });
  recordRequestTiming(request, 'login_serialize', performance.now() - serializeStartedAt);
  return response;
};

const fileResponse = async (request, env, id) => {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;
  const user = auth.user;
  const d1StartedAt = performance.now();

  const checkin = await env.DB.prepare(
    `SELECT f.object_key AS objectKey,f.content_type AS contentType,c.user_id AS ownerId
       FROM checkin_files f JOIN checkins c ON c.id=f.checkin_id WHERE f.id=?1`
  ).bind(id).first();
  let file = checkin && (user.role === 'admin' || checkin.ownerId === user.id) ? checkin : null;

  if (!file) {
    const taskImage = await env.DB.prepare(
      `SELECT i.object_key AS objectKey,i.content_type AS contentType,s.owner_type AS ownerType,
              s.owner_id AS ownerId,s.is_public AS isPublic,p.status AS postStatus
         FROM task_submission_images i
         JOIN task_submissions s ON s.id=i.submission_id
         LEFT JOIN plaza_posts p ON p.submission_id=s.id
        WHERE i.id=?1`
    ).bind(id).first();
    if (taskImage) {
      const teamMember = taskImage.ownerType === 'team' ? await env.DB.prepare(
        'SELECT 1 FROM team_members WHERE team_id=?1 AND user_id=?2'
      ).bind(taskImage.ownerId, user.id).first() : null;
      if (user.role === 'admin' || taskImage.ownerId === user.id || teamMember
          || (taskImage.isPublic && taskImage.postStatus === 'visible')) file = taskImage;
    }
  }

  if (!file) {
    const memberImage = await env.DB.prepare(
      `SELECT object_key AS objectKey,content_type AS contentType,user_id AS ownerId,team_id AS teamId
         FROM member_checkins WHERE id=?1`
    ).bind(id).first();
    if (memberImage) {
      const member = await env.DB.prepare(
        'SELECT 1 FROM team_members WHERE team_id=?1 AND user_id=?2'
      ).bind(memberImage.teamId, user.id).first();
      if (user.role === 'admin' || memberImage.ownerId === user.id || member) file = memberImage;
    }
  }

  recordRequestTiming(request, 'd1', performance.now() - d1StartedAt);
  if (!file) return json({ error: '文件不存在或无权访问' }, 403);
  const r2StartedAt = performance.now();
  const object = await env.UPLOADS.get(file.objectKey);
  recordRequestTiming(request, 'r2', performance.now() - r2StartedAt);
  if (!object) return json({ error: '文件不存在' }, 404);
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType || file.contentType || 'application/octet-stream',
      'content-length': String(object.size),
      etag: object.httpEtag,
      'cache-control': 'private, max-age=86400, immutable',
      'content-security-policy': "default-src 'none'",
      'x-content-type-options': 'nosniff'
    }
  });
};

const publicImageResponse = async (request, env, ctx, url, id) => {
  const variant = url.searchParams.get('variant') === 'thumb' ? 'thumb' : 'display';
  const version = url.searchParams.get('v') || '';
  const cacheControl = version
    ? 'public, max-age=31536000, s-maxage=31536000, immutable'
    : 'public, max-age=86400, s-maxage=86400';
  const cache = caches.default;
  const cacheUrl = new URL(`/api/public-images/${encodeURIComponent(id)}`, url.origin);
  cacheUrl.searchParams.set('variant', variant);
  if (version) cacheUrl.searchParams.set('v', version);
  const cacheKey = new Request(cacheUrl, { method: 'GET' });
  const d1Started = performance.now();
  const file = await env.DB.prepare(
    `SELECT COALESCE(v.object_key,d.object_key,i.object_key) AS objectKey,
             COALESCE(v.content_type,d.content_type,i.content_type) AS contentType
       FROM task_submission_images i
       JOIN task_submissions s ON s.id=i.submission_id
       JOIN plaza_posts p ON p.submission_id=s.id
       LEFT JOIN image_variants v ON v.source_type='task_submission_image'
         AND v.source_id=i.id AND v.variant=?2
       LEFT JOIN image_variants d ON d.source_type='task_submission_image'
         AND d.source_id=i.id AND d.variant='display'
      WHERE i.id=?1 AND s.is_public=1 AND p.status='visible' LIMIT 1`
  ).bind(id, variant).first();
  const d1Duration = performance.now() - d1Started;
  recordRequestTiming(request, 'd1', d1Duration);
  if (!file) {
    return json({ error: '图片不存在' }, 404, {
      'cache-control': 'no-store',
      'x-image-cache': 'MISS',
      'server-timing': `d1;dur=${d1Duration.toFixed(1)}`
    });
  }
  const cached = await cache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('x-image-cache', 'HIT');
    headers.set('server-timing', `d1;dur=${d1Duration.toFixed(1)}, cache;desc="HIT";dur=0`);
    return new Response(request.method === 'HEAD' ? null : cached.body, {
      status: cached.status,
      headers
    });
  }
  const r2Started = performance.now();
  const object = await env.UPLOADS.get(file.objectKey);
  const r2Duration = performance.now() - r2Started;
  recordRequestTiming(request, 'r2', r2Duration);
  if (!object) {
    return json({ error: '图片文件不存在' }, 404, {
      'cache-control': 'no-store',
      'x-image-cache': 'MISS',
      'server-timing': `d1;dur=${d1Duration.toFixed(1)}, r2;dur=${r2Duration.toFixed(1)}`
    });
  }
  const headers = {
    'content-type': object.httpMetadata?.contentType || file.contentType || 'image/webp',
    'content-length': String(object.size),
    etag: object.httpEtag,
    'content-disposition': 'inline',
    'cache-control': cacheControl,
    'cdn-cache-control': cacheControl,
    'content-security-policy': "default-src 'none'",
    'x-content-type-options': 'nosniff',
    'x-image-cache': 'MISS',
    'server-timing': `d1;dur=${d1Duration.toFixed(1)}, r2;dur=${r2Duration.toFixed(1)}`
  };
  if (request.headers.get('if-none-match') === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  const response = new Response(request.method === 'HEAD' ? null : object.body, { headers });
  if (request.method === 'GET') ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
};

const materialFileResponse = async (request, env, id) => {
  const auth = await requireUser(request, env);
  if (auth.error) return auth.error;
  const d1StartedAt = performance.now();
  const file = await canAccessMaterialFile(env, id, auth.user);
  recordRequestTiming(request, 'd1', performance.now() - d1StartedAt);
  if (!file) return json({ error: '文件不存在或无权访问' }, 403);
  const r2StartedAt = performance.now();
  const object = await env.UPLOADS.get(file.objectKey);
  recordRequestTiming(request, 'r2', performance.now() - r2StartedAt);
  if (!object) return json({ error: '文件不存在' }, 404);
  const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`;
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType || file.contentType,
      'content-length': String(object.size),
      'content-disposition': disposition,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff'
    }
  });
};

/* PLAZA_SERVICE_BINDING_V1 */
const PLAZA_USER_HEADER = 'x-jinshan-plaza-user';
const PLAZA_SERVICE_HEADER = 'x-jinshan-internal-service';
const isPlazaServiceRoute = (pathname) => pathname === '/api/rankings'
  || pathname === '/api/plaza'
  || pathname === '/api/inbox'
  || pathname === '/api/admin/comments'
  || /^\/api\/plaza\/[^/]+(?:\/(?:view|like|comments))?$/.test(pathname)
  || /^\/api\/plaza\/[^/]+\/comments\/[^/]+$/.test(pathname)
  || /^\/api\/admin\/comments\/[^/]+$/.test(pathname);
const plazaInternalUser = (user) => encodeURIComponent(JSON.stringify({
  id: user.id,
  role: user.role,
  trackId: user.trackId,
  status: user.status
}));
const dispatchPlazaService = async (request, env, ctx, url) => {
  if (!env.PLAZA_SERVICE || !isPlazaServiceRoute(url.pathname)) return null;
  let user = null;
  if (url.pathname !== '/api/rankings') {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    user = auth.user;
  }
  const headers = new Headers(request.headers);
  headers.delete(PLAZA_USER_HEADER);
  headers.delete(PLAZA_SERVICE_HEADER);
  headers.set(PLAZA_SERVICE_HEADER, 'plaza-v1');
  if (user) headers.set(PLAZA_USER_HEADER, plazaInternalUser(user));
  const serviceRequest = new Request(request.clone(), { headers });
  try {
    return await env.PLAZA_SERVICE.fetch(serviceRequest);
  } catch (error) {
    if (request.method === 'GET' || request.method === 'HEAD') return null;
    return json({ error: '活动广场服务暂时不可用，请稍后重试' }, 503, {
      'x-jinshan-service-error': 'plaza-binding'
    });
  }
};
/* CHECKIN_SERVICE_BINDING_V1 */
const CHECKIN_USER_HEADER = 'x-jinshan-checkin-user';
const CHECKIN_SERVICE_HEADER = 'x-jinshan-internal-service';
const CHECKIN_PROOF_CHALLENGE_HEADER = 'x-jinshan-checkin-proof-challenge';
const CHECKIN_PROOF_HEADER = 'x-jinshan-checkin-proof';
const CHECKIN_HEALTH_PATH = '/api/checkin-service-health';
const isCheckinServiceRoute = (pathname) => pathname === CHECKIN_HEALTH_PATH
  || pathname === '/api/checkins'
  || pathname === '/api/checkins/history'
  || /^\/api\/tasks\/[^/]+\/member-checkin$/.test(pathname);
const checkinInternalUser = (user) => encodeURIComponent(JSON.stringify({
  id: user.id,
  role: user.role,
  trackId: user.trackId,
  status: user.status
}));
const normalizedCheckinHealthResponse = async (response) => {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.delete('content-length');
  let body = {};
  try { body = await response.json(); } catch {}
  delete body.mediaSigningProof;
  const ready = Boolean(response.ok && body.ok && body.mediaSigningAligned === true);
  return new Response(JSON.stringify({ ...body, ok: ready, mediaSigningAligned: ready }), {
    status: ready ? 200 : 503,
    headers
  });
};
const isSafeCheckinLocalFallback = async (response) => {
  if (response.headers.get('x-jinshan-checkin-alignment') === 'failed') return true;
  if (response.status !== 503) return false;
  try {
    const body = await response.clone().json();
    return body?.error === '打卡服务媒体签名尚未对齐'
      || body?.error === '打卡服务尚未完成媒体签名配置';
  } catch {
    return false;
  }
};
const dispatchCheckinService = async (request, env, ctx, url) => {
  if (!env.CHECKIN_SERVICE || !isCheckinServiceRoute(url.pathname)) return null;
  const isHealth = url.pathname === CHECKIN_HEALTH_PATH && request.method === 'GET';
  let user = null;
  if (!isHealth) {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    user = auth.user;
  }
  const headers = new Headers(request.headers);
  headers.delete(CHECKIN_USER_HEADER);
  headers.delete(CHECKIN_SERVICE_HEADER);
  headers.delete(CHECKIN_PROOF_CHALLENGE_HEADER);
  headers.delete(CHECKIN_PROOF_HEADER);
  headers.set(CHECKIN_SERVICE_HEADER, 'checkin-v1');
  let challenge;
  let proof;
  try {
    challenge = crypto.randomUUID();
    proof = await createMediaSigningAlignmentProof(env, challenge);
  } catch {
    return null;
  }
  headers.set(CHECKIN_PROOF_CHALLENGE_HEADER, challenge);
  headers.set(CHECKIN_PROOF_HEADER, proof);
  if (user) headers.set(CHECKIN_USER_HEADER, checkinInternalUser(user));
  const serviceRequest = new Request(request.clone(), { headers });
  try {
    const response = await env.CHECKIN_SERVICE.fetch(serviceRequest);
    if (isHealth) return await normalizedCheckinHealthResponse(response);
    if (await isSafeCheckinLocalFallback(response)) return null;
    return response;
  } catch {
    if (request.method === 'GET' || request.method === 'HEAD') return null;
    return json({ error: '打卡服务暂时不可用，请稍后重试' }, 503, {
      'x-jinshan-service-error': 'checkin-binding'
    });
  }
};
const routeRequest = async (request, env, ctx) => {
  try {
      const url = new URL(request.url);
      if (url.pathname === '/health') {
        return json({
          ok: true,
          environment: env.ENVIRONMENT || 'unknown',
          project: env.PROJECT_NAME || 'unknown',
          database: Boolean(env.DB),
          storage: Boolean(env.UPLOADS),
          loadTestsEnabled: false,
          api: 'business-v1'
        });
      }
      if (url.pathname === '/api/login' && request.method === 'POST') return await login(request, env);
      if (url.pathname === '/api/session' && request.method === 'POST') {
        const auth = await requireUser(request, env);
        if (auth.error) return auth.error;
        const token = await createToken(auth.user, env.SESSION_SECRET);
        const dashboard = auth.user.role === 'student'
          ? await buildStudentDashboard(env, auth.user)
          : null;
        const config = dashboard?.config || await readConfig(env);
        return json({
          ok: true,
          user: auth.user,
          config,
          tracks: TRACKS,
          date: dashboard?.date || shanghaiDate(),
          time: dashboard?.time || shanghaiTime(),
          dashboard
        }, 200, {
          'set-cookie': `session_token=${token}; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax`
        });
      }
      if (url.pathname === '/api/logout' && request.method === 'POST') {
        return json({ ok: true }, 200, {
          'set-cookie': 'session_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'
        });
      }
      if (url.pathname === '/api/me' && request.method === 'GET') {
        const auth = await requireUser(request, env);
        if (auth.error) return auth.error;
        return json({
          user: auth.user,
          config: await readConfig(env),
          tracks: TRACKS,
          date: shanghaiDate(),
          time: shanghaiTime()
        });
      }
      const media = await handleMediaRoutes(request, env, ctx, url);
      if (media) return media;
      const fileMatch = url.pathname.match(/^\/api\/files\/([^/]+)$/);
        if (fileMatch && request.method === 'GET') return await fileResponse(request, env, decodeURIComponent(fileMatch[1]));
        const publicImageMatch = url.pathname.match(/^\/api\/public-images\/([^/]+)$/);
        if (publicImageMatch && (request.method === 'GET' || request.method === 'HEAD')) {
          return await publicImageResponse(request, env, ctx, url, decodeURIComponent(publicImageMatch[1]));
        }
      const materialFileMatch = url.pathname.match(/^\/api\/material-files\/([^/]+)$/);
      if (materialFileMatch && request.method === 'GET') {
        return await materialFileResponse(request, env, decodeURIComponent(materialFileMatch[1]));
      }

      const plazaService = await dispatchPlazaService(request, env, ctx, url);
      if (plazaService) return plazaService;

      const admin = await handleAdminRoutes(request, env, ctx, url);
      if (admin) return admin;
      const materials = await handleMaterialRoutes(request, env, ctx, url);
      if (materials) return materials;
      const plaza = await handlePlazaRoutes(request, env, ctx, url);
      if (plaza) return plaza;
      const checkinService = await dispatchCheckinService(request, env, ctx, url);
      if (checkinService) return checkinService;

      const student = await handleStudentRoutes(request, env, ctx, url);
      if (student) return student;
    return json({ error: '接口不存在' }, 404);
  } catch (error) {
    return errorResponse(error);
  }
};

const requestId = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

const withRequestTelemetry = (response, request, id, totalDuration) => {
  const headers = new Headers(response.headers);
  headers.set('x-request-id', id);
  const existingTiming = headers.get('server-timing') || '';
  const existingNames = new Set(
    existingTiming.split(',').map((entry) => entry.trim().split(';')[0]).filter(Boolean)
  );
  const additions = [...readRequestTimings(request), ['total', totalDuration]]
    .filter(([name, duration]) => !existingNames.has(name) && Number.isFinite(duration))
    .map(([name, duration]) => `${name};dur=${Number(duration).toFixed(1)}`);
  const combinedTiming = [existingTiming, ...additions].filter(Boolean).join(', ');
  if (combinedTiming) headers.set('server-timing', combinedTiming);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

export default {
  async fetch(request, env, ctx) {
    beginRequestMetrics(request);
    const startedAt = performance.now();
    const id = requestId();
    const response = await routeRequest(request, env, ctx);
    return withRequestTelemetry(response, request, id, performance.now() - startedAt);
  }
};
