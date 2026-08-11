import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* CHECKIN_WINDOW_UPLOAD_PLAZA_PAGE_V1 */';
const read = (p) => ({ file: path.join(root, p), source: fs.readFileSync(path.join(root, p), 'utf8') });
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');
const replaceOnce = (source, search, replacement, label) => {
  if (!source.includes(search)) throw new Error(`未找到${label}`);
  return source.replace(search, replacement);
};
const nextTopLevel = (source, from) => {
  const re = /^(?:async\s+function|function|const|let|class)\s+[A-Za-z_$][\w$]*/gm;
  re.lastIndex = Math.max(0, from);
  return re.exec(source)?.index ?? -1;
};
const transformDecl = (source, anchor, transform, label) => {
  const start = source.indexOf(anchor);
  const end = start >= 0 ? nextTopLevel(source, start + 1) : -1;
  if (start < 0 || end < 0) throw new Error(`未找到${label}边界`);
  const section = source.slice(start, end);
  const changed = transform(section);
  if (changed === section) throw new Error(`${label}未产生修改`);
  return source.slice(0, start) + changed.trimEnd() + '\n\n' + source.slice(end);
};

{
  const { file, source } = read('cloudflare/lib/runtime.js');
  if (!source.includes(marker)) {
    let next = source;
    if (!next.includes('const checkinSettings = values.checkinSettings || {};')) {
      next = replaceOnce(next,
        "  const values = Object.fromEntries(results.map((item) => [item.key, parseJson(item.valueJson)]));\n  return {",
        "  const values = Object.fromEntries(results.map((item) => [item.key, parseJson(item.valueJson)]));\n  const checkinSettings = values.checkinSettings || {};\n  return {",
        'checkinSettings读取');
    }
    if (!next.includes('    checkinSettings: {')) {
      next = replaceOnce(next,
        "    allowSelfJoin: Boolean(values.allowSelfJoin),\n    environment: env.ENVIRONMENT || 'unknown'",
        `    allowSelfJoin: Boolean(values.allowSelfJoin),
    checkinSettings: {
      enabled: checkinSettings.enabled !== false && values.trackEnabled?.interaction !== false,
      activeStartDate: checkinSettings.activeStartDate || values.startDate || '',
      activeEndDate: checkinSettings.activeEndDate || values.endDate || '',
      dailyStart: checkinSettings.dailyStart || '00:00',
      dailyEnd: checkinSettings.dailyEnd || '23:59',
      weekdays: Array.isArray(checkinSettings.weekdays) && checkinSettings.weekdays.length
        ? checkinSettings.weekdays.map(Number).filter((day) => day >= 1 && day <= 7)
        : [1, 2, 3, 4, 5, 6, 7],
      personalImageLimit: Math.min(8, Math.max(1, Number(checkinSettings.personalImageLimit || 3))),
      teamImageLimit: Math.min(8, Math.max(1, Number(checkinSettings.teamImageLimit || 3)))
    },
    environment: env.ENVIRONMENT || 'unknown'`,
        'checkinSettings返回');
    }
    write(file, `${marker}\n${next}`);
  }
}

{
  const { file, source } = read('cloudflare/services/student-dashboard.js');
  if (!source.includes(marker)) {
    let next = source;
    if (!next.includes('export const applyInteractionCheckinSettings = (task, config) => {')) {
      const helper = `${marker}
export const applyInteractionCheckinSettings = (task, config) => {
  if (!task || task.trackId !== 'interaction') return task;
  const settings = config?.checkinSettings || {};
  const existing = task.scheduleJson ? parseJson(task.scheduleJson, {}) : {};
  const activeStartDate = settings.activeStartDate || existing.activeStartDate || config?.startDate || shanghaiDate();
  const activeEndDate = settings.activeEndDate || existing.activeEndDate || config?.endDate || activeStartDate;
  const dailyStart = settings.dailyStart || existing.dailyStart || '00:00';
  const dailyEnd = settings.dailyEnd || existing.dailyEnd || '23:59';
  const weekdays = Array.isArray(settings.weekdays) && settings.weekdays.length
    ? settings.weekdays.map(Number).filter((day) => day >= 1 && day <= 7)
    : (Array.isArray(existing.weekdays) && existing.weekdays.length
      ? existing.weekdays.map(Number).filter((day) => day >= 1 && day <= 7)
      : [1, 2, 3, 4, 5, 6, 7]);
  return {
    ...task,
    checkinEnabled: settings.enabled !== false,
    imageLimit: Math.min(8, Math.max(1, Number(settings.teamImageLimit || task.imageLimit || 3))),
    memberImageLimit: Math.min(8, Math.max(1, Number(settings.personalImageLimit || task.imageLimit || 1))),
    scheduleJson: JSON.stringify({ scheduleType: 'weekly', activeStartDate, activeEndDate, dailyStart, dailyEnd, weekdays, refreshDays: [] }),
    startsAt: \`${'${'}activeStartDate}T${'${'}dailyStart}:00+08:00\`,
    endsAt: \`${'${'}activeEndDate}T${'${'}dailyEnd}:00+08:00\`
  };
};

`;
      next = replaceOnce(next, 'export const buildStudentTasks = async (env, user, options = {}) => {', helper + 'export const buildStudentTasks = async (env, user, options = {}) => {', 'effective task helper');
    }
    if (!next.includes("task?.checkinEnabled === false")) {
      next = replaceOnce(next,
        "export const taskWindowOpen = (task, occurrenceDate = '', makeupAllowed = false) => {\n  if (!isTaskOccurrence(task, occurrenceDate)) return false;",
        "export const taskWindowOpen = (task, occurrenceDate = '', makeupAllowed = false) => {\n  if (task?.checkinEnabled === false) return false;\n  if (!isTaskOccurrence(task, occurrenceDate)) return false;",
        'checkinEnabled校验');
    }
    if (!next.includes(marker)) next = marker + '\n' + next;
    write(file, next);
  }
}

{
  const { file, source } = read('cloudflare/routes/student.js');
  if (!source.includes(marker)) {
    let next = source;
    if (!next.includes('applyInteractionCheckinSettings')) {
      next = replaceOnce(next,
        '  mapWithConcurrency,\n  submissionImagesForIds',
        '  mapWithConcurrency,\n  submissionImagesForIds,\n  applyInteractionCheckinSettings',
        'student helper import');
    }
    if (!next.includes('const effectiveTask = applyInteractionCheckinSettings(task, taskConfig);')) {
      next = replaceOnce(next,
        "    if (!task || task.status !== 'published' || task.trackId !== 'interaction') return json({ error: '任务不存在' }, 404);\n    const body = await readJson(request);",
        "    if (!task || task.status !== 'published' || task.trackId !== 'interaction') return json({ error: '任务不存在' }, 404);\n    const taskConfig = await readConfig(env);\n    const effectiveTask = applyInteractionCheckinSettings(task, taskConfig);\n    const body = await readJson(request);",
        'member effective task');
    }
    next = next.replaceAll(
      'taskWindowOpen(task, occurrenceDate, makeupAllowed)',
      'taskWindowOpen(effectiveTask, occurrenceDate, makeupAllowed)'
    );
    write(file, marker + '\n' + next);
  }
}

{
  const { file, source } = read('cloudflare/routes/media.js');
  if (!source.includes(marker)) {
    let next = source;
    if (!/\breadConfig\b/.test(next.slice(0, next.indexOf("from '../lib/runtime.js'")))) {
      next = replaceOnce(next, '  readJson,\n  requireUser,', '  readConfig,\n  readJson,\n  requireUser,', 'media readConfig import');
    }
    if (!next.includes('applyInteractionCheckinSettings')) {
      next = replaceOnce(next,
        "import { taskWindowOpen, teamForUser } from '../services/student-dashboard.js';",
        "import { applyInteractionCheckinSettings, taskWindowOpen, teamForUser } from '../services/student-dashboard.js';",
        'media helper import');
    }
    next = transformDecl(next, 'const memberFastUpload = async', (section) => {
      let changed = section;
      if (!changed.includes('const [task, team, taskConfig] = await Promise.all([')) {
        const oldLoad = `  const task = await env.DB.prepare(
    \`SELECT id,track_id AS trackId,submission_type AS submissionType,
            starts_at AS startsAt,ends_at AS endsAt,schedule_json AS scheduleJson,status
       FROM tasks WHERE id=?1 LIMIT 1\`
  ).bind(taskId).first();`;
        const parallel = `  const [task, team, taskConfig] = await Promise.all([
    env.DB.prepare(
      \`SELECT id,track_id AS trackId,submission_type AS submissionType,
              starts_at AS startsAt,ends_at AS endsAt,schedule_json AS scheduleJson,status
         FROM tasks WHERE id=?1 LIMIT 1\`
    ).bind(taskId).first(),
    teamForUser(env, auth.user.id),
    readConfig(env)
  ]);`;
        const hadEffective = changed.includes('const effectiveTask = applyInteractionCheckinSettings(task, taskConfig);');
        changed = replaceOnce(changed, oldLoad, parallel, 'fast并行读取');
        if (hadEffective) {
          changed = changed.replace('  const taskConfig = await readConfig(env);\n', '');
          changed = changed.replace('  const team = await teamForUser(env, auth.user.id);\n', '');
        } else {
          changed = replaceOnce(changed,
            "  const team = await teamForUser(env, auth.user.id);\n  if (!team) return json({ error: '尚未分配队伍，不能上传队伍打卡图片' }, 403);",
            "  if (!team) return json({ error: '尚未分配队伍，不能上传队伍打卡图片' }, 403);\n  const effectiveTask = applyInteractionCheckinSettings(task, taskConfig);",
            'fast effective task');
        }
      }
      return changed.replaceAll('taskWindowOpen(task, occurrenceDate', 'taskWindowOpen(effectiveTask, occurrenceDate');
    }, 'memberFastUpload');
    write(file, marker + '\n' + next);
  }
}

{
  const { file, source } = read('public/app.js');
  let next = source;

  if (!next.includes("recordPerf('member-checkin-direct-ready'")) {
    const compressAnchor = 'const compressMemberCheckinImage = async';
    if (next.includes(compressAnchor)) {
      next = transformDecl(next, compressAnchor, (section) => replaceOnce(section,
        '  const sourceFile = await normalizeSourceImage(file);\n  const imageCompression = await loadImageCompressionLibrary();',
        `  const sourceFile = await normalizeSourceImage(file);
  const sourceDimensions = await imageDimensions(sourceFile);
  if (['image/jpeg', 'image/webp'].includes(sourceFile.type)
      && sourceFile.size <= MEMBER_FAST_MAX_BYTES
      && sourceDimensions.width > 0 && sourceDimensions.height > 0
      && Math.max(sourceDimensions.width, sourceDimensions.height) <= MEMBER_FAST_MAX_EDGE) {
    recordPerf('member-checkin-direct-ready', { sourceBytes: Number(sourceFile.size || 0), navigationEpoch });
    return { file: sourceFile, mimeType: sourceFile.type, width: sourceDimensions.width, height: sourceDimensions.height };
  }
  const imageCompression = await loadImageCompressionLibrary();`,
        'member direct ready'), 'compressMemberCheckinImage');
    }
  }

  const warmAnchor = '  void startPlazaPrefetch();';
  if (!next.includes('memberUploadWarmup') && next.includes(warmAnchor)) {
    next = replaceOnce(next, warmAnchor,
      `${warmAnchor}
  setTimeout(() => {
    const memberUploadWarmup = () => { void loadImageCompressionLibrary().catch(() => {}); };
    if ('requestIdleCallback' in window) requestIdleCallback(memberUploadWarmup, { timeout: 700 });
    else memberUploadWarmup();
  }, 1100);`,
      'member upload warmup');
  }

  if (!next.includes('plaza-detail-page') && next.includes('async function openPlazaPost')) {
    next = transformDecl(next, 'async function openPlazaPost', (section) => {
      let changed = replaceOnce(section,
        "  const root = document.querySelector('#modalRoot');\n  if (!root) return;",
        `  const root = app;
  const listUrl = new URL(location.href);
  listUrl.searchParams.delete('plazaPost');
  const plazaScrollY = window.scrollY;
  const listState = { ...(history.state || {}), plazaList: true, plazaDetail: false, plazaSort: sort, plazaPage: page, plazaMonth: month, plazaScrollY };
  history.replaceState(listState, '', listUrl);
  const detailUrl = new URL(listUrl);
  detailUrl.searchParams.set('plazaPost', postId);
  history.pushState({ ...listState, plazaList: false, plazaDetail: true, plazaPost: postId }, '', detailUrl);
  document.body.dataset.view = 'plaza-detail';`,
        'plaza page root');
      changed = changed.replace('  const modalEpoch = ++plazaModalEpoch;\n  const plazaScrollY = window.scrollY;\n', '  const modalEpoch = ++plazaModalEpoch;\n');
      const closeRe = /  const closePost = \(\) => \{[\s\S]*?\n  \};/;
      if (!closeRe.test(changed)) throw new Error('未找到详情返回函数');
      changed = changed.replace(closeRe, `  const closePost = () => {
    if (modalEpoch !== plazaModalEpoch) return;
    plazaModalEpoch += 1;
    history.back();
  };`);
      changed = changed.replaceAll('<div class="modal-backdrop"><section class="card modal plaza-detail', '<section class="card plaza-detail plaza-detail-page');
      changed = changed.replaceAll('</section></div>`;', '</section>`;');
      changed = changed.replaceAll('id="closePost">关闭</button>', 'id="closePost">返回</button>');
      return changed;
    }, 'openPlazaPost');
  }

  if (!next.includes('const restorePlazaListFromHistory = (state) => {') && next.includes('async function openPlazaPost')) {
    const helper = `${marker}
const restorePlazaListFromHistory = (state) => {
  if (!state?.plazaList) return false;
  document.body.dataset.view = 'plaza';
  const scrollY = Math.max(0, Number(state.plazaScrollY || 0));
  void plaza(state.plazaSort || 'latest', Math.max(1, Number(state.plazaPage || 1)), state.plazaMonth || '', { preserveScroll: false })
    .then(() => requestAnimationFrame(() => window.scrollTo(0, scrollY)))
    .catch((error) => { showToast(error.message || '活动广场加载失败', 'error'); });
  return true;
};
window.addEventListener('popstate', (event) => {
  if (document.body.dataset.view === 'plaza-detail' && event.state?.plazaList) restorePlazaListFromHistory(event.state);
});

`;
    next = replaceOnce(next, 'async function openPlazaPost', helper + 'async function openPlazaPost', 'plaza history helper');
  }

  if (!next.includes(marker)) next = marker + '\n' + next;
  if (next !== source) write(file, next);
}

{
  const { file, source } = read('public/style.css');
  if (!source.includes(marker)) {
    write(file, source + `\n\n${marker}\nbody[data-view="plaza-detail"] #app{max-width:980px;margin:0 auto;padding-bottom:32px}\n.plaza-detail-page{position:static!important;inset:auto!important;transform:none!important;width:min(100%,960px)!important;max-width:960px!important;max-height:none!important;overflow:visible!important;margin:18px auto 32px!important}\n.plaza-detail-page .row:first-child{position:sticky;top:0;z-index:8;padding:10px 0;background:rgba(255,255,255,.94);backdrop-filter:blur(12px)}\n@media(max-width:720px){body[data-view="plaza-detail"] #app{padding:0 12px 28px}.plaza-detail-page{margin:8px auto 24px!important;border-radius:20px!important}}\n`);
  }
}

{
  const student = read('cloudflare/routes/student.js').source;
  const media = read('cloudflare/routes/media.js').source;
  const app = read('public/app.js').source;
  const m0 = media.indexOf('const memberFastUpload = async');
  const m1 = m0 >= 0 ? nextTopLevel(media, m0 + 1) : -1;
  const fast = media.slice(m0, m1);
  const d0 = app.indexOf('async function openPlazaPost');
  const d1 = d0 >= 0 ? nextTopLevel(app, d0 + 1) : -1;
  const detail = d0 >= 0 ? app.slice(d0, d1 > d0 ? d1 : undefined) : '';
  const hasV5 = app.includes('MOBILE_REAL_UNDER_1S_V5');
  if (!student.includes('taskWindowOpen(effectiveTask, occurrenceDate, makeupAllowed)')
      || !fast.includes('const [task, team, taskConfig] = await Promise.all([')
      || !fast.includes('taskWindowOpen(effectiveTask, occurrenceDate')
      || (app.includes('const compressMemberCheckinImage = async') && !app.includes("recordPerf('member-checkin-direct-ready'"))
      || (hasV5 && !app.includes('memberUploadWarmup'))
      || (d0 >= 0 && (!detail.includes('const root = app;') || !detail.includes('plaza-detail-page') || detail.includes('modal-backdrop')))) {
    throw new Error('V1修复生成不完整');
  }
}

console.log('Applied aligned check-in window, faster member upload and full-page Plaza detail V1.');
