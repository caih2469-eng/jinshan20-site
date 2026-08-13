const test = require('node:test');
const assert = require('node:assert/strict');

test('sjxy serves static files locally and only proxies dynamic production routes', async () => {
  const { shouldProxyToProduction } = await import('../cloudflare/pages-sjxy/functions/_middleware.js');
  assert.equal(shouldProxyToProduction('/api'), true);
  assert.equal(shouldProxyToProduction('/api/session'), true);
  assert.equal(shouldProxyToProduction('/health'), true);
  assert.equal(shouldProxyToProduction('/app.js'), false);
  assert.equal(shouldProxyToProduction('/api-malicious'), false);
});

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

test('sjxy static assets continue through Pages without the extra upstream hop', async () => {
  const { onRequest } = await import('../cloudflare/pages-sjxy/functions/_middleware.js');
  let nextCalls = 0;
  const response = await onRequest({
    env: {},
    request: new Request('https://sjxy.pages.dev/app.js?v=current'),
    next() {
      nextCalls += 1;
      return new Response('current production app');
    }
  });
  assert.equal(nextCalls, 1);
  assert.equal(await response.text(), 'current production app');
});
