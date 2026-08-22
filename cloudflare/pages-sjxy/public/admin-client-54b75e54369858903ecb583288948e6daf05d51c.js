/* ADMIN_CLIENT_LAZY_CLIENT_V1 */
/* ADMIN_BACKEND_CANONICAL_V1 */
async function adminComments(page = 1) {
  const force = arguments[1] === true;
  const pageEpoch = beginNavigation();
  app.innerHTML = `<header class="hero"><div class="row"><div><h1>评论管理</h1><p>正在读取评论…</p></div><button class="secondary right" id="backComments">返回后台</button></div></header><section class="card"><div class="admin-panel-loading" aria-live="polite">正在读取评论…</div></section>`;
  document.querySelector('#backComments').onclick = () => admin(adminDashboardState.date);
  const cacheKey = String(page);
  let result = !force ? readAdminBackendCache(adminDashboardState.commentCache, cacheKey) : null;
  try {
    if (!result) {
      result = await api(`/api/admin/comments?page=${page}&limit=20`);
      writeAdminBackendCache(adminDashboardState.commentCache, cacheKey, result);
    }
  } catch (error) {
    if (!isCurrentNavigation(pageEpoch)) return;
    app.innerHTML = `<header class="hero"><div class="row"><div><h1>评论管理</h1><p>读取失败</p></div><button class="secondary right" id="backComments">返回后台</button></div></header><section class="card"><div class="admin-inline-error"><p>${escapeHtml(error.message || '评论读取失败，请检查网络后重试。')}</p><button id="retryAdminComments">重新加载</button></div></section>`;
    document.querySelector('#backComments').onclick = () => admin(adminDashboardState.date);
    document.querySelector('#retryAdminComments').onclick = () => adminComments(page, true);
    return;
  }
  if (!isCurrentNavigation(pageEpoch)) return;
  app.innerHTML = `
    <header class="hero"><div class="row"><div><h1>评论管理</h1><p>管理员可查看并删除活动广场中的违规评论</p></div><button class="secondary right" id="backComments">返回后台</button></div></header>
    <section class="card"><div class="admin-comment-list">${result.comments.map((comment) => `
      <article class="comment-item" data-comment="${comment.id}" data-post="${comment.postId || ''}">
        <div class="row"><strong>${escapeHtml(comment.userName)}</strong><span class="muted">${formatDate(comment.createdAt)}</span></div>
        <p>${escapeHtml(comment.content)}</p>
        <div class="row"><span class="muted">所属队伍：${escapeHtml(comment.teamName)}</span><button class="danger right delete-admin-comment">删除评论</button></div>
      </article>`).join('') || '<p class="muted">暂无评论</p>'}</div>
      <div class="row plaza-pager"><button class="secondary" id="prevAdminComments" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${page} 页</span><button class="secondary" id="nextAdminComments" ${!result.hasMore ? 'disabled' : ''}>下一页</button></div>
    </section>`;
  document.querySelector('#backComments').onclick = () => admin();
  document.querySelector('#prevAdminComments').onclick = () => adminComments(page - 1);
  document.querySelector('#nextAdminComments').onclick = () => adminComments(page + 1);
  document.querySelectorAll('.delete-admin-comment').forEach((button) => {
    button.onclick = async (event) => {
      const item = button.closest('[data-comment]');
      if (!await askConfirm('是否删除该评论？', '删除后活动广场会立即同步，且无法恢复。')) return;
      const restoreButton = beginButtonLoading(event.currentTarget, '删除中…');
      try {
      await api(`/api/admin/comments/${item.dataset.comment}`, { method: 'DELETE' });
      plazaViewCache.clear();
      adminDashboardState.commentCache.clear();
      clearAdminPlazaBrowseCache();
      item.remove();
      } catch (error) {
        restoreButton();
        alert(error.message);
      }
    };
  });
}

async function legacyAdmin(selectedDate, pageEpoch = beginNavigation()) {
  if (!isCurrentNavigation(pageEpoch)) return;
  document.body.dataset.view = 'admin';
  const date = selectedDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  adminDashboardState.date = date;
  recordAppRoute('admin', { adminHome: true, adminDate: date }, { replace: true });
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
        ${adminAccordionMarkup('checkin', '打卡设置', '打卡日期、时段、星期与照片数量')}
        ${adminAccordionMarkup('team', '队伍管理', '队伍列表、手动创建与 Excel 导入')}
        ${adminAccordionMarkup('user', '用户管理', '单个添加与 Excel 批量导入')}
        ${adminAccordionMarkup('plaza', '活动广场管理', '紧凑列表，查看详情后再执行管理操作')}
      </div>
      <p class="admin-advanced-note">任务设置、最终截图、导出、管理员监督等低频功能已移至“高级工具”，不会参与首页加载。</p>
    </main>
    <div id="modalRoot"></div>`;
  prepareDynamicContent(app);
  document.querySelector('#out').onclick = logout;
  bindAdminHeaderActions(date);
  document.querySelectorAll('[data-admin-panel-target]').forEach((button) => {
    button.onclick = () => setCompactAdminPanel(button.dataset.adminPanelTarget);
  });
  await refreshCompactAdminUsers(date);
  if (!isCurrentNavigation(pageEpoch)) return;
  if (adminDashboardState.openPanel) await setCompactAdminPanel(adminDashboardState.openPanel);
  requestAnimationFrame(() => window.scrollTo(0, Number(sessionStorage.adminScrollY || 0)));
}

/* ADMIN_DASHBOARD_REFACTOR_V1 */
const adminDashboardState = {
  date: '',
  users: [],
  userSummary: null,
  teamData: null,
  teamSavedAt: 0,
  plazaData: null,
  plazaPage: 1,
  userCache: new Map(),
  commentCache: new Map(),
  plazaCache: new Map(),
  checkinSettings: null,
  checkinSettingsSavedAt: 0,
  openPanel: sessionStorage.getItem('adminCompactPanel') || '',
  teamTab: sessionStorage.getItem('adminTeamTab') || 'manual',
  userTab: sessionStorage.getItem('adminUserTab') || 'single',
  userTrack: ['health', 'interaction'].includes(sessionStorage.getItem('adminUserTrack'))
    ? sessionStorage.getItem('adminUserTrack') : 'health',
  requestEpoch: 0
};

const adminCacheFresh = (savedAt, ttl = 20_000) => savedAt && Date.now() - savedAt < ttl;
const ADMIN_BACKEND_CACHE_TTL_MS = 30_000;
const readAdminBackendCache = (store, key) => {
  const cached = store.get(key);
  return cached && adminCacheFresh(cached.savedAt, ADMIN_BACKEND_CACHE_TTL_MS) ? cached.data : null;
};
const writeAdminBackendCache = (store, key, data) => store.set(key, { data, savedAt: Date.now() });
const clearAdminUserCache = () => adminDashboardState.userCache.clear();
const clearAdminPlazaCache = () => adminDashboardState.plazaCache.clear();
const runAdminHeaderAction = (button, pendingLabel, action) => {
  if (!button || button.disabled) return;
  const restore = beginButtonLoading(button, pendingLabel);
  Promise.resolve(action()).then(
    () => restore(),
    (error) => { restore(); alert(error.message || '操作失败，请检查网络后重试。'); }
  );
};
const adminRankingKey = (period, key) => scopedCacheKey('admin-ranking', period, key);
const adminRankingRows = (items, metric, label) => `<div class="table-wrap"><table><thead><tr><th>排名</th><th>队伍</th><th>${label}</th></tr></thead><tbody>${items.map((item) => `<tr><td>${item.rank}</td><td>${escapeHtml(item.teamName)}</td><td>${item[metric]}</td></tr>`).join('') || '<tr><td colspan="3">暂无排行数据</td></tr>'}</tbody></table></div>`;
const assertAdminRankingContract = (result) => {
  const required = ['likes', 'views', 'heat', 'teams'];
  const invalid = required.find((key) => !Array.isArray(result?.[key]));
  if (invalid) throw new Error(`排行榜数据结构异常：缺少 ${invalid} 列表。请重新加载或检查服务端响应。`);
  return result;
};
const renderAdminRankings = (result, period, key, pageEpoch) => {
  if (!isCurrentNavigation(pageEpoch)) return;
  const data = assertAdminRankingContract(result);
  document.body.dataset.view = 'admin-ranking';
  const currentKey = key || data.key;
  app.innerHTML = `<header class="hero"><div class="row"><div><h1>活动排行榜</h1><p>管理员查看实时广场排名</p></div><button class="secondary right" id="backAdminRanking">返回后台</button></div></header>
    <section class="card"><div class="row"><button class="${period === 'day' ? '' : 'secondary'}" data-admin-ranking-period="day">日榜</button><button class="${period === 'week' ? '' : 'secondary'}" data-admin-ranking-period="week">周榜</button><button class="${period === 'month' ? '' : 'secondary'}" data-admin-ranking-period="month">月榜</button><label class="right">${period === 'month' ? '月份' : '日期'} <input id="adminRankingKey" type="${period === 'month' ? 'month' : 'date'}" value="${escapeHtml(currentKey)}"></label></div></section>
    ${period === 'month'
      ? `<section class="card"><h2>队伍月榜</h2>${adminRankingRows(data.teams, 'score', '综合热度')}</section>`
      : `<section class="grid ranking-grids"><div class="card"><h2>点赞榜</h2>${adminRankingRows(data.likes, 'likes', '点赞')}</div><div class="card"><h2>浏览榜</h2>${adminRankingRows(data.views, 'views', '浏览')}</div><div class="card"><h2>综合热度榜</h2>${adminRankingRows(data.heat, 'score', '热度')}</div></section>`}
    <p class="view-cache-status muted" id="adminRankingError" hidden></p>`;
  prepareDynamicContent(app);
  document.querySelector('#backAdminRanking').onclick = () => admin(adminDashboardState.date);
  document.querySelectorAll('[data-admin-ranking-period]').forEach((button) => { button.onclick = () => openAdminRankings(button.dataset.adminRankingPeriod); });
  document.querySelector('#adminRankingKey').onchange = (event) => openAdminRankings(period, event.target.value);
};
async function openAdminRankings(period = 'day', key = '') {
  const pageEpoch = beginNavigation();
  const currentKey = key || (period === 'month'
    ? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).slice(0, 7)
    : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }));
  app.innerHTML = '<main class="admin-refactor-shell"><section class="card"><div class="admin-panel-loading" aria-live="polite">正在读取排行榜…</div></section></main>';
  try {
    const cacheKey = adminRankingKey(period, currentKey);
    let result = readViewCache(rankingViewCache, cacheKey)?.data;
    if (!result) {
      result = await api(`/api/rankings?period=${period}&key=${encodeURIComponent(currentKey)}`);
      writeViewCache(rankingViewCache, cacheKey, result);
    }
    renderAdminRankings(result, period, currentKey, pageEpoch);
  } catch (error) {
    if (!isCurrentNavigation(pageEpoch)) return;
    app.innerHTML = `<header class="hero"><div class="row"><div><h1>活动排行榜</h1><p>读取失败</p></div><button class="secondary right" id="backAdminRanking">返回后台</button></div></header><section class="card"><div class="admin-inline-error"><p>${escapeHtml(error.message || '排行榜读取失败。')}</p><button id="retryAdminRanking">重新加载排行榜</button></div></section>`;
    document.querySelector('#backAdminRanking').onclick = () => admin(adminDashboardState.date);
    document.querySelector('#retryAdminRanking').onclick = () => openAdminRankings(period, currentKey);
  }
}
const adminPlazaListCache = new Map();
const clearAdminPlazaBrowseCache = () => adminPlazaListCache.clear();
const renderAdminPlazaList = (result, pageEpoch, options = {}) => {
  if (!isCurrentNavigation(pageEpoch)) return;
  document.body.dataset.view = 'admin-plaza';
  const cards = (result.posts || []).map((post) => `<article class="admin-compact-row admin-post-row"><div class="admin-compact-primary"><strong>${escapeHtml(post.teamName)}</strong><small>${escapeHtml(post.taskName)}</small><small>${escapeHtml(post.copy || '无文案')}</small></div>${post.images?.[0] ? `<img class="admin-plaza-list-thumb" src="${escapeHtml(post.images[0].thumbUrl || post.images[0].imageUrl)}" loading="lazy" decoding="async" alt="${escapeHtml(post.teamName)}作品图片">` : ''}<div class="admin-post-status"><span>浏览 ${Number(post.viewCount || 0)}</span><span>点赞 ${Number(post.likeCount || 0)}</span></div><button class="secondary" type="button" data-admin-plaza-post="${escapeHtml(post.id)}">查看与管理</button></article>`).join('') || '<p class="muted">当前没有公开帖子。</p>';
  app.innerHTML = `<header class="hero"><div class="row"><div><h1>活动广场</h1><p>管理员模式：浏览真实公开作品并进入管理详情。</p></div><div class="right"><button class="secondary" id="refreshAdminPlaza">刷新</button><button class="secondary" id="backAdminPlaza">返回后台</button></div></div></header><main class="admin-refactor-shell"><section class="card"><div class="admin-panel-summary"><span>共 ${Number(result.total || 0)} 条公开帖子</span><small class="muted">图片、文案与评论读取真实广场数据</small></div><div class="admin-user-grid admin-post-grid">${cards}</div></section></main>`;
  prepareDynamicContent(app);
  document.querySelector('#backAdminPlaza').onclick = returnToPreviousAppRoute;
  document.querySelector('#refreshAdminPlaza').onclick = () => openAdminPlazaList({ force: true, historyMode: 'replace' });
  document.querySelectorAll('[data-admin-plaza-post]').forEach((button) => { button.onclick = () => openAdminPlazaPost(button.dataset.adminPlazaPost); });
};
async function openAdminPlazaList(options = {}) {
  const pageEpoch = beginNavigation();
  if (options.historyMode !== 'restore') recordAppRoute('admin-plaza', { adminPlaza: true, adminPlazaList: true }, { replace: options.historyMode === 'replace' });
  app.innerHTML = '<main class="admin-refactor-shell"><section class="card"><div class="admin-panel-loading" aria-live="polite">正在读取活动广场…</div></section></main>';
  try {
    const cacheKey = 'latest:1';
    let result = !options.force ? readAdminBackendCache(adminPlazaListCache, cacheKey) : null;
    if (!result) {
      result = await api('/api/plaza?sort=latest&page=1&limit=20');
      writeAdminBackendCache(adminPlazaListCache, cacheKey, result);
    }
    renderAdminPlazaList(result, pageEpoch, options);
  } catch (error) {
    if (!isCurrentNavigation(pageEpoch)) return;
    app.innerHTML = `<header class="hero"><div class="row"><div><h1>活动广场</h1><p>读取失败</p></div><button class="secondary right" id="backAdminPlaza">返回后台</button></div></header><section class="card"><div class="admin-inline-error"><p>${escapeHtml(error.message || '活动广场读取失败。')}</p><button id="retryAdminPlazaBrowse">重新加载</button></div></section>`;
    document.querySelector('#backAdminPlaza').onclick = returnToPreviousAppRoute;
    document.querySelector('#retryAdminPlazaBrowse').onclick = () => openAdminPlazaList({ force: true, historyMode: 'replace' });
  }
}
const adminPostImageUrls = (image) => {
  const thumbUrl = typeof image === 'string' ? image : image?.thumbUrl || image?.imageUrl || image?.displayUrl || '';
  return {
    thumbUrl,
    displayUrl: typeof image === 'string' ? image : image?.displayUrl || image?.imageUrl || thumbUrl
  };
};
const renderAdminPostPhoto = (image, index, teamName) => {
  const { thumbUrl, displayUrl } = adminPostImageUrls(image);
  if (!thumbUrl) return '<p class="image-fallback">该图片暂时无法加载</p>';
  return `<button type="button" class="image-viewer-trigger admin-post-photo" data-image-viewer="${escapeHtml(thumbUrl)}" data-image-thumb="${escapeHtml(thumbUrl)}" data-image-display="${escapeHtml(displayUrl)}" data-image-alt="${escapeHtml(teamName)}活动原图"><span class="image-shell"><img data-perf-image="admin-plaza-thumb" data-priority="${index === 0 ? 'high' : 'low'}" ${index === 0 ? 'src' : 'data-src'}="${escapeHtml(thumbUrl)}" loading="${index === 0 ? 'eager' : 'lazy'}" fetchpriority="${index === 0 ? 'high' : 'low'}" decoding="async" width="960" height="720" alt="活动照片" onload="this.parentElement.classList.add('loaded')" onerror="this.hidden=true;this.parentElement.classList.add('failed')"><span class="image-error">图片加载失败</span></span></button>`;
};
async function openAdminPlazaPost(postId, options = {}) {
  const pageEpoch = beginNavigation();
  if (options.historyMode !== 'restore') recordAppRoute('admin-plaza-detail', { adminPlaza: true, adminPlazaPost: postId }, { replace: options.historyMode === 'replace' });
  app.innerHTML = '<main class="admin-refactor-shell"><section class="card"><div class="admin-panel-loading" aria-live="polite">正在读取完整作品、图片与评论…</div></section></main>';
  try {
    const response = await api(`/api/plaza/${encodeURIComponent(postId)}`);
    const post = response?.post;
    if (!post || !Array.isArray(post.images) || !Array.isArray(post.comments)) throw new Error('管理员帖子详情数据不完整。');
    if (!isCurrentNavigation(pageEpoch)) return;
    document.body.dataset.view = 'admin-plaza-detail';
    const imageMarkup = post.images.map((image, index) => renderAdminPostPhoto(image, index, post.teamName)).join('') || '<p class="muted">该帖子暂无照片</p>';
    const commentMarkup = post.comments.map((comment) => `<article class="comment-item" data-admin-detail-comment="${escapeHtml(comment.id)}"><div class="row"><strong>${escapeHtml(comment.userName)}</strong><span class="muted">${formatDate(comment.createdAt)}</span></div><p>${escapeHtml(comment.content)}</p><button class="danger" type="button" data-delete-detail-comment="${escapeHtml(comment.id)}">删除评论</button></article>`).join('') || '<p class="muted">暂无评论。</p>';
    app.innerHTML = `<header class="hero"><div class="row"><div><h1>${escapeHtml(post.teamName)}</h1><p>管理员帖子详情</p></div><button class="secondary right" id="backAdminPlazaPost">返回</button></div></header><main class="admin-refactor-shell"><section class="card"><dl class="admin-post-details"><div><dt>队伍</dt><dd>${escapeHtml(post.teamName)}</dd></div><div><dt>任务</dt><dd>${escapeHtml(post.taskName)}</dd></div><div><dt>状态</dt><dd>${post.status === 'visible' ? '公开' : '已隐藏'}</dd></div><div><dt>浏览 / 点赞</dt><dd>${Number(post.viewCount || 0)} / ${Number(post.likeCount || 0)}</dd></div><div><dt>发布时间</dt><dd>${formatDate(post.publishedAt)}</dd></div><div class="wide"><dt>文案</dt><dd>${escapeHtml(post.copy || '无文案')}</dd></div></dl><div class="admin-post-photo-grid">${imageMarkup}</div><div class="admin-action-buttons"><button type="button" class="secondary" data-post-toggle>${post.status === 'visible' ? '隐藏帖子' : '恢复公开'}</button><button type="button" class="secondary" data-post-exclude>${post.excludedFromRanking ? '恢复排名' : '排除排名'}</button><button type="button" class="danger" data-post-delete>删除帖子</button></div></section><section class="card"><h2>全部评论</h2><div class="admin-comment-list" id="adminPostComments">${commentMarkup}</div></section></main>`;
    prepareDynamicContent(app);
    document.querySelector('#backAdminPlazaPost').onclick = returnToPreviousAppRoute;
    const invalidate = () => { plazaViewCache.clear(); rankingViewCache.clear(); clearAdminPlazaCache(); clearAdminPlazaBrowseCache(); adminDashboardState.commentCache.clear(); };
    document.querySelectorAll('[data-delete-detail-comment]').forEach((button) => { button.onclick = async (event) => { if (!await askConfirm('是否删除这条评论？', '删除后普通用户也无法再看到该评论。')) return; const restore = beginButtonLoading(event.currentTarget, '删除中…'); try { await api(`/api/admin/comments/${encodeURIComponent(button.dataset.deleteDetailComment)}`, { method: 'DELETE' }); invalidate(); button.closest('[data-admin-detail-comment]')?.remove(); showToast('评论已删除'); } catch (error) { restore(); alert(error.message); } }; });
    document.querySelector('[data-post-toggle]').onclick = async (event) => { const restore = beginButtonLoading(event.currentTarget, '处理中…'); try { await api(`/api/admin/plaza/${post.id}`, { method: 'PATCH', body: JSON.stringify({ status: post.status === 'visible' ? 'hidden' : 'visible' }) }); invalidate(); await openAdminPlazaPost(post.id, { historyMode: 'replace' }); } catch (error) { restore(); alert(error.message); } };
    document.querySelector('[data-post-exclude]').onclick = async (event) => { const restore = beginButtonLoading(event.currentTarget, '处理中…'); try { await api(`/api/admin/plaza/${post.id}`, { method: 'PATCH', body: JSON.stringify({ excludedFromRanking: !post.excludedFromRanking }) }); invalidate(); await openAdminPlazaPost(post.id, { historyMode: 'replace' }); } catch (error) { restore(); alert(error.message); } };
    document.querySelector('[data-post-delete]').onclick = async (event) => { if (!await askConfirm('是否永久删除该广场帖子？', '任务提交记录不会删除，此操作不可恢复。')) return; const restore = beginButtonLoading(event.currentTarget, '删除中…'); try { await api(`/api/admin/plaza/${post.id}`, { method: 'DELETE' }); invalidate(); showToast('帖子已删除'); returnToPreviousAppRoute(); } catch (error) { restore(); alert(error.message); } };
  } catch (error) {
    if (!isCurrentNavigation(pageEpoch)) return;
    app.innerHTML = `<header class="hero"><div class="row"><div><h1>管理员帖子详情</h1><p>读取失败</p></div><button class="secondary right" id="backAdminPlazaPost">返回</button></div></header><section class="card"><div class="admin-inline-error"><p>${escapeHtml(error.message || '帖子详情读取失败。')}</p><button id="retryAdminPlazaPost">重新加载</button></div></section>`;
    document.querySelector('#backAdminPlazaPost').onclick = returnToPreviousAppRoute;
    document.querySelector('#retryAdminPlazaPost').onclick = () => openAdminPlazaPost(postId, { historyMode: 'replace' });
  }
}
const studentRouteRestorer = restoreAppRoute;
restoreAppRoute = (state) => {
  if (user?.role === 'admin') {
    if (state?.appRoute === 'admin') { void admin(state.adminDate || adminDashboardState.date); return true; }
    if (state?.appRoute === 'admin-plaza') { void openAdminPlazaList({ historyMode: 'restore' }); return true; }
    if (state?.appRoute === 'admin-plaza-detail' && state.adminPlazaPost) { void openAdminPlazaPost(state.adminPlazaPost, { historyMode: 'restore' }); return true; }
  }
  return studentRouteRestorer(state);
};
const bindAdminHeaderActions = (date) => {
  document.querySelector('#ranking').onclick = (event) => runAdminHeaderAction(event.currentTarget, '读取中…', openAdminRankings);
  document.querySelector('#plaza').onclick = (event) => runAdminHeaderAction(event.currentTarget, '打开中…', () => openAdminPlazaList());
  document.querySelector('#commentAdmin').onclick = (event) => runAdminHeaderAction(event.currentTarget, '读取中…', () => adminComments());
  document.querySelector('#legacyAdminTools').onclick = (event) => runAdminHeaderAction(event.currentTarget, '打开中…', () => openLegacyAdminTools(date));
};

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

async function refreshCompactAdminUsers(date = adminDashboardState.date, force = false) {
  const target = document.querySelector('#adminUserCore');
  if (!target) return;
  target.setAttribute('aria-busy', 'true');
  const epoch = ++adminDashboardState.requestEpoch;
  const userPath = `/api/admin/users?page=${adminUserPage}&limit=30&q=${encodeURIComponent(adminUserQuery)}&completion=${adminUserFilter}&track=${adminDashboardState.userTrack}&date=${date}`;
  const cacheKey = `${date}|${adminUserPage}|${adminUserQuery}|${adminUserFilter}|${adminDashboardState.userTrack}`;
  try {
    let cached = !force ? readAdminBackendCache(adminDashboardState.userCache, cacheKey) : null;
    if (!cached) {
      const [completion, result] = await Promise.all([api(`/api/admin/completion-summary?date=${date}`), api(userPath)]);
      cached = { completion, result };
      writeAdminBackendCache(adminDashboardState.userCache, cacheKey, cached);
    }
    if (epoch !== adminDashboardState.requestEpoch || !document.querySelector('#adminUserCore')) return;
    target.removeAttribute('aria-busy');
    renderAdminUserPanel(cached.completion, cached.result, date);
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

async function refreshCompactTeamPanel(force = false) {
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
      clearAdminUserCache();
      showToast('账号创建成功');
      await refreshCompactAdminUsers(adminDashboardState.date, true);
    } catch (error) { restore(); alert(error.message); }
  };
  document.querySelector('#compactImportUsers').onsubmit = async (event) => {
    event.preventDefault();
    const restore = beginButtonLoading(event.submitter, '导入中…');
    try {
      const file = event.target.file.files[0];
      const encoded = await readRawFile(file);
      const imported = await api('/api/admin/users/import', { method: 'POST', body: JSON.stringify({ file: encoded }) });
      clearAdminUserCache();
      showToast(`成功导入 ${imported.imported} 个用户`);
      await refreshCompactAdminUsers(adminDashboardState.date, true);
    } catch (error) { restore(); alert(error.message); }
  };
}

const compactPostRow = (post, index) => `
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
      <div><dt>队伍</dt><dd>${escapeHtml(post.teamName)}</dd></div>
      <div><dt>任务</dt><dd>${escapeHtml(post.taskName)}</dd></div>
      <div><dt>状态</dt><dd>${post.status === 'visible' ? '公开' : '已隐藏'}</dd></div>
      <div><dt>浏览 / 点赞</dt><dd>${post.viewCount} / ${post.likeCount}</dd></div>
      <div><dt>发布时间</dt><dd>${formatDate(post.publishedAt)}</dd></div>
      <div class="wide"><dt>文案</dt><dd>${escapeHtml(post.copy || '无文案')}</dd></div>
    </dl>
    <div class="admin-post-photo-grid">${(post.images || []).map((image, imageIndex) => renderAdminPostPhoto(image, imageIndex, post.teamName)).join('') || '<p class="muted">该帖子暂无照片</p>'}</div>
    <div class="admin-action-buttons">
      <button type="button" class="secondary" data-post-toggle>${post.status === 'visible' ? '隐藏帖子' : '恢复公开'}</button>
      <button type="button" class="secondary" data-post-exclude>${post.excludedFromRanking ? '恢复排名' : '排除排名'}</button>
      <button type="button" class="danger" data-post-delete>删除帖子</button>
    </div>
  </section>`;
  document.body.append(root);
  prepareDynamicContent(root);
  const close = () => root.remove();
  root.querySelector('[data-close-post-actions]').onclick = close;
  root.onclick = (event) => { if (event.target === root) close(); };
  root.querySelector('[data-post-toggle]').onclick = async (event) => {
    const restore = beginButtonLoading(event.currentTarget, '处理中…');
    try {
      await api(`/api/admin/plaza/${post.id}`, { method: 'PATCH', body: JSON.stringify({ status: post.status === 'visible' ? 'hidden' : 'visible' }) });
      plazaViewCache.clear();
      rankingViewCache.clear();
      clearAdminPlazaCache();
      clearAdminPlazaBrowseCache();
      close();
      await refreshCompactPlazaPanel(adminDashboardState.plazaPage, true);
      showToast('帖子状态已更新');
    } catch (error) { restore(); alert(error.message); }
  };
  root.querySelector('[data-post-exclude]').onclick = async (event) => {
    const restore = beginButtonLoading(event.currentTarget, '处理中…');
    try {
      await api(`/api/admin/plaza/${post.id}`, { method: 'PATCH', body: JSON.stringify({ excludedFromRanking: !post.excludedFromRanking }) });
      rankingViewCache.clear();
      clearAdminPlazaCache();
      clearAdminPlazaBrowseCache();
      close();
      await refreshCompactPlazaPanel(adminDashboardState.plazaPage, true);
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
      clearAdminPlazaCache();
      clearAdminPlazaBrowseCache();
      close();
      await refreshCompactPlazaPanel(adminDashboardState.plazaPage, true);
      showToast('帖子已删除');
    } catch (error) { restore(); alert(error.message); }
  };
}

async function refreshCompactPlazaPanel(page = 1, force = false) {
  const panel = document.querySelector('#adminPanel-plaza');
  if (!panel || panel.hidden) return;
  panel.innerHTML = '<div class="admin-panel-loading" aria-live="polite">正在加载广场帖子…</div>';
  try {
    const cacheKey = String(page);
    let result = !force ? readAdminBackendCache(adminDashboardState.plazaCache, cacheKey) : null;
    if (!result) {
      result = await api(`/api/admin/plaza?page=${page}&limit=20`);
      writeAdminBackendCache(adminDashboardState.plazaCache, cacheKey, result);
    }
    adminDashboardState.plazaData = result;
    adminDashboardState.plazaPage = result.page;
    panel.innerHTML = `
      <div class="admin-panel-summary"><span>共 ${result.total} 条帖子</span><small class="muted">详情与管理操作按需打开</small></div>
      <div class="admin-user-grid admin-post-grid">${result.posts.map((post, index) => compactPostRow(post, index)).join('') || '<p class="muted">暂无广场帖子</p>'}</div>
      <div class="user-pagination">
        <button type="button" class="secondary" id="compactPlazaPrev" ${result.page <= 1 ? 'disabled' : ''}>上一页</button>
        <span>第 ${result.page} 页</span>
        <button type="button" class="secondary" id="compactPlazaNext" ${!result.hasMore ? 'disabled' : ''}>下一页</button>
      </div>`;
    document.querySelectorAll('.admin-post-actions').forEach((button) => {
      button.onclick = () => openAdminPlazaPost(button.dataset.id);
    });
    document.querySelector('#compactPlazaPrev').onclick = () => refreshCompactPlazaPanel(Math.max(1, result.page - 1));
    document.querySelector('#compactPlazaNext').onclick = () => refreshCompactPlazaPanel(result.page + 1);
  } catch (error) {
    panel.innerHTML = `<div class="admin-inline-error"><p>${escapeHtml(error.message)}</p><button id="retryAdminPlaza">重新加载</button></div>`;
    document.querySelector('#retryAdminPlaza').onclick = () => refreshCompactPlazaPanel(page, true);
  }
}

async function refreshCompactCheckinSettings(force = false) {
  const panel = document.querySelector('#adminPanel-checkin');
  if (!panel || panel.hidden) return;
  panel.innerHTML = '<div class="admin-panel-loading">正在读取打卡设置…</div>';
  try {
    let result = !force && adminCacheFresh(adminDashboardState.checkinSettingsSavedAt, ADMIN_BACKEND_CACHE_TTL_MS) ? adminDashboardState.checkinSettings : null;
    if (!result) {
      result = await api('/api/admin/checkin-settings');
      adminDashboardState.checkinSettings = result;
      adminDashboardState.checkinSettingsSavedAt = Date.now();
    }
    const settings = result.settings || {};
    const weekdays = new Set((settings.weekdays || [1,2,3,4,5,6,7]).map(Number));
    panel.innerHTML = `<form id="compactCheckinSettings" class="admin-compact-form checkin-settings-form">
      <label class="switch-line"><input name="enabled" type="checkbox" ${settings.enabled !== false ? 'checked' : ''}>开放打卡</label>
      <div class="settings-grid"><label>开始日期<input name="activeStartDate" type="date" value="${escapeHtml(settings.activeStartDate || '')}" required></label>
      <label>结束日期<input name="activeEndDate" type="date" value="${escapeHtml(settings.activeEndDate || '')}" required></label>
      <label>每日开始<input name="dailyStart" type="time" value="${escapeHtml(settings.dailyStart || '00:00')}" required></label>
      <label>每日结束<input name="dailyEnd" type="time" value="${escapeHtml(settings.dailyEnd || '23:59')}" required></label>
      <label>个人打卡照片数<input name="personalImageLimit" type="number" min="1" max="8" value="${Number(settings.personalImageLimit || 3)}" required></label>
      <label>队伍汇总照片数<input name="teamImageLimit" type="number" min="1" max="8" value="${Number(settings.teamImageLimit || 3)}" required></label></div>
      <fieldset><legend>允许打卡的星期</legend><div class="weekday-options">${[1,2,3,4,5,6,7].map((day) => `<label><input type="checkbox" name="weekdays" value="${day}" ${weekdays.has(day) ? 'checked' : ''}>周${day}</label>`).join('')}</div></fieldset>
      <button>保存打卡设置</button>
    </form>`;
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
        adminDashboardState.checkinSettings = null;
        adminDashboardState.checkinSettingsSavedAt = 0;
        showToast('打卡设置已保存');
        await refreshCompactCheckinSettings(true);
      } catch (error) { restore(); alert(error.message); }
    };
  } catch (error) {
    panel.innerHTML = `<div class="admin-inline-error"><p>${escapeHtml(error.message)}</p><button id="retryCheckinSettings">重新加载</button></div>`;
    panel.querySelector('#retryCheckinSettings').onclick = () => refreshCompactCheckinSettings(true);
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
  if (name === 'checkin') await refreshCompactCheckinSettings();
  if (name === 'team') await refreshCompactTeamPanel(false);
  if (name === 'user') renderCompactUserManagement();
  if (name === 'plaza') await refreshCompactPlazaPanel(adminDashboardState.plazaPage || 1);
}

const renderAdvancedStudentOptions = (students) => students.map((student) => (
  `<option value="${escapeHtml(student.id)}">${escapeHtml(student.name)} · ${escapeHtml(student.studentId)} · ${escapeHtml(trackName(student.trackId))}</option>`
)).join('');

const loadAdvancedGovernance = async (governanceRoot) => {
  if (!governanceRoot?.isConnected) return;
  governanceRoot.innerHTML = '<h3>设置管理员</h3><p class="muted">正在读取管理员权限…</p>';
  try {
    const governance = await api('/api/admin/governance');
    if (!governanceRoot.isConnected) return;
    if (!governance?.isPrimary) {
      governanceRoot.innerHTML = '<h3>设置管理员</h3><p class="muted">仅最高管理员可以创建管理员账号和监督其他管理员操作。</p>';
      return;
    }
    const admins = Array.isArray(governance.admins) ? governance.admins : [];
    const logs = Array.isArray(governance.logs) ? governance.logs : [];
    governanceRoot.innerHTML = `
      <h3>设置管理员</h3>
      <p class="muted">创建管理员账号，或驳回其他管理员的补卡和审核操作。</p>
      <form id="advancedCreateAdmin" class="admin-compact-form">
        <label>管理员账号<input name="studentId" required></label>
        <label>管理员姓名<input name="name" required></label>
        <label>校区<input name="campus" value="金山学院" required></label>
        <label>初始密码<input name="password" type="password" minlength="8" required></label>
        <button>创建管理员</button>
      </form>
      <h4>管理员列表</h4>
      <div class="member-list">${admins.map((item) => `<span>${escapeHtml(item.name)} · ${escapeHtml(item.studentId)} · ${item.id === user.id ? '最高管理员' : '管理员'}</span>`).join('') || '<span>暂无管理员</span>'}</div>
      <h4>其他管理员操作</h4>
      <div class="admin-governance-log">${logs.map((item) => `<article><strong>${escapeHtml(item.actorName)}</strong><small>${escapeHtml(item.action)} · ${formatDate(item.createdAt)}</small>${item.reviewStatus !== 'rejected' && ['makeup', 'approved', 'returned'].includes(item.action) ? `<button type="button" class="danger reject-admin-action" data-id="${escapeHtml(item.id)}">驳回操作</button>` : '<span class="muted">仅查看</span>'}</article>`).join('') || '<p class="muted">暂无其他管理员操作。</p>'}</div>`;
    governanceRoot.querySelector('#advancedCreateAdmin').onsubmit = async (event) => {
      event.preventDefault();
      const restore = beginButtonLoading(event.submitter, '创建中…');
      try {
        await api('/api/admin/admins', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
        event.target.reset();
        showToast('管理员账号已创建');
        await loadAdvancedGovernance(governanceRoot);
      } catch (error) {
        restore();
        alert(error.message || '管理员账号创建失败');
      }
    };
    governanceRoot.querySelectorAll('.reject-admin-action').forEach((button) => {
      button.onclick = async (event) => {
        if (!await askConfirm('是否驳回该管理员操作？', '补卡记录将被撤销；审核结果将恢复为待审核状态。')) return;
        const restore = beginButtonLoading(event.currentTarget, '处理中…');
        try {
          await api(`/api/admin/governance/${encodeURIComponent(button.dataset.id)}/reject`, { method: 'POST', body: JSON.stringify({ note: '最高管理员驳回' }) });
          showToast('该管理员操作已驳回');
          await loadAdvancedGovernance(governanceRoot);
        } catch (error) {
          restore();
          alert(error.message || '操作驳回失败');
        }
      };
    });
  } catch (error) {
    if (!governanceRoot?.isConnected) return;
    governanceRoot.innerHTML = `<h3>设置管理员</h3><p class="muted">${escapeHtml(error.message || '管理员权限读取失败。')}</p><button type="button" class="secondary" id="retryAdvancedGovernance">重新加载</button>`;
    governanceRoot.querySelector('#retryAdvancedGovernance').onclick = () => { void loadAdvancedGovernance(governanceRoot); };
  }
};

async function openLegacyAdminTools(date) {
  let root = document.querySelector('#modalRoot');
  if (!root) { root = document.createElement('div'); root.id = 'modalRoot'; app.append(root); }
  const students = Array.isArray(adminDashboardState.users) ? adminDashboardState.users : [];
  root.innerHTML = `<div class="app-dialog-backdrop admin-action-backdrop" id="advancedToolsBackdrop">
    <section class="app-dialog admin-action-sheet" role="dialog" aria-modal="true" aria-labelledby="advancedToolsTitle">
      <div class="row"><div><small class="muted">管理员后台</small><h2 id="advancedToolsTitle">高级工具</h2></div><button type="button" class="secondary right" id="closeAdvancedTools">关闭</button></div>
      <section class="admin-compact-module"><h3>账号设置</h3><p class="muted">修改当前管理员密码，保存后立即写入正式账号。</p><form id="advancedPasswordForm" class="admin-compact-form"><label>当前密码<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>新密码<input name="newPassword" type="password" minlength="8" autocomplete="new-password" required></label><button>保存新密码</button></form></section>
      <section class="admin-compact-module"><h3>补卡与代提交</h3><p class="muted">选择真实学生和补卡日期后，将直接打开正式补卡表单。</p>${students.length ? `<form id="advancedMakeupForm" class="admin-compact-form"><label>补卡日期<input name="date" type="date" value="${escapeHtml(date)}" required></label><label>学生<select name="userId" required>${renderAdvancedStudentOptions(students)}</select></label><button>打开补卡表单</button></form>` : '<p class="muted">学生列表尚未加载，请返回后台后重试。</p>'}</section>
      <section class="admin-compact-module" id="advancedGovernance"><h3>设置管理员</h3><p class="muted">正在读取管理员权限…</p></section>
    </section>
  </div>`;
  const close = () => { root.innerHTML = ''; };
  root.querySelector('#closeAdvancedTools').onclick = close;
  root.querySelector('#advancedToolsBackdrop').onclick = (event) => { if (event.target === event.currentTarget) close(); };
  root.querySelector('#advancedPasswordForm').onsubmit = async (event) => {
    event.preventDefault();
    const restore = beginButtonLoading(event.submitter, '保存中…');
    try {
      await api('/api/admin/password', { method: 'PATCH', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      event.target.reset();
      showToast('管理员密码已更新');
    } catch (error) {
      restore();
      alert(error.message || '密码保存失败');
    }
  };
  const makeupForm = root.querySelector('#advancedMakeupForm');
  if (makeupForm) makeupForm.onsubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const student = students.find((item) => item.id === form.get('userId'));
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(form.get('date') || '')) ? String(form.get('date')) : date;
    if (!student) return;
    close();
    startPhotoFlow('admin-checkin');
    requestAnimationFrame(() => openAdminUserDrawer(student, selectedDate, { initialSection: 'adminMakeup' }));
  };
  void loadAdvancedGovernance(root.querySelector('#advancedGovernance'));
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
        ${adminAccordionMarkup('checkin', '打卡设置', '打卡日期、时段、星期与照片数量')}
        ${adminAccordionMarkup('team', '队伍管理', '队伍列表、手动创建与 Excel 导入')}
        ${adminAccordionMarkup('user', '用户管理', '单个添加与 Excel 批量导入')}
        ${adminAccordionMarkup('plaza', '活动广场管理', '紧凑列表，查看详情后再执行管理操作')}
      </div>
      <p class="admin-advanced-note">任务设置、最终截图、导出、管理员监督等低频功能已移至“高级工具”，不会参与首页加载。</p>
    </main>
    <div id="modalRoot"></div>`;
  prepareDynamicContent(app);
  document.querySelector('#out').onclick = logout;
  bindAdminHeaderActions(date);
  document.querySelectorAll('[data-admin-panel-target]').forEach((button) => {
    button.onclick = () => setCompactAdminPanel(button.dataset.adminPanelTarget);
  });
  await refreshCompactAdminUsers(date);
  if (!isCurrentNavigation(pageEpoch)) return;
  if (adminDashboardState.openPanel) await setCompactAdminPanel(adminDashboardState.openPanel);
  requestAnimationFrame(() => window.scrollTo(0, Number(sessionStorage.adminScrollY || 0)));
}

function enhanceAdminSections() {
  const sections = [...document.querySelectorAll('#app > section.card, .admin-tools > .card')];
  sections.forEach((section, index) => {
    if (section.classList.contains('admin-user-section')) return;
    const title = section.querySelector('h2');
    if (!title) return;
    const key = `adminSection:${title.textContent.trim()}`;
    const primary = title.textContent.includes('每日提交');
    const expanded = sessionStorage.getItem(key) === null
      ? primary
      : sessionStorage.getItem(key) === 'open';
    const first = section.firstElementChild;
    const body = document.createElement('div');
    body.className = 'admin-collapsible-body';
    [...section.children].filter((child) => child !== first).forEach((child) => body.append(child));
    section.append(body);
    section.classList.add('admin-collapsible');
    section.classList.toggle('is-open', expanded);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'admin-section-toggle secondary';
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.innerHTML = `<span>${expanded ? '收起' : '展开'}</span><b aria-hidden="true">⌄</b>`;
    first.classList.add('admin-collapsible-heading');
    first.append(toggle);
    toggle.onclick = () => {
      const open = section.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.querySelector('span').textContent = open ? '收起' : '展开';
      sessionStorage.setItem(key, open ? 'open' : 'closed');
    };
  });
}

/* MOBILE_ADMIN_PHOTO_FIX_V1 */
const ADMIN_CHECKIN_CACHE_TTL_MS = 60_000;
const adminCheckinViewCache = new Map();
const adminCheckinInflight = new Map();

function openAdminUserDrawer(studentUser, date, options = {}) {
  let root = document.querySelector('#modalRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'modalRoot';
    app.append(root);
  }
  const cacheKey = `${studentUser.id}|${date}`;
  root.innerHTML = `<div class="drawer-backdrop" id="userDrawerBackdrop">
    <section class="bottom-drawer admin-checkin-drawer" role="dialog" aria-modal="true" aria-labelledby="userDrawerTitle" data-checkin-key="${escapeHtml(cacheKey)}">
      <div class="drawer-handle" aria-hidden="true"></div>
      <div class="drawer-sticky-header row">
        <div><small class="muted">打卡情况</small><h2 id="userDrawerTitle">${escapeHtml(studentUser.name)}</h2></div>
        <button class="secondary right" id="closeUserDrawer">关闭</button>
      </div>
      <div class="admin-checkin-date">${escapeHtml(date)}</div>
      <div id="adminCheckinRecords" class="admin-checkin-records" aria-busy="true">
        <div class="admin-checkin-skeleton" aria-label="正在读取打卡照片"></div>
      </div>
      <div class="drawer-accordions admin-user-management">
        ${[
          ['profile', '基本资料'],
          ['team', '所属队伍'],
          ['makeup', '补卡权限'],
          ['adminMakeup', '管理员代为补卡'],
          ['manage', '管理操作']
        ].map(([key, label]) => `<section class="drawer-accordion" data-drawer-section="${key}">
          <button class="drawer-accordion-toggle" type="button" aria-expanded="false"><span><strong>${label}</strong><small>点击展开</small></span><b aria-hidden="true">›</b></button>
          <div class="drawer-accordion-panel" hidden><div class="drawer-panel-inner" data-panel-content="${key}"></div></div>
        </section>`).join('')}
      </div>
    </section>
  </div>`;

  const backdrop = root.querySelector('#userDrawerBackdrop');
  const drawer = root.querySelector('.admin-checkin-drawer');
  const recordsRoot = root.querySelector('#adminCheckinRecords');
  const close = () => { root.innerHTML = ''; };
  root.querySelector('#closeUserDrawer').onclick = close;
  backdrop.onclick = (event) => { if (event.target === backdrop) close(); };

  let touchStartY = null;
  drawer.addEventListener('touchstart', (event) => {
    if (event.target.closest('.drawer-handle')) touchStartY = event.touches[0].clientY;
  }, { passive: true });
  drawer.addEventListener('touchend', (event) => {
    if (touchStartY !== null && event.changedTouches[0].clientY - touchStartY > 80) close();
    touchStartY = null;
  }, { passive: true });

  let managementPromise = null;
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
        panel.innerHTML = `<dl class="user-detail-list"><div><dt>姓名</dt><dd>${escapeHtml(studentUser.name)}</dd></div><div><dt>学号</dt><dd>${escapeHtml(studentUser.studentId)}</dd></div><div><dt>校区</dt><dd>${escapeHtml(studentUser.campus || '未设置')}</dd></div><div><dt>累计完成</dt><dd>${Number(studentUser.totalCompletedDays || 0)} 天</dd></div></dl>`;
      } else if (key === 'team') {
        const { teams } = await loadManagementData();
        const team = teams.find((item) => (item.members || []).some((member) => member.id === studentUser.id));
        panel.innerHTML = team ? `<p><strong>${escapeHtml(team.name)}</strong></p><p class="muted">${team.memberCount}/${team.memberLimit} 人</p>` : '<p class="muted">该用户尚未加入队伍</p>';
      } else if (key === 'makeup') {
        const permission = await api(`/api/admin/users/${encodeURIComponent(studentUser.id)}/makeup-permission?date=${encodeURIComponent(date)}`);
        let enabled = Boolean(permission.enabled);
        panel.innerHTML = `<div class="row"><p class="muted">仅对 ${escapeHtml(date)} 生效；默认关闭。</p><button class="${enabled ? 'danger' : 'secondary'} right" id="toggleMakeupPermission">${enabled ? '关闭用户补卡' : '允许用户补卡'}</button></div>`;
        panel.querySelector('#toggleMakeupPermission').onclick = async (event) => {
          const restore = beginButtonLoading(event.currentTarget, '处理中…');
          try {
            await api(`/api/admin/users/${encodeURIComponent(studentUser.id)}/makeup-permission?date=${encodeURIComponent(date)}`, { method: 'PUT', body: JSON.stringify({ enabled: !enabled }) });
            enabled = !enabled;
            event.currentTarget.textContent = enabled ? '关闭用户补卡' : '允许用户补卡';
            event.currentTarget.className = enabled ? 'danger right' : 'secondary right';
          } catch (error) { alert(error.message); } finally { restore(); }
        };
      } else if (key === 'adminMakeup') {
        const { tasks } = await loadManagementData();
        const isHealth = studentUser.trackId === 'health';
        const interactionTasks = tasks.filter((task) => task.trackId === 'interaction');
        const taskControl = isHealth
          ? `<label>餐次</label><select name="slotId">${config.slots.map((slot) => `<option value="${slot.id}">${escapeHtml(slot.label)}</option>`).join('')}</select>`
          : interactionTasks.length
            ? `<label>活动任务</label><select name="taskId" required>${interactionTasks.map((task) => `<option value="${task.id}">${escapeHtml(task.name)}</option>`).join('')}</select>`
            : '<p class="admin-inline-error">当前没有可补卡的互动任务，请先在任务设置中创建任务。</p>';
        panel.innerHTML = `<form id="adminMakeupForm">${taskControl}<label>补卡图片</label><input name="photos" type="file" accept="image/jpeg,image/png,image/webp" ${isHealth ? 'multiple' : ''} required>${isHealth ? '<small class="muted">健康赛道支持最多 3 张图片。</small><label>备注（可选）</label><textarea name="note"></textarea>' : ''}<button ${!isHealth && !interactionTasks.length ? 'disabled' : ''}>确认管理员补卡</button></form>`;
        panel.querySelector('#adminMakeupForm').onsubmit = async (event) => {
          event.preventDefault();
          const form = event.target;
          const restore = beginButtonLoading(event.submitter, '补卡中…');
          try {
            const photos = await readFiles(form.photos.files, { taskId: isHealth ? null : form.taskId.value, businessType: 'admin-makeup', limit: isHealth ? 3 : 1 });
            await api(`/api/admin/users/${encodeURIComponent(studentUser.id)}/makeup`, { method: 'POST', body: JSON.stringify(isHealth ? { date, slotId: form.slotId.value, mediaIds: photos.map((item) => item.mediaId), note: form.note.value } : { date, taskId: form.taskId.value, mediaIds: photos.map((item) => item.mediaId) }) });
            adminCheckinViewCache.delete(cacheKey);
            showToast('补卡已完成');
            openAdminUserDrawer(studentUser, date, { initialSection: 'adminMakeup' });
          } catch (error) { alert(error.message); } finally { restore(); }
        };
      } else if (key === 'manage') {
        panel.innerHTML = `<div class="drawer-actions"><button class="secondary" id="editDrawerUser">编辑用户</button><button class="${studentUser.status === 'active' ? 'danger' : 'secondary'}" id="toggleDrawerUser">${studentUser.status === 'active' ? '禁用用户' : '启用用户'}</button></div>`;
        panel.querySelector('#editDrawerUser').onclick = () => editUser(studentUser, date);
        panel.querySelector('#toggleDrawerUser').onclick = async (event) => {
          const next = studentUser.status === 'active' ? 'disabled' : 'active';
          if (!await askConfirm(`是否${next === 'disabled' ? '禁用' : '启用'}该用户？`, '操作将立即影响该账号的登录状态。')) return;
          const restore = beginButtonLoading(event.currentTarget, '处理中…');
          try {
            await api(`/api/admin/users/${encodeURIComponent(studentUser.id)}/status`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
            studentUser.status = next;
            event.currentTarget.textContent = next === 'active' ? '禁用用户' : '启用用户';
          } catch (error) { alert(error.message); } finally { restore(); }
        };
      }
      panel.dataset.loaded = 'true';
    } catch (error) {
      panel.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p><button class="secondary retry-management-section">重新加载</button>`;
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
  const initialSection = options.initialSection
    ? [...root.querySelectorAll('.drawer-accordion')].find((section) => section.dataset.drawerSection === options.initialSection)
    : null;
  initialSection?.querySelector('.drawer-accordion-toggle')?.click();

  const render = (result) => {
    if (!drawer.isConnected || drawer.dataset.checkinKey !== cacheKey) return;
    const records = Array.isArray(result?.records) ? result.records : [];
    recordsRoot.setAttribute('aria-busy', 'false');
    recordsRoot.innerHTML = records.length ? records.map((record) => {
      const images = Array.isArray(record.images) ? record.images : [];
      const photos = images.map((media, imageIndex) => {
        const thumbUrl = typeof media === 'string' ? media : media.thumbUrl || media.imageUrl || media.displayUrl;
        const displayUrl = typeof media === 'string' ? media : media.displayUrl || thumbUrl;
        if (!thumbUrl) return '';
        return `<button type="button" class="image-viewer-trigger admin-checkin-photo"
          data-image-viewer="${escapeHtml(thumbUrl)}" data-image-thumb="${escapeHtml(thumbUrl)}"
          data-image-display="${escapeHtml(displayUrl)}" data-image-alt="打卡照片">
          <span class="image-shell"><img data-perf-image="admin-checkin-thumb" ${imageIndex === 0 ? 'src' : 'data-src'}="${escapeHtml(thumbUrl)}" loading="${imageIndex === 0 ? 'eager' : 'lazy'}"
            fetchpriority="${imageIndex === 0 ? 'high' : 'low'}" decoding="async" width="540" height="405" alt="打卡照片"
            onload="this.parentElement.classList.add('loaded')"
            onerror="this.hidden=true;this.parentElement.classList.add('failed')"><span class="image-error">图片加载失败，点击重试</span></span>
        </button>`;
      }).join('');
      return `<article class="admin-checkin-record">
        <div class="admin-checkin-record-head"><strong>${escapeHtml(record.taskName || record.slotId || '打卡')}</strong><span class="pill done">${escapeHtml(record.status || '已提交')}</span></div>
        ${photos ? `<div class="admin-checkin-photo-grid">${photos}</div>` : '<p class="muted">暂无照片</p>'}
      </article>`;
    }).join('') : '<p class="admin-checkin-empty">当日暂无打卡</p>';
    prepareDynamicContent(recordsRoot);
  };

  const cached = adminCheckinViewCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < ADMIN_CHECKIN_CACHE_TTL_MS) {
    render(cached.data);
    return;
  }

  const load = async () => {
    let promise = adminCheckinInflight.get(cacheKey);
    if (!promise) {
      promise = api(`/api/admin/users/${encodeURIComponent(studentUser.id)}/checkins?date=${encodeURIComponent(date)}`, { timeoutMs: 8_000 })
        .finally(() => adminCheckinInflight.delete(cacheKey));
      adminCheckinInflight.set(cacheKey, promise);
    }
    try {
      const result = await promise;
      adminCheckinViewCache.set(cacheKey, { data: result, savedAt: Date.now() });
      render(result);
    } catch (error) {
      if (!drawer.isConnected) return;
      recordsRoot.setAttribute('aria-busy', 'false');
      recordsRoot.innerHTML = `<div class="admin-inline-error"><p>${escapeHtml(error.message)}</p><button type="button" id="retryAdminCheckins">重新加载</button></div>`;
      recordsRoot.querySelector('#retryAdminCheckins').onclick = () => {
        adminCheckinViewCache.delete(cacheKey);
        openAdminUserDrawer(studentUser, date);
      };
    }
  };
  void load();
}

function taskFormFields(task = {}, requestedType = '') {
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const nextWeek = new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const type = requestedType || (task.scheduleType === 'oneTime' ? 'single' : 'periodic');
  const formId = task.id ? 'editTask' : 'createTask';
  const commonStart = `<form id="${formId}" data-task-type="${type}">
    <input type="hidden" name="scheduleType" value="${type === 'single' ? 'oneTime' : 'weekly'}">
    <label>${type === 'single' ? '任务名称' : '任务模板名称'}</label><input name="name" value="${escapeHtml(task.name || '')}" required>
    <label>描述</label><textarea name="description">${escapeHtml(task.description || '')}</textarea>
    <label>所属赛道</label><select name="trackId">${tracks.map((track) => `<option value="${track.id}" ${track.id === task.trackId ? 'selected' : ''}>${escapeHtml(track.name)}</option>`).join('')}</select>`;
  const scheduleFields = type === 'single'
    ? `<label>开始日期和时间</label><input name="startAt" type="datetime-local" value="${escapeHtml((task.startAt || '').slice(0, 16))}" required>
       <label>截止日期和时间</label><input name="endAt" type="datetime-local" value="${escapeHtml((task.endAt || '').slice(0, 16))}" required>`
    : `<label>周期开始日期</label><input name="activeStartDate" type="date" value="${escapeHtml(task.activeStartDate || todayKey)}" required>
       <label>周期结束日期</label><input name="activeEndDate" type="date" value="${escapeHtml(task.activeEndDate || nextWeek)}" required>
       <fieldset class="weekday-picker"><legend>周一至周日多选</legend>${['一','二','三','四','五','六','日'].map((label, index) =>
         `<label><input type="checkbox" name="weekdays" value="${index + 1}" ${(task.weekdays || [1,3,5]).includes(index + 1) ? 'checked' : ''}><span>周${label}</span></label>`).join('')}</fieldset>
       <label>每日开放时间</label><input name="dailyStart" type="time" value="${task.dailyStart || '00:00'}" required>
       <label>每日截止时间</label><input name="dailyEnd" type="time" value="${task.dailyEnd || '23:59'}" required>`;
  return `${commonStart}${scheduleFields}
    <label>图片数量限制</label><input name="imageLimit" type="number" min="1" max="3" value="${Math.min(task.imageLimit || 3, 3)}" required>
    <label>文案要求</label><textarea name="copyRequirement">${escapeHtml(task.copyRequirement || '')}</textarea>
    ${task.id ? `<label>任务状态</label><select name="status">${[['draft','草稿'],['published','发布'],['closed','关闭'],['archived','归档']].map(([value,label]) => `<option value="${value}" ${task.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select>` : '<input type="hidden" name="status" value="published">'}
    <button>${task.id ? '保存修改' : type === 'single' ? '发布任务' : '保存周期任务'}</button>
  </form>`;
}

function taskPayload(form) {
  const values = Object.fromEntries(new FormData(form));
  const weekdays = [...form.querySelectorAll('input[name="weekdays"]:checked')].map((input) => Number(input.value));
  if (form.dataset.taskType === 'periodic' && !weekdays.length) throw new Error('周期任务至少选择一个星期');
  if (form.dataset.taskType === 'periodic' && values.dailyStart >= values.dailyEnd) {
    throw new Error('每日截止时间必须晚于每日开放时间');
  }
  return {
    ...values,
    allowLate: false,
    imageLimit: Number(values.imageLimit),
    weekdays,
    refreshDays: [],
    activeStartDate: values.activeStartDate || '',
    activeEndDate: values.activeEndDate || '',
    dailyStart: values.dailyStart || '',
    dailyEnd: values.dailyEnd || '',
    startAt: values.startAt || '',
    endAt: values.endAt || ''
  };
}

function openTaskCreator(type, date) {
  const root = document.querySelector('#modalRoot');
  const title = type === 'single' ? '创建单次任务' : '创建周期任务';
  root.innerHTML = `<div class="modal-backdrop task-page-backdrop"><section class="card modal task-editor">
    <div class="row"><div><small class="muted">活动任务</small><h2>${title}</h2></div><button id="closeTask" class="secondary right">关闭</button></div>
    ${taskFormFields({}, type)}
  </section></div>`;
  document.querySelector('#closeTask').onclick = () => { root.innerHTML = ''; };
  document.querySelector('#createTask').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api('/api/admin/tasks', { method: 'POST', body: JSON.stringify(taskPayload(event.target)) });
      root.innerHTML = '';
      await admin(date);
      alert(type === 'single' ? '单次任务已发布' : '周期任务已保存');
    } catch (error) { alert(error.message); }
  };
}

function editTask(task, date) {
  const root = document.querySelector('#modalRoot');
  root.innerHTML = `<div class="modal-backdrop"><section class="card modal"><div class="row"><h2>编辑任务</h2><button id="closeTask" class="secondary right">关闭</button></div>${taskFormFields(task)}</section></div>`;
  document.querySelector('#closeTask').onclick = () => { root.innerHTML = ''; };
  document.querySelector('#editTask').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api(`/api/admin/tasks/${task.id}`, { method: 'PUT', body: JSON.stringify(taskPayload(event.target)) });
      admin(date);
    } catch (error) { alert(error.message); }
  };
}

function editTeam(team, date) {
  const root = document.querySelector('#modalRoot');
  root.innerHTML = `
    <div class="modal-backdrop">
      <section class="card modal">
        <div class="row"><h2>修改队伍</h2><button class="secondary right" id="closeTeamModal">关闭</button></div>
        <form id="editTeam">
          <label>队伍名称</label><input name="name" value="${escapeHtml(team.name)}" required>
          <label>人数限制</label><input name="memberLimit" type="number" min="${team.memberCount}" max="20" value="${team.memberLimit}" required>
          <p class="muted">当前 ${team.memberCount} 名成员，人数限制不能低于当前成员数。</p>
          <button>保存修改</button>
        </form>
      </section>
    </div>`;
  document.querySelector('#closeTeamModal').onclick = () => {
    root.innerHTML = '';
  };
  document.querySelector('#editTeam').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api(`/api/admin/teams/${team.id}`, {
        method: 'PUT',
        body: JSON.stringify(Object.fromEntries(new FormData(event.target)))
      });
      alert('队伍已更新');
      admin(date);
    } catch (error) {
      alert(error.message);
    }
  };
}

function editUser(studentUser, date) {
  const root = document.querySelector('#modalRoot');
  root.innerHTML = `
    <div class="modal-backdrop">
      <section class="card modal">
        <div class="row"><h2>编辑用户</h2><button class="secondary right" id="closeModal">关闭</button></div>
        <form id="editUser">
          <label>姓名</label><input name="name" value="${escapeHtml(studentUser.name)}" required>
          <label>学号</label><input name="studentId" value="${escapeHtml(studentUser.studentId)}" required>
          <label>校区</label><input name="campus" value="${escapeHtml(studentUser.campus)}" required>
          <label>所属赛道</label><select name="trackId">${tracks.map((track) => `<option value="${track.id}" ${track.id === studentUser.trackId ? 'selected' : ''}>${escapeHtml(track.name)}</option>`).join('')}</select>
          <label>账号状态</label><select name="status"><option value="active" ${studentUser.status === 'active' ? 'selected' : ''}>启用</option><option value="disabled" ${studentUser.status === 'disabled' ? 'selected' : ''}>禁用</option></select>
          <label>新密码（不修改请留空）</label><input name="password" type="password">
          <button>保存修改</button>
        </form>
      </section>
    </div>`;
  document.querySelector('#closeModal').onclick = () => {
    root.innerHTML = '';
  };
  document.querySelector('#editUser').onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api(`/api/admin/users/${studentUser.id}`, {
        method: 'PUT',
        body: JSON.stringify(Object.fromEntries(new FormData(event.target)))
      });
      alert('用户资料已更新');
      admin(date);
    } catch (error) {
      alert(error.message);
    }
  };
}

function reviewCheckin(students, checkinId, date) {
  let checkin;
  for (const studentUser of students) {
    checkin = studentUser.slots.find((item) => item && item.id === checkinId);
    if (checkin) break;
  }
  const root = document.querySelector('#modalRoot');
  const reviewImage = (media, index, alt) => {
    const thumbUrl = typeof media === 'string' ? media : media.thumbUrl || media.imageUrl;
    const displayUrl = typeof media === 'string' ? media : media.displayUrl || thumbUrl;
    return `<button class="image-viewer-trigger" data-image-viewer="${escapeHtml(thumbUrl)}"
      data-image-thumb="${escapeHtml(thumbUrl)}" data-image-display="${escapeHtml(displayUrl)}"
      data-image-alt="${escapeHtml(alt)}"><span class="image-shell">
      <img data-src="${escapeHtml(thumbUrl)}" loading="${index === 0 ? 'eager' : 'lazy'}"
        data-priority="${index === 0 ? 'high' : ''}" fetchpriority="${index === 0 ? 'high' : 'low'}"
        decoding="async" width="480" height="360" alt="${escapeHtml(alt)}"
        onload="this.parentElement.classList.add('loaded')"
        onerror="this.hidden=true;this.parentElement.classList.add('failed')">
      <span class="image-error">图片加载失败</span></span></button>`;
  };
  root.innerHTML = `
    <div class="modal-backdrop">
      <section class="card modal">
        <div class="row"><h2>审核材料</h2><button class="secondary right" id="closeReview">关闭</button></div>
    <div class="photos">${checkin.photos.map((photo, index) => reviewImage(photo, index, '打卡截图')).join('')}${checkin.summary ? reviewImage(checkin.summary, checkin.photos.length, '汇总截图') : ''}</div>
        <p>${escapeHtml(checkin.note || '无备注')}</p>
        <button id="approve">通过</button> <button class="danger" id="reject">驳回</button>
      </section>
    </div>`;
  prepareDynamicContent(root);
  document.querySelector('#closeReview').onclick = () => {
    root.innerHTML = '';
  };
  const update = async (status) => {
    try {
      await api(`/api/admin/checkins/${checkinId}`, {
        method: 'PUT',
        body: JSON.stringify({ status })
      });
      admin(date);
    } catch (error) {
      alert(error.message);
    }
  };
  document.querySelector('#approve').onclick = () => update('approved');
  document.querySelector('#reject').onclick = () => update('rejected');
}

const installPerfDiagnostics = () => {
  let enabled = false;
  try { enabled = new URLSearchParams(location.search).get('debugPerf') === '1' || localStorage.getItem('debugPerf') === '1'; } catch {}
  if (!enabled || document.querySelector('#perfDiagnosticsButton')) return;
  const button = document.createElement('button');
  button.id = 'perfDiagnosticsButton';
  button.type = 'button';
  button.textContent = '性能数据';
  button.onclick = () => {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
    const payload = { capturedAt: new Date().toISOString(), userAgent: navigator.userAgent, viewport: `${innerWidth}x${innerHeight}`, devicePixelRatio, network: { effectiveType: connection.effectiveType || '', downlink: connection.downlink || 0, rtt: connection.rtt || 0, saveData: Boolean(connection.saveData) }, metrics: window.__PERF_METRICS__ || [] };
    let root = document.querySelector('#perfDiagnosticsRoot');
    if (!root) { root = document.createElement('div'); root.id = 'perfDiagnosticsRoot'; document.body.append(root); }
    root.innerHTML = `<div class="perf-diagnostics-backdrop"><section class="perf-diagnostics-card"><div class="row"><h2>实体设备性能数据</h2><button type="button" class="secondary" data-perf-close>关闭</button></div><textarea readonly>${escapeHtml(JSON.stringify(payload, null, 2))}</textarea><button type="button" data-perf-copy>复制数据</button><button type="button" class="secondary" data-perf-clear>清空后重测</button></section></div>`;
    root.querySelector('[data-perf-close]').onclick = () => { root.innerHTML = ''; };
    root.querySelector('[data-perf-copy]').onclick = async () => { try { await navigator.clipboard.writeText(JSON.stringify(payload, null, 2)); showToast('性能数据已复制'); } catch { root.querySelector('textarea').select(); document.execCommand('copy'); showToast('性能数据已复制'); } };
    root.querySelector('[data-perf-clear]').onclick = () => { window.__PERF_METRICS__ = []; activePhotoFlow = null; root.innerHTML = ''; showToast('已清空，请重新打开目标页面测试'); };
  };
  document.body.append(button);
};
setTimeout(installPerfDiagnostics, 0);

window.__ADMIN_CLIENT_RENDER__ = (selectedDate, pageEpoch) => admin(selectedDate, pageEpoch);
