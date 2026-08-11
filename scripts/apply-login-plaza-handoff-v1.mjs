import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* LOGIN_PLAZA_HANDOFF_V1 */';
const read = (relativePath) => {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) throw new Error(`${relativePath}不存在`);
  return { file, source: fs.readFileSync(file, 'utf8') };
};
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');
const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

{
  const { file, source } = read('cloudflare/worker.js');
  if (!source.includes(marker)) {
    let next = replaceOnce(
      source,
      "import { handlePlazaRoutes } from './routes/plaza.js';",
      "import { handlePlazaRoutes } from './routes/plaza.js';\nimport { buildLoginPlazaFirstPage } from './services/plaza-first-page.js';",
      '登录广场首屏服务导入位置'
    );
    const waitBlock = `  const [token, dashboard] = await Promise.all([tokenPromise, dashboardPromise]);`;
    const handoffBlock = `  ${marker}\n  const plazaPromise = user.role === 'student'\n    ? (async () => {\n      const startedAt = performance.now();\n      try {\n        return await buildLoginPlazaFirstPage(env, user.id);\n      } catch {\n        return null;\n      } finally {\n        recordRequestTiming(request, 'login_plaza', performance.now() - startedAt);\n      }\n    })()\n    : Promise.resolve(null);\n  const [token, dashboard, plaza] = await Promise.all([\n    tokenPromise,\n    dashboardPromise,\n    plazaPromise\n  ]);`;
    next = replaceOnce(next, waitBlock, handoffBlock, '登录并行快照等待位置');
    next = replaceOnce(
      next,
      '    dashboard\n  } : null;',
      '    dashboard,\n    plaza\n  } : null;',
      '登录快照广场字段位置'
    );
    write(file, next);
  }
}

{
  const { file, source } = read('public/bootstrap.js');
  if (!source.includes(marker)) {
    const old = '      window.__BOOTSTRAP_PLAZA_PROMISE__ = Promise.resolve(null);';
    const replacement = `      ${marker}\n      // A validated same-user login handoff can satisfy Plaza immediately.\n      // Missing data keeps the existing app-level /api/plaza fallback intact.\n      window.__BOOTSTRAP_PLAZA_PROMISE__ = Promise.resolve(session.plaza || null);`;
    write(file, replaceOnce(source, old, replacement, '首页广场Promise交接位置'));
  }
}

const worker = read('cloudflare/worker.js').source;
const bootstrap = read('public/bootstrap.js').source;
const service = read('cloudflare/services/plaza-first-page.js').source;
if (!worker.includes(marker)
    || !worker.includes('buildLoginPlazaFirstPage(env, user.id)')
    || !worker.includes('const [token, dashboard, plaza] = await Promise.all')
    || !worker.includes("recordRequestTiming(request, 'login_plaza'")
    || !worker.includes('dashboard,\n    plaza')
    || !bootstrap.includes(marker)
    || !bootstrap.includes('Promise.resolve(session.plaza || null)')
    || !bootstrap.includes("fetch('/api/session'")
    || !service.includes("WHERE p.status='visible' ORDER BY p.published_at DESC")
    || !service.includes('variant=thumb')
    || !service.includes('variant=display')) {
  throw new Error('登录到活动广场首屏无损交接生成不完整');
}

console.log('Applied login-to-Plaza first-page handoff with same-user validation, normal API fallback and unchanged image variants.');
