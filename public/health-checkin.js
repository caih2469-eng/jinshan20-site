/* HEALTH_CLIENT_CHECKIN_MODULE_V1 */
(() => {
  const healthClientVersion = 'health-client-checkin-v1';
  let healthRequestEpoch = 0;
  let healthDataVersion = 0;

  const healthDashboard = () => studentViewState?.data || null;
  const healthSettingsFor = (dashboard) => dashboard?.config?.healthCheckinSettings || {};
  const healthSlotsFor = (dashboard) => {
    const settings = healthSettingsFor(dashboard);
    return Array.isArray(settings.slots) && settings.slots.length
      ? settings.slots
      : (Array.isArray(dashboard?.config?.slots) ? dashboard.config.slots : []);
  };
  const shanghaiTimeNow = () => new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date());

  const openHealthClientCheckinForm = (slotId) => {
    const dashboard = healthDashboard();
    const settings = healthSettingsFor(dashboard);
    const slots = healthSlotsFor(dashboard);
    const slot = slots.find((item) => item.id === slotId);
    const photoLimit = Math.min(8, Math.max(1, Number(settings.personalImageLimit || 3)));
    if (!slot) {
      alert('当前餐次设置不存在，请联系管理员。');
      return;
    }
    beginNavigation();
    app.innerHTML = `
      <header class="hero"><h1>${escapeHtml(slot.label)}打卡</h1><p>${escapeHtml(slot.start)}–${escapeHtml(slot.end)}，请上传水印相机截图。</p></header>
      <section class="card">
        <form id="healthClientCheckinForm">
          <label>餐食水印截图（可多选，最多 ${photoLimit} 张）</label><input required name="photos" type="file" accept="image/*" multiple>
          <label>Elavatine 当日汇总截图（可选）</label><input name="summary" type="file" accept="image/*">
          <label>备注（可选）</label><textarea name="note"></textarea>
          <div class="row"><button type="button" class="secondary" id="healthClientBack">返回</button><button>上传并提交</button></div>
        </form>
      </section>`;
    document.querySelector('#healthClientBack').onclick = () => home();
    document.querySelector('#healthClientCheckinForm').onsubmit = async (event) => {
      event.preventDefault();
      const form = event.target;
      const submitButton = event.submitter || form.querySelector('button:not([type="button"])');
      const restoreButton = beginButtonLoading(submitButton, '正在提交…');
      try {
        const photos = await readFiles(form.photos.files, {
          businessType: 'meal-checkin',
          limit: photoLimit
        });
        const summary = form.summary.files[0]
          ? (await readFiles(form.summary.files, { businessType: 'meal-checkin', limit: 1 }))[0]
          : null;
        const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
        await api('/api/checkins', {
          method: 'POST',
          body: JSON.stringify({
            date,
            slotId,
            photoMediaIds: photos.map((item) => item.mediaId),
            summaryMediaId: summary?.mediaId || null,
            note: form.note.value
          })
        });
        healthDataVersion += 1;
        studentViewState.dirty = true;
        returnToCachedStudentHome('个人打卡成功');
        scheduleHealthClientRender();
      } catch (error) {
        restoreButton();
        alert(error.message);
      }
    };
  };

  const renderHealthClientCheckin = async () => {
    const dashboard = healthDashboard();
    if (user?.role !== 'student' || user.trackId !== 'health' || !dashboard?.date) return;
    const section = document.querySelector('#activityTasks');
    if (!section || !app.contains(section)) return;
    const settings = healthSettingsFor(dashboard);
    const slots = healthSlotsFor(dashboard);
    const renderKey = [
      healthClientVersion,
      user.id,
      dashboard.date,
      healthDataVersion,
      settings.enabled !== false,
      settings.activeStartDate || '',
      settings.activeEndDate || '',
      (settings.weekdays || []).join(','),
      slots.map((slot) => `${slot.id}:${slot.start}-${slot.end}`).join('|'),
      settings.personalImageLimit || 3
    ].join('::');
    if (section.dataset.healthClientReady === renderKey
        || section.dataset.healthClientLoading === renderKey) return;
    section.dataset.healthClientLoading = renderKey;
    const requestEpoch = ++healthRequestEpoch;
    let checkins;
    try {
      const result = await api(`/api/checkins?date=${encodeURIComponent(dashboard.date)}`);
      checkins = Array.isArray(result.checkins) ? result.checkins : [];
    } catch (error) {
      if (requestEpoch !== healthRequestEpoch || !app.contains(section)) return;
      section.innerHTML = `<div class="row"><h2>今日打卡</h2><span class="right muted">加载失败</span></div><p class="bad">${escapeHtml(error.message || '打卡信息加载失败，请刷新后重试。')}</p>`;
      section.dataset.healthClientReady = renderKey;
      delete section.dataset.healthClientLoading;
      return;
    }
    if (requestEpoch !== healthRequestEpoch || !app.contains(section)
        || healthDashboard()?.date !== dashboard.date) return;

    const weekday = new Date(`${dashboard.date}T12:00:00+08:00`).getUTCDay() || 7;
    const currentTime = shanghaiTimeNow();
    const trackOpen = Boolean(
      dashboard.config.activityEnabled
      && dashboard.config.trackEnabled?.health
      && settings.enabled !== false
    );
    const dateOpen = (!settings.activeStartDate || dashboard.date >= settings.activeStartDate)
      && (!settings.activeEndDate || dashboard.date <= settings.activeEndDate);
    const weekdayOpen = !Array.isArray(settings.weekdays)
      || !settings.weekdays.length || settings.weekdays.includes(weekday);
    const globalError = !trackOpen
      ? '健康自律赛道当前未开放'
      : !dateOpen
        ? '当前不在健康自律赛道活动日期内'
        : !weekdayOpen
          ? '今天不开放健康自律赛道打卡'
          : '';
    const statusNames = { pending: '待审核', approved: '已通过', rejected: '未通过' };
    const completed = slots.filter((slot) => checkins.some((item) => item.slotId === slot.id)).length;
    const cards = slots.map((slot) => {
      const checkin = checkins.find((item) => item.slotId === slot.id) || null;
      const timeError = currentTime < slot.start
        ? `${slot.label}打卡将于 ${slot.start} 开始`
        : currentTime > slot.end
          ? `${slot.label}打卡已于 ${slot.end} 结束`
          : '';
      const availabilityError = globalError || timeError;
      return `
        <article class="slot activity-task-card">
          <span class="task-kicker">健康自律</span>
          <div class="row"><h2>${escapeHtml(slot.label)}</h2><span class="pill ${checkin ? 'done' : 'pending'}">${checkin ? (statusNames[checkin.status] || '已提交') : '未打卡'}</span></div>
          <p class="task-requirement">今日 ${escapeHtml(slot.start)}–${escapeHtml(slot.end)} · 最多 ${Math.min(8, Math.max(1, Number(settings.personalImageLimit || 3)))} 张餐食图片</p>
          ${checkin?.reviewNote ? `<p class="bad">审核意见：${escapeHtml(checkin.reviewNote)}</p>` : ''}
          <button data-health-client-slot="${escapeHtml(slot.id)}" ${availabilityError ? 'disabled' : ''}>${checkin ? '更新打卡' : '开始打卡'}</button>
          ${availabilityError ? `<p class="bad">${escapeHtml(availabilityError)}</p>` : ''}
        </article>`;
    }).join('');
    section.innerHTML = `
      <div class="row"><h2>今日打卡</h2><span class="right muted">${completed}/${slots.length} 餐已提交</span></div>
      <div class="grid">${cards || '<p class="muted">管理员尚未配置健康自律餐次</p>'}</div>`;
    section.dataset.healthClientReady = renderKey;
    delete section.dataset.healthClientLoading;
    section.querySelectorAll('[data-health-client-slot]').forEach((button) => {
      button.onclick = () => openHealthClientCheckinForm(button.dataset.healthClientSlot);
    });
  };

  let healthRenderScheduled = false;
  const scheduleHealthClientRender = () => {
    if (healthRenderScheduled) return;
    healthRenderScheduled = true;
    queueMicrotask(() => {
      healthRenderScheduled = false;
      void renderHealthClientCheckin();
    });
  };

  // MutationObserver is intentionally avoided: lifecycle hooks keep the app-wide DOM performance guard intact.
  const originalHealthStudent = student;
  student = async function healthClientAwareStudent(...args) {
    const result = await originalHealthStudent(...args);
    scheduleHealthClientRender();
    return result;
  };

  const originalHealthHome = home;
  home = async function healthClientAwareHome(options = {}) {
    const result = await originalHealthHome(options);
    scheduleHealthClientRender();
    return result;
  };

  const pendingHealthRefresh = studentViewState?.refreshPromise;
  if (pendingHealthRefresh?.finally) pendingHealthRefresh.finally(scheduleHealthClientRender);
  scheduleHealthClientRender();
  setTimeout(scheduleHealthClientRender, 0);
  window.addEventListener('focus', scheduleHealthClientRender);
  window.addEventListener('pageshow', scheduleHealthClientRender);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleHealthClientRender();
  });
})();
