const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('登录快照无损携带活动广场首屏并保留原接口回退', async () => {
  const worker = fs.readFileSync('cloudflare/worker.js', 'utf8');
  const bootstrap = fs.readFileSync('public/bootstrap.js', 'utf8');
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(worker, /LOGIN_PLAZA_HANDOFF_V1/);
  assert.match(worker, /buildLoginPlazaFirstPage\(env, user\.id\)/);
  assert.match(worker, /const \[token, dashboard, plaza\] = await Promise\.all/);
  assert.match(bootstrap, /Promise\.resolve\(session\.plaza \|\| null\)/);
  assert.match(bootstrap, /if \(!session\) \{[\s\S]*fetch\('\/api\/session'/);
  assert.match(app, /studentPlazaPrefetchPromise \|\| prefetchStudentPlaza\(\)/);
  assert.match(app, /result \|\| api\(path\)/);
  assert.match(app, /2048w/);

  const { buildLoginPlazaFirstPage } = await import('../cloudflare/services/plaza-first-page.js');
  const statements = [];
  const DB = {
    prepare(sql) {
      const statement = {
        sql,
        args: [],
        bind(...args) { this.args = args; return this; }
      };
      statements.push(statement);
      return statement;
    },
    async batch(batchStatements) {
      assert.equal(batchStatements.length, 2);
      assert.match(batchStatements[0].sql, /p\.status='visible'/);
      assert.match(batchStatements[0].sql, /p\.published_at DESC/);
      assert.deepEqual(batchStatements[0].args, ['user-1', 20]);
      return [
        { results: [{
          id: 'post-1', submissionId: 'submission-1', teamId: 'team-1',
          teamName: '测试队', taskName: '测试任务', copy: '测试内容',
          publishedAt: '2026-08-12T00:00:00.000Z', publisherName: '测试学生',
          likeCount: 3, viewCount: 4, commentCount: 5, liked: 1,
          firstImageId: 'image-1', thumbVersion: 960, displayVersion: 2048
        }] },
        { results: [{ total: 21 }] }
      ];
    }
  };
  const payload = await buildLoginPlazaFirstPage({ DB }, 'user-1');
  assert.equal(statements.length, 2);
  assert.equal(payload.posts.length, 1);
  assert.equal(payload.total, 21);
  assert.equal(payload.hasMore, true);
  assert.equal(payload.posts[0].liked, true);
  assert.match(payload.posts[0].images[0].thumbUrl, /variant=thumb&v=960/);
  assert.match(payload.posts[0].images[0].displayUrl, /variant=display&v=2048/);
});
