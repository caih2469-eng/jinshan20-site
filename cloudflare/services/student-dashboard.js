/* APPROVED_MOBILE_EXPERIENCE_FINALIZED_V1 */
/* APPROVED_MOBILE_EXPERIENCE_BACKEND_V1 */
/* CHECKIN_WINDOW_UPLOAD_PLAZA_PAGE_V1 */
import {
  hasMakeupPermission,
  parseJson,
  readConfig,
  shanghaiDate,
  shanghaiTime,
  TRACKS
} from '../lib/runtime.js';
import { createPrivateMediaUrl } from '../lib/media-signing.js';

const QUERY_CHUNK_SIZE = 80;
const SIGN_CONCURRENCY = 6;

const unique = (values) => [...new Set(values.filter(Boolean))];
const chunks = (values, size = QUERY_CHUNK_SIZE) => {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
};
const placeholders = (count, start = 1) => Array.from(
  { length: count },
  (_, index) => `?${start + index}`
).join(',');

export const mapWithConcurrency = async (items, concurrency, mapper) => {
  if (!items.length) return [];
  const output = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    () => worker()
  ));
  return output;
};

export const teamForUser = (env, userId) => env.DB.prepare(
  `SELECT t.id, t.name, t.invite_code AS inviteCode, t.member_limit AS memberLimit,
          t.captain_user_id AS captainId, t.created_at AS createdAt
     FROM teams t JOIN team_members tm ON tm.team_id = t.id
    WHERE tm.user_id = ?1 LIMIT 1`
).bind(userId).first();

export const membersForTeam = async (env, teamId) => {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.student_id AS studentId, u.name, u.campus, u.track_id AS trackId,
            u.status, u.created_at AS createdAt
       FROM team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ?1 ORDER BY tm.joined_at, u.student_id`
  ).bind(teamId).all();
  return results;
};

export const isTaskOccurrence = (task, occurrenceDate = '') => {
  const schedule = task.scheduleJson ? parseJson(task.scheduleJson, null) : null;
  if (!schedule) return Date.now() >= Date.parse(task.startsAt) && Date.now() <= Date.parse(task.endsAt);
  const today = shanghaiDate();
  if (occurrenceDate && occurrenceDate !== today) return false;
  if (today < schedule.activeStartDate || today > schedule.activeEndDate) return false;
  if (schedule.scheduleType === 'activityDays') {
    const [startYear, startMonth, startDay] = schedule.activeStartDate.split('-').map(Number);
    const [year, month, day] = today.split('-').map(Number);
    const activityDay = Math.floor((Date.UTC(year, month - 1, day)
      - Date.UTC(startYear, startMonth - 1, startDay)) / 86400000) + 1;
    if (!schedule.refreshDays.includes(activityDay)) return false;
  }
  if (schedule.scheduleType === 'weekly') {
    const weekday = new Date(`${today}T12:00:00+08:00`).getUTCDay() || 7;
    if (!schedule.weekdays.includes(weekday)) return false;
  }
  return true;
};

export const taskWindowOpen = (task, occurrenceDate = '', makeupAllowed = false) => {
  if (task?.checkinEnabled === false) return false;
  if (!isTaskOccurrence(task, occurrenceDate)) return false;
  if (makeupAllowed) return true;
  const schedule = task.scheduleJson ? parseJson(task.scheduleJson, null) : null;
  if (!schedule) return true;
  if (schedule.dailyStart && shanghaiTime() < schedule.dailyStart) return false;
  if (schedule.dailyEnd && shanghaiTime() > schedule.dailyEnd) return false;
  return true;
};

/* FINAL_CHECKIN_SETTINGS_V1 */
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
    startsAt: `${activeStartDate}T${dailyStart}:00+08:00`,
    endsAt: `${activeEndDate}T${dailyEnd}:00+08:00`
  };
};

export const submissionOwner = async (env, user, task) => {
  if (task.submissionType === 'team' || task.trackId === 'interaction') {
    const team = await teamForUser(env, user.id);
    if (!team) throw Object.assign(new Error('尚未分配队伍'), { status: 403 });
    return { type: 'team', id: team.id, team };
  }
  return { type: 'user', id: user.id, team: null };
};

export const submissionImages = async (env, submissionId, viewer) => {
  const grouped = await submissionImagesForIds(env, [submissionId], viewer);
  return grouped.get(submissionId) || [];
};

const signSubmissionImageRows = async (env, rows, viewer) => mapWithConcurrency(
  rows,
  SIGN_CONCURRENCY,
  async (item) => {
    const audience = viewer.role === 'admin' ? 'admin' : 'owner';
    const displayUrl = item.mediaId
      ? await createPrivateMediaUrl(env, item, audience, viewer.id)
      : `/api/files/${item.id}`;
    const thumbUrl = item.thumbMediaId
      ? await createPrivateMediaUrl(env, {
        id: item.thumbMediaId,
        objectKey: item.thumbObjectKey
      }, audience, viewer.id)
      : displayUrl;
    return { ...item, thumbUrl, displayUrl, imageUrl: thumbUrl, url: thumbUrl };
  }
);

export const submissionImagesForIds = async (env, submissionIds, viewer) => {
  const ids = unique(submissionIds);
  const grouped = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return grouped;
  const imageRows = [];
  for (const idChunk of chunks(ids)) {
    const { results } = await env.DB.prepare(
      `SELECT i.id,i.submission_id AS submissionId,
              COALESCE(m.object_key,i.object_key) AS objectKey,
              i.content_type AS contentType,i.bytes,
              i.sort_order AS sortOrder,m.id AS mediaId,
              tm.id AS thumbMediaId,tm.object_key AS thumbObjectKey,
              tm.mime_type AS thumbContentType,tm.file_size AS thumbBytes
         FROM task_submission_images i
         LEFT JOIN media_objects m ON m.id=i.id
         LEFT JOIN media_objects tm ON tm.business_id=m.id
          AND tm.business_type IN ('task:thumb','admin-makeup:thumb')
        WHERE i.submission_id IN (${placeholders(idChunk.length)})
        ORDER BY i.submission_id,i.sort_order`
    ).bind(...idChunk).all();
    imageRows.push(...results);
  }
  const signed = await signSubmissionImageRows(env, imageRows, viewer);
  for (const image of signed) {
    if (!grouped.has(image.submissionId)) grouped.set(image.submissionId, []);
    grouped.get(image.submissionId).push(image);
  }
  return grouped;
};

/* STRICT_P95_DASHBOARD_BATCH_V4 */
export const buildStudentTeamContext = async (env, user) => {
  if (user.role !== 'student' || user.trackId !== 'interaction') {
    return { team: null, members: [], teamCount: null };
  }
  const [countRow, memberPage] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS total FROM teams').first(),
    env.DB.prepare(
      `SELECT t.id AS teamId,t.name AS teamName,t.invite_code AS inviteCode,
              t.member_limit AS memberLimit,t.captain_user_id AS captainId,t.created_at AS teamCreatedAt,
              u.id AS memberId,u.student_id AS memberStudentId,u.name AS memberName,u.campus AS memberCampus,
              u.track_id AS memberTrackId,u.status AS memberStatus,u.created_at AS memberCreatedAt
         FROM team_members mine
         JOIN teams t ON t.id=mine.team_id
         LEFT JOIN team_members tm ON tm.team_id=t.id
         LEFT JOIN users u ON u.id=tm.user_id
        WHERE mine.user_id=?1
        ORDER BY tm.joined_at,u.student_id`
    ).bind(user.id).all()
  ]);
  const rows = memberPage.results || [];
  if (!rows.length || !rows[0].teamId) {
    return { team: null, members: [], teamCount: Number(countRow?.total || 0) };
  }
  const first = rows[0];
  const team = {
    id: first.teamId, name: first.teamName, inviteCode: first.inviteCode,
    memberLimit: first.memberLimit, captainId: first.captainId, createdAt: first.teamCreatedAt
  };
  const members = rows.filter((row) => row.memberId).map((row) => ({
    id: row.memberId, studentId: row.memberStudentId, name: row.memberName,
    campus: row.memberCampus, trackId: row.memberTrackId, status: row.memberStatus,
    createdAt: row.memberCreatedAt
  }));
  return { team, members, teamCount: Number(countRow?.total || 0) };
};

export const buildStudentTasks = async (env, user, options = {}) => {
  const config = options.config || await readConfig(env);
  if (user.role === 'student' && (!config.activityEnabled || !config.trackEnabled[user.trackId])) {
    return {
      tasks: [],
      switches: {
        activityEnabled: config.activityEnabled,
        trackEnabled: config.trackEnabled
      }
    };
  }
  const today = options.date || shanghaiDate();
  const taskPagePromise = options.taskPage
    ? Promise.resolve(options.taskPage)
    : env.DB.prepare(
      `SELECT id,name,description,track_id AS trackId,starts_at AS startsAt,ends_at AS endsAt,
              allow_late AS allowLate,image_limit AS imageLimit,copy_requirement AS copyRequirement,
              submission_type AS submissionType,status,schedule_json AS scheduleJson
         FROM tasks WHERE status='published' AND (?1='admin' OR track_id=?2)
        ORDER BY starts_at DESC LIMIT 100`
    ).bind(user.role, user.trackId || '').all();
  const makeupPromise = options.makeupAllowed !== undefined
    ? Promise.resolve(Boolean(options.makeupAllowed))
    : (user.role === 'student' ? hasMakeupPermission(env, user.id, today) : Promise.resolve(false));
  const [taskPage, makeupAllowed] = await Promise.all([taskPagePromise, makeupPromise]);
  const results = taskPage.results || [];
  const effectiveTasks = results.map((task) => applyInteractionCheckinSettings(task, config));
  const visibleTasks = effectiveTasks.filter(
    (task) => !task.scheduleJson || isTaskOccurrence(task, today)
  );
  const needsTeam = user.role === 'student' && visibleTasks.some(
    (task) => task.submissionType === 'team' || task.trackId === 'interaction'
  );
  const sharedTeamContext = options.teamContext || null;
  const team = needsTeam
    ? (sharedTeamContext ? sharedTeamContext.team : await teamForUser(env, user.id))
    : null;
  const members = team
    ? (sharedTeamContext && sharedTeamContext.team?.id === team.id
      ? sharedTeamContext.members
      : await membersForTeam(env, team.id))
    : [];
  const taskIds = unique(visibleTasks.map((task) => task.id));
  const occurrenceDates = unique(visibleTasks.map(
    (task) => (task.scheduleJson ? today : '')
  ));
  if (!occurrenceDates.includes('')) occurrenceDates.push('');

  const ownerPairs = [];
  if (user.role === 'student') {
    if (visibleTasks.some((task) => task.submissionType !== 'team' && task.trackId !== 'interaction')) {
      ownerPairs.push({ type: 'user', id: user.id });
    }
    if (team) ownerPairs.push({ type: 'team', id: team.id });
  }

  const checkinsPromise = Array.isArray(options.checkins)
    ? Promise.resolve(options.checkins)
    : (team && taskIds.length)
      ? (async () => {
      const rows = [];
      for (const taskChunk of chunks(taskIds, 75)) {
        const taskIn = placeholders(taskChunk.length, 2);
        const occurrenceStart = taskChunk.length + 2;
        const occurrenceIn = placeholders(occurrenceDates.length, occurrenceStart);
        const page = await env.DB.prepare(
          `SELECT user_id AS userId,id,task_id AS taskId,occurrence_date AS occurrenceDate
             FROM member_checkins
            WHERE team_id=?1 AND task_id IN (${taskIn})
              AND occurrence_date IN (${occurrenceIn})`
        ).bind(team.id, ...taskChunk, ...occurrenceDates).all();
        rows.push(...page.results);
      }
        return rows;
      })()
      : Promise.resolve([]);

  const submissions = Array.isArray(options.submissions) ? [...options.submissions] : [];
  if (!Array.isArray(options.submissions) && taskIds.length && ownerPairs.length) {
    for (const taskChunk of chunks(taskIds, 70)) {
      const values = [...taskChunk, ...occurrenceDates];
      const taskIn = placeholders(taskChunk.length);
      const occurrenceIn = placeholders(occurrenceDates.length, taskChunk.length + 1);
      const ownerStart = taskChunk.length + occurrenceDates.length + 1;
      const ownerSql = ownerPairs.map((owner, index) => {
        const parameter = ownerStart + (index * 2);
        values.push(owner.type, owner.id);
        return `(owner_type=?${parameter} AND owner_id=?${parameter + 1})`;
      }).join(' OR ');
      const page = await env.DB.prepare(
        `SELECT id,task_id AS taskId,owner_type AS ownerType,owner_id AS ownerId,
                copy_text AS copy,plaza_copy AS plazaCopy,meal_type AS mealType,
                is_public AS isPublic,status,version,occurrence_date AS occurrenceDate,
                submitted_at AS submittedAt,review_note AS reviewNote
           FROM task_submissions
          WHERE task_id IN (${taskIn})
            AND occurrence_date IN (${occurrenceIn})
            AND (${ownerSql})`
      ).bind(...values).all();
      submissions.push(...page.results);
    }
  }
  const imagesBySubmission = options.includeImages === false
    ? new Map(submissions.map((submission) => [submission.id, []]))
    : await submissionImagesForIds(
      env,
      submissions.map((submission) => submission.id),
      user
    );
  const submissionsByOwnerTask = new Map();
  for (const submission of submissions) {
    submission.images = imagesBySubmission.get(submission.id) || [];
    submissionsByOwnerTask.set(
      `${submission.taskId}|${submission.ownerType}|${submission.ownerId}|${submission.occurrenceDate}`,
      submission
    );
  }

  const checkins = await checkinsPromise;
  const checkinsByTask = new Map();
  for (const checkin of checkins) {
    const key = `${checkin.taskId}|${checkin.occurrenceDate}`;
    if (!checkinsByTask.has(key)) checkinsByTask.set(key, []);
    checkinsByTask.get(key).push(checkin);
  }

  const tasks = [];
  for (const task of visibleTasks) {
    const usesTeam = task.submissionType === 'team' || task.trackId === 'interaction';
    const owner = user.role === 'admin'
      ? null
      : (usesTeam
        ? (team ? { type: 'team', id: team.id, team } : null)
        : { type: 'user', id: user.id, team: null });
    const occurrenceDate = task.scheduleJson ? today : '';
    const submission = owner
      ? submissionsByOwnerTask.get(`${task.id}|${owner.type}|${owner.id}|${occurrenceDate}`) || null
      : null;
    const schedule = task.scheduleJson ? parseJson(task.scheduleJson, {}) : {};
    let teamProgress = null;
    let memberCheckin = null;
    let isCaptain = false;
    if (owner?.team) {
      const taskCheckins = checkinsByTask.get(`${task.id}|${occurrenceDate}`) || [];
      const completedUserIds = new Set(taskCheckins.map((item) => item.userId));
      teamProgress = {
        total: members.length,
        completed: taskCheckins.length,
        members: members.map((member) => ({
          ...member,
          checked: completedUserIds.has(member.id)
        }))
      };
      memberCheckin = taskCheckins.find((item) => item.userId === user.id) || null;
      isCaptain = owner.team.captainId === user.id;
    }
    const canSubmit = user.role === 'student' && taskWindowOpen(task, occurrenceDate, makeupAllowed);
    tasks.push({
      ...task,
      startAt: task.startsAt,
      endAt: task.endsAt,
      allowLate: Boolean(task.allowLate),
      schedule,
      scheduleType: schedule.scheduleType || 'single',
      refreshDays: schedule.refreshDays || [],
      weekdays: schedule.weekdays || [],
      dailyStart: schedule.dailyStart || '',
      dailyEnd: schedule.dailyEnd || '',
      occurrenceDate,
      canSubmit,
      availabilityError: user.role === 'student' && !canSubmit ? '当前不在任务提交时间范围内' : '',
      makeupAllowed,
      submission,
      teamProgress,
      memberCheckin,
      isCaptain
    });
  }
  return {
    tasks,
    switches: {
      activityEnabled: config.activityEnabled,
      trackEnabled: config.trackEnabled
    }
  };
};

const materialFilePayload = (files) => files.map((file) => ({
  id: file.id,
  name: file.originalName,
  originalName: file.originalName,
  contentType: file.contentType,
  bytes: file.bytes,
  url: `/api/material-files/${file.id}`,
  downloadUrl: `/api/material-files/${file.id}`
}));

export const buildStudentMaterialTasks = async (env, user) => {
  const { results } = await env.DB.prepare(
    `SELECT id,title,description,deadline,allowed_types_json AS allowedTypesJson,
            file_limit AS fileLimit,require_summary AS requireSummary,owner_type AS ownerType,status
       FROM material_tasks WHERE status='published' ORDER BY deadline`
  ).all();
  const taskIds = unique(results.map((task) => task.id));
  const needsTeam = results.some((task) => task.ownerType === 'team');
  const team = needsTeam ? await teamForUser(env, user.id) : null;
  const ownerPairs = [{ type: 'user', id: user.id }];
  if (team) ownerPairs.push({ type: 'team', id: team.id });
  const submissions = [];
  for (const taskChunk of chunks(taskIds, 70)) {
    const values = [...taskChunk];
    const ownerStart = taskChunk.length + 1;
    const ownerSql = ownerPairs.map((owner, index) => {
      const parameter = ownerStart + (index * 2);
      values.push(owner.type, owner.id);
      return `(owner_type=?${parameter} AND owner_id=?${parameter + 1})`;
    }).join(' OR ');
    const page = await env.DB.prepare(
      `SELECT id,task_id AS taskId,owner_type AS ownerType,owner_id AS ownerId,
              summary,status,version,submitted_at AS submittedAt,
              review_note AS reviewNote,updated_at AS updatedAt
         FROM material_submissions
        WHERE task_id IN (${placeholders(taskChunk.length)}) AND (${ownerSql})`
    ).bind(...values).all();
    submissions.push(...page.results);
  }
  const filesBySubmission = new Map();
  for (const idChunk of chunks(submissions.map((submission) => submission.id))) {
    const files = await env.DB.prepare(
      `SELECT id,submission_id AS submissionId,original_name AS originalName,
              content_type AS contentType,bytes
         FROM material_files
        WHERE submission_id IN (${placeholders(idChunk.length)})
        ORDER BY submission_id,created_at`
    ).bind(...idChunk).all();
    for (const file of files.results) {
      if (!filesBySubmission.has(file.submissionId)) filesBySubmission.set(file.submissionId, []);
      filesBySubmission.get(file.submissionId).push(file);
    }
  }
  const submissionsByOwnerTask = new Map();
  for (const submission of submissions) {
    submission.files = materialFilePayload(filesBySubmission.get(submission.id) || []);
    submissionsByOwnerTask.set(
      `${submission.taskId}|${submission.ownerType}|${submission.ownerId}`,
      submission
    );
  }
  const tasks = [];
  for (const task of results) {
    const owner = task.ownerType === 'team'
      ? (team ? { type: 'team', id: team.id } : null)
      : { type: 'user', id: user.id };
    const submission = owner
      ? submissionsByOwnerTask.get(`${task.id}|${owner.type}|${owner.id}`) || null
      : null;
    const allowedTypes = parseJson(task.allowedTypesJson, []);
    tasks.push({
      ...task,
      allowedTypes,
      fileTypes: allowedTypes.map((item) => item.replace(/^\./, '')),
      requireSummary: Boolean(task.requireSummary),
      submission
    });
  }
  return tasks;
};

export const buildTeamSummary = async (env, user, config, options = {}) => {
  if (user.trackId !== 'interaction') return null;
  const sharedTeamContext = options.teamContext || null;
  if (sharedTeamContext) {
    const team = sharedTeamContext.team;
    return {
      teamCount: Number(sharedTeamContext.teamCount || 0),
      maxTeams: Number(config.maxTeams || 50),
      team: team ? { ...team, members: sharedTeamContext.members, memberCount: sharedTeamContext.members.length } : null
    };
  }
  const [count, team] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS total FROM teams').first(),
    teamForUser(env, user.id)
  ]);
  let currentTeam = null;
  if (team) {
    const members = await membersForTeam(env, team.id);
    currentTeam = { ...team, members, memberCount: members.length };
  }
  return {
    teamCount: Number(count?.total || 0),
    maxTeams: Number(config.maxTeams || 50),
    team: currentTeam
  };
};

const buildCheckinStats = async (env, user) => {
  const personalPromise = user.trackId === 'health'
    ? env.DB.prepare("SELECT COUNT(DISTINCT checkin_date) AS total FROM checkins WHERE user_id=?1 AND status!='rejected'").bind(user.id).first()
    : env.DB.prepare("SELECT COUNT(DISTINCT occurrence_date) AS total FROM member_checkins WHERE user_id=?1 AND status!='rejected'").bind(user.id).first();
  const teamPromise = env.DB.prepare(
    `SELECT COUNT(DISTINCT COALESCE(NULLIF(s.occurrence_date,''),substr(s.submitted_at,1,10))) AS total
       FROM task_submissions s
       JOIN team_members m ON m.team_id=s.owner_id
      WHERE s.owner_type='team' AND m.user_id=?1 AND s.status IN ('submitted','approved')`
  ).bind(user.id).first();
  const [personal, team] = await Promise.all([personalPromise, teamPromise]);
  return { personalDays: Number(personal?.total || 0), teamDays: Number(team?.total || 0) };
};

/* LOGIN_D1_BATCH_V6 */
export const buildStudentDashboardForLogin = async (env, user) => {
  if (user.role !== 'student' || user.trackId !== 'interaction' || typeof env.DB.batch !== 'function') {
    return buildStudentDashboard(env, user);
  }
  const date = shanghaiDate();
  try {
    const configPromise = readConfig(env);
    const statements = [
      env.DB.prepare(
        `SELECT t.id AS teamId,t.name AS teamName,t.invite_code AS inviteCode,
                t.member_limit AS memberLimit,t.captain_user_id AS captainId,t.created_at AS teamCreatedAt,
                u.id AS memberId,u.student_id AS memberStudentId,u.name AS memberName,u.campus AS memberCampus,
                u.track_id AS memberTrackId,u.status AS memberStatus,u.created_at AS memberCreatedAt,
                (SELECT COUNT(*) FROM teams) AS teamCount
           FROM (SELECT 1) seed
           LEFT JOIN team_members mine ON mine.user_id=?1
           LEFT JOIN teams t ON t.id=mine.team_id
           LEFT JOIN team_members tm ON tm.team_id=t.id
           LEFT JOIN users u ON u.id=tm.user_id
          ORDER BY tm.joined_at,u.student_id`
      ).bind(user.id),
      env.DB.prepare(
        `SELECT id,name,description,track_id AS trackId,starts_at AS startsAt,ends_at AS endsAt,
                allow_late AS allowLate,image_limit AS imageLimit,copy_requirement AS copyRequirement,
                submission_type AS submissionType,status,schedule_json AS scheduleJson
           FROM tasks WHERE status='published' AND track_id=?1
          ORDER BY starts_at DESC LIMIT 100`
      ).bind(user.trackId),
      env.DB.prepare(
        'SELECT enabled FROM makeup_permissions WHERE user_id=?1 AND checkin_date=?2'
      ).bind(user.id, date),
      env.DB.prepare(
        `SELECT user_id AS userId,id,task_id AS taskId,occurrence_date AS occurrenceDate
           FROM member_checkins
          WHERE team_id=(SELECT team_id FROM team_members WHERE user_id=?1 LIMIT 1)
            AND task_id IN (SELECT id FROM tasks WHERE status='published' AND track_id=?2)
            AND occurrence_date IN (?3,'')`
      ).bind(user.id, user.trackId, date),
      env.DB.prepare(
        `SELECT id,task_id AS taskId,owner_type AS ownerType,owner_id AS ownerId,
                copy_text AS copy,plaza_copy AS plazaCopy,meal_type AS mealType,
                is_public AS isPublic,status,version,occurrence_date AS occurrenceDate,
                submitted_at AS submittedAt,review_note AS reviewNote
           FROM task_submissions
          WHERE task_id IN (SELECT id FROM tasks WHERE status='published' AND track_id=?1)
            AND occurrence_date IN (?2,'')
            AND ((owner_type='user' AND owner_id=?3) OR
                 (owner_type='team' AND owner_id=(SELECT team_id FROM team_members WHERE user_id=?3 LIMIT 1)))`
      ).bind(user.trackId, date, user.id),
      env.DB.prepare(
        `SELECT COUNT(DISTINCT occurrence_date) AS total
           FROM member_checkins WHERE user_id=?1 AND status!='rejected'`
      ).bind(user.id),
      env.DB.prepare(
        `SELECT COUNT(DISTINCT COALESCE(NULLIF(occurrence_date,''),substr(submitted_at,1,10))) AS total
           FROM task_submissions
          WHERE owner_type='team'
            AND owner_id=(SELECT team_id FROM team_members WHERE user_id=?1 LIMIT 1)
            AND status IN ('submitted','approved')`
      ).bind(user.id)
    ];
    const [config, pages] = await Promise.all([configPromise, env.DB.batch(statements)]);
    const teamRows = pages[0]?.results || [];
    const first = teamRows[0] || null;
    const team = first?.teamId ? {
      id: first.teamId, name: first.teamName, inviteCode: first.inviteCode,
      memberLimit: first.memberLimit, captainId: first.captainId, createdAt: first.teamCreatedAt
    } : null;
    const members = teamRows.filter((row) => row.memberId).map((row) => ({
      id: row.memberId, studentId: row.memberStudentId, name: row.memberName,
      campus: row.memberCampus, trackId: row.memberTrackId, status: row.memberStatus,
      createdAt: row.memberCreatedAt
    }));
    const teamContext = { team, members, teamCount: Number(first?.teamCount || 0) };
    const teamSummary = {
      teamCount: teamContext.teamCount,
      maxTeams: Number(config.maxTeams || 50),
      team: team ? { ...team, members, memberCount: members.length } : null
    };
    const taskResult = await buildStudentTasks(env, user, {
      config, date, teamContext, includeImages: false,
      taskPage: { results: pages[1]?.results || [] },
      makeupAllowed: Boolean(pages[2]?.results?.[0]?.enabled),
      checkins: pages[3]?.results || [],
      submissions: pages[4]?.results || []
    });
    return {
      version: 1, user, config, tracks: TRACKS, date, time: shanghaiTime(), teamSummary,
      tasks: taskResult.tasks, materialTasks: [],
      checkinStats: {
        personalDays: Number(pages[5]?.results?.[0]?.total || 0),
        teamDays: Number(pages[6]?.results?.[0]?.total || 0)
      },
      switches: taskResult.switches
    };
  } catch {
    return buildStudentDashboard(env, user);
  }
};

export const buildStudentDashboard = async (env, user, options = {}) => {
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
  return {
    version: 1,
    user,
    config,
    tracks: TRACKS,
    date,
    time: shanghaiTime(),
    teamSummary,
    tasks: taskResult.tasks,
    materialTasks,
    checkinStats,
    switches: taskResult.switches
  };
};
