const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const VALID_KEY = '11111111-1111-4111-8111-111111111111';

const webpBytes = (size = 64, marker = 1) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes[15] = marker;
  return bytes;
};

const createState = () => ({
  users: new Map([
    ['student-1', {
      id: 'student-1',
      studentId: '246731001',
      name: '成员一',
      role: 'student',
      campus: '南平',
      trackId: 'interaction',
      status: 'active',
      createdAt: '2026-07-01T00:00:00.000Z'
    }],
    ['student-2', {
      id: 'student-2',
      studentId: '246731002',
      name: '成员二',
      role: 'student',
      campus: '南平',
      trackId: 'interaction',
      status: 'active',
      createdAt: '2026-07-01T00:00:00.000Z'
    }],
    ['health-1', {
      id: 'health-1',
      studentId: '246731003',
      name: '健康成员',
      role: 'student',
      campus: '南平',
      trackId: 'health',
      status: 'active',
      createdAt: '2026-07-01T00:00:00.000Z'
    }]
  ]),
  task: {
    id: 'task-1',
    trackId: 'interaction',
    submissionType: 'team',
    startsAt: '2020-01-01T00:00:00.000Z',
    endsAt: '2035-01-01T00:00:00.000Z',
    scheduleJson: null,
    status: 'published'
  },
  teamMembers: new Set(['student-1', 'student-2']),
  checkinSettings: {
    enabled: true,
    activeStartDate: '2020-01-01',
    activeEndDate: '2035-01-01',
    dailyStart: '00:00',
    dailyEnd: '23:59',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    personalImageLimit: 3,
    teamImageLimit: 3
  },
  intents: new Map(),
  media: new Map(),
  objects: new Map(),
  makeup: false,
  failBatch: false,
  overloadBatches: 0,
  overloadReads: 0,
  d1Batches: 0,
  puts: 0,
  deletes: 0
});

class Statement {
  constructor(state, sql) {
    this.state = state;
    this.sql = sql.replace(/\s+/g, ' ').trim();
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    const { state, sql, args } = this;
    if (state.overloadReads > 0) {
      state.overloadReads -= 1;
      throw new Error('D1_ERROR: D1 DB is overloaded. Requests queued for too long.');
    }
    if (/FROM users WHERE id/i.test(sql)) return state.users.get(args[0]) || null;
    if (/FROM tasks WHERE id/i.test(sql)) return args[0] === state.task.id ? { ...state.task } : null;
    if (/FROM teams t JOIN team_members/i.test(sql)) {
      return state.teamMembers.has(args[0])
        ? {
            id: 'team-1',
            name: '第一队',
            inviteCode: 'TEAM0001',
            memberLimit: 4,
            captainId: 'student-1',
            createdAt: '2026-07-01T00:00:00.000Z'
          }
        : null;
    }
    if (/FROM makeup_permissions/i.test(sql)) return { enabled: state.makeup ? 1 : 0 };
    if (/FROM media_upload_intents WHERE id/i.test(sql)) return state.intents.get(args[0]) || null;
    if (/FROM media_objects(?: m JOIN media_upload_intents i ON i\.id=m\.id)? WHERE (?:m\.)?id/i.test(sql)) {
      const media = state.media.get(args[0]) || null;
      if (!media) return null;
      if (args[1] && media.ownerUserId !== args[1]) return null;
      return {
        ...media,
        status: state.intents.get(args[0])?.status
      };
    }
    return null;
  }

  async all() {
    if (/SELECT key, value_json AS valueJson FROM app_config/i.test(this.sql)) {
      if (!this.state.checkinSettings) return { results: [] };
      return {
        results: [{
          key: 'checkinSettings',
          valueJson: JSON.stringify(this.state.checkinSettings)
        }]
      };
    }
    return { results: [] };
  }

  async run() {
    const { state, sql, args } = this;
    if (/CREATE TABLE IF NOT EXISTS makeup_permissions/i.test(sql)) {
      return { success: true, meta: { changes: 0 } };
    }
    if (/INSERT OR IGNORE INTO media_upload_intents/i.test(sql)) {
      if (state.intents.has(args[0])) return { success: true, meta: { changes: 0 } };
      state.intents.set(args[0], {
        id: args[0],
        userId: args[1],
        taskId: args[2],
        businessType: 'member-checkin',
        objectKey: args[3],
        mimeType: args[4],
        expectedSize: args[5],
        width: args[6],
        height: args[7],
        status: 'pending'
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (/INSERT OR IGNORE INTO media_objects/i.test(sql)) {
      if (state.media.has(args[0])) return { success: true, meta: { changes: 0 } };
      state.media.set(args[0], {
        id: args[0],
        ownerUserId: args[1],
        taskId: args[2],
        businessType: 'member-checkin',
        objectKey: args[3],
        mimeType: args[4],
        fileSize: args[5],
        width: args[6],
        height: args[7]
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (/UPDATE media_upload_intents SET status='confirmed'/i.test(sql)) {
      const intent = state.intents.get(args[1]);
      if (!intent || intent.userId !== args[2] || intent.status !== 'pending') {
        return { success: true, meta: { changes: 0 } };
      }
      intent.status = 'confirmed';
      return { success: true, meta: { changes: 1 } };
    }
    return { success: true, meta: { changes: 0 } };
  }
}

const createEnv = (state) => ({
  SESSION_SECRET: 'member-fast-session-secret-at-least-32-bytes',
  MEDIA_SIGNING_SECRET: 'member-fast-media-secret-at-least-32-bytes',
  ENVIRONMENT: 'test',
  PROJECT_NAME: 'jinshan20-test',
  DB: {
    prepare(sql) { return new Statement(state, sql); },
    async batch(statements) {
      state.d1Batches += 1;
      if (state.failBatch) throw new Error('simulated D1 failure');
      if (state.overloadBatches > 0) {
        state.overloadBatches -= 1;
        throw new Error('D1_ERROR: D1 DB is overloaded. Requests queued for too long.');
      }
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    }
  },
  UPLOADS: {
    async head(key) {
      const object = state.objects.get(key);
      return object ? { ...object } : null;
    },
    async put(key, value, options) {
      state.puts += 1;
      const bytes = new Uint8Array(value);
      state.objects.set(key, {
        size: bytes.byteLength,
        httpMetadata: options.httpMetadata,
        customMetadata: options.customMetadata,
        httpEtag: `"etag-${state.puts}"`,
        bytes
      });
    },
    async delete(key) {
      state.deletes += 1;
      state.objects.delete(key);
    }
  }
});

const requestFor = (token, bytes, headers = {}) => new Request(
  'https://jinshan20-test.pages.dev/api/media/member-checkin-fast',
  {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'image/webp',
      'x-task-id': 'task-1',
      'x-image-width': '960',
      'x-image-height': '640',
      'x-idempotency-key': VALID_KEY,
      ...headers
    },
    body: bytes
  }
);

test('个人打卡多图复用fast接口、每图最多三轮压缩且不生成缩略图', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  const memberBody = app.match(
    /function memberCheckinForm\(task\) \{([\s\S]*?)\r?\n\}\r?\n\r?\nfunction materialSubmissionForm/
  )?.[1] || '';
  assert.match(memberBody, /uploadMemberCheckinFast/);
  assert.match(memberBody, /multiple required/);
  assert.match(memberBody, /session\?\.items\?\.map\(\(item\) => item\.mediaId\)/);
  assert.match(memberBody, /mediaIds\s*\n\s*}\)/);
  assert.doesNotMatch(memberBody, /readFiles|uploadCompressedImage|upload-intents|thumb/i);
  assert.match(app, /const MEMBER_FAST_MAX_BYTES = 307_200/);
  assert.match(app, /\{ maxWidthOrHeight: 960, initialQuality: 0\.76, maxSizeMB: 0\.25 \}/);
  assert.match(app, /\{ maxWidthOrHeight: 960, initialQuality: 0\.70, maxSizeMB: 0\.30 \}/);
  assert.match(app, /\{ maxWidthOrHeight: 800, initialQuality: 0\.68, maxSizeMB: 0\.30 \}/);
  assert.match(app, /图片压缩后仍超过300KB，请先在相册中裁剪、截图或压缩后重新上传。/);
});

test('fast接口一次写入一个私有R2对象和一个media对象，重复请求安全复用', async () => {
  const [{ default: worker }, { createToken }] = await Promise.all([
    import('../cloudflare/worker.js'),
    import('../cloudflare/lib/runtime.js')
  ]);
  const state = createState();
  const env = createEnv(state);
  const token = await createToken(state.users.get('student-1'), env.SESSION_SECRET);
  const bytes = webpBytes();
  const first = await worker.fetch(requestFor(token, bytes), env, { waitUntil() {} });
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.equal(firstBody.ok, true);
  assert.equal(firstBody.repeated, false);
  assert.equal(firstBody.media.id, VALID_KEY);
  assert.equal(firstBody.media.fileSize, bytes.byteLength);
  assert.equal(state.puts, 1);
  assert.equal(state.objects.size, 1);
  assert.equal(state.media.size, 1);
  assert.equal(state.intents.get(VALID_KEY).status, 'confirmed');
  assert.equal(state.d1Batches, 1, '首次fast上传的D1写入应合并为一个事务批次');

  const second = await worker.fetch(requestFor(token, bytes), env, { waitUntil() {} });
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.repeated, true);
  assert.equal(secondBody.media.id, VALID_KEY);
  assert.equal(state.puts, 1);
  assert.equal(state.objects.size, 1);
  assert.equal(state.media.size, 1);
});

test('fast接口拒绝越权、错误赛道、无队伍、关闭任务和幂等内容冲突', async () => {
  const [{ default: worker }, { createToken }] = await Promise.all([
    import('../cloudflare/worker.js'),
    import('../cloudflare/lib/runtime.js')
  ]);
  const state = createState();
  const env = createEnv(state);
  const token1 = await createToken(state.users.get('student-1'), env.SESSION_SECRET);
  const healthToken = await createToken(state.users.get('health-1'), env.SESSION_SECRET);
  const bytes = webpBytes();

  const anonymous = await worker.fetch(requestFor('', bytes), env, { waitUntil() {} });
  assert.equal(anonymous.status, 401);
  const health = await worker.fetch(requestFor(healthToken, bytes), env, { waitUntil() {} });
  assert.equal(health.status, 403);

  state.teamMembers.delete('student-1');
  const noTeam = await worker.fetch(requestFor(token1, bytes), env, { waitUntil() {} });
  assert.equal(noTeam.status, 403);
  state.teamMembers.add('student-1');

  state.task.status = 'draft';
  const closed = await worker.fetch(requestFor(token1, bytes), env, { waitUntil() {} });
  assert.equal(closed.status, 404);
  state.task.status = 'published';

  const first = await worker.fetch(requestFor(token1, bytes), env, { waitUntil() {} });
  assert.equal(first.status, 201);
  const changed = await worker.fetch(requestFor(token1, webpBytes(64, 2)), env, { waitUntil() {} });
  assert.equal(changed.status, 409);

  const token2 = await createToken(state.users.get('student-2'), env.SESSION_SECRET);
  const otherUser = await worker.fetch(requestFor(token2, bytes), env, { waitUntil() {} });
  assert.equal(otherUser.status, 403);
});

test('fast接口严格校验幂等UUID和时间窗口，仅明确补卡权限可放行', async () => {
  const [{ default: worker }, { createToken }] = await Promise.all([
    import('../cloudflare/worker.js'),
    import('../cloudflare/lib/runtime.js')
  ]);
  const state = createState();
  const env = createEnv(state);
  const token = await createToken(state.users.get('student-1'), env.SESSION_SECRET);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const currentTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date());
  const closedWindow = currentTime < '12:00'
    ? { dailyStart: '23:58', dailyEnd: '23:59' }
    : { dailyStart: '00:00', dailyEnd: '00:01' };
  state.task.scheduleJson = JSON.stringify({
    scheduleType: 'activityDays',
    activeStartDate: today,
    activeEndDate: today,
    refreshDays: [1],
    ...closedWindow
  });
  state.checkinSettings = null;

  const invalidKey = await worker.fetch(requestFor(token, webpBytes(), {
    'x-idempotency-key': 'not-a-uuid'
  }), env, { waitUntil() {} });
  assert.equal(invalidKey.status, 400);

  const outsideWindow = await worker.fetch(requestFor(token, webpBytes()), env, { waitUntil() {} });
  assert.equal(outsideWindow.status, 403);
  assert.equal(state.puts, 0);

  state.makeup = true;
  const withPermission = await worker.fetch(requestFor(token, webpBytes()), env, { waitUntil() {} });
  assert.equal(withPermission.status, 201);
  assert.equal(state.puts, 1);
});

test('fast接口拒绝超限、PNG、伪造头和超限尺寸，D1失败时清理新R2对象', async () => {
  const [{ default: worker }, { createToken }] = await Promise.all([
    import('../cloudflare/worker.js'),
    import('../cloudflare/lib/runtime.js')
  ]);
  const make = async () => {
    const state = createState();
    const env = createEnv(state);
    const token = await createToken(state.users.get('student-1'), env.SESSION_SECRET);
    return { state, env, token };
  };

  {
    const { env, token } = await make();
    const oversized = webpBytes(307_201);
    const response = await worker.fetch(requestFor(token, oversized), env, { waitUntil() {} });
    assert.equal(response.status, 413);
  }
  {
    const { env, token } = await make();
    const response = await worker.fetch(requestFor(token, webpBytes(), {
      'content-type': 'image/png'
    }), env, { waitUntil() {} });
    assert.equal(response.status, 415);
  }
  {
    const { env, token } = await make();
    const response = await worker.fetch(requestFor(token, new Uint8Array(64)), env, { waitUntil() {} });
    assert.equal(response.status, 415);
  }
  {
    const { env, token } = await make();
    const response = await worker.fetch(requestFor(token, webpBytes(), {
      'x-image-width': '961'
    }), env, { waitUntil() {} });
    assert.equal(response.status, 400);
  }
  {
    const { state, env, token } = await make();
    state.overloadReads = 4;
    const response = await worker.fetch(requestFor(token, webpBytes()), env, { waitUntil() {} });
    assert.equal(response.status, 201);
    assert.equal(state.overloadReads, 0);
    assert.equal(state.puts, 1);
    assert.equal(state.objects.size, 1);
    assert.equal(state.media.size, 1);
  }
  {
    const { state, env, token } = await make();
    state.overloadBatches = 4;
    const response = await worker.fetch(requestFor(token, webpBytes()), env, { waitUntil() {} });
    assert.equal(response.status, 201);
    assert.equal(state.d1Batches, 5);
    assert.equal(state.puts, 1);
    assert.equal(state.deletes, 0);
    assert.equal(state.objects.size, 1);
    assert.equal(state.media.size, 1);
  }
  {
    const { state, env, token } = await make();
    state.failBatch = true;
    const response = await worker.fetch(requestFor(token, webpBytes()), env, { waitUntil() {} });
    assert.equal(response.status, 500);
    assert.equal(state.puts, 1);
    assert.equal(state.deletes, 1);
    assert.equal(state.objects.size, 0);
  }
});
