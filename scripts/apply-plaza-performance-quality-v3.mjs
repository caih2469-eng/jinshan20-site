import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* PLAZA_PERFORMANCE_QUALITY_V3 */';
const mobileLayoutMarker = '/* PLAZA_MOBILE_LAYOUT_V1 */';

const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

const replaceIfPresent = (source, search, replacement) => (
  source.includes(search) ? source.replace(search, replacement) : source
);

const patchPlazaPage = (source, label) => {
  if (source.includes(marker)) return source;
  let next = source;
  next = replaceOnce(
    next,
    mobileLayoutMarker,
    `${mobileLayoutMarker}\n${marker}`,
    `${label}性能标记位置`
  );
  next = replaceOnce(
    next,
    `loading="${'${'}cardIndex === 0 ? 'eager' : 'lazy'}"`,
    `loading="${'${'}cardIndex < 4 ? 'eager' : 'lazy'}"`,
    `${label}首屏图片加载策略`
  );
  next = replaceOnce(
    next,
    `fetchpriority="${'${'}cardIndex === 0 ? 'high' : 'low'}"`,
    `fetchpriority="${'${'}cardIndex < 2 ? 'high' : cardIndex < 4 ? 'auto' : 'low'}"`,
    `${label}首屏图片优先级`
  );
  next = replaceOnce(
    next,
    `data-priority="${'${'}cardIndex === 0 ? 'high' : 'low'}"`,
    `data-priority="${'${'}cardIndex < 4 ? 'high' : 'low'}"`,
    `${label}首屏图片即时激活`
  );
  next = replaceOnce(
    next,
    `              data-src="${'${'}escapeHtml(post.images[0].thumbUrl || post.images[0].imageUrl)}"`,
    [
      `              ${'${'}cardIndex < 4`,
      `                ? \`src="${'${'}escapeHtml(post.images[0].thumbUrl || post.images[0].imageUrl)}" srcset="${'${'}escapeHtml(post.images[0].thumbUrl || post.images[0].imageUrl)} 960w, ${'${'}escapeHtml(post.images[0].displayUrl || post.images[0].imageUrl)} 2048w" sizes="(max-width: 720px) calc(50vw - 18px), 360px"\``,
      `                : \`data-src="${'${'}escapeHtml(post.images[0].thumbUrl || post.images[0].imageUrl)}"\`}`
    ].join('\n'),
    `${label}响应式高清首屏图片`
  );
  next = replaceOnce(
    next,
    /  prepareDynamicContent\(app\);\r?\n  requestAnimationFrame\(rebalancePlazaColumns\);\r?\n  recordPerf\('page-render', \{/,
    `  prepareDynamicContent(app);\n  requestAnimationFrame(rebalancePlazaColumns);\n  scheduleVisiblePlazaDetailWarmup();\n  recordPerf('page-render', {`,
    `${label}详情预热启动`
  );
  next = replaceOnce(
    next,
    /    if \(cacheIsFresh\(cached\)\) queueMicrotask\(\(\) => \{ void refresh\(\); \}\);\r?\n    else void refresh\(\);/,
    `    if (cacheIsFresh(cached)) {\n      setTimeout(() => { void refresh(); }, 3200);\n    } else void refresh();`,
    `${label}缓存后台刷新让出首屏带宽`
  );
  next = replaceOnce(
    next,
    /  const result = await api\(path\);\r?\n  writeViewCache\(plazaViewCache, cacheKey, result\);\r?\n  renderPlazaPage\(result, safeSort, page, '', pageEpoch, \{ query: safeQuery \}\);/,
    `  const bootstrapResult = safeSort === 'latest' && page === 1 && !safeQuery\n    ? await Promise.resolve(window.__BOOTSTRAP_PLAZA_PROMISE__).catch(() => null)\n    : null;\n  const result = bootstrapResult || await api(path);\n  writeViewCache(plazaViewCache, cacheKey, result);\n  renderPlazaPage(result, safeSort, page, '', pageEpoch, { query: safeQuery });`,
    `${label}启动预取结果复用`
  );
  return next;
};

const patchAppRuntime = (source) => {
  if (source.includes(marker)) return source;
  let next = source;
  if (!next.includes('const scheduleVisiblePlazaDetailWarmup = () => {')) {
    const detailWarmup = [
      'const scheduleVisiblePlazaDetailWarmup = () => {',
      "  if (document.body.dataset.view !== 'plaza') return;",
      '  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};',
      "  if (connection.saveData || /(^|-)2g$/.test(connection.effectiveType || '')) return;",
      "  const postIds = [...document.querySelectorAll('[data-post]')].slice(0, 4)",
      '    .map((card) => card.dataset.post).filter(Boolean);',
      '  queueMicrotask(() => postIds.forEach((postId, index) => {',
      '    const delay = index < 2 ? index * 40 : 220 + (index - 2) * 100;',
      '    setTimeout(() => { void loadPlazaPost(postId).catch(() => null); }, delay);',
      '  }));',
      '};',
      ''
    ].join('\n');
    next = replaceOnce(
      next,
      'const clearUserViewCaches = () => {',
      `${detailWarmup}const clearUserViewCaches = () => {`,
      'plaza detail warmup helper'
    );
  }
  if (next.includes(mobileLayoutMarker)) {
    next = patchPlazaPage(next, '主应用');
    next = replaceOnce(
      next,
      'const VIEW_CACHE_TTL_MS = 20_000;',
      'const VIEW_CACHE_TTL_MS = 60_000;',
      '活动广场视图缓存时长'
    );
  } else {
    next = replaceOnce(
      next,
      'const VIEW_CACHE_TTL_MS = 20_000;',
      `${marker}\nconst VIEW_CACHE_TTL_MS = 60_000;`,
      '活动广场运行时性能标记与缓存时长'
    );
  }
  if (!next.includes('const delay = index < 2 ? index * 40 : 220 + (index - 2) * 100;')) {
    next = replaceOnce(
      next,
      `  const run = () => postIds.forEach((postId, index) => {\n    setTimeout(() => { void loadPlazaPost(postId).catch(() => null); }, index * 90);\n  });\n  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 900 });\n  else setTimeout(run, 120);`,
      `  const run = () => postIds.forEach((postId, index) => {\n    const delay = index < 2 ? index * 40 : 220 + (index - 2) * 100;\n    setTimeout(() => { void loadPlazaPost(postId).catch(() => null); }, delay);\n  });\n  queueMicrotask(run);`,
      '可见卡片详情预热调度'
    );
  }
  if (next.includes('const previewPost = readPlazaPostPreview(postId);')) {
    next = replaceOnce(
      next,
      '<p class="muted">正在补齐成员与全部图片…</p>',
      `<p class="muted">${'${'}formatDate(previewPost.publishedAt)}</p>`,
      '详情即时预览文案'
    );
    next = replaceOnce(
      next,
      `src="${'${'}escapeHtml(previewImage.thumbUrl || previewImage.imageUrl)}" alt="活动图片"`,
      `src="${'${'}escapeHtml(previewImage.thumbUrl || previewImage.imageUrl)}" srcset="${'${'}escapeHtml(previewImage.thumbUrl || previewImage.imageUrl)} 960w, ${'${'}escapeHtml(previewImage.displayUrl || previewImage.imageUrl)} 2048w" sizes="(max-width: 720px) 100vw, 720px" alt="活动图片"`,
      '详情即时预览响应式图片'
    );
    next = replaceOnce(
      next,
      `            ${'${'}imageIndex === 0 ? 'src' : 'data-src'}="${'${'}escapeHtml(image.thumbUrl || image.imageUrl)}" alt="活动图片"`,
      [
        `            ${'${'}imageIndex === 0`,
        `              ? \`src="${'${'}escapeHtml(image.thumbUrl || image.imageUrl)}" srcset="${'${'}escapeHtml(image.thumbUrl || image.imageUrl)} 960w, ${'${'}escapeHtml(image.displayUrl || image.imageUrl)} 2048w" sizes="(max-width: 720px) 100vw, 720px"\``,
        `              : \`data-src="${'${'}escapeHtml(image.thumbUrl || image.imageUrl)}"\`} alt="活动图片"`
      ].join('\n'),
      '详情首图响应式高清资源'
    );
    next = replaceOnce(
      next,
      `  prepareDynamicContent(root);\n  root.querySelector('#closePost').onclick = closePost;\n  recordPerf('plaza-detail-visible', {`,
      `  prepareDynamicContent(root);\n  root.querySelector('#closePost').onclick = closePost;\n  post.images.slice(0, 2).forEach((image, imageIndex) => {\n    const displayUrl = buildMediaUrl(image.displayUrl || image.imageUrl || image.thumbUrl);\n    if (!displayUrl) return;\n    const preload = new Image();\n    preload.decoding = 'async';\n    preload.fetchPriority = imageIndex === 0 ? 'high' : 'low';\n    preload.src = displayUrl;\n  });\n  recordPerf('plaza-detail-visible', {`,
      '详情高清图片预热'
    );
  }

  const oldPrefetchBlock = `      const firstImage = result.posts?.[0]?.images?.[0];\n      const firstUrl = firstImage?.thumbUrl || firstImage?.imageUrl || '';\n      if (firstUrl) {\n        void fetch(buildMediaUrl(firstUrl), {\n          credentials: 'same-origin',\n          cache: 'force-cache',\n          priority: 'low'\n        }).catch(() => null);\n      }`;
  const upgradedPrefetchBlock = `      const preloadImages = (result.posts || []).slice(0, 4)\n        .map((post) => post.images?.[0])\n        .filter(Boolean);\n      preloadImages.forEach((image, index) => {\n        const thumbUrl = buildMediaUrl(image.thumbUrl || image.imageUrl || image.displayUrl);\n        const displayUrl = buildMediaUrl(image.displayUrl || image.imageUrl || image.thumbUrl);\n        if (!thumbUrl) return;\n        const preload = new Image();\n        preload.decoding = 'async';\n        preload.fetchPriority = index < 2 ? 'high' : 'auto';\n        preload.sizes = '(max-width: 720px) calc(50vw - 18px), 360px';\n        if (displayUrl && displayUrl !== thumbUrl) preload.srcset = \`${'${'}thumbUrl} 960w, ${'${'}displayUrl} 2048w\`;\n        preload.src = thumbUrl;\n      });`;
  next = replaceIfPresent(next, oldPrefetchBlock, upgradedPrefetchBlock);
  next = replaceIfPresent(
    next,
    '        hasFirstImage: Boolean(firstUrl),',
    '        hasFirstImage: Boolean(preloadImages.length),'
  );
  return next;
};

const standaloneBootstrapPrefetch = [
  `      ${marker}`,
  "      window.__BOOTSTRAP_PLAZA_PROMISE__ = window.__BOOTSTRAP_USER__?.role === 'student'",
  "        ? fetch('/api/plaza?sort=latest&page=1&limit=20', {",
  "            credentials: 'same-origin',",
  "            headers: storedToken ? { authorization: `Bearer ${storedToken}` } : {}",
  '          })',
  '          .then(async (plazaResponse) => {',
  '            if (!plazaResponse.ok) return null;',
  '            const result = await plazaResponse.json();',
  '            const preloadImages = (result.posts || []).slice(0, 4)',
  '              .map((post) => post.images?.[0])',
  '              .filter(Boolean)',
  '              .map((image, index) => {',
  '                const thumbUrl = new URL(image.thumbUrl || image.imageUrl || image.displayUrl, location.origin).href;',
  '                const displayUrl = new URL(image.displayUrl || image.imageUrl || image.thumbUrl, location.origin).href;',
  '                const preload = new Image();',
  "                preload.decoding = 'async';",
  "                preload.fetchPriority = index < 2 ? 'high' : 'auto';",
  "                preload.sizes = '(max-width: 720px) calc(50vw - 18px), 360px';",
  '                if (displayUrl !== thumbUrl) preload.srcset = `${thumbUrl} 960w, ${displayUrl} 2048w`;',
  '                preload.src = thumbUrl;',
  '                return preload;',
  '              });',
  '            window.__BOOTSTRAP_PLAZA_IMAGES__ = preloadImages;',
  '            return result;',
  '          })',
  '          .catch(() => null)',
  '        : Promise.resolve(null);'
].join('\n');

const patchBootstrap = (source) => {
  if (source.includes(marker)) return source;
  let next = source;
  const oldApprovedBlock = `            const firstImage = result.posts?.[0]?.images?.[0];\n            const firstUrl = firstImage?.thumbUrl || firstImage?.imageUrl || '';\n            if (firstUrl) {\n              const preload = new Image();\n              preload.decoding = 'async';\n              preload.fetchPriority = 'low';\n              preload.src = new URL(firstUrl, location.origin).href;\n              window.__BOOTSTRAP_PLAZA_IMAGE__ = preload;\n            }`;
  if (next.includes('/* APPROVED_BOOTSTRAP_PLAZA_PREFETCH_V1 */') && next.includes(oldApprovedBlock)) {
    next = replaceOnce(
      next,
      '/* APPROVED_BOOTSTRAP_PLAZA_PREFETCH_V1 */',
      `/* APPROVED_BOOTSTRAP_PLAZA_PREFETCH_V1 */\n      ${marker}`,
      '启动预取性能标记'
    );
    next = replaceOnce(
      next,
      oldApprovedBlock,
      `            const preloadImages = (result.posts || []).slice(0, 4)\n              .map((post) => post.images?.[0])\n              .filter(Boolean)\n              .map((image, index) => {\n                const thumbUrl = new URL(image.thumbUrl || image.imageUrl || image.displayUrl, location.origin).href;\n                const displayUrl = new URL(image.displayUrl || image.imageUrl || image.thumbUrl, location.origin).href;\n                const preload = new Image();\n                preload.decoding = 'async';\n                preload.fetchPriority = index < 2 ? 'high' : 'auto';\n                preload.sizes = '(max-width: 720px) calc(50vw - 18px), 360px';\n                if (displayUrl !== thumbUrl) preload.srcset = \`${'${'}thumbUrl} 960w, ${'${'}displayUrl} 2048w\`;\n                preload.src = thumbUrl;\n                return preload;\n              });\n            window.__BOOTSTRAP_PLAZA_IMAGES__ = preloadImages;`,
      '启动阶段四张广场首图预取'
    );
    return next;
  }
  return replaceOnce(
    next,
    '      window.__BOOTSTRAP_DASHBOARD__ = session.dashboard || null;\n',
    `      window.__BOOTSTRAP_DASHBOARD__ = session.dashboard || null;\n${standaloneBootstrapPrefetch}\n`,
    '独立启动阶段广场预取位置'
  );
};

const appPath = path.join(root, 'public/app.js');
const pageTemplatePath = path.join(root, 'templates/plaza-mobile-page.txt');
const bootstrapPath = path.join(root, 'public/bootstrap.js');

const app = patchAppRuntime(fs.readFileSync(appPath, 'utf8'));
const pageTemplate = patchPlazaPage(fs.readFileSync(pageTemplatePath, 'utf8'), '活动广场模板');
const bootstrap = patchBootstrap(fs.readFileSync(bootstrapPath, 'utf8'));

fs.writeFileSync(appPath, app, 'utf8');
fs.writeFileSync(pageTemplatePath, pageTemplate, 'utf8');
fs.writeFileSync(bootstrapPath, bootstrap, 'utf8');

if (!app.includes(marker)
    || !pageTemplate.includes(marker)
    || !bootstrap.includes(marker)
    || !app.includes('2048w')
    || !pageTemplate.includes('cardIndex < 4')
    || !pageTemplate.includes('scheduleVisiblePlazaDetailWarmup();')
    || !pageTemplate.includes('setTimeout(() => { void refresh(); }, 3200)')
    || !pageTemplate.includes('__BOOTSTRAP_PLAZA_PROMISE__')
    || !bootstrap.includes('__BOOTSTRAP_PLAZA_IMAGES__')) {
  throw new Error('活动广场性能与画质V3生成不完整');
}

console.log('Applied plaza performance and responsive image quality V3.');
