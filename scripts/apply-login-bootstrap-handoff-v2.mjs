import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* LOGIN_BOOTSTRAP_HANDOFF_V2 */';
const batchMarker = '/* LOGIN_D1_BATCH_V6 */';
const key = 'jinshan20.loginBootstrap.v2';
const read = (relativePath) => {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) throw new Error(`${relativePath}不存在`);
  return { file, source: fs.readFileSync(file, 'utf8') };
};
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');
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

// The login-only student snapshot uses one D1 batch after password verification.
// This keeps the normal dashboard builder as the compatibility fallback and does
// not change authentication, authorization, task visibility or response fields.
{
  const { file, source } = read('cloudflare/services/student-dashboard.js');
  if (!source.includes(batchMarker)) {
    let next = source;
    const taskReadOld = `  const [taskPage, makeupAllowed] = await Promise.all([\n    env.DB.prepare(\n      \`SELECT id,name,description,track_id AS trackId,starts_at AS startsAt,ends_at AS endsAt,\n              allow_late AS allowLate,image_limit AS imageLimit,copy_requirement AS copyRequirement,\n              submission_type AS submissionType,status,schedule_json AS scheduleJson\n         FROM tasks WHERE status='published' AND (?1='admin' OR track_id=?2)\n        ORDER BY starts_at DESC LIMIT 100\`\n    ).bind(user.role, user.trackId || '').all(),\n    user.role === 'student' ? hasMakeupPermission(env, user.id, today) : Promise.resolve(false)\n  ]);`;
    const taskReadNew = `  const taskPagePromise = options.taskPage\n    ? Promise.resolve(options.taskPage)\n    : env.DB.prepare(\n      \`SELECT id,name,description,track_id AS trackId,starts_at AS startsAt,ends_at AS endsAt,\n              allow_late AS allowLate,image_limit AS imageLimit,copy_requirement AS copyRequirement,\n              submission_type AS submissionType,status,schedule_json AS scheduleJson\n         FROM tasks WHERE status='published' AND (?1='admin' OR track_id=?2)\n        ORDER BY starts_at DESC LIMIT 100\`\n    ).bind(user.role, user.trackId || '').all();\n  const makeupPromise = options.makeupAllowed !== undefined\n    ? Promise.resolve(Boolean(options.makeupAllowed))\n    : (user.role === 'student' ? hasMakeupPermission(env, user.id, today) : Promise.resolve(false));\n  const [taskPage, makeupAllowed] = await Promise.all([taskPagePromise, makeupPromise]);`;
    if (next.includes(taskReadOld)) next = next.replace(taskReadOld, taskReadNew);
    else if (!next.includes('const taskPagePromise = options.taskPage')) {
      throw new Error('未找到login batch task preload，已停止以避免误改');
    }

    const checkinsOld = `  const checkinsPromise = (team && taskIds.length)\n    ? (async () => {`;
    const checkinsNew = `  const checkinsPromise = Array.isArray(options.checkins)\n    ? Promise.resolve(options.checkins)\n    : (team && taskIds.length)\n      ? (async () => {`;
    next = replaceOnce(next, checkinsOld, checkinsNew, 'login batch checkin preload');
    next = replaceOnce(
      next,
      `      return rows;\n    })()\n    : Promise.resolve([]);`,
      `        return rows;\n      })()\n      : Promise.resolve([]);`,
      'login batch checkin preload close'
    );

    next = replaceOnce(
      next,
      /  const submissions = \[\];\r?\n  if \(taskIds\.length && ownerPairs\.length\) \{/,
      `  const submissions = Array.isArray(options.submissions) ? [...options.submissions] : [];\n  if (!Array.isArray(options.submissions) && taskIds.length && ownerPairs.length) {`,
      'login batch submission preload'
    );

    const dashboardAnchor = 'export const buildStudentDashboard = async (env, user, options = {}) => {';
    const fastBuilder = `${batchMarker}\nexport const buildStudentDashboardForLogin = async (env, user) => {\n  if (user.role !== 'student' || user.trackId !== 'interaction' || typeof env.DB.batch !== 'function') {\n    return buildStudentDashboard(env, user);\n  }\n  const date = shanghaiDate();\n  try {\n    const configPromise = readConfig(env);\n    const statements = [\n      env.DB.prepare(\n        \`SELECT t.id AS teamId,t.name AS teamName,t.invite_code AS inviteCode,\n                t.member_limit AS memberLimit,t.captain_user_id AS captainId,t.created_at AS teamCreatedAt,\n                u.id AS memberId,u.student_id AS memberStudentId,u.name AS memberName,u.campus AS memberCampus,\n                u.track_id AS memberTrackId,u.status AS memberStatus,u.created_at AS memberCreatedAt,\n                (SELECT COUNT(*) FROM teams) AS teamCount\n           FROM team_members mine\n           JOIN teams t ON t.id=mine.team_id\n           LEFT JOIN team_members tm ON tm.team_id=t.id\n           LEFT JOIN users u ON u.id=tm.user_id\n          WHERE mine.user_id=?1\n          ORDER BY tm.joined_at,u.student_id\`\n      ).bind(user.id),\n      env.DB.prepare(\n        \`SELECT id,name,description,track_id AS trackId,starts_at AS startsAt,ends_at AS endsAt,\n                allow_late AS allowLate,image_limit AS imageLimit,copy_requirement AS copyRequirement,\n                submission_type AS submissionType,status,schedule_json AS scheduleJson\n           FROM tasks WHERE status='published' AND track_id=?1\n          ORDER BY starts_at DESC LIMIT 100\`\n      ).bind(user.trackId),\n      env.DB.prepare(\n        'SELECT enabled FROM makeup_permissions WHERE user_id=?1 AND checkin_date=?2'\n      ).bind(user.id, date),\n      env.DB.prepare(\n        \`SELECT user_id AS userId,id,task_id AS taskId,occurrence_date AS occurrenceDate\n           FROM member_checkins\n          WHERE team_id=(SELECT team_id FROM team_members WHERE user_id=?1 LIMIT 1)\n            AND task_id IN (SELECT id FROM tasks WHERE status='published' AND track_id=?2)\n            AND occurrence_date IN (?3,'')\`\n      ).bind(user.id, user.trackId, date),\n      env.DB.prepare(\n        \`SELECT id,task_id AS taskId,owner_type AS ownerType,owner_id AS ownerId,\n                copy_text AS copy,plaza_copy AS plazaCopy,meal_type AS mealType,\n                is_public AS isPublic,status,version,occurrence_date AS occurrenceDate,\n                submitted_at AS submittedAt,review_note AS reviewNote\n           FROM task_submissions\n          WHERE task_id IN (SELECT id FROM tasks WHERE status='published' AND track_id=?1)\n            AND occurrence_date IN (?2,'')\n            AND ((owner_type='user' AND owner_id=?3) OR\n                 (owner_type='team' AND owner_id=(SELECT team_id FROM team_members WHERE user_id=?3 LIMIT 1)))\`\n      ).bind(user.trackId, date, user.id),\n      env.DB.prepare(\n        \`SELECT COUNT(DISTINCT occurrence_date) AS total\n           FROM member_checkins WHERE user_id=?1 AND status!='rejected'\`\n      ).bind(user.id),\n      env.DB.prepare(\n        \`SELECT COUNT(DISTINCT COALESCE(NULLIF(occurrence_date,''),substr(submitted_at,1,10))) AS total\n           FROM task_submissions\n          WHERE owner_type='team'\n            AND owner_id=(SELECT team_id FROM team_members WHERE user_id=?1 LIMIT 1)\n            AND status IN ('submitted','approved')\`\n      ).bind(user.id)\n    ];\n    const [config, pages] = await Promise.all([configPromise, env.DB.batch(statements)]);\n    const teamRows = pages[0]?.results || [];\n    const first = teamRows[0] || null;\n    const team = first?.teamId ? {\n      id: first.teamId, name: first.teamName, inviteCode: first.inviteCode,\n      memberLimit: first.memberLimit, captainId: first.captainId, createdAt: first.teamCreatedAt\n    } : null;\n    const members = teamRows.filter((row) => row.memberId).map((row) => ({\n      id: row.memberId, studentId: row.memberStudentId, name: row.memberName,\n      campus: row.memberCampus, trackId: row.memberTrackId, status: row.memberStatus,\n      createdAt: row.memberCreatedAt\n    }));\n    const teamContext = { team, members, teamCount: Number(first?.teamCount || 0) };\n    const teamSummary = {\n      teamCount: teamContext.teamCount,\n      maxTeams: Number(config.maxTeams || 50),\n      team: team ? { ...team, members, memberCount: members.length } : null\n    };\n    const taskResult = await buildStudentTasks(env, user, {\n      config, date, teamContext, includeImages: false,\n      taskPage: { results: pages[1]?.results || [] },\n      makeupAllowed: Boolean(pages[2]?.results?.[0]?.enabled),\n      checkins: pages[3]?.results || [],\n      submissions: pages[4]?.results || []\n    });\n    return {\n      version: 1, user, config, tracks: TRACKS, date, time: shanghaiTime(), teamSummary,\n      tasks: taskResult.tasks, materialTasks: [],\n      checkinStats: {\n        personalDays: Number(pages[5]?.results?.[0]?.total || 0),\n        teamDays: Number(pages[6]?.results?.[0]?.total || 0)\n      },\n      switches: taskResult.switches\n    };\n  } catch {\n    return buildStudentDashboard(env, user);\n  }\n};\n\n${dashboardAnchor}`;
    const completeTeamBatchBuilder = fastBuilder.replace(
      '           FROM team_members mine\n           JOIN teams t ON t.id=mine.team_id\n           LEFT JOIN team_members tm ON tm.team_id=t.id\n           LEFT JOIN users u ON u.id=tm.user_id\n          WHERE mine.user_id=?1',
      '           FROM (SELECT 1) seed\n           LEFT JOIN team_members mine ON mine.user_id=?1\n           LEFT JOIN teams t ON t.id=mine.team_id\n           LEFT JOIN team_members tm ON tm.team_id=t.id\n           LEFT JOIN users u ON u.id=tm.user_id'
    );
    next = replaceOnce(next, dashboardAnchor, completeTeamBatchBuilder, 'login D1 batch dashboard builder');
    write(file, next);
  }
}

// Successful authentication may optionally return the exact student home snapshot
// generated from the already-authenticated user. Failure to build the acceleration
// payload never changes login success, token issuance, cookies or permissions.
{
  const { file, source } = read('cloudflare/worker.js');
  if (!source.includes(marker)) {
    const old = `  delete user.passwordHash;\n  const token = await createToken(user, env.SESSION_SECRET);\n  return json({\n    token,\n    user: {\n      id: user.id,\n      studentId: user.studentId,\n      name: user.name,\n      role: user.role,\n      trackId: user.trackId,\n      status: user.status\n    }\n  }, 200, {`;
    const replacement = `  delete user.passwordHash;\n  ${marker}\n  const loginUser = {\n    id: user.id,\n    studentId: user.studentId,\n    name: user.name,\n    role: user.role,\n    trackId: user.trackId,\n    status: user.status\n  };\n  const dashboardPromise = user.role === 'student'\n    ? buildStudentDashboard(env, user).catch(() => null)\n    : Promise.resolve(null);\n  const [token, dashboard] = await Promise.all([\n    createToken(user, env.SESSION_SECRET),\n    dashboardPromise\n  ]);\n  const bootstrap = dashboard ? {\n    ok: true,\n    user: {\n      id: user.id,\n      studentId: user.studentId,\n      name: user.name,\n      role: user.role,\n      campus: user.campus,\n      trackId: user.trackId,\n      status: user.status,\n      createdAt: user.createdAt\n    },\n    config: dashboard.config,\n    tracks: TRACKS,\n    date: dashboard.date || shanghaiDate(),\n    time: dashboard.time || shanghaiTime(),\n    dashboard\n  } : null;\n  return json({\n    token,\n    user: loginUser,\n    bootstrap\n  }, 200, {`;
    write(file, replaceOnce(source, old, replacement, '登录成功响应V2加速位置'));
  }
}

// Add phase telemetry and switch only the post-authentication snapshot to the
// D1 batch builder. Server-Timing names contain durations only, never identity data.
{
  const { file, source } = read('cloudflare/worker.js');
  if (!source.includes(batchMarker)) {
    let next = replaceOnce(
      source,
      "import { buildStudentDashboard } from './services/student-dashboard.js';",
      "import { buildStudentDashboard, buildStudentDashboardForLogin } from './services/student-dashboard.js';",
      'login batch worker import'
    );
    next = replaceOnce(
      next,
      '  const [attempt, user] = await Promise.all([',
      '  const lookupStartedAt = performance.now();\n  const [attempt, user] = await Promise.all([',
      'login lookup timing start'
    );
    next = replaceOnce(
      next,
      `  ]);\n  const now = Date.now();`,
      `  ]);\n  recordRequestTiming(request, 'login_lookup', performance.now() - lookupStartedAt);\n  const now = Date.now();`,
      'login lookup timing end'
    );
    next = replaceOnce(
      next,
      `  if (!user || user.status !== 'active' || !(await passwordMatches(password, user.passwordHash))) {`,
      `  const passwordStartedAt = performance.now();\n  const passwordAccepted = Boolean(user && user.status === 'active'\n    && await passwordMatches(password, user.passwordHash));\n  recordRequestTiming(request, 'login_password', performance.now() - passwordStartedAt);\n  if (!passwordAccepted) {`,
      'login password timing'
    );
    next = replaceOnce(
      next,
      `  if (attempt) {\n    await env.DB.prepare('DELETE FROM login_attempts WHERE identity_hash=?1').bind(identity).run();\n  }`,
      `  if (attempt) {\n    const cleanupStartedAt = performance.now();\n    await env.DB.prepare('DELETE FROM login_attempts WHERE identity_hash=?1').bind(identity).run();\n    recordRequestTiming(request, 'login_cleanup', performance.now() - cleanupStartedAt);\n  }`,
      'login attempt cleanup timing'
    );
    next = replaceOnce(
      next,
      `  const dashboardPromise = user.role === 'student'\n    ? buildStudentDashboard(env, user).catch(() => null)\n    : Promise.resolve(null);\n  const [token, dashboard] = await Promise.all([\n    createToken(user, env.SESSION_SECRET),\n    dashboardPromise\n  ]);`,
      `  ${batchMarker}\n  const tokenPromise = (async () => {\n    const startedAt = performance.now();\n    try {\n      return await createToken(user, env.SESSION_SECRET);\n    } finally {\n      recordRequestTiming(request, 'login_session', performance.now() - startedAt);\n    }\n  })();\n  const dashboardPromise = user.role === 'student'\n    ? (async () => {\n      const startedAt = performance.now();\n      try {\n        return await buildStudentDashboardForLogin(env, user);\n      } catch {\n        return null;\n      } finally {\n        recordRequestTiming(request, 'login_dashboard', performance.now() - startedAt);\n      }\n    })()\n    : Promise.resolve(null);\n  const [token, dashboard] = await Promise.all([tokenPromise, dashboardPromise]);`,
      'login batch dashboard and token timing'
    );
    next = replaceOnce(
      next,
      /  return json\(\{\r?\n    token,\r?\n    user: loginUser,\r?\n    bootstrap\r?\n  \}, 200, \{\r?\n    'set-cookie': `session_token=\$\{token\}; Path=\/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax`\r?\n  \}\);/,
      `  const serializeStartedAt = performance.now();\n  const response = json({\n    token,\n    user: loginUser,\n    bootstrap\n  }, 200, {\n    'set-cookie': \`session_token=\${token}; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax\`\n  });\n  recordRequestTiming(request, 'login_serialize', performance.now() - serializeStartedAt);\n  return response;`,
      'login serialization timing'
    );
    write(file, next);
  }
}

// Store the optional acceleration payload only after the normal token/user storage
// succeeds. The payload is never required for login and is discarded on validation failure.
{
  const { file, source } = read('public/entrance.js');
  if (!source.includes(marker)) {
    const old = `                    location.replace('/');`;
    const replacement = `                    ${marker}\n                    try {\n                        const bootstrap = result.bootstrap;\n                        if (bootstrap?.ok\n                            && bootstrap.user?.id\n                            && bootstrap.user.id === result.user?.id\n                            && bootstrap.dashboard) {\n                            sessionStorage.setItem(${JSON.stringify(key)}, JSON.stringify({\n                                savedAt: Date.now(),\n                                userId: result.user.id,\n                                data: bootstrap\n                            }));\n                        } else {\n                            sessionStorage.removeItem(${JSON.stringify(key)});\n                        }\n                    } catch {}\n                    location.replace('/');`;
    write(file, replaceOnce(source, old, replacement, '登录成功跳转V2交接位置'));
  }
}

// Warm only immutable/public static resources from the login document. They are not
// executed on the login page. The browser can reuse the HTTP-cache entries after the
// successful navigation while the server is authenticating/building the snapshot.
{
  const entrance = read('public/entrance.html');
  if (!entrance.source.includes('<!-- LOGIN_HOME_PREFETCH_V2 -->')) {
    const index = read('public/index.html').source;
    const bootstrap = read('public/bootstrap.js').source;
    const bootstrapUrl = index.match(/<script[^>]+src="([^"]*\/bootstrap\.js[^"]*)"/)?.[1];
    const styleUrl = bootstrap.match(/loadStylesheet\('([^']*\/style\.css[^']*)'\)/)?.[1];
    const sitePathUrl = bootstrap.match(/loadScript\('([^']*\/site-path\.js[^']*)'\)/)?.[1];
    const appUrl = bootstrap.match(/loadScript\('([^']*\/app\.js[^']*)'\)/)?.[1];
    if (!bootstrapUrl || !styleUrl || !sitePathUrl || !appUrl) {
      throw new Error('未找到登录页未来导航预取资源');
    }
    const links = [
      '    <!-- LOGIN_HOME_PREFETCH_V2 -->',
      `    <link rel="prefetch" href="${bootstrapUrl}" as="script">`,
      `    <link rel="prefetch" href="${styleUrl}" as="style">`,
      `    <link rel="prefetch" href="${sitePathUrl}" as="script">`,
      `    <link rel="prefetch" href="${appUrl}" as="script">`
    ].join('\n');
    write(entrance.file, replaceOnce(entrance.source, '</head>', `${links}\n</head>`, '登录页未来导航资源预取位置'));
  }
}

// The homepage consumes only a very recent, well-formed, same-user acceleration
// payload. Any missing/tampered/stale payload follows the existing /api/session path.
{
  const { file, source } = read('public/bootstrap.js');
  if (!source.includes(marker)) {
    const helper = `  ${marker}\n  const consumeLoginBootstrapV2 = () => {\n    try {\n      const raw = sessionStorage.getItem(${JSON.stringify(key)});\n      sessionStorage.removeItem(${JSON.stringify(key)});\n      if (!raw) return null;\n      const stored = JSON.parse(raw);\n      const age = Date.now() - Number(stored?.savedAt || 0);\n      const session = stored?.data;\n      const cachedUser = JSON.parse(localStorage.getItem('user') || 'null');\n      if (age < 0 || age > 10_000) return null;\n      if (!stored?.userId || stored.userId !== cachedUser?.id) return null;\n      if (!session?.ok || session.user?.id !== stored.userId || !session.dashboard || !session.config) return null;\n      return session;\n    } catch {\n      return null;\n    }\n  };\n`;
    let next = replaceOnce(
      source,
      '  const bootstrapStarted = performance.now();\n',
      `  const bootstrapStarted = performance.now();\n${helper}`,
      '首页V2交接帮助函数位置'
    );

    const networkBlock = /      const sessionRequest = fetch\('\/api\/session', \{([\s\S]*?)\r?\n      \}\);\r?\n      \/\/ The authenticated request is issued first; static public assets download in parallel while D1 builds the dashboard\.\r?\n      queueMicrotask\(warmHomeAssets\);\r?\n      const response = await sessionRequest;\r?\n      if \(response\.status === 401 \|\| response\.status === 403\) \{\r?\n        location\.replace\('\/entrance'\);\r?\n        return;\r?\n      \}\r?\n      if \(!response\.ok\) throw new Error\('session unavailable'\);\r?\n      const session = await response\.json\(\);\r?\n      window\.__RECORD_PERF__\('bootstrap-session', \{\r?\n        requestId: response\.headers\.get\('x-request-id'\) \|\| '',\r?\n        status: response\.status,\r?\n        duration: Math\.round\(\(performance\.now\(\) - bootstrapStarted\) \* 10\) \/ 10\r?\n      \}\);/;
    const match = next.match(networkBlock);
    if (!match) throw new Error('未找到V4首页session网络区块');
    const replacement = `      let session = consumeLoginBootstrapV2();\n      queueMicrotask(warmHomeAssets);\n      if (!session) {\n        const sessionRequest = fetch('/api/session', {${match[1]}\n        });\n        const response = await sessionRequest;\n        if (response.status === 401 || response.status === 403) {\n          location.replace('/entrance');\n          return;\n        }\n        if (!response.ok) throw new Error('session unavailable');\n        session = await response.json();\n        window.__RECORD_PERF__('bootstrap-session', {\n          source: 'network',\n          requestId: response.headers.get('x-request-id') || '',\n          status: response.status,\n          duration: Math.round((performance.now() - bootstrapStarted) * 10) / 10\n        });\n      } else {\n        window.__RECORD_PERF__('bootstrap-session', {\n          source: 'login-handoff-v2',\n          status: 200,\n          duration: Math.round((performance.now() - bootstrapStarted) * 10) / 10\n        });\n      }`;
    next = next.replace(networkBlock, replacement);
    write(file, next);
  }
}

// Legacy generators intentionally assert that the login page does not execute app.js.
// V2 only adds <link rel="prefetch">. Patch this one assertion after those generators
// have converged, preserving the original test title and every other test in the file.
{
  const { file, source } = read('test/production-media-login-performance.test.js');
  const oldAssertion = '  assert.doesNotMatch(html, /\\bapp\\.js\\b/);';
  const markerAssertion = '    assert.match(html, /LOGIN_HOME_PREFETCH_V2/);';
  if (!source.includes(markerAssertion)) {
    const replacement = [
      '  assert.doesNotMatch(html, /<script[^>]+src=["\'][^"\']*(?:\\/app\\.js|\\/bootstrap\\.js)/i);',
      '  if (/\\bapp\\.js\\b/.test(html) || /\\bbootstrap\\.js\\b/.test(html)) {',
      '    assert.match(html, /LOGIN_HOME_PREFETCH_V2/);',
      '    assert.match(html, /<link[^>]+rel=["\']prefetch["\'][^>]+href=["\'][^"\']*\\/(?:app|bootstrap)\\.js/i);',
      '  }'
    ].join('\n');
    write(file, replaceOnce(source, oldAssertion, replacement, '入口页主应用执行与prefetch区分断言'));
  }
}

const worker = read('cloudflare/worker.js').source;
const entrance = read('public/entrance.js').source;
const entranceHtml = read('public/entrance.html').source;
const bootstrap = read('public/bootstrap.js').source;
const productionPerformanceTest = read('test/production-media-login-performance.test.js').source;
if (!worker.includes(marker)
    || !worker.includes(batchMarker)
    || !worker.includes('buildStudentDashboardForLogin(env, user)')
    || !worker.includes("recordRequestTiming(request, 'login_dashboard'")
    || !worker.includes('bootstrap\n  }, 200, {')
    || !entrance.includes(marker)
    || !entrance.includes(key)
    || !entranceHtml.includes('LOGIN_HOME_PREFETCH_V2')
    || !bootstrap.includes(marker)
    || !bootstrap.includes('consumeLoginBootstrapV2')
    || !bootstrap.includes('age > 10_000')
    || !bootstrap.includes("source: 'login-handoff-v2'")
    || !bootstrap.includes("fetch('/api/session'")
    || !productionPerformanceTest.includes('assert.match(html, /LOGIN_HOME_PREFETCH_V2/);')
    || !productionPerformanceTest.includes("test('阶段B会话直接携带学生首页快照")) {
  throw new Error('安全登录首页交接V2生成不完整');
}

console.log('Applied safe login bootstrap handoff V2 with 10-second same-user validation, network fallback and prefetch-aware safety test.');
