const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const {
  TRACKS,
  USER_STATUSES,
  DEFAULT_MAX_TEAMS,
  TASK_STATUSES,
  SUBMISSION_STATUSES,
  migrateData,
  safeUser,
  trackIdFromValue,
  statusFromValue
} = require('./lib/model');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.CHECKIN_DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = process.env.CHECKIN_UPLOAD_DIR || path.join(ROOT, 'uploads');
const MATERIAL_FILE_DIR = process.env.CHECKIN_MATERIAL_FILE_DIR || path.join(ROOT, 'material-files');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update(`local-preview:${ROOT}`).digest('hex');
const loginAttempts = new Map();
const rankingCache = new Map();
let dbCache = null;
let dbCacheMtime = 0;

for (const dir of [PUBLIC_DIR, DATA_DIR, UPLOAD_DIR, MATERIAL_FILE_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const defaultDb = {
  config: {
    activityName: '廿载同心·青春同行｜健康三餐打卡',
    startDate: '2026-09-12',
    endDate: '2026-09-30',
    maxTeams: DEFAULT_MAX_TEAMS,
    allowSelfJoin: false,
    activityEnabled: true,
    trackEnabled: { interaction: true, health: true },
    slots: [
      { id: 'breakfast', label: '早餐', start: '06:50', end: '10:00' },
      { id: 'lunch', label: '午餐', start: '10:30', end: '14:00' },
      { id: 'dinner', label: '晚餐', start: '16:30', end: '19:30' }
    ]
  },
  tracks: TRACKS.map((track) => ({ ...track })),
  users: [
    {
      id: 'admin',
      studentId: 'admin',
      name: '管理员',
      password: 'change-me-now',
      role: 'admin',
      campus: '',
      trackId: null,
      status: 'active',
      createdAt: new Date().toISOString()
    }
  ],
  checkins: [],
  teams: [],
  tasks: [],
  taskSubmissions: [],
  memberCheckins: [],
  plazaPosts: [],
  plazaLikes: [],
  plazaViews: [],
  rankingFreezes: [],
  materialTasks: [],
  materialSubmissions: []
};

function saveDb(data) {
  const likeKeys = new Set();
  for (const like of data.plazaLikes || []) {
    const key = `${like.postId}:${like.userId}`;
    if (likeKeys.has(key)) throw new Error('数据库点赞唯一性约束冲突');
    likeKeys.add(key);
  }
  const viewKeys = new Set();
  for (const view of data.plazaViews || []) {
    const key = `${view.postId}:${view.userId}:${view.windowStartedAt}`;
    if (viewKeys.has(key)) throw new Error('数据库浏览唯一性约束冲突');
    viewKeys.add(key);
  }
  const temporary = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temporary, DB_FILE);
  dbCache = data;
  dbCacheMtime = fs.statSync(DB_FILE).mtimeMs;
  rankingCache.clear();
}

function getDb() {
  if (!fs.existsSync(DB_FILE)) saveDb(defaultDb);
  const mtime = fs.statSync(DB_FILE).mtimeMs;
  if (dbCache && dbCacheMtime === mtime) return dbCache;
  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (migrateData(data)) saveDb(data);
  else {
    dbCache = data;
    dbCacheMtime = mtime;
  }
  return data;
}

function sendJson(res, statusCode, value, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...extraHeaders
  });
  res.end(JSON.stringify(value));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let text = '';
    req.on('data', (chunk) => {
      text += chunk;
      if (text.length > 25 * 1024 * 1024) reject(new Error('文件过大，单次提交最多 25MB'));
    });
    req.on('end', () => {
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error('请求格式错误'));
      }
    });
  });
}

function readBinary(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        settled = true;
        reject(Object.assign(new Error('图片压缩后仍超过300KB，请先在相册中裁剪、截图或压缩后重新上传。'), {
          statusCode: 413
        }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    req.on('error', (error) => {
      if (!settled) reject(error);
    });
  });
}

function tokenFor(user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function userFrom(req, data) {
  try {
    const cookieToken = String(req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('session_token='))
      ?.slice('session_token='.length);
    const token = (req.headers.authorization || '').replace('Bearer ', '') || cookieToken || '';
    const [encoded, signature] = token.split('.');
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest();
    const supplied = Buffer.from(signature || '', 'base64url');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    const user = data.users.find((item) => item.id === payload.id);
    return user && user.status === 'active' ? user : null;
  } catch {
    return null;
  }
}

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

function nowTime() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date());
}

function saveImage(dataUrl, prefix) {
  if (!dataUrl) return null;
  const match = String(dataUrl).match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw new Error('图片仅支持 JPG、PNG、WebP 格式');
  const raw = match[2];
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length || buffer.length > 4 * 1024 * 1024) throw new Error('单张图片压缩后不能超过 4MB');
  const signatures = {
    png: buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
    jpeg: buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
    webp: buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
  };
  const ext = match[1];
  if (!signatures[ext]) throw new Error('图片内容与文件格式不一致');
  const filename = `${prefix}-${crypto.randomUUID()}.${ext === 'jpeg' ? 'jpg' : ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt:${salt.toString('base64url')}:${hash.toString('base64url')}`;
}

function passwordMatches(password, stored) {
  if (!String(stored).startsWith('scrypt:')) return String(password) === String(stored);
  const [, saltText, hashText] = String(stored).split(':');
  const expected = Buffer.from(hashText, 'base64url');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltText, 'base64url'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function rateLimited(key, limit = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const attempts = (loginAttempts.get(key) || []).filter((time) => now - time < windowMs);
  attempts.push(now);
  loginAttempts.set(key, attempts);
  return attempts.length > limit;
}

function cleanText(value, maxLength = 100) {
  return String(value || '').trim().slice(0, maxLength);
}

function validateStudent(input, data, currentUserId = null) {
  const requestedStatus =
    input.status === undefined || input.status === ''
      ? 'active'
      : USER_STATUSES.includes(input.status)
        ? input.status
        : statusFromValue(input.status, null);
  const student = {
    name: cleanText(input.name, 50),
    studentId: cleanText(input.studentId, 40),
    campus: cleanText(input.campus, 50),
    trackId: trackIdFromValue(input.trackId),
    status: requestedStatus
  };
  const errors = [];
  if (!student.name) errors.push('姓名不能为空');
  if (!student.studentId) errors.push('学号不能为空');
  if (!student.campus) errors.push('校区不能为空');
  if (!student.trackId) errors.push('所属赛道无效');
  if (!student.status) errors.push('账号状态无效');
  if (data.users.some((user) => user.studentId === student.studentId && user.id !== currentUserId)) {
    errors.push('学号已存在');
  }
  return { student, errors };
}

function generateInviteCode(data) {
  let code;
  do {
    code = crypto.randomBytes(5).toString('hex').slice(0, 8).toUpperCase();
  } while (data.teams.some((team) => team.inviteCode === code));
  return code;
}

function teamForUser(data, userId) {
  return data.teams.find((team) => team.memberIds.includes(userId)) || null;
}

function teamView(team, data, includeDetails = false) {
  const captain = data.users.find((user) => user.id === team.captainId);
  const view = {
    id: team.id,
    name: team.name,
    memberLimit: team.memberLimit,
    memberCount: team.memberIds.length,
    isFull: team.memberIds.length >= team.memberLimit,
    createdAt: team.createdAt,
    captain: captain ? safeUser(captain) : null
  };
  if (includeDetails) {
    view.inviteCode = team.inviteCode;
    view.members = team.memberIds
      .map((id) => data.users.find((user) => user.id === id))
      .filter(Boolean)
      .map(safeUser);
  }
  return view;
}

function validateTeam(input, data, currentTeamId = null) {
  const name = cleanText(input.name, 80);
  const memberLimit = Number(input.memberLimit);
  const errors = [];
  if (!name) errors.push('队伍名称不能为空');
  if (
    data.teams.some(
      (team) => team.name.toLowerCase() === name.toLowerCase() && team.id !== currentTeamId
    )
  ) {
    errors.push('队伍名称已存在');
  }
  if (!Number.isInteger(memberLimit) || memberLimit < 1 || memberLimit > 20) {
    errors.push('人数限制必须是 1–20 的整数');
  }
  return { name, memberLimit, errors };
}

function validIsoDateTime(value) {
  return typeof value === 'string' && value.length >= 16 && Number.isFinite(Date.parse(value));
}

function taskView(task) {
  return { ...task };
}

function validateTask(input) {
  const scheduleType = ['weekly', 'activityDays'].includes(input.scheduleType) ? input.scheduleType : 'oneTime';
  const weekdays = [...new Set((Array.isArray(input.weekdays) ? input.weekdays : String(input.weekdays || '').split(/[,，\s]+/)).map(Number).filter((item) => Number.isInteger(item) && item >= 1 && item <= 7))].sort();
  const refreshDays = [...new Set((Array.isArray(input.refreshDays) ? input.refreshDays : String(input.refreshDays || '').split(/[,，\s]+/)).map(Number).filter((item) => Number.isInteger(item) && item >= 1 && item <= 366))].sort((a, b) => a - b);
  const task = {
    name: cleanText(input.name, 100),
    description: cleanText(input.description, 2000),
    trackId: trackIdFromValue(input.trackId),
    startAt: cleanText(input.startAt, 40),
    endAt: cleanText(input.endAt, 40),
    allowLate: false,
    imageLimit: Number(input.imageLimit),
    copyRequirement: cleanText(input.copyRequirement, 1000),
    status: TASK_STATUSES.includes(input.status) ? input.status : null,
    scheduleType,
    activeStartDate: cleanText(input.activeStartDate, 10),
    activeEndDate: cleanText(input.activeEndDate, 10),
    weekdays,
    refreshDays,
    dailyStart: cleanText(input.dailyStart, 5),
    dailyEnd: cleanText(input.dailyEnd, 5)
  };
  const errors = [];
  if (!task.name) errors.push('任务名称不能为空');
  if (!task.trackId) errors.push('所属赛道无效');
  if (scheduleType === 'oneTime') {
    if (!validIsoDateTime(task.startAt) || !validIsoDateTime(task.endAt)) errors.push('开始和截止时间格式无效');
    if (validIsoDateTime(task.startAt) && validIsoDateTime(task.endAt) && Date.parse(task.startAt) >= Date.parse(task.endAt)) errors.push('截止时间必须晚于开始时间');
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(task.activeStartDate) || !/^\d{4}-\d{2}-\d{2}$/.test(task.activeEndDate) || task.activeStartDate > task.activeEndDate) errors.push('活动日期范围无效');
    if (scheduleType === 'weekly' && !weekdays.length) errors.push('至少选择一个自动刷新星期');
    if (scheduleType === 'activityDays' && !refreshDays.length) errors.push('至少设置一个活动刷新日');
    if (!/^\d{2}:\d{2}$/.test(task.dailyStart) || !/^\d{2}:\d{2}$/.test(task.dailyEnd) || task.dailyStart >= task.dailyEnd) errors.push('每日提交时间范围无效');
    task.startAt = `${task.activeStartDate}T${task.dailyStart}:00+08:00`;
    task.endAt = `${task.activeEndDate}T${task.dailyEnd}:00+08:00`;
    task.allowLate = false;
  }
  if (!Number.isInteger(task.imageLimit) || task.imageLimit < 1 || task.imageLimit > 3) errors.push('图片数量限制必须是 1–3');
  if (!task.status) errors.push('任务状态无效');
  return { task, errors };
}

function weekdayForDate(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
}

function taskOccurrenceDate(task, date = today()) {
  if (!['weekly', 'activityDays'].includes(task.scheduleType)) return null;
  if (date < task.activeStartDate || date > task.activeEndDate) return null;
  if (task.scheduleType === 'activityDays') {
    const start = Date.parse(`${task.activeStartDate}T00:00:00Z`);
    const current = Date.parse(`${date}T00:00:00Z`);
    const activityDay = Math.floor((current - start) / 86400000) + 1;
    return task.refreshDays.includes(activityDay) ? date : null;
  }
  return task.weekdays.includes(weekdayForDate(date)) ? date : null;
}

function taskAvailability(task, data, now = Date.now(), occurrenceDate = taskOccurrenceDate(task)) {
  if (!data.config.activityEnabled) return '活动当前已关闭';
  if (!data.config.trackEnabled?.[task.trackId]) return '该赛道当前已关闭';
  if (task.status !== 'published') return '任务当前不可提交';
  if (['weekly', 'activityDays'].includes(task.scheduleType)) {
    if (!occurrenceDate || occurrenceDate !== today()) return '今天没有该任务';
    if (nowTime() < task.dailyStart || nowTime() > task.dailyEnd) return `仅可在当天 ${task.dailyStart}–${task.dailyEnd} 提交`;
    return null;
  }
  if (now < Date.parse(task.startAt)) return '任务尚未开始';
  if (now > Date.parse(task.endAt) && !task.allowLate) return '任务已截止且不允许补交';
  return null;
}

function submissionOwner(data, task, user) {
  if (task.trackId === 'interaction') {
    const team = teamForUser(data, user.id);
    return team ? { ownerType: 'team', ownerId: team.id, team } : null;
  }
  return { ownerType: 'user', ownerId: user.id, team: null };
}

function plazaPostView(post, currentUser, data) {
  const likes = data.plazaLikes.filter((like) => like.postId === post.id);
  const usedToday = data.plazaLikes.filter(
    (like) => like.userId === currentUser.id && shanghaiDate(like.likedAt) === today()
  ).length;
  return {
    id: post.id,
    taskId: post.taskId,
    taskName: post.taskName,
    teamName: post.teamName,
    members: post.members.map((member) => ({ name: member.name, campus: member.campus })),
    images: post.images,
    copy: post.copy,
    publishedAt: post.publishedAt,
    viewCount: post.viewCount,
    likeCount: likes.length,
    liked: likes.some((like) => like.userId === currentUser.id),
    likeQuota: { used: usedToday, remaining: Math.max(0, 5 - usedToday), daily: 5 },
    status: post.status,
    excludedFromRanking: post.excludedFromRanking
  };
}

function shanghaiDate(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(value));
}

function shanghaiMonth(value) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(new Date(value));
  return `${parts.find((part) => part.type === 'year').value}-${parts.find((part) => part.type === 'month').value}`;
}

function rankingPeriod(inputPeriod, inputKey) {
  const period = ['day', 'week', 'month'].includes(inputPeriod) ? inputPeriod : 'day';
  const fallback = period === 'month' ? today().slice(0, 7) : today();
  const key = period === 'month'
    ? (/^\d{4}-\d{2}$/.test(inputKey || '') ? inputKey : fallback)
    : (/^\d{4}-\d{2}-\d{2}$/.test(inputKey || '') ? inputKey : fallback);
  if (period === 'day') return { period, key, contains: (value) => shanghaiDate(value) === key };
  if (period === 'month') return { period, key, contains: (value) => shanghaiMonth(value) === key };
  const date = new Date(`${key}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const start = monday.toISOString().slice(0, 10);
  const end = sunday.toISOString().slice(0, 10);
  return { period, key: `${start}~${end}`, contains: (value) => {
    const dateKey = shanghaiDate(value);
    return dateKey >= start && dateKey <= end;
  } };
}

function ranked(items, metric) {
  return [...items]
    .sort((a, b) => b[metric] - a[metric] || String(a.teamName || a.postId).localeCompare(String(b.teamName || b.postId), 'zh-CN'))
    .map((item, index) => ({ rank: index + 1, ...item }));
}

function calculateRankings(data, inputPeriod, inputKey) {
  const range = rankingPeriod(inputPeriod, inputKey);
  const posts = data.plazaPosts.filter((post) => post.status === 'visible' && !post.excludedFromRanking);
  const postStats = posts.map((post) => {
    const likeCount = data.plazaLikes.filter((like) => like.postId === post.id && range.contains(like.likedAt)).length;
    const viewCount = data.plazaViews.filter((view) => view.postId === post.id && range.contains(view.viewedAt)).length;
    return { postId: post.id, taskName: post.taskName, teamId: post.teamId, teamName: post.teamName, likeCount, viewCount };
  });
  const maxLikes = Math.max(0, ...postStats.map((item) => item.likeCount));
  const maxViews = Math.max(0, ...postStats.map((item) => item.viewCount));
  for (const item of postStats) {
    item.normalizedLikes = maxLikes ? item.likeCount / maxLikes : 0;
    item.normalizedViews = maxViews ? item.viewCount / maxViews : 0;
    item.heatScore = Number((item.normalizedLikes * 70 + item.normalizedViews * 30).toFixed(2));
  }
  const teamMap = new Map();
  for (const post of posts) {
    if (!teamMap.has(post.teamId)) teamMap.set(post.teamId, { teamId: post.teamId, teamName: post.teamName, publicCount: 0, likeCount: 0, viewCount: 0 });
    const team = teamMap.get(post.teamId);
    if (range.contains(post.publishedAt)) team.publicCount += 1;
    team.likeCount += data.plazaLikes.filter((like) => like.postId === post.id && range.contains(like.likedAt)).length;
    team.viewCount += data.plazaViews.filter((view) => view.postId === post.id && range.contains(view.viewedAt)).length;
  }
  const teams = [...teamMap.values()].filter((item) => item.publicCount || item.likeCount || item.viewCount);
  const maxTeamLikes = Math.max(0, ...teams.map((item) => item.likeCount));
  const maxTeamViews = Math.max(0, ...teams.map((item) => item.viewCount));
  for (const item of teams) {
    item.normalizedLikes = maxTeamLikes ? item.likeCount / maxTeamLikes : 0;
    item.normalizedViews = maxTeamViews ? item.viewCount / maxTeamViews : 0;
    item.heatScore = Number((item.normalizedLikes * 70 + item.normalizedViews * 30).toFixed(2));
  }
  return {
    period: range.period,
    key: range.key,
    formula: '综合热度 = 点赞归一化 × 70% + 浏览归一化 × 30%',
    likeRank: ranked(postStats, 'likeCount'),
    viewRank: ranked(postStats, 'viewCount'),
    heatRank: ranked(postStats, 'heatScore'),
    teamRank: ranked(teams, 'heatScore')
  };
}

async function rankingWorkbook(result) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('排行榜');
  sheet.columns = [
    { header: '排名', key: 'rank', width: 10 },
    { header: '队伍', key: 'teamName', width: 24 },
    { header: '公开次数', key: 'publicCount', width: 14 },
    { header: '点赞数量', key: 'likeCount', width: 14 },
    { header: '浏览数量', key: 'viewCount', width: 14 },
    { header: '综合热度', key: 'heatScore', width: 14 }
  ];
  sheet.addRows(result.teamRank);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
}

async function createAdminExport(data, type, dateKey, monthKey) {
  const workbook = new ExcelJS.Workbook();
  const definitions = {
    users: {
      name: '用户名单',
      columns: [['姓名', 'name', 18], ['学号', 'studentId', 22], ['校区', 'campus', 18], ['赛道', 'track', 22], ['状态', 'status', 12], ['创建时间', 'createdAt', 24]],
      rows: data.users.filter((item) => item.role === 'student').map((item) => ({ ...item, track: data.tracks.find((track) => track.id === item.trackId)?.name || '', status: item.status === 'active' ? '启用' : '禁用' }))
    },
    teams: {
      name: '队伍名单',
      columns: [['队伍名称', 'name', 24], ['人数上限', 'memberLimit', 12], ['成员数量', 'memberCount', 12], ['成员姓名', 'memberNames', 40], ['成员学号', 'studentIds', 40], ['创建时间', 'createdAt', 24]],
      rows: data.teams.map((team) => {
        const members = team.memberIds.map((id) => data.users.find((user) => user.id === id)).filter(Boolean);
        return { ...team, memberCount: members.length, memberNames: members.map((item) => item.name).join('、'), studentIds: members.map((item) => item.studentId).join('、') };
      })
    },
    checkins: {
      name: '打卡记录',
      columns: [['日期', 'date', 14], ['餐次', 'slot', 12], ['姓名', 'name', 18], ['学号', 'studentId', 22], ['状态', 'status', 12], ['提交时间', 'submittedAt', 24], ['备注', 'note', 36], ['图片地址', 'photos', 60]],
      rows: data.checkins.map((item) => {
        const member = data.users.find((user) => user.id === item.userId) || {};
        return { ...item, name: member.name || '', studentId: member.studentId || '', slot: data.config.slots.find((slot) => slot.id === item.slotId)?.label || item.slotId, photos: (item.photos || []).join('\n') };
      })
    },
    missing: {
      name: `缺卡名单-${dateKey}`,
      columns: [['日期', 'date', 14], ['餐次', 'slot', 12], ['姓名', 'name', 18], ['学号', 'studentId', 22], ['校区', 'campus', 18], ['赛道', 'track', 22]],
      rows: data.users.filter((item) => item.role === 'student').flatMap((member) => data.config.slots.filter((slot) => !data.checkins.some((item) => item.userId === member.id && item.date === dateKey && item.slotId === slot.id)).map((slot) => ({ date: dateKey, slot: slot.label, name: member.name, studentId: member.studentId, campus: member.campus, track: data.tracks.find((track) => track.id === member.trackId)?.name || '' })))
    },
    materials: {
      name: '材料清单',
      columns: [['任务', 'task', 24], ['提交主体', 'owner', 24], ['状态', 'status', 12], ['文案', 'copy', 50], ['图片地址', 'images', 60], ['是否公开', 'isPublic', 12], ['更新时间', 'updatedAt', 24]],
      rows: data.taskSubmissions.map((item) => {
        const task = data.tasks.find((entry) => entry.id === item.taskId);
        const team = item.ownerType === 'team' ? data.teams.find((entry) => entry.id === item.ownerId) : null;
        const member = item.ownerType === 'user' ? data.users.find((entry) => entry.id === item.ownerId) : null;
        return { ...item, task: task?.name || '已归档任务', owner: team?.name || member?.name || item.ownerId, images: (item.images || []).join('\n'), isPublic: item.isPublic ? '是' : '否' };
      })
    }
  };
  if (type === 'rankings') {
    const freeze = data.rankingFreezes.find((item) => item.month === monthKey);
    const result = freeze?.snapshot || calculateRankings(data, 'month', monthKey);
    const file = await rankingWorkbook(result);
    return { filename: `排行榜-${monthKey}${freeze ? '-已冻结' : ''}.xlsx`, file };
  }
  const definition = definitions[type];
  if (!definition) return null;
  const sheet = workbook.addWorksheet(definition.name.slice(0, 31));
  sheet.columns = definition.columns.map(([header, key, width]) => ({ header, key, width }));
  sheet.addRows(definition.rows);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const studentIdColumn = definition.columns.findIndex(([, key]) => key === 'studentId') + 1;
  if (studentIdColumn > 0) {
    sheet.getColumn(studentIdColumn).numFmt = '@';
    for (let row = 2; row <= sheet.rowCount; row += 1) {
      sheet.getCell(row, studentIdColumn).value = String(sheet.getCell(row, studentIdColumn).value || '');
    }
  }
  return {
    filename: `${definition.name}.xlsx`,
    file: Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64')
  };
}

function validateMaterialTask(input) {
  const fileTypes = [...new Set(String(input.fileTypes || '').split(/[,，\s]+/).map((item) => item.toLowerCase().replace(/^\./, '')).filter((item) => /^[a-z0-9]{1,10}$/.test(item)))];
  const task = {
    title: cleanText(input.title, 120),
    description: cleanText(input.description, 2000),
    deadline: cleanText(input.deadline, 40),
    fileTypes,
    fileLimit: Number(input.fileLimit),
    summaryRequired: Boolean(input.summaryRequired),
    submissionMode: 'individual',
    enabled: input.enabled !== false
  };
  const errors = [];
  if (!task.title) errors.push('材料任务标题不能为空');
  if (!validIsoDateTime(task.deadline)) errors.push('截止时间格式无效');
  if (!fileTypes.length || fileTypes.some((type) => !['jpg', 'jpeg', 'png', 'webp'].includes(type))) errors.push('最终截图仅支持 JPG、PNG、WebP');
  if (!Number.isInteger(task.fileLimit) || task.fileLimit < 1 || task.fileLimit > 8) errors.push('图片数量限制必须是 1–8');
  return { task, errors };
}

function materialOwner(data, task, user) {
  return { ownerType: 'user', ownerId: user.id, label: user.name };
}

function saveMaterialFile(input, task) {
  const originalName = cleanText(input.name, 180).replace(/[\\/:*?"<>|\r\n]/g, '_');
  const extension = path.extname(originalName).slice(1).toLowerCase();
  if (!originalName || !task.fileTypes.includes(extension)) throw new Error(`文件类型仅允许：${task.fileTypes.join('、')}`);
  const match = String(input.data || '').match(/^data:([^;,]{1,120});base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw new Error('文件内容格式错误');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) throw new Error('单张图片压缩后不能超过 5MB');
  const signatureValid = (
    (['jpg', 'jpeg'].includes(extension) && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
    (extension === 'png' && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') ||
    (extension === 'webp' && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP')
  );
  if (!signatureValid) throw new Error('图片内容与扩展名不一致');
  const id = crypto.randomUUID();
  const storedName = `${id}.${extension}`;
  fs.writeFileSync(path.join(MATERIAL_FILE_DIR, storedName), buffer);
  return { id, originalName, storedName, mimeType: cleanText(match[1], 120), size: buffer.length, uploadedAt: new Date().toISOString() };
}

function materialSubmissionView(submission) {
  if (!submission) return null;
  return {
    ...submission,
    files: submission.files.map(({ storedName, ...file }) => ({ ...file, downloadUrl: `/api/material-files/${file.id}` }))
  };
}

function buildLocalStudentDashboard(data, currentUser) {
  const team = currentUser.trackId === 'interaction' ? teamForUser(data, currentUser.id) : null;
  const teamSummary = currentUser.trackId === 'interaction'
    ? {
        maxTeams: data.config.maxTeams,
        teamCount: data.teams.length,
        team: team ? teamView(team, data, true) : null
      }
    : null;
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
          return {
            ...(member ? safeUser(member) : { id }),
            checked: Boolean(checkin),
            submittedAt: checkin?.submittedAt || null
          };
        })
      } : null;
      return {
        ...taskView(task),
        occurrenceDate,
        availabilityError: taskAvailability(task, data, Date.now(), occurrenceDate),
        submission: submission || null,
        memberCheckin,
        teamProgress,
        isCaptain: Boolean(taskTeam && taskTeam.captainId === currentUser.id)
      };
    });
  const materialTasks = data.materialTasks.filter((task) => task.enabled).map((task) => {
    const owner = materialOwner(data, task, currentUser);
    const submission = owner
      ? data.materialSubmissions.find((item) => item.taskId === task.id
        && item.ownerType === owner.ownerType
        && item.ownerId === owner.ownerId)
      : null;
    return {
      ...task,
      ownerLabel: owner?.label || null,
      submission: materialSubmissionView(submission)
    };
  });
  return {
    version: 1,
    user: safeUser(currentUser),
    config: data.config,
    tracks: data.tracks,
    date: today(),
    time: nowTime(),
    teamSummary,
    tasks,
    materialTasks,
    switches: {
      activityEnabled: data.config.activityEnabled,
      trackEnabled: data.config.trackEnabled
    }
  };
}

function canAccessMaterialSubmission(data, submission, user) {
  if (user.role === 'admin') return true;
  if (submission.ownerType === 'user') return submission.ownerId === user.id;
  const team = data.teams.find((item) => item.id === submission.ownerId);
  return Boolean(team?.memberIds.includes(user.id));
}

async function missingMaterialWorkbook(data, task) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('未提交名单');
  sheet.columns = [
    { header: '任务', key: 'task', width: 26 },
    { header: task.submissionMode === 'team' ? '队伍' : '姓名', key: 'owner', width: 24 },
    { header: '学号', key: 'studentId', width: 24 },
    { header: '校区', key: 'campus', width: 18 }
  ];
  const rows = task.submissionMode === 'team'
    ? data.teams.filter((team) => !data.materialSubmissions.some((item) => item.taskId === task.id && item.ownerType === 'team' && item.ownerId === team.id && item.status === 'submitted')).map((team) => ({ task: task.title, owner: team.name, studentId: team.memberIds.map((id) => data.users.find((user) => user.id === id)?.studentId).filter(Boolean).join('、'), campus: [...new Set(team.memberIds.map((id) => data.users.find((user) => user.id === id)?.campus).filter(Boolean))].join('、') }))
    : data.users.filter((user) => user.role === 'student' && !data.materialSubmissions.some((item) => item.taskId === task.id && item.ownerType === 'user' && item.ownerId === user.id && item.status === 'submitted')).map((user) => ({ task: task.title, owner: user.name, studentId: user.studentId, campus: user.campus }));
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn(3).numFmt = '@';
  for (let row = 2; row <= sheet.rowCount; row += 1) sheet.getCell(row, 3).value = String(sheet.getCell(row, 3).value || '');
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
}

function excelCellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return String(value.result);
  }
  return String(value);
}

async function parseExcelUsers(fileData, data) {
  const raw = String(fileData || '').replace(/^data:.*?;base64,/, '');
  if (!raw) throw new Error('请选择 Excel 文件');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(raw, 'base64'));
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) throw new Error('Excel 中没有可导入的数据');

  const aliases = {
    name: ['姓名', 'name'],
    studentId: ['学号', 'studentid', 'student_id'],
    campus: ['校区', 'campus'],
    trackId: ['所属赛道', '赛道', 'track', 'trackid'],
    status: ['账号状态', '状态', 'status'],
    password: ['初始密码', '密码', 'password']
  };
  const headers = {};
  sheet.getRow(1).eachCell((cell, col) => {
    const header = excelCellText(cell.value).trim().toLowerCase();
    for (const [field, names] of Object.entries(aliases)) {
      if (names.includes(header)) headers[field] = col;
    }
  });
  const required = ['name', 'studentId', 'campus', 'trackId', 'password'];
  const missing = required.filter((field) => !headers[field]);
  if (missing.length) throw new Error('Excel 缺少必要列：姓名、学号、校区、所属赛道、初始密码');

  const users = [];
  const errors = [];
  const seenStudentIds = new Set();
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const input = {};
    for (const field of Object.keys(headers)) {
      input[field] = excelCellText(row.getCell(headers[field]).value).trim();
    }
    if (!Object.values(input).some(Boolean)) continue;
    input.status = statusFromValue(input.status);
    const { student, errors: rowErrors } = validateStudent(input, data);
    const password = cleanText(input.password, 100);
    if (!password) rowErrors.push('初始密码不能为空');
    if (seenStudentIds.has(student.studentId)) rowErrors.push('Excel 内学号重复');
    seenStudentIds.add(student.studentId);
    if (rowErrors.length) {
      errors.push(`第 ${rowNumber} 行：${rowErrors.join('、')}`);
    } else {
      users.push({
        id: crypto.randomUUID(),
        ...student,
        password: hashPassword(password),
        role: 'student',
        createdAt: new Date().toISOString()
      });
    }
  }
  if (errors.length) {
    const error = new Error(errors.slice(0, 20).join('\n'));
    error.statusCode = 400;
    throw error;
  }
  if (!users.length) throw new Error('Excel 中没有可导入的有效用户');
  return users;
}

async function parseExcelTeams(fileData, data) {
  const raw = String(fileData || '').replace(/^data:.*?;base64,/, '');
  if (!raw) throw new Error('请选择 Excel 文件');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(raw, 'base64'));
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) throw new Error('Excel 中没有可导入的队伍数据');
  const headers = {};
  sheet.getRow(1).eachCell((cell, column) => {
    const value = excelCellText(cell.value).trim().toLowerCase();
    if (['队伍名称', '队名', 'team', 'teamname'].includes(value)) headers.teamName = column;
    if (['人数限制', '人数上限', 'memberlimit'].includes(value)) headers.memberLimit = column;
    if (['学号', '成员学号', 'studentid'].includes(value)) headers.studentId = column;
    if (['队长学号', 'captain', 'captainstudentid'].includes(value)) headers.captainStudentId = column;
    const memberMatch = value.match(/^(?:成员|member)\s*([1-9])(?:学号)?$/);
    if (memberMatch) {
      if (!headers.members) headers.members = [];
      headers.members.push(column);
    }
  });
  if (!headers.teamName || (!headers.studentId && !headers.members?.length)) {
    throw new Error('Excel 必须包含“队伍名称”，以及“学号”或“成员1学号～成员4学号”');
  }
  const grouped = new Map();
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const name = cleanText(excelCellText(row.getCell(headers.teamName).value), 80);
    if (!name) continue;
    if (!grouped.has(name)) grouped.set(name, { name, memberLimit: 4, studentIds: [], captainStudentId: '', rows: [] });
    const group = grouped.get(name);
    const limitValue = headers.memberLimit ? Number(excelCellText(row.getCell(headers.memberLimit).value)) : 4;
    if (Number.isInteger(limitValue) && limitValue >= 1 && limitValue <= 20) group.memberLimit = limitValue;
    const ids = headers.studentId
      ? [excelCellText(row.getCell(headers.studentId).value).trim()]
      : headers.members.map((column) => excelCellText(row.getCell(column).value).trim());
    group.studentIds.push(...ids.filter(Boolean));
    if (headers.captainStudentId) group.captainStudentId = excelCellText(row.getCell(headers.captainStudentId).value).trim();
    group.rows.push(rowNumber);
  }
  const errors = [];
  const assigned = new Set(data.teams.flatMap((team) => team.memberIds));
  const teams = [];
  if (data.teams.length + grouped.size > data.config.maxTeams) errors.push('导入后队伍数量将超过当前名额');
  for (const group of grouped.values()) {
    group.studentIds = [...new Set(group.studentIds)];
    if (data.teams.some((team) => team.name.toLowerCase() === group.name.toLowerCase())) errors.push(`队伍“${group.name}”已存在`);
    if (group.studentIds.length > group.memberLimit) errors.push(`队伍“${group.name}”成员超过人数限制`);
    const memberIds = [];
    for (const studentId of group.studentIds) {
      const user = data.users.find((item) => item.studentId === studentId && item.role === 'student');
      if (!user) errors.push(`队伍“${group.name}”学号 ${studentId} 不存在`);
      else if (user.trackId !== 'interaction') errors.push(`学号 ${studentId} 不属于四校区互动赛道`);
      else if (assigned.has(user.id)) errors.push(`学号 ${studentId} 已在其他队伍`);
      else {
        assigned.add(user.id);
        memberIds.push(user.id);
      }
    }
    const captain = group.captainStudentId ? data.users.find((item) => item.studentId === group.captainStudentId) : null;
    if (group.captainStudentId && (!captain || !memberIds.includes(captain.id))) errors.push(`队伍“${group.name}”的队长学号必须属于本队成员`);
    teams.push({ id: crypto.randomUUID(), name: group.name, memberLimit: group.memberLimit, inviteCode: generateInviteCode({ teams: [...data.teams, ...teams] }), memberIds, captainId: captain?.id || null, createdAt: new Date().toISOString() });
  }
  if (errors.length) {
    const error = new Error(errors.slice(0, 30).join('\n'));
    error.statusCode = 400;
    throw error;
  }
  if (!teams.length) throw new Error('Excel 中没有有效队伍');
  return teams;
}

async function handleApi(req, res, url) {
  const data = getDb();
  const route = url.pathname;

  if (route === '/api/login' && req.method === 'POST') {
    const body = await readJson(req);
    const studentId = cleanText(body.studentId, 40);
    const address = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown');
    if (rateLimited(`${address}:${studentId}`)) return sendJson(res, 429, { error: '登录尝试过多，请 15 分钟后再试' });
    const user = data.users.find((item) => item.studentId === studentId);
    if (user && !passwordMatches(body.password, user.password)) return sendJson(res, 401, { error: '学号或密码不正确' });
    if (!user) return sendJson(res, 401, { error: '学号或密码不正确' });
    if (user.status !== 'active') return sendJson(res, 403, { error: '账号已被禁用' });
    if (!String(user.password).startsWith('scrypt:')) {
      user.password = hashPassword(body.password);
      saveDb(data);
    }
    loginAttempts.delete(`${address}:${studentId}`);
    const token = tokenFor(user);
    return sendJson(res, 200, {
      token,
      user: safeUser(user)
    }, {
      'Set-Cookie': `session_token=${token}; Path=/; Max-Age=43200; HttpOnly; SameSite=Lax`
    });
  }

  if (route === '/api/session' && req.method === 'POST') {
    const currentUser = userFrom(req, data);
    if (!currentUser) return sendJson(res, 401, { error: '请先登录或账号已被禁用' });
    const token = tokenFor(currentUser);
    const dashboard = currentUser.role === 'student' ? buildLocalStudentDashboard(data, currentUser) : null;
    return sendJson(res, 200, {
      user: safeUser(currentUser),
      config: data.config,
      tracks: data.tracks,
      date: today(),
      time: nowTime(),
      dashboard
    }, {
      'Set-Cookie': `session_token=${token}; Path=/; Max-Age=43200; HttpOnly; SameSite=Lax`
    });
  }

  const currentUser = userFrom(req, data);
  if (!currentUser) return sendJson(res, 401, { error: '请先登录或账号已被禁用' });

  if (route === '/api/media/member-checkin-fast' && req.method === 'POST') {
    if (currentUser.role !== 'student' || currentUser.trackId !== 'interaction') {
      return sendJson(res, 403, { error: '仅四校区互动赛道学生可以上传个人打卡图片' });
    }
    const taskId = cleanText(req.headers['x-task-id'], 80);
    const idempotencyKey = cleanText(req.headers['x-idempotency-key'], 80);
    const contentType = cleanText(req.headers['content-type'], 80).toLowerCase().split(';')[0];
    const width = Number(req.headers['x-image-width']);
    const height = Number(req.headers['x-image-height']);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
      return sendJson(res, 400, { error: '上传幂等编号格式无效' });
    }
    if (!['image/webp', 'image/jpeg'].includes(contentType)) {
      return sendJson(res, 415, { error: '个人打卡成品仅支持 WebP 或 JPEG' });
    }
    if (!Number.isInteger(width) || !Number.isInteger(height)
        || width < 1 || height < 1 || Math.max(width, height) > 960) {
      return sendJson(res, 400, { error: '图片尺寸无效，最长边不能超过960像素' });
    }
    const task = data.tasks.find((item) => item.id === taskId && item.trackId === 'interaction');
    if (!task || task.status !== 'published') return sendJson(res, 404, { error: '任务不存在或已关闭' });
    const team = teamForUser(data, currentUser.id);
    if (!team) return sendJson(res, 403, { error: '尚未分配队伍，不能上传队伍打卡图片' });
    const occurrenceDate = taskOccurrenceDate(task);
    if (taskAvailability(task, data, Date.now(), occurrenceDate)) {
      return sendJson(res, 403, { error: '当前不在该任务的打卡时间范围内' });
    }
    const buffer = await readBinary(req, 307200);
    if (!buffer.length) return sendJson(res, 400, { error: '图片内容不能为空' });
    const signatureValid = contentType === 'image/jpeg'
      ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
      : buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
    if (!signatureValid) return sendJson(res, 415, { error: '图片真实格式校验失败' });
    data.mediaObjects ||= [];
    const digest = crypto.createHash('sha256').update(buffer).digest('hex');
    const existing = data.mediaObjects.find((item) => item.id === idempotencyKey);
    if (existing) {
      if (existing.ownerUserId !== currentUser.id) return sendJson(res, 403, { error: '无权使用该上传编号' });
      if (existing.taskId !== task.id || existing.digest !== digest || existing.contentType !== contentType
          || existing.bytes !== buffer.length || existing.width !== width || existing.height !== height) {
        return sendJson(res, 409, { error: '相同上传编号对应的图片内容不一致' });
      }
      return sendJson(res, 200, {
        ok: true,
        repeated: true,
        media: { id: existing.id, mimeType: existing.contentType, fileSize: existing.bytes, width, height }
      });
    }
    const extension = contentType === 'image/webp' ? 'webp' : 'jpg';
    const storedName = `member-fast-${currentUser.id}-${idempotencyKey}-${digest}.${extension}`;
    const filePath = path.join(UPLOAD_DIR, storedName);
    fs.writeFileSync(filePath, buffer);
    const media = {
      id: idempotencyKey,
      ownerUserId: currentUser.id,
      taskId: task.id,
      businessType: 'member-checkin',
      url: `/uploads/${storedName}`,
      storedName,
      digest,
      contentType,
      bytes: buffer.length,
      width,
      height,
      businessId: null,
      createdAt: new Date().toISOString()
    };
    data.mediaObjects.push(media);
    try {
      saveDb(data);
    } catch (error) {
      data.mediaObjects = data.mediaObjects.filter((item) => item.id !== media.id);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      throw error;
    }
    return sendJson(res, 201, {
      ok: true,
      repeated: false,
      media: { id: media.id, mimeType: media.contentType, fileSize: media.bytes, width, height }
    });
  }

  if (route === '/api/me') {
    return sendJson(res, 200, {
      user: safeUser(currentUser),
      config: data.config,
      tracks: data.tracks,
      date: today(),
      time: nowTime()
    });
  }

  if (route === '/api/student-dashboard' && req.method === 'GET') {
    if (currentUser.role !== 'student') return sendJson(res, 403, { error: 'Students only' });
    return sendJson(res, 200, buildLocalStudentDashboard(data, currentUser));
  }

  const materialFileMatch = route.match(/^\/api\/material-files\/([^/]+)$/);
  if (materialFileMatch && req.method === 'GET') {
    const submission = data.materialSubmissions.find((item) => item.files.some((file) => file.id === decodeURIComponent(materialFileMatch[1])));
    if (!submission || !canAccessMaterialSubmission(data, submission, currentUser)) return sendJson(res, 403, { error: '无权访问该文件' });
    const file = submission.files.find((item) => item.id === decodeURIComponent(materialFileMatch[1]));
    const filePath = path.join(MATERIAL_FILE_DIR, file.storedName);
    if (!fs.existsSync(filePath)) return sendJson(res, 404, { error: '文件不存在' });
    res.writeHead(200, {
      'Content-Type': file.mimeType || 'application/octet-stream',
      'Content-Length': file.size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store'
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  if (route === '/api/material-tasks' && req.method === 'GET') {
    if (currentUser.role !== 'student') return sendJson(res, 403, { error: '仅学生可查看材料任务' });
    const tasks = data.materialTasks.filter((task) => task.enabled).map((task) => {
      const owner = materialOwner(data, task, currentUser);
      const submission = owner ? data.materialSubmissions.find((item) => item.taskId === task.id && item.ownerType === owner.ownerType && item.ownerId === owner.ownerId) : null;
      return { ...task, ownerLabel: owner?.label || null, submission: materialSubmissionView(submission) };
    });
    return sendJson(res, 200, { tasks });
  }

  const materialSubmitMatch = route.match(/^\/api\/material-tasks\/([^/]+)\/submission$/);
  if (materialSubmitMatch && req.method === 'PUT') {
    if (currentUser.role !== 'student') return sendJson(res, 403, { error: '仅学生可提交材料' });
    const task = data.materialTasks.find((item) => item.id === decodeURIComponent(materialSubmitMatch[1]) && item.enabled);
    if (!task) return sendJson(res, 404, { error: '材料任务不存在' });
    const owner = materialOwner(data, task, currentUser);
    if (!owner) return sendJson(res, 409, { error: '该任务要求队伍提交，请先加入四校区队伍' });
    const current = data.materialSubmissions.find((item) => item.taskId === task.id && item.ownerType === owner.ownerType && item.ownerId === owner.ownerId);
    const body = await readJson(req);
    if (current && Number(body.version) !== current.version) return sendJson(res, 409, { error: '材料已被更新，请刷新后重试', current: materialSubmissionView(current) });
    if (current && current.status === 'submitted') return sendJson(res, 409, { error: '材料已提交，需管理员退回后才能修改' });
    if (!current && Date.now() > Date.parse(task.deadline)) return sendJson(res, 409, { error: '材料任务已截止' });
    const inputs = Array.isArray(body.files) ? body.files : [];
    if (inputs.length > task.fileLimit) return sendJson(res, 400, { error: `最多上传 ${task.fileLimit} 个文件` });
    const files = inputs.length ? inputs.map((file) => saveMaterialFile(file, task)) : current?.files || [];
    if (!files.length) return sendJson(res, 400, { error: '至少上传一个文件' });
    const summary = cleanText(body.summary, 3000);
    if (task.summaryRequired && !summary) return sendJson(res, 400, { error: '该任务要求填写文字总结' });
    if (current && inputs.length) {
      for (const oldFile of current.files) {
        const oldPath = path.join(MATERIAL_FILE_DIR, oldFile.storedName);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
    }
    const now = new Date().toISOString();
    const next = {
      id: current?.id || crypto.randomUUID(),
      taskId: task.id,
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      submittedBy: currentUser.id,
      files,
      summary,
      status: 'submitted',
      reviewNote: '',
      version: (current?.version || 0) + 1,
      createdAt: current?.createdAt || now,
      submittedAt: now,
      updatedAt: now
    };
    if (current) Object.assign(current, next);
    else data.materialSubmissions.push(next);
    saveDb(data);
    return sendJson(res, current ? 200 : 201, { ok: true, submission: materialSubmissionView(next) });
  }

  if (route === '/api/rankings' && req.method === 'GET') {
    const period = url.searchParams.get('period') || 'day';
    const key = url.searchParams.get('key') || '';
    const cacheKey = `${period}:${key || 'current'}`;
    const cached = rankingCache.get(cacheKey);
    const calculated = cached && cached.expiresAt > Date.now() ? cached.value : calculateRankings(data, period, key);
    if (!cached || cached.expiresAt <= Date.now()) rankingCache.set(cacheKey, { value: calculated, expiresAt: Date.now() + 60 * 1000 });
    const frozen = calculated.period === 'month'
      ? data.rankingFreezes.find((item) => item.month === calculated.key)
      : null;
    return sendJson(res, 200, {
      ...(frozen ? frozen.snapshot : calculated),
      frozen: Boolean(frozen),
      frozenAt: frozen?.frozenAt || null
    });
  }

  if (route === '/api/plaza' && req.method === 'GET') {
    const sort = ['latest', 'hot', 'monthly'].includes(url.searchParams.get('sort'))
      ? url.searchParams.get('sort')
      : 'latest';
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(24, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '6', 10) || 6));
    const requestedMonth = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '')
      ? url.searchParams.get('month')
      : today().slice(0, 7);
    let posts = data.plazaPosts.filter((post) => post.status === 'visible');
    if (sort === 'monthly') posts = posts.filter((post) => shanghaiMonth(post.publishedAt) === requestedMonth);
    posts.sort((a, b) => {
      if (sort === 'hot' || sort === 'monthly') {
        const likeCount = (post) => data.plazaLikes.filter((like) => like.postId === post.id).length;
        const popularity = likeCount(b) - likeCount(a) || b.viewCount - a.viewCount;
        if (popularity) return popularity;
      }
      return String(b.publishedAt).localeCompare(String(a.publishedAt));
    });
    const total = posts.length;
    const offset = (page - 1) * limit;
    return sendJson(res, 200, {
      posts: posts.slice(offset, offset + limit).map((post) => plazaPostView(post, currentUser, data)),
      page,
      limit,
      total,
      hasMore: offset + limit < total,
      month: requestedMonth
    });
  }

  const plazaMatch = route.match(/^\/api\/plaza\/([^/]+)$/);
  if (plazaMatch && req.method === 'GET') {
    const post = data.plazaPosts.find((item) => item.id === decodeURIComponent(plazaMatch[1]) && item.status === 'visible');
    if (!post) return sendJson(res, 404, { error: '帖子不存在或已隐藏' });
    return sendJson(res, 200, { post: plazaPostView(post, currentUser, data) });
  }

  const plazaViewMatch = route.match(/^\/api\/plaza\/([^/]+)\/view$/);
  if (plazaViewMatch && req.method === 'POST') {
    const post = data.plazaPosts.find((item) => item.id === decodeURIComponent(plazaViewMatch[1]) && item.status === 'visible');
    if (!post) return sendJson(res, 404, { error: '帖子不存在或已隐藏' });
    if (currentUser.role === 'admin') {
      return sendJson(res, 200, { ok: true, counted: false, viewCount: post.viewCount });
    }
    const now = new Date();
    const latest = data.plazaViews
      .filter((view) => view.postId === post.id && view.userId === currentUser.id)
      .sort((a, b) => String(b.viewedAt).localeCompare(String(a.viewedAt)))[0];
    const within24Hours = latest && now.getTime() - Date.parse(latest.viewedAt) < 24 * 60 * 60 * 1000;
    if (!within24Hours) {
      post.viewCount += 1;
      data.plazaViews.push({
        postId: post.id,
        userId: currentUser.id,
        windowStartedAt: now.toISOString(),
        viewedAt: now.toISOString()
      });
    }
    saveDb(data);
    return sendJson(res, 200, { ok: true, counted: !within24Hours, viewCount: post.viewCount });
  }

  const plazaLikeMatch = route.match(/^\/api\/plaza\/([^/]+)\/like$/);
  if (plazaLikeMatch && req.method === 'POST') {
    const post = data.plazaPosts.find((item) => item.id === decodeURIComponent(plazaLikeMatch[1]) && item.status === 'visible');
    if (!post) return sendJson(res, 404, { error: '帖子不存在或已隐藏' });
    const body = await readJson(req);
    if (typeof body.liked !== 'boolean') return sendJson(res, 400, { error: '请明确指定点赞或取消点赞' });
    const index = data.plazaLikes.findIndex((like) => like.postId === post.id && like.userId === currentUser.id);
    if (body.liked && index < 0) {
      const usedToday = data.plazaLikes.filter(
        (like) => like.userId === currentUser.id && shanghaiDate(like.likedAt) === today()
      ).length;
      if (usedToday >= 5) return sendJson(res, 429, { error: '今日 5 个点赞额度已用完' });
      data.plazaLikes.push({ postId: post.id, userId: currentUser.id, likedAt: new Date().toISOString() });
    } else if (!body.liked && index >= 0) {
      data.plazaLikes.splice(index, 1);
    }
    saveDb(data);
    const view = plazaPostView(post, currentUser, data);
    return sendJson(res, 200, { ok: true, liked: view.liked, likeCount: view.likeCount, likeQuota: view.likeQuota });
  }

  if (route === '/api/teams' && req.method === 'GET') {
    if (currentUser.role !== 'student' || currentUser.trackId !== 'interaction') {
      return sendJson(res, 403, { error: '仅四校区互动赛道学生可查看队伍' });
    }
    return sendJson(res, 200, {
      maxTeams: data.config.maxTeams,
      teamCount: data.teams.length,
      teams: data.teams.map((team) => teamView(team, data, false))
    });
  }

  if (route === '/api/teams/me' && req.method === 'GET') {
    if (currentUser.role !== 'student' || currentUser.trackId !== 'interaction') {
      return sendJson(res, 403, { error: '仅四校区互动赛道学生可查看我的队伍' });
    }
    const team = teamForUser(data, currentUser.id);
    return sendJson(res, 200, {
      team: team ? teamView(team, data, true) : null
    });
  }

  if (route === '/api/teams/join' && req.method === 'POST') {
    if (!data.config.allowSelfJoin) return sendJson(res, 403, { error: '队伍由管理员统一编排，请联系管理员调整队伍' });
    if (currentUser.role !== 'student' || currentUser.trackId !== 'interaction') {
      return sendJson(res, 403, { error: '自律健康赛道不能加入队伍' });
    }
    if (teamForUser(data, currentUser.id)) {
      return sendJson(res, 409, { error: '一个学生只能加入一个队伍' });
    }
    const body = await readJson(req);
    const inviteCode = cleanText(body.inviteCode, 20).toUpperCase();
    const team = data.teams.find((item) => item.inviteCode === inviteCode);
    if (!team) return sendJson(res, 404, { error: '邀请码无效' });
    if (team.memberIds.length >= team.memberLimit) {
      return sendJson(res, 409, { error: '队伍已满员' });
    }
    team.memberIds.push(currentUser.id);
    saveDb(data);
    return sendJson(res, 200, { ok: true, team: teamView(team, data, true) });
  }

  if (route === '/api/tasks' && req.method === 'GET') {
    if (currentUser.role !== 'student') return sendJson(res, 403, { error: '仅学生可查看活动任务' });
    const tasks = data.tasks
      .filter((task) => task.trackId === currentUser.trackId && task.status === 'published' && (!['weekly', 'activityDays'].includes(task.scheduleType) || taskOccurrenceDate(task)))
      .map((task) => {
        const owner = submissionOwner(data, task, currentUser);
        const occurrenceDate = taskOccurrenceDate(task);
        const submission = owner
          ? data.taskSubmissions.find((item) => item.taskId === task.id && item.ownerType === owner.ownerType && item.ownerId === owner.ownerId && (item.occurrenceDate || null) === occurrenceDate)
          : null;
        const team = task.trackId === 'interaction' ? owner?.team : null;
        const memberCheckin = team ? data.memberCheckins.find((item) => item.taskId === task.id && item.occurrenceDate === occurrenceDate && item.userId === currentUser.id) : null;
        const teamProgress = team ? {
          completed: team.memberIds.filter((id) => data.memberCheckins.some((item) => item.taskId === task.id && item.occurrenceDate === occurrenceDate && item.userId === id)).length,
          total: team.memberIds.length,
          members: team.memberIds.map((id) => {
            const member = data.users.find((item) => item.id === id);
            const checkin = data.memberCheckins.find((item) => item.taskId === task.id && item.occurrenceDate === occurrenceDate && item.userId === id);
            return { ...(member ? safeUser(member) : { id }), checked: Boolean(checkin), submittedAt: checkin?.submittedAt || null };
          })
        } : null;
        return { ...taskView(task), occurrenceDate, availabilityError: taskAvailability(task, data, Date.now(), occurrenceDate), submission: submission || null, memberCheckin, teamProgress, isCaptain: Boolean(team && team.captainId === currentUser.id) };
      });
    return sendJson(res, 200, { tasks, config: { activityEnabled: data.config.activityEnabled, trackEnabled: data.config.trackEnabled } });
  }

  if (route === '/api/submissions/history' && req.method === 'GET') {
    if (currentUser.role !== 'student' || currentUser.trackId !== 'health') {
      return sendJson(res, 403, { error: '仅自律健康赛道学生可查看个人历史' });
    }
    const submissions = data.taskSubmissions
      .filter((item) => item.ownerType === 'user' && item.ownerId === currentUser.id)
      .map((item) => ({ ...item, task: taskView(data.tasks.find((task) => task.id === item.taskId) || {}) }))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return sendJson(res, 200, { submissions });
  }

  const memberCheckinMatch = route.match(/^\/api\/tasks\/([^/]+)\/member-checkin$/);
  if (memberCheckinMatch && req.method === 'PUT') {
    if (currentUser.role !== 'student' || currentUser.trackId !== 'interaction') return sendJson(res, 403, { error: '仅四校区赛道成员可个人打卡' });
    const task = data.tasks.find((item) => item.id === decodeURIComponent(memberCheckinMatch[1]) && item.trackId === 'interaction');
    if (!task) return sendJson(res, 404, { error: '任务不存在' });
    const occurrenceDate = taskOccurrenceDate(task);
    const unavailable = taskAvailability(task, data, Date.now(), occurrenceDate);
    if (unavailable) return sendJson(res, 409, { error: unavailable });
    const team = teamForUser(data, currentUser.id);
    if (!team) return sendJson(res, 409, { error: '请先由管理员编入队伍' });
    const body = await readJson(req);
    if (body.occurrenceDate && body.occurrenceDate !== occurrenceDate) return sendJson(res, 409, { error: '只能提交当天生成的任务' });
    const current = data.memberCheckins.find((item) => item.taskId === task.id && item.occurrenceDate === occurrenceDate && item.userId === currentUser.id);
    const mediaIds = Array.isArray(body.mediaIds) ? body.mediaIds : [];
    let media = null;
    let image = null;
    if (mediaIds.length) {
      if (mediaIds.length !== 1) return sendJson(res, 400, { error: '个人打卡需要且只能使用 1 张图片' });
      media = (data.mediaObjects || []).find((item) =>
        item.id === mediaIds[0] && item.ownerUserId === currentUser.id
        && item.taskId === task.id && item.businessType === 'member-checkin' && !item.businessId);
      if (!media) return sendJson(res, 403, { error: '图片不存在、无权使用或已被其他提交占用' });
      image = media.url;
    } else {
      // 仅保留给旧本地测试数据；正式前端不会再发送Base64。
      const imageData = Array.isArray(body.images) ? body.images : [];
      if (imageData.length !== 1) return sendJson(res, 400, { error: '个人打卡需要上传 1 张截图' });
      image = saveImage(imageData[0], `member-${task.id}-${currentUser.id}`);
    }
    const now = new Date().toISOString();
    const next = { id: current?.id || crypto.randomUUID(), taskId: task.id, occurrenceDate, teamId: team.id, userId: currentUser.id, image, submittedAt: now, version: (current?.version || 0) + 1 };
    if (current && media) {
      const previousMedia = (data.mediaObjects || []).find((item) =>
        item.businessType === 'member-checkin' && item.businessId === current.id);
      if (previousMedia && previousMedia.id !== media.id) {
        const previousPath = path.join(UPLOAD_DIR, previousMedia.storedName || '');
        if (previousMedia.storedName && fs.existsSync(previousPath)) fs.unlinkSync(previousPath);
        data.mediaObjects = data.mediaObjects.filter((item) => item.id !== previousMedia.id);
      }
    }
    if (current) Object.assign(current, next); else data.memberCheckins.push(next);
    if (media) media.businessId = next.id;
    saveDb(data);
    return sendJson(res, current ? 200 : 201, { ok: true, checkin: next });
  }

  const submissionMatch = route.match(/^\/api\/tasks\/([^/]+)\/submission$/);
  if (submissionMatch && req.method === 'PUT') {
    if (currentUser.role !== 'student') return sendJson(res, 403, { error: '仅学生可提交任务' });
    const task = data.tasks.find((item) => item.id === decodeURIComponent(submissionMatch[1]));
    if (!task || task.trackId !== currentUser.trackId) return sendJson(res, 404, { error: '任务不存在' });
    const body = await readJson(req);
    const occurrenceDate = taskOccurrenceDate(task);
    if (['weekly', 'activityDays'].includes(task.scheduleType) && body.occurrenceDate && body.occurrenceDate !== occurrenceDate) return sendJson(res, 409, { error: '只能提交当天生成的任务' });
    const unavailable = taskAvailability(task, data, Date.now(), occurrenceDate);
    if (unavailable) return sendJson(res, 409, { error: unavailable });
    const owner = submissionOwner(data, task, currentUser);
    if (!owner) return sendJson(res, 409, { error: '请先加入队伍后再提交' });
    if (task.trackId === 'interaction') {
      if (owner.team.captainId && owner.team.captainId !== currentUser.id) return sendJson(res, 403, { error: '仅管理员指定的队长可以汇总并提交队伍作品' });
      if (owner.team.captainId) {
        const missing = owner.team.memberIds.filter((id) => !data.memberCheckins.some((item) => item.taskId === task.id && item.occurrenceDate === occurrenceDate && item.userId === id));
        if (body.intent === 'submit' && missing.length) return sendJson(res, 409, { error: `还有 ${missing.length} 名成员未完成个人打卡` });
      }
    }
    const intent = body.intent === 'submit' ? 'submitted' : 'draft';
    const current = data.taskSubmissions.find((item) => item.taskId === task.id && item.ownerType === owner.ownerType && item.ownerId === owner.ownerId && (item.occurrenceDate || null) === occurrenceDate);
    if (current && Number(body.version) !== current.version) {
      return sendJson(res, 409, { error: '材料已被队友更新，请刷新后再提交', current });
    }
    if (current && ['submitted', 'approved'].includes(current.status)) {
      return sendJson(res, 409, { error: '材料已最终提交，不能重复覆盖' });
    }
    const imageData = Array.isArray(body.images) ? body.images : [];
    if (imageData.length > task.imageLimit) return sendJson(res, 400, { error: `最多上传 ${task.imageLimit} 张图片` });
    const oldImages = current?.images || [];
    const images = imageData.length
      ? imageData.map((image, index) => saveImage(image, `tasks-${task.id}-${owner.ownerId}-${index}`))
      : oldImages;
    const copy = cleanText(body.copy, 2000);
    const plazaCopy = cleanText(body.plazaCopy, 2000);
    const mealType = task.trackId === 'health' && ['breakfast', 'lunch', 'dinner'].includes(body.mealType) ? body.mealType : null;
    if (intent === 'submitted') {
      if (!images.length) return sendJson(res, 400, { error: '最终提交至少需要一张图片' });
      if (task.copyRequirement && !copy) return sendJson(res, 400, { error: '该任务要求填写文案' });
      if (task.trackId === 'interaction' && body.isPublic && !plazaCopy) return sendJson(res, 400, { error: '发布至广场时请填写作品文案' });
      if (task.trackId === 'health' && !mealType) return sendJson(res, 400, { error: '请选择早餐、午餐或晚餐' });
    }
    const now = new Date().toISOString();
    const next = {
      id: current?.id || crypto.randomUUID(),
      taskId: task.id,
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      occurrenceDate,
      submittedBy: currentUser.id,
      images,
      copy,
      plazaCopy,
      mealType,
      isPublic: Boolean(body.isPublic),
      status: intent,
      reviewNote: current?.status === 'returned' ? current.reviewNote || '' : '',
      version: (current?.version || 0) + 1,
      createdAt: current?.createdAt || now,
      updatedAt: now,
      submittedAt: intent === 'submitted' ? now : null
    };
    if (current) Object.assign(current, next);
    else data.taskSubmissions.push(next);
    if (
      intent === 'submitted' &&
      task.trackId === 'interaction' &&
      next.isPublic &&
      !data.plazaPosts.some((post) => post.submissionId === next.id)
    ) {
      data.plazaPosts.push({
        id: crypto.randomUUID(),
        submissionId: next.id,
        taskId: task.id,
        taskName: task.name,
        teamId: owner.team.id,
        teamName: owner.team.name,
        members: owner.team.memberIds
          .map((id) => data.users.find((member) => member.id === id))
          .filter(Boolean)
          .map((member) => ({ id: member.id, name: member.name, campus: member.campus })),
        images: [...next.images],
        copy: next.plazaCopy || next.copy,
        publishedAt: now,
        viewCount: 0,
        likedBy: [],
        status: 'visible'
      });
    }
    saveDb(data);
    return sendJson(res, current ? 200 : 201, { ok: true, submission: next });
  }

  if (route === '/api/checkins' && req.method === 'GET') {
    const date = url.searchParams.get('date') || today();
    return sendJson(res, 200, {
      checkins: data.checkins.filter(
        (checkin) => checkin.userId === currentUser.id && checkin.date === date
      )
    });
  }

  if (route === '/api/checkins' && req.method === 'POST') {
    if (currentUser.role !== 'student') {
      return sendJson(res, 403, { error: '管理员账号不可打卡' });
    }
    const body = await readJson(req);
    const slot = data.config.slots.find((item) => item.id === body.slotId);
    const date = body.date || today();
    if (!slot) return sendJson(res, 400, { error: '打卡时段不存在' });
    if (date !== today()) return sendJson(res, 400, { error: '只能提交当天材料' });
    if (nowTime() < slot.start || nowTime() > slot.end) {
      return sendJson(res, 400, {
        error: `当前不在${slot.label}时段（${slot.start}–${slot.end}）`
      });
    }
    const photos = (body.photos || [])
      .map((photo, index) =>
        saveImage(photo, `${currentUser.studentId}-${date}-${slot.id}-${index}`)
      )
      .filter(Boolean);
    if (!photos.length) return sendJson(res, 400, { error: '至少上传一张水印截图' });
    data.checkins = data.checkins.filter(
      (checkin) =>
        !(
          checkin.userId === currentUser.id &&
          checkin.date === date &&
          checkin.slotId === slot.id
        )
    );
    data.checkins.push({
      id: crypto.randomUUID(),
      userId: currentUser.id,
      date,
      slotId: slot.id,
      photos,
      summary: saveImage(body.summary, `${currentUser.studentId}-${date}-summary`),
      note: cleanText(body.note, 300),
      submittedAt: new Date().toISOString(),
      status: 'pending'
    });
    saveDb(data);
    return sendJson(res, 201, { ok: true });
  }

  if (currentUser.role !== 'admin') {
    return sendJson(res, 403, { error: '仅管理员可访问' });
  }

  if (route === '/api/admin/overview' && req.method === 'GET') {
    const date = today();
    const taskSubmits = data.taskSubmissions.filter((item) => item.submittedAt && shanghaiDate(item.submittedAt) === date).length;
    const mealSubmits = data.checkins.filter((item) => item.date === date).length;
    return sendJson(res, 200, {
      userCount: data.users.filter((item) => item.role === 'student').length,
      teamCount: data.teams.length,
      todaySubmissions: taskSubmits + mealSubmits,
      publicPostCount: data.plazaPosts.filter((item) => item.status === 'visible').length,
      likeCount: data.plazaLikes.length,
      viewCount: data.plazaViews.length
    });
  }

  if (route === '/api/admin/material-tasks' && req.method === 'GET') {
    const students = data.users.filter((user) => user.role === 'student' && user.status === 'active');
    const campuses = [...new Set(students.map((user) => user.campus).filter(Boolean))].sort();
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50));
    const campus = cleanText(url.searchParams.get('campus'), 50);
    const filteredSubmissions = data.materialSubmissions.filter((submission) => {
      if (!campus) return true;
      return data.users.find((user) => user.id === submission.ownerId)?.campus === campus;
    });
    return sendJson(res, 200, {
      tasks: data.materialTasks,
      submissions: filteredSubmissions.slice((page - 1) * limit, page * limit).map((submission) => {
        const owner = data.users.find((user) => user.id === submission.ownerId);
        return { ...materialSubmissionView(submission), owner: owner ? safeUser(owner) : null };
      }),
      pagination: { page, limit, total: filteredSubmissions.length, pages: Math.max(1, Math.ceil(filteredSubmissions.length / limit)) },
      campuses,
      campusProgress: data.materialTasks.map((task) => ({
        taskId: task.id,
        campuses: campuses.map((campus) => {
          const campusStudents = students.filter((student) => student.campus === campus);
          const completed = campusStudents.filter((student) => data.materialSubmissions.some((item) => item.taskId === task.id && item.ownerType === 'user' && item.ownerId === student.id && item.status === 'submitted')).length;
          return { campus, completed, total: campusStudents.length };
        })
      }))
    });
  }

  if (route === '/api/admin/material-tasks' && req.method === 'POST') {
    const body = await readJson(req);
    const { task, errors } = validateMaterialTask(body);
    if (errors.length) return sendJson(res, 400, { error: errors.join('、') });
    const now = new Date().toISOString();
    const created = { id: crypto.randomUUID(), ...task, createdAt: now, createdBy: currentUser.id };
    data.materialTasks.push(created);
    saveDb(data);
    return sendJson(res, 201, { ok: true, task: created });
  }

  const adminMaterialTaskMatch = route.match(/^\/api\/admin\/material-tasks\/([^/]+)$/);
  if (adminMaterialTaskMatch && req.method === 'PUT') {
    const existing = data.materialTasks.find((item) => item.id === decodeURIComponent(adminMaterialTaskMatch[1]));
    if (!existing) return sendJson(res, 404, { error: '材料任务不存在' });
    const body = await readJson(req);
    const { task, errors } = validateMaterialTask(body);
    if (errors.length) return sendJson(res, 400, { error: errors.join('、') });
    Object.assign(existing, task, { updatedAt: new Date().toISOString(), updatedBy: currentUser.id });
    saveDb(data);
    return sendJson(res, 200, { ok: true, task: existing });
  }

  const adminMaterialMatch = route.match(/^\/api\/admin\/material-submissions\/([^/]+)$/);
  if (adminMaterialMatch && req.method === 'PATCH') {
    const submission = data.materialSubmissions.find((item) => item.id === decodeURIComponent(adminMaterialMatch[1]));
    if (!submission) return sendJson(res, 404, { error: '材料提交不存在' });
    if (submission.status !== 'submitted') return sendJson(res, 409, { error: '仅已提交材料可以退回' });
    const body = await readJson(req);
    const reviewNote = cleanText(body.reviewNote, 1000);
    if (!reviewNote) return sendJson(res, 400, { error: '请填写退回修改原因' });
    submission.status = 'returned';
    submission.reviewNote = reviewNote;
    submission.reviewedBy = currentUser.id;
    submission.reviewedAt = new Date().toISOString();
    submission.updatedAt = submission.reviewedAt;
    submission.version += 1;
    saveDb(data);
    return sendJson(res, 200, { ok: true, submission: materialSubmissionView(submission) });
  }

  const missingMaterialMatch = route.match(/^\/api\/admin\/material-tasks\/([^/]+)\/missing-export$/);
  if (missingMaterialMatch && req.method === 'GET') {
    const task = data.materialTasks.find((item) => item.id === decodeURIComponent(missingMaterialMatch[1]));
    if (!task) return sendJson(res, 404, { error: '材料任务不存在' });
    return sendJson(res, 200, {
      filename: `未提交名单-${task.title}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      file: await missingMaterialWorkbook(data, task)
    });
  }

  const exportMatch = route.match(/^\/api\/admin\/exports\/(users|teams|checkins|missing|rankings|materials)$/);
  if (exportMatch && req.method === 'GET') {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '') ? url.searchParams.get('date') : today();
    const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : today().slice(0, 7);
    const exported = await createAdminExport(data, exportMatch[1], date, month);
    return sendJson(res, 200, {
      ...exported,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  if (route === '/api/admin/rankings/freeze' && req.method === 'POST') {
    const body = await readJson(req);
    if (!/^\d{4}-\d{2}$/.test(body.month || '')) return sendJson(res, 400, { error: '月份格式必须是 YYYY-MM' });
    if (data.rankingFreezes.some((item) => item.month === body.month)) {
      return sendJson(res, 409, { error: '该月最终排名已经冻结' });
    }
    const snapshot = calculateRankings(data, 'month', body.month);
    const freeze = {
      id: crypto.randomUUID(),
      month: body.month,
      snapshot,
      frozenAt: new Date().toISOString(),
      frozenBy: currentUser.id
    };
    data.rankingFreezes.push(freeze);
    saveDb(data);
    return sendJson(res, 201, { ok: true, month: freeze.month, frozenAt: freeze.frozenAt, snapshot });
  }

  if (route === '/api/admin/rankings/export' && req.method === 'GET') {
    const month = url.searchParams.get('month') || today().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return sendJson(res, 400, { error: '月份格式必须是 YYYY-MM' });
    const freeze = data.rankingFreezes.find((item) => item.month === month);
    const result = freeze?.snapshot || calculateRankings(data, 'month', month);
    return sendJson(res, 200, {
      filename: `排行榜-${month}${freeze ? '-已冻结' : ''}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      file: await rankingWorkbook(result)
    });
  }

  if (route === '/api/admin/plaza' && req.method === 'GET') {
    return sendJson(res, 200, {
      posts: [...data.plazaPosts]
        .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
        .map((post) => plazaPostView(post, currentUser, data))
    });
  }

  const adminPlazaMatch = route.match(/^\/api\/admin\/plaza\/([^/]+)$/);
  if (adminPlazaMatch && req.method === 'PATCH') {
    const post = data.plazaPosts.find((item) => item.id === decodeURIComponent(adminPlazaMatch[1]));
    if (!post) return sendJson(res, 404, { error: '帖子不存在' });
    const body = await readJson(req);
    if (body.status !== undefined && !['visible', 'hidden'].includes(body.status)) return sendJson(res, 400, { error: '帖子状态无效' });
    if (body.excludedFromRanking !== undefined && typeof body.excludedFromRanking !== 'boolean') return sendJson(res, 400, { error: '排名排除状态无效' });
    if (body.status === undefined && body.excludedFromRanking === undefined) return sendJson(res, 400, { error: '没有可更新的管理字段' });
    if (body.status !== undefined) post.status = body.status;
    if (body.excludedFromRanking !== undefined) post.excludedFromRanking = body.excludedFromRanking;
    post.moderatedAt = new Date().toISOString();
    post.moderatedBy = currentUser.id;
    saveDb(data);
    return sendJson(res, 200, { ok: true, post: plazaPostView(post, currentUser, data) });
  }

  if (adminPlazaMatch && req.method === 'DELETE') {
    const index = data.plazaPosts.findIndex((item) => item.id === decodeURIComponent(adminPlazaMatch[1]));
    if (index < 0) return sendJson(res, 404, { error: '帖子不存在' });
    const postId = data.plazaPosts[index].id;
    data.plazaPosts.splice(index, 1);
    data.plazaLikes = data.plazaLikes.filter((like) => like.postId !== postId);
    data.plazaViews = data.plazaViews.filter((view) => view.postId !== postId);
    saveDb(data);
    return sendJson(res, 200, { ok: true });
  }

  if (route === '/api/admin/activity-switches' && req.method === 'PATCH') {
    const body = await readJson(req);
    if (typeof body.activityEnabled === 'boolean') data.config.activityEnabled = body.activityEnabled;
    if (body.trackEnabled && typeof body.trackEnabled === 'object') {
      for (const track of TRACKS) {
        if (typeof body.trackEnabled[track.id] === 'boolean') {
          data.config.trackEnabled[track.id] = body.trackEnabled[track.id];
        }
      }
    }
    saveDb(data);
    return sendJson(res, 200, { ok: true, activityEnabled: data.config.activityEnabled, trackEnabled: data.config.trackEnabled });
  }

  if (route === '/api/admin/tasks' && req.method === 'GET') {
    return sendJson(res, 200, { tasks: data.tasks.map(taskView), submissions: data.taskSubmissions });
  }

  if (route === '/api/admin/tasks' && req.method === 'POST') {
    const body = await readJson(req);
    const { task, errors } = validateTask(body);
    if (errors.length) return sendJson(res, 400, { error: errors.join('、') });
    const now = new Date().toISOString();
    const created = { id: crypto.randomUUID(), ...task, createdAt: now, updatedAt: now };
    data.tasks.push(created);
    saveDb(data);
    return sendJson(res, 201, { ok: true, task: created });
  }

  const adminTaskMatch = route.match(/^\/api\/admin\/tasks\/([^/]+)$/);
  if (adminTaskMatch && req.method === 'PUT') {
    const task = data.tasks.find((item) => item.id === decodeURIComponent(adminTaskMatch[1]));
    if (!task) return sendJson(res, 404, { error: '任务不存在' });
    const body = await readJson(req);
    const validated = validateTask(body);
    if (validated.errors.length) return sendJson(res, 400, { error: validated.errors.join('、') });
    Object.assign(task, validated.task, { updatedAt: new Date().toISOString() });
    saveDb(data);
    return sendJson(res, 200, { ok: true, task });
  }

  const reviewMatch = route.match(/^\/api\/admin\/submissions\/([^/]+)$/);
  if (reviewMatch && req.method === 'PATCH') {
    const submission = data.taskSubmissions.find((item) => item.id === decodeURIComponent(reviewMatch[1]));
    if (!submission) return sendJson(res, 404, { error: '提交记录不存在' });
    const body = await readJson(req);
    if (!['returned', 'approved'].includes(body.status)) return sendJson(res, 400, { error: '审核状态无效' });
    if (submission.status !== 'submitted') return sendJson(res, 409, { error: '仅已提交材料可以审核' });
    submission.status = body.status;
    submission.reviewNote = cleanText(body.reviewNote, 500);
    submission.reviewedBy = currentUser.id;
    submission.reviewedAt = new Date().toISOString();
    submission.updatedAt = submission.reviewedAt;
    submission.version += 1;
    saveDb(data);
    return sendJson(res, 200, { ok: true, submission });
  }

  if (reviewMatch && req.method === 'DELETE') {
    const index = data.taskSubmissions.findIndex((item) => item.id === decodeURIComponent(reviewMatch[1]));
    if (index < 0) return sendJson(res, 404, { error: '提交记录不存在' });
    const submissionId = data.taskSubmissions[index].id;
    const relatedPostIds = data.plazaPosts.filter((post) => post.submissionId === submissionId).map((post) => post.id);
    data.taskSubmissions.splice(index, 1);
    data.plazaPosts = data.plazaPosts.filter((post) => post.submissionId !== submissionId);
    data.plazaLikes = data.plazaLikes.filter((like) => !relatedPostIds.includes(like.postId));
    data.plazaViews = data.plazaViews.filter((view) => !relatedPostIds.includes(view.postId));
    saveDb(data);
    return sendJson(res, 200, { ok: true });
  }

  if (route === '/api/admin/team-capacity' && req.method === 'PATCH') {
    const body = await readJson(req);
    const maxTeams = Number(body.maxTeams);
    if (!Number.isInteger(maxTeams) || maxTeams < 0 || maxTeams > 500) {
      return sendJson(res, 400, { error: '队伍名额必须是 0–500 的整数' });
    }
    if (maxTeams < data.teams.length) {
      return sendJson(res, 409, {
        error: `当前已有 ${data.teams.length} 个队伍，名额不能低于现有队伍数量`
      });
    }
    data.config.maxTeams = maxTeams;
    saveDb(data);
    return sendJson(res, 200, { ok: true, maxTeams });
  }

  if (route === '/api/admin/teams' && req.method === 'GET') {
    return sendJson(res, 200, {
      maxTeams: data.config.maxTeams,
      teamCount: data.teams.length,
      teams: data.teams.map((team) => teamView(team, data, true))
    });
  }

  if (route === '/api/admin/teams' && req.method === 'POST') {
    if (data.teams.length >= data.config.maxTeams) {
      return sendJson(res, 409, { error: '队伍名额已满，请先增加队伍名额' });
    }
    const body = await readJson(req);
    const { name, memberLimit, errors } = validateTeam(body, data);
    if (errors.length) return sendJson(res, 400, { error: errors.join('、') });
    const team = {
      id: crypto.randomUUID(),
      name,
      memberLimit,
      inviteCode: generateInviteCode(data),
      memberIds: [],
      createdAt: new Date().toISOString()
    };
    data.teams.push(team);
    saveDb(data);
    return sendJson(res, 201, { ok: true, team: teamView(team, data, true) });
  }

  if (route === '/api/admin/teams/import' && req.method === 'POST') {
    const body = await readJson(req);
    try {
      const teams = await parseExcelTeams(body.file, data);
      data.teams.push(...teams);
      saveDb(data);
      return sendJson(res, 201, { ok: true, importedTeams: teams.length, importedMembers: teams.reduce((sum, team) => sum + team.memberIds.length, 0) });
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { error: error.message });
    }
  }

  const adminTeamMatch = route.match(/^\/api\/admin\/teams\/([^/]+)$/);
  if (adminTeamMatch && req.method === 'PUT') {
    const team = data.teams.find(
      (item) => item.id === decodeURIComponent(adminTeamMatch[1])
    );
    if (!team) return sendJson(res, 404, { error: '队伍不存在' });
    const body = await readJson(req);
    const { name, memberLimit, errors } = validateTeam(body, data, team.id);
    if (memberLimit < team.memberIds.length) {
      errors.push(`人数限制不能低于当前成员数 ${team.memberIds.length}`);
    }
    if (errors.length) return sendJson(res, 400, { error: errors.join('、') });
    team.name = name;
    team.memberLimit = memberLimit;
    saveDb(data);
    return sendJson(res, 200, { ok: true, team: teamView(team, data, true) });
  }

  if (adminTeamMatch && req.method === 'DELETE') {
    const teamIndex = data.teams.findIndex(
      (item) => item.id === decodeURIComponent(adminTeamMatch[1])
    );
    if (teamIndex < 0) return sendJson(res, 404, { error: '队伍不存在' });
    if (data.teams[teamIndex].memberIds.length) {
      return sendJson(res, 409, { error: '有成员的队伍禁止直接删除，请先移除全部成员' });
    }
    data.teams.splice(teamIndex, 1);
    saveDb(data);
    return sendJson(res, 200, { ok: true });
  }

  const memberMatch = route.match(
    /^\/api\/admin\/teams\/([^/]+)\/members\/([^/]+)$/
  );
  if (memberMatch && req.method === 'DELETE') {
    const team = data.teams.find(
      (item) => item.id === decodeURIComponent(memberMatch[1])
    );
    if (!team) return sendJson(res, 404, { error: '队伍不存在' });
    const userId = decodeURIComponent(memberMatch[2]);
    const memberIndex = team.memberIds.indexOf(userId);
    if (memberIndex < 0) return sendJson(res, 404, { error: '成员不在该队伍中' });
    team.memberIds.splice(memberIndex, 1);
    if (team.captainId === userId) team.captainId = null;
    saveDb(data);
    return sendJson(res, 200, { ok: true });
  }

  const captainMatch = route.match(/^\/api\/admin\/teams\/([^/]+)\/captain$/);
  if (captainMatch && req.method === 'PATCH') {
    const team = data.teams.find((item) => item.id === decodeURIComponent(captainMatch[1]));
    if (!team) return sendJson(res, 404, { error: '队伍不存在' });
    const body = await readJson(req);
    if (!body.studentId && !body.userId) {
      team.captainId = null;
    } else {
      const captain = data.users.find((item) => item.id === body.userId || item.studentId === cleanText(body.studentId, 40));
      if (!captain || !team.memberIds.includes(captain.id)) return sendJson(res, 400, { error: '队长必须是该队伍的现有成员' });
      team.captainId = captain.id;
    }
    saveDb(data);
    return sendJson(res, 200, { ok: true, team: teamView(team, data, true) });
  }

  const addMemberMatch = route.match(/^\/api\/admin\/teams\/([^/]+)\/members$/);
  if (addMemberMatch && req.method === 'POST') {
    const team = data.teams.find((item) => item.id === decodeURIComponent(addMemberMatch[1]));
    if (!team) return sendJson(res, 404, { error: '队伍不存在' });
    if (team.memberIds.length >= team.memberLimit) return sendJson(res, 409, { error: '队伍已满员' });
    const body = await readJson(req);
    const studentId = cleanText(body.studentId, 40);
    const member = data.users.find((item) => item.studentId === studentId && item.role === 'student');
    if (!member) return sendJson(res, 404, { error: '学生账号不存在' });
    if (member.trackId !== 'interaction') return sendJson(res, 409, { error: '仅四校区互动赛道学生可加入队伍' });
    if (teamForUser(data, member.id)) return sendJson(res, 409, { error: '该学生已经属于其他队伍' });
    team.memberIds.push(member.id);
    saveDb(data);
    return sendJson(res, 200, { ok: true, team: teamView(team, data, true) });
  }

  if (route === '/api/admin/dashboard' && req.method === 'GET') {
    const date = url.searchParams.get('date') || today();
    const students = data.users.filter((user) => user.role === 'student');
    return sendJson(res, 200, {
      date,
      config: data.config,
      tracks: data.tracks,
      students: students.map((student) => ({
        ...safeUser(student),
        slots: data.config.slots.map(
          (slot) =>
            data.checkins.find(
              (checkin) =>
                checkin.userId === student.id &&
                checkin.date === date &&
                checkin.slotId === slot.id
            ) || null
        )
      }))
    });
  }

  if (route === '/api/admin/users' && req.method === 'GET') {
    return sendJson(res, 200, {
      users: data.users.filter((user) => user.role === 'student').map(safeUser),
      tracks: data.tracks
    });
  }

  if (route === '/api/admin/users' && req.method === 'POST') {
    const body = await readJson(req);
    const { student, errors } = validateStudent(body, data);
    const password = cleanText(body.password, 100);
    if (!password) errors.push('初始密码不能为空');
    if (errors.length) return sendJson(res, 400, { error: errors.join('、') });
    data.users.push({
      id: crypto.randomUUID(),
      ...student,
      password: hashPassword(password),
      role: 'student',
      createdAt: new Date().toISOString()
    });
    saveDb(data);
    return sendJson(res, 201, { ok: true });
  }

  if (route === '/api/admin/users/import' && req.method === 'POST') {
    const body = await readJson(req);
    try {
      const users = await parseExcelUsers(body.file, data);
      data.users.push(...users);
      saveDb(data);
      return sendJson(res, 201, { ok: true, imported: users.length });
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { error: error.message });
    }
  }

  const userMatch = route.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (userMatch && req.method === 'PUT') {
    const target = data.users.find(
      (user) => user.id === decodeURIComponent(userMatch[1]) && user.role === 'student'
    );
    if (!target) return sendJson(res, 404, { error: '用户不存在' });
    const body = await readJson(req);
    const { student, errors } = validateStudent(body, data, target.id);
    if (errors.length) return sendJson(res, 400, { error: errors.join('、') });
    Object.assign(target, student);
    if (body.password) target.password = hashPassword(cleanText(body.password, 100));
    saveDb(data);
    return sendJson(res, 200, { ok: true, user: safeUser(target) });
  }

  const statusMatch = route.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
  if (statusMatch && req.method === 'PATCH') {
    const target = data.users.find(
      (user) => user.id === decodeURIComponent(statusMatch[1]) && user.role === 'student'
    );
    if (!target) return sendJson(res, 404, { error: '用户不存在' });
    const body = await readJson(req);
    if (!USER_STATUSES.includes(body.status)) {
      return sendJson(res, 400, { error: '账号状态无效' });
    }
    target.status = body.status;
    saveDb(data);
    return sendJson(res, 200, { ok: true, user: safeUser(target) });
  }

  if (route === '/api/admin/config' && req.method === 'PUT') {
    data.config = { ...data.config, ...(await readJson(req)) };
    saveDb(data);
    return sendJson(res, 200, { ok: true });
  }

  const checkinMatch = route.match(/^\/api\/admin\/checkins\/([^/]+)$/);
  if (checkinMatch && req.method === 'PUT') {
    const checkin = data.checkins.find(
      (item) => item.id === decodeURIComponent(checkinMatch[1])
    );
    if (!checkin) return sendJson(res, 404, { error: '记录不存在' });
    const body = await readJson(req);
    checkin.status = body.status === 'approved' ? 'approved' : 'rejected';
    checkin.reviewNote = cleanText(body.reviewNote, 300);
    saveDb(data);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: '接口不存在' });
}

let mutationQueue = Promise.resolve();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const pending = mutationQueue.then(() => handleApi(req, res, url));
        mutationQueue = pending.catch(() => {});
        return await pending;
      }
      return await handleApi(req, res, url);
    }
    const isUpload = url.pathname.startsWith('/uploads/');
    const base = isUpload ? UPLOAD_DIR : PUBLIC_DIR;
    const relative = isUpload
      ? url.pathname.slice('/uploads/'.length)
      : url.pathname === '/'
        ? 'index.html'
        : url.pathname.replace(/^\//, '');
    const file = path.resolve(base, relative);
    const safeBase = `${path.resolve(base)}${path.sep}`;
    if (!file.startsWith(safeBase) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' });
      return res.end('Not found');
    }
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.webp': 'image/webp'
    };
    res.writeHead(200, {
      'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
      'Cache-Control': isUpload ? 'public, max-age=31536000, immutable' : path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    return fs.createReadStream(file).pipe(res);
  } catch (error) {
    return sendJson(res, 400, { error: error.message || '请求失败' });
  }
});

server.listen(PORT, () => console.log(`http://localhost:${PORT}`));
