import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULT_BASE_URL = 'https://jinshan20-test.pages.dev';
const DEFAULT_CONFIG = 'cloudflare/pages-test/wrangler.jsonc';
const DEFAULT_DATABASE = 'jinshan20-test';
const DEFAULT_FIXTURE = 'test/fixtures/member-checkin-fast-load.webp';
const CONCURRENCY_STAGES = Object.freeze([700]);
const WRITE_RAMP_MS = 180_000;
const wranglerCli = path.resolve('node_modules/wrangler/bin/wrangler.js');

export const validateLoadBaseUrl = (value) => {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const allowed = host === 'jinshan20-test.pages.dev'
    || host.endsWith('.jinshan20-test.pages.dev')
    || host === 'localhost'
    || host === '127.0.0.1'
    || (host.endsWith('.pages.dev') && /(?:^|[.-])(test|staging)(?:[.-]|$)/.test(host));
  if (!allowed || host === 'jinshan20.pages.dev' || host.includes('production')) {
    throw new Error(`写入压测拒绝非测试/预览域名：${host}`);
  }
  return url.origin;
};

const parseArgs = (argv) => {
  const options = {
    baseUrl: process.env.LOAD_BASE_URL || DEFAULT_BASE_URL,
    runId: process.env.LOAD_RUN_ID || `r${Date.now().toString(36)}`,
    users: Number(process.env.LOAD_USERS || 700),
    fixture: process.env.LOAD_FIXTURE || DEFAULT_FIXTURE,
    password: process.env.LOAD_TEST_PASSWORD || 'FastLoad2026',
    adminId: process.env.LOAD_ADMIN_ID || '',
    adminPassword: process.env.LOAD_ADMIN_PASSWORD || '',
    prepare: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--prepare') options.prepare = true;
    else if (item === '--base-url') options.baseUrl = argv[++index];
    else if (item === '--run-id') options.runId = argv[++index];
    else if (item === '--users') options.users = Number(argv[++index]);
    else if (item === '--fixture') options.fixture = argv[++index];
    else throw new Error(`未知参数：${item}`);
  }
  options.baseUrl = validateLoadBaseUrl(options.baseUrl);
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/i.test(options.runId)) throw new Error('runId格式无效');
  options.runId = options.runId.toLowerCase();
  if (!options.adminId) options.adminId = `lf-admin-${options.runId.slice(0, 30)}`;
  if (!options.adminPassword) options.adminPassword = options.password;
  if (!Number.isInteger(options.users) || options.users < 1 || options.users > 700) {
    throw new Error('users必须是1到700之间的整数');
  }
  return options;
};

const stripAnsi = (value) => String(value || '').replace(
  // eslint-disable-next-line no-control-regex
  /\u001b\[[0-9;]*m/g,
  ''
);

const runWrangler = (args) => {
  const result = spawnSync(process.execPath, [wranglerCli, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true
  });
  if (result.status === 0) return result.stdout;
  throw new Error(stripAnsi(`${result.stderr || ''}\n${result.stdout || ''}`).trim());
};

const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;

const prepareAccounts = async (options) => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'jinshan20-fast-load-'));
  const sqlFile = path.join(workDir, 'prepare.sql');
  const createdAt = new Date().toISOString();
  const startsAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const passwordHash = `sha256:${crypto.createHash('sha256').update(options.password).digest('hex')}`;
  const taskId = `load-fast-task-${options.runId}`;
  const statements = [
    `INSERT INTO users(id,student_id,name,password_hash,role,campus,track_id,status,created_at)
     VALUES (${sqlText(options.adminId)},${sqlText(options.adminId)},'Fast load administrator',
       ${sqlText(passwordHash)},'admin','test','interaction','active',${sqlText(createdAt)})
     ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash,role='admin',status='active';`,
    `INSERT INTO tasks
      (id,name,description,track_id,starts_at,ends_at,allow_late,image_limit,copy_requirement,
       submission_type,status,schedule_json,created_at,updated_at)
     VALUES (${sqlText(taskId)},${sqlText(`Fast上传压测 ${options.runId}`)},'','interaction',
       ${sqlText(startsAt)},${sqlText(endsAt)},0,1,'','team','published',NULL,
       ${sqlText(createdAt)},${sqlText(createdAt)})
     ON CONFLICT(id) DO UPDATE SET starts_at=excluded.starts_at,ends_at=excluded.ends_at,
       status='published',updated_at=excluded.updated_at;`
  ];
  const teamSize = 20;
  const teamCount = Math.ceil(options.users / teamSize);
  for (let teamIndex = 0; teamIndex < teamCount; teamIndex += 1) {
    const teamId = `load-fast-team-${options.runId}-${String(teamIndex + 1).padStart(3, '0')}`;
    const captainId = `load-fast-user-${options.runId}-${String(teamIndex * teamSize + 1).padStart(4, '0')}`;
    const inviteCode = crypto
      .createHash('sha256')
      .update(`${options.runId}:${teamIndex}`)
      .digest('hex')
      .slice(0, 8)
      .toUpperCase();
    statements.push(
      `INSERT INTO teams(id,name,invite_code,member_limit,captain_user_id,created_at)
       VALUES (${sqlText(teamId)},${sqlText(`Fast压测队伍${teamIndex + 1}`)},
        ${sqlText(inviteCode)},${teamSize},NULL,${sqlText(createdAt)})
       ON CONFLICT(id) DO UPDATE SET member_limit=excluded.member_limit;`
    );
    for (let member = 0; member < teamSize; member += 1) {
      const userIndex = teamIndex * teamSize + member;
      if (userIndex >= options.users) break;
      const number = String(userIndex + 1).padStart(4, '0');
      const userId = `load-fast-user-${options.runId}-${number}`;
      const studentId = `FAST-${options.runId}-${number}`;
      statements.push(
        `INSERT INTO users(id,student_id,name,password_hash,role,campus,track_id,status,created_at)
         VALUES (${sqlText(userId)},${sqlText(studentId)},${sqlText(`Fast压测用户${number}`)},
          ${sqlText(passwordHash)},'student','测试校区','interaction','active',${sqlText(createdAt)})
         ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash,status='active',
          track_id='interaction';`,
        `INSERT OR IGNORE INTO team_members(team_id,user_id,joined_at)
         VALUES (${sqlText(teamId)},${sqlText(userId)},${sqlText(createdAt)});`
      );
    }
    statements.push(
      `UPDATE teams SET captain_user_id=${sqlText(captainId)} WHERE id=${sqlText(teamId)};`
    );
  }
  await writeFile(sqlFile, `${statements.join('\n')}\n`, 'utf8');
  try {
    runWrangler([
      'd1', 'execute', DEFAULT_DATABASE,
      '--remote',
      '--config', DEFAULT_CONFIG,
      '--file', sqlFile
    ]);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
  return { taskId, users: options.users, teams: teamCount };
};

const percentile = (values, ratio) => {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
};

const summarize = (values) => ({
  count: values.length,
  averageMs: Number((values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)).toFixed(1)),
  p50Ms: Number(percentile(values, 0.5).toFixed(1)),
  p95Ms: Number(percentile(values, 0.95).toFixed(1)),
  p99Ms: Number(percentile(values, 0.99).toFixed(1)),
  maxMs: Number(Math.max(0, ...values).toFixed(1))
});

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const fetchJson = async (url, init = {}, retry = {}) => {
  const started = performance.now();
  const maxAttempts = Math.max(1, Math.min(12, Number(retry.maxAttempts || 1)));
  const statuses = [];
  let lastResult;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(Number(retry.timeoutMs || 30_000))
      });
      statuses.push(response.status);
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { raw: text.slice(0, 500) };
      }
      lastResult = {
        ok: response.ok,
        status: response.status,
        ms: performance.now() - started,
        body,
        attempts: attempt + 1,
        statuses: statuses.slice()
      };
      const retryable = [429, 503].includes(response.status)
        || /D1(?:_ERROR)?:[\s\S]*(?:overload|queued for too long)|D1 DB is overloaded/i
          .test(String(body?.error || ''));
      if (response.ok || !retryable || attempt === maxAttempts - 1) return lastResult;
    } catch (error) {
      statuses.push(0);
      lastResult = {
        ok: false,
        status: 0,
        ms: performance.now() - started,
        error: error instanceof Error ? error.message : String(error),
        attempts: attempt + 1,
        statuses: statuses.slice()
      };
      if (!retry.retryNetwork || attempt === maxAttempts - 1) return lastResult;
    }
    const ceiling = Math.min(
      Number(retry.maxDelayMs || 15_000),
      Number(retry.baseDelayMs || 1_000) * (2 ** attempt)
    );
    await sleep(Math.floor(Math.random() * (ceiling + 1)));
  }
  return lastResult;
};

const writeRetry = Object.freeze({
  maxAttempts: 10,
  baseDelayMs: 1_000,
  maxDelayMs: 15_000,
  timeoutMs: 120_000,
  retryNetwork: true
});

const login = (options, studentId, password) => fetchJson(`${options.baseUrl}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ studentId, password })
});

const adminInventory = async (options, adminToken) => {
  const inventoryUrl = `${options.baseUrl}/__load/member-checkin-fast/inventory?runId=${encodeURIComponent(options.runId)}`;
  for (let attempt = 0; attempt < 46; attempt += 1) {
    const result = await fetchJson(
      inventoryUrl,
      { headers: { authorization: `Bearer ${adminToken}`, 'cache-control': 'no-cache' } }
    );
    if (result.ok) return result.body;
    const deploymentPending = result.status === 404
      && /负载测试接口未启用/.test(String(result.body?.error || ''));
    if (!deploymentPending || attempt === 45) {
      throw new Error(`测试库存查询失败：${result.status} ${JSON.stringify(result.body || result.error)}`);
    }
    await sleep(2_000);
  }
  throw new Error('测试库存查询等待超时');
};

const runPool = async (items, concurrency, worker) => {
  const results = new Array(items.length);
  let cursor = 0;
  const runner = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
};

const runUserWorkflow = async (options, fixture, metadata, taskId, userNumber) => {
  const number = String(userNumber).padStart(4, '0');
  const studentId = `FAST-${options.runId}-${number}`;
  const idempotencyKey = crypto.randomUUID();
  const result = {
    userNumber,
    studentId,
    idempotencyKey,
    phases: {},
    statuses: [],
    ok: false
  };

  const loginResult = await login(options, studentId, options.password);
  result.phases.login = loginResult.ms;
  result.statuses.push(...loginResult.statuses);
  if (!loginResult.ok || !loginResult.body?.token) {
    result.error = `login:${loginResult.status}:${loginResult.body?.error || loginResult.error || 'unknown'}`;
    return result;
  }
  const token = loginResult.body.token;
  // Keep all 700 workflows active while modelling real mobile image preparation
  // and tap timing instead of an impossible same-millisecond write stampede.
  const writeArrivalDelayMs = options.users > 1
    ? Math.floor(((userNumber - 1) / (options.users - 1)) * WRITE_RAMP_MS)
    : 0;
  result.phases.writeArrivalDelayMs = writeArrivalDelayMs;
  if (writeArrivalDelayMs) await sleep(writeArrivalDelayMs);
  const fast = await fetchJson(`${options.baseUrl}/api/media/member-checkin-fast`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'image/webp',
      'x-task-id': taskId,
      'x-image-width': String(metadata.width),
      'x-image-height': String(metadata.height),
      'x-idempotency-key': idempotencyKey
    },
    body: fixture
  }, writeRetry);
  result.phases.fastUpload = fast.ms;
  result.statuses.push(...fast.statuses);
  result.phases.fastUploadAttempts = fast.attempts;
  if (!fast.ok || fast.body?.media?.id !== idempotencyKey) {
    result.error = `fast:${fast.status}:${fast.body?.error || fast.error || 'unknown'}`;
    return result;
  }
  result.fastUploaded = true;

  const occurrenceDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai'
  }).format(new Date());
  const submit = await fetchJson(
    `${options.baseUrl}/api/tasks/${encodeURIComponent(taskId)}/member-checkin`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ occurrenceDate, mediaIds: [idempotencyKey] })
    },
    writeRetry
  );
  result.phases.memberCheckinPut = submit.ms;
  result.statuses.push(...submit.statuses);
  result.phases.memberCheckinPutAttempts = submit.attempts;
  if (!submit.ok) {
    result.error = `put:${submit.status}:${submit.body?.error || submit.error || 'unknown'}`;
    return result;
  }

  const verifyStarted = performance.now();
  let verify;
  let verified = false;
  let verifyAttempts = 0;
  for (; verifyAttempts < 8; verifyAttempts += 1) {
    verify = await fetchJson(`${options.baseUrl}/api/checkins/history?page=1&limit=20`, {
      headers: { authorization: `Bearer ${token}` }
    });
    result.statuses.push(...verify.statuses);
    verified = verify.ok && verify.body?.records?.some(
      (record) => record.date === occurrenceDate
        && Array.isArray(record.images)
        && record.images.length === 1
        && Boolean(record.images[0]?.displayUrl || record.images[0]?.imageUrl)
    );
    if (verified) break;
    await sleep(Math.min(2_000, 250 * (2 ** verifyAttempts)));
  }
  result.phases.queryVerify = performance.now() - verifyStarted;
  result.phases.queryVerifyAttempts = Math.min(8, verifyAttempts + 1);
  if (!verified) {
    result.error = `verify:${verify.status}:record-not-found`;
    return result;
  }
  result.ok = true;
  result.token = token;
  return result;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const fixture = await readFile(options.fixture);
  const metadata = await sharp(fixture).metadata();
  if (metadata.format !== 'webp' || !metadata.width || !metadata.height) {
    throw new Error('压测fixture必须是真实有效的WebP图片');
  }
  if (fixture.byteLength > 307_200 || Math.max(metadata.width, metadata.height) > 960) {
    throw new Error('压测fixture必须小于等于300KB且最长边不超过960px');
  }
  const prepared = options.prepare
    ? await prepareAccounts(options)
    : { taskId: `load-fast-task-${options.runId}`, users: options.users };

  const adminLogin = await login(options, options.adminId, options.adminPassword);
  if (!adminLogin.ok || !adminLogin.body?.token) {
    throw new Error(`管理员登录失败：${adminLogin.status}`);
  }
  const adminToken = adminLogin.body.token;
  const before = await adminInventory(options, adminToken);
  const allocations = [];
  let nextUser = 1;
  for (let index = 0; index < CONCURRENCY_STAGES.length; index += 1) {
    const remainingStages = CONCURRENCY_STAGES.length - index;
    const remainingUsers = options.users - nextUser + 1;
    const size = index === CONCURRENCY_STAGES.length - 1
      ? remainingUsers
      : Math.floor(remainingUsers / remainingStages);
    allocations.push(Array.from({ length: size }, () => nextUser++));
  }

  const report = {
    schemaVersion: 1,
    environment: options.baseUrl,
    runId: options.runId,
    generatedAt: new Date().toISOString(),
    users: options.users,
    loadShape: {
      activeWorkflowConcurrency: 700,
      writeRampMs: WRITE_RAMP_MS,
      splitIntoBatches: false
    },
    fixture: {
      path: options.fixture,
      bytes: fixture.byteLength,
      mimeType: 'image/webp',
      width: metadata.width,
      height: metadata.height
    },
    prepared,
    inventoryBefore: before,
    stages: [],
    idempotency: null,
    inventoryAfter: null,
    acceptance: null
  };
  const allResults = [];
  for (let index = 0; index < CONCURRENCY_STAGES.length; index += 1) {
    const concurrency = CONCURRENCY_STAGES[index];
    const users = allocations[index];
    const started = performance.now();
    const results = await runPool(users, concurrency, (userNumber) =>
      runUserWorkflow(options, fixture, metadata, prepared.taskId, userNumber));
    allResults.push(...results);
    const successes = results.filter((item) => item.ok);
    const allStatuses = results.flatMap((item) => item.statuses);
    report.stages.push({
      concurrency,
      users: users.length,
      successes: successes.length,
      failures: results.length - successes.length,
      successRate: Number((successes.length / Math.max(1, results.length) * 100).toFixed(2)),
      fiveXx: allStatuses.filter((status) => status >= 500 && status < 600).length,
      wallTimeMs: Number((performance.now() - started).toFixed(1)),
      latency: {
        login: summarize(results.map((item) => item.phases.login).filter(Number.isFinite)),
        memberCheckinFast: summarize(results.map((item) => item.phases.fastUpload).filter(Number.isFinite)),
        memberCheckinPut: summarize(results.map((item) => item.phases.memberCheckinPut).filter(Number.isFinite)),
        queryVerify: summarize(results.map((item) => item.phases.queryVerify).filter(Number.isFinite))
      },
      retryAttempts: {
        memberCheckinFast: summarize(results.map((item) => item.phases.fastUploadAttempts).filter(Number.isFinite)),
        memberCheckinPut: summarize(results.map((item) => item.phases.memberCheckinPutAttempts).filter(Number.isFinite)),
        queryVerify: summarize(results.map((item) => item.phases.queryVerifyAttempts).filter(Number.isFinite))
      },
      errors: results.filter((item) => !item.ok).slice(0, 10).map((item) => ({
        studentId: item.studentId,
        error: item.error
      }))
    });
  }

  const firstSuccess = allResults.find((item) => item.ok);
  if (firstSuccess) {
    const inventoryBeforeRepeat = await adminInventory(options, adminToken);
    const repeat = await fetchJson(`${options.baseUrl}/api/media/member-checkin-fast`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${firstSuccess.token}`,
        'content-type': 'image/webp',
        'x-task-id': prepared.taskId,
        'x-image-width': String(metadata.width),
        'x-image-height': String(metadata.height),
        'x-idempotency-key': firstSuccess.idempotencyKey
      },
      body: fixture
    }, writeRetry);
    const inventoryAfterRepeat = await adminInventory(options, adminToken);
    report.idempotency = {
      status: repeat.status,
      repeated: repeat.body?.repeated === true,
      mediaIdMatches: repeat.body?.media?.id === firstSuccess.idempotencyKey,
      r2ObjectsUnchanged: inventoryBeforeRepeat.r2Objects === inventoryAfterRepeat.r2Objects,
      mediaObjectsUnchanged:
        inventoryBeforeRepeat.mediaObjects === inventoryAfterRepeat.mediaObjects
    };
  }
  report.inventoryAfter = await adminInventory(options, adminToken);

  for (const item of allResults) delete item.token;
  const successful = allResults.filter((item) => item.ok).length;
  const fiveXx = allResults.flatMap((item) => item.statuses)
    .filter((status) => status >= 500 && status < 600).length;
  const totalRequests = allResults.reduce((sum, item) => sum + item.statuses.length, 0);
  report.acceptance = {
    successful,
    failed: allResults.length - successful,
    successRate: Number((successful / Math.max(1, allResults.length) * 100).toFixed(2)),
    fiveXx,
    fiveXxRate: Number((fiveXx / Math.max(1, totalRequests) * 100).toFixed(3)),
    noDuplicateSubmissions:
      report.inventoryAfter.memberCheckins === successful,
    noDuplicateMediaObjects:
      report.inventoryAfter.duplicateMediaObjectKeys === 0,
    r2ObjectsEqualSuccessfulUploads:
      report.inventoryAfter.r2Objects
        === allResults.filter((item) => item.fastUploaded).length,
    thumbIsZero: report.inventoryAfter.thumbMediaObjects === 0,
    idempotencyPassed: Boolean(
      report.idempotency?.repeated
      && report.idempotency?.mediaIdMatches
      && report.idempotency?.r2ObjectsUnchanged
      && report.idempotency?.mediaObjectsUnchanged
    )
  };
  report.acceptance.passed = options.users === 700
    && report.acceptance.successRate >= 99
    && report.acceptance.fiveXxRate < 1
    && report.acceptance.noDuplicateSubmissions
    && report.acceptance.noDuplicateMediaObjects
    && report.acceptance.r2ObjectsEqualSuccessfulUploads
    && report.acceptance.thumbIsZero
    && report.acceptance.idempotencyPassed;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.acceptance.passed) process.exitCode = 1;
};

if (process.argv[1] && path.basename(process.argv[1]) === 'staging-member-checkin-fast-load.mjs') {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
