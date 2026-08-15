import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('管理员用户卡片点击后立即打开打卡抽屉，不再等待全部队伍和任务', () => {
  const app = read('public/app.js') + '\n' + read('public/admin-client.js');
  const panelStart = app.indexOf('const renderAdminUserPanel');
  const panelEnd = app.indexOf('async function refreshCompactAdminUsers', panelStart);
  const panel = app.slice(panelStart, panelEnd);
  assert.match(panel, /openAdminUserDrawer\(studentUser, date\)/);
  assert.doesNotMatch(panel, /loadCompactAdminTeams\(\)/);
  assert.doesNotMatch(panel, /api\('\/api\/admin\/tasks'\)/);
  assert.doesNotMatch(panel, /beginButtonLoading\(button/);
});

test('打卡抽屉优先显示打卡记录、保留按需管理功能并提供一分钟缓存和请求去重', () => {
  const adminClient = read('public/admin-client.js');
  const start = adminClient.indexOf('/* MOBILE_ADMIN_PHOTO_FIX_V1 */');
  const end = adminClient.indexOf('function taskFormFields', start);
  assert.ok(start >= 0 && end > start, '按需后台打卡抽屉边界不完整');
  const drawer = adminClient.slice(start, end);
  assert.match(drawer, /ADMIN_CHECKIN_CACHE_TTL_MS = 60_000/);
  assert.match(drawer, /adminCheckinInflight/);
  assert.match(drawer, /admin-checkin-photo-grid/);
  assert.match(drawer, /基本资料|所属队伍|补卡权限|管理操作/);
  assert.match(drawer, /loadManagementData/);
  assert.doesNotMatch(drawer, /new Image\(\)/);
});

test('管理端列表图使用960px Pica/WebP并与媒体服务限制一致', () => {
  const app = read('public/app.js');
  const media = read('cloudflare/routes/media.js');
  assert.match(app, /\/\* PICA_IMAGE_PIPELINE_V1 \*\//);
  assert.match(app, /PICA_THUMB_MAX_EDGE = 960/);
  assert.match(app, /PICA_DISPLAY_MAX_EDGE = 2048/);
  assert.match(app, /quality: screenshotLike \? 0\.92 : 0\.88/);
  assert.match(app, /prepareImageVariantsMeasured\((?:sourceFile|selected\[index\])/);
  assert.match(app, /uploadPreparedImagePair\(prepared,/);
  assert.match(app, /confirmPreparedImagePair\(/);
  assert.match(app, /api\('\/api\/media\/upload-pairs\/confirm'/);
  assert.doesNotMatch(app, /confirmVariantUpload\(thumbIntent, prepared\.thumb, display\.mediaId, signal\)/);
  assert.match(media, /THUMB_MAX_EDGE = 960/);
  assert.match(media, /PLAZA_THUMB_MAX_EDGE = 960/);
  assert.match(media, /DISPLAY_MAX_EDGE = 2048/);
});

test('手机管理端头部使用两列紧凑按钮并让退出独占一行', () => {
  const css = read('public/admin-dashboard-refactor.css');
  assert.match(css, /\.admin-header-actions \{ display: grid; grid-template-columns: repeat\(2/);
  assert.match(css, /\.admin-header-actions #out \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /min-height: 52px/);
});

test('媒体签名复用导入后的HMAC密钥', () => {
  const signing = read('cloudflare/lib/media-signing.js');
  assert.match(signing, /let hmacKeyPromise = null/);
  assert.match(signing, /if \(!hmacKeyPromise \|\| hmacKeySecret !== secret\)/);
});

test('管理员540px缩略图回填脚本具备正式环境双重确认和原图保护', () => {
  const script = read('scripts/backfill-admin-thumbnails-540.mjs');
  assert.match(script, /--confirm-production jinshan20/);
  assert.match(script, /withoutEnlargement: true/);
  assert.match(script, /oldThumbObjectKeysPreserved/);
  assert.match(script, /admin-thumbs-540-v1/);
  assert.match(script, /encode\(540, 84\)/);
  assert.doesNotMatch(script, /r2', 'object', 'delete/);
});
