const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');

test('同一张照片的高清图与列表图并行申请并行直传', () => {
  const runtime = read('templates/pica-image-pipeline-runtime.txt');
  const genericFlow = read('templates/pica-generic-upload-flow.txt');
  const memberFlow = read('templates/pica-member-upload-flow.txt');

  assert.match(runtime, /const form = new FormData\(\)/);
  assert.match(runtime, /form\.append\('display', prepared\.display\.file/);
  assert.match(runtime, /form\.append\('thumb', prepared\.thumb\.file/);
  assert.match(runtime, /api\('\/api\/media\/upload-pairs\/direct'/);
  assert.doesNotMatch(runtime, /requestVariantUploadIntent\(/);
  assert.doesNotMatch(runtime, /confirmPreparedImagePair\(/);
  assert.match(genericFlow, /uploadPreparedImagePair\(prepared/);
  assert.match(memberFlow, /uploadPreparedImagePair\(prepared/);
  assert.doesNotMatch(genericFlow, /uploadCompressedImage\(prepared\.(?:display|thumb)/);
  assert.doesNotMatch(memberFlow, /uploadCompressedImage\(prepared\.(?:display|thumb)/);
});

test('活动广场采用移动端双列瀑布流并移除旧横幅与月度排行', () => {
  const page = read('templates/plaza-mobile-page.txt');
  const style = read('templates/plaza-mobile-style.css');

  assert.match(page, /id="backHome"/);
  assert.match(page, /id="togglePlazaSearch"/);
  assert.match(page, /id="plazaSearchInput"/);
  assert.match(page, /data-sort="latest"/);
  assert.match(page, /data-sort="hot"/);
  assert.doesNotMatch(page, /四校区活动广场/);
  assert.doesNotMatch(page, /月度排行/);
  assert.doesNotMatch(page, /plazaMonth/);
  assert.match(style, /column-count:\s*2/);
  assert.match(style, /break-inside:\s*avoid/);
  assert.match(style, /position:\s*sticky/);
  assert.match(style, /body\[data-view="plaza"\]/);
});

test('活动广场搜索由Cloudflare路由跨队伍任务发布人和正文执行', () => {
  const route = read('templates/plaza-route-search.txt');
  assert.match(route, /url\.searchParams\.get\('q'\)/);
  assert.match(route, /t\.name LIKE \?2/);
  assert.match(route, /task\.name LIKE \?2/);
  assert.match(route, /p\.copy_text LIKE \?2/);
  assert.match(route, /search_u\.name LIKE \?2/);
  assert.match(route, /query:\s*search/);
  assert.doesNotMatch(route, /INSERT|UPDATE|DELETE/);
});

test('生成器只修改图片上传和活动广场相关目标', () => {
  const generator = read('scripts/apply-plaza-mobile-layout.mjs');
  assert.match(generator, /public\/app\.js/);
  assert.match(generator, /public\/style\.css/);
  assert.match(generator, /cloudflare\/routes\/plaza\.js/);
  assert.match(generator, /test\/member-checkin-fast\.test\.js/);
  assert.doesNotMatch(generator, /login|password|team_members\s*=|migrations\//i);
});
