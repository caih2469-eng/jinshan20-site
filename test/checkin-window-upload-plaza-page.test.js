const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const topLevelSection = (source, anchor) => {
  const start = source.indexOf(anchor);
  if (start < 0) return '';
  const pattern = /^(?:async\s+function|function|const|let|class)\s+[A-Za-z_$][\w$]*/gm;
  pattern.lastIndex = start + 1;
  const match = pattern.exec(source);
  return source.slice(start, match?.index ?? source.length);
};

test('独立打卡服务与主站统一使用后台四校区打卡设置，未配置时保留任务原窗口', async () => {
  const runtime = read('cloudflare/lib/runtime.js');
  const dashboard = read('cloudflare/services/student-dashboard.js');
  const student = read('cloudflare/routes/student.js');
  assert.match(runtime, /CHECKIN_WINDOW_UPLOAD_PLAZA_PAGE_V1/);
  assert.match(runtime, /checkinSettingsConfigured/);
  assert.match(runtime, /Object\.prototype\.hasOwnProperty\.call\(values, 'checkinSettings'\)/);
  assert.match(dashboard, /applyInteractionCheckinSettings/);
  assert.match(dashboard, /config\?\.checkinSettingsConfigured === true/);
  assert.match(student, /const effectiveTask = applyInteractionCheckinSettings\(task, taskConfig\)/);
  assert.match(student, /taskWindowOpen\(effectiveTask, occurrenceDate, makeupAllowed\)/);
  assert.doesNotMatch(student, /taskWindowOpen\(task, occurrenceDate, makeupAllowed\)/);

  const [{ applyInteractionCheckinSettings, isTaskOccurrence, taskWindowOpen }, { shanghaiDate, shanghaiTime }] = await Promise.all([
    import('../cloudflare/services/student-dashboard.js'),
    import('../cloudflare/lib/runtime.js')
  ]);
  const today = shanghaiDate();
  const currentTime = shanghaiTime();
  const allWeekdays = [1, 2, 3, 4, 5, 6, 7];
  const closedWindow = currentTime < '12:00'
    ? { dailyStart: '23:58', dailyEnd: '23:59' }
    : { dailyStart: '00:00', dailyEnd: '00:01' };
  const staleTask = {
    id: 'stale-task',
    trackId: 'interaction',
    imageLimit: 1,
    startsAt: `${today}T${closedWindow.dailyStart}:00+08:00`,
    endsAt: `${today}T${closedWindow.dailyEnd}:00+08:00`,
    scheduleJson: JSON.stringify({
      scheduleType: 'weekly',
      activeStartDate: today,
      activeEndDate: today,
      weekdays: allWeekdays,
      refreshDays: [],
      ...closedWindow
    })
  };
  assert.equal(taskWindowOpen(staleTask, today, false), false, '旧任务窗口应当处于关闭状态');

  const unconfigured = applyInteractionCheckinSettings(staleTask, {
    checkinSettingsConfigured: false,
    checkinSettings: {
      enabled: true,
      activeStartDate: today,
      activeEndDate: today,
      dailyStart: '00:00',
      dailyEnd: '23:59',
      weekdays: allWeekdays
    }
  });
  assert.equal(unconfigured.scheduleJson, staleTask.scheduleJson, '没有真实配置键时不得用合成默认值覆盖任务时段');
  assert.equal(taskWindowOpen(unconfigured, today, false), false, '未配置后台时应继续尊重旧任务关闭窗口');

  const effective = applyInteractionCheckinSettings(staleTask, {
    checkinSettingsConfigured: true,
    startDate: today,
    endDate: today,
    checkinSettings: {
      enabled: true,
      activeStartDate: today,
      activeEndDate: today,
      dailyStart: '00:00',
      dailyEnd: '23:59',
      weekdays: allWeekdays,
      personalImageLimit: 1,
      teamImageLimit: 3
    }
  });
  const effectiveSchedule = JSON.parse(effective.scheduleJson);
  assert.equal(effective.checkinEnabled, true, `打卡开关异常：${JSON.stringify(effective)}`);
  assert.equal(effectiveSchedule.activeStartDate, today, `开始日期未覆盖：${JSON.stringify(effectiveSchedule)}`);
  assert.equal(effectiveSchedule.activeEndDate, today, `结束日期未覆盖：${JSON.stringify(effectiveSchedule)}`);
  assert.equal(effectiveSchedule.dailyStart, '00:00', `开始时间未覆盖：${JSON.stringify(effectiveSchedule)}`);
  assert.equal(effectiveSchedule.dailyEnd, '23:59', `结束时间未覆盖：${JSON.stringify(effectiveSchedule)}`);
  assert.deepEqual(effectiveSchedule.weekdays, allWeekdays, `星期未覆盖：${JSON.stringify(effectiveSchedule)}`);
  assert.equal(isTaskOccurrence(effective, today), true,
    `后台新日期/星期仍被判关闭：today=${today}, now=${currentTime}, schedule=${JSON.stringify(effectiveSchedule)}`);
  assert.equal(currentTime >= effectiveSchedule.dailyStart && currentTime <= effectiveSchedule.dailyEnd, true,
    `上海当前时间不在测试开放窗口：now=${currentTime}, schedule=${JSON.stringify(effectiveSchedule)}`);
  assert.equal(taskWindowOpen(effective, today, false), true,
    `后台真实保存的最新开放时段仍未覆盖旧任务：today=${today}, now=${currentTime}, effective=${JSON.stringify(effective)}`);
});

test('个人打卡fast上传并行读取任务队伍设置并保留960px/300KB规格', () => {
  const media = read('cloudflare/routes/media.js');
  const app = read('public/app.js');
  const fast = topLevelSection(media, 'const memberFastUpload = async');
  const compress = topLevelSection(app, 'const compressMemberCheckinImage = async');
  assert.match(fast, /const \[task, team, taskConfig\] = await Promise\.all\(\[/);
  assert.match(fast, /applyInteractionCheckinSettings\(task, taskConfig\)/);
  assert.match(fast, /taskWindowOpen\(effectiveTask, occurrenceDate/);
  assert.doesNotMatch(fast, /taskWindowOpen\(task, occurrenceDate/);
  assert.match(app, /const MEMBER_FAST_MAX_BYTES = 307_200/);
  assert.match(app, /const MEMBER_FAST_MAX_EDGE = 960/);
  assert.match(compress, /member-checkin-direct-ready/);
  assert.match(compress, /sourceFile\.size <= MEMBER_FAST_MAX_BYTES/);
  assert.match(compress, /Math\.max\(sourceDimensions\.width, sourceDimensions\.height\) <= MEMBER_FAST_MAX_EDGE/);
  assert.match(app, /memberUploadWarmup/);
  assert.match(app, /\}, 1100\);/);
});

test('活动广场查看详情改为全页面导航且不再使用详情浮窗', () => {
  const app = read('public/app.js');
  const style = read('public/style.css');
  const detail = topLevelSection(app, 'async function openPlazaPost');
  assert.match(detail, /const root = app;/);
  assert.match(detail, /history\.pushState/);
  assert.match(detail, /plaza-detail-page/);
  assert.match(detail, /document\.body\.dataset\.view = 'plaza-detail'/);
  assert.match(detail, /id="closePost">返回<\/button>/);
  assert.doesNotMatch(detail, /modal-backdrop/);
  assert.doesNotMatch(detail, /card modal plaza-detail/);
  assert.doesNotMatch(detail, /<\/section><\/div>`/);
  assert.match(app, /restorePlazaListFromHistory/);
  assert.match(app, /void plaza\(state\.plazaSort \|\| 'latest', Math\.max\(1, Number\(state\.plazaPage \|\| 1\)\), state\.plazaMonth \|\| '', ''\)/);
  assert.doesNotMatch(app, /state\.plazaMonth \|\| '', \{ preserveScroll: false \}/);
  assert.match(style, /\.plaza-detail-page/);
  assert.match(detail, /2048w/);
});

test('修复层在V5和独立Check-in Worker部署链最后执行', () => {
  const v5 = read('scripts/apply-mobile-real-under-1s-v5.mjs');
  const checkinSplit = read('scripts/apply-checkin-service-split.mjs');
  const fixWorkflow = read('.github/workflows/fix-checkin-upload-plaza-test.yml');
  assert.match(v5, /await import\('\.\/apply-checkin-window-upload-plaza-page-v1\.mjs'\)/);
  assert.match(v5, /await import\('\.\/finalize-checkin-settings-v1\.mjs'\)/);
  assert.match(v5, /await import\('\.\/finalize-plaza-detail-page-v1\.mjs'\)/);
  assert.match(v5, /await import\('\.\/apply-plaza-under-1s-and-member-image-limit-v1\.mjs'\)/);
  assert.match(v5, /await import\('\.\/finalize-student-home-exact-scope-v2\.mjs'\)/);
  assert.match(checkinSplit, /await import\('\.\/apply-checkin-window-upload-plaza-page-v1\.mjs'\)/);
  assert.match(checkinSplit, /await import\('\.\/finalize-checkin-settings-v1\.mjs'\)/);
  assert.match(fixWorkflow, /--runs 20 --threshold-ms 1000/);
  assert.match(fixWorkflow, /api\/checkin-service-health/);
});
