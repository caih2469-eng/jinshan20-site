import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = 'INLINE_ENTRANCE_CRITICAL_V1';
const read = (relativePath) => {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) throw new Error(`${relativePath}不存在`);
  return { file, source: fs.readFileSync(file, 'utf8') };
};
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');

const entrance = read('public/entrance.html');
if (!entrance.source.includes(marker)) {
  const runtime = read('public/entrance.js').source;
  const scriptPattern = /\s*<script defer src="([^"]*\/entrance\.js[^"]*)"><\/script>/;
  const scriptMatch = entrance.source.match(scriptPattern);
  if (!scriptMatch) throw new Error('未找到最终入口页外部脚本，已停止以避免误改');
  if (!runtime.includes('STRICT_P95_LOGIN_READY_V4')
      || !runtime.includes("loginForm.addEventListener('submit'")) {
    throw new Error('入口页关键登录逻辑尚未生成完整');
  }
  const inlineRuntime = runtime.replace(/<\/script/gi, '<\\/script');
  const inline = [
    '',
    `  <!-- ${marker} source=${scriptMatch[1]} -->`,
    '  <script>',
    inlineRuntime,
    '  </script>'
  ].join('\n');
  let next = entrance.source.replace(scriptPattern, inline);
  const homePrefetch = [
    '    <!-- HOME_DOCUMENT_PREFETCH_V2: bounded cache warmup; never reuse a stalled request -->',
    '    <script>',
    '    (() => {',
    '      let controller = null;',
    '      let request = Promise.resolve();',
    '      let settled = true;',
    '      const start = () => {',
    '        controller = new AbortController();',
    '        settled = false;',
    '        const timeout = setTimeout(() => controller.abort(), 1200);',
    "        request = fetch('/', { credentials: 'same-origin', cache: 'default', signal: controller.signal })",
    '          .then((response) => response.ok ? response.arrayBuffer() : null)',
    '          .catch(() => null)',
    '          .finally(() => { settled = true; clearTimeout(timeout); });',
    '      };',
    "      addEventListener('load', () => setTimeout(start, 0), { once: true });",
    '      window.__SETTLE_HOME_DOCUMENT_PREFETCH__ = async () => {',
    '        if (controller && !settled) controller.abort();',
    '        await request;',
    '      };',
    '    })();',
    '    </script>'
  ].join('\n');
  next = next.replace('</head>', `${homePrefetch}\n</head>`);
  write(entrance.file, next);
}

const html = read('public/entrance.html').source;
if (!html.includes(marker)
    || !html.includes('HOME_DOCUMENT_PREFETCH_V2')
    || !html.includes("controller.abort(), 1200")
    || !html.includes("addEventListener('load', () => setTimeout(start, 0)")
    || !html.includes('response.arrayBuffer()')
    || !html.includes('__SETTLE_HOME_DOCUMENT_PREFETCH__')
    || !html.includes("loginForm.addEventListener('submit'")
    || !html.includes('STRICT_P95_LOGIN_READY_V4')
    || /<script[^>]+src="[^"]*\/entrance\.js/i.test(html)) {
  throw new Error('代理线路入口页关键请求合并生成不完整');
}

console.log('Applied proxy-route critical path: inline login runtime and bounded reusable home-document prefetch.');
