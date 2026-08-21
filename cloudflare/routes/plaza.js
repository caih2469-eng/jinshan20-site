/* PLAZA_DETAIL_INSTANT_OPEN_V2 */
import { json, nowIso, requireUser, shanghaiDate } from '../lib/runtime.js';

/* PLAZA_SERVICE_ROUTE_V1 */

let schemaReady;
const ensureInteractionSchema = (env) => {
  if (!schemaReady) schemaReady = env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS plaza_comments (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL,
      content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'visible',
      created_at TEXT NOT NULL, deleted_at TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      actor_id TEXT, post_id TEXT, content TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_plaza_comments_post_status_created ON plaza_comments(post_id,status,created_at DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id,created_at DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id,is_read,created_at DESC)')
  ]).catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
};

const postDetails = async (env, post, user = null) => {
  /* PLAZA_DETAIL_INSTANT_OPEN_V2 */
  const userId = user?.id || null;
  const isAdmin = user?.role === 'admin';
  const [members, images, counts, comments] = await Promise.all([
    env.DB.prepare(
    `SELECT u.id,u.name,u.student_id AS studentId,u.campus
       FROM team_members tm JOIN users u ON u.id=tm.user_id
      WHERE tm.team_id=?1 ORDER BY tm.joined_at`
    ).bind(post.teamId).all(),
    env.DB.prepare(
    `SELECT i.id,i.sort_order AS sortOrder,
            COALESCE(tv.bytes,i.bytes) AS thumbVersion,
            COALESCE(dv.bytes,i.bytes) AS displayVersion
       FROM task_submission_images i
       LEFT JOIN image_variants tv ON tv.source_type='task_submission_image'
        AND tv.source_id=i.id AND tv.variant='thumb'
       LEFT JOIN image_variants dv ON dv.source_type='task_submission_image'
        AND dv.source_id=i.id AND dv.variant='display'
      WHERE i.submission_id=?1 ORDER BY i.sort_order`
    ).bind(post.submissionId).all(),
    env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM plaza_likes WHERE post_id=?1) AS likes,
       (SELECT COUNT(*) FROM plaza_views WHERE post_id=?1) AS views,
       (SELECT COUNT(*) FROM plaza_comments WHERE post_id=?1 AND status='visible') AS comments,
       EXISTS(SELECT 1 FROM plaza_likes WHERE post_id=?1 AND user_id=?2) AS liked,
       (SELECT COUNT(*) FROM plaza_likes
         WHERE user_id=?2 AND date(liked_at,'+8 hours')=?3) AS userLikesToday`
    ).bind(post.id, userId || '', shanghaiDate()).first(),
    isAdmin
      ? env.DB.prepare(
        `SELECT c.id,c.content,c.created_at AS createdAt,
                u.id AS userId,u.name AS userName,u.student_id AS studentId
           FROM plaza_comments c JOIN users u ON u.id=c.user_id
          WHERE c.post_id=?1 AND c.status='visible'
          ORDER BY c.created_at DESC`
      ).bind(post.id).all()
      : Promise.resolve({ results: [] })
  ]);
  return {
    ...post,
    members: members.results,
    publisherName: members.results[0]?.name || post.teamName,
    images: images.results.map((item) => ({
      ...item,
      thumbUrl: `/api/public-images/${encodeURIComponent(item.id)}?variant=thumb&v=${encodeURIComponent(item.thumbVersion)}`,
      displayUrl: `/api/public-images/${encodeURIComponent(item.id)}?variant=display&v=${encodeURIComponent(item.displayVersion)}`,
      imageUrl: `/api/public-images/${encodeURIComponent(item.id)}?variant=thumb&v=${encodeURIComponent(item.thumbVersion)}`
    })),
    likeCount: Number(counts.likes),
    viewCount: Number(counts.views),
    commentCount: Number(counts.comments),
    likeQuota: { used: Number(counts.userLikesToday), remaining: Math.max(0, 5 - Number(counts.userLikesToday)) },
    liked: Boolean(counts.liked),
    // This is deliberately only supplied to a verified administrator. Student
    // detail rendering remains on its existing paginated comments endpoint.
    ...(isAdmin ? { comments: comments.results } : {})
  };
};

const likeState = async (env, postId, userId) => {
  const counts = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM plaza_likes WHERE post_id=?1) AS likes,
       (SELECT COUNT(*) FROM plaza_likes
         WHERE user_id=?2 AND date(liked_at,'+8 hours')=?3) AS userLikesToday`
  ).bind(postId, userId, shanghaiDate()).first();
  const used = Number(counts?.userLikesToday || 0);
  return {
    likeCount: Number(counts?.likes || 0),
    likeQuota: { used, remaining: Math.max(0, 5 - used) }
  };
};

const periodBounds = (period, key) => {
  const today = shanghaiDate();
  if (period === 'month') {
    const month = /^\d{4}-\d{2}$/.test(key || '') ? key : today.slice(0, 7);
    const [year, monthNumber] = month.split('-').map(Number);
    const end = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
    return { start: `${month}-01`, end, key: month };
  }
  if (period === 'week') {
    const base = new Date(`${today}T00:00:00+08:00`);
    const day = (base.getUTCDay() + 6) % 7;
    base.setUTCDate(base.getUTCDate() - day);
    const start = base.toISOString().slice(0, 10);
    base.setUTCDate(base.getUTCDate() + 7);
    return { start, end: base.toISOString().slice(0, 10), key: start };
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(key || '') ? key : today;
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { start: date, end: next.toISOString().slice(0, 10), key: date };
};

export const calculateRankings = async (env, period, key) => {
  const bounds = periodBounds(period, key);
  if (period === 'month') {
    const frozen = await env.DB.prepare(
      'SELECT snapshot_json AS snapshotJson,frozen_at AS frozenAt FROM ranking_freezes WHERE period=?1'
    ).bind(bounds.key).first();
    if (frozen) return { period, key: bounds.key, frozen: true, frozenAt: frozen.frozenAt, ...JSON.parse(frozen.snapshotJson) };
  }
  const { results } = await env.DB.prepare(
    `SELECT t.id AS teamId,t.name AS teamName,
       COUNT(DISTINCT p.id) AS publicCount,
       COUNT(DISTINCT l.post_id || ':' || l.user_id) AS likes,
       COUNT(DISTINCT v.id) AS views
     FROM teams t
     LEFT JOIN plaza_posts p ON p.team_id=t.id AND p.status='visible'
       AND p.excluded_from_ranking=0 AND date(p.published_at,'+8 hours')>=?1
       AND date(p.published_at,'+8 hours')<?2
     LEFT JOIN plaza_likes l ON l.post_id=p.id
       AND date(l.liked_at,'+8 hours')>=?1 AND date(l.liked_at,'+8 hours')<?2
     LEFT JOIN plaza_views v ON v.post_id=p.id
       AND date(v.viewed_at,'+8 hours')>=?1 AND date(v.viewed_at,'+8 hours')<?2
     GROUP BY t.id,t.name`
  ).bind(bounds.start, bounds.end).all();
  const maxLikes = Math.max(0, ...results.map((item) => Number(item.likes)));
  const maxViews = Math.max(0, ...results.map((item) => Number(item.views)));
  const ranked = results.map((item) => ({
    teamId: item.teamId,
    teamName: item.teamName,
    publicCount: Number(item.publicCount),
    likes: Number(item.likes),
    views: Number(item.views),
    score: Number(((maxLikes ? Number(item.likes) / maxLikes : 0) * 70
      + (maxViews ? Number(item.views) / maxViews : 0) * 30).toFixed(4))
  })).sort((a, b) => b.score - a.score || b.likes - a.likes || b.views - a.views)
    .map((item, index) => ({ rank: index + 1, ...item }));
  return {
    period,
    key: bounds.key,
    frozen: false,
    likes: [...ranked].sort((a, b) => b.likes - a.likes).map((item, index) => ({ ...item, rank: index + 1 })),
    views: [...ranked].sort((a, b) => b.views - a.views).map((item, index) => ({ ...item, rank: index + 1 })),
    heat: ranked,
    teams: ranked
  };
};

export const handlePlazaRoutes = async (request, env, ctx, url, authenticatedUser = null) => {
  const route = url.pathname;
  if (route !== '/api/rankings'
      && route !== '/api/plaza'
      && route !== '/api/inbox'
      && route !== '/api/admin/comments'
      && !/^\/api\/plaza\/[^/]+(?:\/(?:view|like|comments))?$/.test(route)
      && !/^\/api\/plaza\/[^/]+\/comments\/[^/]+$/.test(route)
      && !/^\/api\/admin\/comments\/[^/]+$/.test(route)) return null;
  if (route === '/api/rankings' && request.method === 'GET') {
    const period = ['day', 'week', 'month'].includes(url.searchParams.get('period'))
      ? url.searchParams.get('period') : 'day';
    const cacheKey = new Request(`${url.origin}${route}?period=${period}&key=${url.searchParams.get('key') || ''}`);
    const cached = await caches.default.match(cacheKey);
    if (cached) return cached;
    const response = json(await calculateRankings(env, period, url.searchParams.get('key')), 200, {
      'cache-control': 'public, max-age=60',
      'cdn-cache-control': 'public, max-age=60'
    });
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    return response;
  }

  const auth = authenticatedUser ? { user: authenticatedUser } : await requireUser(request, env);
  if (auth.error) return auth.error;
  const user = auth.user;
  if (env.SKIP_RUNTIME_SCHEMA !== 'true') await ensureInteractionSchema(env);

  /* PLAZA_MOBILE_LAYOUT_V1 */
  if (route === '/api/plaza' && request.method === 'GET') {
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const sort = ['latest', 'hot', 'monthly'].includes(url.searchParams.get('sort'))
      ? url.searchParams.get('sort') : 'latest';
    const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '')
      ? url.searchParams.get('month') : shanghaiDate().slice(0, 7);
    const search = String(url.searchParams.get('q') || '').trim().slice(0, 40);
    const searchLike = search ? `%${search.replace(/[!%_]/g, '!$&')}%` : '';
    const monthValue = sort === 'monthly' ? month : '';
    const order = sort === 'hot'
      ? '(SELECT COUNT(*) FROM plaza_likes WHERE post_id=p.id) + (SELECT COUNT(*) FROM plaza_views WHERE post_id=p.id) DESC, p.published_at DESC'
      : 'p.published_at DESC';
    const sharedFilter = `
      WHERE p.status='visible'
        AND (?2='' OR t.name LIKE ?2 ESCAPE '!'
          OR task.name LIKE ?2 ESCAPE '!'
          OR p.copy_text LIKE ?2 ESCAPE '!'
          OR EXISTS (
            SELECT 1 FROM team_members search_tm
            JOIN users search_u ON search_u.id=search_tm.user_id
            WHERE search_tm.team_id=p.team_id AND search_u.name LIKE ?2 ESCAPE '!'
          ))
        AND (?3='' OR strftime('%Y-%m',p.published_at,'+8 hours')=?3)`;
    const query = `SELECT p.id,p.submission_id AS submissionId,p.team_id AS teamId,
          t.name AS teamName,task.name AS taskName,p.copy_text AS copy,p.published_at AS publishedAt,
          COALESCE((SELECT u.name FROM team_members tm JOIN users u ON u.id=tm.user_id
            WHERE tm.team_id=p.team_id ORDER BY tm.joined_at LIMIT 1),t.name) AS publisherName,
          (SELECT COUNT(*) FROM plaza_likes WHERE post_id=p.id) AS likeCount,
          (SELECT COUNT(*) FROM plaza_views WHERE post_id=p.id) AS viewCount,
          (SELECT COUNT(*) FROM plaza_comments WHERE post_id=p.id AND status='visible') AS commentCount,
          EXISTS(SELECT 1 FROM plaza_likes WHERE post_id=p.id AND user_id=?1) AS liked,
          (SELECT i.id FROM task_submission_images i WHERE i.submission_id=p.submission_id
            ORDER BY i.sort_order LIMIT 1) AS firstImageId,
          (SELECT COALESCE(tv.bytes,i.bytes) FROM task_submission_images i
            LEFT JOIN image_variants tv ON tv.source_type='task_submission_image'
              AND tv.source_id=i.id AND tv.variant='thumb'
            WHERE i.submission_id=p.submission_id ORDER BY i.sort_order LIMIT 1) AS thumbVersion,
          (SELECT COALESCE(dv.bytes,i.bytes) FROM task_submission_images i
            LEFT JOIN image_variants dv ON dv.source_type='task_submission_image'
              AND dv.source_id=i.id AND dv.variant='display'
            WHERE i.submission_id=p.submission_id ORDER BY i.sort_order LIMIT 1) AS displayVersion
       FROM plaza_posts p JOIN teams t ON t.id=p.team_id
       JOIN task_submissions s ON s.id=p.submission_id JOIN tasks task ON task.id=s.task_id
       ${sharedFilter}
       ORDER BY ${order} LIMIT ?4 OFFSET ?5`;
    const countQuery = `SELECT COUNT(*) AS total
       FROM plaza_posts p JOIN teams t ON t.id=p.team_id
       JOIN task_submissions s ON s.id=p.submission_id JOIN tasks task ON task.id=s.task_id
       ${sharedFilter.replaceAll('?2', '?1').replaceAll('?3', '?2')}`;
    const [{ results }, count] = await Promise.all([
      env.DB.prepare(query).bind(user.id, searchLike, monthValue, limit, (page - 1) * limit).all(),
      env.DB.prepare(countQuery).bind(searchLike, monthValue).first()
    ]);
    const posts = results.map((post) => ({
      ...post,
      members: [],
      likeCount: Number(post.likeCount),
      viewCount: Number(post.viewCount),
      commentCount: Number(post.commentCount),
      liked: Boolean(post.liked),
      images: post.firstImageId ? [{
        id: post.firstImageId,
        thumbUrl: `/api/public-images/${encodeURIComponent(post.firstImageId)}?variant=thumb&v=${encodeURIComponent(post.thumbVersion || post.firstImageId)}`,
        displayUrl: `/api/public-images/${encodeURIComponent(post.firstImageId)}?variant=display&v=${encodeURIComponent(post.displayVersion || post.firstImageId)}`,
        imageUrl: `/api/public-images/${encodeURIComponent(post.firstImageId)}?variant=thumb&v=${encodeURIComponent(post.thumbVersion || post.firstImageId)}`
      }] : []
    }));
    const total = Number(count?.total || 0);
    return json({ posts, page, limit, month, query: search, total, hasMore: page * limit < total });
  }

  const detailMatch = route.match(/^\/api\/plaza\/([^/]+)$/);
  if (detailMatch && request.method === 'GET') {
    const post = await env.DB.prepare(
      `SELECT p.id,p.submission_id AS submissionId,p.team_id AS teamId,t.name AS teamName,
              task.name AS taskName,p.copy_text AS copy,p.published_at AS publishedAt,
              p.status,p.excluded_from_ranking AS excludedFromRanking
         FROM plaza_posts p JOIN teams t ON t.id=p.team_id
         JOIN task_submissions s ON s.id=p.submission_id JOIN tasks task ON task.id=s.task_id
        WHERE p.id=?1 AND (p.status='visible' OR ?2='admin')`
    ).bind(decodeURIComponent(detailMatch[1]), user.role).first();
    return post ? json({ post: await postDetails(env, post, user) }) : json({ error: '作品不存在' }, 404);
  }

  const viewMatch = route.match(/^\/api\/plaza\/([^/]+)\/view$/);
  if (viewMatch && request.method === 'POST') {
    if (user.role === 'admin') return json({ ok: true, counted: false });
    const postId = decodeURIComponent(viewMatch[1]);
    const exists = await env.DB.prepare("SELECT 1 FROM plaza_posts WHERE id=?1 AND status='visible'").bind(postId).first();
    if (!exists) return json({ error: '作品不存在' }, 404);
    const result = await env.DB.prepare(
      `INSERT INTO plaza_views (id,post_id,user_id,window_started_at,viewed_at)
       SELECT ?1,?2,?3,?4,?4 WHERE NOT EXISTS (
         SELECT 1 FROM plaza_views WHERE post_id=?2 AND user_id=?3
          AND viewed_at>datetime(?4,'-24 hours')
       )`
    ).bind(crypto.randomUUID(), postId, user.id, nowIso()).run();
    return json({ ok: true, counted: Boolean(result.meta.changes) });
  }

  const likeMatch = route.match(/^\/api\/plaza\/([^/]+)\/like$/);
  if (likeMatch && request.method === 'POST') {
    if (user.role === 'admin') return json({ error: '管理员不参与点赞' }, 403);
    const postId = decodeURIComponent(likeMatch[1]);
    const body = await request.json();
    if (body.liked === false) {
      await env.DB.prepare('DELETE FROM plaza_likes WHERE post_id=?1 AND user_id=?2').bind(postId, user.id).run();
      return json({ ok: true, liked: false, ...await likeState(env, postId, user.id) });
    }
    const result = await env.DB.prepare(
      `INSERT INTO plaza_likes (post_id,user_id,liked_at)
       SELECT ?1,?2,?3 WHERE EXISTS (
         SELECT 1 FROM plaza_posts WHERE id=?1 AND status='visible'
       ) AND (
         SELECT COUNT(*) FROM plaza_likes
          WHERE user_id=?2 AND date(liked_at,'+8 hours')=?4
       ) < 5
       ON CONFLICT(post_id,user_id) DO NOTHING`
    ).bind(postId, user.id, nowIso(), shanghaiDate()).run();
    if (!result.meta.changes) {
      const already = await env.DB.prepare(
        'SELECT 1 FROM plaza_likes WHERE post_id=?1 AND user_id=?2'
      ).bind(postId, user.id).first();
      if (!already) return json({ error: '今天最多点赞 5 个作品' }, 429);
    }
    return json({ ok: true, liked: true, ...await likeState(env, postId, user.id) });
  }

  const commentsMatch = route.match(/^\/api\/plaza\/([^/]+)\/comments$/);
  if (commentsMatch && request.method === 'GET') {
    const postId = decodeURIComponent(commentsMatch[1]);
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') || 10)));
    const { results } = await env.DB.prepare(
      `SELECT c.id,c.content,c.created_at AS createdAt,u.id AS userId,u.name,u.student_id AS studentId
         FROM plaza_comments c JOIN users u ON u.id=c.user_id
        WHERE c.post_id=?1 AND c.status='visible'
        ORDER BY c.created_at DESC LIMIT ?2 OFFSET ?3`
    ).bind(postId, limit, (page - 1) * limit).all();
    return json({
      comments: results.map((item) => ({
        ...item,
        canDelete: user.role === 'admin' || item.userId === user.id
      })),
      page,
      hasMore: results.length === limit
    });
  }

  if (commentsMatch && request.method === 'POST') {
    const postId = decodeURIComponent(commentsMatch[1]);
    const body = await request.json();
    const content = String(body.content || '').trim();
    if (!content) return json({ error: '请输入评论内容' }, 400);
    if (content.length > 500) return json({ error: '评论最多500字' }, 400);
    const post = await env.DB.prepare(
      `SELECT p.id,p.team_id AS teamId FROM plaza_posts p
        WHERE p.id=?1 AND p.status='visible'`
    ).bind(postId).first();
    if (!post) return json({ error: '作品不存在或已隐藏' }, 404);
    const recentCount = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM plaza_comments
        WHERE user_id=?1 AND created_at>datetime(?2,'-60 seconds') AND status='visible'`
    ).bind(user.id, nowIso()).first();
    if (Number(recentCount.count) >= 5) return json({ error: '评论过于频繁，请稍后再试' }, 429);
    const duplicate = await env.DB.prepare(
      `SELECT 1 FROM plaza_comments
        WHERE user_id=?1 AND post_id=?2 AND content=?3
          AND created_at>datetime(?4,'-5 minutes') AND status='visible'`
    ).bind(user.id, postId, content, nowIso()).first();
    if (duplicate) return json({ error: '请勿短时间重复发布相同评论' }, 409);
    const id = crypto.randomUUID();
    const createdAt = nowIso();
    await env.DB.prepare(
      `INSERT INTO plaza_comments (id,post_id,user_id,content,status,created_at)
       VALUES (?1,?2,?3,?4,'visible',?5)`
    ).bind(id, postId, user.id, content, createdAt).run();
    const owners = await env.DB.prepare(
      `SELECT DISTINCT user_id AS userId FROM team_members
        WHERE team_id=?1 AND user_id<>?2`
    ).bind(post.teamId, user.id).all();
    if (owners.results.length) {
      await env.DB.batch(owners.results.map((owner) => env.DB.prepare(
        `INSERT INTO notifications
          (id,user_id,type,actor_id,post_id,content,is_read,created_at)
         VALUES (?1,?2,'comment',?3,?4,?5,0,?6)`
      ).bind(crypto.randomUUID(), owner.userId, user.id, postId,
        `${user.name}评论了你的作品：${content.slice(0, 80)}`, createdAt)));
    }
    return json({
      comment: { id, content, createdAt, userId: user.id, name: user.name, canDelete: true },
      commentCount: Number((await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM plaza_comments WHERE post_id=?1 AND status='visible'"
      ).bind(postId).first()).count)
    }, 201);
  }

  const deleteCommentMatch = route.match(/^\/api\/plaza\/([^/]+)\/comments\/([^/]+)$/);
  if (deleteCommentMatch && request.method === 'DELETE') {
    const postId = decodeURIComponent(deleteCommentMatch[1]);
    const commentId = decodeURIComponent(deleteCommentMatch[2]);
    const comment = await env.DB.prepare(
      'SELECT user_id AS userId FROM plaza_comments WHERE id=?1 AND post_id=?2 AND status=\'visible\''
    ).bind(commentId, postId).first();
    if (!comment) return json({ error: '评论不存在或已删除' }, 404);
    if (user.role !== 'admin' && comment.userId !== user.id) return json({ error: '只能删除自己的评论' }, 403);
    await env.DB.prepare(
      "UPDATE plaza_comments SET status='deleted',deleted_at=?1 WHERE id=?2"
    ).bind(nowIso(), commentId).run();
    return json({ ok: true });
  }

  if (route === '/api/inbox' && request.method === 'GET') {
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(30, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const { results } = await env.DB.prepare(
      `SELECT n.id,n.type,n.content,n.post_id AS postId,n.is_read AS isRead,
              n.created_at AS createdAt,a.name AS actorName
         FROM notifications n LEFT JOIN users a ON a.id=n.actor_id
        WHERE n.user_id=?1 ORDER BY n.created_at DESC LIMIT ?2 OFFSET ?3`
    ).bind(user.id, limit, (page - 1) * limit).all();
    const unread = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM notifications WHERE user_id=?1 AND is_read=0'
    ).bind(user.id).first();
    return json({ notifications: results, unread: Number(unread.count), page, hasMore: results.length === limit });
  }

  if (route === '/api/inbox' && request.method === 'PATCH') {
    const body = await request.json();
    if (body.id) {
      await env.DB.prepare('UPDATE notifications SET is_read=1 WHERE id=?1 AND user_id=?2')
        .bind(String(body.id), user.id).run();
    } else {
      await env.DB.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?1').bind(user.id).run();
    }
    return json({ ok: true });
  }

  if (route === '/api/admin/comments' && request.method === 'GET') {
    if (user.role !== 'admin') return json({ error: '无管理员权限' }, 403);
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const { results } = await env.DB.prepare(
      `SELECT c.id,c.content,c.created_at AS createdAt,u.name AS userName,
              p.id AS postId,t.name AS teamName
         FROM plaza_comments c JOIN users u ON u.id=c.user_id
         JOIN plaza_posts p ON p.id=c.post_id JOIN teams t ON t.id=p.team_id
        WHERE c.status='visible' ORDER BY c.created_at DESC LIMIT ?1 OFFSET ?2`
    ).bind(limit, (page - 1) * limit).all();
    return json({ comments: results, page, hasMore: results.length === limit });
  }

  const adminDeleteComment = route.match(/^\/api\/admin\/comments\/([^/]+)$/);
  if (adminDeleteComment && request.method === 'DELETE') {
    if (user.role !== 'admin') return json({ error: '无管理员权限' }, 403);
    const deleted = await env.DB.prepare(
      "UPDATE plaza_comments SET status='deleted',deleted_at=?1 WHERE id=?2 AND status='visible'"
    ).bind(nowIso(), decodeURIComponent(adminDeleteComment[1])).run();
    return deleted.meta.changes ? json({ ok: true }) : json({ error: '评论不存在或已删除' }, 404);
  }

  return null;
};
