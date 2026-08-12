import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* APPROVED_REAL_DEVICE_PERF_DIAGNOSTICS_V1 */';
const read = (relativePath) => {
  const file = path.join(root, relativePath);
  return { file, source: fs.readFileSync(file, 'utf8') };
};
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');
const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

{
  const { file, source } = read('public/app.js');
  if (!source.includes(marker)) {
    let next = source;
    const helpers = [
      marker,
      "let activePhotoFlow = null;",
      "const startPhotoFlow = (kind) => { activePhotoFlow = { kind, startedAt: performance.now() }; recordPerf('photo-flow-start', { kind }); };",
      "const photoFlowDuration = (metric) => {",
      "  if (!activePhotoFlow) return null;",
      "  const expected = activePhotoFlow.kind;",
      "  const matches = (expected === 'history' && metric === 'history-thumb')",
      "    || (expected === 'plaza' && ['plaza-thumb','plaza-detail-thumb'].includes(metric))",
      "    || (expected === 'admin-checkin' && metric === 'admin-checkin-thumb')",
      "    || (expected === 'admin-plaza' && metric === 'admin-plaza-thumb');",
      "  if (!matches) return null;",
      "  const duration = Math.round((performance.now() - activePhotoFlow.startedAt) * 10) / 10;",
      "  activePhotoFlow = null;",
      "  return duration;",
      "};",
      ''
    ].join('\n');
    next = replaceOnce(next, /const roundedDuration = \(startedAt\) => Math\.round\(\(performance\.now\(\) - startedAt\) \* 10\) \/ 10;\r?\n/, 'const roundedDuration = (startedAt) => Math.round((performance.now() - startedAt) * 10) / 10;\n' + helpers, '照片流程计时帮助函数');
    next = replaceOnce(
      next,
      "  image.addEventListener('load', () => recordPerf('image-visible', { metric, duration: roundedDuration(startedAt), bytesHint: Number(image.dataset.bytes || 0) }), { once: true });",
      "  image.addEventListener('load', () => { const flowDuration = photoFlowDuration(metric); recordPerf('image-visible', { metric, duration: roundedDuration(startedAt), flowDuration, bytesHint: Number(image.dataset.bytes || 0), cacheHint: performance.getEntriesByName(image.currentSrc || image.src).at(-1)?.transferSize === 0 ? 'warm' : 'cold' }); }, { once: true });",
      '图片可见指标'
    );
    next = replaceOnce(next, "  document.querySelector('#historyCheckins').onclick = () => openStudentCheckinHistory();", "  document.querySelector('#historyCheckins').onclick = () => { startPhotoFlow('history'); openStudentCheckinHistory(); };", '历史打卡点击计时');
    next = replaceOnce(next, "  document.querySelector('#plaza').onclick = () => plaza();", "  document.querySelector('#plaza').onclick = () => { startPhotoFlow('plaza'); plaza(); };", '活动广场点击计时');
    next = next.replace(
      'if (studentUser) openAdminUserDrawer(studentUser, date);',
      "if (studentUser) { startPhotoFlow('admin-checkin'); openAdminUserDrawer(studentUser, date); }"
    );
    next = next.replace(
      "button.onclick = () => openCompactPlazaActions(post);",
      "button.onclick = () => { startPhotoFlow('admin-plaza'); openCompactPlazaActions(post); };"
    );

    const debugPanel = [
      "const installPerfDiagnostics = () => {",
      "  let enabled = false;",
      "  try { enabled = new URLSearchParams(location.search).get('debugPerf') === '1' || localStorage.getItem('debugPerf') === '1'; } catch {}",
      "  if (!enabled || document.querySelector('#perfDiagnosticsButton')) return;",
      "  const button = document.createElement('button');",
      "  button.id = 'perfDiagnosticsButton';",
      "  button.type = 'button';",
      "  button.textContent = '性能数据';",
      "  button.onclick = () => {",
      "    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};",
      "    const payload = { capturedAt: new Date().toISOString(), userAgent: navigator.userAgent, viewport: `${innerWidth}x${innerHeight}`, devicePixelRatio, network: { effectiveType: connection.effectiveType || '', downlink: connection.downlink || 0, rtt: connection.rtt || 0, saveData: Boolean(connection.saveData) }, metrics: window.__PERF_METRICS__ || [] };",
      "    let root = document.querySelector('#perfDiagnosticsRoot');",
      "    if (!root) { root = document.createElement('div'); root.id = 'perfDiagnosticsRoot'; document.body.append(root); }",
      "    root.innerHTML = `<div class=\"perf-diagnostics-backdrop\"><section class=\"perf-diagnostics-card\"><div class=\"row\"><h2>实体设备性能数据</h2><button type=\"button\" class=\"secondary\" data-perf-close>关闭</button></div><textarea readonly>${escapeHtml(JSON.stringify(payload, null, 2))}</textarea><button type=\"button\" data-perf-copy>复制数据</button><button type=\"button\" class=\"secondary\" data-perf-clear>清空后重测</button></section></div>`;",
      "    root.querySelector('[data-perf-close]').onclick = () => { root.innerHTML = ''; };",
      "    root.querySelector('[data-perf-copy]').onclick = async () => { try { await navigator.clipboard.writeText(JSON.stringify(payload, null, 2)); showToast('性能数据已复制'); } catch { root.querySelector('textarea').select(); document.execCommand('copy'); showToast('性能数据已复制'); } };",
      "    root.querySelector('[data-perf-clear]').onclick = () => { window.__PERF_METRICS__ = []; activePhotoFlow = null; root.innerHTML = ''; showToast('已清空，请重新打开目标页面测试'); };",
      "  };",
      "  document.body.append(button);",
      "};",
      "setTimeout(installPerfDiagnostics, 0);",
      ''
    ].join('\n');
    next = replaceOnce(next, "if (window.__BOOTSTRAP_AUTHENTICATED__) home().catch(logout);", debugPanel + "if (window.__BOOTSTRAP_AUTHENTICATED__) home().catch(logout);", '实体设备性能面板');
    write(file, next);
  }
}

{
  const { file, source } = read('public/admin-dashboard-refactor.css');
  if (!source.includes(marker)) {
    const css = `

${marker}
#perfDiagnosticsButton { position: fixed; right: 12px; bottom: max(12px,env(safe-area-inset-bottom)); z-index: 99990; min-height: 42px; padding: 0 14px; border-radius: 999px; font-size: .78rem; box-shadow: 0 8px 28px rgba(0,0,0,.2); }
.perf-diagnostics-backdrop { position: fixed; inset: 0; z-index: 100100; display: grid; align-items: end; padding: 16px; background: rgba(15,20,32,.72); }
.perf-diagnostics-card { max-height: 86vh; display: grid; gap: 12px; padding: 18px; border-radius: 22px; background: var(--surface,#fffaf5); overflow: auto; }
.perf-diagnostics-card textarea { width: 100%; min-height: 52vh; padding: 12px; font: 12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace; white-space: pre; }
`;
    write(file, source + css);
  }
}

await import('./apply-approved-plaza-prefetch.mjs');
await import('./apply-checkin-service-split.mjs');

if (process.env.GITHUB_JOB === 'deploy-production') {
  await import('./apply-pica-image-pipeline.mjs');
  await import('./apply-plaza-mobile-layout.mjs');

  const productionAssetVersion = '20260731-approved1-plaza1';
  for (const relativePath of ['public/bootstrap.js', 'public/index.html', 'public/entrance.html']) {
    const { file, source } = read(relativePath);
    write(file, source.replaceAll('20260731-approved1', productionAssetVersion));
  }

  const app = read('public/app.js').source;
  const style = read('public/style.css').source;
  const plazaRoute = read('cloudflare/routes/plaza.js').source;
  if (!app.includes('PICA_IMAGE_PIPELINE_V1') || !app.includes('PLAZA_MOBILE_LAYOUT_V1') || !app.includes('uploadPreparedImagePair')) {
    throw new Error('正式构建缺少图片并行上传或活动广场移动布局代码');
  }
  if (!style.includes('PLAZA_MOBILE_LAYOUT_V1') || !plazaRoute.includes('PLAZA_MOBILE_LAYOUT_V1')) {
    throw new Error('正式构建缺少活动广场样式或搜索路由');
  }
  console.log(`Prepared production plaza release with cache version ${productionAssetVersion}.`);
}

console.log('Installed real-device photo timing diagnostics behind debugPerf=1.');
