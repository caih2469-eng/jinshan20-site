import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* CHECKIN_WINDOW_UPLOAD_PLAZA_PAGE_V1 */';

const read = (relativePath) => {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) throw new Error(`${relativePath}不存在`);
  return { file, source: fs.readFileSync(file, 'utf8') };
};
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');
const replaceOnce = (source, search, replacement, label) => {
  if (!source.includes(search)) throw new Error(`未找到${label}，已停止以避免误改`);
  return source.replace(search, replacement);
};
const findTopLevelDeclaration = (source, fromIndex) => {
  const pattern = /^(?:async\s+function|function|const|let|class)\s+[A-Za-z_$][\w$]*/gm;
  pattern.lastIndex = Math.max(0, fromIndex);
  return pattern.exec(source)?.index ?? -1;
};
const replaceTopLevelDeclaration = (source, startAnchor, transform, label) => {
  const start = source.indexOf(startAnchor);
  const end = start >= 0 ? findTopLevelDeclaration(source, start + 1) : -1;
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`${label}顶层边界未找到，已停止以避免误改（start=${start}, end=${end}）`);
  }
  const before = source.slice(0, start);
  const section = source.slice(start, end);
  const after = source.slice(end);
  const nextSection = transform(section);
  if (nextSection === section) throw new Error(`${label}没有产生修改，已停止`);
  return `${before}${nextSection.trimEnd()}\n\n${after}`;
};

{
  const { file, source } = read('cloudflare/lib/runtime.js');
  if (!source.includes(marker)) {
    let next = source;
    if (!next.includes('const checkinSettings = values.checkinSettings || {};')) {
      next = replaceOnce(
        next,
        "  const values = Object.fromEntries(results.map((item) => [item.key, parseJson(item.valueJson)]));\n  return {",
        "  const values = Object.fromEntries(results.map((item) => [item.key, parseJson(item.valueJson)]));\n  const checkinSettings = values.checkinSettings || {};\n  return {",
        '四校区打卡设置读取变量'
      );
    }
    if (!next.includes('    checkinSettings: {')) {
      next = replaceOnce(
        next,
        "    allowSelfJoin: Boolean(values.allowSelfJoin),\n    environment: env.ENVIRONMENT || 'unknown'",
        [
          "    allowSelfJoin: Boolean(values.allowSelfJoin),",
          "    checkinSettings: {",
          "      enabled: checkinSettings.enabled !== false && values.trackEnabled?.interaction !== false,",
          "      activeStartDate: checkinSettings.activeStartDate || values.startDate || '',",
          "      activeEndDate: checkinSettings.activeEndDate || values.endDate || '',",
          "      dailyStart: checkinSettings.dailyStart || '00:00',",
          "      dailyEnd: checkinSettings.dailyEnd || '23:59',",
          "      weekdays: Array.isArray(checkinSettings.weekdays) && checkinSettings.weekdays.length",
          "        ? checkinSettings.weekdays.map(Number).filter((day) => day >= 1 && day <= 7)",
          "        : [1, 2, 3, 4, 5, 6, 7],",
          "      personalImageLimit: Math.min(8, Math.max(1, Number(checkinSettings.personalImageLimit || 3))),",
          "      teamImageLimit: Math.min(8, Math.max(1, Number(checkinSettings.teamImageLimit || 3)))",
          "    },",
          "    environment: env.ENVIRONMENT || 'unknown'"
        ].join('\n'),
        '四校区打卡设置返回值'
      );
    }
    write(file, `${marker}\n${next}`);
  }
}

{
  const { file, source } = read('cloudflare/services/student-dashboard.js');
  if (!source.includes(marker)) {
    let next = source;
    if (!next.includes('export const applyInteractionCheckinSettings = (task, config) => {')) {
      const helper = [
        marker,
        'export const applyInteractionCheckinSettings = (task, config) => {',
        "  if (!task || task.trackId !== 'interaction') return task;",
        '  const settings = config?.checkinSettings || {};',
        '  const existing = task.scheduleJson ? parseJson(task.scheduleJson, {}) : {};',
        '  const activeStartDate = settings.activeStartDate || existing.activeStartDate || config?.startDate || shanghaiDate();',
        '  const activeEndDate = settings.activeEndDate || existing.activeEndDate || config?.endDate || activeStartDate;',
        "  const dailyStart = settings.dailyStart || existing.dailyStart || '00:00';",
        "  const dailyEnd = settings.dailyEnd || existing.dailyEnd || '23:59';",
        '  const weekdays = Array.isArray(settings.weekdays) && settings.weekdays.length',
        '    ? settings.weekdays.map(Number).filter((day) => day >= 1 && day <= 7)',
        '    : (Array.isArray(existing.weekdays) && existing.weekdays.length',
        '      ? existing.weekdays.map(Number).filter((day) => day >= 1 && day <= 7)',
        '      : [1, 2, 3, 4, 5, 6, 7]);',
        '  const schedule = {',
        "    scheduleType: 'weekly',",
        '    activeStartDate,',
        '    activeEndDate,',
        '    dailyStart,',
        '    dailyEnd,',
        '    weekdays,',
        '    refreshDays: []',
        '  };',
        '  return {',
        '    ...task,',
        '    checkinEnabled: settings.enabled !== false,',
        '    imageLimit: Math.min(8, Math.max(1, Number(settings.teamImageLimit || task.imageLimit || 3))),',
        '    memberImageLimit: Math.min(8, Math.max(1, Number(settings.personalImageLimit || task.imageLimit || 1))),',
        '    scheduleJson: JSON.stringify(schedule),',
        '    startsAt: `${activeStartDate}T${dailyStart}:00+08:00`,',
        '    endsAt: `${activeEndDate}T${dailyEnd}:00+08:00`',
        '  };',
        '};',
        ''
      ].join('\n');
      next = replaceOnce(
        next,
        'export const buildStudentTasks = async (env, user, options = {}) => {',
        `${helper}export const buildStudentTasks = async (env, user, options = {}) => {`,
        '统一四校区打卡时段帮助函数位置'
      );
    }
    if (!next.includes("export const taskWindowOpen = (task, occurrenceDate = '', makeupAllowed = false) => {\n  if (task?.checkinEnabled === false) return false;")) {
      next = replaceOnce(
        next,
        "export const taskWindowOpen = (task, occurrenceDate = '', makeupAllowed = false) => {\n  if (!isTaskOccurrence(task, occurrenceDate)) return false;",
        "export const taskWindowOpen = (task, occurrenceDate = '', makeupAllowed = false) => {\n  if (task?.checkinEnabled === false) return false;\n  if (!isTaskOccurrence(task, occurrenceDate)) return false;",
        '关闭打卡开关校验'
      );
    }
    if (!next.includes(marker)) next = `${marker}\n${next}`;
    write(file, next);
  }
}

{
  const { file, source } = read('cloudflare/routes/student.js');
  if (!source.includes(marker)) {
    let next = source;
    if (!next.includes('applyInteractionCheckinSettings')) {
      next = replaceOnce(
        next,
        '  mapWithConcurrency,\n  submissionImagesForIds',
        '  mapWithConcurrency,\n  submissionImagesForIds,\n  applyInteractionCheckinSettings',
        '学生路由四校区设置函数导入'
      );
    }
    const memberStart = next.indexOf('  const memberMatch = route.match');
    const memberEnd = next.indexOf('  const submissionMatch = route.match', memberStart);
    if (memberStart < 0 || memberEnd < 0) throw new Error('未找到个人打卡路由边界');
    let section = next.slice(memberStart, memberEnd);
    if (!section.includes('const effectiveTask = applyInteractionCheckinSettings(task, taskConfig);')) {
      section = replaceOnce(
        section,
        "    if (!task || task.status !== 'published' || task.trackId !== 'interaction') return json({ error: '任务不存在' }, 404);\n    const body = await readJson(request);",
        "    if (!task || task.status !== 'published' || task.trackId !== 'interaction') return json({ error: '任务不存在' }, 404);\n    const taskConfig = await readConfig(env);\n    const effectiveTask = applyInteractionCheckinSettings(task, taskConfig);\n    const body = await readJson(request);",
        '个人打卡最新后台时段读取'
      );
    }
    section = section.replaceAll('taskWindowOpen(task, occurrenceDate', 'taskWindowOpen(effectiveTask, occurrenceDate');
    next = `${next.slice(0, memberStart)}${section}${next.slice(memberEnd)}`;
    write(file, `${marker}\n${next}`);
  }
}

{
  const { file, source } = read('cloudflare/routes/media.js');
  if (!source.includes(marker)) {
    let next = source;
    if (!/\breadConfig\b/.test(next.slice(0, next.indexOf("from '../lib/runtime.js'")))) {
      next = replaceOnce(next, '  readJson,\n  requireUser,', '  readConfig,\n  readJson,\n  requireUser,', '媒体路由readConfig导入');
    }
    if (!next.includes('applyInteractionCheckinSettings')) {
      next = replaceOnce(
        next,
        "import { taskWindowOpen, teamForUser } from '../services/student-dashboard.js';",
        "import { applyInteractionCheckinSettings, taskWindowOpen, teamForUser } from '../services/student-dashboard.js';",
        '媒体路由四校区设置函数导入'
      );
    }
    next = replaceTopLevelDeclaration(next, 'const memberFastUpload = async', (section) => {
      let changed = section;
      if (!changed.includes('const [task, team, taskConfig] = await Promise.all([')) {
        const oldLoad = [
          '  const task = await env.DB.prepare(',
          '    `SELECT id,track_id AS trackId,submission_type AS submissionType,',
          '            starts_at AS startsAt,ends_at AS endsAt,schedule_json AS scheduleJson,status',
          '       FROM tasks WHERE id=?1 LIMIT 1`',
          '  ).bind(taskId).first();'
        ].join('\n');
        const parallelLoad = [
          '  const [task, team, taskConfig] = await Promise.all([',
          '    env.DB.prepare(',
          '      `SELECT id,track_id AS trackId,submission_type AS submissionType,',
          '              starts_at AS startsAt,ends_at AS endsAt,schedule_json AS scheduleJson,status',
          '         FROM tasks WHERE id=?1 LIMIT 1`',
          '    ).bind(taskId).first(),',
          '    teamForUser(env, auth.user.id),',
          '    readConfig(env)',
          '  ]);'
        ].join('\n');
        const alreadyEffective = changed.includes('const effectiveTask = applyInteractionCheckinSettings(task, taskConfig);');
        changed = replaceOnce(changed, oldLoad, parallelLoad, '个人打卡fast并行读取任务/队伍/设置');
        if (alreadyEffective) {
          changed = changed.replace('  const taskConfig = await readConfig(env);\n', '');
          changed = changed.replace('  const team = await teamForUser(env, auth.user.id);\n', '');
        } else {
          changed = replaceOnce(
            changed,
            "  const team = await teamForUser(env, auth.user.id);\n  if (!team) return json({ error: '尚未分配队伍，不能上传队伍打卡图片' }, 403);",
            "  if (!team) return json({ error: '尚未分配队伍，不能上传队伍打卡图片' }, 403);\n  const effectiveTask = applyInteractionCheckinSettings(task, taskConfig);",
            '个人打卡fast有效时段任务'
          );
        }
      }
      changed = changed.replaceAll('taskWindowOpen(task, occurrenceDate', 'taskWindowOpen(effectiveTask, occurrenceDate');
      return changed;
    }, '个人打卡fast上传函数');
    write(file, `${marker}\n${next}`);
  }
}

{
  const { file, source } = read('public/app.js');
  if (!source.includes(marker)) {
    let next = source;
    next = replaceTopLevelDeclaration(next, 'const compressMemberCheckinImage = async', (section) => {
      if (section.includes('member-checkin-direct-ready')) return section;
      return replaceOnce(
        section,
        '  const sourceFile = await normalizeSourceImage(file);\n  const imageCompression = await loadImageCompressionLibrary();',
        [
          '  const sourceFile = await normalizeSourceImage(file);',
          '  const sourceDimensions = await imageDimensions(sourceFile);',
          "  if (['image/jpeg', 'image/webp'].includes(sourceFile.type)",
          '      && sourceFile.size <= MEMBER_FAST_MAX_BYTES',
          '      && sourceDimensions.width > 0 && sourceDimensions.height > 0',
          '      && Math.max(sourceDimensions.width, sourceDimensions.height) <= MEMBER_FAST_MAX_EDGE) {',
          "    recordPerf('member-checkin-direct-ready', {",
          '      sourceBytes: Number(sourceFile.size || 0),',
          '      navigationEpoch',
          '    });',
          '    return {',
          '      file: sourceFile,',
          '      mimeType: sourceFile.type,',
          '      width: sourceDimensions.width,',
          '      height: sourceDimensions.height',
          '    };',
          '  }',
          '  const imageCompression = await loadImageCompressionLibrary();'
        ].join('\n'),
        '符合fast规格图片免重复压缩'
      );
    }, '个人打卡图片压缩函数');

    const plazaWarmAnchor = '  requestAnimationFrame(() => { setTimeout(startPlazaPrefetch, 0); });';
    if (!next.includes('memberUploadWarmup')) {
      next = replaceOnce(
        next,
        plazaWarmAnchor,
        [
          plazaWarmAnchor,
          '  // Do not compete with the first-second Plaza budget. Warm the upload compressor',
          '  // immediately after that window so opening Personal Check-in is no longer cold.',
          '  setTimeout(() => {',
          '    const memberUploadWarmup = () => { void loadImageCompressionLibrary().catch(() => {}); };',
          "    if ('requestIdleCallback' in window) requestIdleCallback(memberUploadWarmup, { timeout: 700 });",
          '    else memberUploadWarmup();',
          '  }, 1100);'
        ].join('\n'),
        '学生首页个人打卡压缩器预热'
      );
    }

    next = replaceTopLevelDeclaration(next, 'async function openPlazaPost', (section) => {
      let changed = section;
      changed = replaceOnce(
        changed,
        "  const root = document.querySelector('#modalRoot');\n  if (!root) return;",
        [
          '  const root = app;',
          '  const listUrl = new URL(location.href);',
          "  listUrl.searchParams.delete('plazaPost');",
          '  const plazaScrollY = window.scrollY;',
          '  const listState = {',
          "    ...(history.state || {}), plazaList: true, plazaDetail: false,",
          '    plazaSort: sort, plazaPage: page, plazaMonth: month, plazaScrollY',
          '  };',
          "  history.replaceState(listState, '', listUrl);",
          '  const detailUrl = new URL(listUrl);',
          "  detailUrl.searchParams.set('plazaPost', postId);",
          "  history.pushState({ ...listState, plazaList: false, plazaDetail: true, plazaPost: postId }, '', detailUrl);",
          "  document.body.dataset.view = 'plaza-detail';"
        ].join('\n'),
        '活动广场详情页面根节点'
      );
      changed = changed.replace('  const modalEpoch = ++plazaModalEpoch;\n  const plazaScrollY = window.scrollY;\n', '  const modalEpoch = ++plazaModalEpoch;\n');
      const closePattern = /  const closePost = \(\) => \{[\s\S]*?\n  \};/;
      const closeMatch = changed.match(closePattern);
      if (!closeMatch) throw new Error('未找到活动广场详情关闭函数');
      changed = changed.replace(closePattern, [
        '  const closePost = () => {',
        '    if (modalEpoch !== plazaModalEpoch) return;',
        '    plazaModalEpoch += 1;',
        '    history.back();',
        '  };'
      ].join('\n'));
      changed = changed.replaceAll('<div class="modal-backdrop"><section class="card modal plaza-detail', '<section class="card plaza-detail plaza-detail-page');
      changed = changed.replaceAll('</section></div>`;', '</section>`;');
      changed = changed.replaceAll('id="closePost">关闭</button>', 'id="closePost">返回</button>');
      return changed;
    }, '活动广场详情页面函数');

    if (!next.includes('const restorePlazaListFromHistory = (state) => {')) {
      const historyHelper = [
        marker,
        'const restorePlazaListFromHistory = (state) => {',
        '  if (!state?.plazaList) return false;',
        "  document.body.dataset.view = 'plaza';",
        "  const sort = state.plazaSort || 'latest';",
        '  const page = Math.max(1, Number(state.plazaPage || 1));',
        "  const month = state.plazaMonth || '';",
        '  const scrollY = Math.max(0, Number(state.plazaScrollY || 0));',
        '  void plaza(sort, page, month, { preserveScroll: false })',
        '    .then(() => requestAnimationFrame(() => window.scrollTo(0, scrollY)))',
        "    .catch((error) => { showToast(error.message || '活动广场加载失败', 'error'); });",
        '  return true;',
        '};',
        "window.addEventListener('popstate', (event) => {",
        "  if (document.body.dataset.view === 'plaza-detail' && event.state?.plazaList) {",
        '    restorePlazaListFromHistory(event.state);',
        '  }',
        '});',
        ''
      ].join('\n');
      next = replaceOnce(next, 'async function openPlazaPost', `${historyHelper}async function openPlazaPost`, '活动广场返回历史恢复函数');
    }

    if (!next.includes(marker)) next = `${marker}\n${next}`;
    if (!next.includes('plaza-detail-page') || next.includes('<div class="modal-backdrop"><section class="card modal plaza-detail')) {
      throw new Error('活动广场详情仍存在浮窗结构');
    }
    write(file, next);
  }
}

{
  const { file, source } = read('public/style.css');
  if (!source.includes(marker)) {
    const css = `\n\n${marker}\nbody[data-view="plaza-detail"] #app{max-width:980px;margin:0 auto;padding-bottom:32px}\n.plaza-detail-page{position:static!important;inset:auto!important;transform:none!important;width:min(100%,960px)!important;max-width:960px!important;max-height:none!important;overflow:visible!important;margin:18px auto 32px!important}\n.plaza-detail-page .row:first-child{position:sticky;top:0;z-index:8;padding:10px 0;background:rgba(255,255,255,.94);backdrop-filter:blur(12px)}\n@media(max-width:720px){body[data-view="plaza-detail"] #app{padding:0 12px 28px}.plaza-detail-page{margin:8px auto 24px!important;border-radius:20px!important}}\n`;
    write(file, source + css);
  }
}

{
  const runtime = read('cloudflare/lib/runtime.js').source;
  const dashboard = read('cloudflare/services/student-dashboard.js').source;
  const student = read('cloudflare/routes/student.js').source;
  const media = read('cloudflare/routes/media.js').source;
  const app = read('public/app.js').source;
  const style = read('public/style.css').source;
  const memberStart = student.indexOf('  const memberMatch = route.match');
  const memberEnd = student.indexOf('  const submissionMatch = route.match', memberStart);
  const memberRoute = student.slice(memberStart, memberEnd);
  const mediaStart = media.indexOf('const memberFastUpload = async');
  const mediaEnd = findTopLevelDeclaration(media, mediaStart + 1);
  const fastUpload = media.slice(mediaStart, mediaEnd > mediaStart ? mediaEnd : undefined);
  const detailStart = app.indexOf('async function openPlazaPost');
  const detailEnd = findTopLevelDeclaration(app, detailStart + 1);
  const detail = app.slice(detailStart, detailEnd > detailStart ? detailEnd : undefined);

  if (!runtime.includes('checkinSettings: {')
      || !dashboard.includes('applyInteractionCheckinSettings')
      || !memberRoute.includes('taskWindowOpen(effectiveTask, occurrenceDate')
      || !fastUpload.includes('const [task, team, taskConfig] = await Promise.all([')
      || !fastUpload.includes('taskWindowOpen(effectiveTask, occurrenceDate')
      || !app.includes("recordPerf('member-checkin-direct-ready'")
      || !app.includes('}, 1100);')
      || !detail.includes('const root = app;')
      || !detail.includes('plaza-detail-page')
      || detail.includes('modal-backdrop')
      || !style.includes('.plaza-detail-page')) {
    throw new Error('打卡时段、上传提速或活动广场独立页面修复生成不完整');
  }
}

console.log('Applied check-in window alignment, member-upload warm/fast path and full-page Plaza detail V1.');
