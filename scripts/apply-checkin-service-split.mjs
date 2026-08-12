import fs from 'node:fs';
import path from 'node:path';

await import('./apply-plaza-service-split.mjs');

const routePath = path.resolve('cloudflare/routes/student.js');
const workerPath = path.resolve('cloudflare/worker.js');
const routeMarker = '/* CHECKIN_SERVICE_ROUTE_V1 */';
const workerMarker = '/* CHECKIN_SERVICE_BINDING_V1 */';

const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

let route = fs.readFileSync(routePath, 'utf8');
if (!route.includes(routeMarker)) {
  route = replaceOnce(
    route,
    "import { createPrivateMediaUrl } from '../lib/media-signing.js';",
    `import { createPrivateMediaUrl } from '../lib/media-signing.js';\n\n${routeMarker}`,
    '打卡路由导入位置'
  );
  route = replaceOnce(
    route,
    'export const handleStudentRoutes = async (request, env, ctx, url) => {',
    'export const handleStudentRoutes = async (request, env, ctx, url, authenticatedUser = null) => {',
    '学生路由函数签名'
  );
  route = replaceOnce(
    route,
    /  const auth = await requireUser\(request, env\);\r?\n  if \(auth\.error\) return auth\.error;\r?\n  const user = auth\.user;/,
    `  const auth = authenticatedUser ? { user: authenticatedUser } : await requireUser(request, env);\n  if (auth.error) return auth.error;\n  const user = auth.user;`,
    '学生路由认证链路'
  );
  fs.writeFileSync(routePath, route, 'utf8');
}

const workerHelpers = [
  workerMarker,
  "const CHECKIN_USER_HEADER = 'x-jinshan-checkin-user';",
  "const CHECKIN_SERVICE_HEADER = 'x-jinshan-internal-service';",
  "const CHECKIN_PROOF_CHALLENGE_HEADER = 'x-jinshan-checkin-proof-challenge';",
  "const CHECKIN_PROOF_HEADER = 'x-jinshan-checkin-proof';",
  "const CHECKIN_HEALTH_PATH = '/api/checkin-service-health';",
  'const isCheckinServiceRoute = (pathname) => pathname === CHECKIN_HEALTH_PATH',
  "  || pathname === '/api/checkins'",
  "  || pathname === '/api/checkins/history'",
  "  || /^\\/api\\/tasks\\/[^/]+\\/member-checkin$/.test(pathname);",
  'const checkinInternalUser = (user) => encodeURIComponent(JSON.stringify({',
  '  id: user.id,',
  '  role: user.role,',
  '  trackId: user.trackId,',
  '  status: user.status',
  '}));',
  'const normalizedCheckinHealthResponse = async (response) => {',
  '  const headers = new Headers(response.headers);',
  "  headers.set('content-type', 'application/json; charset=utf-8');",
  "  headers.delete('content-length');",
  '  let body = {};',
  '  try { body = await response.json(); } catch {}',
  '  delete body.mediaSigningProof;',
  '  const ready = Boolean(response.ok && body.ok && body.mediaSigningAligned === true);',
  '  return new Response(JSON.stringify({ ...body, ok: ready, mediaSigningAligned: ready }), {',
  '    status: ready ? 200 : 503,',
  '    headers',
  '  });',
  '};',
  'const isSafeCheckinLocalFallback = async (response) => {',
  "  if (response.headers.get('x-jinshan-checkin-alignment') === 'failed') return true;",
  '  if (response.status !== 503) return false;',
  '  try {',
  '    const body = await response.clone().json();',
  "    return body?.error === '打卡服务媒体签名尚未对齐'",
  "      || body?.error === '打卡服务尚未完成媒体签名配置';",
  '  } catch {',
  '    return false;',
  '  }',
  '};',
  'const dispatchCheckinService = async (request, env, ctx, url) => {',
  '  if (!env.CHECKIN_SERVICE || !isCheckinServiceRoute(url.pathname)) return null;',
  '  const isHealth = url.pathname === CHECKIN_HEALTH_PATH && request.method === \'GET\';',
  '  let user = null;',
  '  if (!isHealth) {',
  '    const auth = await requireUser(request, env);',
  '    if (auth.error) return auth.error;',
  '    user = auth.user;',
  '  }',
  '  const headers = new Headers(request.headers);',
  '  headers.delete(CHECKIN_USER_HEADER);',
  '  headers.delete(CHECKIN_SERVICE_HEADER);',
  '  headers.delete(CHECKIN_PROOF_CHALLENGE_HEADER);',
  '  headers.delete(CHECKIN_PROOF_HEADER);',
  "  headers.set(CHECKIN_SERVICE_HEADER, 'checkin-v1');",
  '  let challenge;',
  '  let proof;',
  '  try {',
  '    challenge = crypto.randomUUID();',
  '    proof = await createMediaSigningAlignmentProof(env, challenge);',
  '  } catch {',
  '    return null;',
  '  }',
  '  headers.set(CHECKIN_PROOF_CHALLENGE_HEADER, challenge);',
  '  headers.set(CHECKIN_PROOF_HEADER, proof);',
  '  if (user) headers.set(CHECKIN_USER_HEADER, checkinInternalUser(user));',
  '  const serviceRequest = new Request(request.clone(), { headers });',
  '  try {',
  '    const response = await env.CHECKIN_SERVICE.fetch(serviceRequest);',
  '    if (isHealth) return await normalizedCheckinHealthResponse(response);',
  '    if (await isSafeCheckinLocalFallback(response)) return null;',
  '    return response;',
  '  } catch {',
  "    if (request.method === 'GET' || request.method === 'HEAD') return null;",
  "    return json({ error: '打卡服务暂时不可用，请稍后重试' }, 503, {",
  "      'x-jinshan-service-error': 'checkin-binding'",
  '    });',
  '  }',
  '};',
  ''
].join('\n');

let worker = fs.readFileSync(workerPath, 'utf8');
const newSigningImport = "import { createMediaSigningAlignmentProof } from './lib/media-signing.js';";
const oldSigningImport = "import { verifyMediaSigningAlignmentProof } from './lib/media-signing.js';";
if (worker.includes(oldSigningImport)) {
  worker = worker.replace(oldSigningImport, newSigningImport);
} else if (!worker.includes(newSigningImport)) {
  worker = replaceOnce(
    worker,
    "import { handleStudentRoutes } from './routes/student.js';",
    `${newSigningImport}\nimport { handleStudentRoutes } from './routes/student.js';`,
    '主Worker媒体签名证明导入位置'
  );
}

if (worker.includes(workerMarker)) {
  const blockStart = worker.indexOf(workerMarker);
  const blockEnd = worker.indexOf('const routeRequest = async (request, env, ctx) => {', blockStart);
  if (blockStart < 0 || blockEnd < 0) throw new Error('未找到现有打卡服务块边界');
  worker = `${worker.slice(0, blockStart)}${workerHelpers}${worker.slice(blockEnd)}`;
} else {
  worker = replaceOnce(
    worker,
    'const routeRequest = async (request, env, ctx) => {',
    `${workerHelpers}const routeRequest = async (request, env, ctx) => {`,
    '主Worker路由函数位置'
  );
  worker = replaceOnce(
    worker,
    `      const student = await handleStudentRoutes(request, env, ctx, url);`,
    `      const checkinService = await dispatchCheckinService(request, env, ctx, url);\n      if (checkinService) return checkinService;\n\n      const student = await handleStudentRoutes(request, env, ctx, url);`,
    '打卡服务转发位置'
  );
}
fs.writeFileSync(workerPath, worker, 'utf8');

route = fs.readFileSync(routePath, 'utf8');
worker = fs.readFileSync(workerPath, 'utf8');
if (!route.includes(routeMarker)
    || !route.includes('authenticatedUser = null')
    || !worker.includes(workerMarker)
    || !worker.includes('createMediaSigningAlignmentProof')
    || !worker.includes("CHECKIN_HEALTH_PATH = '/api/checkin-service-health'")
    || !worker.includes('CHECKIN_PROOF_HEADER')
    || !worker.includes('isSafeCheckinLocalFallback')
    || !worker.includes('env.CHECKIN_SERVICE.fetch(serviceRequest)')
    || !worker.includes("request.method === 'GET' || request.method === 'HEAD'")) {
  throw new Error('打卡独立服务生成不完整');
}

await import('./apply-checkin-window-upload-plaza-page-v1.mjs');
await import('./finalize-checkin-settings-v1.mjs');

console.log('Applied check-in service binding with safe local fallback, per-request signing proof and authoritative live check-in settings.');
