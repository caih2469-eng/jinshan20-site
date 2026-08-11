const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const read = (path) => fs.readFileSync(path, 'utf8');

test('student home keeps only the requested shortcuts and a working history modal root', () => {
  execFileSync(process.execPath, ['scripts/apply-admin-dashboard-refactor.mjs'], { stdio: 'pipe' });
  const app = read('public/app.js');
  const studentBody = app.match(/async function student\([\s\S]*?\n}\n\nfunction openStudentCheckinHistory/)?.[0] || '';
  assert.match(studentBody, /id="historyCheckins"/);
  assert.match(studentBody, /id="plaza"/);
  assert.match(studentBody, /id="inbox"/);
  assert.match(studentBody, /id="teamCheckinStats"/);
  assert.match(studentBody, /id="modalRoot"/);
  assert.doesNotMatch(studentBody, /id="ranking"/);
  assert.doesNotMatch(studentBody, /profile-card/);
  assert.doesNotMatch(studentBody, /id="myTeam"/);
  assert.doesNotMatch(studentBody, /data-jump="activityTasks"/);
});

test('member check-in respects the administrator image limit and submits all confirmed media ids', () => {
  const app = read('public/app.js');
  const studentRoute = read('cloudflare/routes/student.js');
  const memberBody = app.match(/function memberCheckinForm\(task\) \{([\s\S]*?)\n}\n\nfunction materialSubmissionForm/)?.[1] || '';
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
  assert.match(studentRoute, /uploaded\.forEach/);
  assert.match(studentRoute, /m\.business_id AS checkinId/);
  assert.match(studentRoute, /imagesByCheckin/);
  assert.match(studentRoute, /imageCount: uploaded\.length/);
});

test('comment management uses page cache and retired ranking code is absent from the frontend', () => {
  const app = read('public/app.js');
  assert.match(app, /const adminCommentViewCache = new Map\(\)/);
  assert.match(app, /scopedCacheKey\('admin-comments', page\)/);
  assert.match(app, /renderAdminCommentsPage/);
  assert.doesNotMatch(app, /const rankingViewCache = new Map\(\)/);
  assert.doesNotMatch(app, /async function rankings\(/);
});
