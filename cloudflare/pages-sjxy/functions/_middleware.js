const DEFAULT_UPSTREAM_ORIGIN = 'https://jinshan20.pages.dev';
const DYNAMIC_PATH_PREFIXES = ['/api/', '/health'];

export const normalizePagesPathname = (pathname) => {
  const normalized = `/${String(pathname || '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/')}`;
  return normalized || '/';
};

export const shouldProxyToProduction = (pathname) => (
  pathname === '/api' || DYNAMIC_PATH_PREFIXES.some((prefix) => (
    prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname === prefix
  ))
);

const rewriteUpstreamLocation = (headers, upstreamOrigin, publicOrigin) => {
  const location = headers.get('location');
  if (!location) return;
  try {
    const target = new URL(location, upstreamOrigin);
    if (target.origin !== upstreamOrigin) return;
    target.protocol = publicOrigin.protocol;
    target.host = publicOrigin.host;
    headers.set('location', target.toString());
  } catch {
    // Leave malformed upstream Location values untouched instead of inventing a redirect.
  }
};

export const proxyToProduction = async (context, fetchImpl = fetch) => {
  const publicUrl = new URL(context.request.url);
  const configuredOrigin = String(context.env?.UPSTREAM_ORIGIN || DEFAULT_UPSTREAM_ORIGIN).trim();
  const upstreamOrigin = new URL(configuredOrigin).origin;
  const upstreamUrl = new URL(`${publicUrl.pathname}${publicUrl.search}`, upstreamOrigin);
  const upstreamRequest = new Request(upstreamUrl, context.request);

  try {
    const upstreamResponse = await fetchImpl(upstreamRequest, { redirect: 'manual' });
    const headers = new Headers(upstreamResponse.headers);
    rewriteUpstreamLocation(headers, upstreamOrigin, publicUrl);
    headers.set('x-jinshan-entry', 'sjxy');
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers
    });
  } catch {
    return new Response(JSON.stringify({ error: '正式服务暂时不可用，请稍后重试' }), {
      status: 502,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-jinshan-entry': 'sjxy'
      }
    });
  }
};

export const onRequest = (context) => {
  const url = new URL(context.request.url);
  const normalizedPath = normalizePagesPathname(url.pathname);
  if (normalizedPath !== url.pathname) {
    url.pathname = normalizedPath;
    return new Response(null, {
      status: 308,
      headers: {
        location: url.toString(),
        'cache-control': 'no-store'
      }
    });
  }
  if (shouldProxyToProduction(normalizedPath)) return proxyToProduction(context);
  return context.next();
};
