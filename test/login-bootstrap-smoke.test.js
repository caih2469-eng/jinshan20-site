const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

test('登录首页V2交接仅作为短时同用户加速，原session网络链路必须保留', async () => {
  const compat = fs.readFileSync('scripts/apply-track-admin-settings-compat.mjs', 'utf8');
  const generator = fs.readFileSync('scripts/apply-login-bootstrap-handoff-v2.mjs', 'utf8');
  const worker = fs.readFileSync('cloudflare/worker.js', 'utf8');
  const bootstrap = fs.readFileSync('public/bootstrap.js', 'utf8');
  const entrance = fs.readFileSync('public/entrance.js', 'utf8');
  const entranceHtml = fs.readFileSync('public/entrance.html', 'utf8');

  // The production-breaking V1 generator remains disabled.
  assert.doesNotMatch(compat, /apply-login-bootstrap-handoff(?:\.mjs)?/);
  assert.doesNotMatch(generator, /LOGIN_BOOTSTRAP_HANDOFF_V1/);

  // Server-side login keeps normal token/cookie semantics and only adds an optional snapshot.
  assert.match(worker, /LOGIN_BOOTSTRAP_HANDOFF_V2/);
  assert.match(worker, /LOGIN_D1_BATCH_V6/);
  assert.match(worker, /buildStudentDashboardForLogin\(env, user\)/);
  assert.match(worker, /login_lookup/);
  assert.match(worker, /login_password/);
  assert.match(worker, /login_dashboard/);
  assert.match(worker, /login_session/);
  assert.match(worker, /const \[token, dashboard, plaza\] = await Promise\.all/);
  assert.match(worker, /'set-cookie': `session_token=/);
  assert.match(worker, /bootstrap\n  \}, 200, \{/);

  // Client only consumes a recent same-user snapshot and always retains /api/session fallback.
  assert.match(entrance, /jinshan20\.loginBootstrap\.v2/);
  assert.match(bootstrap, /LOGIN_BOOTSTRAP_HANDOFF_V2/);
  assert.match(bootstrap, /consumeLoginBootstrapV2/);
  assert.match(bootstrap, /age > 10_000/);
  assert.match(bootstrap, /stored\.userId !== cachedUser\?\.id/);
  assert.match(bootstrap, /session\.user\?\.id !== stored\.userId/);
  assert.match(bootstrap, /if \(!session\) \{[\s\S]*fetch\('\/api\/session'/);
  assert.match(bootstrap, /source: 'login-handoff-v2'/);

  // Login page may warm immutable next-navigation assets but must not execute the main app there.
  assert.match(entranceHtml, /LOGIN_HOME_PREFETCH_V2/);
  assert.match(entranceHtml, /rel="prefetch"/);
  assert.doesNotMatch(entranceHtml, /<script[^>]+(?:bootstrap|app)\.js/);

  execFileSync(process.execPath, ['--check', 'cloudflare/worker.js']);
  execFileSync(process.execPath, ['--check', 'public/bootstrap.js']);
  execFileSync(process.execPath, ['--check', 'public/entrance.js']);

  const { buildStudentDashboardForLogin } = await import('../cloudflare/services/student-dashboard.js');
  let batchCalls = 0;
  let allCalls = 0;
  const DB = {
    prepare(sql) {
      return {
        sql,
        bind() { return this; },
        async all() {
          allCalls += 1;
          assert.match(sql, /FROM app_config/);
          return { results: [
            { key: 'activityEnabled', valueJson: 'true' },
            { key: 'trackEnabled', valueJson: '{"interaction":true,"health":false}' },
            { key: 'maxTeams', valueJson: '50' }
          ] };
        }
      };
    },
    async batch(statements) {
      batchCalls += 1;
      assert.equal(statements.length, 7);
      return [
        { results: [{
          teamId: 'team-1', teamName: '测试队', inviteCode: 'ABCD', memberLimit: 8,
          captainId: 'user-1', teamCreatedAt: '2026-01-01T00:00:00.000Z', teamCount: 1,
          memberId: 'user-1', memberStudentId: 'WEB-PREVIEW-001', memberName: '测试学生',
          memberCampus: '金山', memberTrackId: 'interaction', memberStatus: 'active',
          memberCreatedAt: '2026-01-01T00:00:00.000Z'
        }] },
        { results: [{
          id: 'task-1', name: '互动任务', description: '', trackId: 'interaction',
          startsAt: '2026-01-01T00:00:00+08:00', endsAt: '2026-12-31T23:59:59+08:00',
          allowLate: 0, imageLimit: 3, copyRequirement: '', submissionType: 'team',
          status: 'published', scheduleJson: null
        }] },
        { results: [] }, { results: [] }, { results: [] },
        { results: [{ total: 2 }] }, { results: [{ total: 1 }] }
      ];
    }
  };
  const user = {
    id: 'user-1', studentId: 'WEB-PREVIEW-001', name: '测试学生', role: 'student',
    campus: '金山', trackId: 'interaction', status: 'active', createdAt: '2026-01-01T00:00:00.000Z'
  };
  const dashboard = await buildStudentDashboardForLogin({ DB }, user);
  assert.equal(batchCalls, 1);
  assert.equal(allCalls, 1);
  assert.equal(dashboard.tasks.length, 1);
  assert.equal(dashboard.teamSummary.team.id, 'team-1');
  assert.deepEqual(dashboard.checkinStats, { personalDays: 2, teamDays: 1 });
});
