import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPORT_PATH = 'reports/browser-image-viewer-center.json';
const VIEWPORTS = [
  { name: 'wechat-portrait-landscape-image', width: 390, height: 844, imageWidth: 1600, imageHeight: 900 },
  { name: 'wechat-portrait-portrait-image', width: 390, height: 844, imageWidth: 900, imageHeight: 1600 },
  { name: 'mobile-landscape-landscape-image', width: 844, height: 390, imageWidth: 1600, imageHeight: 900 }
];

const findChrome = () => {
  for (const command of ['google-chrome-stable', 'google-chrome', 'chromium']) {
    const found = spawnSync('which', [command], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error('未找到 Linux Chrome/Chromium，无法执行真实浏览器居中验收');
};

const extractReport = (html) => {
  const match = html.match(/<pre id="report">([^<]+)<\/pre>/);
  if (!match) throw new Error('Chrome 没有返回图片布局报告');
  return JSON.parse(match[1]
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>'));
};

const runCase = async (chrome, css, item, directory) => {
  const svg = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${item.imageWidth}" height="${item.imageHeight}" viewBox="0 0 ${item.imageWidth} ${item.imageHeight}"><rect width="100%" height="100%" fill="#1597ff"/></svg>`);
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style>
    <div class="image-viewer"><div class="image-viewer-toolbar"><button>关闭原图</button><button>保存原图</button></div><div class="image-viewer-stage"><div class="image-shell loaded"><img id="subject" width="${item.imageWidth}" height="${item.imageHeight}" src="data:image/svg+xml,${svg}" alt="layout fixture"></div></div></div>
    <pre id="report">pending</pre><script>document.body.offsetHeight;const r=subject.getBoundingClientRect();const s=document.querySelector('.image-viewer-stage').getBoundingClientRect();const report={innerWidth,innerHeight,image:{left:r.left,top:r.top,width:r.width,height:r.height,centerX:r.left+r.width/2,centerY:r.top+r.height/2},stage:{left:s.left,top:s.top,width:s.width,height:s.height,centerX:s.left+s.width/2,centerY:s.top+s.height/2},naturalWidth:${item.imageWidth},naturalHeight:${item.imageHeight}};document.getElementById('report').textContent=JSON.stringify(report)</script>`;
  const htmlPath = path.join(directory, `${item.name}.html`);
  const profilePath = path.join(directory, `${item.name}-profile`);
  await writeFile(htmlPath, html, 'utf8');
  const result = spawnSync(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    `--user-data-dir=${profilePath}`, `--window-size=${item.width},${item.height}`,
    '--virtual-time-budget=1500', '--dump-dom', new URL(`file://${htmlPath}`).href
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || `Chrome 退出码 ${result.status}`);
  const measured = extractReport(result.stdout);
  const centerDeltaX = Math.abs(measured.image.centerX - measured.stage.centerX);
  const centerDeltaY = Math.abs(measured.image.centerY - measured.stage.centerY);
  const renderedRatio = measured.image.width / measured.image.height;
  const naturalRatio = measured.naturalWidth / measured.naturalHeight;
  const ratioError = Math.abs(renderedRatio - naturalRatio);
  return {
    ...item,
    measured,
    centerDeltaX: Number(centerDeltaX.toFixed(3)),
    centerDeltaY: Number(centerDeltaY.toFixed(3)),
    ratioError: Number(ratioError.toFixed(6)),
    passed: centerDeltaX <= 1 && centerDeltaY <= 1 && ratioError <= 0.001
      && measured.image.width <= measured.stage.width + 1
      && measured.image.height <= measured.stage.height + 1
  };
};

const main = async () => {
  const chrome = findChrome();
  const css = await readFile('public/style.css', 'utf8');
  const directory = await mkdtemp(path.join(tmpdir(), 'jinshan20-viewer-center-'));
  try {
    const cases = [];
    for (const item of VIEWPORTS) cases.push(await runCase(chrome, css, item, directory));
    const version = spawnSync(chrome, ['--version'], { encoding: 'utf8' }).stdout.trim();
    const report = { generatedAt: new Date().toISOString(), chrome: version, cases, passed: cases.every((item) => item.passed) };
    await mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.passed) process.exitCode = 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
