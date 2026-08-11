import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const entranceMarker = '/* STRICT_P95_LOGIN_READY_V4 */';
const entranceHtmlMarker = '<!-- STRICT_P95_LOGIN_HTML_V4 -->';
const appMarker = '/* STRICT_P95_APP_PREFETCH_V4 */';
const bootstrapMarker = '/* STRICT_P95_BOOTSTRAP_V4 */';
const bootstrapAssetMarker = '/* STRICT_P95_ASSET_OVERLAP_V4 */';
const dashboardMarker = '/* STRICT_P95_DASHBOARD_BATCH_V4 */';

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

// Make the login controls visually usable from the initial HTML/CSS. Decorative
// animation and entrance.js must never be a prerequisite for seeing or focusing the form.
{
  const { file, source } = read('public/entrance.html');
  if (!source.includes(entranceHtmlMarker)) {
    const scriptMatch = source.match(/\n\s*<script src="([^"]*entrance\.js[^"]*)"><\/script>/);
    if (!scriptMatch) throw new Error('未找到入口页登录脚本标签');
    const critical = [
      `    ${entranceHtmlMarker}`,
      '    <style>',
      '      #cinematic-intro { pointer-events: none !important; z-index: 5 !important; }',
      '      .ui-layer { opacity: 1 !important; transform: none !important; transition: none !important; }',
      '    </style>',
      `    <script defer src="${scriptMatch[1]}"></script>`
    ].join('\n');
    let next = replaceOnce(source, '</head>', `${critical}\n</head>`, '入口页head结束位置');
    next = next.replace(scriptMatch[0], '');
    write(file, next);
  }
}

{
  const { file, source } = read('public/entrance.js');
  if (!source.includes(entranceMarker)) {
    const revealPattern = /\s*setTimeout\(\(\) => \{\r?\n\s*intro\.style\.opacity = '0';\r?\n\s*intro\.style\.pointerEvents = 'none';[\s\S]*?uiLayer\.style\.opacity = '1';\r?\n\s*uiLayer\.style\.transform = 'translateY\(0\)';\r?\n\s*\}, 800\);/;
    const newReveal = `\n            ${entranceMarker}\n            // Login controls are part of the critical path. Keep the cinematic layer decorative, never blocking input.\n            intro.style.pointerEvents = 'none';\n            intro.style.zIndex = '5';\n            uiLayer.style.transition = 'none';\n            uiLayer.style.opacity = '1';\n            uiLayer.style.transform = 'translateY(0)';\n            requestAnimationFrame(() => {\n                ambient.style.opacity = '1';\n                vignette.style.opacity = '1';\n                bgStars.style.opacity = '1';\n                glow.style.opacity = '1';\n                setTimeout(() => { intro.style.opacity = '0'; }, 250);\n            });`;
    write(file, replaceOnce(source, revealPattern, newReveal, '登录界面800ms延迟显示区块'));
  }
}

{
  const { file, source } = read('public/bootstrap.js');
  let next = source;
  if (!next.includes(bootstrapMarker)) {
    const pattern = /\s*\/\* PLAZA_PERFORMANCE_QUALITY_V3 \*\/\n\s*window\.__BOOTSTRAP_PLAZA_PROMISE__ = window\.__BOOTSTRAP_USER__\?\.role === 'student'[\s\S]*?\n\s*: Promise\.resolve\(null\);/;
    if (!pattern.test(next)) throw new Error('未找到启动阶段活动广场预取区块');
    const replacement = `\n      /* PLAZA_PERFORMANCE_QUALITY_V3 */\n      ${bootstrapMarker}\n      // Do not compete with the authenticated home critical path. The app starts this prefetch after home is usable.\n      window.__BOOTSTRAP_PLAZA_PROMISE__ = Promise.resolve(null);\n      window.__BOOTSTRAP_PLAZA_IMAGES__ = [];`;
    next = next.replace(pattern, replacement);
  }

  if (!next.includes(bootstrapAssetMarker)) {
    const styleUrl = next.match(/loadStylesheet\('([^']*\/style\.css[^']*)'\)/)?.[1];
    const sitePathUrl = next.match(/loadScript\('([^']*\/site-path\.js[^']*)'\)/)?.[1];
    const appUrl = next.match(/loadScript\('([^']*\/app\.js[^']*)'\)/)?.[1];
    if (!styleUrl || !sitePathUrl || !appUrl) throw new Error('未找到首页关键静态资源URL');
    const helper = [
      `  ${bootstrapAssetMarker}`,
      '  const preloadCriticalAsset = (href, as, priority = \'auto\') => {',
      '    const link = document.createElement(\'link\');',
      '    link.rel = \'preload\';',
      '    link.as = as;',
      '    link.href = href;',
      '    link.fetchPriority = priority;',
      '    document.head.appendChild(link);',
      '  };',
      `  const warmHomeAssets = () => {`,
      `    preloadCriticalAsset('${styleUrl}', 'style', 'high');`,
      `    preloadCriticalAsset('${sitePathUrl}', 'script', 'auto');`,
      `    preloadCriticalAsset('${appUrl}', 'script', 'auto');`,
      '  };',
      ''
    ].join('\n');
    next = replaceOnce(next, '  const showNetworkError = () => {', `${helper}  const showNetworkError = () => {`, '首页静态资源预加载器位置');

    const sessionFetch = /      const response = await fetch\('\/api\/session', \{([\s\S]*?)\n      \}\);/;
    const match = next.match(sessionFetch);
    if (!match) throw new Error('未找到首页session请求');
    const replacement = `      const sessionRequest = fetch('/api/session', {${match[1]}\n      });\n      // The authenticated request is issued first; static public assets download in parallel while D1 builds the dashboard.\n      queueMicrotask(warmHomeAssets);\n      const response = await sessionRequest;`;
    next = next.replace(sessionFetch, replacement);
  }
  write(file, next);
}

{
  const { file, source } = read('public/app.js');
  if (!source.includes(appMarker)) {
    let next = source;
    const eagerCall = '  void prefetchStudentPlaza();';
    const deferredCall = `  ${appMarker}\n  const startPlazaPrefetch = () => { void prefetchStudentPlaza(); };\n  if ('requestIdleCallback' in window) requestIdleCallback(startPlazaPrefetch, { timeout: 900 });\n  else setTimeout(startPlazaPrefetch, 500);`;
    next = replaceOnce(next, eagerCall, deferredCall, '学生首页立即广场预取调用');

    const eagerImages = `      const preloadImages = (result.posts || []).slice(0, 4)\n        .map((post) => post.images?.[0])\n        .filter(Boolean);\n      preloadImages.forEach((image, index) => {\n        const thumbUrl = buildMediaUrl(image.thumbUrl || image.imageUrl || image.displayUrl);\n        const displayUrl = buildMediaUrl(image.displayUrl || image.imageUrl || image.thumbUrl);\n        if (!thumbUrl) return;\n        const preload = new Image();\n        preload.decoding = 'async';\n        preload.fetchPriority = index < 2 ? 'high' : 'auto';\n        preload.sizes = '(max-width: 720px) calc(50vw - 18px), 360px';\n        if (displayUrl && displayUrl !== thumbUrl) preload.srcset = \`${'${'}thumbUrl} 960w, ${'${'}displayUrl} 2048w\`;\n        preload.src = thumbUrl;\n      });`;
    const lowPriorityFirstThumb = `      const firstImage = result.posts?.[0]?.images?.[0];\n      const firstUrl = firstImage?.thumbUrl || firstImage?.imageUrl || '';\n      if (firstUrl) {\n        void fetch(buildMediaUrl(firstUrl), {\n          credentials: 'same-origin',\n          cache: 'force-cache',\n          priority: 'low'\n        }).catch(() => null);\n      }`;
    if (next.includes(eagerImages)) next = next.replace(eagerImages, lowPriorityFirstThumb);
    next = next.replace('        hasFirstImage: Boolean(preloadImages.length),', '        hasFirstImage: Boolean(firstUrl),');

    const returnLine = '  return studentPlazaPrefetchPromise;';
    next = replaceOnce(
      next,
      returnLine,
      `  window.__BOOTSTRAP_PLAZA_PROMISE__ = studentPlazaPrefetchPromise;\n${returnLine}`,
      '广场预取Promise复用位置'
    );
    write(file, next);
  }
}

await import('./apply-dashboard-p95-v4.mjs');

const entranceHtml = fs.readFileSync(path.join(root, 'public/entrance.html'), 'utf8');
const entrance = fs.readFileSync(path.join(root, 'public/entrance.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'public/bootstrap.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'cloudflare/services/student-dashboard.js'), 'utf8');
const v5Ready = app.includes('MOBILE_REAL_UNDER_1S_V5');
const plazaWarmupReady = v5Ready
  ? app.includes('void startPlazaPrefetch();')
    && app.includes("preload.fetchPriority = index < 2 ? 'high' : 'auto';")
  : app.includes("requestIdleCallback(startPlazaPrefetch, { timeout: 900 })")
    && app.includes("priority: 'low'");
if (!entranceHtml.includes(entranceHtmlMarker)
    || (!entranceHtml.includes('<script defer src=')
      && !entranceHtml.includes('INLINE_ENTRANCE_CRITICAL_V1'))
    || !entranceHtml.includes('.ui-layer { opacity: 1 !important;')
    || !entrance.includes(entranceMarker)
    || !bootstrap.includes(bootstrapMarker)
    || !bootstrap.includes(bootstrapAssetMarker)
    || !bootstrap.includes('queueMicrotask(warmHomeAssets);')
    || !app.includes(appMarker)
    || !dashboard.includes(dashboardMarker)
    || /setTimeout\(\(\) => \{[\s\S]*?uiLayer\.style\.opacity = '1'[\s\S]*?\}, 800\)/.test(entrance)
    || bootstrap.includes("fetch('/api/plaza?sort=latest&page=1&limit=20'")
    || !plazaWarmupReady
    || !app.includes('window.__BOOTSTRAP_PLAZA_PROMISE__ = studentPlazaPrefetchPromise;')) {
  throw new Error('严格p95关键路径V4/V5生成不完整');
}

console.log(v5Ready
  ? 'Validated strict p95 V4 with stricter mobile real-under-1s V5 Plaza warmup.'
  : 'Applied strict p95 critical-path V4: immediate login UI, overlapped home assets, shared Dashboard reads and deferred Plaza prefetch.');
