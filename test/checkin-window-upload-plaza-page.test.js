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

test('独立打卡服务与主站统一使用后台四校区打卡设置', async () => {
  const runtime = read('cloudflare/lib/runtime.js');
  const dashboard = read('cloudflare/services/student-dashboard.js');
  const student = read('cloudflare/routes/student.js');
  assert.match(runtime, /CHECKIN_WINDOW_UPLOAD_PLAZA_PAGE_V1/);
  assert.match(runtime, /checkinSettings:\s*\{/);
  assert.match(dashboard, /applyInteractionCheckinSettings/);
  assert.match(student, /const effectiveTask = applyInteractionCheckinSettings\(task, taskConfig\)/);
  assert.match(student, /taskWindowOpen\(effectiveTask, occurrenceDate, makeupAllowed\)/);
  assert.doesNotMatch(student, /taskWindowOpen\(task, occurrenceDate, makeupAllowed\)/);

  const [{ applyInteractionCheckinSettings, taskWindowOpen }, { shanghaiDate, shanghaiTime }] = await Promise.all([
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
  const effective = applyInteractionCheckinSettings(staleTask, {
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
  assert.equal(taskWindowOpen(effective, today, false), true, '后台最新开放时段必须覆盖旧任务schedule_json');
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
  assert.match(style, /\.plaza-detail-page/);
  assert.match(detail, /2048w/);
});

test('修复层在V5和独立Check-in Worker部署链最后执行', () => {
  const v5 = read('scripts/apply-mobile-real-under-1s-v5.mjs');
  const checkinSplit = read('scripts/apply-checkin-service-split.mjs');
  const fixWorkflow = read('.github/workflows/fix-checkin-upload-plaza-test.yml');
  assert.match(v5, /await import\('\.\/apply-checkin-window-upload-plaza-page-v1\.mjs'\)/);
  assert.match(v5, /await import\('\.\/finalize-plaza-detail-page-v1\.mjs'\)/);
  assert.match(checkinSplit, /await import\('\.\/apply-checkin-window-upload-plaza-page-v1\.mjs'\)/);
  assert.match(fixWorkflow, /--runs 20 --threshold-ms 1000/);
  assert.match(fixWorkflow, /api\/checkin-service-health/);
});
