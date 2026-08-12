const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('站内路径统一为单斜杠，媒体地址不会生成 //api', () => {
  const source = fs.readFileSync('public/site-path.js', 'utf8');
  const context = {
    globalThis: {
      location: { origin: 'https://jinshan20-test.pages.dev' }
    },
    URL
  };
  vm.runInNewContext(source, context);
  const { normalizeSitePath, buildMediaUrl } = context.globalThis;
  const paths = [
    '/api/public-images/a',
    '//api/public-images/a',
    '///api//public-images///a',
    'api/public-images/a',
    '//api/public-images/a?variant=thumb&v=1'
  ];
  for (const input of paths) {
    const normalized = normalizeSitePath(input);
    assert.match(normalized, /^\/api\//);
    assert.doesNotMatch(normalized, /^\/\/api\//);
  }
  assert.equal(
    buildMediaUrl('//api/public-images/a', 'thumb', '37'),
    '/api/public-images/a?variant=thumb&v=37'
  );
});

test('入口页不加载主应用，登录脚本具备移动端降级、防重复和十秒超时', () => {
  const html = fs.readFileSync('public/entrance.html', 'utf8');
  const index = fs.readFileSync('public/index.html', 'utf8');
  const bootstrap = fs.readFileSync('public/bootstrap.js', 'utf8');
  const entrance = fs.readFileSync('public/entrance.js', 'utf8');
  const app = fs.readFileSync('public/app.js', 'utf8');
  const worker = fs.readFileSync('cloudflare/worker.js', 'utf8');
  assert.doesNotMatch(html, /<script[^>]+src=["'][^"']*(?:\/app\.js|\/bootstrap\.js)/i);
  if (/\bapp\.js\b/.test(html) || /\bbootstrap\.js\b/.test(html)) {
    assert.match(html, /LOGIN_HOME_PREFETCH_V2/);
    assert.match(html, /<link[^>]+rel=["']prefetch["'][^>]+href=["'][^"']*\/(?:app|bootstrap)\.js/i);
  }
  assert.match(html, /\bentrance\.js\b/);
  assert.doesNotMatch(html, /\.ttf(?:[?"'])/i);
  assert.match(html, /font-display:\s*swap/i);
  assert.match(entrance, /AbortController/);
  assert.match(entrance, /10_?000/);
  assert.match(entrance, /loginPending/);
  assert.match(entrance, /location\.replace\(['"]\/['"]\)/);
  assert.match(entrance, /MicroMessenger|MQQBrowser/);
  assert.doesNotMatch(index, /<script[^>]+src=["']\/app\.js/i);
  assert.match(index, /\bbootstrap\.js\b/);
  assert.match(bootstrap, /fetch\(['"]\/api\/session['"]/);
  assert.match(bootstrap, /__BOOTSTRAP_AUTHENTICATED__/);
  assert.match(app, /window\.__BOOTSTRAP_AUTHENTICATED__/);
  assert.match(worker, /user:\s*auth\.user/);
  assert.match(worker, /dashboard/);
});

test('登录入口预取的版本化首页启动脚本可复用，严格p95拒绝等于阈值', () => {
  const headers = fs.readFileSync('public/_headers', 'utf8');
  const strictP95 = fs.readFileSync('scripts/browser-strict-p95.mjs', 'utf8');
  const bootstrapPolicy = headers.match(/\/bootstrap\.js\s*\r?\n\s*Cache-Control:\s*([^\r\n]+)/i)?.[1] || '';
  assert.match(bootstrapPolicy, /public/i);
  assert.match(bootstrapPolicy, /max-age=31536000/i);
  assert.match(bootstrapPolicy, /immutable/i);
  assert.doesNotMatch(bootstrapPolicy, /no-store|no-cache/i);
  assert.match(strictP95, /summary\[metric\]\?\.p95 < options\.thresholdMs/);
  assert.doesNotMatch(strictP95, /summary\[metric\]\?\.p95 <= options\.thresholdMs/);
});

test('图片列表在SQL层分页，首屏不超过20张且管理员每页不超过30人', () => {
  const plaza = fs.readFileSync('cloudflare/routes/plaza.js', 'utf8');
  const admin = fs.readFileSync('cloudflare/routes/admin.js', 'utf8');
  const student = fs.readFileSync('cloudflare/routes/student.js', 'utf8');
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(plaza, /Math\.min\(20/);
  assert.match(plaza, /ORDER BY \$\{order\} LIMIT \?4 OFFSET \?5/);
  assert.match(plaza, /env\.DB\.prepare\(query\)\.bind\(user\.id, searchLike, monthValue, limit, \(page - 1\) \* limit\)/);
  assert.match(admin, /Math\.min\(30/);
  assert.match(admin, /ORDER BY u\.name,u\.student_id LIMIT \?4 OFFSET \?5/);
  assert.match(student, /Math\.min\(20/);
  assert.doesNotMatch(app, /new MutationObserver/);
  assert.match(app, /IntersectionObserver/);
  assert.match(app, /data-src=/);
  assert.match(app, /limit=20/);
  assert.doesNotMatch(plaza + '\n' + admin + '\n' + student, /data:image\/[^;]+;base64/i);
  assert.match(admin, /IN \('task:thumb','admin-makeup:thumb'\)/);
  assert.match(student, /IN \('member-checkin:thumb','admin-makeup:thumb'\)/);
  assert.match(admin, /COALESCE\(m\.object_key,i\.object_key\) AS objectKey/);
  assert.match(student, /COALESCE\(m\.object_key,i\.object_key\) AS objectKey/);
});

test('未发布图片公共接口404且不缓存；可见图片返回WebP并在第二次命中Cache API', async () => {
  const worker = (await import('../cloudflare/worker.js')).default;
  const cacheStore = new Map();
  global.caches = {
    default: {
      match: async (request) => cacheStore.get(request.url)?.clone(),
      put: async (request, response) => cacheStore.set(request.url, response.clone())
    }
  };

  const createEnv = (visible) => {
    const env = {
      ENVIRONMENT: 'test',
      PROJECT_NAME: 'jinshan20-test',
      SESSION_SECRET: 'test-session-secret-with-sufficient-length',
      MEDIA_SIGNING_SECRET: 'test-media-secret-with-sufficient-length',
      _visible: visible,
      _r2Reads: 0,
      DB: {
        prepare(sql) {
          return {
            bind(...args) { this.args = args; return this; },
            first: async () => {
              if (/FROM task_submission_images i[\s\S]*JOIN plaza_posts p/i.test(sql)) {
                return env._visible
                  ? { objectKey: 'media/test/display/image.webp', contentType: 'image/webp' }
                  : null;
              }
              return null;
            }
          };
        }
      },
      UPLOADS: {
        get: async () => {
          env._r2Reads += 1;
          return {
            body: new Blob(['webp-image']).stream(),
            size: 10,
            httpEtag: '"image-etag"',
            httpMetadata: { contentType: 'image/webp' }
          };
        }
      }
    };
    return env;
  };
  const pending = [];
  const ctx = { waitUntil: (promise) => pending.push(promise) };
  const privateEnv = createEnv(false);
  const unpublished = await worker.fetch(
    new Request('https://jinshan20-test.pages.dev/api/public-images/image-1?variant=thumb&v=1'),
    privateEnv,
    ctx
  );
  assert.equal(unpublished.status, 404);
  assert.equal(unpublished.headers.get('cache-control'), 'no-store');
  assert.equal(unpublished.headers.get('content-type').startsWith('application/json'), true);

  const publicEnv = createEnv(true);
  const url = 'https://jinshan20-test.pages.dev/api/public-images/image-1?variant=thumb&v=1';
  const first = await worker.fetch(new Request(url), publicEnv, ctx);
  await Promise.all(pending.splice(0));
  const second = await worker.fetch(new Request(url), publicEnv, ctx);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'image/webp');
  assert.equal(first.headers.get('x-image-cache'), 'MISS');
  assert.equal(first.headers.get('content-disposition'), 'inline');
  assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
  assert.match(first.headers.get('cache-control'), /immutable/);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('content-type'), 'image/webp');
  assert.equal(second.headers.get('x-image-cache'), 'HIT');
  assert.equal(publicEnv._r2Reads, 1);

  const head = await worker.fetch(new Request(url, { method: 'HEAD' }), publicEnv, ctx);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});


test('Pica图片参数前后端一致，并复用已加载缩略图', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  const media = fs.readFileSync('cloudflare/routes/media.js', 'utf8');
  assert.match(app, /PICA_THUMB_MAX_EDGE = 960/);
  assert.match(app, /PICA_DISPLAY_MAX_EDGE = 2048/);
  assert.match(app, /PICA_THUMB_MAX_BYTES = 491520/);
  assert.match(app, /PICA_DISPLAY_MAX_BYTES = 1468006/);
  assert.match(app, /quality: screenshotLike \? 0\.92 : 0\.88/);
  assert.match(app, /quality: screenshotLike \? 0\.94 : 0\.90/);
  assert.match(app, /prepareImageVariantsMeasured\((?:sourceFile|selected\[index\])/);
  assert.match(app, /renderedImage\?\.complete/);
  assert.match(app, /await displayImage\.decode\(\)/);
  assert.match(media, /THUMB_MAX_EDGE = 960/);
  assert.match(media, /PLAZA_THUMB_MAX_EDGE = 960/);
  assert.match(media, /DISPLAY_MAX_EDGE = 2048/);
  assert.doesNotMatch(media, /variant === 'thumb' \? 480 : 1280/);
});

test('阶段A统一请求层具备去重、超时、安全重试和页面竞态保护', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(app, /const inflightGetRequests = new Map\(\)/);
  assert.match(app, /credentials:\s*'same-origin'/);
  assert.match(app, /method === 'GET' \|\| method === 'HEAD' \? 12_000 : 30_000/);
  assert.match(app, /\[502,\s*503,\s*504\]\.includes\(response\.status\)/);
  assert.match(app, /300 \+ Math\.floor\(Math\.random\(\) \* 301\)/);
  assert.match(app, /const requestKey = `\$\{user\?\.(?:id|studentId)/);
  assert.match(app, /\.finally\(\(\) => inflightGetRequests\.delete\(requestKey\)\)/);
  assert.match(app, /let navigationEpoch = 0/);
  assert.match(app, /if \(!isCurrentNavigation\(pageEpoch\)\) return/);
  assert.match(app, /let midnightRefreshTimer = null/);
  assert.match(app, /clearTimeout\(midnightRefreshTimer\)/);
  assert.match(app, /60_000/);
  assert.doesNotMatch(app, /headers:\s*\{\s*'Content-Type':\s*'application\/json'/);
});

test('阶段A删除不可达登录代码并按需加载本地压缩库', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  const bootstrap = fs.readFileSync('public/bootstrap.js', 'utf8');
  const loginBody = app.match(/function login\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(loginBody, /location\.replace\('\/entrance\.html'\)/);
  assert.doesNotMatch(loginBody, /meteor|glass-login|mousemove|#login/);
  assert.doesNotMatch(bootstrap, /browser-image-compression-2\.0\.2\.js/);
  assert.match(app, /const loadImageCompressionLibrary = \(\) =>/);
  assert.match(app, /imageCompressionLibraryPromise/);
  assert.match(app, /script\.src = '\/vendor\/browser-image-compression-2\.0\.2\.js'/);
  assert.match(app, /imageCompressionLibraryPromise = null/);
  assert.match(app, /void loadImageCompressionLibrary\(\)\.catch/);
});

test('阶段B会话直接携带学生首页快照，前端复用快照并后台刷新聚合接口', () => {
  const worker = fs.readFileSync('cloudflare/worker.js', 'utf8');
  const service = fs.readFileSync('cloudflare/services/student-dashboard.js', 'utf8');
  const bootstrap = fs.readFileSync('public/bootstrap.js', 'utf8');
  const app = fs.readFileSync('public/app.js', 'utf8');
  const server = fs.readFileSync('server.js', 'utf8');
  assert.match(worker, /buildStudentDashboard/);
  assert.match(worker, /dashboard\s*=\s*auth\.user\.role === 'student'/);
  assert.match(bootstrap, /__BOOTSTRAP_SESSION__/);
  assert.match(bootstrap, /__BOOTSTRAP_DASHBOARD__/);
  assert.match(app, /const studentViewState =/);
  assert.match(app, /api\('\/api\/student-dashboard'\)/);
  assert.match(app, /window\.__BOOTSTRAP_DASHBOARD__/);
  assert.match(app, /studentViewState\.scrollY/);
  const studentBody = app.match(/async function student\([\s\S]*?\n\}\n\nasync function admin/)?.[0] || '';
  assert.doesNotMatch(studentBody, /api\('\/api\/(?:teams|teams\/me|tasks|material-tasks)'/);
  assert.match(service, /if \(user\.trackId !== 'interaction'\) return null/);
  assert.match(service, /SELECT COUNT\(\*\) AS total FROM teams/);
  assert.doesNotMatch(service, /SELECT \* FROM teams/);
  assert.match(server, /buildLocalStudentDashboard/);
  assert.match(server, /route === '\/api\/student-dashboard'/);
});

test('阶段B Cloudflare学生会话不泄露密码字段，健康赛道不会读取队伍表', async () => {
  const [{ default: worker }, { createToken }] = await Promise.all([
    import('../cloudflare/worker.js'),
    import('../cloudflare/lib/runtime.js')
  ]);
  const user = {
    id: 'user-health-1',
    studentId: '246731001',
    name: '健康赛道测试',
    role: 'student',
    campus: '南平',
    trackId: 'health',
    status: 'active',
    createdAt: '2026-07-01T00:00:00.000Z'
  };
  const statements = [];
  const DB = {
    prepare(sql) {
      statements.push(sql.replace(/\s+/g, ' ').trim());
      return {
        bind() { return this; },
        async first() {
          if (/FROM users WHERE id/i.test(sql)) return user;
          return null;
        },
        async all() {
          if (/FROM app_config/i.test(sql)) {
            return {
              results: [
                { key: 'activityEnabled', valueJson: 'false' },
                { key: 'trackEnabled', valueJson: '{"interaction":false,"health":false}' },
                { key: 'maxTeams', valueJson: '50' }
              ]
            };
          }
          if (/FROM material_tasks/i.test(sql)) return { results: [] };
          return { results: [] };
        },
        async run() { return { success: true }; }
      };
    }
  };
  const env = {
    DB,
    SESSION_SECRET: 'stage-b-session-secret-at-least-32-bytes',
    MEDIA_SIGNING_SECRET: 'stage-b-media-secret-at-least-32-bytes',
    ENVIRONMENT: 'test',
    PROJECT_NAME: 'jinshan20-test'
  };
  const token = await createToken(user, env.SESSION_SECRET);
  const response = await worker.fetch(new Request(
    'https://jinshan20-test.pages.dev/api/session',
    { method: 'POST', headers: { authorization: `Bearer ${token}` } }
  ), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.user.id, user.id);
  assert.equal(payload.dashboard.version, 1);
  assert.deepEqual(payload.dashboard.tasks, []);
  assert.deepEqual(payload.dashboard.materialTasks, []);
  assert.equal(payload.dashboard.teamSummary, null);
  assert.equal('password' in payload.user, false);
  assert.equal('passwordHash' in payload.user, false);
  assert.equal(JSON.stringify(payload).includes('passwordHash'), false);
  assert.equal(statements.some((sql) => /\bteams\b/i.test(sql)), false);
});
