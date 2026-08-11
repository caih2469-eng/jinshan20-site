import { shanghaiDate } from '../lib/runtime.js';

const clampLimit = (value) => Math.min(20, Math.max(1, Number(value) || 20));

// Build the exact latest Plaza first-page shape during the authenticated login
// handoff. This removes a later browser-to-Worker round trip; it does not change
// media variants, visibility rules, ordering or the normal /api/plaza fallback.
export const buildLoginPlazaFirstPage = async (env, userId, requestedLimit = 20) => {
  const limit = clampLimit(requestedLimit);
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
    WHERE p.status='visible' ORDER BY p.published_at DESC
    LIMIT ?2 OFFSET 0`;
  const countQuery = "SELECT COUNT(*) AS total FROM plaza_posts WHERE status='visible'";
  const [listResult, countResult] = await env.DB.batch([
    env.DB.prepare(query).bind(userId, limit),
    env.DB.prepare(countQuery)
  ]);
  const posts = (listResult?.results || []).map((post) => ({
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
  const total = Number(countResult?.results?.[0]?.total || 0);
  return {
    posts,
    page: 1,
    limit,
    month: shanghaiDate().slice(0, 7),
    total,
    hasMore: limit < total
  };
};
