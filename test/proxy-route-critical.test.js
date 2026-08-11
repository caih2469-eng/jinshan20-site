const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('入口页合并登录运行时并短时复用首页文档，不改变登录功能', () => {
  const html = fs.readFileSync('public/entrance.html', 'utf8');
  const runtime = fs.readFileSync('public/entrance.js', 'utf8');
  const headers = fs.readFileSync('public/_headers', 'utf8');
  assert.match(html, /INLINE_ENTRANCE_CRITICAL_V1/);
  assert.match(html, /HOME_DOCUMENT_PREFETCH_V2/);
  assert.match(html, /controller\.abort\(\), 1200/);
  assert.match(html, /response\.arrayBuffer\(\)/);
  assert.match(html, /__SETTLE_HOME_DOCUMENT_PREFETCH__/);
  assert.doesNotMatch(html, /<link rel="prefetch" href="\/">/);
  assert.match(html, /loginForm\.addEventListener\('submit'/);
  assert.match(html, /fetch\('\/api\/login'/);
  assert.match(html, /location\.replace\('\/'\)/);
  assert.doesNotMatch(html, /<script[^>]+src="[^"]*\/entrance\.js/i);
  assert.match(runtime, /STRICT_P95_LOGIN_READY_V4/);
  assert.match(runtime, /await window\.__SETTLE_HOME_DOCUMENT_PREFETCH__\?\.\(\)/);
  assert.match(headers, /\/\r?\n\s+Cache-Control: public, max-age=5, must-revalidate/);
  assert.match(headers, /\/index\.html\r?\n\s+Cache-Control: public, max-age=5, must-revalidate/);

  const inlineSource = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1] || '';
  assert.ok(inlineSource.length > 1000, '内联入口运行时缺失');
  new vm.Script(inlineSource);
});
