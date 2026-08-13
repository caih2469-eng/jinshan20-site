import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appPath = path.join(root, 'public/app.js');
const marker = '/* STUDENT_HOME_EXACT_SCOPE_V2 */';
const read = () => fs.readFileSync(appPath, 'utf8').replace(/\r\n/g, '\n');
const write = (source) => fs.writeFileSync(appPath, source, 'utf8');

const replaceBetween = (source, startAnchor, endAnchor, replacement, label) => {
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(endAnchor, start + startAnchor.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`未找到${label}，已停止以避免误改`);
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
};

let app = read();
const studentStart = app.indexOf('async function student(');
const studentEnd = app.indexOf('function openStudentCheckinHistory()', studentStart);
if (studentStart < 0 || studentEnd < 0) throw new Error('未找到学生首页函数，已停止以避免误改');

let student = app.slice(studentStart, studentEnd);

if (student.includes('    <div class="student-top-actions">')) {
  student = replaceBetween(
    student,
    '    <div class="student-top-actions">',
    '    ${isInteraction ? `',
    '',
    '排行榜和我的资料区域'
  );
}

if (student.includes('<div class="team-summary">')) {
  const teamBlock = `    \${isInteraction ? \`
      <section class="card" id="myTeam">
        <h2>队伍成员</h2>
        \${myTeam ? \`
          <div class="member-list">\${myTeam.members.map((member) => \`<span>\${escapeHtml(member.name)}（\${escapeHtml(member.campus)}）</span>\`).join('')}</div>
        \` : \`
          <p class="muted">你尚未被编入队伍。队伍由管理员统一导入和调整，请联系活动管理员。</p>\`}
      </section>
      \` : ''}
`;
  student = replaceBetween(
    student,
    '    ${isInteraction ? `',
    '    <div id="modalRoot"></div>`;',
    teamBlock,
    '我的队伍区域'
  );
}

if (student.includes('  const materialStatus = {')) {
  student = replaceBetween(
    student,
    '  const materialStatus = {',
    '  prepareDynamicContent(app);',
    '',
    '最终截图证明区域'
  );
}

student = student
  .replace('  const teamListResult = dashboard.teamSummary;\n', '')
  .replace('  const materialResult = { tasks: dashboard.materialTasks };\n', '')
  .replace("  document.querySelector('#ranking').onclick = () => rankings();\n", '');

const forbidden = [
  '查看排行榜',
  '我的资料',
  '最终截图证明',
  '<div class="team-summary">',
  '<span>队伍名称</span>',
  '<span>邀请码</span>',
  '<span>成员人数</span>',
  'data-material='
];
const missingRequired = [
  'id="historyCheckins"',
  'id="plaza"',
  'id="inbox"',
  'id="teamCheckinStats"',
  'id="myTeam"',
  '<h2>队伍成员</h2>',
  'id="activityTasks"',
  'data-member-task=',
  'data-task=',
  'id="modalRoot"'
].filter((needle) => !student.includes(needle));
const remainingForbidden = forbidden.filter((needle) => student.includes(needle));
if (missingRequired.length || remainingForbidden.length) {
  throw new Error(`学生首页范围校验失败：缺少=${missingRequired.join(',') || '无'}；残留=${remainingForbidden.join(',') || '无'}`);
}

app = `${app.slice(0, studentStart)}${student}${app.slice(studentEnd)}`;
const oldRestore = "  void plaza(state.plazaSort || 'latest', Math.max(1, Number(state.plazaPage || 1)), state.plazaMonth || '', { preserveScroll: false })";
const fixedRestore = "  void plaza(state.plazaSort || 'latest', Math.max(1, Number(state.plazaPage || 1)), state.plazaMonth || '', '')";
if (!app.includes(oldRestore) && !app.includes(fixedRestore)) throw new Error('未找到活动广场返回调用，已停止以避免误改');
app = app.replace(oldRestore, fixedRestore);
if (!app.includes(marker)) app = `${marker}\n${app}`;

write(app);
console.log('Finalized exact student-home scope: kept all existing shortcuts/check-in flows, retained only team members, removed profile/ranking/final proof, and restored Plaza list return.');
