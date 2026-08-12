import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appPath = path.join(root, 'public/app.js');
const templatePath = path.join(root, 'templates/plaza-mobile-page.txt');
const testPath = path.join(root, 'test/stage-e-ui-cache-navigation.test.js');
const mobileTestPath = path.join(root, 'test/approved-mobile-experience.test.js');
const layoutTestPath = path.join(root, 'test/approved-layout-team-draft-720.test.js');
const mobileAdminTestPath = path.join(root, 'test/mobile-admin-photo-fix.test.js');
const title = '阶段E：广场和评论管理缓存仅存于页面内存并按用户隔离';
const mobileTitle = '活动广场、历史打卡和管理员列表图统一使用960px Pica链路';
const legacyMobileTitle = '活动广场、历史打卡和管理员打卡统一640px WebP缩略图';
const layoutTitle = '图片链路使用960px列表图和2048px高清图，旧数据继续使用720px回填';
const legacyLayoutTitle = '本轮限定区域使用720px WebP缩略图且不再保留640px生成常量';
const adminBackfillTitle = '管理员540px缩略图回填脚本具备正式环境双重确认和原图保护';
const legacyAdminBackfillTitle = '640px缩略图回填脚本具备正式环境双重确认和原图保护';

const app = fs.readFileSync(appPath, 'utf8');
const template = fs.readFileSync(templatePath, 'utf8');
let testSource = fs.readFileSync(testPath, 'utf8');
let mobileTestSource = fs.readFileSync(mobileTestPath, 'utf8');
let layoutTestSource = fs.readFileSync(layoutTestPath, 'utf8');
let mobileAdminTestSource = fs.readFileSync(mobileAdminTestPath, 'utf8');

if (!app.includes('/* PLAZA_PERFORMANCE_QUALITY_V3 */')
    || !template.includes('/* PLAZA_PERFORMANCE_QUALITY_V3 */')
    || !app.includes('const VIEW_CACHE_TTL_MS = 60_000;')
    || !app.includes('cardIndex < 4')
    || !app.includes('2048w')) {
  throw new Error('活动广场性能与画质V3运行时尚未完成，停止收敛测试');
}

const testBlockPattern = (testTitle) => {
  const escapedTitle = testTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`test\\('${escapedTitle}',[\\s\\S]*?\\r?\\n\\}\\);`);
};

const replaceNamedTest = (source, candidateTitles, replacement, label) => {
  for (const candidateTitle of candidateTitles) {
    const pattern = testBlockPattern(candidateTitle);
    if (pattern.test(source)) {
      return source.replace(pattern, () => replacement);
    }
  }
  throw new Error(`${label}锚点未找到`);
};

const replacement = String.raw`test('阶段E：广场和评论管理缓存仅存于页面内存并按用户隔离', () => {
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
});`;

testSource = replaceNamedTest(
  testSource,
  [title],
  replacement,
  '活动广场阶段E缓存测试'
);
fs.writeFileSync(testPath, testSource, 'utf8');

const mobileReplacement = String.raw`test('活动广场、历史打卡和管理员列表图统一使用960px Pica链路', () => {
  const app = read('public/app.js') + '\n' + read('public/admin-client.js');
  const style = read('public/style.css');
  const media = read('cloudflare/routes/media.js');
  const backfill = read('scripts/backfill-admin-thumbnails-540.mjs');
  const plazaBody = app.match(/\/\* PLAZA_MOBILE_LAYOUT_V1 \*\/[\s\S]*?async function plaza/)?.[0] || '';
  assert.match(app, /PICA_THUMB_MAX_EDGE = 960/);
  assert.match(app, /PICA_DISPLAY_MAX_EDGE = 2048/);
  assert.match(app, /data-perf-image="history-thumb"/);
  assert.match(plazaBody, /data-perf-image="plaza-thumb"/);
  assert.match(plazaBody, /data-priority=/);
  assert.match(plazaBody, /cardIndex < 4 \? 'eager' : 'lazy'/);
  assert.match(plazaBody, /cardIndex < 2 \? 'high' : cardIndex < 4 \? 'auto' : 'low'/);
  assert.match(plazaBody, /cardIndex < 4 \? 'high' : 'low'/);
  assert.match(app, /data-perf-image="admin-checkin-thumb"/);
  assert.match(style, /column-count:\s*2/);
  assert.match(media, /THUMB_MAX_EDGE = 960/);
  assert.match(media, /PLAZA_THUMB_MAX_EDGE = 960/);
  assert.match(media, /DISPLAY_MAX_EDGE = 2048/);
  assert.match(backfill, /admin-thumbs-540-v1/);
  assert.match(backfill, /encode\(540, 84\)/);
});`;

mobileTestSource = replaceNamedTest(
  mobileTestSource,
  [mobileTitle, legacyMobileTitle],
  mobileReplacement,
  '活动广场图片优先级测试'
);
fs.writeFileSync(mobileTestPath, mobileTestSource, 'utf8');

const layoutReplacement = String.raw`test('图片链路使用960px列表图和2048px高清图，旧数据继续使用720px回填', () => {
  const app = read('public/app.js');
  const media = read('cloudflare/routes/media.js');
  const backfill = read('scripts/backfill-approved-thumbnails-720.mjs');
  assert.match(app, /PICA_THUMB_MAX_EDGE = 960/);
  assert.match(app, /PICA_DISPLAY_MAX_EDGE = 2048/);
  assert.match(media, /THUMB_MAX_EDGE = 960/);
  assert.match(media, /PLAZA_THUMB_MAX_EDGE = 960/);
  assert.match(media, /DISPLAY_MAX_EDGE = 2048/);
  assert.match(backfill, /APPROVED_720PX_BACKFILL_V1/);
  assert.match(backfill, /thumbs-720-v1/);
  assert.match(backfill, /encode\(720, 84\)/);
});`;

layoutTestSource = replaceNamedTest(
  layoutTestSource,
  [layoutTitle, legacyLayoutTitle],
  layoutReplacement,
  '独立720px历史回填测试'
);
fs.writeFileSync(layoutTestPath, layoutTestSource, 'utf8');

const mobileAdminBackfillReplacement = String.raw`test('管理员540px缩略图回填脚本具备正式环境双重确认和原图保护', () => {
  const script = read('scripts/backfill-admin-thumbnails-540.mjs');
  assert.match(script, /--confirm-production jinshan20/);
  assert.match(script, /withoutEnlargement: true/);
  assert.match(script, /oldThumbObjectKeysPreserved/);
  assert.match(script, /admin-thumbs-540-v1/);
  assert.match(script, /encode\(540, 84\)/);
  assert.doesNotMatch(script, /r2', 'object', 'delete/);
});`;

mobileAdminTestSource = replaceNamedTest(
  mobileAdminTestSource,
  [adminBackfillTitle, legacyAdminBackfillTitle],
  mobileAdminBackfillReplacement,
  '管理员540px回填测试'
);
fs.writeFileSync(mobileAdminTestPath, mobileAdminTestSource, 'utf8');

if (!testSource.includes('const VIEW_CACHE_TTL_MS = 60_000;')
    || !testSource.includes('assert.match(appSource, /const rankingViewCache')
    || !testSource.includes("scopedCacheKey\\('plaza', safeSort, page, safeQuery\\)")
    || !mobileTestSource.includes("cardIndex < 4 \\? 'eager' : 'lazy'")
    || !mobileTestSource.includes("cardIndex < 2 \\? 'high' : cardIndex < 4 \\? 'auto' : 'low'")
    || !mobileTestSource.includes("cardIndex < 4 \\? 'high' : 'low'")
    || !mobileTestSource.includes('admin-thumbs-540-v1')
    || !mobileTestSource.includes('encode\\(540, 84\\)')
    || !layoutTestSource.includes('backfill-approved-thumbnails-720.mjs')
    || !layoutTestSource.includes('encode\\(720, 84\\)')
    || !mobileAdminTestSource.includes('admin-thumbs-540-v1')
    || !mobileAdminTestSource.includes('encode\\(540, 84\\)')) {
  throw new Error('活动广场V3测试收敛失败');
}

console.log('Finalized plaza V3 runtime, cache and image-priority assertions after mobile layout generation.');
