import { readFileSync } from 'node:fs';

const app = readFileSync('public/app.js', 'utf8');
const studentHome = app.match(/async function student\([\s\S]*?\r?\n}\r?\n\r?\nfunction openStudentCheckinHistory/)?.[0] || '';

const failures = [];
const requireMatch = (source, pattern, message) => {
  if (!pattern.test(source)) failures.push(message);
};
const forbidMatch = (source, pattern, message) => {
  if (pattern.test(source)) failures.push(message);
};

requireMatch(app, /\/\* STUDENT_HOME_CANONICAL_V3 \*\//, '缺少学生首页唯一版本标记');
requireMatch(studentHome, /id="historyCheckins"/, '缺少个人累计入口');
requireMatch(studentHome, /id="plaza"/, '缺少活动广场入口');
requireMatch(studentHome, /id="inbox"/, '缺少信息箱入口');
requireMatch(studentHome, /id="teamCheckinStats"/, '缺少队伍累计入口');
requireMatch(studentHome, /id="myTeam"/, '缺少队伍成员区域');
requireMatch(studentHome, /<h2>队伍成员<\/h2>/, '队伍成员标题不正确');
requireMatch(studentHome, /id="activityTasks"/, '缺少今日打卡区域');
requireMatch(studentHome, /data-member-task=/, '缺少队员进入打卡入口');
requireMatch(studentHome, /data-task=/, '缺少队长汇总提交入口');
requireMatch(studentHome, /id="modalRoot"/, '缺少历史记录弹层容器');

forbidMatch(studentHome, /id="ranking"/, '学生首页不应显示排行榜入口');
forbidMatch(studentHome, /student-top-actions/, '学生首页残留旧操作栏');
forbidMatch(studentHome, /profile-card|我的资料/, '学生首页残留我的资料');
forbidMatch(studentHome, /<div class="team-summary">/, '队伍成员区域残留队伍概要');
forbidMatch(studentHome, /<span>队伍名称<\/span>|<span>邀请码<\/span>|<span>成员人数<\/span>/, '队伍成员区域残留队伍名称、邀请码或成员人数');
forbidMatch(studentHome, /最终截图证明|data-material=|const materialResult|const materialStatus/, '学生首页残留最终截图证明');
forbidMatch(studentHome, /teamListResult/, '学生首页残留旧队伍统计变量');

requireMatch(app, /async function rankings\(/, '排行榜底层功能被误删');
requireMatch(app, /function materialSubmissionForm\(/, '截图材料底层功能被误删');
requireMatch(app, /const query = typeof state\.plazaQuery === 'string' \? state\.plazaQuery : '';/, '活动广场返回参数修复缺失');
requireMatch(app, /state\.plazaMonth \|\| '', query\)/, '活动广场返回未使用字符串查询参数');
forbidMatch(app, /state\.plazaMonth \|\| '', \{ preserveScroll: false \}\)/, '活动广场仍会把对象当成搜索词');

if (failures.length) {
  console.error('学生首页唯一版本校验失败：');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('学生首页唯一版本校验通过：指定入口、队伍成员和打卡均保留，旧模块未回流。');
