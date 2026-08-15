import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = 'BUILD_ASSET_VERSION_V1';
const fallbackVersion = '20260731-approved1';
const commitSha = String(
  process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || ''
).trim().toLowerCase();
const buildVersion = /^[0-9a-f]{40}$/.test(commitSha)
  ? commitSha
  : fallbackVersion;

const targets = [
  { relativePath: 'public/index.html', type: 'html' },
  { relativePath: 'public/entrance.html', type: 'html' },
  { relativePath: 'public/bootstrap.js', type: 'javascript' }
];

const applyBuildAssetVersion = () => {
  let changedFiles = 0;

  for (const target of targets) {
    const file = path.join(root, target.relativePath);
    if (!fs.existsSync(file)) throw new Error(`${target.relativePath}不存在`);

    const source = fs.readFileSync(file, 'utf8');
    const references = [...source.matchAll(/\?v=([a-zA-Z0-9._-]+)/g)];
    if (!references.length) {
      throw new Error(`${target.relativePath}没有可更新的版本化资源地址`);
    }

    let next = source.replace(
      /\?v=[a-zA-Z0-9._-]+/g,
      `?v=${buildVersion}`
    );

    if (!next.includes(marker)) {
      const markerText = target.type === 'html'
        ? `  <!-- ${marker} fallback=${fallbackVersion} -->\n`
        : `/* ${marker} fallback=${fallbackVersion} */\n`;
      next = target.type === 'html'
        ? next.replace('</head>', `${markerText}</head>`)
        : `${markerText}${next}`;
    }

    if (!next.includes(`?v=${buildVersion}`)) {
      throw new Error(`${target.relativePath}资源版本写入失败`);
    }

    if (next !== source) {
      fs.writeFileSync(file, next, 'utf8');
      changedFiles += 1;
    }
  }

  if (changedFiles) {
    console.log(`Applied commit-scoped asset version ${buildVersion} to ${changedFiles} files.`);
  }
};

const assertStrictRuntime = () => {
  const required = [
    ['public/entrance.html', 'STRICT_P95_LOGIN_HTML_V4'],
    ['public/entrance.js', 'STRICT_P95_LOGIN_READY_V4'],
    ['public/bootstrap.js', 'STRICT_P95_BOOTSTRAP_V4'],
    ['public/bootstrap.js', 'STRICT_P95_ASSET_OVERLAP_V4'],
    ['public/bootstrap.js', 'LOGIN_BOOTSTRAP_HANDOFF_V2'],
    ['public/app.js', 'STRICT_P95_APP_PREFETCH_V4'],
    ['public/app.js', 'MOBILE_REAL_UNDER_1S_V5'],
    ['templates/plaza-mobile-page.txt', 'MOBILE_REAL_UNDER_1S_V5'],
    ['cloudflare/services/student-dashboard.js', 'STRICT_P95_DASHBOARD_BATCH_V4'],
    ['cloudflare/worker.js', 'LOGIN_BOOTSTRAP_HANDOFF_V2']
  ];
  for (const [relativePath, expected] of required) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    if (!source.includes(expected)) {
      throw new Error(`最终构建缺少${expected}：${relativePath}`);
    }
  }
  const bootstrap = fs.readFileSync(path.join(root, 'public/bootstrap.js'), 'utf8');
  if (bootstrap.includes("fetch('/api/plaza?sort=latest&page=1&limit=20'")) {
    throw new Error('最终构建仍在登录/首页启动关键路径直接请求活动广场');
  }
  const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  if (!app.includes('void startPlazaPrefetch();')) {
    throw new Error('最终构建没有在首页首帧后立即启动广场预热');
  }
  if (!app.includes("preload.fetchPriority = index < 2 ? 'high' : 'auto';")) {
    throw new Error('最终构建没有预热活动广场前四张列表图');
  }
};

applyBuildAssetVersion();
assertStrictRuntime();
console.log('Validated canonical strict runtime and stamped the exact asset version without applying overlays.');

const hookKey = Symbol.for('jinshan20.buildAssetVersionBeforeExit');
if (!globalThis[hookKey]) {
  globalThis[hookKey] = true;
  process.once('beforeExit', applyBuildAssetVersion);
}
