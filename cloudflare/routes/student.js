/* PLAZA_UNDER_1S_AND_MEMBER_IMAGE_LIMIT_V1 */
/* TRACK_AWARE_ADMIN_SETTINGS_V1 */
/* APPROVED_LAYOUT_TEAM_DRAFT_720_V2 */
/* APPROVED_MOBILE_EXPERIENCE_BACKEND_V1 */
/* STUDENT_ADMIN_FLOW_BACKEND_V2 */
/* CHECKIN_WINDOW_UPLOAD_PLAZA_PAGE_V1 */
import {
  cleanText,
  errorResponse,
  hasMakeupPermission,
  json,
  nowIso,
  readConfig,
  readJson,
  retryD1Overload,
  requireUser,
  shanghaiDate,
  shanghaiTime,
  uploadImages,
  claimConfirmedMedia
} from '../lib/runtime.js';
import { createPrivateMediaUrl } from '../lib/media-signing.js';

/* CHECKIN_SERVICE_ROUTE_V1 */
import {
  buildStudentDashboard,
  buildStudentTasks,
  mapWithConcurrency,
  submissionImagesForIds,
  applyInteractionCheckinSettings,
  resolveSubmissionOccurrence,
  taskWindowOpen
} from '../services/student-dashboard.js';

const teamForUser = async (env, userId) => env.DB.prepare(
  `SELECT t.id, t.name, t.invite_code AS inviteCode, t.member_limit AS memberLimit,
          t.captain_user_id AS captainId, t.created_at AS createdAt
     FROM teams t JOIN team_members tm ON tm.team_id = t.id
    WHERE tm.user_id = ?1 LIMIT 1`
).bind(userId).first();

const membersForTeam = async (env, teamId) => {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.student_id AS studentId, u.name, u.campus, u.track_id AS trackId,
            u.status, u.created_at AS createdAt
       FROM team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ?1 ORDER BY tm.joined_at, u.student_id`
  ).bind(teamId).all();
  return results;
};

const submissionOwner = async (env, user, task) => {
  if (task.submissionType === 'team' || task.trackId === 'interaction') {
    const team = await teamForUser(env, user.id);
    if (!team) throw Object.assign(new Error('尚未分配队伍'), { status: 403 });
    return { type: 'team', id: team.id, team };
  }
  return { type: 'user', id: user.id, team: null };
};

export const handleStudentRoutes = async (request, env, ctx, url, authenticatedUser = null) => {
  const auth = authenticatedUser ? { user: authenticatedUser } : await requireUser(request, env);
  if (auth.error) return auth.error;
  const user = auth.user;
  const route = url.pathname;

  if (route === '/api/student-dashboard' && request.method === 'GET') {
    return json(await buildStudentDashboard(env, user));
  }

  if (route === '/api/teams' && request.method === 'GET') {
    if (user.role !== 'student' || user.trackId !== 'interaction') return json({ error: '仅互动赛道可查看队伍' }, 403);
    const { results } = await env.DB.prepare(
      `SELECT t.id, t.name, t.member_limit AS memberLimit, COUNT(tm.user_id) AS memberCount
         FROM teams t LEFT JOIN team_members tm ON tm.team_id = t.id
        GROUP BY t.id ORDER BY t.created_at LIMIT 100`
    ).all();
    const config = await readConfig(env);
    return json({
      teams: results.map((team) => ({
        ...team,
        memberCount: Number(team.memberCount),
        isFull: Number(team.memberCount) >= Number(team.memberLimit)
      })),
      teamCount: results.length,
      maxTeams: config.maxTeams
    });
  }

  if (route === '/api/teams/me' && request.method === 'GET') {
    if (user.role !== 'student' || user.trackId !== 'interaction') return json({ error: '仅互动赛道可查看队伍' }, 403);
    const team = await teamForUser(env, user.id);
    if (!team) return json({ team: null });
    const members = await membersForTeam(env, team.id);
    return json({ team: { ...team, members, memberCount: members.length } });
  }

  if (route === '/api/teams/join' && request.method === 'POST') {
    const config = await readConfig(env);
    if (!config.allowSelfJoin) return json({ error: '学生自助加入已关闭，请联系管理员' }, 403);
    if (user.role !== 'student' || user.trackId !== 'interaction') return json({ error: '仅互动赛道可加入队伍' }, 403);
    if (await teamForUser(env, user.id)) return json({ error: '每名学生只能加入一个队伍' }, 409);
    const body = await readJson(request);
    const inviteCode = cleanText(body.inviteCode, 20).toUpperCase();
    const team = await env.DB.prepare(
      `SELECT t.id, t.member_limit AS memberLimit, COUNT(tm.user_id) AS memberCount
         FROM teams t LEFT JOIN team_members tm ON tm.team_id=t.id
        WHERE t.invite_code=?1 GROUP BY t.id`
    ).bind(inviteCode).first();
    if (!team) return json({ error: '邀请码无效' }, 404);
    if (Number(team.memberCount) >= Number(team.memberLimit)) return json({ error: '队伍已满' }, 409);
    try {
      const inserted = await env.DB.prepare(
        `INSERT INTO team_members (team_id,user_id,joined_at)
         SELECT ?1,?2,?3 WHERE
          (SELECT COUNT(*) FROM team_members WHERE team_id=?1)
          < (SELECT member_limit FROM teams WHERE id=?1)`
      ).bind(team.id, user.id, nowIso()).run();
      if (!inserted.meta.changes) return json({ error: '队伍已满' }, 409);
    } catch {
      return json({ error: '每名学生只能加入一个队伍' }, 409);
    }
    return json({ ok: true });
  }

  if (route === '/api/tasks' && request.method === 'GET') {
    return json(await buildStudentTasks(env, user));
  }

  if (route === '/api/submissions/history' && request.method === 'GET') {
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const offset = (page - 1) * limit;
    const [count, pageResult] = await Promise.all([
      env.DB.prepare(
        "SELECT COUNT(*) AS total FROM task_submissions WHERE owner_type='user' AND owner_id=?1"
      ).bind(user.id).first(),
      env.DB.prepare(
        `SELECT s.id,s.task_id AS taskId,t.name AS taskName,s.occurrence_date AS occurrenceDate,
                s.meal_type AS mealType,s.copy_text AS copy,s.status,s.submitted_at AS submittedAt,
                s.review_note AS reviewNote,s.version
           FROM task_submissions s JOIN tasks t ON t.id=s.task_id
          WHERE s.owner_type='user' AND s.owner_id=?1
          ORDER BY s.updated_at DESC LIMIT ?2 OFFSET ?3`
      ).bind(user.id, limit, offset).all()
    ]);
    const results = pageResult.results;
    const imagesBySubmission = await submissionImagesForIds(
      env,
      results.map((item) => item.id),
      user
    );
    for (const item of results) item.images = imagesBySubmission.get(item.id) || [];
    return json({
      page,
      limit,
      total: Number(count.total),
      hasMore: offset + results.length < Number(count.total),
      submissions: results.map((item) => ({
        ...item,
        task: { id: item.taskId, name: item.taskName }
      }))
    });
  }

  if (route === '/api/checkins/history' && request.method === 'GET') {
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const offset = (page - 1) * limit;

    if (user.trackId === 'health') {
      const [count, records] = await Promise.all([
        env.DB.prepare(
          'SELECT COUNT(*) AS total FROM checkins WHERE user_id=?1'
        ).bind(user.id).first(),
        env.DB.prepare(
          `SELECT c.id,c.checkin_date AS date,c.slot_id AS slotId,c.note,c.status,
                  c.submitted_at AS submittedAt,c.review_note AS reviewNote
             FROM checkins c WHERE c.user_id=?1
            ORDER BY c.checkin_date DESC,c.submitted_at DESC LIMIT ?2 OFFSET ?3`
        ).bind(user.id, limit, offset).all()
      ]);
      const recordIds = records.results.map((record) => record.id);
      let fileRows = [];
      if (recordIds.length) {
        const recordPlaceholders = recordIds.map((_, index) => `?${index + 1}`).join(',');
        const files = await env.DB.prepare(
          `SELECT f.id,f.checkin_id AS checkinId,
                  COALESCE(m.object_key,f.object_key) AS objectKey,
                  f.kind,f.sort_order AS sortOrder,m.id AS mediaId,
                  tm.id AS thumbMediaId,tm.object_key AS thumbObjectKey
             FROM checkin_files f
             LEFT JOIN media_objects m ON m.id=f.id
             LEFT JOIN media_objects tm ON tm.business_id=m.id
              AND tm.business_type IN ('meal-checkin:thumb','admin-makeup:thumb')
            WHERE f.checkin_id IN (${recordPlaceholders})
            ORDER BY f.checkin_id,f.sort_order`
        ).bind(...recordIds).all();
        fileRows = files.results.filter((item) => item.kind === 'photo');
      }
      const signedFiles = await mapWithConcurrency(fileRows, 6, async (file) => {
          const displayUrl = file.mediaId
            ? await createPrivateMediaUrl(env, file, 'owner', user.id)
            : `/api/files/${file.id}`;
          const thumbUrl = file.thumbMediaId
            ? await createPrivateMediaUrl(env, {
              id: file.thumbMediaId,
              objectKey: file.thumbObjectKey
            }, 'owner', user.id)
            : displayUrl;
          return { ...file, thumbUrl, displayUrl, imageUrl: thumbUrl };
      });
      const imagesByCheckin = new Map();
      for (const image of signedFiles) {
        if (!imagesByCheckin.has(image.checkinId)) imagesByCheckin.set(image.checkinId, []);
        imagesByCheckin.get(image.checkinId).push(image);
      }
      for (const record of records.results) record.images = imagesByCheckin.get(record.id) || [];
      const total = Number(count.total);
      return json({
        trackId: user.trackId,
        page,
        limit,
        total,
        hasMore: offset + records.results.length < total,
        records: records.results
      });
    }

    const [count, pageResult] = await Promise.all([
      env.DB.prepare(
        'SELECT COUNT(*) AS total FROM member_checkins WHERE user_id=?1'
      ).bind(user.id).first(),
      env.DB.prepare(
        `SELECT mc.id,mc.occurrence_date AS date,mc.status,mc.submitted_at AS submittedAt,
                 t.name AS taskName,mc.object_key AS legacyObjectKey
           FROM member_checkins mc JOIN tasks t ON t.id=mc.task_id
          WHERE mc.user_id=?1 ORDER BY mc.occurrence_date DESC,mc.submitted_at DESC
          LIMIT ?2 OFFSET ?3`
      ).bind(user.id, limit, offset).all()
    ]);
    const records = pageResult.results;
    const recordIds = records.map((record) => record.id);
    let mediaRows = [];
    if (recordIds.length) {
      const recordPlaceholders = recordIds.map((_, index) => `?${index + 1}`).join(',');
      const media = await env.DB.prepare(
        `SELECT m.id,m.business_id AS checkinId,m.object_key AS objectKey,
                tm.id AS thumbMediaId,tm.object_key AS thumbObjectKey
           FROM media_objects m
           LEFT JOIN media_objects tm ON tm.business_id=m.id
            AND tm.business_type IN ('member-checkin:thumb','admin-makeup:thumb')
          WHERE m.business_type='member-checkin'
            AND m.business_id IN (${recordPlaceholders})
          ORDER BY m.business_id,m.created_at,m.id`
      ).bind(...recordIds).all();
      mediaRows = media.results;
    }
    const signedMedia = await mapWithConcurrency(mediaRows, 6, async (media) => {
      const displayUrl = await createPrivateMediaUrl(env, media, 'owner', user.id);
      const thumbUrl = media.thumbMediaId
        ? await createPrivateMediaUrl(env, {
          id: media.thumbMediaId,
          objectKey: media.thumbObjectKey
        }, 'owner', user.id)
        : displayUrl;
      return { ...media, thumbUrl, displayUrl, imageUrl: thumbUrl };
    });
    const imagesByCheckin = new Map();
    for (const image of signedMedia) {
      if (!imagesByCheckin.has(image.checkinId)) imagesByCheckin.set(image.checkinId, []);
      imagesByCheckin.get(image.checkinId).push(image);
    }
    for (const record of records) {
      record.images = imagesByCheckin.get(record.id) || [];
      if (!record.images.length && record.legacyObjectKey) {
        const legacyUrl = `/api/files/${record.id}`;
        record.images = [{ thumbUrl: legacyUrl, displayUrl: legacyUrl, imageUrl: legacyUrl }];
      }
      delete record.legacyObjectKey;
    }
    const total = Number(count.total);
    return json({
      trackId: user.trackId,
      page,
      limit,
      total,
      hasMore: offset + records.length < total,
      records
    });
  }

  const memberMatch = route.match(/^\/api\/tasks\/([^/]+)\/member-checkin$/);
  if (memberMatch && request.method === 'PUT') {
    if (user.role !== 'student' || user.trackId !== 'interaction') return json({ error: '仅互动赛道可打卡' }, 403);
    const task = await env.DB.prepare(
      `SELECT id,track_id AS trackId,starts_at AS startsAt,ends_at AS endsAt,
              image_limit AS imageLimit,schedule_json AS scheduleJson,status FROM tasks WHERE id=?1`
    ).bind(decodeURIComponent(memberMatch[1])).first();
    if (!task || task.status !== 'published' || task.trackId !== 'interaction') return json({ error: '任务不存在' }, 404);
    const taskConfig = await readConfig(env);
    const effectiveTask = applyInteractionCheckinSettings(task, taskConfig);
    const body = await readJson(request);
    const { occurrenceDate, makeupAllowed } = await resolveSubmissionOccurrence(
      cleanText(body.occurrenceDate, 10),
      (date) => hasMakeupPermission(env, user.id, date)
    );
    if (!taskWindowOpen(effectiveTask, occurrenceDate, makeupAllowed)) return json({ error: '当前不在打卡时间范围内' }, 403);
    const team = await teamForUser(env, user.id);
    if (!team) return json({ error: '尚未分配队伍' }, 403);
    if (body.images?.length || body.photos?.length) {
      return json({ error: '旧版Base64图片上传已停用，请重新选择图片' }, 400);
    }
    const imageLimit = Math.min(8, Math.max(1,
      Number(effectiveTask.memberImageLimit || effectiveTask.imageLimit) || 1));
    const requestedMediaIds = [...new Set((body.mediaIds || [])
      .map((value) => cleanText(value, 80)).filter(Boolean))];
    const old = await env.DB.prepare(
      `SELECT id,object_key AS legacyObjectKey FROM member_checkins
        WHERE task_id=?1 AND occurrence_date=?2 AND user_id=?3`
    ).bind(task.id, occurrenceDate, user.id).first();
    if (old?.id && requestedMediaIds.length) {
      const placeholders = requestedMediaIds.map((_, index) => `?${index + 3}`).join(',');
      const alreadyClaimed = await env.DB.prepare(
        `SELECT id FROM media_objects
          WHERE business_id=?1 AND owner_user_id=?2 AND business_type='member-checkin'
            AND id IN (${placeholders})`
      ).bind(old.id, user.id, ...requestedMediaIds).all();
      if (alreadyClaimed.results.length === requestedMediaIds.length) {
        return json({ ok: true, repeated: true, occurrenceDate, imageCount: requestedMediaIds.length });
      }
    }
    const uploaded = await claimConfirmedMedia(
      env, body.mediaIds, user, task.id, 'member-checkin', imageLimit, { loadThumb: false }
    );
    const oldMedia = old?.id ? await env.DB.prepare(
      `SELECT m.id,m.object_key AS objectKey,tm.id AS thumbMediaId,tm.object_key AS thumbObjectKey
         FROM media_objects m
         LEFT JOIN media_objects tm ON tm.business_id=m.id
          AND tm.business_type IN ('member-checkin:thumb','admin-makeup:thumb')
        WHERE m.business_id=?1 AND m.business_type='member-checkin'`
    ).bind(old.id).all() : { results: [] };
    const id = old?.id || crypto.randomUUID();
    try {
      const submittedAt = nowIso();
      const statements = [];
      for (const previous of oldMedia.results) {
        if (previous.thumbMediaId) statements.push(
          env.DB.prepare('DELETE FROM media_objects WHERE id=?1').bind(previous.thumbMediaId)
        );
        statements.push(env.DB.prepare('DELETE FROM media_objects WHERE id=?1').bind(previous.id));
      }
      statements.push(env.DB.prepare(
        "DELETE FROM image_variants WHERE source_type='member_checkin' AND source_id=?1"
      ).bind(id));
      statements.push(env.DB.prepare(
          `INSERT INTO member_checkins
          (id,task_id,occurrence_date,user_id,team_id,object_key,content_type,bytes,status,submitted_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'submitted',?9)
         ON CONFLICT(task_id,occurrence_date,user_id) DO UPDATE SET
            team_id=excluded.team_id,object_key=excluded.object_key,
            content_type=excluded.content_type,bytes=excluded.bytes,status='submitted',
            submitted_at=excluded.submitted_at`
        ).bind(id, task.id, occurrenceDate, user.id, team.id, uploaded[0].objectKey,
          uploaded[0].contentType, uploaded[0].bytes, submittedAt));
      for (const image of uploaded) {
        statements.push(env.DB.prepare(
          `UPDATE media_objects SET business_id=?1,updated_at=?2
            WHERE id=?3 AND owner_user_id=?4 AND business_id IS NULL`
        ).bind(id, submittedAt, image.id, user.id));
      }
      statements.push(env.DB.prepare(
        `INSERT OR REPLACE INTO image_variants
          (source_type,source_id,variant,object_key,content_type,bytes,created_at)
         VALUES ('member_checkin',?1,'display',?2,?3,?4,?5)`
      ).bind(id, uploaded[0].objectKey, uploaded[0].contentType, uploaded[0].bytes, submittedAt));
      await retryD1Overload(() => env.DB.batch(statements), {
        maxAttempts: 5,
        baseDelayMs: 500,
        maxDelayMs: 8_000
      });
      const staleKeys = oldMedia.results.flatMap((item) => [
        item.objectKey,
        ...(item.thumbObjectKey ? [item.thumbObjectKey] : [])
      ]).filter(Boolean);
      if (old?.legacyObjectKey && !staleKeys.includes(old.legacyObjectKey)) staleKeys.push(old.legacyObjectKey);
      if (staleKeys.length) ctx.waitUntil(Promise.all(staleKeys.map((key) => env.UPLOADS.delete(key))));
      return json({ ok: true, occurrenceDate, imageCount: uploaded.length });
    } catch (error) {
      throw error;
    }
  }

  if (route === '/api/team-checkins/history' && request.method === 'GET') {
    if (user.role !== 'student' || user.trackId !== 'interaction') return json({ error: '仅互动赛道可查看队伍记录' }, 403);
    const team = await teamForUser(env, user.id);
    if (!team) return json({ page: 1, limit: 20, total: 0, hasMore: false, records: [] });
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const offset = (page - 1) * limit;
    const [count, pageResult, members] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS total FROM task_submissions WHERE owner_type='team' AND owner_id=?1 AND status IN ('submitted','approved')").bind(team.id).first(),
      env.DB.prepare(
        `SELECT s.id,s.task_id AS taskId,t.name AS taskName,s.occurrence_date AS date,
                s.copy_text AS copy,s.status,s.submitted_at AS submittedAt
           FROM task_submissions s JOIN tasks t ON t.id=s.task_id
          WHERE s.owner_type='team' AND s.owner_id=?1 AND s.status IN ('submitted','approved')
          ORDER BY s.occurrence_date DESC,s.submitted_at DESC LIMIT ?2 OFFSET ?3`
      ).bind(team.id, limit, offset).all(),
      membersForTeam(env, team.id)
    ]);
    const records = pageResult.results;
    const imagesBySubmission = await submissionImagesForIds(env, records.map((record) => record.id), user);
    let checkinRows = [];
    if (records.length) {
      const values = [team.id];
      const conditions = records.map((record, index) => {
        values.push(record.taskId, record.date || '');
        const start = 2 + index * 2;
        return `(task_id=?${start} AND occurrence_date=?${start + 1})`;
      }).join(' OR ');
      const result = await env.DB.prepare(
        `SELECT task_id AS taskId,occurrence_date AS date,user_id AS userId
           FROM member_checkins WHERE team_id=?1 AND (${conditions})`
      ).bind(...values).all();
      checkinRows = result.results;
    }
    const completedByKey = new Map();
    for (const row of checkinRows) {
      const key = `${row.taskId}|${row.date || ''}`;
      if (!completedByKey.has(key)) completedByKey.set(key, new Set());
      completedByKey.get(key).add(row.userId);
    }
    for (const record of records) {
      const completed = completedByKey.get(`${record.taskId}|${record.date || ''}`) || new Set();
      record.images = imagesBySubmission.get(record.id) || [];
      record.teamProgress = {
        total: members.length,
        completed: completed.size,
        members: members.map((member) => ({ ...member, checked: completed.has(member.id) }))
      };
    }
    const total = Number(count?.total || 0);
    return json({ page, limit, total, hasMore: offset + records.length < total, records });
  }

  const submissionMatch = route.match(/^\/api\/tasks\/([^/]+)\/submission$/);
  if (submissionMatch && request.method === 'PUT') {
    const task = await env.DB.prepare(
      `SELECT id,name,track_id AS trackId,starts_at AS startsAt,ends_at AS endsAt,
              image_limit AS imageLimit,copy_requirement AS copyRequirement,
              submission_type AS submissionType,schedule_json AS scheduleJson,status
         FROM tasks WHERE id=?1`
    ).bind(decodeURIComponent(submissionMatch[1])).first();
    if (!task || task.status !== 'published' || (user.role !== 'admin' && task.trackId !== user.trackId)) {
      return json({ error: '任务不存在' }, 404);
    }
    const body = await readJson(request);
    const taskConfig = await readConfig(env);
    const effectiveTask = applyInteractionCheckinSettings(task, taskConfig);
    const occurrence = effectiveTask.scheduleJson
      ? await resolveSubmissionOccurrence(
          cleanText(body.occurrenceDate, 10),
          (date) => hasMakeupPermission(env, user.id, date)
        )
      : { occurrenceDate: '', makeupAllowed: false };
    const { occurrenceDate, makeupAllowed } = occurrence;
    if (!taskWindowOpen(effectiveTask, occurrenceDate, makeupAllowed)) {
      return json({ error: '当前不在任务提交时间范围内' }, 403);
    }
    const owner = await submissionOwner(env, user, effectiveTask);
    const intent = body.intent === 'draft' ? 'draft' : 'submitted';
    if (intent === 'submitted' && owner.type === 'team' && user.role !== 'admin') {
      if (!owner.team || owner.team.captainId !== user.id) {
        return json({ error: '只有队长可以提交队伍作品' }, 403);
      }
      const [memberTotal, memberCompleted] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) AS total FROM team_members WHERE team_id=?1').bind(owner.id).first(),
        env.DB.prepare(
          `SELECT COUNT(DISTINCT user_id) AS completed FROM member_checkins
            WHERE team_id=?1 AND task_id=?2 AND occurrence_date=?3`
        ).bind(owner.id, task.id, occurrenceDate).first()
      ]);
      const total = Number(memberTotal?.total || 0);
      const completed = Number(memberCompleted?.completed || 0);
      if (!total || completed < total) {
        return json({ error: `需所有队员完成当天个人打卡后才能汇总提交（${completed}/${total}）` }, 409);
      }
    }
    const copy = cleanText(body.copy, 2000);
    const plazaCopy = cleanText(body.copy, 2000);
    const isPublic = effectiveTask.trackId === 'interaction' && Boolean(body.isPublic);
    if (intent === 'submitted' && effectiveTask.copyRequirement && !copy) return json({ error: '请填写活动文案' }, 400);
    const current = await env.DB.prepare(
      `SELECT id,status,version FROM task_submissions
        WHERE task_id=?1 AND owner_type=?2 AND owner_id=?3 AND occurrence_date=?4`
    ).bind(task.id, owner.type, owner.id, occurrenceDate).first();
    if (current?.status === 'submitted' || current?.status === 'approved') {
      return json({ error: '该任务已最终提交，不能重复提交' }, 409);
    }
    if (current && Number(body.version) !== Number(current.version)) return json({ error: '内容已被队友更新，请刷新后重试' }, 409);
    if (body.images?.length || body.displayImages?.length) {
      return json({ error: '旧版Base64和双图片上传已停用，请重新选择图片' }, 400);
    }
    const uploaded = body.mediaIds?.length
      ? await claimConfirmedMedia(env, body.mediaIds, user, task.id, 'task', Number(effectiveTask.imageLimit))
      : [];
    if (!uploaded.length && !current) return json({ error: '请至少上传一张图片' }, 400);
    const id = current?.id || crypto.randomUUID();
    const nextVersion = Number(current?.version || 0) + 1;
    const oldImages = current ? await env.DB.prepare(
      `SELECT i.id,COALESCE(m.object_key,i.object_key) AS objectKey,m.id AS mediaId,
              tm.id AS thumbMediaId,tm.object_key AS thumbObjectKey
         FROM task_submission_images i
         LEFT JOIN media_objects m ON m.id=i.id
         LEFT JOIN media_objects tm ON tm.business_id=m.id
          AND tm.business_type IN ('task:thumb','admin-makeup:thumb')
        WHERE i.submission_id=?1`
    ).bind(id).all() : { results: [] };
    const statements = [];
    let claimStatement = null;
    if (current) {
      claimStatement = env.DB.prepare(
        `UPDATE task_submissions SET copy_text=?1,plaza_copy=?2,meal_type=?3,is_public=?4,
                status=?5,version=version+1,submitted_at=?6,updated_at=?7
          WHERE id=?8 AND version=?9`
      ).bind(copy, plazaCopy, cleanText(body.mealType, 20), isPublic ? 1 : 0, intent,
        intent === 'submitted' ? nowIso() : null, nowIso(), id, current.version);
    } else {
      statements.push(env.DB.prepare(
        `INSERT INTO task_submissions
          (id,task_id,owner_type,owner_id,occurrence_date,copy_text,plaza_copy,meal_type,
           is_public,status,version,submitted_at,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,1,?11,?12,?12)`
      ).bind(id, task.id, owner.type, owner.id, occurrenceDate, copy, plazaCopy,
        cleanText(body.mealType, 20), isPublic ? 1 : 0, intent,
        intent === 'submitted' ? nowIso() : null, nowIso()));
    }
    if (uploaded.length) {
      statements.push(env.DB.prepare('DELETE FROM task_submission_images WHERE submission_id=?1').bind(id));
      for (const oldImage of oldImages.results) {
        if (oldImage.mediaId) {
          statements.push(env.DB.prepare('DELETE FROM media_objects WHERE id=?1').bind(oldImage.mediaId));
        }
        if (oldImage.thumbMediaId) {
          statements.push(env.DB.prepare('DELETE FROM media_objects WHERE id=?1').bind(oldImage.thumbMediaId));
        }
        statements.push(env.DB.prepare(
          "DELETE FROM image_variants WHERE source_type='task_submission_image' AND source_id=?1"
        ).bind(oldImage.id));
      }
      for (const image of uploaded) {
        statements.push(env.DB.prepare(
          `INSERT INTO task_submission_images
            (id,submission_id,object_key,content_type,bytes,sort_order,created_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7)`
        ).bind(image.id, id, image.objectKey, image.contentType, image.bytes, image.sortOrder, nowIso()));
        statements.push(env.DB.prepare(
          `UPDATE media_objects SET business_id=?1,visibility=?2,updated_at=?3
            WHERE id=?4 AND owner_user_id=?5 AND business_id IS NULL`
        ).bind(id, intent === 'submitted' && isPublic ? 'public' : 'private', nowIso(), image.id, user.id));
        statements.push(env.DB.prepare(
          `INSERT OR REPLACE INTO image_variants
            (source_type,source_id,variant,object_key,content_type,bytes,created_at)
           VALUES ('task_submission_image',?1,'display',?2,?3,?4,?5)`
        ).bind(image.id, image.objectKey, image.contentType, image.bytes, nowIso()));
        if (image.thumb) {
          statements.push(env.DB.prepare(
            `INSERT OR REPLACE INTO image_variants
              (source_type,source_id,variant,object_key,content_type,bytes,created_at)
             VALUES ('task_submission_image',?1,'thumb',?2,?3,?4,?5)`
          ).bind(image.id, image.thumb.objectKey, image.thumb.contentType, image.thumb.bytes, nowIso()));
        }
      }
    }
    if (intent === 'submitted' && isPublic && owner.team) {
      statements.push(env.DB.prepare(
        `INSERT INTO plaza_posts
          (id,submission_id,team_id,copy_text,status,excluded_from_ranking,published_at,updated_at)
         VALUES (?1,?2,?3,?4,'visible',0,?5,?5)
         ON CONFLICT(submission_id) DO UPDATE SET copy_text=excluded.copy_text,status='visible',
           updated_at=excluded.updated_at`
      ).bind(crypto.randomUUID(), id, owner.team.id, plazaCopy, nowIso()));
    }
    try {
      if (claimStatement) {
        const claimed = await claimStatement.run();
        if (!claimed.meta.changes) throw Object.assign(new Error('内容已被更新'), { status: 409 });
      }
      await env.DB.batch(statements);
      if (uploaded.length) {
        const origin = new URL(request.url).origin;
        ctx.waitUntil(Promise.all(oldImages.results.flatMap((item) => [
          env.UPLOADS.delete(item.objectKey),
          ...(item.thumbObjectKey ? [env.UPLOADS.delete(item.thumbObjectKey)] : []),
          ...(item.mediaId
            ? [
              caches.default.delete(new Request(`${origin}/api/public-media/${encodeURIComponent(item.mediaId)}`)),
              caches.default.delete(new Request(`${origin}/api/public-images/${encodeURIComponent(item.id)}?variant=thumb`)),
              caches.default.delete(new Request(`${origin}/api/public-images/${encodeURIComponent(item.id)}?variant=display`))
            ]
            : [])
        ])));
      }
      return json({ ok: true, submission: { id, status: intent, version: nextVersion } });
    } catch (error) {
      throw error;
    }
  }

  if (route === '/api/checkins' && request.method === 'GET') {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '') ? url.searchParams.get('date') : shanghaiDate();
    const { results } = await env.DB.prepare(
      `SELECT id,checkin_date AS date,slot_id AS slotId,note,status,submitted_at AS submittedAt,
              review_note AS reviewNote,version
         FROM checkins WHERE user_id=?1 AND checkin_date=?2 ORDER BY submitted_at`
    ).bind(user.id, date).all();
    const checkinIds = results.map((item) => item.id);
    let fileRows = [];
    if (checkinIds.length) {
      const checkinPlaceholders = checkinIds.map((_, index) => `?${index + 1}`).join(',');
      const files = await env.DB.prepare(
        `SELECT f.id,f.checkin_id AS checkinId,
                COALESCE(m.object_key,f.object_key) AS objectKey,
                f.kind,f.sort_order AS sortOrder,m.id AS mediaId
           FROM checkin_files f LEFT JOIN media_objects m ON m.id=f.id
          WHERE f.checkin_id IN (${checkinPlaceholders})
          ORDER BY f.checkin_id,f.kind,f.sort_order`
      ).bind(...checkinIds).all();
      fileRows = files.results;
    }
    const signedFiles = await mapWithConcurrency(fileRows, 6, async (file) => ({
      ...file,
      imageUrl: file.mediaId
          ? await createPrivateMediaUrl(env, file, user.role === 'admin' ? 'admin' : 'owner', user.id)
          : `/api/files/${file.id}`
    }));
    const filesByCheckin = new Map();
    for (const file of signedFiles) {
      if (!filesByCheckin.has(file.checkinId)) filesByCheckin.set(file.checkinId, []);
      filesByCheckin.get(file.checkinId).push(file);
    }
    for (const item of results) {
      const files = filesByCheckin.get(item.id) || [];
      item.photos = files.filter((file) => file.kind === 'photo').map((file) => file.imageUrl);
      item.summary = files.find((file) => file.kind === 'summary')?.imageUrl || null;
    }
    return json({ checkins: results });
  }

  if (route === '/api/checkins' && request.method === 'POST') {
    if (user.role !== 'student') return json({ error: '管理员不能提交打卡' }, 403);
    if (user.trackId !== 'health') return json({ error: '仅健康自律赛道可提交此类打卡' }, 403);
    const config = await readConfig(env);
    const healthSettings = config.healthCheckinSettings || {};
    if (!config.activityEnabled || !config.trackEnabled.health || healthSettings.enabled === false) return json({ error: '健康自律赛道当前未开放' }, 403);
    const body = await readJson(request);
    const date = cleanText(body.date, 10);
    const makeupAllowed = await hasMakeupPermission(env, user.id, date);
    if (date !== shanghaiDate() && !makeupAllowed) return json({ error: '只能提交当天材料' }, 403);
    if (!makeupAllowed) {
      if ((healthSettings.activeStartDate && date < healthSettings.activeStartDate)
          || (healthSettings.activeEndDate && date > healthSettings.activeEndDate)) {
        return json({ error: '当前不在健康自律赛道活动日期内' }, 403);
      }
      const weekday = new Date(`${date}T12:00:00+08:00`).getUTCDay() || 7;
      if (Array.isArray(healthSettings.weekdays) && healthSettings.weekdays.length
          && !healthSettings.weekdays.includes(weekday)) {
        return json({ error: '今天不开放健康自律赛道打卡' }, 403);
      }
    }
    const slot = (healthSettings.slots || config.slots).find((item) => item.id === body.slotId);
    if (!slot || (!makeupAllowed && (shanghaiTime() < slot.start || shanghaiTime() > slot.end))) {
      return json({ error: '当前不在该时段' }, 403);
    }
    if (body.photos?.length || body.summary) {
      return json({ error: '旧版Base64图片上传已停用，请重新选择图片' }, 400);
    }
    const healthPhotoLimit = Math.min(8, Math.max(1, Number(healthSettings.personalImageLimit || 3)));
    const photos = await claimConfirmedMedia(
      env, body.photoMediaIds, user, null, 'meal-checkin', healthPhotoLimit
    );
    const summary = body.summaryMediaId
      ? (await claimConfirmedMedia(env, [body.summaryMediaId], user, null, 'meal-checkin', 1))[0]
      : null;
    const existing = await env.DB.prepare(
      'SELECT id,version FROM checkins WHERE user_id=?1 AND checkin_date=?2 AND slot_id=?3'
    ).bind(user.id, date, slot.id).first();
    const id = existing?.id || crypto.randomUUID();
    const old = existing ? await env.DB.prepare(
      `SELECT f.id,COALESCE(m.object_key,f.object_key) AS objectKey,m.id AS mediaId,
              tm.id AS thumbMediaId,tm.object_key AS thumbObjectKey
         FROM checkin_files f
         LEFT JOIN media_objects m ON m.id=f.id
         LEFT JOIN media_objects tm ON tm.business_id=m.id
          AND tm.business_type IN ('meal-checkin:thumb','admin-makeup:thumb')
        WHERE f.checkin_id=?1`
    ).bind(id).all() : { results: [] };
    const statements = [
      env.DB.prepare(
        `INSERT INTO checkins
          (id,user_id,checkin_date,slot_id,note,status,submitted_at,review_note,version)
         VALUES (?1,?2,?3,?4,?5,'pending',?6,'',1)
         ON CONFLICT(user_id,checkin_date,slot_id) DO UPDATE SET
          note=excluded.note,status='pending',submitted_at=excluded.submitted_at,
          review_note='',version=checkins.version+1`
      ).bind(id, user.id, date, slot.id, cleanText(body.note, 300), nowIso()),
      env.DB.prepare('DELETE FROM checkin_files WHERE checkin_id=?1').bind(id)
    ];
    for (const file of old.results) {
      if (file.mediaId) statements.push(env.DB.prepare('DELETE FROM media_objects WHERE id=?1').bind(file.mediaId));
      if (file.thumbMediaId) statements.push(env.DB.prepare('DELETE FROM media_objects WHERE id=?1').bind(file.thumbMediaId));
      statements.push(env.DB.prepare(
        "DELETE FROM image_variants WHERE source_type='checkin_file' AND source_id=?1"
      ).bind(file.id));
    }
    for (const file of [...photos, ...(summary ? [{ ...summary, sortOrder: 0, kind: 'summary' }] : [])]) {
      statements.push(env.DB.prepare(
        `INSERT INTO checkin_files
          (id,checkin_id,object_key,content_type,bytes,kind,sort_order,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`
      ).bind(file.id, id, file.objectKey, file.contentType, file.bytes, file.kind || 'photo', file.sortOrder, nowIso()));
      statements.push(env.DB.prepare(
        `UPDATE media_objects SET business_id=?1,updated_at=?2
          WHERE id=?3 AND owner_user_id=?4 AND business_id IS NULL`
      ).bind(id, nowIso(), file.id, user.id));
      statements.push(env.DB.prepare(
        `INSERT OR REPLACE INTO image_variants
          (source_type,source_id,variant,object_key,content_type,bytes,created_at)
         VALUES ('checkin_file',?1,'display',?2,?3,?4,?5)`
      ).bind(file.id, file.objectKey, file.contentType, file.bytes, nowIso()));
      if (file.thumb) {
        statements.push(env.DB.prepare(
          `INSERT OR REPLACE INTO image_variants
            (source_type,source_id,variant,object_key,content_type,bytes,created_at)
           VALUES ('checkin_file',?1,'thumb',?2,?3,?4,?5)`
        ).bind(file.id, file.thumb.objectKey, file.thumb.contentType, file.thumb.bytes, nowIso()));
      }
    }
    try {
      await env.DB.batch(statements);
      ctx.waitUntil(Promise.all(old.results.flatMap((item) => [
        env.UPLOADS.delete(item.objectKey),
        ...(item.thumbObjectKey ? [env.UPLOADS.delete(item.thumbObjectKey)] : [])
      ])));
      return json({ ok: true, id });
    } catch (error) {
      throw error;
    }
  }

  return null;
};

export const studentRouteError = errorResponse;
