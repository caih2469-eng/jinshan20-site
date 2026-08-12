const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const read = (path) => fs.readFileSync(path, 'utf8');

test('admin dashboard patch is idempotent, lazy, and retains existing entry points', () => {
  execFileSync(process.execPath, ['scripts/apply-admin-dashboard-refactor.mjs'], { stdio: 'pipe' });
  const first = read('public/app.js');
  const firstAdmin = read('public/admin-client.js');
  execFileSync(process.execPath, ['scripts/apply-admin-dashboard-refactor.mjs'], { stdio: 'pipe' });
  const second = read('public/app.js');
  const secondAdmin = read('public/admin-client.js');
  assert.equal(second, first);
  assert.equal(secondAdmin, firstAdmin);

  assert.match(first, /ADMIN_DASHBOARD_REFACTOR_V1/);
  assert.match(first, /STUDENT_ADMIN_FLOW_V2/);
  assert.match(first, /ADMIN_CLIENT_LAZY_LOADER_V1/);
  assert.doesNotMatch(first, /const adminDashboardState = \{/);
  assert.match(first, /function rankingTable\(/);
  assert.match(first, /async function rankings\(/);
  assert.equal((firstAdmin.match(/const adminDashboardState = \{/g) || []).length, 1);

  const start = firstAdmin.indexOf('/* ADMIN_DASHBOARD_REFACTOR_V1 */');
  const end = firstAdmin.indexOf('function enhanceAdminSections()', start);
  assert.ok(start >= 0 && end > start);
  const compact = firstAdmin.slice(start, end);

  assert.match(compact, /健康自律赛道/);
  assert.match(compact, /四校区赛道/);
  assert.match(compact, /data-track-filter="health"/);
  assert.match(compact, /data-track-filter="interaction"/);
  assert.match(compact, /track=\$\{adminDashboardState\.userTrack\}/);
  assert.match(compact, /队伍管理/);
  assert.match(compact, /用户管理/);
  assert.match(compact, /活动广场管理/);
  assert.match(compact, /评论管理/);
  assert.match(firstAdmin, /高级工具/);
  assert.doesNotMatch(compact, /api\/admin\/overview/);
  assert.doesNotMatch(compact, /api\/admin\/material-tasks/);
  assert.match(compact, /admin-post-(?:tile|row)/);
  assert.match(compact, /refreshCompactPlazaPanel/);
  assert.match(compact, /refreshCompactTeamPanel/);
});

test('bootstrap loads the updated assets with the flow cache key', () => {
  const bootstrap = read('public/bootstrap.js');
  assert.match(bootstrap, /admin-dashboard-refactor\.css/);
  assert.match(bootstrap, /20260731-approved1/);
});

test('compact dashboard stylesheet includes mobile card layouts', () => {
  const css = read('public/admin-dashboard-refactor.css');
  assert.match(css, /admin-accordion-trigger/);
  assert.match(css, /admin-post-grid/);
  assert.match(css, /student-shortcuts-compact/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
