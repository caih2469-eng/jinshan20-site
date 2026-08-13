const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');

test('student home keeps the existing shortcuts and a working history modal root', () => {
  const app = read('public/app.js');
  const studentBody = app.match(/async function student\([\s\S]*?\r?\n}\r?\n\r?\nfunction openStudentCheckinHistory/)?.[0] || '';
  assert.match(studentBody, /id="historyCheckins"/);
  assert.match(studentBody, /id="plaza"/);
  assert.match(studentBody, /id="inbox"/);
  assert.match(studentBody, /id="teamCheckinStats"/);
  assert.match(studentBody, /id="modalRoot"/);
  assert.match(studentBody, /id="myTeam"/);
  assert.match(studentBody, /<h2>队伍成员<\/h2>/);
  assert.match(studentBody, /id="activityTasks"/);
  assert.doesNotMatch(studentBody, /id="ranking"|我的资料|最终截图证明|team-summary|邀请码/);
});

test('member check-in respects the administrator image limit and submits all confirmed media ids', () => {
  const app = read('public/app.js');
  const studentRoute = read('cloudflare/routes/student.js');
  const memberBody = app.match(/function memberCheckinForm\(task\) \{([\s\S]*?)\r?\n}\r?\n\r?\nfunction materialSubmissionForm/)?.[1] || '';
  assert.match(memberBody, /Number\(task\.memberImageLimit \|\| task\.imageLimit\)/);
  assert.match(memberBody, /multiple required/);
  assert.match(memberBody, /files\.length > maxImages/);
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

test('ranking backend code remains available but its student-home entry is removed', () => {
  const app = read('public/app.js');
  const studentBody = app.match(/async function student\([\s\S]*?\r?\n}\r?\n\r?\nfunction openStudentCheckinHistory/)?.[0] || '';
  assert.match(app, /const rankingViewCache = new Map\(\)/);
  assert.match(app, /async function rankings\(/);
  assert.match(app, /function memberCheckinForm\(task\)/);
  assert.doesNotMatch(studentBody, /id="ranking"/);
});
