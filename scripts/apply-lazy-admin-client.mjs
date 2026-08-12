import fs from 'node:fs';

const appPath = 'public/app.js';
const clientPath = 'public/admin-client.js';
const loaderMarker = '/* ADMIN_CLIENT_LAZY_LOADER_V1 */';
const clientMarker = '/* ADMIN_CLIENT_LAZY_CLIENT_V1 */';
const start = 'async function adminComments(page = 1) {';
const boot = 'if (window.__BOOTSTRAP_AUTHENTICATED__)';
let app = fs.readFileSync(appPath, 'utf8');

const compactStart = /\/\* ADMIN_DASHBOARD_REFACTOR_V1 \*\/\r?\nconst adminDashboardState = \{/g;
const legacyStart = 'async function legacyAdmin(';
const collapseRepeatedCompactBlocks = (source) => {
  const adminStart = source.indexOf(start);
  const finalAdmin = source.lastIndexOf('async function admin(selectedDate');
  if (adminStart < 0 || finalAdmin < 0) return source;
  const firstLegacy = source.indexOf(legacyStart, adminStart);
  const lastLegacy = source.lastIndexOf(legacyStart, finalAdmin);
  compactStart.lastIndex = lastLegacy;
  const compact = compactStart.exec(source)?.index ?? -1;
  if (firstLegacy < 0 || lastLegacy < firstLegacy || compact < lastLegacy || compact > finalAdmin) return source;
  return `${source.slice(0, firstLegacy)}${source.slice(lastLegacy, finalAdmin)}${source.slice(finalAdmin)}`;
};

if (process.argv.includes('--restore')) {
  const loaderStart = app.indexOf(loaderMarker);
  if (loaderStart < 0) process.exit(0);
  const client = fs.readFileSync(clientPath, 'utf8');
  const clientStart = client.indexOf(clientMarker) + clientMarker.length;
  const clientEnd = client.lastIndexOf('window.__ADMIN_CLIENT_RENDER__');
  const bootStart = app.indexOf(boot, loaderStart);
  if (clientStart < clientMarker.length || clientEnd < clientStart || bootStart < 0) throw new Error('Incomplete lazy admin client boundaries.');
  app = `${app.slice(0, loaderStart).trimEnd()}\n\n${client.slice(clientStart, clientEnd).trim()}\n\n${app.slice(bootStart)}`
    .replace('return loadAdminClient(undefined, pageEpoch);', 'return admin(undefined, pageEpoch);');
  fs.writeFileSync(appPath, app, 'utf8');
  process.exit(0);
}

const blockStart = app.indexOf(start);
if (blockStart < 0) {
  if (!app.includes(loaderMarker) || !fs.existsSync(clientPath)) throw new Error('Missing lazy admin client.');
  process.exit(0);
}
const bootStart = app.indexOf(boot, blockStart);
if (bootStart < 0) throw new Error('Missing admin client boundary.');
app = collapseRepeatedCompactBlocks(app);
const compactCount = (app.match(/const adminDashboardState = \{/g) || []).length;
if (compactCount !== 1) throw new Error(`Expected one compact admin dashboard before split, found ${compactCount}.`);
const normalizedBootStart = app.indexOf(boot, blockStart);
if (normalizedBootStart < 0) throw new Error('Missing normalized admin client boundary.');
const admin = app.slice(blockStart, normalizedBootStart).trim();
const loader = `${loaderMarker}
let adminClientModulePromise = null;
const loadAdminClient = (selectedDate, pageEpoch) => {
  if (user?.role !== 'admin') return Promise.resolve(false);
  if (!adminClientModulePromise) {
    const appScript = [...document.scripts].find((script) => new URL(script.src || location.href, location.href).pathname === '/app.js');
    const version = appScript ? new URL(appScript.src, location.href).searchParams.get('v') : '';
    const url = new URL('/admin-client.js', location.origin);
    if (version) url.searchParams.set('v', version);
    adminClientModulePromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-admin-client]');
      if (existing?.dataset.loaded === 'true') return resolve();
      const script = existing || document.createElement('script');
      script.dataset.adminClient = 'true'; script.async = true; script.src = url.href;
      script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
      script.onerror = () => { script.remove(); reject(new Error('管理后台模块加载失败，请检查网络后重试。')); };
      if (!existing) document.head.append(script);
    }).catch((error) => {
      adminClientModulePromise = null;
      app.innerHTML = '<main class="boot-shell"><section class="boot-error">管理后台模块加载失败，请检查网络后重试。<br><button type="button" id="retryAdminClient">重新加载</button></section></main>';
      document.querySelector('#retryAdminClient').onclick = () => { void home({ showShell: false }); };
      throw error;
    });
  }
  return adminClientModulePromise.then(() => window.__ADMIN_CLIENT_RENDER__(selectedDate, pageEpoch));
};
`;
app = `${app.slice(0, blockStart).trimEnd()}\n\n${loader}\n${app.slice(normalizedBootStart)}`
  .replace('return admin(undefined, pageEpoch);', 'return loadAdminClient(undefined, pageEpoch);');
if (app.includes(start) || !app.includes(loaderMarker)) throw new Error('Admin client split failed.');
fs.writeFileSync(clientPath, `${clientMarker}\n${admin}\n\nwindow.__ADMIN_CLIENT_RENDER__ = (selectedDate, pageEpoch) => admin(selectedDate, pageEpoch);\n`, 'utf8');
fs.writeFileSync(appPath, app, 'utf8');
