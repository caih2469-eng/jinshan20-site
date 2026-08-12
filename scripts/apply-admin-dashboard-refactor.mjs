import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const appPath = path.join(root, 'public', 'app.js');
const entrancePath = path.join(root, 'public', 'entrance.html');
const studentRoutePath = path.join(root, 'cloudflare', 'routes', 'student.js');
const adminTemplatePath = path.join(root, 'scripts', 'admin-dashboard-refactor.template.js');
const flowTemplatePath = path.join(root, 'scripts', 'student-admin-flow.template.js');
const memberFastTestPath = path.join(root, 'test', 'member-checkin-fast.test.js');
const adminMarker = '/* ADMIN_DASHBOARD_REFACTOR_V1 */';
const flowMarker = '/* STUDENT_ADMIN_FLOW_V2 */';
const backendMarker = '/* STUDENT_ADMIN_FLOW_BACKEND_V2 */';
const adminAnchor = 'function enhanceAdminSections() {';
const currentArchitectureAnchor = '/* ADMIN_CLIENT_LAZY_LOADER_V1 */';

const requireFile = (filePath, label) => {
  if (!fs.existsSync(filePath)) throw new Error(`${label}不存在`);
};

const replaceRequired = (source, pattern, replacement, label) => {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

const extractSegment = (template, name) => {
  const start = `/* ${name}_START */`;
  const end = `/* ${name}_END */`;
  const startIndex = template.indexOf(start);
  const endIndex = template.indexOf(end);
  if (startIndex < 0 || endIndex <= startIndex) throw new Error(`模板片段 ${name} 不完整`);
  return template.slice(startIndex + start.length, endIndex).trim();
};

requireFile(appPath, 'public/app.js');
requireFile(entrancePath, 'public/entrance.html');
requireFile(studentRoutePath, 'cloudflare/routes/student.js');
requireFile(adminTemplatePath, '后台减法重构模板');
requireFile(flowTemplatePath, '学生与后台流程修复模板');

let appSource = fs.readFileSync(appPath, 'utf8');
const startedWithLazyAdminClient = appSource.includes(currentArchitectureAnchor);

// A previous lazy split can leave the legacy dashboard in admin-client.js while
// app.js only carries completion markers. Restore it once, add the compact
// dashboard alongside the legacy helpers, and let the final performance layer
// split the complete client again. This keeps ranking, profile, team, make-up
// and account-management helpers available to the compact dashboard.
if (appSource.includes(currentArchitectureAnchor)
    && !appSource.includes('const adminDashboardState = {')) {
  execFileSync(process.execPath, ['scripts/apply-lazy-admin-client.mjs', '--restore'], { stdio: 'pipe' });
  appSource = fs.readFileSync(appPath, 'utf8');
  const originalAdmin = 'async function admin(selectedDate, pageEpoch = beginNavigation()) {';
  if (!appSource.includes(originalAdmin) || !appSource.includes(adminAnchor)) {
    throw new Error('Cannot restore the complete admin dashboard before compact refactor');
  }
  appSource = appSource.replace(originalAdmin, 'async function legacyAdmin(selectedDate, pageEpoch = beginNavigation()) {');
  const adminTemplate = fs.readFileSync(adminTemplatePath, 'utf8').trim();
  appSource = appSource.replace(adminAnchor, `${adminTemplate}\n\n${adminAnchor}`);
}

// The current UI intentionally retains ranking, profile and team features. Older versions of this
// generator removed those sections while applying the member check-in template. Materialize only
// the check-in section on the current architecture, then mark the legacy transforms as satisfied.
if (!appSource.includes(adminMarker)
    && appSource.includes('const rankingViewCache = new Map();')
    && appSource.includes('function memberCheckinForm(task) {')) {
  const flowTemplate = fs.readFileSync(flowTemplatePath, 'utf8');
  const memberCheckin = extractSegment(flowTemplate, 'FRONTEND_MEMBER_CHECKIN');
  appSource = replaceRequired(
    appSource,
    /function memberCheckinForm\(task\) \{[\s\S]*?\r?\n\}\r?\n\r?\nfunction materialSubmissionForm\(task\) \{/,
    `${memberCheckin}\n\nfunction materialSubmissionForm(task) {`,
    '个人打卡多图函数'
  );
  appSource = appSource.replace(
    currentArchitectureAnchor,
    `${adminMarker}\n${flowMarker}\n${currentArchitectureAnchor}`
  );
}

if (!appSource.includes('function memberCheckinForm(task) {')) {
  const flowTemplate = fs.readFileSync(flowTemplatePath, 'utf8');
  const memberCheckin = extractSegment(flowTemplate, 'FRONTEND_MEMBER_CHECKIN');
  appSource = replaceRequired(
    appSource,
    /(  document\.querySelectorAll\('\[data-member-task\]'\)\.forEach\(\(button\) => \{[\s\S]*?\n  \}\);)[\s\S]*?\nfunction materialSubmissionForm\(task\) \{/,
    `$1\n}\n\n${memberCheckin}\n\nfunction materialSubmissionForm(task) {`,
    'damaged student tail and member check-in function'
  );
}

if (!appSource.includes(adminMarker)
    && !appSource.includes('async function admin(selectedDate, pageEpoch = beginNavigation()) {')) {
  execFileSync(process.execPath, ['scripts/apply-lazy-admin-client.mjs', '--restore'], { stdio: 'pipe' });
  appSource = fs.readFileSync(appPath, 'utf8');
}

if (!appSource.includes(adminMarker)) {
  const originalAdmin = 'async function admin(selectedDate, pageEpoch = beginNavigation()) {';
  if (!appSource.includes(originalAdmin)) throw new Error('未找到原始 admin 函数，已停止以避免误改');
  if (!appSource.includes(adminAnchor)) throw new Error('未找到后台增强函数锚点，已停止以避免误改');
  appSource = appSource.replace(originalAdmin, 'async function legacyAdmin(selectedDate, pageEpoch = beginNavigation()) {');
  const adminTemplate = fs.readFileSync(adminTemplatePath, 'utf8').trim();
  appSource = appSource.replace(adminAnchor, `${adminTemplate}\n\n${adminAnchor}`);
}

if (!appSource.includes(flowMarker)) {
  const flowTemplate = fs.readFileSync(flowTemplatePath, 'utf8');
  const memberCheckin = extractSegment(flowTemplate, 'FRONTEND_MEMBER_CHECKIN');
  const adminComments = extractSegment(flowTemplate, 'FRONTEND_ADMIN_COMMENTS');

  appSource = replaceRequired(
    appSource,
    'const rankingViewCache = new Map();',
    'const adminCommentViewCache = new Map();',
    '排行榜缓存声明'
  );
  appSource = appSource.replace(/^\s*rankingViewCache\.clear\(\);\s*$/gm, '');

  appSource = replaceRequired(
    appSource,
    /\nfunction rankingTable\([\s\S]*?\nasync function openPlazaPost\(/,
    '\nasync function openPlazaPost(',
    '排行榜前端代码块'
  );

  appSource = replaceRequired(
    appSource,
    "  const teamListResult = dashboard.teamSummary;\n  const myTeam = dashboard.teamSummary?.team;\n  const taskResult = { tasks: dashboard.tasks };",
    "  const taskResult = { tasks: dashboard.tasks };",
    '学生首页队伍摘要变量'
  );

  appSource = replaceRequired(
    appSource,
    /    <nav class="student-shortcuts" aria-label="常用功能">[\s\S]*?      ` : ''}`;/,
    [
      '    <nav class="student-shortcuts student-shortcuts-compact" aria-label="常用功能">',
      '      <button id="historyCheckins"><span>✓</span><strong>历史打卡</strong><small>查看以前的提交</small></button>',
      '      <button id="plaza"><span>▦</span><strong>活动广场</strong><small>发现青春作品</small></button>',
      '      <button id="inbox"><span>✉</span><strong>信息箱</strong><small>评论与系统通知</small></button>',
      '    </nav>',
      '    <div id="modalRoot"></div>`;'
    ].join('\n'),
    '学生首页快捷入口与资料队伍区块'
  );

  appSource = appSource.replace("  document.querySelector('#ranking').onclick = () => rankings();\n", '');
  appSource = replaceRequired(
    appSource,
    "function openStudentCheckinHistory() {\n  const root = document.querySelector('#modalRoot');",
    "function openStudentCheckinHistory() {\n  let root = document.querySelector('#modalRoot');\n  if (!root) {\n    root = document.createElement('div');\n    root.id = 'modalRoot';\n    app.append(root);\n  }",
    '历史打卡弹层根节点'
  );
  appSource = appSource.replace(
    "      list.insertAdjacentHTML('beforeend', result.records.map(renderRecord).join(''));",
    "      const records = Array.isArray(result.records) ? result.records : [];\n      list.insertAdjacentHTML('beforeend', records.map(renderRecord).join(''));"
  );
  appSource = appSource.replace("      if (!result.records.length && page === 1) {", "      if (!records.length && page === 1) {");

  appSource = replaceRequired(
    appSource,
    /function memberCheckinForm\(task\) \{[\s\S]*?\n\}\n\nfunction materialSubmissionForm\(task\) \{/,
    `${memberCheckin}\n\nfunction materialSubmissionForm(task) {`,
    '互动赛道个人打卡函数'
  );
  appSource = replaceRequired(
    appSource,
    "      releaseSession();\n      returnToCachedStudentHome('个人打卡成功');",
    "      recordPerf('submit', { action: 'member-checkin', success: true, imageCount: mediaIds.length, navigationEpoch });\n      releaseSession();\n      returnToCachedStudentHome('个人打卡成功');",
    '个人打卡成功性能记录'
  );
  appSource = appSource.replace(
    "    } catch (error) {\n      alert(error?.message || '打卡提交失败，请稍后重试。');",
    "    } catch (error) {\n      recordPerf('submit', { action: 'member-checkin', success: false, navigationEpoch });\n      alert(error?.message || '打卡提交失败，请稍后重试。');"
  );

  appSource = replaceRequired(
    appSource,
    /async function adminComments\(page = 1\) \{[\s\S]*?\n\}\n\nasync function legacyAdmin\(/,
    `${adminComments}\n\nasync function legacyAdmin(`,
    '评论管理函数'
  );

  appSource = replaceRequired(
    appSource,
    /\nasync function legacyAdmin\([\s\S]*?\n\}\n\n(?=\/\* ADMIN_DASHBOARD_REFACTOR_V1 \*\/)/,
    '\n',
    '已废弃高级后台函数'
  );

  appSource = replaceRequired(
    appSource,
    /const compactPostRow = \(post\) => `[\s\S]*?`;\n\nfunction openCompactPostActions/,
    [
      'const compactPostRow = (post, index) => `',
      '  <button type="button" class="admin-user-tile admin-post-tile ${post.status === \'visible\' ? \'completed\' : \'missing\'}" data-id="${post.id}">',
      '    <span class="user-number">${index + 1}</span>',
      '    <span class="admin-user-tile-copy"><strong>${escapeHtml(post.teamName)}</strong><small>${escapeHtml(post.taskName)}</small></span>',
      '    <span class="user-completion ${post.status === \'visible\' ? \'done\' : \'pending\'}">${post.status === \'visible\' ? \'公开\' : \'隐藏\'}</span>',
      '  </button>`;',
      '',
      'function openCompactPostActions'
    ].join('\n'),
    '活动广场紧凑卡片'
  );

  appSource = appSource.replace(
    "<div class=\"admin-post-status\"><span class=\"pill ${post.status === 'visible' ? 'done' : 'pending'}\">${post.status === 'visible' ? '公开' : '已隐藏'}</span>${post.excludedFromRanking ? '<span class=\"pill pending\">已排除排名</span>' : ''}</div>",
    ''
  );
  appSource = appSource.replace(
    "      <button type=\"button\" class=\"secondary\" data-post-exclude>${post.excludedFromRanking ? '恢复排名' : '排除排名'}</button>\n",
    ''
  );
  appSource = appSource.replace(
    /\n  root\.querySelector\('\[data-post-exclude\]'\)\.onclick = async \(event\) => \{[\s\S]*?\n  \};/,
    ''
  );
  appSource = appSource.replace(
    '<div class="admin-compact-list">${result.posts.map(compactPostRow).join(\'\') || \'<p class="muted">暂无广场帖子</p>\'}</div>',
    '<div class="admin-user-grid admin-post-grid">${result.posts.map((post, index) => compactPostRow(post, index)).join(\'\') || \'<p class="muted">暂无广场帖子</p>\'}</div>'
  );
  appSource = appSource.replace("document.querySelectorAll('.admin-post-actions').forEach((button) => {", "document.querySelectorAll('.admin-post-tile').forEach((button) => {");

  appSource = appSource.replace(/\nasync function openLegacyAdminTools\([\s\S]*?\n\}\n\nasync function admin/, '\nasync function admin');
  appSource = appSource.replace('          <button class="secondary" id="ranking">排行榜</button>\n', '');
  appSource = appSource.replace('          <button class="secondary" id="legacyAdminTools">高级工具</button>\n', '');
  appSource = appSource.replace("  document.querySelector('#ranking').onclick = () => rankings();\n", '');
  appSource = appSource.replace("  document.querySelector('#legacyAdminTools').onclick = () => openLegacyAdminTools(date);\n", '');
  appSource = appSource.replace('      <p class="admin-advanced-note">任务设置、最终截图、导出、管理员监督等低频功能已移至“高级工具”，不会参与首页加载。</p>\n', '');

  appSource = appSource.replace(adminAnchor, `${flowMarker}\n${adminAnchor}`);
}

fs.writeFileSync(appPath, appSource, 'utf8');

if (startedWithLazyAdminClient) {
  execFileSync(process.execPath, ['scripts/apply-lazy-admin-client.mjs'], { stdio: 'pipe' });
  execFileSync(process.execPath, ['scripts/apply-mobile-admin-photo-fix.mjs'], { stdio: 'pipe' });
  execFileSync(process.execPath, ['scripts/apply-approved-lazy-admin.mjs'], { stdio: 'pipe' });
}

// Asset versioning is owned by the release finalizer. Do not rewrite it during a feature-only pass.

let studentRoute = fs.readFileSync(studentRoutePath, 'utf8');
if (!studentRoute.includes(backendMarker)) {
  const flowTemplate = fs.readFileSync(flowTemplatePath, 'utf8');
  const historyBlock = extractSegment(flowTemplate, 'BACKEND_INTERACTION_HISTORY');
  const memberRoute = extractSegment(flowTemplate, 'BACKEND_MEMBER_ROUTE');

  studentRoute = replaceRequired(
    studentRoute,
    /    const \[count, records\] = await Promise\.all\(\[\n      env\.DB\.prepare\(\n        'SELECT COUNT\(\*\) AS total FROM member_checkins WHERE user_id=\?1'[\s\S]*?\n    \}\);\n  \}\n\n  const memberMatch/,
    `${historyBlock}\n  }\n\n  const memberMatch`,
    '互动赛道历史打卡查询'
  );
  studentRoute = replaceRequired(
    studentRoute,
    /  const memberMatch = route\.match\(\/\^\\\/api\\\/tasks[\s\S]*?\n  const submissionMatch/,
    `${memberRoute}\n\n  const submissionMatch`,
    '互动赛道多图打卡接口'
  );
  studentRoute = studentRoute.replace("import {\n", `${backendMarker}\nimport {\n`);
  fs.writeFileSync(studentRoutePath, studentRoute, 'utf8');
}

if (fs.existsSync(memberFastTestPath)) {
  let testSource = fs.readFileSync(memberFastTestPath, 'utf8');
  testSource = testSource.replace(
    "  assert.match(memberBody, /mediaIds:\\s*\\[session\\.mediaId\\]/);",
    "  assert.match(memberBody, /multiple required/);\n  assert.match(memberBody, /session\\.items/);\n  assert.match(memberBody, /mediaIds/);"
  );
  fs.writeFileSync(memberFastTestPath, testSource, 'utf8');
}

console.log('Applied compact admin dashboard and student/admin flow fixes.');
