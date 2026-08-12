const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(root, 'public', 'admin-client.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(root, 'public', 'style.css'), 'utf8');

const sourceBetween = (start, end) => {
  const startIndex = appSource.indexOf(start);
  const endIndex = appSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `缺少代码段起点：${start}`);
  assert.notEqual(endIndex, -1, `缺少代码段终点：${end}`);
  return appSource.slice(startIndex, endIndex);
};

const sourceFrom = (start, end) => {
  const startIndex = appSource.indexOf(start);
  const endIndex = appSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `缺少代码段起点：${start}`);
  return appSource.slice(startIndex, endIndex > startIndex ? endIndex : undefined);
};

test('阶段E：广场和评论管理缓存仅存于页面内存并按用户隔离', () => {
  assert.match(appSource, /const VIEW_CACHE_TTL_MS = 60_000;/);
  assert.match(appSource, /const plazaViewCache = new Map\(\);/);
  assert.match(appSource, /const rankingViewCache = new Map\(\);/);
  assert.match(adminSource, /async function adminComments\(page = 1\)/);
  assert.match(appSource, /const scopedCacheKey = \(\.\.\.parts\) => \[/);
  assert.match(appSource, /user\?\.id \|\| user\?\.studentId \|\| 'anonymous'/);
  assert.match(appSource, /\]\.join\('\|'\);/);
  assert.match(appSource, /scopedCacheKey\('plaza', safeSort, page, safeQuery\)/);
  assert.match(appSource, /q=\$\{encodeURIComponent\(safeQuery\)\}/);
  const cacheBlock = sourceBetween('const VIEW_CACHE_TTL_MS', 'const clearUserViewCaches');
  assert.doesNotMatch(cacheBlock, /localStorage|sessionStorage/);
});

test('阶段E：学生从新鲜广场缓存即时渲染，后台刷新延后避免抢占首屏图片带宽', () => {
  const plazaBlock = sourceBetween('async function plaza', 'function rankingTable');
  assert.match(plazaBlock, /if \(cached\) \{/);
  assert.match(plazaBlock, /renderPlazaPage\(cached\.data/);
  assert.match(plazaBlock, /if \(cacheIsFresh\(cached\)\) \{/);
  assert.match(plazaBlock, /setTimeout\(\(\) => \{ void refresh\(\); \}, 3200\)/);
  assert.doesNotMatch(plazaBlock, /cacheIsFresh\(cached\)\) queueMicrotask/);
});

test('阶段E：广场首屏复用启动预取并提升未降质的首图传输优先级', () => {
  const plazaBlock = sourceBetween('async function plaza', 'function rankingTable');
  assert.match(plazaBlock, /studentPlazaPrefetchPromise \|\| prefetchStudentPlaza\(\)/);
  assert.match(plazaBlock, /const preloadedResult = firstPagePromise/);
  assert.match(appSource, /2048w/);
  assert.match(appSource, /preload\.fetchPriority = index < 2 \? 'high' : 'auto'/);
});

test('阶段E：广场详情主体优先显示，评论与浏览计数均不阻塞，独立页面通过历史记录返回列表', () => {
  const block = sourceFrom('async function openPlazaPost', 'function checkinForm');
  assert.match(block, /let commentsPromise = null;/);
  assert.match(block, /commentsPromise = api\(`/);
  const detailVisibleIndex = block.indexOf("recordPerf('plaza-detail-visible'");
  const commentsRequestIndex = block.indexOf('commentsPromise = api(`');
  assert.ok(detailVisibleIndex >= 0, '缺少详情可见性能指标');
  assert.ok(commentsRequestIndex > detailVisibleIndex, '评论请求必须在详情主体可见后启动');
  assert.match(block, /post = await loadPlazaPost\(postId\)/);
  assert.match(block, /评论加载中…/);
  assert.match(block, /void commentsPromise\.then\(\(\{ result, error \}\) => \{/);
  assert.doesNotMatch(block, /Promise\.all\(\[detailPromise, commentsPromise\]\)/);
  assert.match(block, /requestAnimationFrame\(\(\) => \{\s*setTimeout\(\(\) => \{/);
  assert.match(block, /void api\(`\/api\/plaza\/\$\{postId\}\/view`/);
  assert.doesNotMatch(block, /await api\(`\/api\/plaza\/\$\{postId\}\/view`/);
  assert.match(block, /countedPlazaViews\.has\(viewKey\)/);
  assert.match(block, /const root = app;/);
  assert.match(block, /history\.pushState/);
  assert.match(block, /history\.back\(\)/);
  assert.doesNotMatch(block, /modal-backdrop/);
  const closeBlock = block.slice(block.indexOf('const closePost'), block.indexOf('root.querySelector', block.indexOf('const closePost')));
  assert.doesNotMatch(closeBlock, /\bplaza\s*\(/);
  assert.match(appSource, /const restorePlazaListFromHistory = \(state\) => \{/);
  assert.match(appSource, /window\.scrollTo\(0, scrollY\)/);
});

test('阶段E：学生成功操作局部更新、轻提示并后台刷新，不直接重载首页', () => {
  assert.match(appSource, /const returnToCachedStudentHome =/);
  assert.match(appSource, /提交成功，但最新数据刷新失败，可稍后重新进入查看。/);
  assert.match(appSource, /patchStudentTask\(/);
  assert.match(appSource, /patchStudentMaterialTask\(/);
  assert.ok((appSource.match(/returnToCachedStudentHome\(/g) || []).length >= 4);
  assert.match(appSource, /草稿已保存/);
  assert.match(appSource, /最终提交成功/);
  assert.match(appSource, /个人打卡成功/);
  assert.match(appSource, /材料提交成功/);
});

test('阶段E：写操作按钮即时进入忙碌状态，提示和缓存异常均有移动端样式', () => {
  assert.match(appSource, /const beginButtonLoading =/);
  assert.match(appSource, /button\.dataset\.loading === 'true'/);
  assert.match(appSource, /button\.disabled = true/);
  assert.match(appSource, /aria-live/);
  assert.match(styleSource, /\.toast-region\s*\{/);
  assert.match(styleSource, /\.app-toast\.visible\s*\{/);
  assert.match(styleSource, /\.view-cache-status\s*\{/);
  assert.match(styleSource, /\.plaza-detail-placeholder\s*\{/);
});
