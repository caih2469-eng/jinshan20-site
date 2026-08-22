/* QQ_BACK_DIAGNOSTIC_ENTRY_V1: Runs independently of the authenticated app. */
(() => {
  'use strict';

  const diagnosticRequested = () => {
    const params = new URL(location.href).searchParams;
    const requested = params.get('qqBackDebug') === '1';
    const requestedProbe = params.get('qqBackProbe');
    try {
      if (requested) {
        sessionStorage.setItem('qqBackDebug', '1');
        localStorage.setItem('qqBackDebug', '1');
        if (requestedProbe) {
          sessionStorage.setItem('qqBackProbe', requestedProbe);
          localStorage.setItem('qqBackProbe', requestedProbe);
        }
        return true;
      }
      return sessionStorage.getItem('qqBackDebug') === '1' || localStorage.getItem('qqBackDebug') === '1';
    } catch {
      return requested;
    }
  };

  const install = () => {
    if (!diagnosticRequested() || document.querySelector('[data-qq-back-debug]')) return;
    const storageKey = '__qq_back_debug_v1__';
    const readEntries = () => {
      try {
        const raw = sessionStorage.getItem(storageKey) || localStorage.getItem(storageKey) || '[]';
        const entries = JSON.parse(raw);
        return Array.isArray(entries) ? entries.slice(-40) : [];
      } catch {
        return [];
      }
    };
    window.__QQ_BACK_DEBUG__ = readEntries();
    const panel = document.createElement('aside');
    panel.dataset.qqBackDebug = 'true';
    panel.setAttribute('aria-live', 'polite');
    panel.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:130;max-width:min(300px,calc(100vw - 16px));max-height:42vh;overflow:auto;padding:8px;border:1px solid #4b5563;border-radius:10px;background:rgba(17,24,39,.94);color:#f9fafb;font:11px/1.45 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.28);pointer-events:auto';
    const escapeText = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    const safeState = () => {
      try { return JSON.stringify(history.state || {}); } catch { return '[unserializable]'; }
    };
    const snapshot = (event, extra = {}) => ({
      event,
      time: Date.now(),
      href: location.href,
      hash: location.hash,
      historyLength: history.length,
      historyState: history.state || null,
      view: document.body?.dataset.view || '',
      overlay: Boolean(document.querySelector('.plaza-detail-layer')),
      ...extra
    });
    const record = (event, extra = {}) => {
      window.__QQ_BACK_DEBUG__.push(snapshot(event, extra));
      window.__QQ_BACK_DEBUG__ = window.__QQ_BACK_DEBUG__.slice(-40);
      try {
        const serialized = JSON.stringify(window.__QQ_BACK_DEBUG__);
        sessionStorage.setItem(storageKey, serialized);
        localStorage.setItem(storageKey, serialized);
      } catch {}
      render();
    };
    const count = (event) => window.__QQ_BACK_DEBUG__.filter((entry) => entry.event === event).length;
    const render = () => {
      const probe = new URL(location.href).searchParams.get('qqBackProbe')
        || sessionStorage.getItem('qqBackProbe')
        || localStorage.getItem('qqBackProbe');
      panel.innerHTML = `<strong>QQ Back 诊断已开启${probe === '2' ? '：QQ真实URL返回测试 当前为第2页' : ''}</strong><br>
        UA: ${escapeText(navigator.userAgent.slice(0, 110))}<br>
        history.length: ${history.length} · hash: ${escapeText(location.hash || '(empty)')}<br>
        state: ${escapeText(safeState().slice(0, 130))}<br>
        view: ${escapeText(document.body?.dataset.view || '(loading)')} · overlay: ${Boolean(document.querySelector('.plaza-detail-layer'))}<br>
        popstate: ${count('popstate')} · hashchange: ${count('hashchange')} · pagehide: ${count('pagehide')} · visibilitychange: ${count('visibilitychange')}<br>
        <button type="button" data-qq-back-js style="margin-top:5px">JS测试返回</button>
        <button type="button" data-qq-back-url style="margin-top:5px">真实URL测试</button>
        <button type="button" data-qq-back-copy style="margin-top:5px">复制日志</button>
        <button type="button" data-qq-back-clear style="margin-top:5px">清空日志</button>
        <button type="button" data-qq-back-exit style="margin-top:5px">退出诊断</button>`;
      panel.querySelector('[data-qq-back-js]').onclick = () => { record('js-history-back'); history.back(); };
      panel.querySelector('[data-qq-back-url]').onclick = () => {
        record('real-url-assign');
        location.assign('/?qqBackDebug=1&qqBackProbe=2');
      };
      panel.querySelector('[data-qq-back-copy]').onclick = async () => {
        const output = JSON.stringify({ userAgent: navigator.userAgent, entries: window.__QQ_BACK_DEBUG__ }, null, 2);
        try { await navigator.clipboard.writeText(output); record('copy-log'); } catch { window.prompt('复制以下 QQ Back 诊断日志', output); }
      };
      panel.querySelector('[data-qq-back-clear]').onclick = () => {
        window.__QQ_BACK_DEBUG__ = [];
        try { sessionStorage.removeItem(storageKey); localStorage.removeItem(storageKey); } catch {}
        record('log-cleared');
      };
      panel.querySelector('[data-qq-back-exit]').onclick = () => {
        try {
          sessionStorage.removeItem('qqBackDebug'); localStorage.removeItem('qqBackDebug');
          sessionStorage.removeItem('qqBackProbe'); localStorage.removeItem('qqBackProbe');
        } catch {}
        panel.remove();
      };
    };
    window.addEventListener('popstate', (event) => record('popstate', { eventState: event.state || null }));
    window.addEventListener('hashchange', () => record('hashchange'));
    window.addEventListener('beforeunload', () => record('beforeunload'));
    window.addEventListener('pagehide', () => record('pagehide'));
    document.addEventListener('visibilitychange', () => record('visibilitychange', { visibility: document.visibilityState }));
    (document.body || document.documentElement).append(panel);
    record('diagnostic-ready');
  };

  window.__INSTALL_QQ_BACK_DIAGNOSTIC__ = install;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
