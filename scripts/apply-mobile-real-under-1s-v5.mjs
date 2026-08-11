import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* MOBILE_REAL_UNDER_1S_V5 */';

const read = (relativePath) => {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) throw new Error(`${relativePath}不存在`);
  return { file, source: fs.readFileSync(file, 'utf8') };
};
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');
const replaceIfPresent = (source, search, replacement) => (
  source.includes(search) ? source.replace(search, replacement) : source
);

const patchPlazaPage = (source, label) => {
  if (source.includes(marker)) return source;
  if (!source.includes('/* PLAZA_PERFORMANCE_QUALITY_V3 */')) {
    throw new Error(`${label}缺少活动广场V3基线`);
  }

  let next = source.replace(
    '/* PLAZA_PERFORMANCE_QUALITY_V3 */',
    `/* PLAZA_PERFORMANCE_QUALITY_V3 */\n${marker}`
  );

  const eagerResponsive = [
    `              ${'${'}cardIndex < 4`,
    `                ? \`src="${'${'}escapeHtml(post.images[0].thumbUrl || post.images[0].imageUrl)}" srcset="${'${'}escapeHtml(post.images[0].thumbUrl || post.images[0].imageUrl)} 960w, ${'${'}escapeHtml(post.images[0].displayUrl || post.images[0].imageUrl)} 2048w" sizes="(max-width: 720px) calc(50vw - 18px), 360px"\``,
    `                : \`data-src="${'${'}escapeHtml(post.images[0].thumbUrl || post.images[0].imageUrl)}"\`}`
  ].join('\n');
  const eagerThumbOnly = [
    `              ${'${'}cardIndex < 4`,
    `                ? \`src="${'${'}escapeHtml(post.images[0].thumbUrl || post.images[0].imageUrl)}"\``,
    `                : \`data-src="${'${'}escapeHtml(post.images[0].thumbUrl || post.images[0].imageUrl)}"\`}`
  ].join('\n');
  next = replaceIfPresent(next, eagerResponsive, eagerThumbOnly);

  return next;
};

{
  const { file, source } = read('public/app.js');
  let next = patchPlazaPage(source, '主应用');

  const deferredPrefetch = [
    '  /* STRICT_P95_APP_PREFETCH_V4 */',
    '  const startPlazaPrefetch = () => { void prefetchStudentPlaza(); };',
    "  if ('requestIdleCallback' in window) requestIdleCallback(startPlazaPrefetch, { timeout: 900 });",
    '  else setTimeout(startPlazaPrefetch, 500);'
  ].join('\n');
  const immediateAfterPaint = [
    '  /* STRICT_P95_APP_PREFETCH_V4 */',
    `  ${marker}`,
    '  const startPlazaPrefetch = () => { void prefetchStudentPlaza(); };',
    '  // Paint the authenticated home first, then warm the smallest useful Plaza payload immediately.',
    '  requestAnimationFrame(() => { setTimeout(startPlazaPrefetch, 0); });'
  ].join('\n');
  next = replaceIfPresent(next, deferredPrefetch, immediateAfterPaint);

  const oneLowPriorityThumb = [
    '      const firstImage = result.posts?.[0]?.images?.[0];',
    "      const firstUrl = firstImage?.thumbUrl || firstImage?.imageUrl || '';",
    '      if (firstUrl) {',
    '        void fetch(buildMediaUrl(firstUrl), {',
    "          credentials: 'same-origin',",
    "          cache: 'force-cache',",
    "          priority: 'low'",
    '        }).catch(() => null);',
    '      }'
  ].join('\n');
  const fourThumbWarmup = [
    '      const preloadImages = (result.posts || []).slice(0, 4)',
    '        .map((post) => post.images?.[0])',
    '        .filter(Boolean);',
    '      preloadImages.forEach((image, index) => {',
    '        const thumbUrl = buildMediaUrl(image.thumbUrl || image.imageUrl || image.displayUrl);',
    '        if (!thumbUrl) return;',
    '        const preload = new Image();',
    "        preload.decoding = 'async';",
    "        preload.fetchPriority = index < 2 ? 'high' : 'auto';",
    '        preload.src = thumbUrl;',
    '      });'
  ].join('\n');
  next = replaceIfPresent(next, oneLowPriorityThumb, fourThumbWarmup);
  next = next.replace('        hasFirstImage: Boolean(firstUrl),', '        hasFirstImage: Boolean(preloadImages.length),');

  const eagerDisplayWarmup = [
    '  post.images.slice(0, 2).forEach((image, imageIndex) => {',
    '    const displayUrl = buildMediaUrl(image.displayUrl || image.imageUrl || image.thumbUrl);',
    '    if (!displayUrl) return;',
    '    const preload = new Image();',
    "    preload.decoding = 'async';",
    "    preload.fetchPriority = imageIndex === 0 ? 'high' : 'low';",
    '    preload.src = displayUrl;',
    '  });'
  ].join('\n');
  const deferredDisplayWarmup = [
    '  const warmDisplayImages = () => {',
    '    post.images.slice(0, 2).forEach((image) => {',
    '      const displayUrl = buildMediaUrl(image.displayUrl || image.imageUrl || image.thumbUrl);',
    '      if (!displayUrl) return;',
    '      const preload = new Image();',
    "      preload.decoding = 'async';",
    "      preload.fetchPriority = 'low';",
    '      preload.src = displayUrl;',
    '    });',
    '  };',
    "  if ('requestIdleCallback' in window) requestIdleCallback(warmDisplayImages, { timeout: 1800 });",
    '  else setTimeout(warmDisplayImages, 1200);'
  ].join('\n');
  next = replaceIfPresent(next, eagerDisplayWarmup, deferredDisplayWarmup);

  if (!next.includes(marker)
      || !next.includes('requestAnimationFrame(() => { setTimeout(startPlazaPrefetch, 0); });')
      || !next.includes("preload.fetchPriority = index < 2 ? 'high' : 'auto';")
      || !next.includes("preload.fetchPriority = 'low';")
      || !next.includes('2048w')) {
    throw new Error('主应用V5活动广场运行时生成不完整');
  }
  write(file, next);
}

{
  const { file, source } = read('templates/plaza-mobile-page.txt');
  const next = patchPlazaPage(source, '活动广场模板');
  if (!next.includes(marker)) throw new Error('活动广场模板V5标记缺失');
  write(file, next);
}

await import('./apply-checkin-window-upload-plaza-page-v1.mjs');
await import('./finalize-checkin-settings-v1.mjs');
await import('./finalize-plaza-detail-page-v1.mjs');

console.log('Applied mobile real-under-1s V5: immediate post-paint Plaza warmup, authoritative check-in settings, 960px card-first rendering and deferred 2048px display warmup.');
