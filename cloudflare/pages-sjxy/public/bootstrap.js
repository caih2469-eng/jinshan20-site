/* BUILD_ASSET_VERSION_V1 fallback=20260731-approved1 */
(() => {
  const perfEnabled = (() => {
    try {
      return new URLSearchParams(location.search).get('debugPerf') === '1'
        || localStorage.getItem('debugPerf') === '1';
    } catch {
      return false;
    }
  })();
  window.__PERF_METRICS__ = Array.isArray(window.__PERF_METRICS__) ? window.__PERF_METRICS__ : [];
  window.__RECORD_PERF__ = (type, details = {}) => {
    if (!perfEnabled) return;
    const metric = {
      type,
      at: Math.round(performance.now() * 10) / 10,
      ...details
    };
    window.__PERF_METRICS__.push(metric);
    if (window.__PERF_METRICS__.length > 500) window.__PERF_METRICS__.shift();
    console.debug('[perf]', metric);
  };
  const bootstrapStarted = performance.now();
  /* LOGIN_BOOTSTRAP_HANDOFF_V2 */
  const consumeLoginBootstrapV2 = () => {
    try {
      const raw = sessionStorage.getItem("jinshan20.loginBootstrap.v2");
      sessionStorage.removeItem("jinshan20.loginBootstrap.v2");
      if (!raw) return null;
      const stored = JSON.parse(raw);
      const age = Date.now() - Number(stored?.savedAt || 0);
      const session = stored?.data;
      const cachedUser = JSON.parse(localStorage.getItem('user') || 'null');
      if (age < 0 || age > 10_000) return null;
      if (!stored?.userId || stored.userId !== cachedUser?.id) return null;
      if (!session?.ok || session.user?.id !== stored.userId || !session.dashboard || !session.config) return null;
      return session;
    } catch {
      return null;
    }
  };
  const loadStylesheet = (href) => {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = href;
    document.head.appendChild(stylesheet);
  };
  const loadScript = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
  /* STRICT_P95_ASSET_OVERLAP_V4 */
  const preloadCriticalAsset = (href, as, priority = 'auto') => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = as;
    link.href = href;
    link.fetchPriority = priority;
    document.head.appendChild(link);
  };
  const warmHomeAssets = () => {
    preloadCriticalAsset('/style.css?v=54b75e54369858903ecb583288948e6daf05d51c', 'style', 'high');
    preloadCriticalAsset('/site-path.js?v=54b75e54369858903ecb583288948e6daf05d51c', 'script', 'auto');
    preloadCriticalAsset('/app.js?v=54b75e54369858903ecb583288948e6daf05d51c', 'script', 'auto');
  };
  /* LAZY_PLAZA_BOOTSTRAP_V1 */
  const featureScriptPromises = new Map();
  const loadFeatureScript = (src) => {
    const existing = featureScriptPromises.get(src);
    if (existing) return existing;
    const promise = loadScript(src).catch((error) => {
      featureScriptPromises.delete(src);
      throw error;
    });
    featureScriptPromises.set(src, promise);
    return promise;
  };
  window.__LOAD_PLAZA_EXTRAS__ = () => {
    const startedAt = performance.now();
    return Promise.all([
      loadFeatureScript('/plaza-auto-masonry.js?v=54b75e54369858903ecb583288948e6daf05d51c'),
      loadFeatureScript('/plaza-comment-mode.js?v=54b75e54369858903ecb583288948e6daf05d51c')
    ])
      .then(() => {
        window.__RECORD_PERF__('plaza-extras-ready', {
          status: 'ready',
          duration: Math.round((performance.now() - startedAt) * 10) / 10
        });
        return true;
      })
      .catch((error) => {
        window.__RECORD_PERF__('plaza-extras-ready', {
          status: 'failed',
          duration: Math.round((performance.now() - startedAt) * 10) / 10,
          message: error?.message || 'load failed'
        });
        return false;
      });
  };
  const showNetworkError = () => {
    document.querySelector('#app').innerHTML =
      '<section class="boot-shell"><div class="boot-error">网络连接失败，请检查网络后重试。<br><button type="button" id="bootRetry">重新加载</button></div></section>';
    document.querySelector('#bootRetry').onclick = () => location.reload();
  };
  const bootstrap = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      let storedToken = '';
      try { storedToken = localStorage.getItem('token') || ''; } catch {}
      let session = consumeLoginBootstrapV2();
      queueMicrotask(warmHomeAssets);
      if (!session) {
        const sessionRequest = fetch('/api/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: storedToken ? { authorization: `Bearer ${storedToken}` } : {},
        signal: controller.signal
        });
        const response = await sessionRequest;
        if (response.status === 401 || response.status === 403) {
          location.replace('/entrance');
          return;
        }
        if (!response.ok) throw new Error('session unavailable');
        session = await response.json();
        window.__RECORD_PERF__('bootstrap-session', {
          source: 'network',
          requestId: response.headers.get('x-request-id') || '',
          status: response.status,
          duration: Math.round((performance.now() - bootstrapStarted) * 10) / 10
        });
      } else {
        window.__RECORD_PERF__('bootstrap-session', {
          source: 'login-handoff-v2',
          status: 200,
          duration: Math.round((performance.now() - bootstrapStarted) * 10) / 10
        });
      }
      window.__BOOTSTRAP_AUTHENTICATED__ = true;
      window.__BOOTSTRAP_SESSION__ = session;
      window.__BOOTSTRAP_USER__ = session.user || null;
      window.__BOOTSTRAP_DASHBOARD__ = session.dashboard || null;
      /* APPROVED_BOOTSTRAP_PLAZA_PREFETCH_V1 */
      /* PLAZA_PERFORMANCE_QUALITY_V3 */
      /* STRICT_P95_BOOTSTRAP_V4 */
      // Do not compete with the authenticated home critical path. The app starts this prefetch after home is usable.
      /* LOGIN_PLAZA_HANDOFF_V1 */
      // A validated same-user login handoff can satisfy Plaza immediately.
      // Missing data keeps the existing app-level /api/plaza fallback intact.
      window.__BOOTSTRAP_PLAZA_PROMISE__ = Promise.resolve(session.plaza || null);
      window.__BOOTSTRAP_PLAZA_IMAGES__ = [];
        loadStylesheet('/style.css?v=54b75e54369858903ecb583288948e6daf05d51c');
      /* ROLE_SCOPED_ADMIN_STYLE_V1 */
      if (window.__BOOTSTRAP_USER__?.role === 'admin') {
        loadStylesheet('/admin-dashboard-refactor.css?v=54b75e54369858903ecb583288948e6daf05d51c');
      }
      await loadScript('/site-path.js?v=54b75e54369858903ecb583288948e6daf05d51c');
      await loadScript('/app.js?v=54b75e54369858903ecb583288948e6daf05d51c');


      window.__RECORD_PERF__('bootstrap-complete', {
        duration: Math.round((performance.now() - bootstrapStarted) * 10) / 10
      });
    } catch {
      showNetworkError();
    } finally {
      clearTimeout(timeout);
    }
  };
  bootstrap();
})();
