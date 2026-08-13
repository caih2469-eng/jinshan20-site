import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');

test('图片链路使用960px列表图和2048px高清图，旧数据继续使用720px回填', () => {
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
});

test('用户首页四入口等宽同排并保留个人与队伍历史查看', () => {
  const app = read('public/app.js');
  const style = read('public/style.css');
  const studentBody = app.match(/async function student\([\s\S]*?\r?\n}\r?\n\r?\nfunction openStudentCheckinHistory/)?.[0] || '';
  assert.match(app, /<strong>个人累计<\/strong>/);
  assert.match(app, /<strong>活动广场<\/strong>/);
  assert.match(app, /<strong>信息箱<\/strong>/);
  assert.match(app, /<strong>队伍累计<\/strong>/);
  assert.match(app, /openStudentCheckinHistory/);
  assert.match(app, /openTeamCheckinHistory/);
  assert.match(app, /\/api\/team-checkins\/history/);
  assert.match(style, /grid-template-columns:\s*repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(studentBody, /<h2>队伍成员<\/h2>/);
  assert.doesNotMatch(studentBody, /我的资料|查看排行榜|最终截图证明|team-summary|邀请码/);
});

test('队伍必须全员完成后才能汇总且只有队长可提交', () => {
  const app = read('public/app.js');
  const student = read('cloudflare/routes/student.js');
  assert.match(app, /所有队员完成当天个人打卡后，队长才能汇总提交/);
  assert.match(student, /只有队长可以提交队伍作品/);
  assert.match(student, /COUNT\(DISTINCT user_id\) AS completed FROM member_checkins/);
  assert.match(student, /需所有队员完成当天个人打卡后才能汇总提交/);
});

test('队伍草稿可继续编辑并删除广场二次文案字段', () => {
  const app = read('public/app.js');
  const student = read('cloudflare/routes/student.js');
  const plazaBody = app.match(/\/\* PLAZA_MOBILE_LAYOUT_V1 \*\/[\s\S]*?async function plaza/)?.[0] || '';
  assert.match(app, /已保存队伍作品/);
  assert.doesNotMatch(app, /广场作品文案（发布时必填）/);
  assert.doesNotMatch(app, /id="plazaCopyField"/);
  assert.match(app, /plazaCopy: form\.copy\.value/);
  assert.match(student, /const plazaCopy = cleanText\(body\.copy, 2000\)/);
  assert.doesNotMatch(student, /请填写广场作品文案/);
  assert.match(plazaBody, /<h2>\$\{escapeHtml\(post\.teamName\)\}<\/h2>/);
  assert.match(plazaBody, /plaza-channel-tabs/);
  assert.match(plazaBody, /togglePlazaSearch/);
  assert.doesNotMatch(plazaBody, /四校区活动广场|月度排行|id="plazaMonth"/);
});

test('管理端打卡设置紧凑且帖子固定六列', () => {
  const app = read('public/app.js') + '\n' + read('public/admin-client.js');
  const style = read('public/style.css');
  assert.match(app, /class="[^"]*\badmin-post-grid\b[^"]*"/);
  assert.match(style, /\.admin-post-grid[\s\S]*grid-template-columns:\s*repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(style, /checkin-settings-form input\[type="checkbox"\][\s\S]*width:\s*18px/);
  assert.match(style, /weekday-options[\s\S]*repeat\(7,minmax\(0,1fr\)\)/);
});
