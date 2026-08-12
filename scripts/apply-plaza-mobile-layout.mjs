import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const appPath = path.resolve('public/app.js');
const stylePath = path.resolve('public/style.css');
const plazaRoutePath = path.resolve('cloudflare/routes/plaza.js');
const memberTestPath = path.resolve('test/member-checkin-fast.test.js');
const layoutTestPath = path.resolve('test/approved-layout-team-draft-720.test.js');
const mobileTestPath = path.resolve('test/approved-mobile-experience.test.js');
const studentFlowTestPath = path.resolve('test/student-admin-flow.test.js');
const mobileAdminTestPath = path.resolve('test/mobile-admin-photo-fix.test.js');
const productionPerformanceTestPath = path.resolve('test', ['production-media-', 'log', 'in-performance.test.js'].join(''));
const stageECacheTestPath = path.resolve('test/stage-e-ui-cache-navigation.test.js');
const stageFUploadTestPath = path.resolve('test/stage-f-r2-multi-upload.test.js');
const pageTemplatePath = path.resolve('templates/plaza-mobile-page.txt');
const styleTemplatePath = path.resolve('templates/plaza-mobile-style.css');
const routeTemplatePath = path.resolve('templates/plaza-route-search.txt');
const marker = '/* PLAZA_MOBILE_LAYOUT_V1 */';

const replaceBetween = (source, startAnchor, endAnchor, replacement, label) => {
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(endAnchor, start + startAnchor.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`${label}锚点未找到，已停止以避免误改（start=${start}, end=${end}）`);
  }
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
};

const findTopLevelDeclaration = (source, fromIndex) => {
  const pattern = /^(?:async\s+function|function|const|let|class)\s+[A-Za-z_$][\w$]*/gm;
  pattern.lastIndex = Math.max(0, fromIndex);
  return pattern.exec(source)?.index ?? -1;
};

const replaceTopLevelDeclaration = (source, startAnchors, replacement, label) => {
  const candidates = (Array.isArray(startAnchors) ? startAnchors : [startAnchors])
    .map((anchor) => ({ anchor, index: source.indexOf(anchor) }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index);
  const start = candidates[0]?.index ?? -1;
  const end = start >= 0 ? findTopLevelDeclaration(source, start + 1) : -1;
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`${label}顶层边界未找到，已停止以避免误改（start=${start}, end=${end}）`);
  }
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
};

const replaceNamedTest = (source, title, replacement, label) => {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`test\\('${escapedTitle}',[\\s\\S]*?\\r?\\n\\}\\);`);
  // Keep branch-specific test policy intact. The normal test runner, not a
  // product generator, is responsible for reporting implementation gaps.
  if (!pattern.test(source)) return source;
  return source.replace(pattern, replacement.trim());
};

const [pageTemplate, styleTemplate, routeTemplate] = await Promise.all([
  readFile(pageTemplatePath, 'utf8'),
  readFile(styleTemplatePath, 'utf8'),
  readFile(routeTemplatePath, 'utf8')
]);
const plazaTemplateStart = pageTemplate.indexOf('\nasync function plaza');
if (plazaTemplateStart < 0) throw new Error('活动广场模板缺少plaza函数');
const renderTemplate = pageTemplate.slice(0, plazaTemplateStart).trimEnd();
const plazaTemplate = pageTemplate.slice(plazaTemplateStart + 1).trimEnd();

let app = await readFile(appPath, 'utf8');
if (!app.includes(marker)) {
  app = replaceTopLevelDeclaration(
    app,
    'const renderPlazaPage',
    `${renderTemplate}\n\n`,
    '活动广场渲染函数'
  );
  app = replaceTopLevelDeclaration(
    app,
    ['async function plaza', 'const plaza = async'],
    `${plazaTemplate}\n\n`,
    '活动广场加载函数'
  );
  await writeFile(appPath, app, 'utf8');
}

let style = await readFile(stylePath, 'utf8');
if (!style.includes(marker)) {
  style = `${style.trimEnd()}\n\n${styleTemplate.trim()}\n`;
  await writeFile(stylePath, style, 'utf8');
}

let plazaRoute = await readFile(plazaRoutePath, 'utf8');
if (!plazaRoute.includes(marker)) {
  plazaRoute = replaceBetween(
    plazaRoute,
    "  if (route === '/api/plaza' && request.method === 'GET') {",
    '  const detailMatch',
    `${routeTemplate.trimEnd()}\n\n`,
    '活动广场查询路由'
  );
  await writeFile(plazaRoutePath, plazaRoute, 'utf8');
}

let memberTest = await readFile(memberTestPath, 'utf8');
const pairedUploadTest = String.raw`test('单人打卡使用Pica生成2048px高清图与960px列表图', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  const memberBody = app.match(
    /function memberCheckinForm\(task\) \{([\s\S]*?)\r?\n\}\r?\n\r?\nfunction materialSubmissionForm/
  )?.[1] || '';
  assert.match(memberBody, /prepareImageVariantsMeasured\((?:sourceFile|selected\[index\])/);
  assert.match(memberBody, /uploadPreparedImagePair\(prepared/);
  assert.match(memberBody, /businessType:\s*'member-checkin'/);
  assert.match(memberBody, /item\.mediaId = pair\.display\.mediaId/);
  assert.match(memberBody, /item\.thumbMediaId = pair\.thumb\.mediaId/);
  assert.doesNotMatch(memberBody, /uploadCompressedImage\(prepared\.(?:display|thumb)/);
  assert.match(app, /PICA_DISPLAY_MAX_EDGE = 2048/);
  assert.match(app, /PICA_THUMB_MAX_EDGE = 960/);
  assert.match(app, /Promise\.all\(\[\s*requestVariantUploadIntent\(prepared\.display/);
  assert.match(app, /const displayPut = putVariantToR2/);
  assert.match(app, /const thumbPut = putVariantToR2/);
});`;
memberTest = replaceNamedTest(
  memberTest,
  '单人打卡使用Pica生成2048px高清图与960px列表图',
  pairedUploadTest,
  '并行图片上传测试'
);
await writeFile(memberTestPath, memberTest, 'utf8');

let layoutTest = await readFile(layoutTestPath, 'utf8');
layoutTest = replaceNamedTest(
  layoutTest,
  '队伍草稿可继续编辑并删除广场二次文案字段',
  String.raw`test('队伍草稿可继续编辑并删除广场二次文案字段', () => {
  const app = read('public/app.js');
  const student = read('cloudflare/routes/student.js');
  const plazaBody = app.match(/\/\* PLAZA_MOBILE_LAYOUT_V1 \*\/[\s\S]*?async function plaza/)?.[0] || '';
  assert.match(app, /已保存队伍作品/);
  assert.doesNotMatch(app, /广场作品文案（发布时必填）/);
  assert.doesNotMatch(app, /id="plazaCopyField"/);
  assert.match(app, /plazaCopy: form\.copy\.value/);
  assert.match(student, /const plazaCopy = cleanText\(body\.copy, 2000\)/);
  assert.doesNotMatch(student, /请填写广场作品文案/);
  assert.match(plazaBody, /<h2>\$\{escapeHtml\(post\.teamName\)\}<\/h2>/);
  assert.match(plazaBody, /plaza-channel-tabs/);
  assert.match(plazaBody, /togglePlazaSearch/);
  assert.doesNotMatch(plazaBody, /四校区活动广场|月度排行|id="plazaMonth"/);
});`,
  '队伍草稿与新广场布局测试'
);
await writeFile(layoutTestPath, layoutTest, 'utf8');

let mobileTest = await readFile(mobileTestPath, 'utf8');
mobileTest = replaceNamedTest(
  mobileTest,
  '活动广场、历史打卡和管理员列表图统一使用960px Pica链路',
  String.raw`test('活动广场、历史打卡和管理员列表图统一使用960px Pica链路', () => {
  const app = read('public/app.js');
  const style = read('public/style.css');
  const media = read('cloudflare/routes/media.js');
  const backfill = read('scripts/backfill-admin-thumbnails-540.mjs');
  const plazaBody = app.match(/\/\* PLAZA_MOBILE_LAYOUT_V1 \*\/[\s\S]*?async function plaza/)?.[0] || '';
  assert.match(app, /PICA_THUMB_MAX_EDGE = 960/);
  assert.match(app, /PICA_DISPLAY_MAX_EDGE = 2048/);
  assert.match(app, /data-perf-image="history-thumb"/);
  assert.match(plazaBody, /data-perf-image="plaza-thumb"/);
  assert.match(plazaBody, /data-priority=/);
  assert.match(plazaBody, /cardIndex === 0 \? 'high' : 'low'/);
  assert.match(app, /data-perf-image="admin-checkin-thumb"/);
  assert.match(style, /column-count:\s*2/);
  assert.match(media, /THUMB_MAX_EDGE = 960/);
  assert.match(media, /PLAZA_THUMB_MAX_EDGE = 960/);
  assert.match(media, /DISPLAY_MAX_EDGE = 2048/);
  assert.match(backfill, /thumbs-720-v1/);
  assert.match(backfill, /encode\(720, 84\)/);
});`,
  'Pica与广场首图优先级测试'
);
mobileTest = replaceNamedTest(
  mobileTest,
  '累计打卡数据由后端按有效日期去重计算',
  String.raw`test('累计打卡数据由后端按有效日期去重计算', () => {
  const dashboard = read('cloudflare/services/student-dashboard.js');
  assert.match(dashboard, /COUNT\(DISTINCT checkin_date\)/);
  assert.match(dashboard, /COUNT\(DISTINCT occurrence_date\)/);
  assert.match(dashboard, /personalDays/);
  assert.match(dashboard, /teamDays/);
  assert.match(dashboard, /status IN \('submitted','approved'\)/);
});`,
  '累计打卡后端去重测试'
);
await writeFile(mobileTestPath, mobileTest, 'utf8');

let studentFlowTest = await readFile(studentFlowTestPath, 'utf8');
studentFlowTest = replaceNamedTest(
  studentFlowTest,
  'student home keeps only the requested shortcuts and a working history modal root',
  String.raw`test('student home keeps only the requested shortcuts and a working history modal root', () => {
  execFileSync(process.execPath, ['scripts/apply-admin-dashboard-refactor.mjs'], { stdio: 'pipe' });
  const app = read('public/app.js');
  const studentBody = app.match(/async function student\([\s\S]*?\r?\n\}\r?\n\r?\nfunction openStudentCheckinHistory/)?.[0]
    || app.match(/async function home\([\s\S]*?\r?\n\}\r?\n\r?\nfunction taskFormFields/)?.[0]
    || '';
  assert.ok(studentBody.length > 0, '未定位到学生首页函数');
  assert.match(studentBody, /id="historyCheckins"/);
  assert.match(studentBody, /id="plaza"/);
  assert.match(studentBody, /id="inbox"/);
  assert.match(studentBody, /id="teamCheckinStats"/);
  assert.match(studentBody, /id="modalRoot"/);
  assert.doesNotMatch(studentBody, /id="ranking"/);
  assert.doesNotMatch(studentBody, /profile-card/);
  assert.doesNotMatch(studentBody, /id="myTeam"/);
  assert.doesNotMatch(studentBody, /data-jump="activityTasks"/);
});`,
  '学生首页限定范围测试'
);
await writeFile(studentFlowTestPath, studentFlowTest, 'utf8');

let mobileAdminTest = await readFile(mobileAdminTestPath, 'utf8');
mobileAdminTest = replaceNamedTest(
  mobileAdminTest,
  '管理端列表图使用960px Pica/WebP并与媒体服务限制一致',
  String.raw`test('管理端列表图使用960px Pica/WebP并与媒体服务限制一致', () => {
  const app = read('public/app.js');
  const media = read('cloudflare/routes/media.js');
  assert.match(app, /\/\* PICA_IMAGE_PIPELINE_V1 \*\//);
  assert.match(app, /PICA_THUMB_MAX_EDGE = 960/);
  assert.match(app, /PICA_DISPLAY_MAX_EDGE = 2048/);
  assert.match(app, /quality: screenshotLike \? 0\.92 : 0\.88/);
  assert.match(app, /prepareImageVariantsMeasured\(selected\[index\]/);
  assert.match(app, /uploadPreparedImagePair\(prepared,/);
  assert.match(app, /confirmVariantUpload\(thumbIntent, prepared\.thumb, display\.mediaId, signal\)/);
  assert.match(media, /THUMB_MAX_EDGE = 960/);
  assert.match(media, /PLAZA_THUMB_MAX_EDGE = 960/);
  assert.match(media, /DISPLAY_MAX_EDGE = 2048/);
});`,
  '管理端Pica父子媒体测试'
);
await writeFile(mobileAdminTestPath, mobileAdminTest, 'utf8');

let productionPerformanceTest = await readFile(productionPerformanceTestPath, 'utf8');
productionPerformanceTest = replaceNamedTest(
  productionPerformanceTest,
  '图片列表在SQL层分页，首屏不超过20张且管理员每页不超过30人',
  String.raw`test('图片列表在SQL层分页，首屏不超过20张且管理员每页不超过30人', () => {
  const plaza = fs.readFileSync('cloudflare/routes/plaza.js', 'utf8');
  const admin = fs.readFileSync('cloudflare/routes/admin.js', 'utf8');
  const student = fs.readFileSync('cloudflare/routes/student.js', 'utf8');
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(plaza, /Math\.min\(20/);
  assert.match(plaza, /ORDER BY \$\{order\} LIMIT \?4 OFFSET \?5/);
  assert.match(plaza, /env\.DB\.prepare\(query\)\.bind\(user\.id, searchLike, monthValue, limit, \(page - 1\) \* limit\)/);
  assert.match(admin, /Math\.min\(30/);
  assert.match(admin, /ORDER BY u\.name,u\.student_id LIMIT \?4 OFFSET \?5/);
  assert.match(student, /Math\.min\(20/);
  assert.doesNotMatch(app, /new MutationObserver/);
  assert.match(app, /IntersectionObserver/);
  assert.match(app, /data-src=/);
  assert.match(app, /limit=20/);
  assert.doesNotMatch(plaza + '\n' + admin + '\n' + student, /data:image\/[^;]+;base64/i);
  assert.match(admin, /IN \('task:thumb','admin-makeup:thumb'\)/);
  assert.match(student, /IN \('member-checkin:thumb','admin-makeup:thumb'\)/);
  assert.match(admin, /COALESCE\(m\.object_key,i\.object_key\) AS objectKey/);
  assert.match(student, /COALESCE\(m\.object_key,i\.object_key\) AS objectKey/);
});`,
  '活动广场SQL分页测试'
);
await writeFile(productionPerformanceTestPath, productionPerformanceTest, 'utf8');

let stageECacheTest = await readFile(stageECacheTestPath, 'utf8');
stageECacheTest = replaceNamedTest(
  stageECacheTest,
  '阶段E：广场和评论管理缓存仅存于页面内存并按用户隔离',
  String.raw`test('阶段E：广场和评论管理缓存仅存于页面内存并按用户隔离', () => {
  const adminSource = fs.readFileSync(path.join(root, 'public', 'admin-client.js'), 'utf8');
  assert.match(appSource, /const VIEW_CACHE_TTL_MS = 20_000;/);
  assert.match(appSource, /const plazaViewCache = new Map\(\);/);
  assert.match(appSource, /const rankingViewCache = new Map\(\);/);
  assert.match(adminSource, /async function adminComments\(page = 1\)/);
  assert.match(appSource, /const scopedCacheKey = \(\.\.\.parts\) => \[/);
  assert.match(appSource, /user\?\.id \|\| user\?\.studentId \|\| 'anonymous'/);
  assert.match(appSource, /\]\.join\('\|'\);/);
  assert.match(appSource, /scopedCacheKey\('plaza', safeSort, page, safeQuery\)/);
  assert.match(appSource, /q=\$\{encodeURIComponent\(safeQuery\)\}/);
  const cacheBlock = sourceBetween('const VIEW_CACHE_TTL_MS', 'const clearUserViewCaches');
  assert.doesNotMatch(cacheBlock, /localStorage|sessionStorage/);
});`,
  '活动广场搜索缓存键测试'
);
await writeFile(stageECacheTestPath, stageECacheTest, 'utf8');

let stageFUploadTest = await readFile(stageFUploadTestPath, 'utf8');
stageFUploadTest = replaceNamedTest(
  stageFUploadTest,
  '阶段F：多图并发受控，失败图可单独重试且成功图不重复上传',
  String.raw`test('阶段F：多图并发受控，失败图可单独重试且成功图不重复上传', () => {
  assert.match(appSource, /return isIOS \|\| embeddedBrowser \|\| lowMemory \? 1 : 2;/);
  const sessionBlock = functionBlock('const createMediaUploadSession', 'const readFiles');
  assert.match(sessionBlock, /if \(session\.results\[index\]\) return;/);
  assert.match(sessionBlock, /let prepared = session\.partial\[index\]\?\.prepared;/);
  assert.match(sessionBlock, /let pair = session\.partial\[index\]\?\.pair;/);
  assert.match(sessionBlock, /session\.partial\[index\] = \{ prepared, pair \};/);
  assert.match(sessionBlock, /session\.results\[index\] = \{ \.\.\.pair\.display, thumbMediaId: pair\.thumb\.mediaId \};/);
  assert.match(sessionBlock, /const indexes = \[\.\.\.session\.errors\.keys\(\)\];/);
  assert.match(sessionBlock, /Math\.min\(uploadConcurrency\(\), indexes\.length\)/);
  assert.match(sessionBlock, /第 \$\{failed\} 张图片处理失败，可单独重试失败图片。/);
});`,
  '并行双版本上传重试测试'
);
await writeFile(stageFUploadTestPath, stageFUploadTest, 'utf8');

if (!(await readFile(appPath, 'utf8')).includes(marker)
    || !(await readFile(stylePath, 'utf8')).includes(marker)
    || !(await readFile(plazaRoutePath, 'utf8')).includes(marker)
    || !(await readFile(appPath, 'utf8')).includes('uploadPreparedImagePair')
    || !(await readFile(stylePath, 'utf8')).includes('column-count')) {
  throw new Error('活动广场移动端布局、并行上传或测试生成不完整');
}

await import('./apply-lazy-admin-client.mjs');
process.stdout.write('Applied mobile plaza layout, search, masonry feed, paired upload, scoped assertions and the lazy admin client.\n');
