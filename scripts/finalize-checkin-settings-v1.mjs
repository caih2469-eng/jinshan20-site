import fs from 'node:fs';
import path from 'node:path';

const dashboardFile = path.resolve('cloudflare/services/student-dashboard.js');
const runtimeFile = path.resolve('cloudflare/lib/runtime.js');
const marker = '/* FINAL_CHECKIN_SETTINGS_V1 */';
const dashboardV4Marker = '/* STRICT_P95_DASHBOARD_BATCH_V4 */';

// Distinguish a real administrator-saved interaction setting from readConfig's synthesized defaults.
// Without this bit, an old task with no checkinSettings row could be accidentally treated as 00:00–23:59.
{
  let runtime = fs.readFileSync(runtimeFile, 'utf8');
  const configuredDeclaration = "  const checkinSettingsConfigured = Object.prototype.hasOwnProperty.call(values, 'checkinSettings');";
  if (!runtime.includes(configuredDeclaration)) {
    const checkinDeclaration = '  const checkinSettings = values.checkinSettings || {};';
    if (!runtime.includes(checkinDeclaration)) {
      throw new Error('未找到checkinSettings读取，无法标记管理员设置是否真实存在');
    }
    runtime = runtime.replace(
      checkinDeclaration,
      `${checkinDeclaration}\n${configuredDeclaration}`
    );
  }
  if (!runtime.includes('    checkinSettingsConfigured,')) {
    const returnAnchor = '    checkinSettings: {';
    if (!runtime.includes(returnAnchor)) {
      throw new Error('未找到checkinSettings返回值，无法暴露真实配置状态');
    }
    runtime = runtime.replace(returnAnchor, `    checkinSettingsConfigured,\n${returnAnchor}`);
  }
  fs.writeFileSync(runtimeFile, runtime, 'utf8');
}

let source = fs.readFileSync(dashboardFile, 'utf8');

const canonicalHelper = `${marker}
export const applyInteractionCheckinSettings = (task, config) => {
  if (!task || task.trackId !== 'interaction') return task;
  const settingsConfigured = config?.checkinSettingsConfigured === true;
  if (!settingsConfigured) {
    return {
      ...task,
      checkinEnabled: task.checkinEnabled !== false,
      imageLimit: Math.min(8, Math.max(1, Number(task.imageLimit || 3))),
      memberImageLimit: Math.min(8, Math.max(1, Number(task.memberImageLimit || task.imageLimit || 1)))
    };
  }
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

const helperAnchor = 'export const applyInteractionCheckinSettings = (task, config) => {';
const helperStart = source.indexOf(helperAnchor);
const buildTasksStart = source.indexOf('export const buildStudentTasks = async (env, user, options = {}) => {');
if (buildTasksStart < 0) throw new Error('未找到buildStudentTasks，无法归一四校区打卡设置');

const nextExportAfter = (from) => {
  const pattern = /^export const [A-Za-z_$][\w$]*\s*=/gm;
  pattern.lastIndex = from;
  return pattern.exec(source)?.index ?? -1;
};

if (helperStart >= 0) {
  let helperEnd = nextExportAfter(helperStart + helperAnchor.length);
  if (helperEnd < 0 || helperEnd <= helperStart) {
    throw new Error('无法识别四校区打卡设置帮助函数的独立边界');
  }
  const preservedDashboardMarker = source.indexOf(dashboardV4Marker, helperStart + helperAnchor.length);
  if (preservedDashboardMarker > helperStart && preservedDashboardMarker < helperEnd) {
    helperEnd = preservedDashboardMarker;
  }
  let replaceStart = helperStart;
  const prefixWithMarker = `${marker}\n`;
  if (source.slice(0, helperStart).endsWith(prefixWithMarker)) {
    replaceStart -= prefixWithMarker.length;
  }
  source = source.slice(0, replaceStart) + canonicalHelper + source.slice(helperEnd);
} else {
  source = source.slice(0, buildTasksStart) + canonicalHelper + source.slice(buildTasksStart);
}

if (!source.includes("task?.checkinEnabled === false")) {
  const oldWindow = "export const taskWindowOpen = (task, occurrenceDate = '', makeupAllowed = false) => {\n  if (!isTaskOccurrence(task, occurrenceDate)) return false;";
  const newWindow = "export const taskWindowOpen = (task, occurrenceDate = '', makeupAllowed = false) => {\n  if (task?.checkinEnabled === false) return false;\n  if (!isTaskOccurrence(task, occurrenceDate)) return false;";
  if (!source.includes(oldWindow)) throw new Error('未找到taskWindowOpen，无法补齐打卡开关校验');
  source = source.replace(oldWindow, newWindow);
}

const finalMarkerStart = source.indexOf(marker);
const finalHelperStart = source.indexOf(helperAnchor, finalMarkerStart);
let finalHelperEnd = nextExportAfter(finalHelperStart + helperAnchor.length);
const finalDashboardMarker = source.indexOf(dashboardV4Marker, finalHelperStart + helperAnchor.length);
if (finalDashboardMarker > finalHelperStart && finalDashboardMarker < finalHelperEnd) {
  finalHelperEnd = finalDashboardMarker;
}
if (finalMarkerStart < 0 || finalHelperStart < 0 || finalHelperEnd < 0) {
  throw new Error('最终四校区打卡设置帮助函数边界不完整');
}
const finalHelper = source.slice(finalMarkerStart, finalHelperEnd);
for (const required of [
  'const settingsConfigured = config?.checkinSettingsConfigured === true;',
  'if (!settingsConfigured) {',
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
if (source.includes('buildStudentTeamContext') && !source.includes(dashboardV4Marker)) {
  throw new Error('检测到Dashboard V4共享上下文但marker丢失，拒绝继续');
}

fs.writeFileSync(dashboardFile, source, 'utf8');
console.log('Finalized interaction check-in settings: only an explicit app_config.checkinSettings row overrides the task schedule.');
