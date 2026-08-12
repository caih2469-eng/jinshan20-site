import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appPath = path.join(root, 'public', 'app.js');
const adminClientPath = path.join(root, 'public', 'admin-client.js');
const cssPath = path.join(root, 'public', 'admin-dashboard-refactor.css');
const bootstrapPath = path.join(root, 'public', 'bootstrap.js');
const indexPath = path.join(root, 'public', 'index.html');
const mediaRoutePath = path.join(root, 'cloudflare', 'routes', 'media.js');
const signingPath = path.join(root, 'cloudflare', 'lib', 'media-signing.js');
const marker = '/* MOBILE_ADMIN_PHOTO_FIX_V1 */';

const required = (file, label) => {
  if (!fs.existsSync(file)) throw new Error(`${label}不存在`);
};

const replaceOnce = (source, pattern, replacement, label) => {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

[
  [appPath, 'public/app.js'],
  [adminClientPath, 'public/admin-client.js'],
  [cssPath, '后台样式文件'],
  [bootstrapPath, '启动脚本'],
  [indexPath, '首页文件'],
  [mediaRoutePath, '媒体路由'],
  [signingPath, '媒体签名模块']
].forEach(([file, label]) => required(file, label));

let appSource = fs.readFileSync(appPath, 'utf8');
const adminClientSource = fs.readFileSync(adminClientPath, 'utf8');
const usesLazyAdminClient = /function openAdminUserDrawer\(studentUser, (?:teams, )?date/.test(adminClientSource)
  && adminClientSource.includes("document.querySelectorAll('.admin-user-tile')")
  && adminClientSource.includes('/api/admin/users/${encodeURIComponent(studentUser.id)}/checkins');
const hasImmediateLazyDrawer = usesLazyAdminClient
  && adminClientSource.includes('ADMIN_CHECKIN_CACHE_TTL_MS = 60_000')
  && adminClientSource.includes("startPhotoFlow('admin-checkin')")
  && adminClientSource.includes('openAdminUserDrawer(studentUser, date)')
  && adminClientSource.includes("['profile',")
  && adminClientSource.includes("['team',")
  && adminClientSource.includes("['makeup',")
  && adminClientSource.includes("['manage',")
  && !adminClientSource.includes("const [teams, tasks] = await Promise.all([");

if (appSource.includes('/* PICA_IMAGE_PIPELINE_V1 */')
    && (!usesLazyAdminClient || hasImmediateLazyDrawer)) {
  const mediaSource = fs.readFileSync(mediaRoutePath, 'utf8');
  const hasAdminDrawer = usesLazyAdminClient
    || appSource.includes('function openAdminUserDrawer(studentUser, teams, date, tasks = [])');
  if (!hasAdminDrawer || !appSource.includes('PICA_THUMB_MAX_EDGE = 960')
      || !mediaSource.includes('THUMB_MAX_EDGE = 960')) {
    throw new Error('Current Pica/admin photo implementation is incomplete');
  }
  console.log('Validated current Pica image quality and admin photo implementation.');
  process.exit(0);
}

if (!appSource.includes(marker) && usesLazyAdminClient && appSource.includes('uploadMemberCheckinFast(')) {
  appSource = replaceOnce(
    appSource,
    'const MEDIA_THUMB_MAX_EDGE = 360;',
    `${marker}\nconst MEDIA_THUMB_MAX_EDGE = 360;`,
    'current mobile admin photo implementation marker'
  );
  fs.writeFileSync(appPath, appSource, 'utf8');
}

if (usesLazyAdminClient && appSource.includes('uploadMemberCheckinFast(')
    && hasImmediateLazyDrawer) {
  console.log('Validated current lazy admin photo implementation without applying legacy replacements.');
  process.exit(0);
}

if (!appSource.includes(marker)
    || (usesLazyAdminClient && !hasImmediateLazyDrawer)) {
  if (!appSource.includes('/* PICA_IMAGE_PIPELINE_V1 */')) {
    appSource = replaceOnce(appSource, 'const MEDIA_THUMB_MAX_EDGE = 360;', 'const MEDIA_THUMB_MAX_EDGE = 540;', '前端缩略图尺寸常量');
    appSource = replaceOnce(appSource, 'const MEDIA_THUMB_MAX_SIZE_MB = 0.12;', 'const MEDIA_THUMB_MAX_SIZE_MB = 0.18;', '前端缩略图体积常量');
    appSource = replaceOnce(appSource, 'const MEDIA_THUMB_QUALITY = 0.72;', 'const MEDIA_THUMB_QUALITY = 0.82;', '前端缩略图质量常量');
  }

  let adminUiSource = usesLazyAdminClient ? adminClientSource : appSource;

  const userClickPattern = /  document\.querySelectorAll\('\.admin-user-tile'\)\.forEach\(\(button\) => \{\r?\n    button\.onclick = async \(\) => \{[\s\S]*?\r?\n    \};\r?\n  \}\);/;
  const userClickReplacement = `  document.querySelectorAll('.admin-user-tile').forEach((button) => {
    button.onclick = () => {
      const studentUser = adminDashboardState.users.find((item) => item.id === button.dataset.id);
      if (!studentUser) return;
      startPhotoFlow('admin-checkin');
      openAdminUserDrawer(studentUser, date);
    };
  });`;
  adminUiSource = replaceOnce(adminUiSource, userClickPattern, userClickReplacement, '管理员用户卡片点击逻辑');

  const drawerFunction = `${marker}
const ADMIN_CHECKIN_CACHE_TTL_MS = 60_000;
const adminCheckinViewCache = new Map();
const adminCheckinInflight = new Map();

function openAdminUserDrawer(studentUser, date) {
  let root = document.querySelector('#modalRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'modalRoot';
    app.append(root);
  }
  const cacheKey = \`\${studentUser.id}|\${date}\`;
  root.innerHTML = \`<div class="drawer-backdrop" id="userDrawerBackdrop">
    <section class="bottom-drawer admin-checkin-drawer" role="dialog" aria-modal="true" aria-labelledby="userDrawerTitle" data-checkin-key="\${escapeHtml(cacheKey)}">
      <div class="drawer-handle" aria-hidden="true"></div>
      <div class="drawer-sticky-header row">
        <div><small class="muted">打卡情况</small><h2 id="userDrawerTitle">\${escapeHtml(studentUser.name)}</h2></div>
        <button class="secondary right" id="closeUserDrawer">关闭</button>
      </div>
      <div class="admin-checkin-date">\${escapeHtml(date)}</div>
      <div id="adminCheckinRecords" class="admin-checkin-records" aria-busy="true">
        <div class="admin-checkin-skeleton" aria-label="正在读取打卡照片"></div>
      </div>
    </section>
  </div>\`;

  const backdrop = root.querySelector('#userDrawerBackdrop');
  const drawer = root.querySelector('.admin-checkin-drawer');
  const recordsRoot = root.querySelector('#adminCheckinRecords');
  const close = () => { root.innerHTML = ''; };
  root.querySelector('#closeUserDrawer').onclick = close;
  backdrop.onclick = (event) => { if (event.target === backdrop) close(); };

  let touchStartY = null;
  drawer.addEventListener('touchstart', (event) => {
    if (event.target.closest('.drawer-handle')) touchStartY = event.touches[0].clientY;
  }, { passive: true });
  drawer.addEventListener('touchend', (event) => {
    if (touchStartY !== null && event.changedTouches[0].clientY - touchStartY > 80) close();
    touchStartY = null;
  }, { passive: true });

  const render = (result) => {
    if (!drawer.isConnected || drawer.dataset.checkinKey !== cacheKey) return;
    const records = Array.isArray(result?.records) ? result.records : [];
    recordsRoot.setAttribute('aria-busy', 'false');
    recordsRoot.innerHTML = records.length ? records.map((record) => {
      const images = Array.isArray(record.images) ? record.images : [];
      const photos = images.map((media, imageIndex) => {
        const thumbUrl = typeof media === 'string' ? media : media.thumbUrl || media.imageUrl || media.displayUrl;
        const displayUrl = typeof media === 'string' ? media : media.displayUrl || thumbUrl;
        if (!thumbUrl) return '';
        return \`<button type="button" class="image-viewer-trigger admin-checkin-photo"
          data-image-viewer="\${escapeHtml(thumbUrl)}" data-image-thumb="\${escapeHtml(thumbUrl)}"
          data-image-display="\${escapeHtml(displayUrl)}" data-image-alt="打卡照片">
          <span class="image-shell"><img data-perf-image="admin-checkin-thumb" \${imageIndex === 0 ? 'src' : 'data-src'}="\${escapeHtml(thumbUrl)}" loading="\${imageIndex === 0 ? 'eager' : 'lazy'}"
            fetchpriority="\${imageIndex === 0 ? 'high' : 'low'}" decoding="async" width="540" height="405" alt="打卡照片"
            onload="this.parentElement.classList.add('loaded')"
            onerror="this.hidden=true;this.parentElement.classList.add('failed')"><span class="image-error">图片加载失败，点击重试</span></span>
        </button>\`;
      }).join('');
      return \`<article class="admin-checkin-record">
        <div class="admin-checkin-record-head"><strong>\${escapeHtml(record.taskName || record.slotId || '打卡')}</strong><span class="pill done">\${escapeHtml(record.status || '已提交')}</span></div>
        \${photos ? \`<div class="admin-checkin-photo-grid">\${photos}</div>\` : '<p class="muted">暂无照片</p>'}
      </article>\`;
    }).join('') : '<p class="admin-checkin-empty">当日暂无打卡</p>';
    prepareDynamicContent(recordsRoot);
  };

  const cached = adminCheckinViewCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < ADMIN_CHECKIN_CACHE_TTL_MS) {
    render(cached.data);
    return;
  }

  const load = async () => {
    let promise = adminCheckinInflight.get(cacheKey);
    if (!promise) {
      promise = api(\`/api/admin/users/\${encodeURIComponent(studentUser.id)}/checkins?date=\${encodeURIComponent(date)}\`, { timeoutMs: 8_000 })
        .finally(() => adminCheckinInflight.delete(cacheKey));
      adminCheckinInflight.set(cacheKey, promise);
    }
    try {
      const result = await promise;
      adminCheckinViewCache.set(cacheKey, { data: result, savedAt: Date.now() });
      render(result);
    } catch (error) {
      if (!drawer.isConnected) return;
      recordsRoot.setAttribute('aria-busy', 'false');
      recordsRoot.innerHTML = \`<div class="admin-inline-error"><p>\${escapeHtml(error.message)}</p><button type="button" id="retryAdminCheckins">重新加载</button></div>\`;
      recordsRoot.querySelector('#retryAdminCheckins').onclick = () => {
        adminCheckinViewCache.delete(cacheKey);
        openAdminUserDrawer(studentUser, date);
      };
    }
  };
  void load();
}`;

  adminUiSource = replaceOnce(
    adminUiSource,
    /(?:\/\* MOBILE_ADMIN_PHOTO_FIX_V1 \*\/\r?\nconst ADMIN_CHECKIN_CACHE_TTL_MS = 60_000;\r?\nconst adminCheckinViewCache = new Map\(\);\r?\nconst adminCheckinInflight = new Map\(\);\r?\n\r?\n)?function openAdminUserDrawer\([\s\S]*?\r?\n\}\r?\n\r?\nfunction taskFormFields/,
    `${drawerFunction}\n\nfunction taskFormFields`,
    '管理员用户打卡抽屉'
  );

  if (usesLazyAdminClient) {
    fs.writeFileSync(adminClientPath, adminUiSource, 'utf8');
    console.log('Applied immediate cached check-in drawer to the lazy admin client.');
    process.exit(0);
  }
  appSource = adminUiSource;

  const displayUploadBlock = `      const uploaded = await item.uploadPromise;
      if (current !== session) return;
      item.mediaId = uploaded.mediaId;
      item.error = null;`;
  const displayAndThumbUploadBlock = `      const uploaded = await item.uploadPromise;
      if (current !== session) return;
      const displayMediaId = uploaded.mediaId;
      status.textContent = \`第 \${index + 1}/\${current.items.length} 张：正在生成540px WebP缩略图…\`;
      const thumbnail = await compressImage(sourceFile, {
        variant: 'thumb',
        signal: current.controller.signal
      });
      try {
        status.textContent = \`第 \${index + 1}/\${current.items.length} 张：正在上传缩略图…\`;
        await uploadCompressedImage(thumbnail, {
          taskId: task.id,
          businessType: 'member-checkin',
          variant: 'thumb',
          parentMediaId: displayMediaId
        }, current.controller.signal);
      } finally {
        if (thumbnail.previewUrl) {
          URL.revokeObjectURL(thumbnail.previewUrl);
          mediaPreviewUrls.delete(thumbnail.previewUrl);
        }
      }
      if (current !== session) return;
      item.mediaId = displayMediaId;
      item.error = null;`;
  appSource = replaceOnce(appSource, displayUploadBlock, displayAndThumbUploadBlock, '互动打卡缩略图上传流程');
  fs.writeFileSync(appPath, appSource, 'utf8');
}

let cssSource = fs.readFileSync(cssPath, 'utf8');
if (!cssSource.includes(marker)) {
  cssSource += `\n\n${marker}
.admin-checkin-drawer { max-height: min(88vh, 820px); }
.admin-checkin-date { margin: 0 0 12px; color: var(--muted, #8f96a8); font-size: .9rem; }
.admin-checkin-records { min-height: 180px; }
.admin-checkin-records, .admin-checkin-photo-grid { display: grid; gap: 12px; }
.admin-checkin-record { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--border, rgba(255,255,255,.12)); border-radius: 14px; background: rgba(255,255,255,.025); }
.admin-checkin-record-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.admin-checkin-photo-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.admin-checkin-photo { min-width: 0; padding: 0; border: 0; border-radius: 12px; overflow: hidden; background: rgba(0,0,0,.08); box-shadow: none; }
.admin-checkin-photo .image-shell { display: block; aspect-ratio: 4 / 3; }
.admin-checkin-photo img { width: 100%; height: 100%; object-fit: cover; }
.admin-checkin-empty { min-height: 180px; display: grid; place-items: center; margin: 0; color: var(--muted, #8f96a8); }
.admin-checkin-skeleton { min-height: 220px; border-radius: 16px; background: linear-gradient(90deg, rgba(255,255,255,.04), rgba(255,255,255,.12), rgba(255,255,255,.04)); background-size: 220% 100%; animation: admin-photo-loading 1.1s linear infinite; }
@keyframes admin-photo-loading { to { background-position: -220% 0; } }

@media (max-width: 760px) {
  .admin-refactor-hero { padding: 24px 20px 22px !important; }
  .admin-refactor-hero .row { display: grid; grid-template-columns: 1fr; gap: 18px; }
  .admin-refactor-hero h1 { margin: 0 0 7px; font-size: clamp(2rem, 9vw, 2.75rem); line-height: 1.05; }
  .admin-refactor-hero .row > div:first-child > div { font-size: .95rem; line-height: 1.45; }
  .admin-header-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; gap: 10px; }
  .admin-header-actions button { min-height: 52px; padding: 10px 12px; font-size: 1rem; border-radius: 18px; }
  .admin-header-actions #out { grid-column: 1 / -1; }
  .admin-checkin-drawer { padding-inline: 16px; }
}

@media (max-width: 430px) {
  .admin-checkin-photo-grid { grid-template-columns: 1fr 1fr; gap: 9px; }
}`;
  fs.writeFileSync(cssPath, cssSource, 'utf8');
}

let mediaSource = fs.readFileSync(mediaRoutePath, 'utf8');
if (!mediaSource.includes(marker)) {
  mediaSource = replaceOnce(mediaSource, 'const THUMB_MAX_EDGE = 360;', `const THUMB_MAX_EDGE = 540;\n${marker}`, '服务端缩略图尺寸常量');
  fs.writeFileSync(mediaRoutePath, mediaSource, 'utf8');
}

let signingSource = fs.readFileSync(signingPath, 'utf8');
if (!signingSource.includes(marker)) {
  signingSource = replaceOnce(
    signingSource,
    `const hmac = async (payload, secret) => {
  if (!secret) throw Object.assign(new Error('媒体签名密钥未配置'), { status: 503 });
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))));
};`,
    `${marker}
let hmacKeySecret = '';
let hmacKeyPromise = null;
const hmac = async (payload, secret) => {
  if (!secret) throw Object.assign(new Error('媒体签名密钥未配置'), { status: 503 });
  if (!hmacKeyPromise || hmacKeySecret !== secret) {
    hmacKeySecret = secret;
    hmacKeyPromise = crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
  }
  const key = await hmacKeyPromise;
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))));
};`,
    '媒体签名密钥缓存'
  );
  fs.writeFileSync(signingPath, signingSource, 'utf8');
}

let bootstrapSource = fs.readFileSync(bootstrapPath, 'utf8');
bootstrapSource = bootstrapSource.replaceAll('20260730-flow2', '20260730-adminphoto1');
fs.writeFileSync(bootstrapPath, bootstrapSource, 'utf8');

let indexSource = fs.readFileSync(indexPath, 'utf8');
indexSource = indexSource.replace(/\/bootstrap\.js\?v=[a-zA-Z0-9-]+/, '/bootstrap.js?v=20260730-adminphoto1');
fs.writeFileSync(indexPath, indexSource, 'utf8');

console.log('Applied mobile admin photo, thumbnail and header layout fixes.');
