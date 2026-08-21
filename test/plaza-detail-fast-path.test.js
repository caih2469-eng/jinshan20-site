import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const readApp = () => fs.readFileSync('public/app.js', 'utf8');
const detailBody = (app) => app.match(
  /async function openPlazaPost\([\s\S]*?\n\}\n\nfunction checkinForm/
)?.[0] || '';

test('活动广场详情使用已提交的快速路径源码', () => {
  const app = readApp();
  assert.match(app, /\/\* PLAZA_DETAIL_FAST_PATH_V1 \*\//);
});

test('作品主体先于评论完成渲染，评论失败不再拖垮详情', () => {
  const app = readApp();
  const detail = detailBody(app);
  assert.ok(detail.length > 0, '未找到活动广场详情函数');
  assert.match(detail, /let commentsPromise = null;/);
  assert.match(detail, /commentsPromise = api\(`/);
  const detailVisibleIndex = detail.indexOf("recordPerf('plaza-detail-visible'");
  const commentsRequestIndex = detail.indexOf('commentsPromise = api(`');
  assert.ok(detailVisibleIndex >= 0, '缺少详情可见性能指标');
  assert.ok(commentsRequestIndex > detailVisibleIndex, '评论请求必须在详情主体可见后启动');
  assert.match(detail, /\.catch\(\(error\) => \(\{ result: null, error \}\)\)/);
  assert.match(detail, /post = await loadPlazaPost\(postId\)/);
  assert.match(detail, /评论加载中…/);
  assert.match(detail, /void commentsPromise\.then\(\(\{ result, error \}\) => \{/);
  assert.match(detail, /if \(error\) showCommentsError\(error\)/);
  assert.doesNotMatch(detail, /await Promise\.all\(\[detailPromise, commentsPromise\]\)/);
  assert.doesNotMatch(detail, /\[\{ post \}, commentResult\] = await Promise\.all/);
});

test('详情采用短期缓存、并发复用并在退出时完整清理', () => {
  const app = readApp();
  assert.match(app, /const PLAZA_POST_CACHE_TTL_MS = 30_000/);
  assert.match(app, /const plazaPostCache = new Map\(\)/);
  assert.match(app, /const plazaPostInflight = new Map\(\)/);
  assert.match(app, /if \(plazaPostInflight\.has\(key\)\) return plazaPostInflight\.get\(key\)/);
  assert.match(app, /plazaPostCache\.clear\(\)/);
  assert.match(app, /plazaPostInflight\.clear\(\)/);
  assert.match(app, /plazaPostCacheGeneration \+= 1/);
});

test('详情首图优先加载且浏览量写入延后到首屏绘制之后', () => {
  const app = readApp();
  const detail = detailBody(app);
  assert.match(detail, /post\.images\.map\(\(image, imageIndex\) =>/);
  assert.match(detail, /data-priority="\$\{imageIndex === 0 \? 'high' : 'low'\}"/);
  assert.match(detail, /loading="\$\{imageIndex === 0 \? 'eager' : 'lazy'\}"/);
  assert.match(detail, /fetchpriority="\$\{imageIndex === 0 \? 'high' : 'low'\}"/);
  assert.match(detail, /requestAnimationFrame\(\(\) => \{\s*setTimeout\(\(\) => \{/);
  assert.match(detail, /api\(`\/api\/plaza\/\$\{postId\}\/view`/);
});

test('移动端瀑布流卡片同步不存在空节点写入异常', () => {
  const app = readApp();
  const updater = app.match(
    /const updateVisiblePlazaCard = \(postId, updates\) => \{[\s\S]*?\n\};/
  )?.[0] || '';
  assert.match(updater, /if \(target && value != null\) target\.textContent = value/);
  assert.match(updater, /card\.querySelector\('\.plaza-like > span:last-child'\)/);
  assert.doesNotMatch(updater, /querySelector\('\[data-plaza-likes\]'\)\.textContent/);
});
