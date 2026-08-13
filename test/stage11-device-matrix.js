const { spawn } = require('child_process');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (process.env.CI) {
  console.log(JSON.stringify({
    skipped: true,
    reason: 'Device matrix uses the controlled local demo fixture; GitHub CI runs functional and load tests only'
  }));
  process.exit(0);
}

const windowsChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const findLinuxChrome = () => ['google-chrome', 'chromium']
  .map((name) => spawnSync('which', [name], { encoding: 'utf8' }).stdout?.trim())
  .find(Boolean) || '';
const linuxChrome = process.platform === 'win32' ? '' : findLinuxChrome();
const chrome = process.platform === 'win32' ? windowsChrome : linuxChrome;
if (!chrome || !fs.existsSync(chrome)) {
  console.log(JSON.stringify({ skipped: true, reason: 'Chrome executable is unavailable' }));
  process.exit(0);
}
const projectRoot = path.join(__dirname, '..');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-device-fixture-'));
const fixtureDataDir = path.join(fixtureRoot, 'data');
const fixtureUploadDir = path.join(fixtureRoot, 'uploads');
const fixtureMaterialDir = path.join(fixtureRoot, 'materials');
fs.mkdirSync(fixtureDataDir, { recursive: true });
const fixture = {
  config: {
    activityName: '设备矩阵测试',
    maxTeams: 50,
    slots: [],
    activityEnabled: true,
    trackEnabled: { interaction: true, health: true },
    allowSelfJoin: false
  },
  tracks: [
    { id: 'interaction', name: '四校区互动赛道' },
    { id: 'health', name: '自律健康赛道' }
  ],
  users: [],
  teams: [],
  tasks: [],
  taskSubmissions: [],
  memberCheckins: [],
  checkins: [],
  plazaPosts: [],
  plazaLikes: [],
  plazaViews: [],
  rankingFreezes: [],
  materialTasks: [],
  materialSubmissions: []
};
fixture.users.push({
  id: 'device-matrix-health',
  studentId: 'demo-health',
  name: '设备矩阵测试用户',
  password: 'Demo123!',
  role: 'student',
  campus: '测试校区',
  trackId: 'health',
  status: 'active',
  createdAt: new Date().toISOString()
});
fs.writeFileSync(path.join(fixtureDataDir, 'db.json'), JSON.stringify(fixture, null, 2), 'utf8');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-device-'));
const port = 9331;
const appPort = 9332;
const chromeArgs = [`--headless=new`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--disable-gpu', '--no-first-run'];
if (process.platform !== 'win32') chromeArgs.push('--no-sandbox', '--disable-dev-shm-usage');
const browser = spawn(chrome, chromeArgs, { stdio: 'ignore' });
const server = spawn(process.execPath, ['server.js'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    PORT: String(appPort),
    CHECKIN_DATA_DIR: fixtureDataDir,
    CHECKIN_UPLOAD_DIR: fixtureUploadDir,
    CHECKIN_MATERIAL_FILE_DIR: fixtureMaterialDir
  },
  stdio: 'ignore'
});
let commandId = 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const commandClient = (socket) => {
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  return (method, params = {}) => new Promise((resolve) => {
    const id = ++commandId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
};

(async () => {
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        if ((await fetch(`http://127.0.0.1:${appPort}/`)).ok) break;
      } catch {}
      if (attempt === 49) throw new Error('Local fixture server failed to start');
      await wait(100);
    }
    let target;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        target = await fetch(`http://127.0.0.1:${port}/json/new?http://127.0.0.1:${appPort}/`, { method: 'PUT' }).then((response) => response.json());
        break;
      } catch {}
      await wait(100);
    }
    if (!target) throw new Error('Chrome DevTools 启动失败');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const send = commandClient(socket);
    await send('Page.enable');
    await send('Runtime.enable');
    const devices = [
      { name: '手机', width: 390, height: 844, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36' },
      { name: '平板', width: 768, height: 1024, mobile: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' },
      { name: '电脑', width: 1440, height: 900, mobile: false, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' },
      { name: '微信浏览器', width: 390, height: 844, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 Version/4.0 Chrome/116 Mobile Safari/537.36 MicroMessenger/8.0.47 WeChat/arm64' }
    ];
    const results = [];
    for (const device of devices) {
      await send('Emulation.setDeviceMetricsOverride', { width: device.width, height: device.height, deviceScaleFactor: 1, mobile: device.mobile });
      await send('Network.setUserAgentOverride', { userAgent: device.userAgent });
      await send('Page.navigate', { url: `http://127.0.0.1:${appPort}/` });
      await wait(400);
      const login = await send('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: `(async()=>{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({studentId:'demo-health',password:'Demo123!'})});const x=await r.json();if(!r.ok)return {ok:false,status:r.status,error:x.error};localStorage.token=x.token;localStorage.user=JSON.stringify(x.user);location.replace('/');return {ok:true};})()`
      });
      await send('Runtime.evaluate', {
        awaitPromise: true,
        expression: `new Promise((resolve)=>{const started=Date.now();const poll=()=>{if(document.querySelector('#activityTasks')||Date.now()-started>5000)return resolve();setTimeout(poll,50)};poll()})`
      });
      const evaluation = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `({title:document.title,hasStudentShell:Boolean(document.querySelector('.student-user-card')),hasCheckin:Boolean(document.querySelector('#activityTasks')),hasHistoryEntries:Boolean(document.querySelector('#historyCheckins')&&document.querySelector('#teamCheckinStats')),hasPlazaEntry:Boolean(document.querySelector('#plaza')),horizontalOverflow:document.documentElement.scrollWidth>window.innerWidth,scrollWidth:document.documentElement.scrollWidth,innerWidth:window.innerWidth})`
      });
      results.push({ device: device.name, viewport: `${device.width}x${device.height}`, login: login.result?.result?.value, ...evaluation.result?.result?.value });
      await send('Runtime.evaluate', { expression: 'localStorage.clear()' });
    }
    console.log(JSON.stringify(results, null, 2));
    if (results.some((item) => !item.login?.ok || !item.hasStudentShell || !item.hasCheckin || !item.hasHistoryEntries || !item.hasPlazaEntry || item.horizontalOverflow)) process.exitCode = 1;
    socket.close();
  } finally {
    browser.kill();
    server.kill();
    await wait(500);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    fs.rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})();
