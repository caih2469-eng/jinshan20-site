import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('cloudflare/services/student-dashboard.js');
const marker = '/* FINAL_CHECKIN_SETTINGS_V1 */';
let source = fs.readFileSync(file, 'utf8');

const canonicalHelper = `${marker}
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
  const schedule = {
    scheduleType: 'weekly',
    activeStartDate,
    activeEndDate,
    dailyStart,
    dailyEnd,
    weekdays,
    refreshDays: []
  };
  return {
    ...task,
    checkinEnabled: settings.enabled !== false,
    imageLimit: Math.min(8, Math.max(1, Number(settings.teamImageLimit || task.imageLimit || 3))),
    memberImageLimit: Math.min(8, Math.max(1, Number(settings.personalImageLimit || task.memberImageLimit || task.imageLimit || 1))),
    scheduleJson: JSON.stringify(schedule),
    startsAt: \`${'${'}activeStartDate}T${'${'}dailyStart}:00+08:00\`,
    endsAt: \`${'${'}activeEndDate}T${'${'}dailyEnd}:00+08:00\`
  };
};

`;

const helperStart = source.indexOf('export const applyInteractionCheckinSettings = (task, config) => {');
const buildTasksStart = source.indexOf('export const buildStudentTasks = async (env, user, options = {}) => {');
if (buildTasksStart < 0) throw new Error('未找到buildStudentTasks，无法归一四校区打卡设置');

if (helperStart >= 0) {
  if (helperStart > buildTasksStart) throw new Error('四校区打卡设置帮助函数位置异常');
  source = source.slice(0, helperStart) + canonicalHelper + source.slice(buildTasksStart);
} else {
  source = source.slice(0, buildTasksStart) + canonicalHelper + source.slice(buildTasksStart);
}

if (!source.includes("task?.checkinEnabled === false")) {
  const oldWindow = "export const taskWindowOpen = (task, occurrenceDate = '', makeupAllowed = false) => {\n  if (!isTaskOccurrence(task, occurrenceDate)) return false;";
  const newWindow = "export const taskWindowOpen = (task, occurrenceDate = '', makeupAllowed = false) => {\n  if (task?.checkinEnabled === false) return false;\n  if (!isTaskOccurrence(task, occurrenceDate)) return false;";
  if (!source.includes(oldWindow)) throw new Error('未找到taskWindowOpen，无法补齐打卡开关校验');
  source = source.replace(oldWindow, newWindow);
}

const helperEnd = source.indexOf('export const buildStudentTasks = async', source.indexOf(marker));
const finalHelper = source.slice(source.indexOf(marker), helperEnd);
for (const required of [
  'const settings = config?.checkinSettings || {};',
  'checkinEnabled: settings.enabled !== false',
  "const dailyStart = settings.dailyStart || existing.dailyStart || '00:00';",
  "const dailyEnd = settings.dailyEnd || existing.dailyEnd || '23:59';",
  'settings.activeStartDate || existing.activeStartDate',
  'settings.activeEndDate || existing.activeEndDate',
  "scheduleType: 'weekly'"
]) {
  if (!finalHelper.includes(required)) throw new Error(`最终四校区打卡设置缺少：${required}`);
}

fs.writeFileSync(file, source, 'utf8');
console.log('Finalized authoritative interaction check-in settings from app_config.checkinSettings.');
