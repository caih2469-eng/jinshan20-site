/* PLAZA_UNDER_1S_AND_MEMBER_IMAGE_LIMIT_V1 */
/* PLAZA_DETAIL_INSTANT_OPEN_V2 */
/* APPROVED_LAYOUT_TEAM_DRAFT_720_V2 */
/* APPROVED_MOBILE_EXPERIENCE_FINALIZED_V1 */
const app = document.querySelector('#app');
let token = '';
let user = window.__BOOTSTRAP_USER__ || null;
try {
  token = localStorage.getItem('token') || '';
  if (!user) user = JSON.parse(localStorage.getItem('user') || 'null');
} catch {
  // Restricted WebViews can deny localStorage; the HttpOnly session cookie remains authoritative.
}
let config;
let tracks = [];
let materialAdminPage = 1;
let materialAdminCampus = '';
let adminUserPage = Number(sessionStorage.adminUserPage || 1);
let adminUserFilter = sessionStorage.adminUserFilter || 'all';
let adminUserQuery = sessionStorage.adminUserQuery || '';
let adminCompletionTrack = sessionStorage.adminCompletionTrack || 'all';
let scrollSaveTimer;
let navigationEpoch = 0;
let midnightRefreshTimer = null;
let studentDashboardDirty = false;
const inflightGetRequests = new Map();
let imageCompressionLibraryPromise = null;
let imagePipelineLibraryPromise = null;
let imagePipelineInstance = null;
const studentViewState = {
  userId: null,
  data: null,
  renderedAt: 0,
  scrollY: 0,
  dirty: true,
  refreshPromise: null,
  refreshError: null
};
const VIEW_CACHE_TTL_MS = 60_000;
/* PLAZA_DETAIL_FAST_PATH_V1 */
const PLAZA_POST_CACHE_TTL_MS = 30_000;
const plazaViewCache = new Map();
const plazaPostCache = new Map();
const plazaPostInflight = new Map();
let plazaPostCacheGeneration = 0;
let studentPlazaPrefetchPromise = null;
const rankingViewCache = new Map();
const countedPlazaViews = new Set();
let plazaModalEpoch = 0;
const recordPerf = (type, details = {}) => {
  window.__RECORD_PERF__?.(type, details);
};
const metricPath = (value) => {
  try {
    const parsed = new URL(value, location.origin);
    return parsed.origin === location.origin ? parsed.pathname : 'r2-presigned-put';
  } catch {
    return 'unknown';
  }
};
const roundedDuration = (startedAt) => Math.round((performance.now() - startedAt) * 10) / 10;
/* APPROVED_REAL_DEVICE_PERF_DIAGNOSTICS_V1 */
let activePhotoFlow = null;
const startPhotoFlow = (kind) => { activePhotoFlow = { kind, startedAt: performance.now() }; recordPerf('photo-flow-start', { kind }); };
const photoFlowDuration = (metric) => {
  if (!activePhotoFlow) return null;
  const expected = activePhotoFlow.kind;
  const matches = (expected === 'history' && metric === 'history-thumb')
    || (expected === 'plaza' && ['plaza-thumb','plaza-detail-thumb'].includes(metric))
    || (expected === 'admin-checkin' && metric === 'admin-checkin-thumb')
    || (expected === 'admin-plaza' && metric === 'admin-plaza-thumb');
  if (!matches) return null;
  const duration = Math.round((performance.now() - activePhotoFlow.startedAt) * 10) / 10;
  activePhotoFlow = null;
  return duration;
};

const scopedCacheKey = (...parts) => [
  user?.id || user?.studentId || 'anonymous',
  ...parts.map((part) => String(part ?? ''))
].join('|');
const readViewCache = (cache, key) => cache.get(key) || null;
const writeViewCache = (cache, key, data) => {
  cache.set(key, { data, savedAt: Date.now() });
  return data;
};
const cacheIsFresh = (entry) => Boolean(
  entry && Date.now() - entry.savedAt <= VIEW_CACHE_TTL_MS
);
const plazaPostCacheKey = (postId) => scopedCacheKey('plaza-post', postId);
const readPlazaPostCache = (postId) => {
  const entry = plazaPostCache.get(plazaPostCacheKey(postId));
  return entry && Date.now() - entry.savedAt <= PLAZA_POST_CACHE_TTL_MS ? entry.post : null;
};
const writePlazaPostCache = (postId, post) => {
  plazaPostCache.set(plazaPostCacheKey(postId), { post, savedAt: Date.now() });
  return post;
};
const patchPlazaPostCache = (postId, updates) => {
  const entry = plazaPostCache.get(plazaPostCacheKey(postId));
  if (entry?.post) Object.assign(entry.post, updates);
};
const loadPlazaPost = (postId) => {
  const cached = readPlazaPostCache(postId);
  if (cached) return Promise.resolve(cached);
  const key = plazaPostCacheKey(postId);
  if (plazaPostInflight.has(key)) return plazaPostInflight.get(key);
  const generation = plazaPostCacheGeneration;
  const request = api(`/api/plaza/${encodeURIComponent(postId)}`)
    .then(({ post }) => {
      if (generation === plazaPostCacheGeneration) writePlazaPostCache(postId, post);
      return post;
    })
    .finally(() => {
      if (plazaPostInflight.get(key) === request) plazaPostInflight.delete(key);
    });
  plazaPostInflight.set(key, request);
  return request;
};

const readPlazaPostPreview = (postId) => {
  for (const entry of plazaViewCache.values()) {
    const post = entry?.data?.posts?.find((item) => item.id === postId);
    if (post) return post;
  }
  return null;
};
const warmVisiblePlazaDetails = () => {
  if (document.body.dataset.view !== 'plaza') return false;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
  if (connection.saveData || /(^|-)2g$/.test(connection.effectiveType || '')) return true;
  const postIds = [...document.querySelectorAll('[data-post]')]
    .slice(0, 4)
    .map((card) => card.dataset.post)
    .filter(Boolean);
  if (!postIds.length) return false;
  const run = () => postIds.forEach((postId, index) => {
    const delay = index < 2 ? index * 40 : 220 + (index - 2) * 100;
    setTimeout(() => { void loadPlazaPost(postId).catch(() => null); }, delay);
  });
  queueMicrotask(run);
  return true;
};
const scheduleVisiblePlazaDetailWarmup = () => {
  let attempt = 0;
  const probe = () => {
    attempt += 1;
    if (warmVisiblePlazaDetails() || attempt >= 10) return;
    setTimeout(probe, 120);
  };
  setTimeout(probe, 0);
};
const installPlazaDetailIntentPrefetch = () => {
  if (document.documentElement.dataset.plazaDetailPrefetch === 'v2') return;
  document.documentElement.dataset.plazaDetailPrefetch = 'v2';
  const prefetch = (event) => {
    if (document.body.dataset.view !== 'plaza') return;
    const card = event.target?.closest?.('[data-post]');
    const postId = card?.dataset?.post;
    if (postId) void loadPlazaPost(postId).catch(() => null);
  };
  document.addEventListener('pointerdown', prefetch, { passive: true, capture: true });
  document.addEventListener('pointerover', prefetch, { passive: true });
  document.addEventListener('focusin', prefetch);
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('#plaza')) scheduleVisiblePlazaDetailWarmup();
  }, { capture: true });
};
installPlazaDetailIntentPrefetch();
const clearUserViewCaches = () => {
  plazaViewCache.clear();
  plazaPostCache.clear();
  plazaPostInflight.clear();
  plazaPostCacheGeneration += 1;
  rankingViewCache.clear();
  countedPlazaViews.clear();
};

const beginNavigation = () => {
  if (document.body.dataset.view === 'student') studentViewState.scrollY = window.scrollY;
  navigationEpoch += 1;
  return navigationEpoch;
};
const isCurrentNavigation = (epoch) => epoch === navigationEpoch;

window.addEventListener('scroll', () => {
  if (document.body.dataset.view !== 'admin') return;
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(() => { sessionStorage.adminScrollY = String(window.scrollY); }, 80);
}, { passive: true });

const lazyImageObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const image = entry.target;
      if (image.dataset.src) {
        image.src = buildMediaUrl(image.dataset.src);
        image.removeAttribute('data-src');
      }
      observer.unobserve(image);
    });
  }, { rootMargin: '240px 0px' })
  : null;

const preparePerfImage = (image) => {
  const metric = image.dataset.perfImage;
  if (!metric || image.dataset.perfBound) return;
  image.dataset.perfBound = 'true';
  const startedAt = performance.now();
  image.addEventListener('load', () => { const flowDuration = photoFlowDuration(metric); recordPerf('image-visible', { metric, duration: roundedDuration(startedAt), flowDuration, bytesHint: Number(image.dataset.bytes || 0), cacheHint: performance.getEntriesByName(image.currentSrc || image.src).at(-1)?.transferSize === 0 ? 'warm' : 'cold' }); }, { once: true });
  image.addEventListener('error', () => recordPerf('image-error', { metric, duration: roundedDuration(startedAt) }), { once: true });
};
const prepareDynamicContent = (container = app) => {
  container.querySelectorAll('table').forEach((table) => {
    if (table.dataset.mobileReady) return;
    const labels = [...table.querySelectorAll('thead th')].map((cell) => cell.textContent.trim());
    table.querySelectorAll('tbody tr').forEach((row) => {
      [...row.children].forEach((cell, index) => {
        if (cell.tagName === 'TD') cell.dataset.label = labels[index] || '';
      });
    });
    table.dataset.mobileReady = 'true';
  });
  container.querySelectorAll('img').forEach((image) => {
    if (image.dataset.dynamicReady) return;
    image.dataset.dynamicReady = 'true';
    preparePerfImage(image);
    image.loading = image.dataset.priority === 'high' ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.fetchPriority = image.dataset.priority === 'high' ? 'high' : 'low';
    if (image.dataset.src) {
      if (image.dataset.priority === 'high' || !lazyImageObserver) {
        image.src = buildMediaUrl(image.dataset.src);
        image.removeAttribute('data-src');
      } else {
        lazyImageObserver.observe(image);
      }
    }
  });
};

let activeImageViewer = null;
let imageViewerCloseTimer = null;
const closeImageViewer = (fromHistory = false) => {
  if (!activeImageViewer) return;
  activeImageViewer.remove();
  activeImageViewer = null;
  clearTimeout(imageViewerCloseTimer);
  if (!fromHistory && history.state?.imageViewer) history.back();
};
window.addEventListener('popstate', () => {
  if (activeImageViewer) closeImageViewer(true);
});

const saveOriginalImage = async (url, alt = '活动原图') => {
  const target = buildMediaUrl(url);
  const embedded = /MicroMessenger|QQ\//i.test(navigator.userAgent);
  if (embedded) {
    window.open(target, '_blank', 'noopener');
    showToast(/iPhone|iPad|iPod/i.test(navigator.userAgent) ? '已打开高清原图，请长按图片保存。' : '已打开高清原图，可长按或使用浏览器菜单保存。');
    return;
  }
  const response = await fetch(target, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('原图下载失败，请稍后重试。');
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `${String(alt || '活动原图').replace(/[^\w\u4e00-\u9fa5-]+/g, '-')}.webp`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};
const openImageViewer = (thumbSrc, displaySrc, alt = '查看图片', renderedImage = null) => {
  if (activeImageViewer) closeImageViewer(true);
  const renderedThumb = renderedImage?.complete && renderedImage.naturalWidth
    ? (renderedImage.currentSrc || renderedImage.src)
    : '';
  const thumb = renderedThumb || buildMediaUrl(thumbSrc || displaySrc);
  const display = buildMediaUrl(displaySrc || thumbSrc);
  const viewer = document.createElement('div');
  viewer.className = 'image-viewer';
  viewer.setAttribute('role', 'dialog');
  viewer.setAttribute('aria-modal', 'true');
  viewer.innerHTML = `
    <div class="image-viewer-toolbar"><button type="button" class="secondary" data-image-close>关闭原图</button><button type="button" data-image-save>保存原图</button></div>
    <div class="image-viewer-stage" aria-label="单击返回上一层"><div class="image-shell"><img decoding="async" src="${escapeHtml(thumb)}" alt="${escapeHtml(alt)}"><button type="button" class="image-error" hidden>图片加载失败，点击重试</button></div></div>`;
  document.body.appendChild(viewer);
  activeImageViewer = viewer;
  history.pushState({ ...(history.state || {}), imageViewer: true }, '');
  const stage = viewer.querySelector('.image-viewer-stage');
  const image = viewer.querySelector('img');
  const retry = viewer.querySelector('.image-error');
  viewer.querySelector('[data-image-close]').onclick = (event) => { event.stopPropagation(); closeImageViewer(); };
  viewer.querySelector('[data-image-save]').onclick = async (event) => {
    event.stopPropagation();
    const restore = beginButtonLoading(event.currentTarget, '处理中…');
    try { await saveOriginalImage(display, alt); } catch (error) { alert(error.message); } finally { restore(); }
  };
  viewer.querySelector('.image-viewer-toolbar').onclick = (event) => event.stopPropagation();
  let manualRetryUsed = false;
  const markLoaded = () => {
    image.parentElement.classList.add('loaded');
    image.parentElement.classList.remove('failed');
    retry.hidden = true;
  };
  const markFailed = () => {
    image.parentElement.classList.add('failed');
    retry.hidden = false;
  };
  image.addEventListener('load', markLoaded);
  image.addEventListener('error', markFailed);
  if (image.complete && image.naturalWidth) markLoaded();
  if (display && display !== thumb) {
    const displayImage = new Image();
    displayImage.decoding = 'async';
    displayImage.fetchPriority = 'high';
    displayImage.onload = async () => {
      try { await displayImage.decode(); } catch {}
      if (!activeImageViewer || !viewer.isConnected) return;
      image.src = displayImage.currentSrc || display;
      image.dataset.displayLoaded = 'true';
    };
    displayImage.onerror = markFailed;
    displayImage.src = display;
  }
  retry.addEventListener('click', (event) => {
    event.stopPropagation();
    if (manualRetryUsed) return;
    manualRetryUsed = true;
    retry.hidden = true;
    image.src = `${display}${display.includes('?') ? '&' : '?'}retry=1`;
  });
  let pointerStart = null;
  let moved = false;
  stage.addEventListener('pointerdown', (event) => {
    pointerStart = { x: event.clientX, y: event.clientY };
    moved = false;
  }, { passive: true });
  stage.addEventListener('pointermove', (event) => {
    if (!pointerStart) return;
    moved ||= Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 8;
  }, { passive: true });
  stage.addEventListener('pointerup', () => {
    pointerStart = null;
    if (moved) return;
    clearTimeout(imageViewerCloseTimer);
    imageViewerCloseTimer = setTimeout(() => closeImageViewer(), 220);
  }, { passive: true });
  stage.addEventListener('dblclick', (event) => {
    clearTimeout(imageViewerCloseTimer);
    event.preventDefault();
  });
};

app.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-image-viewer]');
  if (!trigger) return;
  event.preventDefault();
  event.stopPropagation();
  openImageViewer(
    trigger.dataset.imageThumb || trigger.dataset.imageViewer,
    trigger.dataset.imageDisplay || trigger.dataset.imageViewer,
    trigger.dataset.imageAlt || '查看图片',
    trigger.querySelector('img')
  );
});

const openDialog = ({ title, message = '', input = false, inputLabel = '', value = '', danger = false,
  cancelText = '取消', confirmText = '确定', notice = false }) => new Promise((resolve) => {
  const shell = document.createElement('div');
  shell.className = 'app-dialog-backdrop';
  shell.innerHTML = `<section class="app-dialog" role="dialog" aria-modal="true" aria-labelledby="appDialogTitle">
    <h2 id="appDialogTitle">${escapeHtml(title)}</h2>
    ${message ? `<p>${escapeHtml(message)}</p>` : ''}
    ${input ? `<label>${escapeHtml(inputLabel)}</label><input id="appDialogInput" value="${escapeHtml(value)}">` : ''}
    <div class="app-dialog-actions">
      ${notice ? '' : `<button class="secondary" data-dialog-cancel>${escapeHtml(cancelText)}</button>`}
      <button class="${danger ? 'danger' : ''}" data-dialog-confirm>${escapeHtml(confirmText)}</button>
    </div>
  </section>`;
  document.body.append(shell);
  const close = (result) => {
    shell.classList.add('closing');
    setTimeout(() => shell.remove(), 180);
    resolve(result);
  };
  shell.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => close(false));
  shell.querySelector('[data-dialog-confirm]').addEventListener('click', () => {
    close(input ? shell.querySelector('#appDialogInput').value.trim() : true);
  });
  shell.addEventListener('click', (event) => { if (event.target === shell && !notice) close(false); });
  shell.querySelector('input')?.focus();
});

const alert = (message) => { void openDialog({ title: '提示', message: String(message), notice: true, confirmText: '知道了' }); };
const askConfirm = (title, message, options = {}) => openDialog({ title, message, danger: true, ...options });
const askText = (title, message, inputLabel) => openDialog({
  title, message, input: true, inputLabel, cancelText: '取消', confirmText: '确定'
});
const showToast = (message, tone = 'success', duration = 3000) => {
  let region = document.querySelector('#appToastRegion');
  if (!region) {
    region = document.createElement('div');
    region.id = 'appToastRegion';
    region.className = 'toast-region';
    region.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
    region.setAttribute('aria-atomic', 'true');
    document.body.appendChild(region);
  }
  const toast = document.createElement('div');
  toast.className = `app-toast ${tone}`;
  toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  toast.textContent = String(message);
  region.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 180);
  }, Math.min(4000, Math.max(2000, duration)));
};
const beginButtonLoading = (button, text = '处理中…') => {
  if (!button || button.dataset.loading === 'true') return () => {};
  const originalText = button.textContent;
  button.dataset.loading = 'true';
  button.disabled = true;
  button.textContent = text;
  return () => {
    button.dataset.loading = 'false';
    button.disabled = false;
    button.textContent = originalText;
  };
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const isJsonString = (value) => {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
};

const parseApiResponse = async (response) => {
  if (response.status === 204 || response.status === 205) return {};
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (!text) return {};
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('服务器暂时无法响应，请稍后重试。');
    }
  }
  if (!response.ok || contentType.includes('text/html')) {
    throw new Error('服务器暂时无法响应，请稍后重试。');
  }
  return text;
};

const apiRequest = async (url, options, method) => {
  const { timeoutMs: requestedTimeout, retryOverload: _retryOverload, ...fetchOptions } = options;
  const headers = new Headers(options.headers || {});
  const body = options.body;
  if (token && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
  if (body != null && !headers.has('content-type') && isJsonString(body)) {
    headers.set('content-type', 'application/json');
  }

  const timeoutMs = Number(requestedTimeout)
    || (method === 'GET' || method === 'HEAD' ? 12_000 : 30_000);
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener?.('abort', forwardAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      method,
      headers,
      credentials: 'same-origin',
      signal: controller.signal
    });
    return response;
  } catch (error) {
    if (timedOut) throw new Error('网络响应超时，请稍后重试。');
    if (options.signal?.aborted) throw new Error('操作已取消，请重试。');
    throw new Error('网络连接失败，请检查网络后重试。');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener?.('abort', forwardAbort);
  }
};

const executeApi = async (url, options, method) => {
  const retryableMethod = method === 'GET' || method === 'HEAD';
  const retryOverload = Boolean(options.retryOverload);
  const maxAttempts = retryOverload ? 8 : (retryableMethod ? 2 : 1);
  const startedAt = performance.now();
  let retryCount = 0;
  let status = 0;
  let requestId = '';
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      retryCount = attempt;
      let response;
      try {
        response = await apiRequest(url, options, method);
      } catch (error) {
        const retryNetwork = (retryableMethod && attempt === 0 && /网络连接失败/.test(error.message))
          || (retryOverload && attempt < maxAttempts - 1);
        if (!retryNetwork) throw error;
        const retryDelay = retryOverload
          ? Math.floor(Math.random() * (Math.min(15_000, 1_000 * (2 ** attempt)) + 1))
          : 300 + Math.floor(Math.random() * 301);
        await wait(retryDelay);
        continue;
      }
      status = response.status;
      requestId = response.headers.get('x-request-id') || '';
      const transientReadFailure = attempt === 0 && retryableMethod
        && [502, 503, 504].includes(response.status);
      const transientOverload = retryOverload && attempt < maxAttempts - 1
        && [429, 503].includes(response.status);
      if (transientReadFailure || transientOverload) {
        await response.body?.cancel().catch(() => null);
        const retryDelay = transientOverload
          ? Math.floor(Math.random() * (Math.min(15_000, 1_000 * (2 ** attempt)) + 1))
          : 300 + Math.floor(Math.random() * 301);
        await wait(retryDelay);
        continue;
      }
      const result = await parseApiResponse(response);
      if (!response.ok) {
        const fallback = [502, 503, 504].includes(response.status)
          ? '服务器暂时无法响应，请稍后重试。'
          : '操作失败，请稍后重试。';
        throw new Error(result?.error || fallback);
      }
      return result;
    }
    throw new Error('服务器暂时无法响应，请稍后重试。');
  } finally {
    recordPerf('request', {
      requestId,
      method,
      path: metricPath(url),
      status,
      retryCount,
      duration: roundedDuration(startedAt),
      navigationEpoch
    });
  }
};

const api = (path, options = {}) => {
  const method = String(options.method || 'GET').toUpperCase();
  const url = normalizeSitePath(path);
  const requestOptions = { ...options };
  delete requestOptions.timeoutMs;
  if (method !== 'GET' && method !== 'HEAD') {
    return executeApi(url, { ...requestOptions, timeoutMs: options.timeoutMs }, method);
  }

  const requestKey = `${user?.id || user?.studentId || 'anonymous'}|${method}|${url}`;
  const existing = inflightGetRequests.get(requestKey);
  if (existing) return existing;
  const request = executeApi(url, { ...requestOptions, timeoutMs: options.timeoutMs }, method)
    .finally(() => inflightGetRequests.delete(requestKey));
  inflightGetRequests.set(requestKey, request);
  return request;
};

const loadImageCompressionLibrary = () => {
  if (typeof window.imageCompression === 'function') return Promise.resolve(window.imageCompression);
  if (imageCompressionLibraryPromise) return imageCompressionLibraryPromise;
  imageCompressionLibraryPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-image-compression-library]');
    const script = existing || document.createElement('script');
    const handleLoad = () => {
      if (typeof window.imageCompression === 'function') resolve(window.imageCompression);
      else reject(new Error('图片处理组件加载失败，请刷新后重试。'));
    };
    const handleError = () => reject(new Error('图片处理组件加载失败，请刷新后重试。'));
    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    if (!existing) {
      script.src = '/vendor/browser-image-compression-2.0.2.js';
      script.async = true;
      script.dataset.imageCompressionLibrary = 'true';
      document.head.appendChild(script);
    }
  }).catch((error) => {
    imageCompressionLibraryPromise = null;
    throw error;
  });
  return imageCompressionLibraryPromise;
};

const uploadBinary = async (url, options = {}) => {
  const startedAt = performance.now();
  const controller = new AbortController();
  let timedOut = false;
  let status = 0;
  let requestId = '';
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener?.('abort', forwardAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 60_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    status = response.status;
    requestId = response.headers.get('x-request-id') || '';
    return response;
  } catch {
    if (timedOut) throw new Error('图片上传超时，请检查网络后重试。');
    if (options.signal?.aborted) throw new Error('图片上传已取消，请重新选择图片。');
    throw new Error('网络连接失败，请检查网络后重试。');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener?.('abort', forwardAbort);
    recordPerf('upload', {
      requestId,
      method: String(options.method || 'GET').toUpperCase(),
      path: metricPath(url),
      status,
      retryCount: 0,
      duration: roundedDuration(startedAt),
      navigationEpoch
    });
  }
};

const escapeHtml = (value) =>
  String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);

const MEDIA_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
/* MOBILE_ADMIN_PHOTO_FIX_V1 */
const MEDIA_THUMB_MAX_EDGE = 720;
const MEDIA_PLAZA_THUMB_MAX_EDGE = 640;
const MEDIA_DISPLAY_MAX_EDGE = 960;
const MEDIA_THUMB_MAX_SIZE_MB = 0.28;
const MEDIA_PLAZA_THUMB_MAX_SIZE_MB = 0.18;
const MEDIA_DISPLAY_MAX_SIZE_MB = 0.7;
const MEDIA_THUMB_QUALITY = 0.84;
const MEDIA_PLAZA_THUMB_QUALITY = 0.84;
const MEDIA_DISPLAY_QUALITY = 0.78;
const MEMBER_FAST_MAX_BYTES = 307_200;
const MEMBER_FAST_MAX_EDGE = 960;
const MEDIA_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const mediaPreviewUrls = new Set();
const mediaUploadSessions = new Set();

const detectImageMime = (bytes) => {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';

  const pngSignature = [...bytes.slice(0, 8)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (pngSignature === '89504e470d0a1a0a') return 'image/png';

  const prefix = new TextDecoder().decode(bytes.slice(0, 4));
  const webp = new TextDecoder().decode(bytes.slice(8, 12));
  if (prefix === 'RIFF' && webp === 'WEBP') return 'image/webp';

  return '';
};

const bytesMatchMime = (bytes, type) => detectImageMime(bytes) === type;

const normalizeSourceImage = async (file) => {
  if (file.size > MEDIA_MAX_SOURCE_BYTES) {
    throw new Error('单张图片不能超过5MB，请压缩或重新选择图片。');
  }

  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const detectedType = detectImageMime(header);
  if (!detectedType || !MEDIA_ALLOWED_TYPES.has(detectedType)) {
    const reportedType = String(file.type || '').toLowerCase();
    const heicLike = reportedType.includes('heic') || reportedType.includes('heif')
      || /\.(heic|heif)$/i.test(file.name);
    throw new Error(heicLike
      ? '当前设备无法稳定处理HEIC，请改用JPG、PNG或WebP。'
      : '无法识别图片真实格式，请重新截图或另存为JPG后上传。');
  }

  if (file.type === detectedType) return file;

  // 微信/QQ可能把PNG或WebP文件错误标记成JPG。按真实文件头修正MIME，
  // 后续压缩仍统一输出WebP或JPEG，服务端校验规则保持不变。
  return new File([file], file.name, {
    type: detectedType,
    lastModified: file.lastModified || Date.now()
  });
};

const imageDimensions = async (blob) => {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('图片处理失败，请重新选择图片。'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};

/* PICA_IMAGE_PIPELINE_V1 */
const IMAGE_PIPELINE_SCRIPT = '/vendor/image-blob-reduce-5.0.1.min.js';
const PICA_DISPLAY_MAX_EDGE = 2048;
const PICA_THUMB_MAX_EDGE = 960;
const PICA_DISPLAY_MAX_BYTES = 1468006;
const PICA_THUMB_MAX_BYTES = 491520;

const loadImagePipelineLibrary = () => {
  if (typeof window.imageBlobReduce === 'function') return Promise.resolve(window.imageBlobReduce);
  if (imagePipelineLibraryPromise) return imagePipelineLibraryPromise;
  imagePipelineLibraryPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-image-pipeline-library]');
    const script = existing || document.createElement('script');
    const handleLoad = () => {
      if (typeof window.imageBlobReduce === 'function') resolve(window.imageBlobReduce);
      else reject(new Error('高清图片处理组件加载失败，请刷新后重试。'));
    };
    const handleError = () => reject(new Error('高清图片处理组件加载失败，请刷新后重试。'));
    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    if (!existing) {
      script.src = IMAGE_PIPELINE_SCRIPT;
      script.async = true;
      script.dataset.imagePipelineLibrary = 'true';
      document.head.appendChild(script);
    }
  }).catch((error) => {
    imagePipelineLibraryPromise = null;
    throw error;
  });
  return imagePipelineLibraryPromise;
};

const getImagePipeline = async () => {
  if (imagePipelineInstance) return imagePipelineInstance;
  const factory = await loadImagePipelineLibrary();
  const pica = factory.pica({ tile: 1024, concurrency: 1 });
  const reducer = factory({ pica });
  imagePipelineInstance = { pica, reducer };
  return imagePipelineInstance;
};

const createPipelineCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

const releasePipelineCanvas = (canvas) => {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
};

const browserSupportsWebp = (() => {
  try {
    const canvas = createPipelineCanvas(1, 1);
    const supported = canvas.toDataURL('image/webp').startsWith('data:image/webp');
    releasePipelineCanvas(canvas);
    return supported;
  } catch {
    return false;
  }
})();

const encodePipelineCanvas = async (pica, canvas, profile) => {
  let mimeType = browserSupportsWebp ? 'image/webp' : 'image/jpeg';
  let blob = await pica.toBlob(canvas, mimeType, profile.quality);
  let header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (!bytesMatchMime(header, mimeType)) {
    mimeType = 'image/jpeg';
    blob = await pica.toBlob(canvas, mimeType, profile.quality);
    header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  }
  if (!bytesMatchMime(header, mimeType)) throw new Error('当前浏览器无法稳定编码图片，请改用JPG后重试。');
  if (blob.size > profile.maxBytes) {
    blob = await pica.toBlob(canvas, mimeType, profile.fallbackQuality);
  }
  if (!blob?.size || blob.size > 1.5 * 1024 * 1024) {
    throw new Error('图片处理后仍然过大，请在相册中裁剪后重新上传。');
  }
  const extension = mimeType === 'image/webp' ? 'webp' : 'jpg';
  const file = new File([blob], `${profile.baseName}-${profile.suffix}.${extension}`, {
    type: mimeType,
    lastModified: Date.now()
  });
  return {
    file,
    mimeType,
    width: canvas.width,
    height: canvas.height
  };
};

const prepareImageVariants = async (file, options = {}) => {
  const sourceFile = await normalizeSourceImage(file);
  if (options.signal?.aborted) throw new DOMException('操作已取消', 'AbortError');
  options.onProgress?.(5);
  const { pica, reducer } = await getImagePipeline();
  const screenshotLike = sourceFile.type === 'image/png';
  let masterCanvas = null;
  let thumbCanvas = null;
  let smallerDisplayCanvas = null;
  try {
    masterCanvas = await reducer.toCanvas(sourceFile, {
      max: PICA_DISPLAY_MAX_EDGE,
      filter: 'mks2013'
    });
    if (options.signal?.aborted) throw new DOMException('操作已取消', 'AbortError');
    options.onProgress?.(45);

    const thumbScale = Math.min(1, PICA_THUMB_MAX_EDGE / Math.max(masterCanvas.width, masterCanvas.height));
    if (thumbScale < 1) {
      thumbCanvas = createPipelineCanvas(masterCanvas.width * thumbScale, masterCanvas.height * thumbScale);
      await pica.resize(masterCanvas, thumbCanvas, { filter: 'mks2013' });
    } else {
      thumbCanvas = masterCanvas;
    }
    options.onProgress?.(65);

    const baseName = sourceFile.name.replace(/\.[^.]+$/, '') || 'image';
    let displayCanvas = masterCanvas;
    let display = await encodePipelineCanvas(pica, displayCanvas, {
      baseName,
      suffix: 'display',
      quality: screenshotLike ? 0.94 : 0.90,
      fallbackQuality: screenshotLike ? 0.90 : 0.86,
      maxBytes: PICA_DISPLAY_MAX_BYTES
    });

    if (display.file.size > PICA_DISPLAY_MAX_BYTES
        && Math.max(masterCanvas.width, masterCanvas.height) > 1600) {
      const scale = 1600 / Math.max(masterCanvas.width, masterCanvas.height);
      smallerDisplayCanvas = createPipelineCanvas(masterCanvas.width * scale, masterCanvas.height * scale);
      await pica.resize(masterCanvas, smallerDisplayCanvas, { filter: 'mks2013' });
      displayCanvas = smallerDisplayCanvas;
      display = await encodePipelineCanvas(pica, displayCanvas, {
        baseName,
        suffix: 'display',
        quality: screenshotLike ? 0.91 : 0.87,
        fallbackQuality: screenshotLike ? 0.88 : 0.84,
        maxBytes: PICA_DISPLAY_MAX_BYTES
      });
    }

    const thumb = await encodePipelineCanvas(pica, thumbCanvas, {
      baseName,
      suffix: 'thumb',
      quality: screenshotLike ? 0.92 : 0.88,
      fallbackQuality: screenshotLike ? 0.89 : 0.84,
      maxBytes: PICA_THUMB_MAX_BYTES
    });
    const previewUrl = URL.createObjectURL(display.file);
    mediaPreviewUrls.add(previewUrl);
    display.previewUrl = previewUrl;
    options.onProgress?.(100);
    return { display, thumb };
  } finally {
    if (thumbCanvas && thumbCanvas !== masterCanvas) releasePipelineCanvas(thumbCanvas);
    if (smallerDisplayCanvas) releasePipelineCanvas(smallerDisplayCanvas);
    releasePipelineCanvas(masterCanvas);
  }
};

const prepareImageVariantsMeasured = async (file, options = {}) => {
  const startedAt = performance.now();
  let output = null;
  try {
    output = await prepareImageVariants(file, options);
    return output;
  } finally {
    recordPerf('compress', {
      variant: 'display+thumb',
      sourceBytes: Number(file?.size || 0),
      outputBytes: Number(output?.display?.file?.size || 0) + Number(output?.thumb?.file?.size || 0),
      duration: roundedDuration(startedAt),
      navigationEpoch
    });
  }
};

const requestVariantUploadIntent = (image, context, variant, signal) => api('/api/media/upload-intents', {
  method: 'POST',
  signal,
  body: JSON.stringify({
    taskId: context.taskId || null,
    businessType: context.businessType,
    mimeType: image.mimeType,
    fileSize: image.file.size,
    width: image.width,
    height: image.height,
    variant
  })
});

const putVariantToR2 = async (intent, image, signal) => {
  const response = await uploadBinary(intent.uploadUrl, {
    method: 'PUT',
    headers: intent.headers,
    body: image.file,
    signal
  });
  if (!response.ok) throw new Error(`图片直传失败（${response.status}），请重新选择图片。`);
};

const confirmVariantUpload = async (intent, image, parentMediaId, signal) => {
  const confirmed = await api(`/api/media/upload-intents/${encodeURIComponent(intent.intentId)}/confirm`, {
    method: 'POST',
    signal,
    body: JSON.stringify({ parentMediaId: parentMediaId || null })
  });
  return { ...image, mediaId: confirmed.media.id };
};

const uploadPreparedImagePair = async (prepared, context, signal) => {
  const startedAt = performance.now();
  context.onStage?.('正在同时申请高清图和列表图上传地址…');
  const [displayIntent, thumbIntent] = await Promise.all([
    requestVariantUploadIntent(prepared.display, context, 'display', signal),
    requestVariantUploadIntent(prepared.thumb, context, 'thumb', signal)
  ]);

  context.onStage?.('正在并行上传高清图和列表图…');
  const displayPut = putVariantToR2(displayIntent, prepared.display, signal);
  const thumbPut = putVariantToR2(thumbIntent, prepared.thumb, signal);

  await displayPut;
  context.onStage?.('正在确认高清图…');
  const display = await confirmVariantUpload(displayIntent, prepared.display, null, signal);

  await thumbPut;
  context.onStage?.('正在确认列表图…');
  const thumb = await confirmVariantUpload(thumbIntent, prepared.thumb, display.mediaId, signal);

  recordPerf('upload-pair', {
    displayBytes: Number(prepared.display?.file?.size || 0),
    thumbBytes: Number(prepared.thumb?.file?.size || 0),
    duration: roundedDuration(startedAt),
    navigationEpoch
  });
  return { display, thumb };
};

const compressImage = async (file, options = {}) => {
  const sourceFile = await normalizeSourceImage(file);
  const imageCompression = await loadImageCompressionLibrary();
  const isThumb = options.variant === 'thumb';
  const isPlazaThumb = isThumb && options.plazaThumb === true;
  const maxSizeMB = isPlazaThumb
    ? MEDIA_PLAZA_THUMB_MAX_SIZE_MB
    : (isThumb ? MEDIA_THUMB_MAX_SIZE_MB : MEDIA_DISPLAY_MAX_SIZE_MB);
  const maxWidthOrHeight = isPlazaThumb
    ? MEDIA_PLAZA_THUMB_MAX_EDGE
    : (isThumb ? MEDIA_THUMB_MAX_EDGE : MEDIA_DISPLAY_MAX_EDGE);
  const initialQuality = isPlazaThumb
    ? MEDIA_PLAZA_THUMB_QUALITY
    : (isThumb ? MEDIA_THUMB_QUALITY : MEDIA_DISPLAY_QUALITY);
  const common = {
    maxSizeMB,
    maxWidthOrHeight,
    initialQuality,
    useWebWorker: true,
    libURL: `${location.origin}/vendor/browser-image-compression-2.0.2.js`,
    preserveExif: false,
    signal: options.signal,
    onProgress: options.onProgress
  };
  let blob = await imageCompression(sourceFile, { ...common, fileType: 'image/webp' });
  let header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (blob.type !== 'image/webp' || !bytesMatchMime(header, 'image/webp')) {
    blob = await imageCompression(sourceFile, {
      ...common,
      fileType: 'image/jpeg',
      initialQuality
    });
    header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (blob.type !== 'image/jpeg' || !bytesMatchMime(header, 'image/jpeg')) {
      throw new Error('当前浏览器无法稳定生成压缩图片，请改用JPG后重试。');
    }
  }
  if (!blob.size || blob.size > 1.5 * 1024 * 1024) throw new Error('压缩后图片仍然过大，请重新选择图片。');
  const dimensions = await imageDimensions(blob);
  if (!dimensions.width || !dimensions.height || Math.max(dimensions.width, dimensions.height) > maxWidthOrHeight) {
    throw new Error('压缩图片尺寸校验失败，请重新选择图片。');
  }
  const extension = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const finalFile = new File([blob], `${sourceFile.name.replace(/\.[^.]+$/, '')}.${extension}`, {
    type: blob.type,
    lastModified: Date.now()
  });
  const previewUrl = URL.createObjectURL(finalFile);
  mediaPreviewUrls.add(previewUrl);
  return { file: finalFile, mimeType: finalFile.type, width: dimensions.width, height: dimensions.height, previewUrl };
};

const compressImageMeasured = async (file, options = {}) => {
  const startedAt = performance.now();
  let output = null;
  try {
    output = await compressImage(file, options);
    return output;
  } finally {
    recordPerf('compress', {
      variant: options.variant || 'display',
      sourceBytes: Number(file?.size || 0),
      outputBytes: Number(output?.file?.size || 0),
      duration: roundedDuration(startedAt),
      navigationEpoch
    });
  }
};

const compressMemberCheckinImage = async (file, options = {}) => {
  const sourceFile = await normalizeSourceImage(file);
  const sourceDimensions = await imageDimensions(sourceFile);
  if (['image/jpeg', 'image/webp'].includes(sourceFile.type)
      && sourceFile.size <= MEMBER_FAST_MAX_BYTES
      && sourceDimensions.width > 0 && sourceDimensions.height > 0
      && Math.max(sourceDimensions.width, sourceDimensions.height) <= MEMBER_FAST_MAX_EDGE) {
    recordPerf('member-checkin-direct-ready', { sourceBytes: Number(sourceFile.size || 0), navigationEpoch });
    return { file: sourceFile, mimeType: sourceFile.type, width: sourceDimensions.width, height: sourceDimensions.height };
  }
  const imageCompression = await loadImageCompressionLibrary();
  const webpRounds = [
    { maxWidthOrHeight: 960, initialQuality: 0.76, maxSizeMB: 0.25 },
    { maxWidthOrHeight: 960, initialQuality: 0.70, maxSizeMB: 0.30 },
    { maxWidthOrHeight: 800, initialQuality: 0.68, maxSizeMB: 0.30 }
  ];
  let blob = null;
  let webpEncodingFailed = false;
  for (let index = 0; index < webpRounds.length; index += 1) {
    if (index > 0 && blob?.size <= MEMBER_FAST_MAX_BYTES) break;
    try {
      blob = await imageCompression(sourceFile, {
        ...webpRounds[index],
        maxIteration: 1,
        useWebWorker: true,
        libURL: `${location.origin}/vendor/browser-image-compression-2.0.2.js`,
        preserveExif: false,
        fileType: 'image/webp',
        signal: options.signal,
        onProgress: options.onProgress
      });
      const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
      if (blob.type !== 'image/webp' || !bytesMatchMime(header, 'image/webp')) {
        webpEncodingFailed = true;
        break;
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      webpEncodingFailed = true;
      break;
    }
  }

  if (webpEncodingFailed) {
    if (sourceFile.type === 'image/png') {
      throw new Error('当前浏览器无法稳定生成WebP，请将图片另存为JPG或重新截图后上传。');
    }
    blob = await imageCompression(sourceFile, {
      maxWidthOrHeight: MEMBER_FAST_MAX_EDGE,
      initialQuality: 0.76,
      maxSizeMB: 0.30,
      maxIteration: 1,
      useWebWorker: true,
      libURL: `${location.origin}/vendor/browser-image-compression-2.0.2.js`,
      preserveExif: false,
      fileType: 'image/jpeg',
      signal: options.signal,
      onProgress: options.onProgress
    });
    const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (blob.type !== 'image/jpeg' || !bytesMatchMime(header, 'image/jpeg')) {
      throw new Error('当前浏览器无法稳定处理图片，请将图片另存为JPG或重新截图后上传。');
    }
  }

  if (!blob?.size || blob.size > MEMBER_FAST_MAX_BYTES) {
    throw new Error('图片压缩后仍超过300KB，请先在相册中裁剪、截图或压缩后重新上传。');
  }
  const dimensions = await imageDimensions(blob);
  if (!dimensions.width || !dimensions.height
      || Math.max(dimensions.width, dimensions.height) > MEMBER_FAST_MAX_EDGE) {
    throw new Error('压缩图片尺寸校验失败，请重新选择图片。');
  }
  const extension = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const finalFile = new File([blob], `${sourceFile.name.replace(/\.[^.]+$/, '')}.${extension}`, {
    type: blob.type,
    lastModified: Date.now()
  });
  return {
    file: finalFile,
    mimeType: finalFile.type,
    width: dimensions.width,
    height: dimensions.height
  };
};

const createIdempotencyKey = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const uploadMemberCheckinFast = async (image, taskId, idempotencyKey, signal) => {
  const maxAttempts = 8;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response;
    try {
      response = await uploadBinary('/api/media/member-checkin-fast', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': image.mimeType,
          'X-Task-Id': taskId,
          'X-Image-Width': String(image.width),
          'X-Image-Height': String(image.height),
          'X-Idempotency-Key': idempotencyKey
        },
        body: image.file,
        signal
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (attempt === maxAttempts - 1) {
        throw new Error('图片上传失败，请检查网络后点击重试。');
      }
      const ceiling = Math.min(15_000, 1_000 * (2 ** attempt));
      await wait(Math.floor(Math.random() * (ceiling + 1)));
      continue;
    }
    if (attempt < maxAttempts - 1 && [429, 503].includes(response.status)) {
      await response.body?.cancel().catch(() => null);
      const ceiling = Math.min(15_000, 1_000 * (2 ** attempt));
      await wait(Math.floor(Math.random() * (ceiling + 1)));
      continue;
    }
    const payload = await parseApiResponse(response);
    if (!response.ok) {
      if ([500, 501, 502, 503, 504].includes(response.status)) {
        throw new Error('上传服务暂时不可用，请稍后重试。');
      }
      throw new Error(payload?.error || '图片上传失败，请点击重试。');
    }
    if (!payload?.media?.id) throw new Error('上传服务返回的数据无效，请点击重试。');
    return { ...image, mediaId: payload.media.id, repeated: Boolean(payload.repeated) };
  }
  throw new Error('上传服务暂时不可用，请稍后重试。');
};

const uploadCompressedImage = async (image, context, signal) => {
  context.onStage?.('正在申请上传地址…');
  const intent = await api('/api/media/upload-intents', {
    method: 'POST',
    body: JSON.stringify({
      taskId: context.taskId || null,
      businessType: context.businessType,
      mimeType: image.mimeType,
      fileSize: image.file.size,
      width: image.width,
      height: image.height,
      variant: context.variant || 'display'
    })
  });
  context.onStage?.('正在上传图片…');
  const uploaded = await uploadBinary(intent.uploadUrl, {
    method: 'PUT',
    headers: intent.headers,
    body: image.file,
    signal
  });
  if (!uploaded.ok) throw new Error(`图片直传失败（${uploaded.status}），请重新选择图片。`);
  context.onStage?.('正在确认图片…');
  const confirmed = await api(`/api/media/upload-intents/${encodeURIComponent(intent.intentId)}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ parentMediaId: context.parentMediaId || null })
  });
  return { ...image, mediaId: confirmed.media.id };
};

const uploadConcurrency = () => {
  const isIOS = /iP(?:hone|ad|od)/.test(navigator.userAgent);
  const embeddedBrowser = /MicroMessenger|QQ\//i.test(navigator.userAgent);
  const lowMemory = Number(navigator.deviceMemory || 8) <= 4;
  return isIOS || embeddedBrowser || lowMemory ? 1 : 2;
};

const createMediaUploadSession = (files, context = {}, ui = {}) => {
  const previewStartedAt = performance.now();
  const selected = [...files];
  if (!selected.length) throw new Error('请选择图片。');
  if (selected.length > Number(context.limit || selected.length)) throw new Error(`最多上传${context.limit}张图片。`);
  selected.forEach((file, index) => {
    if (file.size > MEDIA_MAX_SOURCE_BYTES) {
      throw new Error(`第 ${index + 1} 张图片超过5MB，请压缩或重新选择。`);
    }
  });
  const controller = new AbortController();
  const rawPreviewUrls = ui.previewContainer ? selected.map((file) => {
    const previewUrl = URL.createObjectURL(file);
    mediaPreviewUrls.add(previewUrl);
    return previewUrl;
  }) : [];
  if (ui.previewContainer) {
    renderPreviews(ui.previewContainer, rawPreviewUrls.map((previewUrl) => ({ previewUrl })));
    recordPerf('preview', {
      imageCount: selected.length,
      duration: roundedDuration(previewStartedAt),
      navigationEpoch
    });
  }
  const setStatus = (message) => {
    if (ui.statusElement) ui.statusElement.textContent = message;
    context.onStatus?.(message);
  };
  const session = {
    controller,
    selected,
    results: new Array(selected.length),
    partial: new Array(selected.length),
    errors: new Map(),
    promise: null,
    released: false,
    retryFailed: null,
    release: null
  };
  mediaUploadSessions.add(session);

  const processOne = async (index) => {
    if (session.results[index]) return;
    const position = `第 ${index + 1}/${selected.length} 张`;
    try {
      let prepared = session.partial[index]?.prepared;
      if (!prepared) {
        setStatus(`${position}：正在生成高清图和列表图 0%`);
        prepared = await prepareImageVariantsMeasured(selected[index], {
          signal: controller.signal,
          onProgress: (progress) => setStatus(`${position}：正在生成高清图和列表图 ${Math.round(Number(progress) || 0)}%`)
        });
        session.partial[index] = { prepared };
      }
      let pair = session.partial[index]?.pair;
      if (!pair) {
        pair = await uploadPreparedImagePair(prepared, {
          ...context,
          onStage: (stage) => setStatus(`${position}：${stage}`)
        }, controller.signal);
        session.partial[index] = { prepared, pair };
      }
      session.results[index] = { ...pair.display, thumbMediaId: pair.thumb.mediaId };
      session.errors.delete(index);
    } catch (error) {
      if (!controller.signal.aborted) session.errors.set(index, error);
    }
  };

  const runIndexes = async (indexes) => {
    setStatus('正在读取图片…');
    let cursor = 0;
    const worker = async () => {
      while (cursor < indexes.length && !controller.signal.aborted) {
        const index = indexes[cursor++];
        await processOne(index);
      }
    };
    const workers = Array.from(
      { length: Math.min(uploadConcurrency(), indexes.length) },
      () => worker()
    );
    await Promise.all(workers);
    if (controller.signal.aborted) throw new Error('图片上传已取消，请重新选择图片。');
    if (session.errors.size) {
      const failed = [...session.errors.keys()].map((index) => index + 1).join('、');
      throw new Error(`第 ${failed} 张图片处理失败，可单独重试失败图片。`);
    }
    setStatus('图片已就绪');
    return session.results;
  };

  session.retryFailed = () => {
    if (!session.errors.size || session.released) return session.promise;
    const indexes = [...session.errors.keys()];
    session.errors.clear();
    session.promise = runIndexes(indexes);
    return session.promise;
  };
  session.release = () => {
    if (session.released) return;
    session.released = true;
    controller.abort();
    rawPreviewUrls.forEach((url) => {
      URL.revokeObjectURL(url);
      mediaPreviewUrls.delete(url);
    });
    mediaUploadSessions.delete(session);
  };
  session.promise = runIndexes(selected.map((_, index) => index));
  return session;
};

const readFiles = async (files, context = {}) => {
  const session = createMediaUploadSession(files, context);
  try {
    return await session.promise;
  } finally {
    mediaUploadSessions.delete(session);
  }
};
const renderPreviews = (container, images) => {
  container.innerHTML = images.map((item, index) => {
    const src = typeof item === 'string' ? item : item.previewUrl || item.imageUrl;
    return `<figure><img loading="lazy" decoding="async" src="${src}" alt="待上传图片 ${index + 1}"><figcaption>第 ${index + 1} 张</figcaption></figure>`;
  }).join('');
};
window.addEventListener('pagehide', () => {
  mediaUploadSessions.forEach((session) => session.release());
  mediaPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  mediaPreviewUrls.clear();
});
const readRawFile = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('文件读取失败'));
  reader.readAsDataURL(file);
});
const downloadApiFile = async (path) => {
  const file = await api(path);
  const bytes = Uint8Array.from(atob(file.file), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.contentType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.click();
  URL.revokeObjectURL(url);
};
const downloadProtectedFile = async (path, filename) => {
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '文件下载失败');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const trackName = (trackId) =>
  tracks.find((track) => track.id === trackId)?.name || '未分配';

const statusLabel = (status) => (status === 'active' ? '启用' : '禁用');

const formatDate = (value) =>
  value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '—';

function logout() {
  void fetch('/api/logout', { method: 'POST', keepalive: true });
  clearTimeout(midnightRefreshTimer);
  midnightRefreshTimer = null;
  inflightGetRequests.clear();
  studentViewState.userId = null;
  studentViewState.data = null;
  studentViewState.renderedAt = 0;
  studentViewState.scrollY = 0;
  studentViewState.dirty = true;
  studentViewState.refreshPromise = null;
  studentViewState.refreshError = null;
  clearUserViewCaches();
  localStorage.clear();
  token = null;
  user = null;
  login();
}

function login() {
  window.location.replace('/entrance.html');
}

const validStudentDashboard = (dashboard) =>
  dashboard?.version === 1
  && dashboard.user?.id
  && Array.isArray(dashboard.tasks)
  && Array.isArray(dashboard.materialTasks);

const rememberStudentDashboard = (dashboard) => {
  if (studentViewState.userId && studentViewState.userId !== dashboard.user.id) {
    studentViewState.data = null;
    studentViewState.scrollY = 0;
  }
  studentViewState.userId = dashboard.user.id;
  studentViewState.data = dashboard;
  studentViewState.renderedAt = Date.now();
  studentViewState.dirty = false;
  studentViewState.refreshError = null;
  studentDashboardDirty = false;
};

const patchStudentTask = (taskId, updater) => {
  if (!studentViewState.data?.tasks) return;
  studentViewState.data.tasks = studentViewState.data.tasks.map(
    (task) => (task.id === taskId ? updater({ ...task }) : task)
  );
  studentViewState.renderedAt = Date.now();
};

const patchStudentMaterialTask = (taskId, updater) => {
  if (!studentViewState.data?.materialTasks) return;
  studentViewState.data.materialTasks = studentViewState.data.materialTasks.map(
    (task) => (task.id === taskId ? updater({ ...task }) : task)
  );
  studentViewState.renderedAt = Date.now();
};

const returnToCachedStudentHome = (successMessage, options = {}) => {
  const restoreStartedAt = performance.now();
  if (!studentViewState.data || user?.role !== 'student') {
    showToast(successMessage);
    void home({ forceRefresh: true });
    return;
  }
  studentViewState.refreshError = null;
  studentViewState.scrollY = Math.max(0, Number(options.scrollY || 0));
  const pageEpoch = beginNavigation();
  void student(studentViewState.data, pageEpoch, { restoreScroll: true });
  recordPerf('home-restore', {
    cached: true,
    duration: roundedDuration(restoreStartedAt),
    navigationEpoch: pageEpoch
  });
  showToast(successMessage);
  void refreshStudentDashboard(pageEpoch, true).then(() => {
    if (studentViewState.refreshError && isCurrentNavigation(pageEpoch)) {
      showToast('提交成功，但最新数据刷新失败，可稍后重新进入查看。', 'warning', 4000);
    }
  });
};

const refreshStudentDashboard = (pageEpoch, restoreScroll = true) => {
  if (studentViewState.refreshPromise) {
    return studentViewState.refreshPromise.then((dashboard) => {
      if (isCurrentNavigation(pageEpoch)) student(dashboard, pageEpoch, { restoreScroll });
      return dashboard;
    });
  }
  const expectedUserId = user?.id;
  studentViewState.refreshPromise = api('/api/student-dashboard')
    .then((dashboard) => {
      if (!validStudentDashboard(dashboard) || dashboard.user.id !== expectedUserId) {
        throw new Error('首页数据版本不兼容，请刷新后重试。');
      }
      rememberStudentDashboard(dashboard);
      if (isCurrentNavigation(pageEpoch)) student(dashboard, pageEpoch, { restoreScroll });
      return dashboard;
    })
    .catch((error) => {
      studentViewState.refreshError = error;
      if (!studentViewState.data) throw error;
      return studentViewState.data;
    })
    .finally(() => {
      studentViewState.refreshPromise = null;
    });
  return studentViewState.refreshPromise;
};

async function home(options = {}) {
  const pageEpoch = beginNavigation();
  document.body.classList.remove('poster-mode');
  const forceRefresh = Boolean(options.forceRefresh);
  const restoreScroll = options.restoreScroll !== false;
  if (user?.role === 'student') {
    if (forceRefresh) studentViewState.dirty = true;
    if (studentViewState.userId && studentViewState.userId !== user.id) {
      studentViewState.userId = null;
      studentViewState.data = null;
      studentViewState.scrollY = 0;
      studentViewState.dirty = true;
    }
    const bootstrapDashboard = window.__BOOTSTRAP_DASHBOARD__;
    if (!studentViewState.data && validStudentDashboard(bootstrapDashboard)
        && bootstrapDashboard.user.id === user.id) {
      rememberStudentDashboard(bootstrapDashboard);
      window.__BOOTSTRAP_DASHBOARD__ = null;
      return student(bootstrapDashboard, pageEpoch, { restoreScroll: false });
    }
    if (studentViewState.data && studentViewState.userId === user.id) {
      student(studentViewState.data, pageEpoch, { restoreScroll });
      void refreshStudentDashboard(pageEpoch, restoreScroll);
      return;
    }
    if (options.showShell !== false) {
      app.innerHTML = '<main class="app-shell-placeholder" aria-busy="true"><header class="student-hero"></header><section class="student-user-card"></section><section class="card"></section></main>';
    }
    await refreshStudentDashboard(pageEpoch, restoreScroll);
    return;
  }

  if (options.showShell !== false) {
    app.innerHTML = '<main class="app-shell-placeholder" aria-busy="true"><header class="hero"></header><section class="card"></section><section class="card"></section></main>';
  }
  const result = await api('/api/me');
  if (!isCurrentNavigation(pageEpoch)) return;
  config = result.config;
  tracks = result.tracks;
  user = result.user;
  localStorage.user = JSON.stringify(user);
  return loadAdminClient(undefined, pageEpoch);
}

async function student(dashboard, pageEpoch = beginNavigation(), options = {}) {
  const renderStartedAt = performance.now();
  if (!isCurrentNavigation(pageEpoch)) return;
  document.body.dataset.view = 'student';
  config = dashboard.config;
  tracks = dashboard.tracks;
  user = dashboard.user;
  try { localStorage.user = JSON.stringify(user); } catch {}
  /* STRICT_P95_APP_PREFETCH_V4 */
  /* MOBILE_REAL_UNDER_1S_V5 */
  const startPlazaPrefetch = () => { void prefetchStudentPlaza(); };
  // Start the lightweight Plaza request alongside home rendering so an immediate tap reuses it.
  void startPlazaPrefetch();
  setTimeout(() => {
    const memberUploadWarmup = () => { void loadImageCompressionLibrary().catch(() => {}); };
    if ('requestIdleCallback' in window) requestIdleCallback(memberUploadWarmup, { timeout: 700 });
    else memberUploadWarmup();
  }, 1100);
  const isInteraction = user.trackId === 'interaction';
  const teamListResult = dashboard.teamSummary;
  const myTeam = dashboard.teamSummary?.team;
  const taskResult = { tasks: dashboard.tasks };
  const checkinStats = dashboard.checkinStats || { personalDays: 0, teamDays: 0 };
  const materialResult = { tasks: dashboard.materialTasks };
  const completedTasks = taskResult.tasks.filter((task) =>
    ['submitted', 'approved'].includes(task.submission?.status) || task.memberCheckin
  ).length;
  const taskProgress = taskResult.tasks.length
    ? Math.round((completedTasks / taskResult.tasks.length) * 100)
    : 0;
  const avatarText = [...String(user.name || '同学')].slice(-2).join('');
  app.innerHTML = `
    <header class="student-hero">
      <div class="student-hero-copy">
        <span>20TH ANNIVERSARY</span>
        <h1>廿载同心，青春同行</h1>
        <p>${escapeHtml(config.activityName)}</p>
      </div>
      <button class="student-logout" id="out">退出</button>
    </header>
    <section class="student-user-card">
      <div class="student-avatar" aria-hidden="true">${escapeHtml(avatarText)}</div>
      <div class="student-user-copy"><span>欢迎回来</span><h2>${escapeHtml(user.name)}</h2><p>${escapeHtml(trackName(user.trackId))} · ${escapeHtml(user.campus)}</p></div>
      <div class="student-progress student-checkin-total"><strong>${Number(checkinStats.personalDays || 0)}天</strong><span>个人累计打卡</span></div>
    </section>
    <nav class="student-shortcuts student-shortcuts-compact student-shortcuts-four" aria-label="常用功能">
      <button id="historyCheckins"><span>✓</span><strong>个人累计</strong><small>${Number(checkinStats.personalDays || 0)}天 · 查看</small></button>
      <button id="plaza"><span>▦</span><strong>活动广场</strong><small>查看作品</small></button>
      <button id="inbox"><span>✉</span><strong>信息箱</strong><small>通知评论</small></button>
      <button id="teamCheckinStats"><span>◇</span><strong>队伍累计</strong><small>${dashboard.teamSummary?.team ? `${Number(checkinStats.teamDays || 0)}天 · 查看` : '未加入'}</small></button>
    </nav>
    <div class="student-top-actions">
      <button class="secondary" id="ranking">查看排行榜</button>
    </div>
    <section class="card profile-card">
      <h2>我的资料</h2>
      <details class="profile-details">
      <summary>查看完整身份资料</summary>
      <div class="profile-grid">
        <div><span>姓名</span><strong>${escapeHtml(user.name)}</strong></div>
        <div><span>学号</span><strong>${escapeHtml(user.studentId)}</strong></div>
        <div><span>校区</span><strong>${escapeHtml(user.campus)}</strong></div>
        <div><span>所属赛道</span><strong>${escapeHtml(trackName(user.trackId))}</strong></div>
        <div><span>账号状态</span><strong>${escapeHtml(statusLabel(user.status))}</strong></div>
        <div><span>创建时间</span><strong>${escapeHtml(formatDate(user.createdAt))}</strong></div>
      </div>
      <p class="muted">关键身份资料仅可由管理员维护，如有错误请联系活动工作人员。</p>
      </details>
    </section>
    ${isInteraction ? `
      <section class="card" id="myTeam">
        <div class="row"><h2>我的队伍</h2><span class="right muted">${teamListResult.teamCount}/${teamListResult.maxTeams} 个队伍</span></div>
        ${myTeam ? `
          <div class="team-summary">
            <div><span>队伍名称</span><strong>${escapeHtml(myTeam.name)}</strong></div>
            <div><span>邀请码</span><strong class="invite-code">${escapeHtml(myTeam.inviteCode)}</strong></div>
            <div><span>成员人数</span><strong>${myTeam.memberCount}/${myTeam.memberLimit}</strong></div>
          </div>
          <h3>队伍成员</h3>
          <div class="member-list">${myTeam.members.map((member) => `<span>${escapeHtml(member.name)}（${escapeHtml(member.campus)}）</span>`).join('')}</div>
        ` : `
          <p class="muted">你尚未被编入队伍。队伍由管理员统一导入和调整，请联系活动管理员。</p>`}
      </section>
      ` : ''}
    <div id="modalRoot"></div>`;
  const mealNames = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };
  const submissionNames = { draft: '草稿', submitted: '已提交', returned: '退回', approved: '通过' };
  const taskCards = taskResult.tasks.map((task) => `
    <article class="slot activity-task-card">
      <span class="task-kicker">${isInteraction ? '团队活动' : '个人活动'}</span>
      <div class="row"><h2>${escapeHtml(task.name)}</h2><span class="pill ${task.submission?.status === 'approved' ? 'done' : 'pending'}">${submissionNames[task.submission?.status] || '未提交'}</span></div>
      <p>${escapeHtml(task.description)}</p>
      <p class="task-requirement">${task.scheduleType === 'activityDays' ? `${escapeHtml(task.occurrenceDate)} 当天 ${task.dailyStart}–${task.dailyEnd} · 活动第 ${task.refreshDays.join('、')} 天自动刷新` : task.scheduleType === 'weekly' ? `${escapeHtml(task.occurrenceDate)} 当天 ${task.dailyStart}–${task.dailyEnd} · 周${task.weekdays.join('、周')}自动刷新` : `${formatDate(task.startAt)} 至 ${formatDate(task.endAt)}`} · ${isInteraction ? `个人最多 ${task.memberImageLimit || task.imageLimit} 张 · 队伍汇总最多 ${task.imageLimit} 张` : `最多 ${task.imageLimit} 张图`} · ${task.allowLate ? '允许补交' : '不允许补交'}</p>
      ${task.copyRequirement ? `<div class="notice">文案要求：${escapeHtml(task.copyRequirement)}</div>` : ''}
      ${task.submission?.reviewNote ? `<p class="bad">审核意见：${escapeHtml(task.submission.reviewNote)}</p>` : ''}
      ${isInteraction ? `
        <div class="team-progress">
          <div class="row"><strong>队伍个人打卡</strong><span class="right">${task.teamProgress?.completed || 0}/${task.teamProgress?.total || 0}</span></div>
          <div class="member-list compact">${(task.teamProgress?.members || []).map((member) => `<span class="${member.checked ? 'checked-member' : ''}">${escapeHtml(member.name)} · ${escapeHtml(member.studentId)} ${member.checked ? '✓ 已打卡' : '未打卡'}</span>`).join('')}</div>
        </div>
        <button data-member-task="${task.id}" ${task.availabilityError ? 'disabled' : ''}>${task.memberCheckin ? '更新个人打卡' : '个人打卡'}</button>
        ${task.isCaptain ? `<button class="secondary" data-task="${task.id}" ${task.availabilityError || Number(task.teamProgress?.total || 0) === 0 || Number(task.teamProgress?.completed || 0) < Number(task.teamProgress?.total || 0) || ['submitted','approved'].includes(task.submission?.status) ? 'disabled' : ''}>${task.submission ? '继续编辑队伍作品' : '队长汇总提交'}</button>${Number(task.teamProgress?.total || 0) > 0 && Number(task.teamProgress?.completed || 0) < Number(task.teamProgress?.total || 0) ? '<p class="bad">所有队员完成当天个人打卡后，队长才能汇总提交。</p>' : ''}` : '<p class="muted">队伍作品由管理员指定的队长汇总提交。</p>'}
      ` : `<button data-task="${task.id}" ${task.availabilityError || ['submitted','approved'].includes(task.submission?.status) ? 'disabled' : ''}>${task.submission ? '继续编辑' : '个人打卡'}</button>`}
      ${task.availabilityError ? `<p class="bad">${escapeHtml(task.availabilityError)}</p>` : ''}
    </article>`).join('');
  app.insertAdjacentHTML('beforeend', `
    <section class="card" id="activityTasks"><div class="row"><h2>今日打卡</h2><span class="right muted">${isInteraction ? '个人打卡后由队长汇总' : '个人提交'}</span></div>
      <div class="grid">${taskCards || '<p class="muted">当前没有已发布任务</p>'}</div>
    </section>
    `);
  const materialStatus = { submitted: '已提交', returned: '退回修改' };
  app.insertAdjacentHTML('beforeend', `<section class="card"><div class="row"><h2>最终截图证明</h2><span class="right muted">最多 8 张 · 压缩后单张不超过 5MB</span></div>
    <div class="grid">${materialResult.tasks.map((task) => `<article class="slot">
      <div class="row"><h2>${escapeHtml(task.title)}</h2><span class="pill ${task.submission?.status === 'submitted' ? 'done' : 'pending'}">${materialStatus[task.submission?.status] || '未提交'}</span></div>
      <p>${escapeHtml(task.description)}</p><p class="muted">截止：${formatDate(task.deadline)} · 个人提交 · ${task.fileTypes.map((type) => `.${escapeHtml(type)}`).join('、')} · 最多 ${task.fileLimit} 张</p>
      ${task.submission?.reviewNote ? `<p class="bad">退回原因：${escapeHtml(task.submission.reviewNote)}</p>` : ''}
      ${task.submission?.files?.length ? `<div>${task.submission.files.map((file) => `<button class="secondary material-download" data-url="${file.downloadUrl}" data-name="${escapeHtml(file.originalName)}">${escapeHtml(file.originalName)}</button>`).join(' ')}</div>` : ''}
      <button data-material="${task.id}" ${task.submission?.status === 'submitted' ? 'disabled' : ''}>${task.submission?.status === 'returned' ? '修改并重新提交' : '提交材料'}</button>
    </article>`).join('') || '<p class="muted">暂无材料任务</p>'}</div></section>`);
  prepareDynamicContent(app);
  recordPerf('page-render', {
    page: 'student-home',
    duration: roundedDuration(renderStartedAt),
    navigationEpoch: pageEpoch
  });
  document.querySelector('#out').onclick = logout;
  document.querySelector('#historyCheckins').onclick = () => { startPhotoFlow('history'); openStudentCheckinHistory(); };
  document.querySelector('#ranking').onclick = () => rankings();
  document.querySelector('#plaza').onclick = () => { startPhotoFlow('plaza'); plaza(); };
  document.querySelector('#inbox').onclick = () => inbox();
  document.querySelector('#teamCheckinStats').onclick = () => void openTeamCheckinHistory();
  if (document.querySelector('#createAdmin')) {
    document.querySelector('#createAdmin').onsubmit = async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.target));
      try {
        await api('/api/admin/admins', { method: 'POST', body: JSON.stringify(values) });
        alert('管理员账号已创建');
        admin(date);
      } catch (error) { alert(error.message); }
    };
  }
  document.querySelectorAll('.reject-admin-action').forEach((button) => {
    button.onclick = async () => {
      if (!await askConfirm('是否驳回该管理员操作？', '补卡记录将被撤销；审核结果将恢复为待审核状态。')) return;
      try {
        await api(`/api/admin/governance/${button.dataset.id}/reject`, {
          method: 'POST',
          body: JSON.stringify({ note: '最高管理员驳回' })
        });
        alert('该管理员操作已驳回');
        admin(date);
      } catch (error) { alert(error.message); }
    };
  });
  document.querySelectorAll('[data-jump]').forEach((button) => {
    button.onclick = () => document.querySelector(`#${button.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.querySelectorAll('[data-task]').forEach((button) => {
    button.onclick = () => taskSubmissionForm(taskResult.tasks.find((task) => task.id === button.dataset.task));
  });
  document.querySelectorAll('[data-member-task]').forEach((button) => {
    button.onclick = () => memberCheckinForm(taskResult.tasks.find((task) => task.id === button.dataset.memberTask));
  });
}

function openStudentCheckinHistory() {
  let root = document.querySelector('#modalRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'modalRoot';
    app.append(root);
  }
  let page = 1;
  let loading = false;
  root.innerHTML = `<div class="drawer-backdrop" id="historyDrawerBackdrop">
    <section class="bottom-drawer history-drawer" role="dialog" aria-modal="true" aria-labelledby="historyDrawerTitle">
      <div class="drawer-handle" aria-hidden="true"></div>
      <div class="drawer-sticky-header row">
        <div><small class="muted">我的记录</small><h2 id="historyDrawerTitle">个人累计打卡</h2></div>
        <button class="secondary right" id="closeHistoryDrawer">关闭</button>
      </div>
      <div id="studentHistoryList"><p class="muted">正在读取个人打卡记录…</p></div>
      <button class="secondary full-width" id="moreStudentHistory" hidden>加载更多</button>
    </section>
  </div>`;
  const list = root.querySelector('#studentHistoryList');
  const more = root.querySelector('#moreStudentHistory');
  const close = () => { root.innerHTML = ''; };
  root.querySelector('#closeHistoryDrawer').onclick = close;
  root.querySelector('#historyDrawerBackdrop').onclick = (event) => {
    if (event.target.id === 'historyDrawerBackdrop') close();
  };
  const renderRecord = (record) => {
    const title = record.taskName || config.slots.find((slot) => slot.id === record.slotId)?.label || '打卡';
    const status = {
      pending: '待审核', submitted: '已提交', approved: '已通过',
      rejected: '已退回', returned: '退回修改'
    }[record.status] || record.status;
    const images = (record.images || []).map((media, index) => {
      const thumbUrl = typeof media === 'string' ? media : media.thumbUrl || media.imageUrl;
      const displayUrl = typeof media === 'string' ? media : media.displayUrl || thumbUrl;
      return `<button class="image-viewer-trigger" data-image-viewer="${escapeHtml(thumbUrl)}"
        data-image-thumb="${escapeHtml(thumbUrl)}" data-image-display="${escapeHtml(displayUrl)}"
        data-image-alt="${escapeHtml(title)}图片">
        <span class="image-shell"><img data-perf-image="history-thumb" data-priority="${index ? 'low' : 'high'}"
          data-src="${escapeHtml(thumbUrl)}" loading="${index ? 'lazy' : 'eager'}" width="720" height="540"
          fetchpriority="${index ? 'low' : 'high'}" decoding="async" alt="${escapeHtml(title)}图片"
          onload="this.parentElement.classList.add('loaded')"
          onerror="this.hidden=true;this.parentElement.classList.add('failed')">
          <span class="image-error">图片加载失败，点击重试</span></span></button>`;
    }).join('');
    return `<article class="history-checkin-card">
      <div class="row"><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(record.date)}</small></div>
        <span class="pill ${record.status === 'approved' ? 'done' : 'pending'}">${escapeHtml(status)}</span></div>
      <p class="muted">${escapeHtml(formatDate(record.submittedAt))}</p>
      ${images ? `<div class="drawer-photo-grid compact">${images}</div>` : ''}
      ${record.note ? `<p>${escapeHtml(record.note)}</p>` : ''}
      ${record.reviewNote ? `<p class="bad">审核说明：${escapeHtml(record.reviewNote)}</p>` : ''}
    </article>`;
  };
  const load = async () => {
    if (loading) return;
    loading = true;
    more.disabled = true;
    try {
      const result = await api(`/api/checkins/history?page=${page}&limit=20`);
      if (page === 1) list.innerHTML = '';
      const records = Array.isArray(result.records) ? result.records : [];
      list.insertAdjacentHTML('beforeend', records.map(renderRecord).join(''));
      if (!records.length && page === 1) list.innerHTML = '<p class="muted">暂无历史打卡记录</p>';
      const loaded = Math.min(result.total, page * result.limit);
      prepareDynamicContent(list);
      more.hidden = loaded >= result.total;
      more.textContent = `加载更多（${loaded}/${result.total}）`;
      page += 1;
    } catch (error) {
      if (page === 1) list.innerHTML = `<p class="bad">${escapeHtml(error.message)}</p>`;
      more.hidden = false;
      more.textContent = '读取失败，点击重试';
    } finally {
      loading = false;
      more.disabled = false;
    }
  };
  more.onclick = load;
  void load();
}

function openTeamCheckinHistory() {
  const root = document.querySelector('#modalRoot');
  if (!root) return;
  let page = 1;
  let loading = false;
  root.innerHTML = `<div class="drawer-backdrop" id="teamHistoryDrawerBackdrop">
    <section class="bottom-drawer history-drawer" role="dialog" aria-modal="true" aria-labelledby="teamHistoryDrawerTitle">
      <div class="drawer-handle" aria-hidden="true"></div>
      <div class="drawer-sticky-header row">
        <div><small class="muted">队伍记录</small><h2 id="teamHistoryDrawerTitle">队伍累计打卡</h2></div>
        <button class="secondary right" id="closeTeamHistoryDrawer">关闭</button>
      </div>
      <div id="teamHistoryList"><p class="muted">正在读取队伍打卡记录…</p></div>
      <button class="secondary full-width" id="moreTeamHistory" hidden>加载更多</button>
    </section>
  </div>`;
  const list = root.querySelector('#teamHistoryList');
  const more = root.querySelector('#moreTeamHistory');
  const close = () => { root.innerHTML = ''; };
  root.querySelector('#closeTeamHistoryDrawer').onclick = close;
  root.querySelector('#teamHistoryDrawerBackdrop').onclick = (event) => {
    if (event.target.id === 'teamHistoryDrawerBackdrop') close();
  };

  const renderRecord = (record) => {
    const images = (record.images || []).map((media, index) => {
      const thumbUrl = media.thumbUrl || media.imageUrl || media.displayUrl || '';
      const displayUrl = media.displayUrl || thumbUrl;
      return `<button class="image-viewer-trigger" data-image-viewer="${escapeHtml(thumbUrl)}"
        data-image-thumb="${escapeHtml(thumbUrl)}" data-image-display="${escapeHtml(displayUrl)}"
        data-image-alt="${escapeHtml(record.taskName || '队伍打卡')}图片">
        <span class="image-shell"><img data-perf-image="history-thumb" data-priority="${index ? 'low' : 'high'}"
          data-src="${escapeHtml(thumbUrl)}" loading="${index ? 'lazy' : 'eager'}" width="720" height="540"
          fetchpriority="${index ? 'low' : 'high'}" decoding="async" alt="${escapeHtml(record.taskName || '队伍打卡')}图片"
          onload="this.parentElement.classList.add('loaded')"
          onerror="this.hidden=true;this.parentElement.classList.add('failed')">
          <span class="image-error">图片加载失败，点击重试</span></span></button>`;
    }).join('');
    const members = (record.teamProgress?.members || []).map((member) =>
      `<span class="${member.checked ? 'checked-member' : ''}">${escapeHtml(member.name)} ${member.checked ? '✓' : '未完成'}</span>`
    ).join('');
    return `<article class="history-checkin-card">
      <div class="row"><div><strong>${escapeHtml(record.taskName || '队伍打卡')}</strong><small>${escapeHtml(record.date || '')}</small></div>
        <span class="pill done">已提交</span></div>
      <p class="muted">${escapeHtml(formatDate(record.submittedAt))}</p>
      <div class="team-progress compact"><div class="row"><strong>成员完成情况</strong><span class="right">${Number(record.teamProgress?.completed || 0)}/${Number(record.teamProgress?.total || 0)}</span></div>
        <div class="member-list compact">${members || '<span>暂无成员数据</span>'}</div></div>
      ${images ? `<div class="drawer-photo-grid compact">${images}</div>` : ''}
      ${record.copy ? `<p>${escapeHtml(record.copy)}</p>` : ''}
    </article>`;
  };

  const load = async () => {
    if (loading) return;
    loading = true;
    more.disabled = true;
    try {
      const result = await api(`/api/team-checkins/history?page=${page}&limit=20`);
      if (page === 1) list.innerHTML = '';
      list.insertAdjacentHTML('beforeend', (result.records || []).map(renderRecord).join(''));
      if (!(result.records || []).length && page === 1) list.innerHTML = '<p class="muted">暂无队伍打卡记录</p>';
      const loaded = Math.min(Number(result.total || 0), page * Number(result.limit || 20));
      prepareDynamicContent(list);
      more.hidden = loaded >= Number(result.total || 0);
      more.textContent = `加载更多（${loaded}/${Number(result.total || 0)}）`;
      page += 1;
    } catch (error) {
      if (page === 1) list.innerHTML = `<p class="bad">${escapeHtml(error.message)}</p>`;
      more.hidden = false;
      more.textContent = '读取失败，点击重试';
    } finally {
      loading = false;
      more.disabled = false;
    }
  };
  more.onclick = load;
  void load();
}

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

function materialSubmissionForm(task) {
  beginNavigation();
  void loadImageCompressionLibrary().catch(() => {});
  const current = task.submission;
  app.innerHTML = `<header class="hero"><h1>${escapeHtml(task.title)}</h1><p>${escapeHtml(task.description)}</p></header>
    <section class="card"><form id="materialSend">
      <div class="notice">浏览器会自动压缩图片，最多 ${task.fileLimit} 张，压缩后单张最大 5MB。</div>
      <label>上传最终截图</label><input name="files" type="file" multiple accept="image/jpeg,image/png,image/webp">
      <div class="image-preview" id="materialPreview"></div>
      <div class="row"><p class="muted upload-status" id="materialUploadStatus" aria-live="polite">选择图片后会立即预览并在后台上传。</p>
        <button type="button" class="secondary" id="retryMaterialUpload" hidden>重试失败图片</button></div>
      <label>文字总结${task.summaryRequired ? '（必填）' : '（选填）'}</label><textarea name="summary">${escapeHtml(current?.summary || '')}</textarea>
      <div class="row"><button type="button" class="secondary" id="backMaterial">返回</button><button>提交材料</button></div>
    </form></section>`;
  const materialForm = document.querySelector('#materialSend');
  const materialStatus = document.querySelector('#materialUploadStatus');
  const materialRetry = document.querySelector('#retryMaterialUpload');
  let mediaSession = null;
  document.querySelector('#backMaterial').onclick = () => {
    mediaSession?.release();
    home();
  };
  materialRetry.onclick = () => {
    if (!mediaSession?.errors.size) return;
    materialRetry.hidden = true;
    void mediaSession.retryFailed().catch((error) => {
      materialStatus.textContent = error.message;
      materialRetry.hidden = false;
    });
  };
  materialForm.files.onchange = () => {
    mediaSession?.release();
    mediaSession = null;
    materialRetry.hidden = true;
    try {
      if (materialForm.files.files.length > task.fileLimit) throw new Error(`最多上传 ${task.fileLimit} 张图片`);
      mediaSession = createMediaUploadSession(materialForm.files.files, {
        taskId: task.id, businessType: 'material-image', limit: task.fileLimit
      }, {
        previewContainer: document.querySelector('#materialPreview'),
        statusElement: materialStatus
      });
      const currentSession = mediaSession;
      void currentSession.promise.catch((error) => {
        if (currentSession !== mediaSession) return;
        materialStatus.textContent = error.message;
        materialRetry.hidden = !currentSession.errors.size;
      });
    } catch (error) {
      void openDialog({ title: '图片处理失败', message: error.message, confirmText: '重新选择' });
      materialForm.files.value = '';
      materialStatus.textContent = error.message;
    }
  };
  document.querySelector('#materialSend').onsubmit = async (event) => {
    event.preventDefault();
    const submitButton = event.submitter || event.target.querySelector('button:not([type="button"])');
    const restoreButton = beginButtonLoading(submitButton, '正在提交…');
    try {
      const selected = [...event.target.files.files];
      if (selected.length > task.fileLimit) throw new Error(`最多上传 ${task.fileLimit} 个文件`);
      const images = selected.length ? await mediaSession?.promise : [];
      if (selected.length && (!images || images.length !== selected.length)) {
        throw new Error('图片尚未全部就绪，请重试失败图片。');
      }
      const files = images.map((item, index) => ({ name: selected[index].name, mediaId: item.mediaId }));
      const result = await api(`/api/material-tasks/${task.id}/submission`, {
        method: 'PUT',
        body: JSON.stringify({
          version: current?.version || 0,
          files,
          summary: event.target.summary.value
        })
      });
      patchStudentMaterialTask(task.id, (cachedTask) => ({
        ...cachedTask,
        submission: {
          ...(cachedTask.submission || {}),
          id: result.id,
          status: 'submitted',
          version: Number(cachedTask.submission?.version || 0) + 1,
          summary: event.target.summary.value,
          submittedAt: new Date().toISOString(),
          files: files.map((file) => ({
            id: file.mediaId,
            name: file.name,
            originalName: file.name,
            url: `/api/material-files/${file.mediaId}`,
            downloadUrl: `/api/material-files/${file.mediaId}`
          }))
        }
      }));
      mediaSession?.release();
      mediaSession = null;
      returnToCachedStudentHome('材料提交成功');
    } catch (error) {
      restoreButton();
      alert(error.message);
    }
  };
}

function taskSubmissionForm(task) {
  beginNavigation();
  void loadImageCompressionLibrary().catch(() => {});
  const current = task.submission;
  app.innerHTML = `
    <header class="hero"><h1>${escapeHtml(task.name)}</h1><p>${escapeHtml(task.description)}</p></header>
    <section class="card"><form id="taskSend">
      <div class="notice">上传前浏览器会自动压缩图片。支持 JPG、PNG、WebP，原图单张不超过 5MB，最多 ${task.imageLimit} 张。</div>
      <label>活动图片</label><input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple>
      <div class="image-preview" id="taskPreview">${(current?.images || []).map((image) => {
        const thumbUrl = image.thumbUrl || image.imageUrl || image.displayUrl || '';
        const displayUrl = image.displayUrl || thumbUrl;
        return `<button type="button" class="image-viewer-trigger" data-image-viewer="${escapeHtml(thumbUrl)}" data-image-thumb="${escapeHtml(thumbUrl)}" data-image-display="${escapeHtml(displayUrl)}" data-image-alt="已保存队伍作品"><span class="image-shell"><img src="${escapeHtml(thumbUrl)}" width="720" height="540" loading="eager" decoding="async" alt="已保存队伍作品"></span></button>`;
      }).join('')}</div>
      <div class="row"><p class="muted upload-status" id="taskUploadStatus" aria-live="polite">选择图片后会立即预览并在后台上传。</p>
        <button type="button" class="secondary" id="retryTaskUpload" hidden>重试失败图片</button></div>
      ${user.trackId === 'health' ? `<label>餐次</label><select name="mealType" required><option value="">请选择</option><option value="breakfast" ${current?.mealType === 'breakfast' ? 'selected' : ''}>早餐</option><option value="lunch" ${current?.mealType === 'lunch' ? 'selected' : ''}>午餐</option><option value="dinner" ${current?.mealType === 'dinner' ? 'selected' : ''}>晚餐</option></select>` : ''}
      <label>活动文案${task.copyRequirement ? '（必填）' : '（选填）'}</label><textarea name="copy">${escapeHtml(current?.copy || '')}</textarea>
      ${user.trackId === 'interaction' ? `<label class="check-label"><input name="isPublic" type="checkbox" ${current?.isPublic ? 'checked' : ''}> 同意发布至活动广场</label>` : ''}
      <div class="row"><button type="button" class="secondary" id="back">返回</button><button type="button" class="secondary" data-intent="draft">保存草稿</button><button data-intent="submit">最终提交</button></div>
    </form></section>`;
  const form = document.querySelector('#taskSend');
  prepareDynamicContent(app);
  const taskStatus = document.querySelector('#taskUploadStatus');
  const taskRetry = document.querySelector('#retryTaskUpload');
  let mediaSession = null;
  document.querySelector('#back').onclick = () => {
    mediaSession?.release();
    home();
  };
  taskRetry.onclick = () => {
    if (!mediaSession?.errors.size) return;
    taskRetry.hidden = true;
    void mediaSession.retryFailed().catch((error) => {
      taskStatus.textContent = error.message;
      taskRetry.hidden = false;
    });
  };
  form.images.onchange = () => {
    mediaSession?.release();
    mediaSession = null;
    taskRetry.hidden = true;
    try {
      if (form.images.files.length > task.imageLimit) throw new Error(`最多上传 ${task.imageLimit} 张图片`);
      mediaSession = createMediaUploadSession(form.images.files, {
        taskId: task.id, businessType: 'task', limit: task.imageLimit
      }, {
        previewContainer: document.querySelector('#taskPreview'),
        statusElement: taskStatus
      });
      const currentSession = mediaSession;
      void currentSession.promise.catch((error) => {
        if (currentSession !== mediaSession) return;
        taskStatus.textContent = error.message;
        taskRetry.hidden = !currentSession.errors.size;
      });
    } catch (error) {
      void openDialog({ title: '图片处理失败', message: error.message, confirmText: '重新选择' });
      form.images.value = '';
      taskStatus.textContent = error.message;
    }
  };
  form.querySelectorAll('[data-intent]').forEach((button) => {
    button.onclick = async (event) => {
      event.preventDefault();
      if (form.dataset.submitting === 'true') return;
      form.dataset.submitting = 'true';
      const restoreButton = beginButtonLoading(
        button,
        button.dataset.intent === 'draft' ? '正在保存…' : '正在提交…'
      );
      const siblingButtons = [...form.querySelectorAll('[data-intent]')].filter((item) => item !== button);
      siblingButtons.forEach((item) => { item.disabled = true; });
      try {
        if (form.images.files.length > task.imageLimit) throw new Error(`最多上传 ${task.imageLimit} 张图片`);
        const media = form.images.files.length ? await mediaSession?.promise : [];
        if (form.images.files.length && (!media || media.length !== form.images.files.length)) {
          throw new Error('图片尚未全部就绪，请重试失败图片。');
        }
        const result = await api(`/api/tasks/${task.id}/submission`, {
          method: 'PUT',
          body: JSON.stringify({
            intent: button.dataset.intent,
            version: current?.version || 0,
            occurrenceDate: task.occurrenceDate,
            mediaIds: media.map((item) => item.mediaId),
            copy: form.copy.value,
            plazaCopy: form.copy.value,
            mealType: form.mealType?.value,
            isPublic: Boolean(form.isPublic?.checked)
          })
        });
        patchStudentTask(task.id, (cachedTask) => ({
          ...cachedTask,
          submission: {
            ...(cachedTask.submission || {}),
            ...result.submission,
            copy: form.copy.value,
            plazaCopy: form.copy.value,
            mealType: form.mealType?.value || '',
            isPublic: Boolean(form.isPublic?.checked),
            occurrenceDate: task.occurrenceDate,
            submittedAt: result.submission.status === 'draft'
              ? cachedTask.submission?.submittedAt || null
              : new Date().toISOString()
          }
        }));
        if (result.submission.status !== 'draft' && form.isPublic?.checked) {
          plazaViewCache.clear();
          rankingViewCache.clear();
        }
        mediaSession?.release();
        mediaSession = null;
        returnToCachedStudentHome(
          result.submission.status === 'draft' ? '草稿已保存' : '最终提交成功'
        );
      } catch (error) {
        restoreButton();
        siblingButtons.forEach((item) => { item.disabled = false; });
        form.dataset.submitting = 'false';
        alert(error.message);
      }
    };
  });
}

async function inbox(page = 1) {
  const pageEpoch = beginNavigation();
  const result = await api(`/api/inbox?page=${page}&limit=20`);
  if (!isCurrentNavigation(pageEpoch)) return;
  app.innerHTML = `
    <header class="hero"><div class="row"><div><h1>个人信息箱</h1><p>评论提醒、系统通知和管理员通知</p></div><button class="secondary right" id="backInbox">返回</button></div></header>
    <section class="card"><div class="row"><h2>消息</h2><span class="pill ${result.unread ? 'pending' : 'done'}">未读 ${result.unread}</span><button class="secondary right" id="readAll">全部已读</button></div>
      <div class="notification-list">${result.notifications.map((notice) => `
        <button class="notification-item ${notice.isRead ? '' : 'unread'}" data-notice="${notice.id}" data-post="${notice.postId || ''}">
          <span class="notification-avatar">${escapeHtml((notice.actorName || '系统').slice(-1))}</span>
          <span><strong>${escapeHtml(notice.actorName || (notice.type === 'admin' ? '管理员' : '系统通知'))}</strong>
          <small>${formatDate(notice.createdAt)}</small><p>${escapeHtml(notice.content)}</p></span>
        </button>`).join('') || '<p class="muted">暂无消息</p>'}</div>
      <div class="row plaza-pager"><button class="secondary" id="prevInbox" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${page} 页</span><button class="secondary" id="nextInbox" ${!result.hasMore ? 'disabled' : ''}>下一页</button></div>
    </section><div id="modalRoot"></div>`;
  document.querySelector('#backInbox').onclick = home;
  document.querySelector('#readAll').onclick = async () => { await api('/api/inbox', { method: 'PATCH', body: '{}' }); inbox(page); };
  document.querySelector('#prevInbox').onclick = () => inbox(page - 1);
  document.querySelector('#nextInbox').onclick = () => inbox(page + 1);
  document.querySelectorAll('[data-notice]').forEach((item) => {
    item.onclick = async () => {
      await api('/api/inbox', { method: 'PATCH', body: JSON.stringify({ id: item.dataset.notice }) });
      if (item.dataset.post) {
        await plaza();
        openPlazaPost(item.dataset.post, 'latest', 1, '', true);
      } else inbox(page);
    };
  });
}

/* APPROVED_PLAZA_PREFETCH_V2 */
const prefetchStudentPlaza = () => {
  if (user?.role !== 'student') return Promise.resolve(null);
  const cacheKey = scopedCacheKey('plaza', 'latest', 1, '');
  const cached = readViewCache(plazaViewCache, cacheKey);
  if (cached) return Promise.resolve(cached.data);
  if (studentPlazaPrefetchPromise) return studentPlazaPrefetchPromise;
  const startedAt = performance.now();
  const path = '/api/plaza?sort=latest&page=1&limit=20';
  const bootstrapPromise = window.__BOOTSTRAP_PLAZA_PROMISE__;
  const sourcePromise = bootstrapPromise
    ? Promise.resolve(bootstrapPromise).then((result) => result || api(path))
    : api(path);
  studentPlazaPrefetchPromise = sourcePromise
    .then((result) => {
      if (!result) return null;
      writeViewCache(plazaViewCache, cacheKey, result);
      const preloadImages = (result.posts || []).slice(0, 4)
        .map((post) => post.images?.[0])
        .filter(Boolean);
      preloadImages.forEach((image, index) => {
        const thumbUrl = buildMediaUrl(image.thumbUrl || image.imageUrl || image.displayUrl);
        if (!thumbUrl) return;
        const preload = new Image();
        preload.decoding = 'async';
        preload.fetchPriority = index < 2 ? 'high' : 'auto';
        preload.src = thumbUrl;
      });
      recordPerf('plaza-prefetch', {
        status: 'ready',
        duration: roundedDuration(startedAt),
        hasFirstImage: Boolean(preloadImages.length),
        bootstrapStarted: Boolean(bootstrapPromise)
      });
      return result;
    })
    .catch((error) => {
      recordPerf('plaza-prefetch', { status: 'failed', duration: roundedDuration(startedAt), message: error.message });
      return null;
    })
    .finally(() => { studentPlazaPrefetchPromise = null; });
  window.__BOOTSTRAP_PLAZA_PROMISE__ = studentPlazaPrefetchPromise;
  return studentPlazaPrefetchPromise;
};
const updatePlazaCachePost = (postId, updates) => {
  for (const entry of plazaViewCache.values()) {
    if (!entry?.data?.posts) continue;
    const post = entry.data.posts.find((item) => item.id === postId);
    if (post) Object.assign(post, updates);
  }
};

const updateVisiblePlazaCard = (postId, updates) => {
  const card = [...app.querySelectorAll('[data-post]')].find(
    (item) => item.dataset.post === postId
  );
  if (!card) return;
  const updateText = (selector, value) => {
    const target = card.querySelector(selector);
    if (target && value != null) target.textContent = value;
  };
  updateText('[data-plaza-views]', updates.viewCount);
  updateText('[data-plaza-comments]', updates.commentCount);
  if (updates.likeCount != null) {
    const likeTarget = card.querySelector('[data-plaza-likes]')
      || card.querySelector('.plaza-like > span:last-child');
    if (likeTarget) likeTarget.textContent = updates.likeCount;
  }
};

/* PLAZA_MOBILE_LAYOUT_V1 */
/* PLAZA_PERFORMANCE_QUALITY_V3 */
/* MOBILE_REAL_UNDER_1S_V5 */
const rebalancePlazaColumns = () => {
  const grid = document.querySelector('.plaza-grid');
  const columns = [...(grid?.querySelectorAll('[data-plaza-column]') || [])];
  if (!grid || columns.length !== 2 || grid.dataset.rebalancing === 'true') return;
  const cards = [...grid.querySelectorAll('.plaza-card')]
    .sort((left, right) => Number(left.dataset.cardIndex || 0) - Number(right.dataset.cardIndex || 0));
  if (!cards.length) return;
  grid.dataset.rebalancing = 'true';
  columns.forEach((column) => column.replaceChildren());
  cards.forEach((card, index) => {
    const target = index < 2
      ? columns[index]
      : columns[0].getBoundingClientRect().height <= columns[1].getBoundingClientRect().height
        ? columns[0]
        : columns[1];
    target.append(card);
  });
  grid.dataset.rebalancing = 'false';
};

const applyPlazaCoverRatio = (image) => {
  const shell = image?.closest?.('.plaza-card-cover');
  if (!shell) return;
  const naturalRatio = Number(image.naturalWidth) / Number(image.naturalHeight);
  const feedRatio = Number.isFinite(naturalRatio) && naturalRatio > 0
    ? Math.min(4 / 3, Math.max(3 / 4, naturalRatio))
    : 4 / 3;
  shell.style.aspectRatio = String(feedRatio);
  shell.dataset.feedRatio = feedRatio.toFixed(3);
  shell.classList.add('loaded');
  requestAnimationFrame(rebalancePlazaColumns);
};

const renderPlazaPage = (result, sort, page, month, pageEpoch, options = {}) => {
  const renderStartedAt = performance.now();
  if (!isCurrentNavigation(pageEpoch)) return;
  document.body.dataset.view = 'plaza';
  const preservedScroll = options.preserveScroll ? window.scrollY : 0;
  const query = String(options.query ?? result.query ?? '').trim();
  const cardMarkup = result.posts.map((post, cardIndex) => `
    <article class="plaza-card" data-post="${post.id}" data-card-index="${cardIndex}" tabindex="0" role="button" aria-label="查看活动内容">
      <div class="image-shell plaza-card-cover">
        ${post.images[0]
          ? `<img loading="${cardIndex < 4 ? 'eager' : 'lazy'}" decoding="async"
              fetchpriority="${cardIndex < 2 ? 'high' : cardIndex < 4 ? 'auto' : 'low'}"
              data-priority="${cardIndex < 4 ? 'high' : 'low'}"
              data-perf-image="plaza-thumb" width="480" height="360"
              ${cardIndex < 4
                ? `src="${escapeHtml(post.images[0].thumbUrl || post.images[0].imageUrl)}"`
                : `data-src="${escapeHtml(post.images[0].thumbUrl || post.images[0].imageUrl)}"`}
              alt="活动图片"
              onload="applyPlazaCoverRatio(this)"
              onerror="this.hidden=true;this.parentElement.classList.add('failed');requestAnimationFrame(rebalancePlazaColumns)">`
          : '<span class="image-fallback">暂无图片</span>'}
        <span class="image-error">图片加载失败</span>
      </div>
      <div class="plaza-body">
        <h2>${escapeHtml(post.teamName)}</h2>
        <p class="plaza-card-copy">${escapeHtml(post.copy || '')}</p>
        <div class="plaza-card-meta">
          <span class="plaza-avatar" aria-hidden="true">${escapeHtml((post.publisherName || '同').slice(-1))}</span>
          <span class="plaza-publisher">${escapeHtml(post.publisherName || '匿名发布者')}</span>
          <span class="plaza-like" aria-label="点赞${post.likeCount}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.5 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>
            <span>${post.likeCount}</span>
          </span>
        </div>
      </div>
    </article>`);
  const cards = cardMarkup.length
    ? `<div class="plaza-column" data-plaza-column="0">${cardMarkup.filter((_, index) => index % 2 === 0).join('')}</div><div class="plaza-column" data-plaza-column="1">${cardMarkup.filter((_, index) => index % 2 === 1).join('')}</div>`
    : `<div class="plaza-empty"><strong>${query ? '没有找到相关内容' : '当前没有公开内容'}</strong><span>${query ? '换一个关键词试试' : '公开提交后会显示在这里'}</span></div>`;
  app.innerHTML = `
    <header class="plaza-appbar">
      <button class="plaza-icon-button" id="backHome" type="button" aria-label="返回首页">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <nav class="plaza-channel-tabs" aria-label="活动广场排序">
        <button class="${sort === 'latest' ? 'active' : ''}" data-sort="latest" type="button">最新发布</button>
        <button class="${sort === 'hot' ? 'active' : ''}" data-sort="hot" type="button">热门排行</button>
      </nav>
      <button class="plaza-icon-button" id="togglePlazaSearch" type="button" aria-label="搜索活动内容" aria-expanded="${query ? 'true' : 'false'}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
      </button>
    </header>
    <section class="plaza-search-panel" id="plazaSearchPanel" ${query ? '' : 'hidden'}>
      <form id="plazaSearchForm" role="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
        <input id="plazaSearchInput" type="search" value="${escapeHtml(query)}" maxlength="40" autocomplete="off" placeholder="搜索队伍、任务、发布人或内容">
        <button class="plaza-search-clear" id="clearPlazaSearch" type="button" ${query ? '' : 'hidden'} aria-label="清空搜索">×</button>
      </form>
    </section>
    ${query ? `<p class="plaza-search-summary">“${escapeHtml(query)}”的搜索结果 · ${result.total}条</p>` : ''}
    <section class="plaza-grid">${cards}</section>
    <div class="plaza-pager" ${result.total > result.limit ? '' : 'hidden'}>
      <button class="plaza-page-button" id="prevPage" type="button" ${page <= 1 ? 'disabled' : ''}>上一页</button>
      <span>${page} / ${Math.max(1, Math.ceil(result.total / result.limit))}</span>
      <button class="plaza-page-button" id="nextPage" type="button" ${!result.hasMore ? 'disabled' : ''}>下一页</button>
    </div>
    <p class="view-cache-status muted" id="viewCacheStatus" hidden></p>
    <div id="modalRoot"></div>`;
  prepareDynamicContent(app);
  requestAnimationFrame(rebalancePlazaColumns);
  scheduleVisiblePlazaDetailWarmup();
  recordPerf('page-render', {
    page: 'plaza',
    duration: roundedDuration(renderStartedAt),
    navigationEpoch: pageEpoch
  });

  const searchPanel = document.querySelector('#plazaSearchPanel');
  const searchInput = document.querySelector('#plazaSearchInput');
  const searchToggle = document.querySelector('#togglePlazaSearch');
  document.querySelector('#backHome').onclick = home;
  searchToggle.onclick = () => {
    const opening = searchPanel.hidden;
    searchPanel.hidden = !opening;
    searchToggle.setAttribute('aria-expanded', String(opening));
    if (opening) requestAnimationFrame(() => searchInput.focus());
  };
  document.querySelector('#plazaSearchForm').onsubmit = (event) => {
    event.preventDefault();
    plaza(sort, 1, '', searchInput.value);
  };
  document.querySelector('#clearPlazaSearch').onclick = () => {
    if (query) plaza(sort, 1, '', '');
    else {
      searchInput.value = '';
      searchInput.focus();
    }
  };
  document.querySelectorAll('[data-sort]').forEach((button) => {
    button.onclick = () => plaza(button.dataset.sort, 1, '', query);
  });
  document.querySelector('#prevPage').onclick = () => plaza(sort, page - 1, '', query);
  document.querySelector('#nextPage').onclick = () => plaza(sort, page + 1, '', query);
  document.querySelectorAll('[data-post]').forEach((card) => {
    const open = () => openPlazaPost(card.dataset.post, sort, page, '');
    card.onclick = open;
    card.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    };
  });
  if (options.preserveScroll) requestAnimationFrame(() => window.scrollTo(0, preservedScroll));
};

async function plaza(sort = 'latest', page = 1, month = '', query = '') {
  const pageEpoch = beginNavigation();
  /* LAZY_PLAZA_ENTRY_V1 */
  void window.__LOAD_PLAZA_EXTRAS__?.();
  const safeSort = sort === 'hot' ? 'hot' : 'latest';
  const safeQuery = String(query || '').trim().slice(0, 40);
  const cacheKey = scopedCacheKey('plaza', safeSort, page, safeQuery);
  const cached = readViewCache(plazaViewCache, cacheKey);
  const path = `/api/plaza?sort=${safeSort}&page=${page}&limit=20${safeQuery ? `&q=${encodeURIComponent(safeQuery)}` : ''}`;
  if (cached) {
    renderPlazaPage(cached.data, safeSort, page, '', pageEpoch, { query: safeQuery });
    const refresh = async () => {
      try {
        const result = await api(path);
        writeViewCache(plazaViewCache, cacheKey, result);
        if (!isCurrentNavigation(pageEpoch)
            || document.body.dataset.view !== 'plaza'
            || document.querySelector('.plaza-detail')) return;
        renderPlazaPage(result, safeSort, page, '', pageEpoch, { preserveScroll: true, query: safeQuery });
      } catch {
        if (!isCurrentNavigation(pageEpoch)) return;
        const status = document.querySelector('#viewCacheStatus');
        if (status) {
          status.hidden = false;
          status.textContent = '当前显示的是已缓存内容，最新数据刷新失败。';
        }
      }
    };
    if (cacheIsFresh(cached)) {
      setTimeout(() => { void refresh(); }, 3200);
    } else void refresh();
    return;
  }
  // Reuse the bootstrap/home prefetch instead of issuing a second D1 request when the
  // user enters Plaza immediately after the home screen becomes interactive.
  const firstPagePromise = safeSort === 'latest' && page === 1 && !safeQuery
    ? (studentPlazaPrefetchPromise || prefetchStudentPlaza())
    : null;
  const preloadedResult = firstPagePromise
    ? await Promise.resolve(firstPagePromise).catch(() => null)
    : null;
  const result = preloadedResult || await api(path);
  writeViewCache(plazaViewCache, cacheKey, result);
  renderPlazaPage(result, safeSort, page, '', pageEpoch, { query: safeQuery });
}

function rankingTable(items, metric, label) {
  return `<div class="table-wrap"><table><thead><tr><th>排名</th><th>队伍</th><th>${label}</th></tr></thead><tbody>${items.map((item) => `<tr><td>${item.rank}</td><td>${escapeHtml(item.teamName)}</td><td>${item[metric]}</td></tr>`).join('') || '<tr><td colspan="3">暂无数据</td></tr>'}</tbody></table></div>`;
}

const renderRankingsPage = (result, period, key, pageEpoch, options = {}) => {
  const renderStartedAt = performance.now();
  if (!isCurrentNavigation(pageEpoch)) return;
  document.body.dataset.view = 'ranking';
  const preservedScroll = options.preserveScroll ? window.scrollY : 0;
  const currentKey = key || (period === 'month' ? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).slice(0, 7) : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }));
  const teamTable = `<div class="table-wrap"><table><thead><tr><th>排名</th><th>队伍</th><th>公开次数</th><th>点赞</th><th>浏览</th><th>综合热度</th></tr></thead><tbody>${result.teamRank.map((item) => `<tr><td>${item.rank}</td><td>${escapeHtml(item.teamName)}</td><td>${item.publicCount}</td><td>${item.likeCount}</td><td>${item.viewCount}</td><td>${item.heatScore}</td></tr>`).join('') || '<tr><td colspan="6">暂无数据</td></tr>'}</tbody></table></div>`;
  app.innerHTML = `
    <header class="hero"><div class="row"><div><h1>活动排行榜</h1><p>${escapeHtml(result.formula)}</p></div><button class="secondary right" id="backRanking">返回</button></div></header>
    <section class="card"><div class="row">
      <button class="${period === 'day' ? '' : 'secondary'}" data-period="day">日榜</button>
      <button class="${period === 'week' ? '' : 'secondary'}" data-period="week">周榜</button>
      <button class="${period === 'month' ? '' : 'secondary'}" data-period="month">月榜</button>
      <label class="right">${period === 'month' ? '月份' : '日期'} <input id="rankingKey" type="${period === 'month' ? 'month' : 'date'}" value="${escapeHtml(currentKey)}"></label>
      ${result.frozen ? '<span class="pill done">最终排名已冻结</span>' : ''}
    </div></section>
    ${period === 'month' ? `<section class="card"><h2>队伍月榜</h2>${teamTable}</section>` : `
      <section class="grid ranking-grids">
        <div class="card"><h2>点赞榜</h2>${rankingTable(result.likeRank, 'likeCount', '点赞')}</div>
        <div class="card"><h2>浏览榜</h2>${rankingTable(result.viewRank, 'viewCount', '浏览')}</div>
        <div class="card"><h2>综合热度榜</h2>${rankingTable(result.heatRank, 'heatScore', '热度')}</div>
      </section>`}
    ${period === 'month' && user.role === 'admin' ? `<section class="card"><div class="row"><button id="freezeRanking" ${result.frozen ? 'disabled' : ''}>冻结最终排名</button><button class="secondary" id="exportRanking">导出 Excel</button></div></section>` : ''}
    <p class="view-cache-status muted" id="viewCacheStatus" hidden></p>`;
  prepareDynamicContent(app);
  recordPerf('page-render', {
    page: 'rankings',
    duration: roundedDuration(renderStartedAt),
    navigationEpoch: pageEpoch
  });
  document.querySelector('#backRanking').onclick = home;
  document.querySelectorAll('[data-period]').forEach((button) => { button.onclick = () => rankings(button.dataset.period); });
  document.querySelector('#rankingKey').onchange = (event) => rankings(period, event.target.value);
  const freeze = document.querySelector('#freezeRanking');
  if (freeze) freeze.onclick = async () => {
    if (!await askConfirm('是否冻结最终排名？', `冻结 ${currentKey} 最终排名后将不会随数据变化。`)) return;
    const restoreButton = beginButtonLoading(freeze, '正在冻结…');
    try {
      await api('/api/admin/rankings/freeze', { method: 'POST', body: JSON.stringify({ month: currentKey }) });
      rankingViewCache.clear();
      await rankings('month', currentKey);
    } catch (error) {
      restoreButton();
      alert(error.message);
    }
  };
  const exportButton = document.querySelector('#exportRanking');
  if (exportButton) exportButton.onclick = async () => {
    await downloadApiFile(`/api/admin/rankings/export?month=${currentKey}`);
  };
  if (options.preserveScroll) requestAnimationFrame(() => window.scrollTo(0, preservedScroll));
};

async function rankings(period = 'day', key = '') {
  const pageEpoch = beginNavigation();
  const currentKey = key || (period === 'month'
    ? new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit'
    }).slice(0, 7)
    : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }));
  const cacheKey = scopedCacheKey('ranking', period, currentKey);
  const cached = readViewCache(rankingViewCache, cacheKey);
  const path = `/api/rankings?period=${period}&key=${encodeURIComponent(currentKey)}`;
  if (cached) {
    renderRankingsPage(cached.data, period, currentKey, pageEpoch);
    const refresh = async () => {
      try {
        const result = await api(path);
        writeViewCache(rankingViewCache, cacheKey, result);
        if (!isCurrentNavigation(pageEpoch) || document.body.dataset.view !== 'ranking') return;
        renderRankingsPage(result, period, currentKey, pageEpoch, { preserveScroll: true });
      } catch {
        if (!isCurrentNavigation(pageEpoch)) return;
        const status = document.querySelector('#viewCacheStatus');
        if (status) {
          status.hidden = false;
          status.textContent = '当前显示的是已缓存榜单，最新数据刷新失败。';
        }
      }
    };
    if (cacheIsFresh(cached)) queueMicrotask(() => { void refresh(); });
    else void refresh();
    return;
  }
  const result = await api(path);
  writeViewCache(rankingViewCache, cacheKey, result);
  renderRankingsPage(result, period, currentKey, pageEpoch);
}

/* CHECKIN_WINDOW_UPLOAD_PLAZA_PAGE_V1 */
const restorePlazaListFromHistory = (state) => {
  if (!state?.plazaList) return false;
  document.body.dataset.view = 'plaza';
  const scrollY = Math.max(0, Number(state.plazaScrollY || 0));
  void plaza(state.plazaSort || 'latest', Math.max(1, Number(state.plazaPage || 1)), state.plazaMonth || '', { preserveScroll: false })
    .then(() => requestAnimationFrame(() => window.scrollTo(0, scrollY)))
    .catch((error) => { showToast(error.message || '活动广场加载失败', 'error'); });
  return true;
};
window.addEventListener('popstate', (event) => {
  if (document.body.dataset.view === 'plaza-detail' && event.state?.plazaList) restorePlazaListFromHistory(event.state);
});

async function openPlazaPost(postId, sort, page, month, countView = true) {
  const root = app;
  const listUrl = new URL(location.href);
  listUrl.searchParams.delete('plazaPost');
  const plazaScrollY = window.scrollY;
  const listState = { ...(history.state || {}), plazaList: true, plazaDetail: false, plazaSort: sort, plazaPage: page, plazaMonth: month, plazaScrollY };
  history.replaceState(listState, '', listUrl);
  const detailUrl = new URL(listUrl);
  detailUrl.searchParams.set('plazaPost', postId);
  history.pushState({ ...listState, plazaList: false, plazaDetail: true, plazaPost: postId }, '', detailUrl);
  document.body.dataset.view = 'plaza-detail';
  const modalEpoch = ++plazaModalEpoch;
  const detailStartedAt = performance.now();
  const cacheKey = plazaPostCacheKey(postId);
  const cachedEntry = plazaPostCache.get(cacheKey);
  const previewPost = readPlazaPostPreview(postId);
  const detailCacheHit = Boolean(
    cachedEntry && Date.now() - cachedEntry.savedAt <= PLAZA_POST_CACHE_TTL_MS
  );
  let post = null;
  let commentPage = 1;

  const previewImage = previewPost?.images?.[0];
  root.innerHTML = previewPost ? `<section class="card plaza-detail plaza-detail-page" aria-busy="true">
    <div class="row"><div><span class="eyebrow dark">${escapeHtml(previewPost.taskName || '')}</span><h2>${escapeHtml(previewPost.teamName || '')}</h2></div><button class="secondary right" id="closePost">返回</button></div>
    <div class="plaza-photos">${previewImage ? `<button class="image-viewer-trigger" data-image-viewer="${escapeHtml(previewImage.thumbUrl || previewImage.imageUrl)}" data-image-thumb="${escapeHtml(previewImage.thumbUrl || previewImage.imageUrl)}" data-image-display="${escapeHtml(previewImage.displayUrl || previewImage.imageUrl)}" data-image-alt="活动图片"><div class="image-shell"><img data-perf-image="plaza-detail-thumb" data-priority="high" loading="eager" decoding="async" fetchpriority="high" width="640" height="480" src="${escapeHtml(previewImage.thumbUrl || previewImage.imageUrl)}" srcset="${escapeHtml(previewImage.thumbUrl || previewImage.imageUrl)} 960w, ${escapeHtml(previewImage.displayUrl || previewImage.imageUrl)} 2048w" sizes="(max-width: 720px) 100vw, 720px" alt="活动图片" onload="this.parentElement.classList.add('loaded')" onerror="this.hidden=true;this.parentElement.classList.add('failed')"><span class="image-error">图片加载失败</span></div></button>` : ''}</div>
    <p>${escapeHtml(previewPost.copy || '')}</p>
    <div class="row"><span class="muted">${formatDate(previewPost.publishedAt)} · 浏览 ${Number(previewPost.viewCount || 0)} · 评论 ${Number(previewPost.commentCount || 0)}</span><button class="secondary right" disabled>点赞 ${Number(previewPost.likeCount || 0)}</button></div>
    <section class="comments-panel"><h3>评论</h3><div><p class="muted comments-loading">详情与评论加载中…</p></div></section>
  </section>` : `<section class="card plaza-detail plaza-detail-page" aria-busy="true">
    <div class="row"><h2>正在读取作品…</h2><button class="secondary right" id="closePost">返回</button></div>
    <div class="plaza-detail-placeholder"></div>
  </section>`;

  const closePost = () => {
    if (modalEpoch !== plazaModalEpoch) return;
    plazaModalEpoch += 1;
    history.back();
  };
  prepareDynamicContent(root);
  root.querySelector('#closePost').onclick = closePost;
  if (previewPost) recordPerf('plaza-detail-preview-visible', { duration: roundedDuration(detailStartedAt), postId });

  let commentsPromise = null;

  try {
    post = await loadPlazaPost(postId);
  } catch (error) {
    if (modalEpoch !== plazaModalEpoch) return;
    root.innerHTML = `<section class="card plaza-detail plaza-detail-page">
      <div class="row"><h2>作品读取失败</h2><button class="secondary right" id="closePost">返回</button></div>
      <p class="bad">${escapeHtml(error.message)}</p>
    </section>`;
    root.querySelector('#closePost').onclick = closePost;
    return;
  }
  if (modalEpoch !== plazaModalEpoch) return;

  root.innerHTML = `<section class="card plaza-detail plaza-detail-page">
    <div class="row"><div><span class="eyebrow dark">${escapeHtml(post.taskName)}</span><h2>${escapeHtml(post.teamName)}</h2></div><button class="secondary right" id="closePost">返回</button></div>
    <p class="muted">成员：${post.members.map((member) => `${escapeHtml(member.name)}（${escapeHtml(member.campus)}）`).join('、')}</p>
    <div class="plaza-photos">${post.images.map((image, imageIndex) => `
        <button class="image-viewer-trigger" data-image-viewer="${escapeHtml(image.thumbUrl || image.imageUrl)}"
          data-image-thumb="${escapeHtml(image.thumbUrl || image.imageUrl)}"
          data-image-display="${escapeHtml(image.displayUrl || image.imageUrl)}" data-image-alt="活动图片">
        <div class="image-shell">
          <img data-perf-image="plaza-detail-thumb" data-priority="${imageIndex === 0 ? 'high' : 'low'}"
            loading="${imageIndex === 0 ? 'eager' : 'lazy'}" decoding="async"
            fetchpriority="${imageIndex === 0 ? 'high' : 'low'}" width="640" height="480"
            ${imageIndex === 0
              ? `src="${escapeHtml(image.thumbUrl || image.imageUrl)}" srcset="${escapeHtml(image.thumbUrl || image.imageUrl)} 960w, ${escapeHtml(image.displayUrl || image.imageUrl)} 2048w" sizes="(max-width: 720px) 100vw, 720px"`
              : `data-src="${escapeHtml(image.thumbUrl || image.imageUrl)}"`} alt="活动图片"
            onload="this.parentElement.classList.add('loaded')"
            onerror="this.hidden=true;this.parentElement.classList.add('failed')">
          <span class="image-error">图片加载失败</span>
        </div>
      </button>`).join('')}</div>
    <p>${escapeHtml(post.copy)}</p>
    <div class="row"><span class="muted">${formatDate(post.publishedAt)} · 浏览 <span data-detail-views>${post.viewCount}</span> · 今日剩余 ${post.likeQuota.remaining}/5 个赞</span><button class="right ${post.liked ? '' : 'secondary'}" id="likePost">${post.liked ? '取消点赞' : '点赞'} <span id="likeCount">${post.likeCount}</span></button></div>
    <section class="comments-panel">
      <h3>评论 <span id="commentCount">${post.commentCount}</span></h3>
      <form id="commentForm"><textarea name="content" maxlength="500" required placeholder="写下你的评论（最多500字）"></textarea><button disabled>发布评论</button></form>
      <div id="commentList"><p class="muted comments-loading">评论加载中…</p></div>
      <button class="secondary" id="moreComments" hidden>加载更多评论</button>
    </section>
  </section>`;
  prepareDynamicContent(root);
  root.querySelector('#closePost').onclick = closePost;
  const warmDisplayImages = () => {
    post.images.slice(0, 2).forEach((image) => {
      const displayUrl = buildMediaUrl(image.displayUrl || image.imageUrl || image.thumbUrl);
      if (!displayUrl) return;
      const preload = new Image();
      preload.decoding = 'async';
      preload.fetchPriority = 'low';
      preload.src = displayUrl;
    });
  };
  if ('requestIdleCallback' in window) requestIdleCallback(warmDisplayImages, { timeout: 1800 });
  else setTimeout(warmDisplayImages, 1200);
  recordPerf('plaza-detail-visible', {
    duration: roundedDuration(detailStartedAt),
    cacheHit: detailCacheHit,
    previewHit: Boolean(previewPost),
    postId
  });
  commentsPromise = api(`/api/plaza/${postId}/comments?page=1&limit=10`)
    .then((result) => ({ result, error: null }))
    .catch((error) => ({ result: null, error }));

  const bindDeleteComments = () => root.querySelectorAll('.delete-comment').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.onclick = async (event) => {
      const item = button.closest('[data-comment]');
      const restoreButton = beginButtonLoading(event.currentTarget, '删除中…');
      try {
        await api(`/api/plaza/${postId}/comments/${item.dataset.comment}`, { method: 'DELETE' });
        item.remove();
        post.commentCount = Math.max(0, Number(post.commentCount || 0) - 1);
        root.querySelector('#commentCount').textContent = post.commentCount;
        patchPlazaPostCache(postId, { commentCount: post.commentCount });
        updatePlazaCachePost(postId, { commentCount: post.commentCount });
        updateVisiblePlazaCard(postId, { commentCount: post.commentCount });
        if (!root.querySelector('#commentList [data-comment]')) {
          root.querySelector('#commentList').innerHTML = '<p class="muted empty-comments">还没有评论</p>';
        }
      } catch (error) {
        restoreButton();
        alert(error.message);
      }
    };
  });

  const renderComments = (result, append = false) => {
    if (modalEpoch !== plazaModalEpoch) return;
    const list = root.querySelector('#commentList');
    if (!list) return;
    const commentsHtml = result.comments.map((comment) => `
      <article class="comment-item" data-comment="${comment.id}">
        <div><strong>${escapeHtml(comment.name)}</strong><span class="muted">${formatDate(comment.createdAt)}</span></div>
        <p>${escapeHtml(comment.content)}</p>
        ${comment.canDelete ? '<button class="link-button delete-comment">删除</button>' : ''}
      </article>`).join('');
    if (append) list.insertAdjacentHTML('beforeend', commentsHtml);
    else list.innerHTML = commentsHtml || '<p class="muted empty-comments">还没有评论</p>';
    const moreComments = root.querySelector('#moreComments');
    moreComments.hidden = !result.hasMore;
    root.querySelector('#commentForm button').disabled = false;
    bindDeleteComments();
  };

  const showCommentsError = (error) => {
    if (modalEpoch !== plazaModalEpoch) return;
    const list = root.querySelector('#commentList');
    if (!list) return;
    list.innerHTML = `<p class="bad comments-error">评论加载失败：${escapeHtml(error.message)}</p><button class="secondary" id="retryComments" type="button">重新加载评论</button>`;
    root.querySelector('#commentForm button').disabled = false;
    root.querySelector('#retryComments').onclick = async (event) => {
      const restoreButton = beginButtonLoading(event.currentTarget, '加载中…');
      try {
        const result = await api(`/api/plaza/${postId}/comments?page=1&limit=10`);
        commentPage = 1;
        renderComments(result);
      } catch (retryError) {
        restoreButton();
        showCommentsError(retryError);
      }
    };
  };

  root.querySelector('#likePost').onclick = async (event) => {
    const button = event.currentTarget;
    const restoreButton = beginButtonLoading(button, post.liked ? '正在取消…' : '正在点赞…');
    const previousLiked = post.liked;
    try {
      const result = await api(`/api/plaza/${postId}/like`, {
        method: 'POST',
        body: JSON.stringify({ liked: !post.liked })
      });
      post.liked = result.liked;
      if (post.liked !== previousLiked) post.likeCount += post.liked ? 1 : -1;
      button.dataset.loading = 'false';
      button.disabled = false;
      button.innerHTML = `${post.liked ? '取消点赞' : '点赞'} <span id="likeCount">${post.likeCount}</span>`;
      button.classList.toggle('secondary', !post.liked);
      patchPlazaPostCache(postId, { likeCount: post.likeCount, liked: post.liked });
      updatePlazaCachePost(postId, { likeCount: post.likeCount, liked: post.liked });
      updateVisiblePlazaCard(postId, { likeCount: post.likeCount });
      rankingViewCache.clear();
    } catch (error) {
      restoreButton();
      alert(error.message);
    }
  };

  root.querySelector('#commentForm').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    const submitButton = event.submitter || form.querySelector('button');
    const restoreButton = beginButtonLoading(submitButton, '发布中…');
    try {
      const result = await api(`/api/plaza/${postId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content: form.content.value })
      });
      root.querySelector('.empty-comments')?.remove();
      root.querySelector('.comments-error')?.remove();
      root.querySelector('.comments-loading')?.remove();
      root.querySelector('#retryComments')?.remove();
      root.querySelector('#commentList').insertAdjacentHTML('afterbegin', `
        <article class="comment-item" data-comment="${result.comment.id}">
          <div><strong>${escapeHtml(result.comment.name)}</strong><span class="muted">${formatDate(result.comment.createdAt)}</span></div>
          <p>${escapeHtml(result.comment.content)}</p><button class="link-button delete-comment">删除</button>
        </article>`);
      root.querySelector('#commentCount').textContent = result.commentCount;
      post.commentCount = result.commentCount;
      patchPlazaPostCache(postId, { commentCount: post.commentCount });
      updatePlazaCachePost(postId, { commentCount: post.commentCount });
      updateVisiblePlazaCard(postId, { commentCount: post.commentCount });
      form.reset();
      restoreButton();
      bindDeleteComments();
    } catch (error) {
      restoreButton();
      alert(error.message);
    }
  };

  const moreComments = root.querySelector('#moreComments');
  moreComments.onclick = async (event) => {
    const restoreButton = beginButtonLoading(event.currentTarget, '加载中…');
    try {
      const nextPage = commentPage + 1;
      const next = await api(`/api/plaza/${postId}/comments?page=${nextPage}&limit=10`);
      commentPage = nextPage;
      renderComments(next, true);
      restoreButton();
    } catch (error) {
      restoreButton();
      alert(error.message);
    }
  };

  requestAnimationFrame(() => {
    setTimeout(() => {
      const viewKey = scopedCacheKey('plaza-view', postId);
      if (!countView || countedPlazaViews.has(viewKey)) return;
      countedPlazaViews.add(viewKey);
      void api(`/api/plaza/${postId}/view`, { method: 'POST' })
        .then((result) => {
          if (!result.counted) return;
          const nextViewCount = Number(post.viewCount || 0) + 1;
          post.viewCount = nextViewCount;
          patchPlazaPostCache(postId, { viewCount: nextViewCount });
          updatePlazaCachePost(postId, { viewCount: nextViewCount });
          updateVisiblePlazaCard(postId, { viewCount: nextViewCount });
          const detailCount = root.querySelector('[data-detail-views]');
          if (detailCount) detailCount.textContent = nextViewCount;
          rankingViewCache.clear();
        })
        .catch(() => {});
    }, 0);
  });

  void commentsPromise.then(({ result, error }) => {
    if (error) showCommentsError(error);
    else renderComments(result);
  });
}

function checkinForm(slotId) {
  beginNavigation();
  const slot = config.slots.find((item) => item.id === slotId);
  app.innerHTML = `
    <header class="hero"><h1>${escapeHtml(slot.label)}打卡</h1><p>${slot.start}–${slot.end}，请上传水印相机截图。</p></header>
    <section class="card">
      <form id="send">
        <label>餐食水印截图（可多选）</label><input required name="photos" type="file" accept="image/*" multiple>
        <label>Elavatine 当日汇总截图（可选）</label><input name="summary" type="file" accept="image/*">
        <label>备注（可选）</label><textarea name="note"></textarea>
        <div class="row"><button type="button" class="secondary" id="back">返回</button><button>上传并提交</button></div>
      </form>
    </section>`;
  document.querySelector('#back').onclick = home;
  document.querySelector('#send').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    const submitButton = event.submitter || form.querySelector('button:not([type="button"])');
    const restoreButton = beginButtonLoading(submitButton, '正在提交…');
    try {
      const photos = await readFiles(form.photos.files, { businessType: 'meal-checkin', limit: 3 });
      const summary = form.summary.files[0]
        ? (await readFiles(form.summary.files, { businessType: 'meal-checkin', limit: 1 }))[0]
        : null;
      const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
      await api('/api/checkins', {
        method: 'POST',
        body: JSON.stringify({
          date,
          slotId,
          photoMediaIds: photos.map((item) => item.mediaId),
          summaryMediaId: summary?.mediaId || null,
          note: form.note.value
        })
      });
      returnToCachedStudentHome('个人打卡成功');
    } catch (error) {
      restoreButton();
      alert(error.message);
    }
  };
}

/* ADMIN_DASHBOARD_REFACTOR_V1 */
/* STUDENT_ADMIN_FLOW_V2 */

/* ADMIN_CLIENT_LAZY_LOADER_V1 */
let adminClientModulePromise = null;
const loadAdminClient = (selectedDate, pageEpoch) => {
  if (user?.role !== 'admin') return Promise.resolve(false);
  if (!adminClientModulePromise) {
    const appScript = [...document.scripts].find((script) => new URL(script.src || location.href, location.href).pathname === '/app.js');
    const version = appScript ? new URL(appScript.src, location.href).searchParams.get('v') : '';
    const url = new URL('/admin-client.js', location.origin);
    if (version) url.searchParams.set('v', version);
    adminClientModulePromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-admin-client]');
      if (existing?.dataset.loaded === 'true') return resolve();
      const script = existing || document.createElement('script');
      script.dataset.adminClient = 'true'; script.async = true; script.src = url.href;
      script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
      script.onerror = () => { script.remove(); reject(new Error('管理后台模块加载失败，请检查网络后重试。')); };
      if (!existing) document.head.append(script);
    }).catch((error) => {
      adminClientModulePromise = null;
      app.innerHTML = '<main class="boot-shell"><section class="boot-error">管理后台模块加载失败，请检查网络后重试。<br><button type="button" id="retryAdminClient">重新加载</button></section></main>';
      document.querySelector('#retryAdminClient').onclick = () => { void home({ showShell: false }); };
      throw error;
    });
  }
  return adminClientModulePromise.then(() => window.__ADMIN_CLIENT_RENDER__(selectedDate, pageEpoch));
};

if (window.__BOOTSTRAP_AUTHENTICATED__) home().catch(logout);
else if (token) api('/api/session', { method: 'POST' }).catch(() => null).then(home).catch(logout);
else login();

/* LAZY_HEALTH_CLIENT_MODULE_V1 */
let healthClientModulePromise = null;
const loadHealthClientModule = () => {
  if (user?.role !== 'student' || user.trackId !== 'health') return Promise.resolve(false);
  if (healthClientModulePromise) return healthClientModulePromise;
  const appScript = [...document.scripts].find((script) => /\/app\.js(?:\?|$)/.test(script.src));
  const version = appScript ? new URL(appScript.src, location.href).searchParams.get('v') : '';
  const moduleUrl = new URL('/health-checkin.js', location.origin);
  if (version) moduleUrl.searchParams.set('v', version);
  const startedAt = performance.now();
  healthClientModulePromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-health-checkin-module]');
    if (existing?.dataset.loaded === 'true') { resolve(true); return; }
    const script = existing || document.createElement('script');
    script.dataset.healthCheckinModule = 'true';
    script.async = true;
    script.src = moduleUrl.href;
    script.onload = () => { script.dataset.loaded = 'true'; resolve(true); };
    script.onerror = () => reject(new Error('健康打卡模块加载失败'));
    if (!existing) document.head.appendChild(script);
  })
    .then((loaded) => {
      recordPerf('module-load', { module: 'health-checkin', status: 'ready', duration: roundedDuration(startedAt) });
      return loaded;
    })
    .catch((error) => {
      recordPerf('module-load', { module: 'health-checkin', status: 'failed', duration: roundedDuration(startedAt), message: error.message });
      const section = document.querySelector('#activityTasks');
      if (section && document.body.dataset.view === 'student') {
        section.innerHTML = '<div class="row"><h2>今日打卡</h2><span class="right muted">加载失败</span></div><p class="bad">健康打卡模块加载失败，请重新进入。</p>';
      }
      healthClientModulePromise = null;
      return false;
    });
  return healthClientModulePromise;
};
if (user?.role === 'student' && user.trackId === 'health') void loadHealthClientModule();

/* APPROVED_MOBILE_EXPERIENCE_FRONTEND_V1 */

/* TRACK_AWARE_ADMIN_SETTINGS_V1 */
