import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* TRACK_AWARE_ADMIN_SETTINGS_V1 */';

const read = (relativePath) => {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) throw new Error(`${relativePath}不存在`);
  return { file, source: fs.readFileSync(file, 'utf8') };
};
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');
const replaceOnce = (source, search, replacement, label) => {
  if (source.includes(search)) return source.replace(search, replacement);
  const windowsSearch = search.replaceAll('\n', '\r\n');
  if (source.includes(windowsSearch)) return source.replace(windowsSearch, replacement);
  throw new Error(`未找到${label}，已停止以避免误改`);
};
const replaceSection = (source, startText, endText, replacement, label) => {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  if (start < 0 || end < 0) throw new Error(`未找到${label}范围，已停止以避免误改`);
  return source.slice(0, start) + replacement.trimEnd() + '\n\n' + source.slice(end);
};

const patchAdminUserPanel = (source) => {
  if (source.includes('data-track-filter="health"')) return source;
  let next = source;
  next = replaceOnce(
    next,
    "  userTab: sessionStorage.getItem('adminUserTab') || 'single',\n  requestEpoch: 0",
    "  userTab: sessionStorage.getItem('adminUserTab') || 'single',\n  userTrack: ['health', 'interaction'].includes(sessionStorage.getItem('adminUserTrack'))\n    ? sessionStorage.getItem('adminUserTrack') : 'health',\n  requestEpoch: 0",
    '管理员用户赛道状态'
  );
  next = replaceOnce(
    next,
    "  const completed = Number(completion.overall?.completed || 0);\n  const total = Number(completion.overall?.total || 0);\n  const missing = Math.max(0, total - completed);",
    "  const selectedTrack = adminDashboardState.userTrack;\n  const selectedTrackLabel = selectedTrack === 'health' ? '健康自律赛道' : '四校区赛道';\n  const selectedTrackSummary = completion.tracks?.find((item) => item.trackId === selectedTrack) || {};\n  const completed = Number(selectedTrackSummary.completed || 0);\n  const total = Number(selectedTrackSummary.total || 0);\n  const missing = Math.max(0, total - completed);",
    '选中赛道用户统计'
  );
  next = replaceOnce(
    next,
    '<div><h2>全部赛道用户</h2><p class="muted">点击姓名查看当天记录或进行补卡</p></div>',
    '<div><h2>${selectedTrackLabel}</h2><p class="muted">点击姓名查看当天记录或进行补卡</p></div>',
    '用户面板赛道标题'
  );
  next = replaceOnce(
    next,
    '    <div class="user-filter-tabs" role="group" aria-label="完成状态筛选">',
    `    <div class="user-track-tabs" role="tablist" aria-label="用户赛道筛选">
      <button type="button" role="tab" class="secondary track-filter \${selectedTrack === 'health' ? 'active' : ''}" data-track-filter="health" aria-selected="\${selectedTrack === 'health'}">健康自律赛道</button>
      <button type="button" role="tab" class="secondary track-filter \${selectedTrack === 'interaction' ? 'active' : ''}" data-track-filter="interaction" aria-selected="\${selectedTrack === 'interaction'}">四校区赛道</button>
    </div>
    <div class="user-filter-tabs" role="group" aria-label="完成状态筛选">`,
    '用户赛道筛选按钮'
  );
  next = replaceOnce(
    next,
    "  document.querySelectorAll('.user-filter').forEach((button) => {",
    `  document.querySelectorAll('.track-filter').forEach((button) => {
    button.onclick = () => {
      adminDashboardState.userTrack = button.dataset.trackFilter;
      sessionStorage.setItem('adminUserTrack', adminDashboardState.userTrack);
      adminUserPage = 1;
      sessionStorage.adminUserPage = '1';
      refreshCompactAdminUsers(date);
    };
  });
  document.querySelectorAll('.user-filter').forEach((button) => {`,
    '用户赛道筛选事件'
  );
  next = replaceOnce(
    next,
    "api(`/api/admin/users?page=${adminUserPage}&limit=30&q=${encodeURIComponent(adminUserQuery)}&completion=${adminUserFilter}&date=${date}`)",
    "api(`/api/admin/users?page=${adminUserPage}&limit=30&q=${encodeURIComponent(adminUserQuery)}&completion=${adminUserFilter}&track=${adminDashboardState.userTrack}&date=${date}`)",
    '用户列表赛道查询参数'
  );
  return next;
};

for (const relativePath of ['scripts/admin-dashboard-refactor.template.js', 'public/app.js']) {
  const { file, source } = read(relativePath);
  const next = patchAdminUserPanel(source);
  if (next !== source) write(file, next);
}

{
  const { file, source } = read('public/app.js');
  if (!source.includes(marker)) {
    const frontendTemplate = read('templates/track-admin-settings-frontend.txt').source;
    let next = replaceSection(
      source,
      'async function refreshCompactCheckinSettings() {',
      'async function setCompactAdminPanel(name) {',
      frontendTemplate,
      '分赛道打卡设置界面'
    );
    next += `\n${marker}\n`;
    write(file, next);
  }
}

{
  const { file, source } = read('public/admin-dashboard-refactor.css');
  if (!source.includes(marker)) {
    const css = `

${marker}
.user-track-tabs,.checkin-track-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:12px 0}
.user-track-tabs button,.checkin-track-tabs button{min-height:46px;border-radius:16px;font-weight:750}
.user-track-tabs button.active,.checkin-track-tabs button.active{background:linear-gradient(135deg,#ff0066,#ff684d);color:#fff;box-shadow:0 10px 24px rgba(255,36,66,.16)}
.checkin-track-note{margin:0 0 14px}
.health-slot-settings{margin-top:12px}
.health-slot-grid{display:grid;gap:10px}
.health-slot-row{display:grid;grid-template-columns:62px repeat(2,minmax(0,1fr));gap:10px;align-items:end;padding:10px;border-radius:14px;background:rgba(255,247,244,.72)}
.health-slot-row strong{align-self:center}
.health-slot-row label{min-width:0}
@media(max-width:430px){.user-track-tabs,.checkin-track-tabs{gap:8px}.user-track-tabs button,.checkin-track-tabs button{font-size:.88rem;padding:9px 6px}.health-slot-row{grid-template-columns:1fr 1fr}.health-slot-row strong{grid-column:1/-1}}
`;
    write(file, source + css);
  }
}

{
  const { file, source } = read('cloudflare/lib/runtime.js');
  if (!source.includes(marker)) {
    let next = replaceOnce(
      source,
      '  const checkinSettingsConfigured = Object.prototype.hasOwnProperty.call(values, \'checkinSettings\');\n  return {',
      '  const checkinSettingsConfigured = Object.prototype.hasOwnProperty.call(values, \'checkinSettings\');\n  const healthCheckinSettings = values.healthCheckinSettings || {};\n  return {',
      '健康自律设置读取变量'
    );
    const environmentAnchor = "    environment: env.ENVIRONMENT || 'unknown'";
    const healthSettings = [
      '    healthCheckinSettings: {',
      '      enabled: healthCheckinSettings.enabled !== false && values.trackEnabled?.health !== false,',
      "      activeStartDate: healthCheckinSettings.activeStartDate || values.startDate || '',",
      "      activeEndDate: healthCheckinSettings.activeEndDate || values.endDate || '',",
      '      weekdays: Array.isArray(healthCheckinSettings.weekdays) && healthCheckinSettings.weekdays.length',
      '        ? healthCheckinSettings.weekdays.map(Number).filter((day) => day >= 1 && day <= 7)',
      '        : [1, 2, 3, 4, 5, 6, 7],',
      '      personalImageLimit: Math.min(8, Math.max(1, Number(healthCheckinSettings.personalImageLimit || 3))),',
      '      slots: Array.isArray(healthCheckinSettings.slots) && healthCheckinSettings.slots.length',
      '        ? healthCheckinSettings.slots',
      '        : (values.slots || [',
      "          { id: 'breakfast', label: '早餐', start: '06:50', end: '10:00' },",
      "          { id: 'lunch', label: '午餐', start: '10:30', end: '14:00' },",
      "          { id: 'dinner', label: '晚餐', start: '16:30', end: '19:30' }",
      '        ])',
      '    },',
      environmentAnchor
    ].join('\n');
    next = replaceOnce(
      next,
      environmentAnchor,
      healthSettings,
      '健康自律设置返回值'
    );
    next = marker + '\n' + next;
    write(file, next);
  }
}

{
  const { file, source } = read('cloudflare/routes/admin.js');
  if (!source.includes(marker)) {
    const routeBlock = `  if (route === '/api/admin/checkin-settings' && request.method === 'GET') {
    const current = await readConfig(env);
    const trackId = ['health', 'interaction'].includes(url.searchParams.get('track'))
      ? url.searchParams.get('track') : 'interaction';
    return json({
      trackId,
      settings: trackId === 'health' ? current.healthCheckinSettings : current.checkinSettings
    });
  }

  if (route === '/api/admin/checkin-settings' && request.method === 'PUT') {
    const body = await readJson(request);
    const trackId = body.trackId === 'health' ? 'health' : 'interaction';
    const activeStartDate = cleanText(body.activeStartDate, 10);
    const activeEndDate = cleanText(body.activeEndDate, 10);
    const weekdays = Array.isArray(body.weekdays)
      ? [...new Set(body.weekdays.map(Number).filter((day) => day >= 1 && day <= 7))].sort((a, b) => a - b)
      : [];
    const personalImageLimit = Math.min(8, Math.max(1, Number(body.personalImageLimit || 1)));
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(activeStartDate)
        || !/^\\d{4}-\\d{2}-\\d{2}$/.test(activeEndDate)
        || activeStartDate > activeEndDate) {
      return json({ error: '活动开始和结束日期无效' }, 400);
    }
    if (!weekdays.length) return json({ error: '至少选择一个允许打卡的星期' }, 400);
    const current = await readConfig(env);
    if (trackId === 'health') {
      const slotLabels = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };
      const slots = ['breakfast', 'lunch', 'dinner'].map((id) => {
        const source = Array.isArray(body.slots) ? body.slots.find((item) => item?.id === id) : null;
        return {
          id,
          label: slotLabels[id],
          start: cleanText(source?.start, 5),
          end: cleanText(source?.end, 5)
        };
      });
      if (slots.some((slot) => !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(slot.start)
          || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(slot.end) || slot.start >= slot.end)) {
        return json({ error: '早餐、午餐或晚餐时段无效' }, 400);
      }
      const settings = {
        enabled: body.enabled !== false,
        activeStartDate,
        activeEndDate,
        weekdays,
        personalImageLimit,
        slots
      };
      const trackEnabled = { ...current.trackEnabled, health: settings.enabled };
      await env.DB.batch([
        putConfig(env, 'healthCheckinSettings', settings),
        putConfig(env, 'startDate', activeStartDate),
        putConfig(env, 'endDate', activeEndDate),
        putConfig(env, 'slots', slots),
        putConfig(env, 'trackEnabled', trackEnabled),
        ...(settings.enabled && !current.activityEnabled ? [putConfig(env, 'activityEnabled', true)] : []),
        audit(env, admin, 'update', 'checkin_settings', 'health', settings)
      ]);
      return json({ ok: true, trackId, settings });
    }
    const dailyStart = cleanText(body.dailyStart, 5);
    const dailyEnd = cleanText(body.dailyEnd, 5);
    const teamImageLimit = Math.min(8, Math.max(1, Number(body.teamImageLimit || 1)));
    if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(dailyStart)
        || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(dailyEnd) || dailyStart >= dailyEnd) {
      return json({ error: '每日打卡时间无效' }, 400);
    }
    const settings = {
      enabled: body.enabled !== false,
      activeStartDate,
      activeEndDate,
      dailyStart,
      dailyEnd,
      weekdays,
      personalImageLimit,
      teamImageLimit
    };
    await env.DB.batch([
      putConfig(env, 'checkinSettings', settings),
      audit(env, admin, 'update', 'checkin_settings', 'interaction', settings)
    ]);
    return json({ ok: true, trackId, settings });
  }`;
    let next = replaceSection(
      source,
      "  if (route === '/api/admin/checkin-settings' && request.method === 'GET') {",
      "  if (route === '/api/admin/config' && request.method === 'PUT') {",
      routeBlock,
      '分赛道打卡设置接口'
    );
    next = marker + '\n' + next;
    write(file, next);
  }
}

{
  const { file, source } = read('cloudflare/routes/student.js');
  if (!source.includes(marker)) {
    const startText = "  if (route === '/api/checkins' && request.method === 'POST') {";
    const endText = '\n  return null;';
    const start = source.indexOf(startText);
    const end = source.indexOf(endText, start);
    if (start < 0 || end < 0) throw new Error('未找到健康自律打卡提交范围');
    let section = source.slice(start, end);
    section = replaceOnce(
      section,
      "    if (user.role !== 'student') return json({ error: '管理员不能提交打卡' }, 403);\n    const config = await readConfig(env);\n    if (!config.activityEnabled || !config.trackEnabled[user.trackId]) return json({ error: '活动当前未开放' }, 403);",
      "    if (user.role !== 'student') return json({ error: '管理员不能提交打卡' }, 403);\n    if (user.trackId !== 'health') return json({ error: '仅健康自律赛道可提交此类打卡' }, 403);\n    const config = await readConfig(env);\n    const healthSettings = config.healthCheckinSettings || {};\n    if (!config.activityEnabled || !config.trackEnabled.health || healthSettings.enabled === false) return json({ error: '健康自律赛道当前未开放' }, 403);",
      '健康自律赛道开放校验'
    );
    section = replaceOnce(
      section,
      "    const makeupAllowed = await hasMakeupPermission(env, user.id, date);\n    if (date !== shanghaiDate() && !makeupAllowed) return json({ error: '只能提交当天材料' }, 403);\n    const slot = config.slots.find((item) => item.id === body.slotId);",
      "    const makeupAllowed = await hasMakeupPermission(env, user.id, date);\n    if (date !== shanghaiDate() && !makeupAllowed) return json({ error: '只能提交当天材料' }, 403);\n    if (!makeupAllowed) {\n      if ((healthSettings.activeStartDate && date < healthSettings.activeStartDate)\n          || (healthSettings.activeEndDate && date > healthSettings.activeEndDate)) {\n        return json({ error: '当前不在健康自律赛道活动日期内' }, 403);\n      }\n      const weekday = new Date(`${date}T12:00:00+08:00`).getUTCDay() || 7;\n      if (Array.isArray(healthSettings.weekdays) && healthSettings.weekdays.length\n          && !healthSettings.weekdays.includes(weekday)) {\n        return json({ error: '今天不开放健康自律赛道打卡' }, 403);\n      }\n    }\n    const slot = (healthSettings.slots || config.slots).find((item) => item.id === body.slotId);",
      '健康自律日期与星期校验'
    );
    section = replaceOnce(
      section,
      "    const photos = await claimConfirmedMedia(\n      env, body.photoMediaIds, user, null, 'meal-checkin', 3\n    );",
      "    const healthPhotoLimit = Math.min(8, Math.max(1, Number(healthSettings.personalImageLimit || 3)));\n    const photos = await claimConfirmedMedia(\n      env, body.photoMediaIds, user, null, 'meal-checkin', healthPhotoLimit\n    );",
      '健康自律照片数量设置'
    );
    let next = source.slice(0, start) + section + source.slice(end);
    next = marker + '\n' + next;
    write(file, next);
  }
}

console.log('Applied track-aware admin user filters and per-track check-in settings.');
