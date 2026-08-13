const test = require('node:test');
const assert = require('node:assert/strict');

test('sjxy proxy preserves request method, body, cookies, response cookie and status', async () => {
  const { proxyToProduction } = await import('../cloudflare/pages-sjxy/functions/_middleware.js');
  let capturedRequest;
  const response = await proxyToProduction({
    env: { UPSTREAM_ORIGIN: 'https://jinshan20.pages.dev' },
    request: new Request('https://sjxy.pages.dev/api/session?fresh=1', {
      method: 'POST',
      headers: {
        cookie: 'session=existing',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ login: true })
    })
  }, async (request) => {
    capturedRequest = request;
    return new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'session=renewed; Path=/; HttpOnly; Secure; SameSite=Lax'
      }
    });
  });

  assert.equal(capturedRequest.url, 'https://jinshan20.pages.dev/api/session?fresh=1');
  assert.equal(capturedRequest.method, 'POST');
  assert.equal(capturedRequest.headers.get('cookie'), 'session=existing');
  assert.deepEqual(await capturedRequest.json(), { login: true });
  assert.equal(response.status, 201);
  assert.match(response.headers.get('set-cookie'), /session=renewed/);
  assert.equal(response.headers.get('x-jinshan-entry'), 'sjxy');
  assert.deepEqual(await response.json(), { ok: true });
});

test('sjxy proxy rewrites same-upstream redirects to the public hostname', async () => {
  const { proxyToProduction } = await import('../cloudflare/pages-sjxy/functions/_middleware.js');
  const response = await proxyToProduction({
    env: {},
    request: new Request('https://sjxy.pages.dev/api/redirect')
  }, async () => new Response(null, {
    status: 302,
    headers: { location: 'https://jinshan20.pages.dev/entrance?reason=expired' }
  }));

  assert.equal(response.headers.get('location'), 'https://sjxy.pages.dev/entrance?reason=expired');
});

test('sjxy proxies static assets so the public entry always uses the current production bytes', async () => {
  const { proxyToProduction } = await import('../cloudflare/pages-sjxy/functions/_middleware.js');
  let capturedRequest;
  const response = await proxyToProduction({
    env: {},
    request: new Request('https://sjxy.pages.dev/app.js?v=current')
  }, async (request) => {
    capturedRequest = request;
    return new Response('current production app', {
      headers: { etag: 'production-etag' }
    });
  });
  assert.equal(capturedRequest.url, 'https://jinshan20.pages.dev/app.js?v=current');
  assert.equal(response.headers.get('etag'), 'production-etag');
  assert.equal(await response.text(), 'current production app');
});
