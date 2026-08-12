import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* APPROVED_MOBILE_EXPERIENCE_FRONTEND_V1 */';
const version = '20260731-approved1';

const read = (relativePath) => {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) throw new Error(`${relativePath}不存在`);
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
    next = next.replace(/const MEDIA_THUMB_MAX_EDGE = (?:360|540);/, 'const MEDIA_THUMB_MAX_EDGE = 640;');
    next = next.replace(/const MEDIA_THUMB_MAX_SIZE_MB = (?:0\.12|0\.18);/, 'const MEDIA_THUMB_MAX_SIZE_MB = 0.22;');
    next = next.replace(/const MEDIA_THUMB_QUALITY = (?:0\.72|0\.82);/, 'const MEDIA_THUMB_QUALITY = 0.82;');

    if (next.includes('  const materialResult = { tasks: dashboard.materialTasks };\n')) {
      next = replaceOnce(
        next,
        "  const materialResult = { tasks: dashboard.materialTasks };\n",
        "  const checkinStats = dashboard.checkinStats || { personalDays: 0, teamDays: 0 };\n",
        '学生首页累计打卡数据'
      );
    } else if (!next.includes('const checkinStats = dashboard.checkinStats')) {
      next = replaceOnce(
        next,
        '  const taskResult = { tasks: dashboard.tasks };',
        '  const taskResult = { tasks: dashboard.tasks };\n  const checkinStats = dashboard.checkinStats || { personalDays: 0, teamDays: 0 };',
        'current student dashboard check-in totals'
      );
    }
    next = replaceOnce(
      next,
      /      <div class="student-progress"[^>]*><strong>\$\{taskProgress\}%<\/strong><span>任务进度<\/span><\/div>/,
      '      <div class="student-progress student-checkin-total"><strong>${Number(checkinStats.personalDays || 0)}天</strong><span>个人累计打卡</span></div>',
      '个人累计打卡显示'
    );
    next = replaceOnce(
      next,
      /    <nav class="student-shortcuts[^"]*"[^>]*>[\s\S]*?    <\/nav>/,
      [
        '    <nav class="student-shortcuts student-shortcuts-compact student-shortcuts-four" aria-label="常用功能">',
        '      <button id="historyCheckins"><span>✓</span><strong>历史打卡</strong><small>查看记录</small></button>',
        '      <button id="plaza"><span>▦</span><strong>活动广场</strong><small>查看作品</small></button>',
        '      <button id="inbox"><span>✉</span><strong>信息箱</strong><small>通知评论</small></button>',
        '      <button id="teamCheckinStats"><span>◇</span><strong>队伍累计</strong><small>${dashboard.teamSummary?.team ? `${Number(checkinStats.teamDays || 0)}天` : \'未加入\'}</small></button>',
        '    </nav>'
      ].join('\n'),
      '四项同排快捷入口'
    );
    next = replaceOnce(
      next,
      "  document.querySelector('#inbox').onclick = () => inbox();",
      [
        "  document.querySelector('#inbox').onclick = () => inbox();",
        "  document.querySelector('#teamCheckinStats').onclick = () => void openDialog({",
        "    title: '队伍累计打卡',",
        "    message: dashboard.teamSummary?.team",
        "      ? `${dashboard.teamSummary.team.name} 已累计完成 ${Number(checkinStats.teamDays || 0)} 天队伍汇总提交。`",
        "      : '当前尚未加入队伍。',",
        "    notice: true,",
        "    confirmText: '知道了'",
        "  });"
      ].join('\n'),
      '队伍累计打卡交互'
    );
    next = next.replace(
      "${task.scheduleType === 'activityDays' ? `${escapeHtml(task.occurrenceDate)} 当天 ${task.dailyStart}–${task.dailyEnd} · 活动第 ${task.refreshDays.join('、')} 天自动刷新` : task.scheduleType === 'weekly' ? `${escapeHtml(task.occurrenceDate)} 当天 ${task.dailyStart}–${task.dailyEnd} · 周${task.weekdays.join('、周')}自动刷新` : `${formatDate(task.startAt)} 至 ${formatDate(task.endAt)}`} · 最多 ${task.imageLimit} 张图 · ${task.allowLate ? '允许补交' : '不允许补交'}",
      "${task.scheduleType === 'activityDays' ? `${escapeHtml(task.occurrenceDate)} 当天 ${task.dailyStart}–${task.dailyEnd} · 活动第 ${task.refreshDays.join('、')} 天自动刷新` : task.scheduleType === 'weekly' ? `${escapeHtml(task.occurrenceDate)} 当天 ${task.dailyStart}–${task.dailyEnd} · 周${task.weekdays.join('、周')}自动刷新` : `${formatDate(task.startAt)} 至 ${formatDate(task.endAt)}`} · ${isInteraction ? `个人最多 ${task.memberImageLimit || task.imageLimit} 张 · 队伍汇总最多 ${task.imageLimit} 张` : `最多 ${task.imageLimit} 张图`} · ${task.allowLate ? '允许补交' : '不允许补交'}"
    );
    const materialSectionPattern = /  const materialStatus = \{[\s\S]*?app\.insertAdjacentHTML\('beforeend', `<section class="card"><div class="row"><h2>最终截图证明<\/h2>[\s\S]*?`\);\r?\n/;
    if (materialSectionPattern.test(next)) next = next.replace(materialSectionPattern, '');
    next = next.replace(/  document\.querySelectorAll\('\[data-material\]'\)[\s\S]*?  \}\);\n/, '');
    next = next.replace(/  document\.querySelectorAll\('\.material-download'\)[\s\S]*?  \}\);\n/, '');

    next = next.replace('const maxImages = Math.max(1, Math.min(20, Number(task.imageLimit) || 1));', 'const maxImages = Math.max(1, Math.min(8, Number(task.memberImageLimit || task.imageLimit) || 1));');

    next = next.replace(
      '<img data-src="${escapeHtml(thumbUrl)}" loading="${index ? \'lazy\' : \'eager\'}"\n          width="480" height="360" fetchpriority="${index ? \'low\' : \'high\'}"',
      '<img data-perf-image="history-thumb" data-priority="${index ? \'low\' : \'high\'}" data-src="${escapeHtml(thumbUrl)}" loading="${index ? \'lazy\' : \'eager\'}"\n          width="640" height="480" fetchpriority="${index ? \'low\' : \'high\'}"'
    );

    next = next.replace('const cards = result.posts.map((post) => `', 'const cards = result.posts.map((post, postIndex) => `');
    next = next.replace(
      '<img loading="lazy" decoding="async" fetchpriority="low" width="480" height="360"\n              data-src="${escapeHtml(post.images[0].thumbUrl || post.images[0].imageUrl)}"',
      '<img data-perf-image="plaza-thumb" data-priority="${postIndex === 0 ? \'high\' : \'low\'}" loading="${postIndex === 0 ? \'eager\' : \'lazy\'}" decoding="async" fetchpriority="${postIndex === 0 ? \'high\' : \'low\'}" width="640" height="480"\n              data-src="${escapeHtml(post.images[0].thumbUrl || post.images[0].imageUrl)}"'
    );
    next = next.replace('post.images.map((image) => `', 'post.images.map((image, imageIndex) => `');
    next = next.replace(
      '<img loading="lazy" decoding="async" fetchpriority="low" width="480" height="360"\n            data-src="${escapeHtml(image.thumbUrl || image.imageUrl)}"',
      '<img data-perf-image="plaza-detail-thumb" data-priority="${imageIndex === 0 ? \'high\' : \'low\'}" loading="${imageIndex === 0 ? \'eager\' : \'lazy\'}" decoding="async" fetchpriority="${imageIndex === 0 ? \'high\' : \'low\'}" width="640" height="480"\n            data-src="${escapeHtml(image.thumbUrl || image.imageUrl)}"'
    );
    next = next.replace(/width="540" height="405"/g, 'width="640" height="480"');
    next = next.replace('data-image-alt="打卡照片">\n          <span class="image-shell"><img', 'data-image-alt="打卡照片">\n          <span class="image-shell"><img data-perf-image="admin-checkin-thumb"');

    const imagePerf = [
      "const preparePerfImage = (image) => {",
      "  const metric = image.dataset.perfImage;",
      "  if (!metric || image.dataset.perfBound) return;",
      "  image.dataset.perfBound = 'true';",
      "  const startedAt = performance.now();",
      "  image.addEventListener('load', () => recordPerf('image-visible', { metric, duration: roundedDuration(startedAt), bytesHint: Number(image.dataset.bytes || 0) }), { once: true });",
      "  image.addEventListener('error', () => recordPerf('image-error', { metric, duration: roundedDuration(startedAt) }), { once: true });",
      "};",
      ''
    ].join('\n');
    next = replaceOnce(next, "const prepareDynamicContent = (container = app) => {", imagePerf + "const prepareDynamicContent = (container = app) => {", '图片真实显示计时');
    const dynamicReadyPattern = /    if \(image\.dataset\.dynamicReady\) return;\r?\n    image\.dataset\.dynamicReady = 'true';/;
    next = replaceOnce(next, dynamicReadyPattern, "    if (image.dataset.dynamicReady) return;\n    image.dataset.dynamicReady = 'true';\n    preparePerfImage(image);", '动态图片计时绑定');

    const saveFunction = [
      "const saveOriginalImage = async (url, alt = '活动原图') => {",
      "  const target = buildMediaUrl(url);",
      "  const embedded = /MicroMessenger|QQ\\//i.test(navigator.userAgent);",
      "  if (embedded) {",
      "    window.open(target, '_blank', 'noopener');",
      "    showToast(/iPhone|iPad|iPod/i.test(navigator.userAgent) ? '已打开高清原图，请长按图片保存。' : '已打开高清原图，可长按或使用浏览器菜单保存。');",
      "    return;",
      "  }",
      "  const response = await fetch(target, { credentials: 'same-origin' });",
      "  if (!response.ok) throw new Error('原图下载失败，请稍后重试。');",
      "  const blob = await response.blob();",
      "  const objectUrl = URL.createObjectURL(blob);",
      "  const anchor = document.createElement('a');",
      "  anchor.href = objectUrl;",
      "  anchor.download = `${String(alt || '活动原图').replace(/[^\\w\\u4e00-\\u9fa5-]+/g, '-')}.webp`;",
      "  document.body.append(anchor);",
      "  anchor.click();",
      "  anchor.remove();",
      "  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);",
      "};",
      ''
    ].join('\n');
    next = replaceOnce(next, 'const openImageViewer = (thumbSrc, displaySrc, alt = \'查看图片\', renderedImage = null) => {', saveFunction + "const openImageViewer = (thumbSrc, displaySrc, alt = '查看图片', renderedImage = null) => {", '原图保存功能');
    next = replaceOnce(
      next,
      /  viewer\.innerHTML = `\r?\n    <div class="image-viewer-stage"([\s\S]*?)<\/div><\/div>`;/,
      '  viewer.innerHTML = `\n    <div class="image-viewer-toolbar"><button type="button" class="secondary" data-image-close>关闭原图</button><button type="button" data-image-save>保存原图</button></div>\n    <div class="image-viewer-stage"$1</div></div>`;',
      '原图查看器工具栏'
    );
    next = replaceOnce(
      next,
      "  const retry = viewer.querySelector('.image-error');",
      [
        "  const retry = viewer.querySelector('.image-error');",
        "  viewer.querySelector('[data-image-close]').onclick = (event) => { event.stopPropagation(); closeImageViewer(); };",
        "  viewer.querySelector('[data-image-save]').onclick = async (event) => {",
        "    event.stopPropagation();",
        "    const restore = beginButtonLoading(event.currentTarget, '处理中…');",
        "    try { await saveOriginalImage(display, alt); } catch (error) { alert(error.message); } finally { restore(); }",
        "  };",
        "  viewer.querySelector('.image-viewer-toolbar').onclick = (event) => event.stopPropagation();"
      ].join('\n'),
      '原图查看器按钮事件'
    );

    const settingsFunctions = [
      "async function refreshCompactCheckinSettings() {",
      "  const panel = document.querySelector('#adminPanel-checkin');",
      "  if (!panel || panel.hidden) return;",
      "  panel.innerHTML = '<div class=\"admin-panel-loading\">正在读取打卡设置…</div>';",
      "  try {",
      "    const result = await api('/api/admin/checkin-settings');",
      "    const settings = result.settings || {};",
      "    const weekdays = new Set((settings.weekdays || [1,2,3,4,5,6,7]).map(Number));",
      "    panel.innerHTML = `<form id=\"compactCheckinSettings\" class=\"admin-compact-form checkin-settings-form\">",
      "      <label class=\"switch-line\"><input name=\"enabled\" type=\"checkbox\" ${settings.enabled !== false ? 'checked' : ''}>开放打卡</label>",
      "      <div class=\"settings-grid\"><label>开始日期<input name=\"activeStartDate\" type=\"date\" value=\"${escapeHtml(settings.activeStartDate || '')}\" required></label>",
      "      <label>结束日期<input name=\"activeEndDate\" type=\"date\" value=\"${escapeHtml(settings.activeEndDate || '')}\" required></label>",
      "      <label>每日开始<input name=\"dailyStart\" type=\"time\" value=\"${escapeHtml(settings.dailyStart || '00:00')}\" required></label>",
      "      <label>每日结束<input name=\"dailyEnd\" type=\"time\" value=\"${escapeHtml(settings.dailyEnd || '23:59')}\" required></label>",
      "      <label>个人打卡照片数<input name=\"personalImageLimit\" type=\"number\" min=\"1\" max=\"8\" value=\"${Number(settings.personalImageLimit || 3)}\" required></label>",
      "      <label>队伍汇总照片数<input name=\"teamImageLimit\" type=\"number\" min=\"1\" max=\"8\" value=\"${Number(settings.teamImageLimit || 3)}\" required></label></div>",
      "      <fieldset><legend>允许打卡的星期</legend><div class=\"weekday-options\">${[1,2,3,4,5,6,7].map((day) => `<label><input type=\"checkbox\" name=\"weekdays\" value=\"${day}\" ${weekdays.has(day) ? 'checked' : ''}>周${day}</label>`).join('')}</div></fieldset>",
      "      <button>保存打卡设置</button>",
      "    </form>`;",
      "    panel.querySelector('#compactCheckinSettings').onsubmit = async (event) => {",
      "      event.preventDefault();",
      "      const restore = beginButtonLoading(event.submitter, '保存中…');",
      "      const form = event.target;",
      "      const values = Object.fromEntries(new FormData(form));",
      "      const weekdays = [...form.querySelectorAll('[name=weekdays]:checked')].map((input) => Number(input.value));",
      "      try {",
      "        await api('/api/admin/checkin-settings', { method: 'PUT', body: JSON.stringify({ ...values, enabled: form.enabled.checked, weekdays, personalImageLimit: Number(values.personalImageLimit), teamImageLimit: Number(values.teamImageLimit) }) });",
      "        studentDashboardDirty = true; studentViewState.dirty = true; showToast('打卡设置已保存');",
      "        await refreshCompactCheckinSettings();",
      "      } catch (error) { restore(); alert(error.message); }",
      "    };",
      "  } catch (error) { panel.innerHTML = `<div class=\"admin-inline-error\"><p>${escapeHtml(error.message)}</p><button id=\"retryCheckinSettings\">重新加载</button></div>`; panel.querySelector('#retryCheckinSettings').onclick = refreshCompactCheckinSettings; }",
      "}",
      ''
    ].join('\n');
    next = replaceOnce(next, 'async function setCompactAdminPanel(name) {', settingsFunctions + 'async function setCompactAdminPanel(name) {', '管理员打卡设置界面');
    next = replaceOnce(next, "  if (name === 'team') await refreshCompactTeamPanel(false);", "  if (name === 'checkin') await refreshCompactCheckinSettings();\n  if (name === 'team') await refreshCompactTeamPanel(false);", '打卡设置折叠加载');
    next = replaceOnce(
      next,
      "        ${adminAccordionMarkup('team', '队伍管理', '队伍列表、手动创建与 Excel 导入')}",
      "        ${adminAccordionMarkup('checkin', '打卡设置', '打卡日期、时段、星期与照片数量')}\n        ${adminAccordionMarkup('team', '队伍管理', '队伍列表、手动创建与 Excel 导入')}",
      '打卡设置模块入口'
    );

    next = replaceOnce(next, '<div><dt>任务</dt><dd>${escapeHtml(post.taskName)}</dd></div>', '<div><dt>队伍</dt><dd>${escapeHtml(post.teamName)}</dd></div>', '广场详情队伍字段');
    next = replaceOnce(
      next,
      /      <div class="wide"><dt>文案<\/dt><dd>\$\{escapeHtml\(post\.copy \|\| '[^']*'\)\}<\/dd><\/div>\r?\n    <\/dl>/,
      [
        '      <div class="wide"><dt>文案</dt><dd>${escapeHtml(post.copy || \'无文案\')}</dd></div>',
        '    </dl>',
        '    <div class="admin-post-photo-grid">${(post.images || []).map((image, imageIndex) => `<button type="button" class="image-viewer-trigger admin-post-photo" data-image-viewer="${escapeHtml(image.thumbUrl || image.imageUrl)}" data-image-thumb="${escapeHtml(image.thumbUrl || image.imageUrl)}" data-image-display="${escapeHtml(image.displayUrl || image.imageUrl)}" data-image-alt="${escapeHtml(post.teamName)}活动原图"><span class="image-shell"><img data-perf-image="admin-plaza-thumb" data-priority="${imageIndex === 0 ? \'high\' : \'low\'}" data-src="${escapeHtml(image.thumbUrl || image.imageUrl)}" loading="${imageIndex === 0 ? \'eager\' : \'lazy\'}" fetchpriority="${imageIndex === 0 ? \'high\' : \'low\'}" decoding="async" width="640" height="480" alt="活动照片" onload="this.parentElement.classList.add(\'loaded\')" onerror="this.hidden=true;this.parentElement.classList.add(\'failed\')"><span class="image-error">图片加载失败</span></span></button>`).join(\'\') || \'<p class="muted">该帖子暂无照片</p>\'}</div>'
      ].join('\n'),
      '管理员广场照片展示'
    );
    const postActionsStart = next.indexOf('function openCompactPostActions(post) {');
    const postAppendAnchor = '  document.body.append(root);';
    const postAppendIndex = next.indexOf(postAppendAnchor, postActionsStart);
    if (postActionsStart < 0 || postAppendIndex < 0) {
      throw new Error('未找到管理员广场动态图片加载，已停止以避免误改');
    }
    if (!next.slice(postAppendIndex, postAppendIndex + 100).includes('prepareDynamicContent(root);')) {
      const insertAt = postAppendIndex + postAppendAnchor.length;
      next = `${next.slice(0, insertAt)}\n  prepareDynamicContent(root);${next.slice(insertAt)}`;
    }

    next += `\n${marker}\n`;
    write(file, next);
  }
}

{
  const { file, source } = read('public/admin-dashboard-refactor.css');
  if (!source.includes(marker)) {
    const css = `

${marker}
.student-hero { padding: 24px 24px 20px; }
.student-hero-copy { min-width: 0; }
.student-hero-copy h1 { white-space: nowrap; font-size: clamp(1.72rem, 6.8vw, 2.35rem); letter-spacing: -.045em; }
.student-hero-copy p { margin-top: 8px; font-size: .9rem; }
.student-user-card { padding: 18px 20px; min-height: 0; }
.student-avatar { width: 58px; height: 58px; font-size: 1.15rem; }
.student-user-copy h2 { font-size: 1.45rem; }
.student-checkin-total { min-width: 92px; }
.student-checkin-total strong { font-size: 1.25rem; }
.student-shortcuts-four { display: grid !important; grid-template-columns: repeat(4,minmax(0,1fr)) !important; gap: 8px !important; }
.student-shortcuts-four button { min-width: 0; min-height: 92px; padding: 12px 6px !important; border-radius: 18px !important; text-align: center; }
.student-shortcuts-four button span { font-size: 1.35rem; }
.student-shortcuts-four button strong { font-size: .88rem; line-height: 1.15; white-space: nowrap; }
.student-shortcuts-four button small { font-size: .68rem; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.image-viewer { z-index: 100000 !important; isolation: isolate; }
.image-viewer-toolbar { position: fixed; top: max(14px,env(safe-area-inset-top)); left: 14px; right: 14px; z-index: 2; display: flex; justify-content: space-between; gap: 10px; pointer-events: auto; }
.image-viewer-toolbar button { min-height: 44px; padding: 0 18px; }
.image-viewer-stage { z-index: 1; }
.admin-post-photo-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; margin: 14px 0; }
.admin-post-photo { padding: 0; border: 0; overflow: hidden; border-radius: 14px; background: transparent; }
.admin-post-photo .image-shell { display: block; aspect-ratio: 4/3; }
.admin-post-photo img { width: 100%; height: 100%; object-fit: cover; }
.checkin-settings-form .settings-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
.checkin-settings-form fieldset { margin: 0; padding: 12px; border: 1px solid var(--border,rgba(0,0,0,.12)); border-radius: 14px; }
.weekday-options { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 8px; }
.weekday-options label,.switch-line { display: flex; align-items: center; gap: 7px; }
@media (max-width:430px) {
  .student-hero { padding: 20px 18px 18px; }
  .student-hero-copy h1 { font-size: clamp(1.42rem,6.6vw,1.82rem); }
  .student-logout { top: 16px; right: 16px; }
  .student-user-card { padding: 15px 16px; gap: 10px; }
  .student-avatar { width: 50px; height: 50px; }
  .student-user-copy h2 { font-size: 1.25rem; }
  .student-checkin-total { min-width: 78px; }
  .student-shortcuts-four { gap: 6px !important; }
  .student-shortcuts-four button { min-height: 82px; padding: 10px 3px !important; border-radius: 15px !important; }
  .student-shortcuts-four button strong { font-size: .78rem; }
  .student-shortcuts-four button small { font-size: .61rem; }
  .checkin-settings-form .settings-grid { grid-template-columns: 1fr; }
  .weekday-options { grid-template-columns: repeat(3,minmax(0,1fr)); }
}
`;
    write(file, source + css);
  }
}

for (const relativePath of ['public/bootstrap.js', 'public/index.html', 'public/entrance.html']) {
  const { file, source } = read(relativePath);
  const next = source.replace(/202607\d{2}-(?:flow2|adminphoto1|adminphoto2|approved1)/g, version);
  write(file, next);
}

console.log('Applied approved compact student home, admin settings, layered original viewer and 640px WebP UI.');
await import('./apply-approved-lazy-admin.mjs');
