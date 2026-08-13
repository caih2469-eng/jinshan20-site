import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('实体设备调试模式记录入口到第一张缩略图真实显示耗时', () => {
  const app = read('public/app.js') + '\n' + read('public/admin-client.js');
  assert.match(app, /startPhotoFlow\('history'\)/);
  assert.match(app, /startPhotoFlow\('plaza'\)/);
  assert.match(app, /startPhotoFlow\('admin-checkin'\)/);
  assert.match(app, /photoFlowDuration/);
  assert.match(app, /flowDuration/);
  assert.match(app, /cacheHint/);
});

test('性能面板仅在debugPerf模式出现并可复制安卓苹果微信QQ数据', () => {
  const app = read('public/app.js') + '\n' + read('public/admin-client.js');
  assert.match(app, /debugPerf/);
  assert.match(app, /perfDiagnosticsButton/);
  assert.match(app, /navigator\.userAgent/);
  assert.match(app, /navigator\.connection/);
  assert.match(app, /navigator\.clipboard\.writeText/);
  assert.match(app, /清空后重测/);
});
