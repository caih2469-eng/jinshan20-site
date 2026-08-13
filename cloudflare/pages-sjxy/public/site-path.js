(function initSitePaths(global) {
  'use strict';

  const normalizeSitePath = (value) => {
    const input = String(value || '').trim();
    if (!input) return '/';
    if (/^(?:https?:|blob:|data:)/i.test(input)) return input;
    const [pathAndQuery, hash = ''] = input.split('#', 2);
    const [pathname, query = ''] = pathAndQuery.split('?', 2);
    const normalized = `/${pathname.replace(/^\/+/, '').replace(/\/{2,}/g, '/')}`;
    return `${normalized}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`;
  };

  const buildMediaUrl = (value, variant, version) => {
    const normalized = normalizeSitePath(value);
    if (/^(?:https?:|blob:|data:)/i.test(normalized)) return normalized;
    const url = new URL(normalized, global.location?.origin || 'https://site.invalid');
    if (variant) url.searchParams.set('variant', variant);
    if (version) url.searchParams.set('v', version);
    return `${url.pathname}${url.search}${url.hash}`;
  };

  global.normalizeSitePath = normalizeSitePath;
  global.buildMediaUrl = buildMediaUrl;
})(globalThis);
