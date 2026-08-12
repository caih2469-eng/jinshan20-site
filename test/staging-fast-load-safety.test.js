const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

test('fast load and cleanup tools reject production hosts', async () => {
  const { validateLoadBaseUrl } = await import('../scripts/staging-member-checkin-fast-load.mjs');
  const { validateCleanupBaseUrl } = await import(
    '../scripts/cleanup-staging-member-checkin-fast-load.mjs'
  );
  for (const validate of [validateLoadBaseUrl, validateCleanupBaseUrl]) {
    assert.throws(() => validate('https://jinshan20.pages.dev'), /refuses|拒绝/i);
    assert.throws(() => validate('https://production.example.com'), /refuses|拒绝/i);
    assert.equal(validate('https://jinshan20-test.pages.dev'), 'https://jinshan20-test.pages.dev');
  }
});

test('fast load uses the real fast upload chain at 700-user concurrency', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'staging-member-checkin-fast-load.mjs'),
    'utf8'
  );
  assert.match(source, /member-checkin-fast/);
  assert.match(source, /member-checkin`/);
  assert.match(source, /checkins\/history/);
  assert.match(source, /CONCURRENCY_STAGES = Object\.freeze\(\[700\]\)/);
  assert.match(source, /WRITE_RAMP_MS = 180_000/);
  assert.match(source, /activeWorkflowConcurrency:\s*700/);
  assert.match(source, /splitIntoBatches:\s*false/);
  assert.match(source, /verifyAttempts < 8/);
  assert.match(source, /attempt < 46/);
  assert.match(source, /负载测试接口未启用/);
  assert.match(source, /maxAttempts:\s*10/);
  assert.match(source, /x-idempotency-key.*idempotencyKey/s);
  assert.match(source, /record\.images\[0\]\?\.displayUrl/);
  assert.doesNotMatch(source, /upload-intents/);
  assert.doesNotMatch(source, /variant.*thumb/i);
  assert.match(source, /crypto\.randomUUID\(\)/);
});

test('legacy production upload load tool is retired', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'production-upload-load.mjs'),
    'utf8'
  );
  assert.match(source, /retired/i);
  assert.doesNotMatch(source, /\/api\/admin\/users\/.*\/makeup/);
});

test('production read load defaults to 50 and caps concurrency at 100', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'production-read-load.mjs'),
    'utf8'
  );
  assert.match(source, /LOAD_BATCH_SIZE \|\| 50/);
  assert.match(source, /requestedBatchSize > 100/);
});

test('member checkin fixture is a valid WebP within fast-upload limits', async () => {
  const fixturePath = path.join(
    __dirname,
    'fixtures',
    'member-checkin-fast-load.webp'
  );
  const file = fs.readFileSync(fixturePath);
  const metadata = await sharp(file).metadata();
  assert.equal(metadata.format, 'webp');
  assert.ok(file.length <= 300 * 1024);
  assert.ok(Math.max(metadata.width, metadata.height) <= 960);
});
