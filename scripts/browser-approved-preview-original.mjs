import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULT_BASE_URL = 'https://jinshan20-test.pages.dev';
const CONFIG = 'cloudflare/pages-test/wrangler.jsonc';
const DATABASE = 'jinshan20-test';
const BUCKET = 'jinshan20-test';
const FIXTURE = 'test/fixtures/member-checkin-fast-load.webp';
const STUDENT_ID = 'WEB-PREVIEW-001';
const STUDENT_PASSWORD = 'BrowserPreview2026';
const ADMIN_ID = 'WEB-PREVIEW-ADMIN';
const ADMIN_PASSWORD = 'BrowserAdmin2026';
const PREFIX = 'browser-preview/approved1';
const ids = {
  student: 'browser-preview-student',
  admin: 'browser-preview-admin',
  team: 'browser-preview-team',
  task: 'browser-preview-task',
  submission: 'browser-preview-submission',
  submissionImage: 'browser-preview-submission-image',
  memberCheckin: 'browser-preview-member-checkin',
  post: 'browser-preview-post'
};
const objectKeys = {
  display: `${PREFIX}/display.webp`,
  thumb: `${PREFIX}/thumb-640.webp`
};
const wranglerCli = path.resolve('node_modules/wrangler/bin/wrangler.js');

const parseArgs = (argv) => {
  const options = { baseUrl: process.env.BROWSER_PREVIEW_BASE_URL || DEFAULT_BASE_URL, skipSeed: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base-url') options.baseUrl = argv[++index];
    else if (argv[index] === '--skip-seed') options.skipSeed = true;
    else throw new Error(`未知参数：${argv[index]}`);
  }
  const url = new URL(options.baseUrl);
  if (url.hostname !== 'jinshan20-test.pages.dev' && !url.hostname.endsWith('.jinshan20-test.pages.dev')) {
    throw new Error(`浏览器验收仅允许测试站，当前为：${url.hostname}`);
  }
  options.baseUrl = url.origin;
  return options;
};

const stripAnsi = (value) => String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
const runWrangler = (args) => {
  const result = spawnSync(process.execPath, [wranglerCli, ...args], {
    cwd: process.cwd(), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true
  });
  if (result.status === 0) return result.stdout;
  throw new Error(stripAnsi(`${result.stderr || ''}\n${result.stdout || ''}`).trim());
};
const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sha256Password = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const shanghaiDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());

const seedPreview = async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'jinshan-browser-preview-'));
  try {
    const fixture = await readFile(FIXTURE);
    const displayPath = path.join(workDir, 'display.webp');
    const thumbPath = path.join(workDir, 'thumb.webp');
    const display = await sharp(fixture, { failOn: 'warning' })
      .rotate().resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb').webp({ quality: 86, effort: 5 }).toBuffer({ resolveWithObject: true });
    const thumb = await sharp(fixture, { failOn: 'warning' })
      .rotate().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb').webp({ quality: 84, effort: 5 }).toBuffer({ resolveWithObject: true });
    await writeFile(displayPath, display.data);
    await writeFile(thumbPath, thumb.data);
    runWrangler(['r2', 'object', 'put', `${BUCKET}/${objectKeys.display}`, '--remote', '--config', CONFIG,
      '--file', displayPath, '--content-type', 'image/webp', '--cache-control', 'public, max-age=31536000, immutable']);
    runWrangler(['r2', 'object', 'put', `${BUCKET}/${objectKeys.thumb}`, '--remote', '--config', CONFIG,
      '--file', thumbPath, '--content-type', 'image/webp', '--cache-control', 'public, max-age=31536000, immutable']);

    const now = new Date().toISOString();
    const today = shanghaiDate();
    const startsAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const checkinSettings = JSON.stringify({
      enabled: true,
      activeStartDate: today,
      activeEndDate: today,
      dailyStart: '00:00',
      dailyEnd: '23:59',
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      personalImageLimit: 3,
      teamImageLimit: 3
    });
    const statements = [
      `DELETE FROM plaza_posts WHERE id=${sqlText(ids.post)};`,
      `DELETE FROM image_variants WHERE source_id IN (${sqlText(ids.submissionImage)},${sqlText(ids.memberCheckin)});`,
      `DELETE FROM task_submission_images WHERE id=${sqlText(ids.submissionImage)};`,
      `DELETE FROM task_submissions WHERE id=${sqlText(ids.submission)};`,
      `DELETE FROM member_checkins WHERE id=${sqlText(ids.memberCheckin)};`,
      `DELETE FROM team_members WHERE user_id=${sqlText(ids.student)};`,
      `DELETE FROM teams WHERE id=${sqlText(ids.team)};`,
      `DELETE FROM tasks WHERE id=${sqlText(ids.task)};`,
      `DELETE FROM users WHERE id IN (${sqlText(ids.student)},${sqlText(ids.admin)});`,
      `INSERT INTO users(id,student_id,name,password_hash,role,campus,track_id,status,created_at) VALUES
        (${sqlText(ids.student)},${sqlText(STUDENT_ID)},'网页验收学生',${sqlText(sha256Password(STUDENT_PASSWORD))},'student','福州校区','interaction','active',${sqlText(now)}),
        (${sqlText(ids.admin)},${sqlText(ADMIN_ID)},'网页验收管理员',${sqlText(sha256Password(ADMIN_PASSWORD))},'admin','福州校区','interaction','active',${sqlText(now)});`,
      `INSERT INTO teams(id,name,invite_code,member_limit,captain_user_id,created_at) VALUES
        (${sqlText(ids.team)},'网页验收队伍','WEBTEST1',4,${sqlText(ids.student)},${sqlText(now)});`,
      `INSERT INTO team_members(team_id,user_id,joined_at) VALUES (${sqlText(ids.team)},${sqlText(ids.student)},${sqlText(now)});`,
      `INSERT INTO tasks(id,name,description,track_id,starts_at,ends_at,allow_late,image_limit,copy_requirement,submission_type,status,schedule_json,created_at,updated_at) VALUES
        (${sqlText(ids.task)},'网页浏览器验收活动','用于验证活动广场640px缩略图和原图查看层级','interaction',${sqlText(startsAt)},${sqlText(endsAt)},0,3,'','team','published',NULL,${sqlText(now)},${sqlText(now)});`,
      `INSERT INTO member_checkins(id,task_id,occurrence_date,user_id,team_id,object_key,status,submitted_at) VALUES
        (${sqlText(ids.memberCheckin)},${sqlText(ids.task)},${sqlText(today)},${sqlText(ids.student)},${sqlText(ids.team)},${sqlText(objectKeys.display)},'approved',${sqlText(now)});`,
      `INSERT INTO task_submissions(id,task_id,owner_type,owner_id,occurrence_date,copy_text,plaza_copy,is_public,status,version,submitted_at,created_at,updated_at) VALUES
        (${sqlText(ids.submission)},${sqlText(ids.task)},'team',${sqlText(ids.team)},'','网页浏览器自动验收公开作品','网页浏览器自动验收公开作品',1,'submitted',1,${sqlText(now)},${sqlText(now)},${sqlText(now)});`,
      `INSERT INTO task_submission_images(id,submission_id,object_key,content_type,bytes,sort_order,created_at) VALUES
        (${sqlText(ids.submissionImage)},${sqlText(ids.submission)},${sqlText(objectKeys.display)},'image/webp',${display.data.byteLength},0,${sqlText(now)});`,
      `INSERT INTO image_variants(source_type,source_id,variant,object_key,content_type,bytes,created_at) VALUES
        ('task_submission_image',${sqlText(ids.submissionImage)},'display',${sqlText(objectKeys.display)},'image/webp',${display.data.byteLength},${sqlText(now)}),
        ('task_submission_image',${sqlText(ids.submissionImage)},'thumb',${sqlText(objectKeys.thumb)},'image/webp',${thumb.data.byteLength},${sqlText(now)}),
        ('member_checkin',${sqlText(ids.memberCheckin)},'display',${sqlText(objectKeys.display)},'image/webp',${display.data.byteLength},${sqlText(now)}),
        ('member_checkin',${sqlText(ids.memberCheckin)},'thumb',${sqlText(objectKeys.thumb)},'image/webp',${thumb.data.byteLength},${sqlText(now)});`,
      `INSERT INTO plaza_posts(id,submission_id,team_id,copy_text,status,excluded_from_ranking,published_at,updated_at) VALUES
        (${sqlText(ids.post)},${sqlText(ids.submission)},${sqlText(ids.team)},'网页浏览器自动验收公开作品','visible',1,${sqlText(now)},${sqlText(now)});`,
      `INSERT INTO app_config(key,value_json,updated_at) VALUES ('activityEnabled','true',${sqlText(now)})
        ON CONFLICT(key) DO UPDATE SET value_json='true',updated_at=excluded.updated_at;`,
      `INSERT INTO app_config(key,value_json,updated_at) VALUES ('trackEnabled','{"interaction":true,"health":true}',${sqlText(now)})
        ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at;`,
      `INSERT INTO app_config(key,value_json,updated_at) VALUES ('checkinSettings',${sqlText(checkinSettings)},${sqlText(now)})
        ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at;`
    ];
    const sqlPath = path.join(workDir, 'seed.sql');
    await writeFile(sqlPath, `${statements.join('\n')}\n`, 'utf8');
    runWrangler(['d1', 'execute', DATABASE, '--remote', '--config', CONFIG, '--file', sqlPath]);
    return {
      displayBytes: display.data.byteLength,
      displayWidth: display.info.width,
      displayHeight: display.info.height,
      thumbBytes: thumb.data.byteLength,
      thumbWidth: thumb.info.width,
      thumbHeight: thumb.info.height,
      today
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
};

const fetchJson = async (url, init = {}) => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 500) }; }
  if (!response.ok) throw new Error(`${url} 返回 ${response.status}: ${body?.error || text.slice(0, 200)}`);
  return { response, body };
};

const login = async (baseUrl, studentId, password) => (await fetchJson(`${baseUrl}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ studentId, password })
})).body;

const findChrome = () => {
  for (const command of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    const result = spawnSync('which', [command], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw new Error('GitHub Runner 未找到 Chrome/Chromium');
};

class CdpClient {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket连接超时')), 10_000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket连接失败')); }, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
        return;
      }
      const handlers = this.listeners.get(message.method) || [];
      handlers.splice(0).forEach((handler) => handler(message.params || {}));
    });
  }
  call(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  waitEvent(method, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待${method}超时`)), timeoutMs);
      const handler = (params) => { clearTimeout(timer); resolve(params); };
      const handlers = this.listeners.get(method) || [];
      handlers.push(handler);
      this.listeners.set(method, handlers);
    });
  }
  async evaluate(expression, awaitPromise = true) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) throw new Error(`浏览器执行失败：${result.exceptionDetails.text || 'unknown'}`);
    return result.result?.value;
  }
  close() { this.socket?.close(); }
}

const waitFor = async (client, expression, timeoutMs = 15_000, label = '页面条件') => {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await client.evaluate(expression);
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`${label}等待超时，最后结果：${JSON.stringify(last)}`);
};

const navigate = async (client, url) => {
  const loaded = client.waitEvent('Page.loadEventFired', 20_000).catch(() => null);
  await client.call('Page.navigate', { url });
  await loaded;
};

const runBrowserAcceptance = async (baseUrl, studentLogin) => {
  const chrome = findChrome();
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'jinshan-chrome-'));
  const port = 9222 + Math.floor(Math.random() * 500);
  const processHandle = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-background-networking', '--disable-default-apps', '--disable-extensions',
    `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let client;
  try {
    let version;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) });
        if (response.ok) { version = await response.json(); break; }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!version) throw new Error('Chrome远程调试端口未就绪');
    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    if (!targetResponse.ok) throw new Error(`Chrome创建标签页失败：${targetResponse.status}`);
    const target = await targetResponse.json();
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await Promise.all([client.call('Page.enable'), client.call('Runtime.enable'), client.call('Network.enable')]);
    await navigate(client, `${baseUrl}/entrance`);
    await client.evaluate(`localStorage.setItem('token', ${JSON.stringify(studentLogin.token)}); localStorage.setItem('user', ${JSON.stringify(JSON.stringify(studentLogin.user))});`);
    await navigate(client, `${baseUrl}/?debugPerf=1&browserAcceptance=${Date.now()}`);
    await waitFor(client, `Boolean(document.querySelector('#plaza') && document.body.dataset.view === 'student')`, 20_000, '学生首页');

    const homeChecks = await client.evaluate(`(() => ({
      shortcutIds: [...document.querySelectorAll('.student-shortcuts button')].map((item) => item.id || item.dataset.jump || ''),
      hasFinalProof: document.body.innerText.includes('最终截图证明'),
      hasPersonalTotal: document.body.innerText.includes('个人累计打卡'),
      hasTeamTotal: document.body.innerText.includes('队伍累计'),
      title: document.querySelector('.student-hero h1')?.textContent || ''
    }))()`);
    if (homeChecks.shortcutIds.length !== 4) throw new Error(`首页快捷入口不是4项：${homeChecks.shortcutIds.join(',')}`);
    if (homeChecks.hasFinalProof) throw new Error('首页仍存在“最终截图证明”');
    if (!homeChecks.hasPersonalTotal || !homeChecks.hasTeamTotal) throw new Error('首页累计打卡信息缺失');
    if (homeChecks.title !== '廿载同心，青春同行') throw new Error(`首页主题异常：${homeChecks.title}`);

    await client.call('Network.clearBrowserCache');
    await client.evaluate(`window.__BROWSER_PLAZA_STARTED__ = performance.now(); window.__PERF_METRICS__ = []; document.querySelector('#plaza').click();`);
    const cold = await waitFor(client, `(() => {
      const image = document.querySelector('img[data-perf-image="plaza-thumb"]');
      if (!image || !image.complete || !image.naturalWidth) return null;
      return {
        visibleMs: Math.round((performance.now() - window.__BROWSER_PLAZA_STARTED__) * 10) / 10,
        width: image.naturalWidth,
        height: image.naturalHeight,
        src: image.currentSrc || image.src,
        resources: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/api/public-images/')).map((entry) => ({
          duration: Math.round(entry.duration * 10) / 10,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
          name: entry.name
        }))
      };
    })()`, 20_000, '活动广场首图');
    if (cold.visibleMs > 1200) throw new Error(`网页版冷缓存首图耗时${cold.visibleMs}ms，超过1200ms`);
    if (Math.max(cold.width, cold.height) > 640) throw new Error(`活动广场缩略图最长边${Math.max(cold.width, cold.height)}px，超过640px`);

    await client.evaluate(`document.querySelector('[data-post]')?.click()`);
    await waitFor(client, `Boolean(document.querySelector('.plaza-detail .image-viewer-trigger'))`, 15_000, '活动详情');
    await client.evaluate(`document.querySelector('.plaza-detail .image-viewer-trigger')?.click()`);
    const viewer = await waitFor(client, `(() => {
      const toolbar = document.querySelector('.image-viewer-toolbar');
      const viewer = document.querySelector('.image-viewer');
      const modal = document.querySelector('.plaza-detail');
      if (!toolbar || !viewer || !modal || !document.querySelector('[data-image-save]')) return null;
      return { viewerZ: Number(getComputedStyle(viewer).zIndex || 0), modalZ: Number(getComputedStyle(modal).zIndex || 0) };
    })()`, 15_000, '高清原图查看器');
    if (viewer.viewerZ <= viewer.modalZ) throw new Error(`原图层级没有高于详情层：${viewer.viewerZ} <= ${viewer.modalZ}`);
    await client.evaluate(`document.querySelector('[data-image-close]')?.click()`);
    await waitFor(client, `!document.querySelector('.image-viewer') && Boolean(document.querySelector('.plaza-detail'))`, 10_000, '关闭原图后保留详情');
    await client.evaluate(`document.querySelector('#closePost')?.click(); document.querySelector('#backHome')?.click();`);
    await waitFor(client, `Boolean(document.querySelector('#plaza'))`, 15_000, '返回首页');

    await client.evaluate(`window.__BROWSER_PLAZA_HOT_STARTED__ = performance.now(); document.querySelector('#plaza').click();`);
    const hot = await waitFor(client, `(() => {
      const image = document.querySelector('img[data-perf-image="plaza-thumb"]');
      if (!image || !image.complete || !image.naturalWidth) return null;
      return Math.round((performance.now() - window.__BROWSER_PLAZA_HOT_STARTED__) * 10) / 10;
    })()`, 10_000, '活动广场热缓存首图');
    if (hot > 1200) throw new Error(`网页版热缓存首图耗时${hot}ms，超过1200ms`);

    return {
      chrome: version['User-Agent'] || version.Browser || '',
      homeChecks,
      cold,
      hotVisibleMs: hot,
      viewer,
      accepted: true,
      thresholdMs: 1200
    };
  } finally {
    client?.close();
    processHandle.kill('SIGTERM');
    await rm(userDataDir, { recursive: true, force: true });
  }
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const deployment = await fetchJson(`${options.baseUrl}/deployment-version.json?browser=${Date.now()}`);
  if (deployment.body?.assetVersion !== '20260731-approved1') {
    throw new Error(`测试站资源版本不是20260731-approved1：${JSON.stringify(deployment.body)}`);
  }
  const seed = options.skipSeed ? null : await seedPreview();
  const studentLogin = await login(options.baseUrl, STUDENT_ID, STUDENT_PASSWORD);
  const adminLogin = await login(options.baseUrl, ADMIN_ID, ADMIN_PASSWORD);
  const settings = await fetchJson(`${options.baseUrl}/api/admin/checkin-settings`, {
    headers: { authorization: `Bearer ${adminLogin.token}` }
  });
  const requiredSettings = ['enabled', 'activeStartDate', 'activeEndDate', 'dailyStart', 'dailyEnd', 'weekdays', 'personalImageLimit', 'teamImageLimit'];
  for (const key of requiredSettings) {
    if (!(key in (settings.body.settings || {}))) throw new Error(`管理员打卡设置缺少字段：${key}`);
  }
  const browser = await runBrowserAcceptance(options.baseUrl, studentLogin);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: options.baseUrl,
    deployment: deployment.body,
    seed,
    adminSettings: settings.body.settings,
    browser,
    acceptance: {
      automatedTestsRequired: true,
      webBrowserPassed: browser.accepted,
      coldFirstImageMs: browser.cold.visibleMs,
      hotFirstImageMs: browser.hotVisibleMs,
      webThresholdMs: 1200,
      realDevicePending: true,
      passed: browser.accepted && browser.cold.visibleMs <= 1200 && browser.hotVisibleMs <= 1200
    }
  };
  await mkdir('reports', { recursive: true });
  await writeFile('reports/browser-approved-preview.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.acceptance.passed) process.exitCode = 1;
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
