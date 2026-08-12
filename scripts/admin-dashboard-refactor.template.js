/* ADMIN_DASHBOARD_REFACTOR_V1 */
const adminDashboardState = {
  date: '',
  users: [],
  userSummary: null,
  teamData: null,
  teamSavedAt: 0,
  plazaData: null,
  plazaPage: 1,
  openPanel: sessionStorage.getItem('adminCompactPanel') || '',
  teamTab: sessionStorage.getItem('adminTeamTab') || 'manual',
  userTab: sessionStorage.getItem('adminUserTab') || 'single',
  userTrack: ['health', 'interaction'].includes(sessionStorage.getItem('adminUserTrack'))
    ? sessionStorage.getItem('adminUserTrack') : 'health',
  requestEpoch: 0
};

const adminCacheFresh = (savedAt, ttl = 20_000) => savedAt && Date.now() - savedAt < ttl;

const adminAccordionMarkup = (name, title, description, count = '') => `
  <section class="card admin-compact-module" data-admin-module="${name}">
    <h2 class="admin-accordion-heading">
      <button type="button" class="admin-accordion-trigger" id="adminTrigger-${name}"
        aria-expanded="false" aria-controls="adminPanel-${name}" data-admin-panel-target="${name}">
        <span><strong>${escapeHtml(title)}</strong>${description ? `<small>${escapeHtml(description)}</small>` : ''}</span>
        <span class="admin-module-meta">${count ? `<b>${escapeHtml(String(count))}</b>` : ''}<i aria-hidden="true">⌄</i></span>
      </button>
    </h2>
    <div class="admin-accordion-panel" id="adminPanel-${name}" role="region"
      aria-labelledby="adminTrigger-${name}" hidden></div>
  </section>`;

const setAdminTab = (scope, value) => {
  const root = document.querySelector(`[data-admin-module="${scope}"]`);
  if (!root) return;
  root.querySelectorAll('[data-admin-tab]').forEach((button) => {
    const active = button.dataset.adminTab === value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  root.querySelectorAll('[data-admin-tab-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.adminTabPanel !== value;
  });
  if (scope === 'team') {
    adminDashboardState.teamTab = value;
    sessionStorage.setItem('adminTeamTab', value);
  } else {
    adminDashboardState.userTab = value;
    sessionStorage.setItem('adminUserTab', value);
  }
};

const bindAdminTabs = (scope) => {
  const root = document.querySelector(`[data-admin-module="${scope}"]`);
  if (!root) return;
  root.querySelectorAll('[data-admin-tab]').forEach((button) => {
    button.onclick = () => setAdminTab(scope, button.dataset.adminTab);
  });
  setAdminTab(scope, scope === 'team' ? adminDashboardState.teamTab : adminDashboardState.userTab);
};

const renderAdminUserPanel = (completion, result, date) => {
  const target = document.querySelector('#adminUserCore');
  if (!target) return;
  adminDashboardState.users = result.users;
  adminDashboardState.userSummary = completion;
  const selectedTrack = adminDashboardState.userTrack;
  const selectedTrackLabel = selectedTrack === 'health' ? '健康自律赛道' : '四校区赛道';
  const selectedTrackSummary = completion.tracks?.find((item) => item.trackId === selectedTrack) || {};
  const completed = Number(selectedTrackSummary.completed || 0);
  const total = Number(selectedTrackSummary.total || 0);
  const missing = Math.max(0, total - completed);
  const tiles = result.users.map((studentUser, index) => `
    <button class="admin-user-tile ${studentUser.completed ? 'completed' : 'missing'}" data-id="${studentUser.id}">
      <span class="user-number">${(result.page - 1) * result.limit + index + 1}</span>
      <span class="admin-user-tile-copy"><strong>${escapeHtml(studentUser.name)}</strong><small>${escapeHtml(studentUser.studentId)} · ${escapeHtml(trackName(studentUser.trackId))}</small></span>
      <span class="user-completion ${studentUser.completed ? 'done' : 'pending'}" aria-label="${studentUser.completed ? '已完成' : '未完成'}">${studentUser.completed ? '✓' : '—'}</span>
    </button>`).join('');
  target.innerHTML = `
    <div class="admin-user-heading">
      <div><h2>${selectedTrackLabel}</h2><p class="muted">点击姓名查看当天记录或进行补卡</p></div>
      <label>日期 <input id="adminCompactDate" type="date" value="${date}"></label>
    </div>
    <div class="admin-user-overview" aria-label="用户完成概览">
      <span><small>总人数</small><strong>${total}</strong></span>
      <span class="done"><small>已完成</small><strong>${completed}</strong></span>
      <span class="pending"><small>未完成</small><strong>${missing}</strong></span>
    </div>
    <form id="adminUserSearch" class="user-list-toolbar">
      <input name="query" value="${escapeHtml(adminUserQuery)}" placeholder="搜索姓名或学号" aria-label="搜索姓名或学号">
      <button>搜索</button>
    </form>
    <div class="user-track-tabs" role="tablist" aria-label="用户赛道筛选">
      <button type="button" role="tab" class="secondary track-filter ${selectedTrack === 'health' ? 'active' : ''}" data-track-filter="health" aria-selected="${selectedTrack === 'health'}">健康自律赛道</button>
      <button type="button" role="tab" class="secondary track-filter ${selectedTrack === 'interaction' ? 'active' : ''}" data-track-filter="interaction" aria-selected="${selectedTrack === 'interaction'}">四校区赛道</button>
    </div>
    <div class="user-filter-tabs" role="group" aria-label="完成状态筛选">
      ${[['all','全部用户'],['completed','已完成'],['missing','未完成']].map(([value,label]) =>
        `<button type="button" class="secondary user-filter ${adminUserFilter === value ? 'active' : ''}" data-filter="${value}">${label}</button>`).join('')}
    </div>
    <div class="admin-user-grid">${tiles || '<p class="muted">没有符合条件的用户</p>'}</div>
    <div class="user-pagination">
      <button class="secondary" id="adminUserPrev" ${result.page <= 1 ? 'disabled' : ''}>上一页</button>
      <span>第 ${result.page} / ${Math.max(1, Math.ceil(result.total / result.limit))} 页</span>
      <button class="secondary" id="adminUserNext" ${result.page * result.limit >= result.total ? 'disabled' : ''}>下一页</button>
    </div>`;
  target.setAttribute('aria-busy', 'false');

  document.querySelector('#adminCompactDate').onchange = (event) => {
    adminUserPage = 1;
    sessionStorage.adminUserPage = '1';
    adminDashboardState.date = event.target.value;
    refreshCompactAdminUsers(event.target.value);
  };
  document.querySelector('#adminUserSearch').onsubmit = (event) => {
    event.preventDefault();
    adminUserQuery = new FormData(event.target).get('query').trim();
    adminUserPage = 1;
    sessionStorage.adminUserQuery = adminUserQuery;
    sessionStorage.adminUserPage = '1';
    refreshCompactAdminUsers(date);
  };
  document.querySelectorAll('.track-filter').forEach((button) => {
    button.onclick = () => {
      adminDashboardState.userTrack = button.dataset.trackFilter;
      sessionStorage.setItem('adminUserTrack', adminDashboardState.userTrack);
      adminUserPage = 1;
      sessionStorage.adminUserPage = '1';
      refreshCompactAdminUsers(date);
    };
  });
  document.querySelectorAll('.user-filter').forEach((button) => {
    button.onclick = () => {
      adminUserFilter = button.dataset.filter;
      adminUserPage = 1;
      sessionStorage.adminUserFilter = adminUserFilter;
      sessionStorage.adminUserPage = '1';
      refreshCompactAdminUsers(date);
    };
  });
  document.querySelector('#adminUserPrev').onclick = () => {
    adminUserPage = Math.max(1, adminUserPage - 1);
    sessionStorage.adminUserPage = String(adminUserPage);
    refreshCompactAdminUsers(date);
  };
  document.querySelector('#adminUserNext').onclick = () => {
    adminUserPage += 1;
    sessionStorage.adminUserPage = String(adminUserPage);
    refreshCompactAdminUsers(date);
  };
  document.querySelectorAll('.admin-user-tile').forEach((button) => {
    button.onclick = () => {
      const studentUser = adminDashboardState.users.find((item) => item.id === button.dataset.id);
      if (!studentUser) return;
      startPhotoFlow('admin-checkin');
      openAdminUserDrawer(studentUser, date);
    };
  });
};

async function refreshCompactAdminUsers(date = adminDashboardState.date) {
  const target = document.querySelector('#adminUserCore');
  if (!target) return;
  target.setAttribute('aria-busy', 'true');
  const epoch = ++adminDashboardState.requestEpoch;
  try {
    const [completion, result] = await Promise.all([
      api(`/api/admin/completion-summary?date=${date}`),
      api(`/api/admin/users?page=${adminUserPage}&limit=30&q=${encodeURIComponent(adminUserQuery)}&completion=${adminUserFilter}&track=${adminDashboardState.userTrack}&date=${date}`)
    ]);
    if (epoch !== adminDashboardState.requestEpoch || !document.querySelector('#adminUserCore')) return;
    renderAdminUserPanel(completion, result, date);
  } catch (error) {
    target.innerHTML = `<div class="admin-inline-error"><p>${escapeHtml(error.message)}</p><button id="retryAdminUsers">重新加载</button></div>`;
    document.querySelector('#retryAdminUsers').onclick = () => refreshCompactAdminUsers(date);
  }
}

async function loadCompactAdminTeams(force = false) {
  if (!force && adminDashboardState.teamData && adminCacheFresh(adminDashboardState.teamSavedAt)) {
    return adminDashboardState.teamData;
  }
  const data = await api('/api/admin/teams');
  adminDashboardState.teamData = data;
  adminDashboardState.teamSavedAt = Date.now();
  return data;
}

const compactTeamRow = (team) => `
  <article class="admin-compact-row" data-team-row="${team.id}">
    <div class="admin-compact-primary"><strong>${escapeHtml(team.name)}</strong><small>${team.memberCount}/${team.memberLimit} 人 · 邀请码 ${escapeHtml(team.inviteCode)}</small></div>
    <div class="admin-compact-secondary"><span>${team.captain ? `队长：${escapeHtml(team.captain.name)}` : '未指定队长'}</span><small>${team.members.map((member) => escapeHtml(member.name)).join('、') || '暂无成员'}</small></div>
    <div class="admin-compact-actions">
      <button type="button" class="secondary edit-team" data-id="${team.id}">修改</button>
      <button type="button" class="secondary add-team-member" data-id="${team.id}" ${team.isFull ? 'disabled' : ''}>加成员</button>
      <button type="button" class="secondary set-captain" data-id="${team.id}">${team.captain ? '换队长' : '设队长'}</button>
      ${team.captain ? `<button type="button" class="secondary clear-captain" data-id="${team.id}">取消队长</button>` : ''}
      <button type="button" class="danger dissolve-team" data-id="${team.id}">解散</button>
    </div>
  </article>`;

async function refreshCompactTeamPanel(force = true) {
  const panel = document.querySelector('#adminPanel-team');
  if (!panel || panel.hidden) return;
  panel.innerHTML = '<div class="admin-panel-loading" aria-live="polite">正在加载队伍…</div>';
  try {
    const result = await loadCompactAdminTeams(force);
    panel.innerHTML = `
      <div class="admin-tabs" role="tablist" aria-label="队伍新增方式">
        <button type="button" role="tab" data-admin-tab="manual">手动创建</button>
        <button type="button" role="tab" data-admin-tab="import">Excel 导入</button>
      </div>
      <div class="admin-tab-panel" role="tabpanel" data-admin-tab-panel="manual">
        <form id="compactCreateTeam" class="admin-compact-form">
          <label>队伍名称<input name="name" required></label>
          <label>人数限制<input name="memberLimit" type="number" min="1" max="20" value="4" required></label>
          <button ${result.teamCount >= result.maxTeams ? 'disabled' : ''}>创建队伍</button>
        </form>
      </div>
      <div class="admin-tab-panel" role="tabpanel" data-admin-tab-panel="import" hidden>
        <form id="compactImportTeams" class="admin-compact-form">
          <p class="muted">Excel 每行填写队伍名称、成员学号和可选的队长学号。</p>
          <input name="file" type="file" accept=".xlsx" required>
          <button>导入并自动编队</button>
        </form>
      </div>
      <div class="admin-team-capacity">
        <span>已创建 <strong>${result.teamCount}</strong> / ${result.maxTeams} 个队伍</span>
        <form id="compactTeamCapacity" class="inline-form">
          <input name="maxTeams" type="number" min="${result.teamCount}" max="500" value="${result.maxTeams}" aria-label="最大队伍数量">
          <button class="secondary">保存名额</button>
        </form>
      </div>
      <div class="admin-compact-list">${result.teams.map(compactTeamRow).join('') || '<p class="muted">尚未创建队伍</p>'}</div>`;
    bindAdminTabs('team');
    document.querySelector('#compactCreateTeam').onsubmit = async (event) => {
      event.preventDefault();
      const restore = beginButtonLoading(event.submitter, '创建中…');
      try {
        await api('/api/admin/teams', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
        event.target.reset();
        showToast('队伍创建成功');
        await refreshCompactTeamPanel(true);
      } catch (error) { restore(); alert(error.message); }
    };
    document.querySelector('#compactImportTeams').onsubmit = async (event) => {
      event.preventDefault();
      const restore = beginButtonLoading(event.submitter, '导入中…');
      try {
        const encoded = await readRawFile(event.target.file.files[0]);
        const imported = await api('/api/admin/teams/import', { method: 'POST', body: JSON.stringify({ file: encoded }) });
        showToast(`已导入 ${imported.importedTeams} 个队伍、${imported.importedMembers} 名成员`);
        await refreshCompactTeamPanel(true);
      } catch (error) { restore(); alert(error.message); }
    };
    document.querySelector('#compactTeamCapacity').onsubmit = async (event) => {
      event.preventDefault();
      const restore = beginButtonLoading(event.submitter, '保存中…');
      try {
        await api('/api/admin/team-capacity', { method: 'PATCH', body: JSON.stringify({ maxTeams: Number(event.target.maxTeams.value) }) });
        showToast('队伍名额已更新');
        await refreshCompactTeamPanel(true);
      } catch (error) { restore(); alert(error.message); }
    };
    document.querySelectorAll('.edit-team').forEach((button) => {
      button.onclick = () => {
        adminDashboardState.openPanel = 'team';
        sessionStorage.setItem('adminCompactPanel', 'team');
        editTeam(result.teams.find((team) => team.id === button.dataset.id), adminDashboardState.date);
      };
    });
    document.querySelectorAll('.add-team-member').forEach((button) => {
      button.onclick = async () => {
        const studentId = await askText('加入队伍成员', '请输入要加入该队伍的学生学号。', '学生学号');
        if (!studentId) return;
        try {
          await api(`/api/admin/teams/${button.dataset.id}/members`, { method: 'POST', body: JSON.stringify({ studentId }) });
          await refreshCompactTeamPanel(true);
        } catch (error) { alert(error.message); }
      };
    });
    document.querySelectorAll('.set-captain').forEach((button) => {
      button.onclick = async () => {
        const studentId = await askText('指定队长', '该学生必须已经在当前队伍中。', '队长学号');
        if (!studentId) return;
        try {
          await api(`/api/admin/teams/${button.dataset.id}/captain`, { method: 'PATCH', body: JSON.stringify({ studentId }) });
          await refreshCompactTeamPanel(true);
        } catch (error) { alert(error.message); }
      };
    });
    document.querySelectorAll('.clear-captain').forEach((button) => {
      button.onclick = async () => {
        if (!await askConfirm('是否取消队长？', '取消后，该队伍将暂时没有队长。')) return;
        try {
          await api(`/api/admin/teams/${button.dataset.id}/captain`, { method: 'PATCH', body: '{}' });
          await refreshCompactTeamPanel(true);
        } catch (error) { alert(error.message); }
      };
    });
    document.querySelectorAll('.dissolve-team').forEach((button) => {
      button.onclick = async () => {
        if (!await askConfirm('是否解散该队伍？', '确认后将解除全部成员关系，此操作不可恢复。')) return;
        try {
          await api(`/api/admin/teams/${button.dataset.id}`, { method: 'DELETE' });
          showToast('队伍已解散');
          await refreshCompactTeamPanel(true);
        } catch (error) { alert(error.message); }
      };
    });
  } catch (error) {
    panel.innerHTML = `<div class="admin-inline-error"><p>${escapeHtml(error.message)}</p><button id="retryAdminTeams">重新加载</button></div>`;
    document.querySelector('#retryAdminTeams').onclick = () => refreshCompactTeamPanel(true);
  }
}

function renderCompactUserManagement() {
  const panel = document.querySelector('#adminPanel-user');
  if (!panel || panel.dataset.rendered) return;
  panel.dataset.rendered = 'true';
  panel.innerHTML = `
    <div class="admin-tabs" role="tablist" aria-label="用户新增方式">
      <button type="button" role="tab" data-admin-tab="single">单个添加</button>
      <button type="button" role="tab" data-admin-tab="import">Excel 批量导入</button>
    </div>
    <div class="admin-tab-panel" role="tabpanel" data-admin-tab-panel="single">
      <form id="compactAddUser" class="admin-compact-form">
        <label>姓名<input name="name" required></label>
        <label>学号<input name="studentId" required></label>
        <label>校区<input name="campus" required></label>
        <label>所属赛道<select name="trackId" required>${tracks.map((track) => `<option value="${track.id}">${escapeHtml(track.name)}</option>`).join('')}</select></label>
        <label>初始密码<input name="password" minlength="8" required></label>
        <label>账号状态<select name="status"><option value="active">启用</option><option value="disabled">禁用</option></select></label>
        <button>创建账号</button>
      </form>
    </div>
    <div class="admin-tab-panel" role="tabpanel" data-admin-tab-panel="import" hidden>
      <form id="compactImportUsers" class="admin-compact-form">
        <p class="muted">首行包含姓名、学号、校区、所属赛道、初始密码，可选账号状态。</p>
        <input name="file" type="file" accept=".xlsx" required>
        <button>导入名单</button>
      </form>
    </div>`;
  bindAdminTabs('user');
  document.querySelector('#compactAddUser').onsubmit = async (event) => {
    event.preventDefault();
    const restore = beginButtonLoading(event.submitter, '创建中…');
    try {
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      event.target.reset();
      showToast('账号创建成功');
      await refreshCompactAdminUsers(adminDashboardState.date);
    } catch (error) { restore(); alert(error.message); }
  };
  document.querySelector('#compactImportUsers').onsubmit = async (event) => {
    event.preventDefault();
    const restore = beginButtonLoading(event.submitter, '导入中…');
    try {
      const file = event.target.file.files[0];
      const encoded = await readRawFile(file);
      const imported = await api('/api/admin/users/import', { method: 'POST', body: JSON.stringify({ file: encoded }) });
      showToast(`成功导入 ${imported.imported} 个用户`);
      await refreshCompactAdminUsers(adminDashboardState.date);
    } catch (error) { restore(); alert(error.message); }
  };
}

const compactPostRow = (post) => `
  <article class="admin-compact-row admin-post-row" data-post-row="${post.id}">
    <div class="admin-compact-primary"><strong>${escapeHtml(post.teamName)}</strong><small>${escapeHtml(post.taskName)}</small></div>
    <div class="admin-post-status"><span class="pill ${post.status === 'visible' ? 'done' : 'pending'}">${post.status === 'visible' ? '公开' : '已隐藏'}</span>${post.excludedFromRanking ? '<span class="pill pending">已排除排名</span>' : ''}</div>
    <button type="button" class="secondary admin-post-actions" data-id="${post.id}">操作</button>
  </article>`;

function openCompactPostActions(post) {
  const existing = document.querySelector('#adminPostActionSheet');
  existing?.remove();
  const root = document.createElement('div');
  root.id = 'adminPostActionSheet';
  root.className = 'app-dialog-backdrop admin-action-backdrop';
  root.innerHTML = `<section class="app-dialog admin-action-sheet" role="dialog" aria-modal="true" aria-labelledby="adminPostActionTitle">
    <div class="row"><div><small class="muted">广场帖子</small><h2 id="adminPostActionTitle">${escapeHtml(post.teamName)}</h2></div><button type="button" class="secondary right" data-close-post-actions>关闭</button></div>
    <dl class="admin-post-details">
      <div><dt>任务</dt><dd>${escapeHtml(post.taskName)}</dd></div>
      <div><dt>状态</dt><dd>${post.status === 'visible' ? '公开' : '已隐藏'}</dd></div>
      <div><dt>浏览 / 点赞</dt><dd>${post.viewCount} / ${post.likeCount}</dd></div>
      <div><dt>发布时间</dt><dd>${formatDate(post.publishedAt)}</dd></div>
      <div class="wide"><dt>文案</dt><dd>${escapeHtml(post.copy || '无文案')}</dd></div>
    </dl>
    <div class="admin-action-buttons">
      <button type="button" class="secondary" data-post-toggle>${post.status === 'visible' ? '隐藏帖子' : '恢复公开'}</button>
      <button type="button" class="secondary" data-post-exclude>${post.excludedFromRanking ? '恢复排名' : '排除排名'}</button>
      <button type="button" class="danger" data-post-delete>删除帖子</button>
    </div>
  </section>`;
  document.body.append(root);
  const close = () => root.remove();
  root.querySelector('[data-close-post-actions]').onclick = close;
  root.onclick = (event) => { if (event.target === root) close(); };
  root.querySelector('[data-post-toggle]').onclick = async (event) => {
    const restore = beginButtonLoading(event.currentTarget, '处理中…');
    try {
      await api(`/api/admin/plaza/${post.id}`, { method: 'PATCH', body: JSON.stringify({ status: post.status === 'visible' ? 'hidden' : 'visible' }) });
      plazaViewCache.clear();
      rankingViewCache.clear();
      close();
      await refreshCompactPlazaPanel(adminDashboardState.plazaPage);
      showToast('帖子状态已更新');
    } catch (error) { restore(); alert(error.message); }
  };
  root.querySelector('[data-post-exclude]').onclick = async (event) => {
    const restore = beginButtonLoading(event.currentTarget, '处理中…');
    try {
      await api(`/api/admin/plaza/${post.id}`, { method: 'PATCH', body: JSON.stringify({ excludedFromRanking: !post.excludedFromRanking }) });
      rankingViewCache.clear();
      close();
      await refreshCompactPlazaPanel(adminDashboardState.plazaPage);
      showToast('排名状态已更新');
    } catch (error) { restore(); alert(error.message); }
  };
  root.querySelector('[data-post-delete]').onclick = async (event) => {
    if (!await askConfirm('是否永久删除该广场帖子？', '任务提交记录不会删除，此操作不可恢复。')) return;
    const restore = beginButtonLoading(event.currentTarget, '删除中…');
    try {
      await api(`/api/admin/plaza/${post.id}`, { method: 'DELETE' });
      plazaViewCache.clear();
      rankingViewCache.clear();
      close();
      await refreshCompactPlazaPanel(adminDashboardState.plazaPage);
      showToast('帖子已删除');
    } catch (error) { restore(); alert(error.message); }
  };
}

async function refreshCompactPlazaPanel(page = 1) {
  const panel = document.querySelector('#adminPanel-plaza');
  if (!panel || panel.hidden) return;
  panel.innerHTML = '<div class="admin-panel-loading" aria-live="polite">正在加载广场帖子…</div>';
  try {
    const result = await api(`/api/admin/plaza?page=${page}&limit=20`);
    adminDashboardState.plazaData = result;
    adminDashboardState.plazaPage = result.page;
    panel.innerHTML = `
      <div class="admin-panel-summary"><span>共 ${result.total} 条帖子</span><small class="muted">详情与管理操作按需打开</small></div>
      <div class="admin-compact-list">${result.posts.map(compactPostRow).join('') || '<p class="muted">暂无广场帖子</p>'}</div>
      <div class="user-pagination">
        <button type="button" class="secondary" id="compactPlazaPrev" ${result.page <= 1 ? 'disabled' : ''}>上一页</button>
        <span>第 ${result.page} 页</span>
        <button type="button" class="secondary" id="compactPlazaNext" ${!result.hasMore ? 'disabled' : ''}>下一页</button>
      </div>`;
    document.querySelectorAll('.admin-post-actions').forEach((button) => {
      button.onclick = () => openCompactPostActions(result.posts.find((post) => post.id === button.dataset.id));
    });
    document.querySelector('#compactPlazaPrev').onclick = () => refreshCompactPlazaPanel(Math.max(1, result.page - 1));
    document.querySelector('#compactPlazaNext').onclick = () => refreshCompactPlazaPanel(result.page + 1);
  } catch (error) {
    panel.innerHTML = `<div class="admin-inline-error"><p>${escapeHtml(error.message)}</p><button id="retryAdminPlaza">重新加载</button></div>`;
    document.querySelector('#retryAdminPlaza').onclick = () => refreshCompactPlazaPanel(page);
  }
}

async function setCompactAdminPanel(name) {
  const modules = [...document.querySelectorAll('[data-admin-module]')];
  const selected = document.querySelector(`[data-admin-module="${name}"]`);
  const wasOpen = selected?.classList.contains('is-open');
  modules.forEach((module) => {
    const open = module === selected && !wasOpen;
    module.classList.toggle('is-open', open);
    const trigger = module.querySelector('.admin-accordion-trigger');
    const panel = module.querySelector('.admin-accordion-panel');
    trigger?.setAttribute('aria-expanded', String(open));
    if (panel) panel.hidden = !open;
  });
  adminDashboardState.openPanel = wasOpen ? '' : name;
  sessionStorage.setItem('adminCompactPanel', adminDashboardState.openPanel);
  if (wasOpen) return;
  if (name === 'team') await refreshCompactTeamPanel(false);
  if (name === 'user') renderCompactUserManagement();
  if (name === 'plaza') await refreshCompactPlazaPanel(adminDashboardState.plazaPage || 1);
}

async function openLegacyAdminTools(date) {
  await legacyAdmin(date);
  const headerRow = document.querySelector('.hero .row');
  if (!headerRow || document.querySelector('#backCompactAdmin')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'backCompactAdmin';
  button.className = 'secondary';
  button.textContent = '返回精简后台';
  button.onclick = () => admin(date);
  headerRow.append(button);
}

async function admin(selectedDate, pageEpoch = beginNavigation()) {
  if (!isCurrentNavigation(pageEpoch)) return;
  document.body.dataset.view = 'admin';
  const date = selectedDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  adminDashboardState.date = date;
  app.innerHTML = `
    <header class="hero admin-refactor-hero">
      <div class="row"><div><h1>活动管理后台</h1><div>${escapeHtml(config.activityName)}</div></div>
        <div class="admin-header-actions right">
          <button class="secondary" id="ranking">排行榜</button>
          <button class="secondary" id="plaza">活动广场</button>
          <button class="secondary" id="commentAdmin">评论管理</button>
          <button class="secondary" id="legacyAdminTools">高级工具</button>
          <button class="secondary" id="out">退出</button>
        </div>
      </div>
    </header>
    <main class="admin-refactor-shell">
      <section class="card admin-user-section" id="adminUserCore" aria-busy="true">
        <div class="admin-panel-loading">正在加载用户完成情况…</div>
      </section>
      <div class="admin-management-stack" aria-label="后台管理模块">
        ${adminAccordionMarkup('team', '队伍管理', '队伍列表、手动创建与 Excel 导入')}
        ${adminAccordionMarkup('user', '用户管理', '单个添加与 Excel 批量导入')}
        ${adminAccordionMarkup('plaza', '活动广场管理', '紧凑列表，查看详情后再执行管理操作')}
      </div>
      <p class="admin-advanced-note">任务设置、最终截图、导出、管理员监督等低频功能已移至“高级工具”，不会参与首页加载。</p>
    </main>
    <div id="modalRoot"></div>`;
  prepareDynamicContent(app);
  document.querySelector('#out').onclick = logout;
  document.querySelector('#ranking').onclick = () => rankings();
  document.querySelector('#plaza').onclick = () => plaza();
  document.querySelector('#commentAdmin').onclick = () => adminComments();
  document.querySelector('#legacyAdminTools').onclick = () => openLegacyAdminTools(date);
  document.querySelectorAll('[data-admin-panel-target]').forEach((button) => {
    button.onclick = () => setCompactAdminPanel(button.dataset.adminPanelTarget);
  });
  await refreshCompactAdminUsers(date);
  if (!isCurrentNavigation(pageEpoch)) return;
  if (adminDashboardState.openPanel) await setCompactAdminPanel(adminDashboardState.openPanel);
  requestAnimationFrame(() => window.scrollTo(0, Number(sessionStorage.adminScrollY || 0)));
}
