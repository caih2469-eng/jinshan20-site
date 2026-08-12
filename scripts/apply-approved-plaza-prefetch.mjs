import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appMarker = '/* APPROVED_PLAZA_PREFETCH_V2 */';
const bootstrapMarker = '/* APPROVED_BOOTSTRAP_PLAZA_PREFETCH_V1 */';
const replaceOnce = (input, search, replacement, label) => {
  const output = input.replace(search, replacement);
  if (output === input) throw new Error(`未找到${label}，已停止以避免误改`);
  return output;
};

{
  const file = path.join(root, 'public/app.js');
  let source = fs.readFileSync(file, 'utf8');
  if (!source.includes(appMarker)) {
    source = replaceOnce(
      source,
      'const plazaViewCache = new Map();',
      `const plazaViewCache = new Map();\nlet studentPlazaPrefetchPromise = null;`,
      '活动广场缓存变量'
    );

    const prefetchFunction = [
      appMarker,
      "const prefetchStudentPlaza = () => {",
      "  if (user?.role !== 'student') return Promise.resolve(null);",
      "  const cacheKey = scopedCacheKey('plaza', 'latest', 1, '');",
      "  const cached = readViewCache(plazaViewCache, cacheKey);",
      "  if (cached) return Promise.resolve(cached.data);",
      "  if (studentPlazaPrefetchPromise) return studentPlazaPrefetchPromise;",
      "  const startedAt = performance.now();",
      "  const path = '/api/plaza?sort=latest&page=1&limit=20';",
      "  const bootstrapPromise = window.__BOOTSTRAP_PLAZA_PROMISE__;",
      "  const sourcePromise = bootstrapPromise",
      "    ? Promise.resolve(bootstrapPromise).then((result) => result || api(path))",
      "    : api(path);",
      "  studentPlazaPrefetchPromise = sourcePromise",
      "    .then((result) => {",
      "      if (!result) return null;",
      "      writeViewCache(plazaViewCache, cacheKey, result);",
      "      const firstImage = result.posts?.[0]?.images?.[0];",
      "      const firstUrl = firstImage?.thumbUrl || firstImage?.imageUrl || '';",
      "      if (firstUrl) {",
      "        void fetch(buildMediaUrl(firstUrl), {",
      "          credentials: 'same-origin',",
      "          cache: 'force-cache',",
      "          priority: 'low'",
      "        }).catch(() => null);",
      "      }",
      "      recordPerf('plaza-prefetch', {",
      "        status: 'ready',",
      "        duration: roundedDuration(startedAt),",
      "        hasFirstImage: Boolean(firstUrl),",
      "        bootstrapStarted: Boolean(bootstrapPromise)",
      "      });",
      "      return result;",
      "    })",
      "    .catch((error) => {",
      "      recordPerf('plaza-prefetch', { status: 'failed', duration: roundedDuration(startedAt), message: error.message });",
      "      return null;",
      "    })",
      "    .finally(() => { studentPlazaPrefetchPromise = null; });",
      "  return studentPlazaPrefetchPromise;",
      "};",
      ''
    ].join('\n');

    source = replaceOnce(
      source,
      'const updatePlazaCachePost = (postId, updates) => {',
      `${prefetchFunction}const updatePlazaCachePost = (postId, updates) => {`,
      '活动广场预取函数位置'
    );

    source = replaceOnce(
      source,
      /  try \{ localStorage\.user = JSON\.stringify\(user\); \} catch \{\}\r?\n  const isInteraction = user\.trackId === 'interaction';/,
      "  try { localStorage.user = JSON.stringify(user); } catch {}\n  void prefetchStudentPlaza();\n  const isInteraction = user.trackId === 'interaction';",
      '学生首页预取启动位置'
    );

    fs.writeFileSync(file, source, 'utf8');
  }
}

{
  const file = path.join(root, 'public/bootstrap.js');
  let source = fs.readFileSync(file, 'utf8');
  if (!source.includes(bootstrapMarker)) {
    const bootstrapPrefetch = [
      `      ${bootstrapMarker}`,
      "      window.__BOOTSTRAP_PLAZA_PROMISE__ = window.__BOOTSTRAP_USER__?.role === 'student'",
      "        ? fetch('/api/plaza?sort=latest&page=1&limit=20', {",
      "            credentials: 'same-origin',",
      "            headers: storedToken ? { authorization: `Bearer ${storedToken}` } : {}",
      "          })",
      "          .then(async (plazaResponse) => {",
      "            if (!plazaResponse.ok) return null;",
      "            const result = await plazaResponse.json();",
      "            const firstImage = result.posts?.[0]?.images?.[0];",
      "            const firstUrl = firstImage?.thumbUrl || firstImage?.imageUrl || '';",
      "            if (firstUrl) {",
      "              const preload = new Image();",
      "              preload.decoding = 'async';",
      "              preload.fetchPriority = 'low';",
      "              preload.src = new URL(firstUrl, location.origin).href;",
      "              window.__BOOTSTRAP_PLAZA_IMAGE__ = preload;",
      "            }",
      "            return result;",
      "          })",
      "          .catch(() => null)",
      "        : Promise.resolve(null);"
    ].join('\n');
    source = replaceOnce(
      source,
      /      window\.__BOOTSTRAP_DASHBOARD__ = session\.dashboard \|\| null;\r?\n/,
      `      window.__BOOTSTRAP_DASHBOARD__ = session.dashboard || null;\n${bootstrapPrefetch}\n`,
      '启动阶段活动广场预取位置'
    );
    fs.writeFileSync(file, source, 'utf8');
  }
}

await import('./apply-track-admin-settings-compat.mjs');
await import('./apply-plaza-detail-fast-path.mjs');
await import('./apply-lazy-plaza-assets.mjs');
await import('./apply-plaza-service-split.mjs');
await import('./apply-checkin-service-split.mjs');
await import('./apply-role-scoped-admin-style.mjs');
await import('./apply-build-asset-version.mjs');

console.log('Applied bootstrap, plaza prefetch/detail/lazy assets/service split, check-in service split, role-scoped admin style, track-aware settings and commit-scoped asset versions.');
