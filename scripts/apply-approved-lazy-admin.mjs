import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'public', 'admin-client.js');
if (!fs.existsSync(file)) throw new Error('public/admin-client.js does not exist');
let source = fs.readFileSync(file, 'utf8');
const drawerStateBlock = `/* MOBILE_ADMIN_PHOTO_FIX_V1 */
const ADMIN_CHECKIN_CACHE_TTL_MS = 60_000;
const adminCheckinViewCache = new Map();
const adminCheckinInflight = new Map();`;
const repeatedDrawerState = new RegExp(`(?:${drawerStateBlock.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?\\n\\r?\\n){2,}`, 'g');
source = source.replace(repeatedDrawerState, `${drawerStateBlock}\n\n`);

const replaceRequired = (pattern, replacement, label) => {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Unable to converge ${label}`);
  source = next;
};

if (!source.includes('async function refreshCompactCheckinSettings()')) {
  const settingsFunction = `async function refreshCompactCheckinSettings() {
  const panel = document.querySelector('#adminPanel-checkin');
  if (!panel || panel.hidden) return;
  panel.innerHTML = '<div class="admin-panel-loading">正在读取打卡设置…</div>';
  try {
    const result = await api('/api/admin/checkin-settings');
    const settings = result.settings || {};
    const weekdays = new Set((settings.weekdays || [1,2,3,4,5,6,7]).map(Number));
    panel.innerHTML = \`<form id="compactCheckinSettings" class="admin-compact-form checkin-settings-form">
      <label class="switch-line"><input name="enabled" type="checkbox" \${settings.enabled !== false ? 'checked' : ''}>开放打卡</label>
      <div class="settings-grid"><label>开始日期<input name="activeStartDate" type="date" value="\${escapeHtml(settings.activeStartDate || '')}" required></label>
      <label>结束日期<input name="activeEndDate" type="date" value="\${escapeHtml(settings.activeEndDate || '')}" required></label>
      <label>每日开始<input name="dailyStart" type="time" value="\${escapeHtml(settings.dailyStart || '00:00')}" required></label>
      <label>每日结束<input name="dailyEnd" type="time" value="\${escapeHtml(settings.dailyEnd || '23:59')}" required></label>
      <label>个人打卡照片数<input name="personalImageLimit" type="number" min="1" max="8" value="\${Number(settings.personalImageLimit || 3)}" required></label>
      <label>队伍汇总照片数<input name="teamImageLimit" type="number" min="1" max="8" value="\${Number(settings.teamImageLimit || 3)}" required></label></div>
      <fieldset><legend>允许打卡的星期</legend><div class="weekday-options">\${[1,2,3,4,5,6,7].map((day) => \`<label><input type="checkbox" name="weekdays" value="\${day}" \${weekdays.has(day) ? 'checked' : ''}>周\${day}</label>\`).join('')}</div></fieldset>
      <button>保存打卡设置</button>
    </form>\`;
    panel.querySelector('#compactCheckinSettings').onsubmit = async (event) => {
      event.preventDefault();
      const restore = beginButtonLoading(event.submitter, '保存中…');
      const form = event.target;
      const values = Object.fromEntries(new FormData(form));
      const selectedWeekdays = [...form.querySelectorAll('[name=weekdays]:checked')].map((input) => Number(input.value));
      try {
        await api('/api/admin/checkin-settings', { method: 'PUT', body: JSON.stringify({
          ...values,
          enabled: form.enabled.checked,
          weekdays: selectedWeekdays,
          personalImageLimit: Number(values.personalImageLimit),
          teamImageLimit: Number(values.teamImageLimit)
        }) });
        studentDashboardDirty = true;
        studentViewState.dirty = true;
        showToast('打卡设置已保存');
        await refreshCompactCheckinSettings();
      } catch (error) { restore(); alert(error.message); }
    };
  } catch (error) {
    panel.innerHTML = \`<div class="admin-inline-error"><p>\${escapeHtml(error.message)}</p><button id="retryCheckinSettings">重新加载</button></div>\`;
    panel.querySelector('#retryCheckinSettings').onclick = refreshCompactCheckinSettings;
  }
}

`;
  replaceRequired('async function setCompactAdminPanel(name) {', `${settingsFunction}async function setCompactAdminPanel(name) {`, 'check-in settings function');
}

if (!source.includes("if (name === 'checkin') await refreshCompactCheckinSettings();")) {
  replaceRequired(
    "  if (name === 'team') await refreshCompactTeamPanel(false);",
    "  if (name === 'checkin') await refreshCompactCheckinSettings();\n  if (name === 'team') await refreshCompactTeamPanel(false);",
    'check-in settings loader'
  );
}

{
  const lines = source.split(/(?<=\n)/);
  source = lines.map((line, index) => {
    if (!line.includes("${adminAccordionMarkup('team',")) return line;
    if (lines[index - 1]?.includes("adminAccordionMarkup('checkin'")) return line;
    return `        \${adminAccordionMarkup('checkin', '打卡设置', '打卡日期、时段、星期与照片数量')}\n${line}`;
  }).join('');
}

source = source.replace(
  'const compactPostRow = (post) => `',
  'const compactPostRow = (post, index) => `'
);
source = source.replace(
  '<div class="admin-compact-list">${result.posts.map(compactPostRow).join(\'\')',
  '<div class="admin-user-grid admin-post-grid">${result.posts.map((post, index) => compactPostRow(post, index)).join(\'\')'
);

const postStart = source.indexOf('function openCompactPostActions(post) {');
const postEnd = source.indexOf('\nasync function refreshCompactPlazaPanel', postStart);
if (postStart >= 0 && postEnd > postStart) {
  let block = source.slice(postStart, postEnd);
  if (!block.includes('<dt>队伍</dt>')) {
    block = block.replace(
      '<dl class="admin-post-details">',
      '<dl class="admin-post-details">\n      <div><dt>队伍</dt><dd>${escapeHtml(post.teamName)}</dd></div>'
    );
  }
  if (!block.includes('admin-post-photo-grid')) {
    block = block.replace(
      /    <\/dl>\r?\n    <div class="admin-action-buttons">/,
      `    </dl>
    <div class="admin-post-photo-grid">\${(post.images || []).map((image, imageIndex) => \`<button type="button" class="image-viewer-trigger admin-post-photo" data-image-viewer="\${escapeHtml(image.thumbUrl || image.imageUrl)}" data-image-thumb="\${escapeHtml(image.thumbUrl || image.imageUrl)}" data-image-display="\${escapeHtml(image.displayUrl || image.imageUrl)}" data-image-alt="\${escapeHtml(post.teamName)}活动原图"><span class="image-shell"><img data-perf-image="admin-plaza-thumb" data-priority="\${imageIndex === 0 ? 'high' : 'low'}" \${imageIndex === 0 ? 'src' : 'data-src'}="\${escapeHtml(image.thumbUrl || image.imageUrl)}" loading="\${imageIndex === 0 ? 'eager' : 'lazy'}" fetchpriority="\${imageIndex === 0 ? 'high' : 'low'}" decoding="async" width="960" height="720" alt="活动照片" onload="this.parentElement.classList.add('loaded')" onerror="this.hidden=true;this.parentElement.classList.add('failed')"><span class="image-error">图片加载失败</span></span></button>\`).join('') || '<p class="muted">该帖子暂无照片</p>'}</div>
    <div class="admin-action-buttons">`
    );
  }
  if (!block.includes('prepareDynamicContent(root);')) {
    block = block.replace('  document.body.append(root);', '  document.body.append(root);\n  prepareDynamicContent(root);');
  }
  source = source.slice(0, postStart) + block + source.slice(postEnd);
}

const drawerStart = source.indexOf('function openAdminUserDrawer(studentUser, date) {');
const drawerEnd = source.indexOf('\nfunction taskFormFields', drawerStart);
if (drawerStart >= 0 && drawerEnd > drawerStart) {
  let drawerBlock = source.slice(drawerStart, drawerEnd);
  if (!drawerBlock.includes("['profile',")) {
    const managementMarkup = `      <div class="drawer-accordions admin-user-management">
        \${[
          ['profile', '基本资料'],
          ['team', '所属队伍'],
          ['makeup', '补卡权限'],
          ['adminMakeup', '管理员代为补卡'],
          ['manage', '管理操作']
        ].map(([key, label]) => \`<section class="drawer-accordion" data-drawer-section="\${key}">
          <button class="drawer-accordion-toggle" type="button" aria-expanded="false"><span><strong>\${label}</strong><small>点击展开</small></span><b aria-hidden="true">›</b></button>
          <div class="drawer-accordion-panel" hidden><div class="drawer-panel-inner" data-panel-content="\${key}"></div></div>
        </section>\`).join('')}
      </div>
`;
    const drawerClose = '    </section>\n  </div>`;';
    const drawerCloseCrLf = '    </section>\r\n  </div>`;';
    if (drawerBlock.includes(drawerClose)) drawerBlock = drawerBlock.replace(drawerClose, `${managementMarkup}${drawerClose}`);
    else if (drawerBlock.includes(drawerCloseCrLf)) drawerBlock = drawerBlock.replace(drawerCloseCrLf, `${managementMarkup}${drawerCloseCrLf}`);
    else throw new Error('Unable to find lazy admin drawer markup close');

    const managementHandlers = `  let managementPromise = null;
  const loadManagementData = () => {
    if (!managementPromise) {
      managementPromise = Promise.all([loadCompactAdminTeams(), api('/api/admin/tasks')])
        .then(([teamResult, taskResult]) => ({ teams: teamResult.teams || [], tasks: taskResult.tasks || [] }))
        .catch((error) => { managementPromise = null; throw error; });
    }
    return managementPromise;
  };
  const loadManagementSection = async (key, panel) => {
    if (panel.dataset.loaded === 'true') return;
    panel.innerHTML = '<p class="muted">正在读取…</p>';
    try {
      if (key === 'profile') {
        panel.innerHTML = \`<dl class="user-detail-list"><div><dt>姓名</dt><dd>\${escapeHtml(studentUser.name)}</dd></div><div><dt>学号</dt><dd>\${escapeHtml(studentUser.studentId)}</dd></div><div><dt>校区</dt><dd>\${escapeHtml(studentUser.campus || '未设置')}</dd></div><div><dt>累计完成</dt><dd>\${Number(studentUser.totalCompletedDays || 0)} 天</dd></div></dl>\`;
      } else if (key === 'team') {
        const { teams } = await loadManagementData();
        const team = teams.find((item) => (item.members || []).some((member) => member.id === studentUser.id));
        panel.innerHTML = team ? \`<p><strong>\${escapeHtml(team.name)}</strong></p><p class="muted">\${team.memberCount}/\${team.memberLimit} 人</p>\` : '<p class="muted">该用户尚未加入队伍</p>';
      } else if (key === 'makeup') {
        const permission = await api(\`/api/admin/users/\${encodeURIComponent(studentUser.id)}/makeup-permission?date=\${encodeURIComponent(date)}\`);
        let enabled = Boolean(permission.enabled);
        panel.innerHTML = \`<div class="row"><p class="muted">仅对 \${escapeHtml(date)} 生效；默认关闭。</p><button class="\${enabled ? 'danger' : 'secondary'} right" id="toggleMakeupPermission">\${enabled ? '关闭用户补卡' : '允许用户补卡'}</button></div>\`;
        panel.querySelector('#toggleMakeupPermission').onclick = async (event) => {
          const restore = beginButtonLoading(event.currentTarget, '处理中…');
          try {
            await api(\`/api/admin/users/\${encodeURIComponent(studentUser.id)}/makeup-permission?date=\${encodeURIComponent(date)}\`, { method: 'PUT', body: JSON.stringify({ enabled: !enabled }) });
            enabled = !enabled;
            event.currentTarget.textContent = enabled ? '关闭用户补卡' : '允许用户补卡';
            event.currentTarget.className = enabled ? 'danger right' : 'secondary right';
          } catch (error) { alert(error.message); } finally { restore(); }
        };
      } else if (key === 'adminMakeup') {
        const { tasks } = await loadManagementData();
        const isHealth = studentUser.trackId === 'health';
        const interactionTasks = tasks.filter((task) => task.trackId === 'interaction');
        panel.innerHTML = \`<form id="adminMakeupForm">\${isHealth ? \`<label>餐次</label><select name="slotId">\${config.slots.map((slot) => \`<option value="\${slot.id}">\${escapeHtml(slot.label)}</option>\`).join('')}</select>\` : \`<label>活动任务</label><select name="taskId" required>\${interactionTasks.map((task) => \`<option value="\${task.id}">\${escapeHtml(task.name)}</option>\`).join('')}</select>\`}<label>补卡图片</label><input name="photos" type="file" accept="image/jpeg,image/png,image/webp" required>\${isHealth ? '<label>备注（可选）</label><textarea name="note"></textarea>' : ''}<button>确认管理员补卡</button></form>\`;
        panel.querySelector('#adminMakeupForm').onsubmit = async (event) => {
          event.preventDefault();
          const form = event.target;
          const restore = beginButtonLoading(event.submitter, '补卡中…');
          try {
            const photos = await readFiles(form.photos.files, { taskId: isHealth ? null : form.taskId.value, businessType: 'admin-makeup', limit: isHealth ? 3 : 1 });
            await api(\`/api/admin/users/\${encodeURIComponent(studentUser.id)}/makeup\`, { method: 'POST', body: JSON.stringify(isHealth ? { date, slotId: form.slotId.value, mediaIds: photos.map((item) => item.mediaId), note: form.note.value } : { date, taskId: form.taskId.value, mediaIds: photos.map((item) => item.mediaId) }) });
            adminCheckinViewCache.delete(cacheKey);
            showToast('补卡已完成');
            openAdminUserDrawer(studentUser, date);
          } catch (error) { alert(error.message); } finally { restore(); }
        };
      } else if (key === 'manage') {
        panel.innerHTML = \`<div class="drawer-actions"><button class="secondary" id="editDrawerUser">编辑用户</button><button class="\${studentUser.status === 'active' ? 'danger' : 'secondary'}" id="toggleDrawerUser">\${studentUser.status === 'active' ? '禁用用户' : '启用用户'}</button></div>\`;
        panel.querySelector('#editDrawerUser').onclick = () => editUser(studentUser, date);
        panel.querySelector('#toggleDrawerUser').onclick = async (event) => {
          const next = studentUser.status === 'active' ? 'disabled' : 'active';
          if (!await askConfirm(\`是否\${next === 'disabled' ? '禁用' : '启用'}该用户？\`, '操作将立即影响该账号的登录状态。')) return;
          const restore = beginButtonLoading(event.currentTarget, '处理中…');
          try {
            await api(\`/api/admin/users/\${encodeURIComponent(studentUser.id)}/status\`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
            studentUser.status = next;
            event.currentTarget.textContent = next === 'active' ? '禁用用户' : '启用用户';
          } catch (error) { alert(error.message); } finally { restore(); }
        };
      }
      panel.dataset.loaded = 'true';
    } catch (error) {
      panel.innerHTML = \`<p class="muted">\${escapeHtml(error.message)}</p><button class="secondary retry-management-section">重新加载</button>\`;
      panel.querySelector('.retry-management-section').onclick = () => loadManagementSection(key, panel);
    }
  };
  root.querySelectorAll('.drawer-accordion-toggle').forEach((toggle) => {
    toggle.onclick = () => {
      const section = toggle.closest('.drawer-accordion');
      const panel = section.querySelector('.drawer-accordion-panel');
      const open = panel.hidden;
      panel.hidden = !open;
      section.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      if (open) void loadManagementSection(section.dataset.drawerSection, panel.querySelector('.drawer-panel-inner'));
    };
  });

`;
    const renderAnchor = '  const render = (result) => {';
    if (!drawerBlock.includes(renderAnchor)) throw new Error('Unable to find lazy admin drawer render anchor');
    drawerBlock = drawerBlock.replace(renderAnchor, `${managementHandlers}${renderAnchor}`);
  }
  source = source.slice(0, drawerStart) + drawerBlock + source.slice(drawerEnd);
}

source = source.replace(
  /<img (?!data-perf-image="admin-checkin-thumb")([^>]*data-image[^>]*)>/g,
  '<img data-perf-image="admin-checkin-thumb" $1>'
);
source = source.replace(
  '<span class="image-shell"><img ${imageIndex === 0',
  '<span class="image-shell"><img data-perf-image="admin-checkin-thumb" ${imageIndex === 0'
);

fs.writeFileSync(file, source, 'utf8');
console.log('Converged lazy admin settings, post photos, layout and performance markers.');
