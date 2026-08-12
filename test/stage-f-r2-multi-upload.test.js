const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

const functionBlock = (start, end) => {
  const from = appSource.indexOf(start);
  const to = appSource.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `缺少起点：${start}`);
  assert.notEqual(to, -1, `缺少终点：${end}`);
  return appSource.slice(from, to);
};

test('阶段F：上传确认正常路径只执行一次range GET，元数据不足才回退HEAD', async () => {
  const moduleUrl = pathToFileURL(path.join(root, 'cloudflare', 'routes', 'media.js')).href;
  const { inspectUploadedObject } = await import(moduleUrl);
  const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  let getCount = 0;
  let headCount = 0;
  const complete = await inspectUploadedObject({
    UPLOADS: {
      get: async (_key, options) => {
        getCount += 1;
        assert.deepEqual(options, { range: { offset: 0, length: 16 } });
        return {
          body: bytes,
          size: 38_000,
          httpMetadata: { contentType: 'image/webp' },
          httpEtag: '"complete"'
        };
      },
      head: async () => {
        headCount += 1;
        throw new Error('完整元数据时不应HEAD');
      }
    }
  }, 'media/test.webp');
  assert.equal(getCount, 1);
  assert.equal(headCount, 0);
  assert.equal(complete.size, 38_000);
  assert.equal(complete.contentType, 'image/webp');
  assert.equal(complete.usedHeadFallback, false);

  getCount = 0;
  headCount = 0;
  const fallback = await inspectUploadedObject({
    UPLOADS: {
      get: async () => {
        getCount += 1;
        return { body: bytes };
      },
      head: async () => {
        headCount += 1;
        return {
          size: 38_000,
          httpMetadata: { contentType: 'image/webp' },
          httpEtag: '"fallback"'
        };
      }
    }
  }, 'media/test.webp');
  assert.equal(getCount, 1);
  assert.equal(headCount, 1);
  assert.equal(fallback.usedHeadFallback, true);
  assert.equal(fallback.etag, '"fallback"');
});

test('阶段F：任务和材料多图选择后立即预览，并复用独立上传会话', () => {
  const materialBlock = functionBlock('function materialSubmissionForm', 'function taskSubmissionForm');
  const taskBlock = functionBlock('function taskSubmissionForm', 'async function inbox');
  for (const block of [materialBlock, taskBlock]) {
    assert.match(block, /createMediaUploadSession\(/);
    assert.match(block, /mediaSession\?\.promise/);
    assert.match(block, /mediaSession\?\.release\(\)/);
    assert.doesNotMatch(block, /await readFiles\(/);
  }
  const sessionBlock = functionBlock('const createMediaUploadSession', 'const readFiles');
  assert.ok(
    sessionBlock.indexOf('renderPreviews(ui.previewContainer') < sessionBlock.indexOf('session.promise = runIndexes'),
    '本地预览必须早于压缩、上传和确认请求'
  );
});

test('阶段F：多图并发受控，失败图可单独重试且成功图不重复上传', () => {
  assert.match(appSource, /return isIOS \|\| embeddedBrowser \|\| lowMemory \? 1 : 2;/);
  const sessionBlock = functionBlock('const createMediaUploadSession', 'const readFiles');
  assert.match(sessionBlock, /if \(session\.results\[index\]\) return;/);
  assert.match(sessionBlock, /let prepared = session\.partial\[index\]\?\.prepared;/);
  assert.match(sessionBlock, /let pair = session\.partial\[index\]\?\.pair;/);
  assert.match(sessionBlock, /session\.partial\[index\] = \{ prepared, pair \};/);
  assert.match(sessionBlock, /session\.results\[index\] = \{ \.\.\.pair\.display, thumbMediaId: pair\.thumb\.mediaId \};/);
  assert.match(sessionBlock, /const indexes = \[\.\.\.session\.errors\.keys\(\)\];/);
  assert.match(sessionBlock, /Math\.min\(uploadConcurrency\(\), indexes\.length\)/);
  assert.match(sessionBlock, /第 \$\{failed\} 张图片处理失败，可单独重试失败图片。/);
});

test('阶段F：确认后的多张媒体以固定次数批量认领，不按图片逐条查询D1', async () => {
  const runtimeUrl = pathToFileURL(path.join(root, 'cloudflare', 'lib', 'runtime.js')).href;
  const { claimConfirmedMedia } = await import(runtimeUrl);
  const ids = ['media-a', 'media-b', 'media-c'];
  let queryCount = 0;
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...bindings) {
            return {
              async all() {
                queryCount += 1;
                if (sql.includes('JOIN media_upload_intents')) {
                  assert.deepEqual(bindings.slice(0, 3), ['user-1', 'task-1', 'task']);
                  return {
                    results: ids.map((id) => ({
                      id,
                      objectKey: `${id}.webp`,
                      contentType: 'image/webp',
                      bytes: 40_000,
                      width: 960,
                      height: 720,
                      businessId: null,
                      intentStatus: 'confirmed'
                    }))
                  };
                }
                return {
                  results: ids.map((id) => ({
                    id: `${id}-thumb`,
                    objectKey: `${id}-thumb.webp`,
                    contentType: 'image/webp',
                    bytes: 8_000,
                    width: 360,
                    height: 270,
                    businessId: id
                  }))
                };
              }
            };
          }
        };
      }
    }
  };
  const claimed = await claimConfirmedMedia(
    env,
    ids,
    { id: 'user-1' },
    'task-1',
    'task',
    3
  );
  assert.equal(queryCount, 2);
  assert.deepEqual(claimed.map((item) => item.id), ids);
  assert.deepEqual(claimed.map((item) => item.thumb.id), ids.map((id) => `${id}-thumb`));
});
