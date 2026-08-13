import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* STUDENT_HOME_MINIMAL_SCOPE_V1 */';
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
const write = (relativePath, source) => fs.writeFileSync(path.join(root, relativePath), source, 'utf8');
const replaceSection = (source, startAnchor, endAnchor, replacement, label) => {
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(endAnchor, start + startAnchor.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`未找到${label}，已停止以避免误改`);
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
};

{
  let app = read('public/app.js');
  const studentTemplate = read('templates/student-home-minimal-v1.txt').trimEnd() + '\n\n';
  app = replaceSection(
    app,
    'async function student(',
    'function openStudentCheckinHistory()',
    studentTemplate,
    '学生首页函数'
  );
  app = app.replace(
    "  && Array.isArray(dashboard.tasks)\n  && Array.isArray(dashboard.materialTasks);",
    "  && Array.isArray(dashboard.tasks)\n  && Array.isArray(dashboard.teamMembers);"
  );
  const oldRestore = "  void plaza(state.plazaSort || 'latest', Math.max(1, Number(state.plazaPage || 1)), state.plazaMonth || '', { preserveScroll: false })";
  const newRestore = "  void plaza(state.plazaSort || 'latest', Math.max(1, Number(state.plazaPage || 1)), state.plazaMonth || '', '')";
  if (!app.includes(oldRestore) && !app.includes(newRestore)) throw new Error('未找到活动广场返回调用');
  app = app.replace(oldRestore, newRestore);
  if (!app.includes(marker)) app = `${marker}\n${app}`;
  if (/id="(?:historyCheckins|inbox|teamCheckinStats|ranking|myTeam)"/.test(studentTemplate)
      || /我的资料|最终截图证明|个人累计|队伍累计|邀请码/.test(studentTemplate)) {
    throw new Error('学生首页仍包含已移除模块');
  }
  write('public/app.js', app);
}

{
  let dashboard = read('cloudflare/services/student-dashboard.js');
  const teamContext = `export const buildStudentTeamContext = async (env, user) => {
  if (user.role !== 'student' || user.trackId !== 'interaction') {
    return { team: null, members: [] };
  }
  const memberPage = await env.DB.prepare(
    \`SELECT t.id AS teamId,t.captain_user_id AS captainId,
            u.id AS memberId,u.student_id AS memberStudentId,u.name AS memberName,u.campus AS memberCampus,
            u.track_id AS memberTrackId,u.status AS memberStatus
       FROM team_members mine
       JOIN teams t ON t.id=mine.team_id
       LEFT JOIN team_members tm ON tm.team_id=t.id
       LEFT JOIN users u ON u.id=tm.user_id
      WHERE mine.user_id=?1
      ORDER BY tm.joined_at,u.student_id\`
  ).bind(user.id).all();
  const rows = memberPage.results || [];
  if (!rows.length || !rows[0].teamId) return { team: null, members: [] };
  const first = rows[0];
  return {
    team: { id: first.teamId, captainId: first.captainId },
    members: rows.filter((row) => row.memberId).map((row) => ({
      id: row.memberId, studentId: row.memberStudentId, name: row.memberName,
      campus: row.memberCampus, trackId: row.memberTrackId, status: row.memberStatus
    }))
  };
};

`;
  dashboard = replaceSection(
    dashboard,
    'export const buildStudentTeamContext = async',
    'export const buildStudentTasks = async',
    teamContext,
    '学生队伍成员聚合'
  );

  const loginDashboard = `export const buildStudentDashboardForLogin = async (env, user) => {
  if (user.role !== 'student' || user.trackId !== 'interaction' || typeof env.DB.batch !== 'function') {
    return buildStudentDashboard(env, user);
  }
  const date = shanghaiDate();
  try {
    const configPromise = readConfig(env);
    const statements = [
      env.DB.prepare(
        \`SELECT t.id AS teamId,t.captain_user_id AS captainId,
                u.id AS memberId,u.student_id AS memberStudentId,u.name AS memberName,u.campus AS memberCampus,
                u.track_id AS memberTrackId,u.status AS memberStatus
           FROM (SELECT 1) seed
           LEFT JOIN team_members mine ON mine.user_id=?1
           LEFT JOIN teams t ON t.id=mine.team_id
           LEFT JOIN team_members tm ON tm.team_id=t.id
           LEFT JOIN users u ON u.id=tm.user_id
          ORDER BY tm.joined_at,u.student_id\`
      ).bind(user.id),
      env.DB.prepare(
        \`SELECT id,name,description,track_id AS trackId,starts_at AS startsAt,ends_at AS endsAt,
                allow_late AS allowLate,image_limit AS imageLimit,copy_requirement AS copyRequirement,
                submission_type AS submissionType,status,schedule_json AS scheduleJson
           FROM tasks WHERE status='published' AND track_id=?1
          ORDER BY starts_at DESC LIMIT 100\`
      ).bind(user.trackId),
      env.DB.prepare(
        'SELECT enabled FROM makeup_permissions WHERE user_id=?1 AND checkin_date=?2'
      ).bind(user.id, date),
      env.DB.prepare(
        \`SELECT user_id AS userId,id,task_id AS taskId,occurrence_date AS occurrenceDate
           FROM member_checkins
          WHERE team_id=(SELECT team_id FROM team_members WHERE user_id=?1 LIMIT 1)
            AND task_id IN (SELECT id FROM tasks WHERE status='published' AND track_id=?2)
            AND occurrence_date IN (?3,'')\`
      ).bind(user.id, user.trackId, date),
      env.DB.prepare(
        \`SELECT id,task_id AS taskId,owner_type AS ownerType,owner_id AS ownerId,
                copy_text AS copy,plaza_copy AS plazaCopy,meal_type AS mealType,
                is_public AS isPublic,status,version,occurrence_date AS occurrenceDate,
                submitted_at AS submittedAt,review_note AS reviewNote
           FROM task_submissions
          WHERE task_id IN (SELECT id FROM tasks WHERE status='published' AND track_id=?1)
            AND occurrence_date IN (?2,'')
            AND ((owner_type='user' AND owner_id=?3) OR
                 (owner_type='team' AND owner_id=(SELECT team_id FROM team_members WHERE user_id=?3 LIMIT 1)))\`
      ).bind(user.trackId, date, user.id)
    ];
    const [config, pages] = await Promise.all([configPromise, env.DB.batch(statements)]);
    const teamRows = pages[0]?.results || [];
    const first = teamRows[0] || null;
    const team = first?.teamId ? { id: first.teamId, captainId: first.captainId } : null;
    const members = teamRows.filter((row) => row.memberId).map((row) => ({
      id: row.memberId, studentId: row.memberStudentId, name: row.memberName,
      campus: row.memberCampus, trackId: row.memberTrackId, status: row.memberStatus
    }));
    const teamContext = { team, members };
    const taskResult = await buildStudentTasks(env, user, {
      config, date, teamContext, includeImages: false,
      taskPage: { results: pages[1]?.results || [] },
      makeupAllowed: Boolean(pages[2]?.results?.[0]?.enabled),
      checkins: pages[3]?.results || [],
      submissions: pages[4]?.results || []
    });
    return {
      version: 1, user, config, tracks: TRACKS, date, time: shanghaiTime(),
      teamMembers: members.map(({ id, studentId, name, campus, status }) => ({ id, studentId, name, campus, status })),
      tasks: taskResult.tasks,
      switches: taskResult.switches
    };
  } catch {
    return buildStudentDashboard(env, user);
  }
};

`;
  dashboard = replaceSection(
    dashboard,
    'export const buildStudentDashboardForLogin = async',
    'export const buildStudentDashboard = async',
    loginDashboard,
    '登录首页最小聚合'
  );

  const standardDashboard = `export const buildStudentDashboard = async (env, user, options = {}) => {
  const date = options.date || shanghaiDate();
  const [config, teamContext] = await Promise.all([
    options.config ? Promise.resolve(options.config) : readConfig(env),
    options.teamContext ? Promise.resolve(options.teamContext) : buildStudentTeamContext(env, user)
  ]);
  const taskResult = await buildStudentTasks(env, user, {
    config, date, teamContext, includeImages: false
  });
  return {
    version: 1,
    user,
    config,
    tracks: TRACKS,
    date,
    time: shanghaiTime(),
    teamMembers: (teamContext.members || []).map(({ id, studentId, name, campus, status }) => ({
      id, studentId, name, campus, status
    })),
    tasks: taskResult.tasks,
    switches: taskResult.switches
  };
};
`;
  const standardStart = dashboard.indexOf('export const buildStudentDashboard = async');
  if (standardStart < 0) throw new Error('未找到标准学生首页聚合');
  dashboard = `${dashboard.slice(0, standardStart)}${standardDashboard}`;
  if (!dashboard.includes(marker)) dashboard = `${marker}\n${dashboard}`;
  if (/materialTasks|checkinStats/.test(standardDashboard + loginDashboard)) {
    throw new Error('学生首页仍请求材料或累计统计');
  }
  write('cloudflare/services/student-dashboard.js', dashboard);
}

{
  let server = read('server.js');
  const localDashboard = `function buildLocalStudentDashboard(data, currentUser) {
  const team = currentUser.trackId === 'interaction' ? teamForUser(data, currentUser.id) : null;
  const teamMembers = team
    ? team.memberIds.map((id) => data.users.find((item) => item.id === id)).filter(Boolean).map(safeUser)
    : [];
  const tasks = data.tasks
    .filter((task) => task.trackId === currentUser.trackId && task.status === 'published'
      && (!['weekly', 'activityDays'].includes(task.scheduleType) || taskOccurrenceDate(task)))
    .map((task) => {
      const owner = submissionOwner(data, task, currentUser);
      const occurrenceDate = taskOccurrenceDate(task);
      const submission = owner
        ? data.taskSubmissions.find((item) => item.taskId === task.id
          && item.ownerType === owner.ownerType
          && item.ownerId === owner.ownerId
          && (item.occurrenceDate || null) === occurrenceDate)
        : null;
      const taskTeam = task.trackId === 'interaction' ? owner?.team : null;
      const memberCheckin = taskTeam
        ? data.memberCheckins.find((item) => item.taskId === task.id
          && item.occurrenceDate === occurrenceDate
          && item.userId === currentUser.id)
        : null;
      const teamProgress = taskTeam ? {
        completed: taskTeam.memberIds.filter((id) => data.memberCheckins.some((item) =>
          item.taskId === task.id && item.occurrenceDate === occurrenceDate && item.userId === id)).length,
        total: taskTeam.memberIds.length,
        members: taskTeam.memberIds.map((id) => {
          const member = data.users.find((item) => item.id === id);
          const checkin = data.memberCheckins.find((item) =>
            item.taskId === task.id && item.occurrenceDate === occurrenceDate && item.userId === id);
          return { ...(member ? safeUser(member) : { id }), checked: Boolean(checkin), submittedAt: checkin?.submittedAt || null };
        })
      } : null;
      return {
        ...taskView(task), occurrenceDate,
        availabilityError: taskAvailability(task, data, Date.now(), occurrenceDate),
        submission: submission || null, memberCheckin, teamProgress,
        isCaptain: Boolean(taskTeam && taskTeam.captainId === currentUser.id)
      };
    });
  return {
    version: 1, user: safeUser(currentUser), config: data.config, tracks: data.tracks,
    date: today(), time: nowTime(), teamMembers, tasks,
    switches: { activityEnabled: data.config.activityEnabled, trackEnabled: data.config.trackEnabled }
  };
}

`;
  server = replaceSection(
    server,
    'function buildLocalStudentDashboard(',
    'function canAccessMaterialSubmission(',
    localDashboard,
    '本地学生首页最小聚合'
  );
  write('server.js', server);
}

{
  const cssPath = 'public/style.css';
  let css = read(cssPath);
  if (!css.includes('.student-shortcuts-minimal')) {
    css += `\n${marker}\n.student-shortcuts-minimal{display:grid!important;grid-template-columns:minmax(0,1fr)!important}\n.student-shortcuts-minimal button{min-height:88px!important}\n@media(min-width:560px){.student-shortcuts-minimal{max-width:360px}}\n`;
  }
  write(cssPath, css);
}

console.log('Finalized both student tracks to minimal home scope and fixed Plaza detail back navigation.');
