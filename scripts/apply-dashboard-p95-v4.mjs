import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const file = path.join(root, 'cloudflare/services/student-dashboard.js');
const marker = '/* STRICT_P95_DASHBOARD_BATCH_V4 */';
const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next !== source) return next;
  if (typeof search === 'string') {
    const windowsSearch = search.replaceAll('\n', '\r\n');
    const windowsNext = source.replace(windowsSearch, replacement);
    if (windowsNext !== source) return windowsNext;
  }
  throw new Error(`未找到${label}，已停止以避免误改`);
};

let source = fs.readFileSync(file, 'utf8');
if (!source.includes(marker)) {
  const taskAnchor = 'export const buildStudentTasks = async (env, user, options = {}) => {';
  const teamContextHelper = `${marker}\nexport const buildStudentTeamContext = async (env, user) => {\n  if (user.role !== 'student' || user.trackId !== 'interaction') {\n    return { team: null, members: [], teamCount: null };\n  }\n  const [countRow, memberPage] = await Promise.all([\n    env.DB.prepare('SELECT COUNT(*) AS total FROM teams').first(),\n    env.DB.prepare(\n      \`SELECT t.id AS teamId,t.name AS teamName,t.invite_code AS inviteCode,\n              t.member_limit AS memberLimit,t.captain_user_id AS captainId,t.created_at AS teamCreatedAt,\n              u.id AS memberId,u.student_id AS memberStudentId,u.name AS memberName,u.campus AS memberCampus,\n              u.track_id AS memberTrackId,u.status AS memberStatus,u.created_at AS memberCreatedAt\n         FROM team_members mine\n         JOIN teams t ON t.id=mine.team_id\n         LEFT JOIN team_members tm ON tm.team_id=t.id\n         LEFT JOIN users u ON u.id=tm.user_id\n        WHERE mine.user_id=?1\n        ORDER BY tm.joined_at,u.student_id\`\n    ).bind(user.id).all()\n  ]);\n  const rows = memberPage.results || [];\n  if (!rows.length || !rows[0].teamId) {\n    return { team: null, members: [], teamCount: Number(countRow?.total || 0) };\n  }\n  const first = rows[0];\n  const team = {\n    id: first.teamId, name: first.teamName, inviteCode: first.inviteCode,\n    memberLimit: first.memberLimit, captainId: first.captainId, createdAt: first.teamCreatedAt\n  };\n  const members = rows.filter((row) => row.memberId).map((row) => ({\n    id: row.memberId, studentId: row.memberStudentId, name: row.memberName,\n    campus: row.memberCampus, trackId: row.memberTrackId, status: row.memberStatus,\n    createdAt: row.memberCreatedAt\n  }));\n  return { team, members, teamCount: Number(countRow?.total || 0) };\n};\n\n${taskAnchor}`;
  source = replaceOnce(source, taskAnchor, teamContextHelper, '共享队伍上下文位置');

  const taskQueryOld = `  const { results } = await env.DB.prepare(\n    \`SELECT id,name,description,track_id AS trackId,starts_at AS startsAt,ends_at AS endsAt,\n            allow_late AS allowLate,image_limit AS imageLimit,copy_requirement AS copyRequirement,\n            submission_type AS submissionType,status,schedule_json AS scheduleJson\n       FROM tasks WHERE status='published' AND (?1='admin' OR track_id=?2)\n      ORDER BY starts_at DESC LIMIT 100\`\n  ).bind(user.role, user.trackId || '').all();\n  const today = options.date || shanghaiDate();\n  const makeupAllowed = user.role === 'student'\n    ? await hasMakeupPermission(env, user.id, today) : false;`;
  const taskQueryNew = `  const today = options.date || shanghaiDate();\n  const [taskPage, makeupAllowed] = await Promise.all([\n    env.DB.prepare(\n      \`SELECT id,name,description,track_id AS trackId,starts_at AS startsAt,ends_at AS endsAt,\n              allow_late AS allowLate,image_limit AS imageLimit,copy_requirement AS copyRequirement,\n              submission_type AS submissionType,status,schedule_json AS scheduleJson\n         FROM tasks WHERE status='published' AND (?1='admin' OR track_id=?2)\n        ORDER BY starts_at DESC LIMIT 100\`\n    ).bind(user.role, user.trackId || '').all(),\n    user.role === 'student' ? hasMakeupPermission(env, user.id, today) : Promise.resolve(false)\n  ]);\n  const results = taskPage.results || [];`;
  if (source.includes(taskQueryOld)) {
    source = source.replace(taskQueryOld, taskQueryNew);
  } else {
    throw new Error('未找到任务与补签权限并行区块，已停止以避免误改');
  }

  source = replaceOnce(
    source,
    `  const team = needsTeam ? await teamForUser(env, user.id) : null;\n  const members = team ? await membersForTeam(env, team.id) : [];`,
    `  const sharedTeamContext = options.teamContext || null;\n  const team = needsTeam\n    ? (sharedTeamContext ? sharedTeamContext.team : await teamForUser(env, user.id))\n    : null;\n  const members = team\n    ? (sharedTeamContext && sharedTeamContext.team?.id === team.id\n      ? sharedTeamContext.members\n      : await membersForTeam(env, team.id))\n    : [];`,
    '任务共享队伍上下文'
  );

  const submissionsAnchor = '  const submissions = [];';
  source = replaceOnce(
    source,
    submissionsAnchor,
    `  const checkinsPromise = (team && taskIds.length)\n    ? (async () => {\n      const rows = [];\n      for (const taskChunk of chunks(taskIds, 75)) {\n        const taskIn = placeholders(taskChunk.length, 2);\n        const occurrenceStart = taskChunk.length + 2;\n        const occurrenceIn = placeholders(occurrenceDates.length, occurrenceStart);\n        const page = await env.DB.prepare(\n          \`SELECT user_id AS userId,id,task_id AS taskId,occurrence_date AS occurrenceDate\n             FROM member_checkins\n            WHERE team_id=?1 AND task_id IN (\${taskIn})\n              AND occurrence_date IN (\${occurrenceIn})\`\n        ).bind(team.id, ...taskChunk, ...occurrenceDates).all();\n        rows.push(...page.results);\n      }\n      return rows;\n    })()\n    : Promise.resolve([]);\n\n${submissionsAnchor}`,
    '成员打卡并发查询启动位置'
  );

  const imageOld = `  const imagesBySubmission = await submissionImagesForIds(\n    env,\n    submissions.map((submission) => submission.id),\n    user\n  );`;
  const imageNew = `  const imagesBySubmission = options.includeImages === false\n    ? new Map(submissions.map((submission) => [submission.id, []]))\n    : await submissionImagesForIds(\n      env,\n      submissions.map((submission) => submission.id),\n      user\n    );`;
  source = replaceOnce(source, imageOld, imageNew, '首页任务图片按需读取区块');

  const checkinsOld = `  const checkins = [];\n  if (team && taskIds.length) {\n    for (const taskChunk of chunks(taskIds, 75)) {\n      const taskIn = placeholders(taskChunk.length, 2);\n      const occurrenceStart = taskChunk.length + 2;\n      const occurrenceIn = placeholders(occurrenceDates.length, occurrenceStart);\n      const page = await env.DB.prepare(\n        \`SELECT user_id AS userId,id,task_id AS taskId,occurrence_date AS occurrenceDate\n           FROM member_checkins\n          WHERE team_id=?1 AND task_id IN (\${taskIn})\n            AND occurrence_date IN (\${occurrenceIn})\`\n      ).bind(team.id, ...taskChunk, ...occurrenceDates).all();\n      checkins.push(...page.results);\n    }\n  }`;
  source = replaceOnce(source, checkinsOld, '  const checkins = await checkinsPromise;', '成员打卡串行等待区块');

  source = replaceOnce(
    source,
    'export const buildTeamSummary = async (env, user, config) => {',
    'export const buildTeamSummary = async (env, user, config, options = {}) => {',
    '队伍摘要共享上下文签名'
  );
  source = replaceOnce(
    source,
    `  if (user.trackId !== 'interaction') return null;\n  const [count, team] = await Promise.all([`,
    `  if (user.trackId !== 'interaction') return null;\n  const sharedTeamContext = options.teamContext || null;\n  if (sharedTeamContext) {\n    const team = sharedTeamContext.team;\n    return {\n      teamCount: Number(sharedTeamContext.teamCount || 0),\n      maxTeams: Number(config.maxTeams || 50),\n      team: team ? { ...team, members: sharedTeamContext.members, memberCount: sharedTeamContext.members.length } : null\n    };\n  }\n  const [count, team] = await Promise.all([`,
    '队伍摘要共享上下文分支'
  );

  const statsOld = `const buildCheckinStats = async (env, user, teamSummary) => {\n  const personal = user.trackId === 'health'\n    ? await env.DB.prepare("SELECT COUNT(DISTINCT checkin_date) AS total FROM checkins WHERE user_id=?1 AND status!='rejected'").bind(user.id).first()\n    : await env.DB.prepare("SELECT COUNT(DISTINCT occurrence_date) AS total FROM member_checkins WHERE user_id=?1 AND status!='rejected'").bind(user.id).first();\n  let teamDays = 0;\n  if (teamSummary?.team?.id) {\n    const team = await env.DB.prepare(\n      "SELECT COUNT(DISTINCT COALESCE(NULLIF(occurrence_date,''),substr(submitted_at,1,10))) AS total FROM task_submissions WHERE owner_type='team' AND owner_id=?1 AND status IN ('submitted','approved')"\n    ).bind(teamSummary.team.id).first();\n    teamDays = Number(team?.total || 0);\n  }\n  return { personalDays: Number(personal?.total || 0), teamDays };\n};`;
  const statsNew = `const buildCheckinStats = async (env, user, teamSummary) => {\n  const personalPromise = user.trackId === 'health'\n    ? env.DB.prepare("SELECT COUNT(DISTINCT checkin_date) AS total FROM checkins WHERE user_id=?1 AND status!='rejected'").bind(user.id).first()\n    : env.DB.prepare("SELECT COUNT(DISTINCT occurrence_date) AS total FROM member_checkins WHERE user_id=?1 AND status!='rejected'").bind(user.id).first();\n  const teamPromise = teamSummary?.team?.id\n    ? env.DB.prepare(\n      "SELECT COUNT(DISTINCT COALESCE(NULLIF(occurrence_date,''),substr(submitted_at,1,10))) AS total FROM task_submissions WHERE owner_type='team' AND owner_id=?1 AND status IN ('submitted','approved')"\n    ).bind(teamSummary.team.id).first()\n    : Promise.resolve(null);\n  const [personal, team] = await Promise.all([personalPromise, teamPromise]);\n  return { personalDays: Number(personal?.total || 0), teamDays: Number(team?.total || 0) };\n};`;
  if (source.includes(statsOld)) source = source.replace(statsOld, statsNew);
  else if (!source.includes('const [personal, team] = await Promise.all([personalPromise, teamPromise]);')) {
    throw new Error('未找到累计打卡并行统计区块，已停止以避免误改');
  }

  const dashboardOld = `export const buildStudentDashboard = async (env, user, options = {}) => {\n  const date = options.date || shanghaiDate();\n  const config = options.config || await readConfig(env);\n  const [teamSummary, taskResult] = await Promise.all([\n    buildTeamSummary(env, user, config),\n    buildStudentTasks(env, user, { config, date })\n  ]);\n  const checkinStats = await buildCheckinStats(env, user, teamSummary);`;
  const dashboardNew = `export const buildStudentDashboard = async (env, user, options = {}) => {\n  const date = options.date || shanghaiDate();\n  const [config, teamContext] = await Promise.all([\n    options.config ? Promise.resolve(options.config) : readConfig(env),\n    options.teamContext ? Promise.resolve(options.teamContext) : buildStudentTeamContext(env, user)\n  ]);\n  const teamSummary = await buildTeamSummary(env, user, config, { teamContext });\n  const [taskResult, checkinStats] = await Promise.all([\n    buildStudentTasks(env, user, { config, date, teamContext, includeImages: false }),\n    buildCheckinStats(env, user, teamSummary)\n  ]);`;
  if (source.includes(dashboardOld)) {
    source = source.replace(dashboardOld, dashboardNew);
  } else {
    source = replaceOnce(
      source,
      /export const buildStudentDashboard = async \(env, user, options = \{\}\) => \{[\s\S]*?\n  return \{/,
      `export const buildStudentDashboard = async (env, user, options = {}) => {
  const date = options.date || shanghaiDate();
  const [config, teamContext] = await Promise.all([
    options.config ? Promise.resolve(options.config) : readConfig(env),
    options.teamContext ? Promise.resolve(options.teamContext) : buildStudentTeamContext(env, user)
  ]);
  const teamSummary = await buildTeamSummary(env, user, config, { teamContext });
  const [taskResult, materialTasks, checkinStats] = await Promise.all([
    buildStudentTasks(env, user, { config, date, teamContext, includeImages: false }),
    buildStudentMaterialTasks(env, user),
    buildCheckinStats(env, user, teamSummary)
  ]);
  return {`,
      '最终学生Dashboard并行聚合区块'
    );
  }

  fs.writeFileSync(file, source, 'utf8');
}

const output = fs.readFileSync(file, 'utf8');
const minimalHome = output.includes('/* STUDENT_HOME_MINIMAL_SCOPE_V1 */');
const validMinimalHome = minimalHome
  && output.includes('buildStudentTeamContext')
  && output.includes('const [taskPage, makeupAllowed] = await Promise.all([')
  && output.includes('options.includeImages === false')
  && output.includes('const checkins = await checkinsPromise;')
  && output.includes('includeImages: false')
  && output.includes('teamMembers:')
  && !/export const buildStudentDashboard = async[\s\S]*?(?:materialTasks|checkinStats)/.test(output);
const validLegacyHome = !minimalHome
  && output.includes(marker)
  && output.includes('buildStudentTeamContext')
  && output.includes('const [taskPage, makeupAllowed] = await Promise.all([')
  && output.includes('options.includeImages === false')
  && output.includes('const checkins = await checkinsPromise;')
  && output.includes('const [personal, team] = await Promise.all([personalPromise, teamPromise]);')
  && output.includes('includeImages: false')
  && output.includes('buildTeamSummary(env, user, config, { teamContext })');
if (!validMinimalHome && !validLegacyHome) throw new Error('学生Dashboard严格p95聚合优化生成不完整');

console.log('Applied strict p95 Dashboard V4: shared team context, overlapped stats/checkins and no unused home image signing.');
