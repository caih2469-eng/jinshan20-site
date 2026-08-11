import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

const read = (file) => fs.readFileSync(file, 'utf8');
const runGenerator = (file) => execFileSync(process.execPath, [file], { stdio: 'pipe' });

runGenerator('scripts/apply-plaza-detail-fast-path.mjs');
runGenerator('scripts/apply-plaza-mobile-layout.mjs');
runGenerator('scripts/finalize-plaza-performance-quality-v3.mjs');
runGenerator('scripts/apply-critical-path-p95-v4.mjs');
runGenerator('scripts/apply-mobile-real-under-1s-v5.mjs');

const app = read('public/app.js');
const bootstrap = read('public/bootstrap.js');
const entrance = read('public/entrance.js');
const plazaPageTemplate = read('templates/plaza-mobile-page.txt');
const plazaRoute = read('cloudflare/routes/plaza.js');
const packageJson = JSON.parse(read('package.json'));

test('activity plaza detail opens from cached list preview before the full request finishes', () => {
  assert.match(app, /PLAZA_DETAIL_INSTANT_OPEN_V2/);
  assert.match(app, /PLAZA_PERFORMANCE_QUALITY_V3/);
  assert.match(app, /const previewPost = readPlazaPostPreview\(postId\)/);
  assert.doesNotMatch(app, /正在补齐成员与全部图片/);
  assert.match(app, /formatDate\(previewPost\.publishedAt\)/);
  assert.match(app, /plaza-detail-preview-visible/);
  assert.match(app, /previewHit: Boolean\(previewPost\)/);
  assert.match(app, /previewImage\.displayUrl/);
  assert.match(app, /srcset="[^\n]*960w,[^\n]*2048w"/);
});

test('first-screen plaza cards start immediately with 960px list images only', () => {
  assert.match(app, /MOBILE_REAL_UNDER_1S_V5/);
  assert.match(app, /cardIndex < 4 \? 'eager' : 'lazy'/);
  assert.match(app, /cardIndex < 2 \? 'high' : cardIndex < 4 \? 'auto' : 'low'/);
  assert.match(app, /cardIndex < 4 \? 'high' : 'low'/);
  assert.match(app, /cardIndex < 4[\s\S]{0,160}\? `src="\$\{escapeHtml\(post\.images\[0\]\.thumbUrl \|\| post\.images\[0\]\.imageUrl\)\}"`/);
  assert.doesNotMatch(app, /cardIndex < 4[\s\S]{0,500}(?:srcset|2048w)/);
  assert.match(plazaPageTemplate, /PLAZA_PERFORMANCE_QUALITY_V3/);
  assert.match(plazaPageTemplate, /MOBILE_REAL_UNDER_1S_V5/);
  assert.match(plazaPageTemplate, /cardIndex < 4/);
  assert.doesNotMatch(plazaPageTemplate, /cardIndex < 4[\s\S]{0,500}(?:srcset|2048w)/);
});

test('detail metadata is warmed immediately for visible cards without waiting for idle time', () => {
  assert.match(app, /warmVisiblePlazaDetails/);
  assert.match(app, /slice\(0, 4\)/);
  assert.match(app, /connection\.saveData/);
  assert.match(app, /const delay = index < 2 \? index \* 40 : 220/);
  assert.match(app, /queueMicrotask\(run\)/);
  assert.match(app, /scheduleVisiblePlazaDetailWarmup\(\);/);
  assert.match(app, /document\.addEventListener\('pointerdown', prefetch/);
  assert.match(app, /document\.addEventListener\('pointerover', prefetch/);
  assert.match(app, /document\.addEventListener\('focusin', prefetch/);
  assert.doesNotMatch(app, /PLAZA_DETAIL_INSTANT_OPEN_V2[\s\S]*new MutationObserver/);
});

test('detail image and comment scheduling prioritize visible high-quality post content', () => {
  const detailStart = app.indexOf('async function openPlazaPost');
  const detailEnd = app.indexOf('\nfunction ', detailStart + 1);
  const detail = app.slice(detailStart, detailEnd > detailStart ? detailEnd : undefined);
  assert.match(detail, /imageIndex === 0/);
  assert.match(detail, /image\.displayUrl/);
  assert.match(detail, /960w,[^\n]*2048w/);
  assert.match(detail, /post\.images\.slice\(0, 2\)/);
  assert.match(detail, /const warmDisplayImages = \(\) =>/);
  assert.match(detail, /preload\.fetchPriority = 'low'/);
  assert.match(detail, /requestIdleCallback\(warmDisplayImages, \{ timeout: 1800 \}\)/);
  assert.match(detail, /setTimeout\(warmDisplayImages, 1200\)/);
  assert.doesNotMatch(detail, /preload\.fetchPriority = imageIndex === 0 \? 'high' : 'low'/);
  const visibleMetric = detail.indexOf("recordPerf('plaza-detail-visible'");
  const commentsRequest = detail.indexOf('/comments?page=1&limit=10');
  assert.ok(visibleMetric >= 0, '缺少详情可见指标');
  assert.ok(commentsRequest > visibleMetric, '评论请求必须在详情可见后启动');
});

test('fresh plaza cache renders first and delays refresh so images keep the critical bandwidth', () => {
  assert.match(app, /const VIEW_CACHE_TTL_MS = 60_000/);
  assert.match(app, /setTimeout\(\(\) => \{ void refresh\(\); \}, 3200\)/);
  assert.doesNotMatch(app, /cacheIsFresh\(cached\)\) queueMicrotask\(\(\) => \{ void refresh\(\); \}\)/);
  assert.match(plazaPageTemplate, /setTimeout\(\(\) => \{ void refresh\(\); \}, 3200\)/);
});

test('authenticated home starts 960px Plaza warmup after first paint and reuses the in-flight promise', () => {
  assert.match(bootstrap, /PLAZA_PERFORMANCE_QUALITY_V3/);
  assert.match(bootstrap, /STRICT_P95_BOOTSTRAP_V4/);
  assert.match(bootstrap, /window\.__BOOTSTRAP_PLAZA_PROMISE__ = Promise\.resolve\(null\)/);
  assert.match(bootstrap, /window\.__BOOTSTRAP_PLAZA_IMAGES__ = \[\]/);
  assert.doesNotMatch(bootstrap, /fetch\('\/api\/plaza\?sort=latest&page=1&limit=20'/);
  assert.match(app, /STRICT_P95_APP_PREFETCH_V4/);
  assert.match(app, /void startPlazaPrefetch\(\);/);
  assert.doesNotMatch(app, /requestIdleCallback\(startPlazaPrefetch/);
  assert.doesNotMatch(app, /setTimeout\(startPlazaPrefetch, 500\)/);
  assert.match(app, /window\.__BOOTSTRAP_PLAZA_PROMISE__ = studentPlazaPrefetchPromise/);
  assert.match(app, /\(result\.posts \|\| \[\]\)\.slice\(0, 4\)/);
  assert.match(app, /preload\.fetchPriority = index < 2 \? 'high' : 'auto'/);
  const prefetchStart = app.indexOf('const prefetchStudentPlaza');
  const prefetchEnd = app.indexOf('\nasync function', prefetchStart + 1);
  assert.ok(prefetchStart >= 0, '缺少活动广场首页预取函数');
  const prefetch = app.slice(prefetchStart, prefetchEnd > prefetchStart ? prefetchEnd : undefined);
  assert.doesNotMatch(prefetch, /srcset|2048w/);
  assert.match(app, /const firstPagePromise = safeSort === 'latest' && page === 1 && !safeQuery/);
  assert.match(app, /studentPlazaPrefetchPromise \|\| prefetchStudentPlaza\(\)/);
  assert.match(app, /const preloadedResult = firstPagePromise/);
  assert.match(app, /window\.__BOOTSTRAP_PLAZA_PROMISE__/);
  assert.match(app, /const result = preloadedResult \|\| await api\(path\)/);
  assert.match(plazaPageTemplate, /window\.__BOOTSTRAP_PLAZA_PROMISE__/);
});

test('all lifecycle generator chains run V5 last', () => {
  for (const scriptName of ['prestart', 'precheck', 'pretest', 'prepare:image-pipeline']) {
    const script = packageJson.scripts[scriptName];
    assert.ok(script.includes('apply-mobile-real-under-1s-v5.mjs'), `${scriptName} 缺少V5最终覆盖层`);
    assert.ok(
      script.lastIndexOf('apply-mobile-real-under-1s-v5.mjs') > script.lastIndexOf('apply-critical-path-p95-v4.mjs'),
      `${scriptName} 必须在V4之后执行V5`
    );
  }
  assert.match(packageJson.scripts.check, /node --check scripts\/apply-mobile-real-under-1s-v5\.mjs/);
});

test('login form is immediately usable instead of waiting for the cinematic intro', () => {
  assert.match(entrance, /STRICT_P95_LOGIN_READY_V4/);
  assert.match(entrance, /uiLayer\.style\.transition = 'none'/);
  assert.match(entrance, /uiLayer\.style\.opacity = '1'/);
  assert.match(entrance, /intro\.style\.pointerEvents = 'none'/);
  assert.doesNotMatch(entrance, /setTimeout\(\(\) => \{[\s\S]*?uiLayer\.style\.opacity = '1'[\s\S]*?\}, 800\)/);
});

test('detail counts combine liked state into the existing aggregate query', () => {
  assert.match(plazaRoute, /PLAZA_DETAIL_INSTANT_OPEN_V2/);
  assert.match(plazaRoute, /EXISTS\(SELECT 1 FROM plaza_likes WHERE post_id=\?1 AND user_id=\?2\) AS liked/);
  assert.match(plazaRoute, /liked: Boolean\(counts\.liked\)/);
  assert.doesNotMatch(plazaRoute, /const \[members, images, counts, liked\]/);
  assert.doesNotMatch(plazaRoute, /SELECT 1 AS liked FROM plaza_likes WHERE post_id=\?1 AND user_id=\?2/);
});

test('plaza performance generators remain idempotent across runtime, templates and converged tests', () => {
  const targets = [
    'public/app.js',
    'public/bootstrap.js',
    'public/entrance.js',
    'templates/plaza-mobile-page.txt',
    'cloudflare/routes/plaza.js',
    'test/stage-e-ui-cache-navigation.test.js',
    'test/approved-mobile-experience.test.js'
  ];
  const before = new Map(targets.map(target => [target, read(target)]));

  runGenerator('scripts/apply-plaza-detail-fast-path.mjs');
  runGenerator('scripts/apply-plaza-mobile-layout.mjs');
  runGenerator('scripts/finalize-plaza-performance-quality-v3.mjs');
  runGenerator('scripts/apply-critical-path-p95-v4.mjs');
  runGenerator('scripts/apply-mobile-real-under-1s-v5.mjs');

  for (const target of targets) {
    assert.equal(read(target), before.get(target), `${target} 在重复生成后发生变化`);
  }
});
