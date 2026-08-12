import fs from 'node:fs';
import path from 'node:path';

const routePath = path.resolve('cloudflare/routes/plaza.js');
const workerPath = path.resolve('cloudflare/worker.js');
const routeMarker = '/* PLAZA_SERVICE_ROUTE_V1 */';
const workerMarker = '/* PLAZA_SERVICE_BINDING_V1 */';

const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

let route = fs.readFileSync(routePath, 'utf8');
if (!route.includes(routeMarker)) {
  route = replaceOnce(
    route,
    "import { json, nowIso, requireUser, shanghaiDate } from '../lib/runtime.js';",
    `import { json, nowIso, requireUser, shanghaiDate } from '../lib/runtime.js';\n\n${routeMarker}`,
    '活动广场路由导入位置'
  );
  route = replaceOnce(
    route,
    'export const handlePlazaRoutes = async (request, env, ctx, url) => {',
    'export const handlePlazaRoutes = async (request, env, ctx, url, authenticatedUser = null) => {',
    '活动广场路由函数签名'
  );
  route = replaceOnce(
    route,
    /  const auth = await requireUser\(request, env\);\r?\n  if \(auth\.error\) return auth\.error;\r?\n  const user = auth\.user;\r?\n  await ensureInteractionSchema\(env\);/,
    `  const auth = authenticatedUser ? { user: authenticatedUser } : await requireUser(request, env);\n  if (auth.error) return auth.error;\n  const user = auth.user;\n  if (env.SKIP_RUNTIME_SCHEMA !== 'true') await ensureInteractionSchema(env);`,
    '活动广场认证与运行时建表链路'
  );
  fs.writeFileSync(routePath, route, 'utf8');
}

const workerHelpers = [
  workerMarker,
  "const PLAZA_USER_HEADER = 'x-jinshan-plaza-user';",
  "const PLAZA_SERVICE_HEADER = 'x-jinshan-internal-service';",
  'const isPlazaServiceRoute = (pathname) => pathname === \'/api/rankings\'',
  "  || pathname === '/api/plaza'",
  "  || pathname === '/api/inbox'",
  "  || pathname === '/api/admin/comments'",
  "  || /^\\/api\\/plaza\\/[^/]+(?:\\/(?:view|like|comments))?$/.test(pathname)",
  "  || /^\\/api\\/plaza\\/[^/]+\\/comments\\/[^/]+$/.test(pathname)",
  "  || /^\\/api\\/admin\\/comments\\/[^/]+$/.test(pathname);",
  'const plazaInternalUser = (user) => encodeURIComponent(JSON.stringify({',
  '  id: user.id,',
  '  role: user.role,',
  '  trackId: user.trackId,',
  '  status: user.status',
  '}));',
  'const dispatchPlazaService = async (request, env, ctx, url) => {',
  '  if (!env.PLAZA_SERVICE || !isPlazaServiceRoute(url.pathname)) return null;',
  '  let user = null;',
  "  if (url.pathname !== '/api/rankings') {",
  '    const auth = await requireUser(request, env);',
  '    if (auth.error) return auth.error;',
  '    user = auth.user;',
  '  }',
  '  const headers = new Headers(request.headers);',
  '  headers.delete(PLAZA_USER_HEADER);',
  '  headers.delete(PLAZA_SERVICE_HEADER);',
  "  headers.set(PLAZA_SERVICE_HEADER, 'plaza-v1');",
  '  if (user) headers.set(PLAZA_USER_HEADER, plazaInternalUser(user));',
  '  const serviceRequest = new Request(request.clone(), { headers });',
  '  try {',
  '    return await env.PLAZA_SERVICE.fetch(serviceRequest);',
  '  } catch (error) {',
  "    if (request.method === 'GET' || request.method === 'HEAD') return null;",
  "    return json({ error: '活动广场服务暂时不可用，请稍后重试' }, 503, {",
  "      'x-jinshan-service-error': 'plaza-binding'",
  '    });',
  '  }',
  '};',
  ''
].join('\n');

let worker = fs.readFileSync(workerPath, 'utf8');
if (!worker.includes(workerMarker)) {
  worker = replaceOnce(
    worker,
    'const routeRequest = async (request, env, ctx) => {',
    `${workerHelpers}const routeRequest = async (request, env, ctx) => {`,
    '主Worker路由函数位置'
  );
  worker = replaceOnce(
    worker,
    `      const admin = await handleAdminRoutes(request, env, ctx, url);`,
    `      const plazaService = await dispatchPlazaService(request, env, ctx, url);\n      if (plazaService) return plazaService;\n\n      const admin = await handleAdminRoutes(request, env, ctx, url);`,
    '活动广场服务转发位置'
  );
  fs.writeFileSync(workerPath, worker, 'utf8');
}

route = fs.readFileSync(routePath, 'utf8');
worker = fs.readFileSync(workerPath, 'utf8');
if (!route.includes(routeMarker)
    || !route.includes('authenticatedUser = null')
    || !route.includes("env.SKIP_RUNTIME_SCHEMA !== 'true'")
    || !worker.includes(workerMarker)
    || !worker.includes('env.PLAZA_SERVICE.fetch(serviceRequest)')
    || !worker.includes("request.method === 'GET' || request.method === 'HEAD'")) {
  throw new Error('活动广场独立服务生成不完整');
}

console.log('Applied optional plaza service binding with safe local fallback.');
