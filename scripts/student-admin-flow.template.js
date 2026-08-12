/* PLAZA_UNDER_1S_AND_MEMBER_IMAGE_LIMIT_V1 */
/* APPROVED_CHECKIN_SETTINGS_TEMPLATE_V1 */
/* STUDENT_ADMIN_FLOW_TEMPLATE_V2 */

/* FRONTEND_MEMBER_CHECKIN_START */
function memberCheckinForm(task) {
  beginNavigation();
  void loadImageCompressionLibrary().catch(() => {});
  const maxImages = Math.max(1, Math.min(8,
    Number(task.memberImageLimit || task.imageLimit) || 1));
  app.innerHTML = `<header class="hero"><h1>个人打卡</h1><p>${escapeHtml(task.name)}</p></header>
    <section class="card"><form id="memberSend">
      <div class="notice">姓名和学号由账号自动带入，请上传本人当天截图。</div>
      <label>姓名</label><input value="${escapeHtml(user.name)}" readonly>
      <label>学号</label><input value="${escapeHtml(user.studentId)}" readonly>
      <label>校区</label><input value="${escapeHtml(user.campus)}" readonly>
      <label>图片（最多 ${maxImages} 张）</label><input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple required>
      <div class="image-preview" id="memberPreview"></div>
      <p class="muted" id="memberUploadStatus">可选择 1–${maxImages} 张图片，选择后会立即预览并上传。</p>
      <button type="button" class="secondary" id="retryMemberUpload" hidden>重试失败图片</button>
      <div class="row"><button type="button" class="secondary" id="backMember">返回</button><button>确定打卡</button></div>
    </form></section>`;
  const form = document.querySelector('#memberSend');
  const submitButton = form.querySelector('button:not([type="button"])');
  const retryButton = document.querySelector('#retryMemberUpload');
  const status = document.querySelector('#memberUploadStatus');
  const preview = document.querySelector('#memberPreview');
  let session = null;

  const releaseSession = () => {
    session?.controller?.abort();
    session?.items?.forEach((item) => {
      if (!item.previewUrl) return;
      URL.revokeObjectURL(item.previewUrl);
      mediaPreviewUrls.delete(item.previewUrl);
    });
    session = null;
    form._media = null;
  };

  const readyCount = () => session?.items?.filter((item) => item.mediaId).length || 0;
  const failedItems = () => session?.items?.filter((item) => item.error && !item.uploadPromise) || [];
  const updateReadyState = () => {
    const total = session?.items?.length || 0;
    const ready = readyCount();
    const uploading = Boolean(session?.processingPromise) || Boolean(session?.items?.some((item) => item.uploadPromise));
    submitButton.disabled = !total || ready !== total || uploading;
    submitButton.textContent = uploading ? `图片上传中（${ready}/${total}）` : '确定打卡';
    retryButton.hidden = !failedItems().length || uploading;
  };

  const updateStatus = () => {
    if (!session) return;
    const ready = readyCount();
    const failed = failedItems().length;
    const total = session.items.length;
    if (failed) status.textContent = `已有 ${ready}/${total} 张就绪，${failed} 张失败，可点击重试。`;
    else if (ready === total) status.textContent = `${total} 张图片已就绪。`;
    else status.textContent = `正在处理图片（${ready}/${total}）…`;
    updateReadyState();
  };

  const processItem = async (current, item, index) => {
    if (current !== session || current.controller.signal.aborted) return;
    item.error = null;
    status.textContent = `第 ${index + 1}/${current.items.length} 张：正在压缩…`;
    try {
      const sourceFile = await normalizeSourceImage(item.file);
      if (current !== session) return;
      item.compressed = await compressMemberCheckinImage(sourceFile, {
        signal: current.controller.signal,
        onProgress: (progress) => {
          if (current !== session) return;
          const percent = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
          status.textContent = `第 ${index + 1}/${current.items.length} 张：正在压缩 ${percent}%`;
        }
      });
      if (current !== session) return;
      status.textContent = `第 ${index + 1}/${current.items.length} 张：正在上传…`;
      item.uploadPromise = uploadMemberCheckinFast(
        item.compressed,
        task.id,
        item.idempotencyKey,
        current.controller.signal
      );
      updateReadyState();
      const uploaded = await item.uploadPromise;
      if (current !== session) return;
      item.mediaId = uploaded.mediaId;
      item.error = null;
    } catch (error) {
      if (current !== session || current.controller.signal.aborted) return;
      item.error = error;
    } finally {
      item.uploadPromise = null;
      updateStatus();
    }
  };

  const runIndexes = (current, indexes) => {
    let cursor = 0;
    const worker = async () => {
      while (cursor < indexes.length && current === session && !current.controller.signal.aborted) {
        const index = indexes[cursor++];
        await processItem(current, current.items[index], index);
      }
    };
    current.processingPromise = Promise.all(
      Array.from({ length: Math.min(uploadConcurrency(), indexes.length) }, () => worker())
    ).finally(() => {
      if (current === session) {
        current.processingPromise = null;
        form._media = current.items.filter((item) => item.mediaId).map((item) => ({ mediaId: item.mediaId }));
        updateStatus();
      }
    });
    updateReadyState();
    return current.processingPromise;
  };

  document.querySelector('#backMember').onclick = () => {
    releaseSession();
    home();
  };

  retryButton.onclick = () => {
    if (!session || session.processingPromise) return;
    const indexes = session.items
      .map((item, index) => (item.error && !item.mediaId ? index : -1))
      .filter((index) => index >= 0);
    if (indexes.length) void runIndexes(session, indexes);
  };

  form.images.onchange = () => {
    const files = [...(form.images.files || [])];
    releaseSession();
    preview.innerHTML = '';
    retryButton.hidden = true;
    if (!files.length) {
      status.textContent = '请选择图片。';
      updateReadyState();
      return;
    }
    if (files.length > maxImages) {
      form.images.value = '';
      status.textContent = `当前任务最多上传 ${maxImages} 张图片。`;
      void openDialog({
        title: '图片数量超过限制',
        message: `管理员设置当前任务最多上传 ${maxImages} 张图片，请重新选择。`,
        confirmText: '重新选择'
      });
      return;
    }
    const current = {
      controller: new AbortController(),
      items: files.map((file) => {
        const previewUrl = URL.createObjectURL(file);
        mediaPreviewUrls.add(previewUrl);
        return {
          file,
          previewUrl,
          idempotencyKey: createIdempotencyKey(),
          compressed: null,
          mediaId: null,
          uploadPromise: null,
          error: null
        };
      }),
      processingPromise: null
    };
    session = current;
    renderPreviews(preview, current.items.map((item) => ({ previewUrl: item.previewUrl })));
    status.textContent = `正在处理 ${current.items.length} 张图片…`;
    void runIndexes(current, current.items.map((_, index) => index));
  };

  form.onsubmit = async (event) => {
    event.preventDefault();
    const restoreButton = beginButtonLoading(submitButton, '正在提交…');
    if (session?.processingPromise) await session.processingPromise.catch(() => null);
    const mediaIds = session?.items?.map((item) => item.mediaId).filter(Boolean) || [];
    if (!session || mediaIds.length !== session.items.length) {
      status.textContent = '仍有图片未就绪，请重试失败图片。';
      restoreButton();
      updateReadyState();
      return;
    }
    try {
      const result = await api(`/api/tasks/${task.id}/member-checkin`, {
        method: 'PUT',
        retryOverload: true,
        timeoutMs: 120_000,
        body: JSON.stringify({
          occurrenceDate: task.occurrenceDate,
          mediaIds
        })
      });
      patchStudentTask(task.id, (cachedTask) => {
        const memberAlreadyCompleted = Boolean(cachedTask.memberCheckin);
        const members = cachedTask.teamProgress?.members?.map((member) => (
          member.id === user.id ? { ...member, checked: true } : member
        )) || [];
        return {
          ...cachedTask,
          memberCheckin: {
            id: cachedTask.memberCheckin?.id || `confirmed:${mediaIds[0]}`,
            userId: user.id,
            occurrenceDate: result.occurrenceDate || task.occurrenceDate,
            imageCount: mediaIds.length
          },
          teamProgress: cachedTask.teamProgress ? {
            ...cachedTask.teamProgress,
            completed: memberAlreadyCompleted
              ? cachedTask.teamProgress.completed
              : Math.min(cachedTask.teamProgress.total, cachedTask.teamProgress.completed + 1),
            members
          } : null
        };
      });
      releaseSession();
      recordPerf('submit', {
        action: 'member-checkin', success: true,
        imageCount: mediaIds.length, navigationEpoch
      });
      returnToCachedStudentHome('个人打卡成功');
    } catch (error) {
      recordPerf('submit', { action: 'member-checkin', success: false, navigationEpoch });
      alert(error?.message || '打卡提交失败，请稍后重试。');
      restoreButton();
      updateReadyState();
    }
  };
}
/* FRONTEND_MEMBER_CHECKIN_END */

/* FRONTEND_ADMIN_COMMENTS_START */
const renderAdminCommentsPage = (result, page, pageEpoch, options = {}) => {
  if (!isCurrentNavigation(pageEpoch)) return;
  document.body.dataset.view = 'admin-comments';
  const preservedScroll = options.preserveScroll ? window.scrollY : 0;
  app.innerHTML = `
    <header class="hero"><div class="row"><div><h1>评论管理</h1><p>管理员可查看并删除活动广场中的违规评论</p></div><button class="secondary right" id="backComments">返回后台</button></div></header>
    <section class="card"><div class="admin-comment-list">${result.comments.map((comment) => `
      <article class="comment-item" data-comment="${comment.id}" data-post="${comment.postId || ''}">
        <div class="row"><strong>${escapeHtml(comment.userName)}</strong><span class="muted">${formatDate(comment.createdAt)}</span></div>
        <p>${escapeHtml(comment.content)}</p>
        <div class="row"><span class="muted">所属队伍：${escapeHtml(comment.teamName)}</span><button class="danger right delete-admin-comment">删除评论</button></div>
      </article>`).join('') || '<p class="muted">暂无评论</p>'}</div>
      <div class="row plaza-pager"><button class="secondary" id="prevAdminComments" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${page} 页</span><button class="secondary" id="nextAdminComments" ${!result.hasMore ? 'disabled' : ''}>下一页</button></div>
      <p class="view-cache-status muted" id="adminCommentCacheStatus" hidden></p>
    </section>`;
  document.querySelector('#backComments').onclick = () => admin();
  document.querySelector('#prevAdminComments').onclick = () => adminComments(page - 1);
  document.querySelector('#nextAdminComments').onclick = () => adminComments(page + 1);
  document.querySelectorAll('.delete-admin-comment').forEach((button) => {
    button.onclick = async (event) => {
      const item = button.closest('[data-comment]');
      if (!await askConfirm('是否删除该评论？', '删除后活动广场会立即同步，且无法恢复。')) return;
      const restoreButton = beginButtonLoading(event.currentTarget, '删除中…');
      try {
        await api(`/api/admin/comments/${item.dataset.comment}`, { method: 'DELETE' });
        plazaViewCache.clear();
        adminCommentViewCache.clear();
        item.remove();
        showToast('评论已删除');
      } catch (error) {
        restoreButton();
        alert(error.message);
      }
    };
  });
  if (options.preserveScroll) requestAnimationFrame(() => window.scrollTo(0, preservedScroll));
};

async function adminComments(page = 1) {
  const pageEpoch = beginNavigation();
  const cacheKey = scopedCacheKey('admin-comments', page);
  const cached = readViewCache(adminCommentViewCache, cacheKey);
  const path = `/api/admin/comments?page=${page}&limit=20`;
  if (cached) {
    renderAdminCommentsPage(cached.data, page, pageEpoch);
    const refresh = async () => {
      try {
        const result = await api(path);
        writeViewCache(adminCommentViewCache, cacheKey, result);
        if (!isCurrentNavigation(pageEpoch) || document.body.dataset.view !== 'admin-comments') return;
        renderAdminCommentsPage(result, page, pageEpoch, { preserveScroll: true });
      } catch {
        const statusElement = document.querySelector('#adminCommentCacheStatus');
        if (statusElement) {
          statusElement.hidden = false;
          statusElement.textContent = '当前显示的是已缓存评论，最新数据刷新失败。';
        }
      }
    };
    if (cacheIsFresh(cached)) queueMicrotask(() => { void refresh(); });
    else void refresh();
    return;
  }
  app.innerHTML = '<main class="app-shell-placeholder" aria-busy="true"><header class="hero"></header><section class="card"></section></main>';
  const result = await api(path);
  writeViewCache(adminCommentViewCache, cacheKey, result);
  renderAdminCommentsPage(result, page, pageEpoch);
}
/* FRONTEND_ADMIN_COMMENTS_END */

/* BACKEND_INTERACTION_HISTORY_START */
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
      const placeholders = recordIds.map((_, index) => `?${index + 1}`).join(',');
      const media = await env.DB.prepare(
        `SELECT m.id,m.business_id AS checkinId,m.object_key AS objectKey,
                tm.id AS thumbMediaId,tm.object_key AS thumbObjectKey
           FROM media_objects m
           LEFT JOIN media_objects tm ON tm.business_id=m.id
            AND tm.business_type IN ('member-checkin:thumb','admin-makeup:thumb')
          WHERE m.business_type='member-checkin' AND m.business_id IN (${placeholders})
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
/* BACKEND_INTERACTION_HISTORY_END */

/* BACKEND_MEMBER_ROUTE_START */
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
    const occurrenceDate = cleanText(body.occurrenceDate || shanghaiDate(), 10);
    const makeupAllowed = await hasMakeupPermission(env, user.id, occurrenceDate);
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
    const firstImage = uploaded[0];
    const submittedAt = nowIso();
    const statements = [];
    for (const previous of oldMedia.results) {
      if (previous.thumbMediaId) statements.push(env.DB.prepare('DELETE FROM media_objects WHERE id=?1').bind(previous.thumbMediaId));
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
    ).bind(id, task.id, occurrenceDate, user.id, team.id, firstImage.objectKey,
      firstImage.contentType, firstImage.bytes, submittedAt));
    uploaded.forEach((image) => {
      statements.push(env.DB.prepare(
        `UPDATE media_objects SET business_id=?1,updated_at=?2
          WHERE id=?3 AND owner_user_id=?4 AND business_id IS NULL`
      ).bind(id, submittedAt, image.id, user.id));
    });
    statements.push(env.DB.prepare(
      `INSERT OR REPLACE INTO image_variants
        (source_type,source_id,variant,object_key,content_type,bytes,created_at)
       VALUES ('member_checkin',?1,'display',?2,?3,?4,?5)`
    ).bind(id, firstImage.objectKey, firstImage.contentType, firstImage.bytes, submittedAt));
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
  }
/* BACKEND_MEMBER_ROUTE_END */
