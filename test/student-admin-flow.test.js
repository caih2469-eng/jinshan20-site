const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');

test('student home keeps only confirmed shortcuts, team members and check-in', () => {
  const app = read('public/app.js');
  const studentBody = app.match(/async function student\([\s\S]*?\r?\n\}\r?\n\r?\nfunction openStudentCheckinHistory/)?.[0]
    || app.match(/async function home\([\s\S]*?\r?\n\}\r?\n\r?\nfunction taskFormFields/)?.[0]
    || '';
  assert.ok(studentBody.length > 0, '未定位到学生首页函数');
  assert.match(studentBody, /id="historyCheckins"/);
  assert.match(studentBody, /id="plaza"/);
  assert.match(studentBody, /id="inbox"/);
  assert.match(studentBody, /id="teamCheckinStats"/);
  assert.match(studentBody, /id="modalRoot"/);
  assert.match(studentBody, /id="myTeam"/);
  assert.match(studentBody, /<h2>队伍成员<\/h2>/);
  assert.match(studentBody, /id="activityTasks"/);
  assert.match(studentBody, /data-member-task=/);
  assert.doesNotMatch(studentBody, /id="ranking"|profile-card|我的资料/);
  assert.doesNotMatch(studentBody, /team-summary|队伍名称|邀请码|成员人数/);
  assert.doesNotMatch(studentBody, /最终截图证明|data-material=/);
});

test('member check-in respects the administrator image limit and submits all confirmed media ids', () => {
  const app = read('public/app.js');
  const studentRoute = read('cloudflare/routes/student.js');
  const memberBody = app.match(/function memberCheckinForm\(task\) \{([\s\S]*?)\r?\n}\r?\n\r?\nfunction materialSubmissionForm/)?.[1] || '';
  assert.match(memberBody, /Number\(task\.memberImageLimit \|\| task\.imageLimit\)/);
  assert.match(memberBody, /type="file"[^>]*multiple/);
  assert.match(memberBody, /existingCount \+ files\.length > maxImages/);
  assert.match(memberBody, /const current = session \|\|/);
  assert.match(memberBody, /current\.items\.push\(\.\.\.files\.map/);
  assert.match(memberBody, /form\.images\.value = ''/);
  assert.doesNotMatch(memberBody, /form\.images\.onchange = \(\) => \{\s*const files[^;]+;\s*releaseSession\(\)/);
  assert.match(memberBody, /session\?\.items\?\.map\(\(item\) => item\.mediaId\)/);
  assert.match(memberBody, /occurrenceDate: task\.occurrenceDate,[\s\S]*mediaIds/);
  assert.doesNotMatch(memberBody, /files\?\.\[0\]/);
  assert.match(studentRoute, /Number\(effectiveTask\.memberImageLimit \|\| effectiveTask\.imageLimit\)/);
  assert.match(studentRoute, /claimConfirmedMedia\([\s\S]*'member-checkin',[\s\S]*imageLimit/);
});

test('interaction history and member check-in backend support multiple media objects without a schema migration', () => {
  const studentRoute = read('cloudflare/routes/student.js');
  assert.match(studentRoute, /STUDENT_ADMIN_FLOW_BACKEND_V2/);
  assert.match(studentRoute, /image_limit AS imageLimit/);
  assert.match(studentRoute, /claimConfirmedMedia\([\s\S]*imageLimit/);
  assert.match(studentRoute, /for \(const image of uploaded\)/);
  assert.match(studentRoute, /m\.business_id AS checkinId/);
  assert.match(studentRoute, /imagesByCheckin/);
  assert.match(studentRoute, /imageCount: uploaded\.length/);
});

test('ranking remains available without interfering with multi-image check-in', () => {
  const app = read('public/app.js');
  assert.match(app, /const rankingViewCache = new Map\(\)/);
  assert.match(app, /async function rankings\(/);
  assert.match(app, /function memberCheckinForm\(task\)/);
});
