import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createMediaSigningAlignmentProof } from '../cloudflare/lib/media-signing.js';

const read = (file) => fs.readFileSync(file, 'utf8');
const parseJson = (file) => JSON.parse(read(file));
const proofChallenge = '123e4567-e89b-12d3-a456-426614174000';

execFileSync(process.execPath, ['scripts/apply-checkin-service-split.mjs'], { stdio: 'pipe' });

const mainWorkerSource = read('cloudflare/worker.js');
const studentRouteSource = read('cloudflare/routes/student.js');
const workflowSource = read('.github/workflows/checkin-service.yml');
const performanceBuildSource = read('scripts/apply-approved-performance-diagnostics.mjs');
const smokeWorkflowSource = read('.github/workflows/checkin-binding-smoke.yml');

test('independent check-in Worker rejects public access and unrelated routes', async () => {
  const childWorker = (await import(`../cloudflare/checkin-worker.js?test=${Date.now()}`)).default;
  const denied = await childWorker.fetch(
    new Request('https://internal.test/api/checkins'),
    {},
    { waitUntil() {} }
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('x-jinshan-service'), 'checkin');
  assert.equal(denied.headers.get('x-jinshan-service-version'), 'checkin-v1');

  const unrelated = await childWorker.fetch(
    new Request('https://internal.test/api/student-dashboard', {
      headers: { 'x-jinshan-internal-service': 'checkin-v1' }
    }),
    {},
    { waitUntil() {} }
  );
  assert.equal(unrelated.status, 404);
});

test('internal service requires a matching media signing proof without exposing it', async () => {
  const childWorker = (await import(`../cloudflare/checkin-worker.js?health=${Date.now()}`)).default;
  const missing = await childWorker.fetch(
    new Request('https://internal.test/api/checkin-service-health', {
      headers: {
        'x-jinshan-internal-service': 'checkin-v1',
        'x-jinshan-checkin-proof-challenge': proofChallenge,
        'x-jinshan-checkin-proof': 'invalid-proof'
      }
    }),
    { ENVIRONMENT: 'test', DB: {}, UPLOADS: {} },
    { waitUntil() {} }
  );
  assert.equal(missing.status, 503);
  assert.deepEqual(await missing.json(), {
    ok: false,
    error: '打卡服务媒体签名尚未对齐',
    service: 'checkin',
    version: 'checkin-v1',
    environment: 'test',
    database: true,
    storage: true,
    mediaSigning: false,
    mediaSigningAligned: false
  });

  const secret = 'test-secret';
  const proof = await createMediaSigningAlignmentProof(
    { MEDIA_SIGNING_SECRET: secret },
    proofChallenge
  );
  const ready = await childWorker.fetch(
    new Request('https://internal.test/api/checkin-service-health', {
      headers: {
        'x-jinshan-internal-service': 'checkin-v1',
        'x-jinshan-checkin-proof-challenge': proofChallenge,
        'x-jinshan-checkin-proof': proof
      }
    }),
    { ENVIRONMENT: 'test', DB: {}, UPLOADS: {}, MEDIA_SIGNING_SECRET: secret },
    { waitUntil() {} }
  );
  assert.equal(ready.status, 200);
  assert.equal(ready.headers.get('x-jinshan-service'), 'checkin');
  assert.equal(ready.headers.get('x-jinshan-service-version'), 'checkin-v1');
  assert.deepEqual(await ready.json(), {
    ok: true,
    service: 'checkin',
    version: 'checkin-v1',
    environment: 'test',
    database: true,
    storage: true,
    mediaSigning: true,
    mediaSigningAligned: true
  });
});

test('main Worker and real child Worker accept matching signing secrets', async () => {
  const mainWorker = (await import(`../cloudflare/worker.js?alignment=${Date.now()}`)).default;
  const childWorker = (await import(`../cloudflare/checkin-worker.js?alignment=${Date.now()}`)).default;
  const secret = 'shared-media-secret';
  const response = await mainWorker.fetch(
    new Request('https://example.test/api/checkin-service-health'),
    {
      MEDIA_SIGNING_SECRET: secret,
      CHECKIN_SERVICE: {
        fetch(request) {
          return childWorker.fetch(request, {
            ENVIRONMENT: 'test',
            DB: {},
            UPLOADS: {},
            MEDIA_SIGNING_SECRET: secret
          }, { waitUntil() {} });
        }
      }
    },
    { waitUntil() {} }
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-jinshan-service-version'), 'checkin-v1');
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.mediaSigningAligned, true);
  assert.equal(Object.hasOwn(body, 'mediaSigningProof'), false);
});

test('main Worker rejects a real child Worker configured with a different signing secret', async () => {
  const mainWorker = (await import(`../cloudflare/worker.js?mismatch=${Date.now()}`)).default;
  const childWorker = (await import(`../cloudflare/checkin-worker.js?mismatch=${Date.now()}`)).default;
  const response = await mainWorker.fetch(
    new Request('https://example.test/api/checkin-service-health'),
    {
      MEDIA_SIGNING_SECRET: 'main-secret',
      CHECKIN_SERVICE: {
        fetch(request) {
          return childWorker.fetch(request, {
            ENVIRONMENT: 'test',
            DB: {},
            UPLOADS: {},
            MEDIA_SIGNING_SECRET: 'different-child-secret'
          }, { waitUntil() {} });
        }
      }
    },
    { waitUntil() {} }
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.mediaSigningAligned, false);
  assert.equal(Object.hasOwn(body, 'mediaSigningProof'), false);
});

test('internal check-in request reuses the existing route contract', async () => {
  const childWorker = (await import(`../cloudflare/checkin-worker.js?contract=${Date.now()}`)).default;
  const statement = {
    bind() { return this; },
    async all() { return { results: [] }; },
    async first() { return null; },
    async run() { return { meta: { changes: 0 } }; }
  };
  const secret = 'test-secret';
  const proof = await createMediaSigningAlignmentProof(
    { MEDIA_SIGNING_SECRET: secret },
    proofChallenge
  );
  const response = await childWorker.fetch(
    new Request('https://internal.test/api/checkins?date=2026-08-05', {
      headers: {
        'x-jinshan-internal-service': 'checkin-v1',
        'x-jinshan-checkin-proof-challenge': proofChallenge,
        'x-jinshan-checkin-proof': proof,
        'x-jinshan-checkin-user': encodeURIComponent(JSON.stringify({
          id: 'user-1', role: 'student', trackId: 'health', status: 'active'
        }))
      }
    }),
    { DB: { prepare() { return statement; } }, ENVIRONMENT: 'test', MEDIA_SIGNING_SECRET: secret },
    { waitUntil() {} }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { checkins: [] });
  assert.equal(response.headers.get('x-jinshan-service-version'), 'checkin-v1');
});

test('independent check-in Worker retries the complete idempotent member PUT on D1 overload', () => {
  const source = read('cloudflare/checkin-worker.js');
  assert.match(source, /retryD1Overload/);
  assert.match(source, /memberCheckinWrite/);
  assert.match(source, /handleStudentRoutes\(request\.clone\(\), env, ctx, url, user\)/);
  assert.match(source, /maxAttempts:\s*5/);
});

test('main Worker forwards only check-in routes and keeps safe fallback semantics', () => {
  const allowlistBlock = mainWorkerSource.slice(
    mainWorkerSource.indexOf('const isCheckinServiceRoute'),
    mainWorkerSource.indexOf('const checkinInternalUser')
  );
  assert.match(mainWorkerSource, /CHECKIN_SERVICE_BINDING_V1/);
  assert.match(mainWorkerSource, /const CHECKIN_HEALTH_PATH = '\/api\/checkin-service-health'/);
  assert.match(allowlistBlock, /pathname === '\/api\/checkins'/);
  assert.match(allowlistBlock, /pathname === '\/api\/checkins\/history'/);
  assert.match(allowlistBlock, /member-checkin/);
  assert.doesNotMatch(allowlistBlock, /submission|public-images|media|plaza/);
  assert.match(mainWorkerSource, /createMediaSigningAlignmentProof/);
  assert.match(mainWorkerSource, /CHECKIN_PROOF_CHALLENGE_HEADER/);
  assert.match(mainWorkerSource, /CHECKIN_PROOF_HEADER/);
  assert.match(mainWorkerSource, /challenge = crypto\.randomUUID\(\)/);
  assert.match(mainWorkerSource, /proof = await createMediaSigningAlignmentProof\(env, challenge\)/);
  assert.match(mainWorkerSource, /headers\.set\(CHECKIN_PROOF_HEADER, proof\)/);
  assert.match(mainWorkerSource, /isSafeCheckinLocalFallback/);
  assert.match(mainWorkerSource, /打卡服务尚未完成媒体签名配置/);
  assert.match(mainWorkerSource, /env\.CHECKIN_SERVICE\.fetch\(serviceRequest\)/);
  assert.match(mainWorkerSource, /const isHealth = url\.pathname === CHECKIN_HEALTH_PATH/);
  assert.match(mainWorkerSource, /request\.method === 'GET' \|\| request\.method === 'HEAD'/);
  assert.match(mainWorkerSource, /打卡服务暂时不可用，请稍后重试/);
});

test('main Worker strips forged headers and passes only minimal user fields', () => {
  assert.match(mainWorkerSource, /headers\.delete\(CHECKIN_USER_HEADER\)/);
  assert.match(mainWorkerSource, /headers\.delete\(CHECKIN_SERVICE_HEADER\)/);
  assert.match(mainWorkerSource, /headers\.delete\(CHECKIN_PROOF_CHALLENGE_HEADER\)/);
  assert.match(mainWorkerSource, /headers\.delete\(CHECKIN_PROOF_HEADER\)/);
  const block = mainWorkerSource.slice(
    mainWorkerSource.indexOf('const checkinInternalUser'),
    mainWorkerSource.indexOf('const normalizedCheckinHealthResponse')
  );
  assert.match(block, /id: user\.id/);
  assert.match(block, /role: user\.role/);
  assert.match(block, /trackId: user\.trackId/);
  assert.match(block, /status: user\.status/);
  assert.doesNotMatch(block, /studentId|name|password|token|cookie|authorization/i);
});

test('student routes accept trusted internal users without changing local authentication', () => {
  assert.match(studentRouteSource, /CHECKIN_SERVICE_ROUTE_V1/);
  assert.match(studentRouteSource, /authenticatedUser = null/);
  assert.match(studentRouteSource, /authenticatedUser \? \{ user: authenticatedUser \} : await requireUser/);
});

test('test and production Worker configs bind isolated resources and require signing', () => {
  const testConfig = parseJson('cloudflare/checkin-service/wrangler.test.jsonc');
  const productionConfig = parseJson('cloudflare/checkin-service/wrangler.production.jsonc');
  assert.equal(testConfig.name, 'jinshan20-checkin-test');
  assert.equal(productionConfig.name, 'jinshan20-checkin');
  assert.equal(testConfig.workers_dev, false);
  assert.equal(productionConfig.workers_dev, false);
  assert.equal(testConfig.d1_databases[0].database_id, '6d217199-0c06-45a3-8bdc-e32c36140957');
  assert.equal(productionConfig.d1_databases[0].database_id, '1734a812-afc8-4c49-a1f1-f776c4b7ae69');
  assert.equal(testConfig.r2_buckets[0].bucket_name, 'jinshan20-test');
  assert.equal(productionConfig.r2_buckets[0].bucket_name, 'jinshan20');
  assert.deepEqual(testConfig.secrets.required, ['MEDIA_SIGNING_SECRET']);
  assert.deepEqual(productionConfig.secrets.required, ['MEDIA_SIGNING_SECRET']);
});

test('stage two binds Pages traffic to the matching check-in Worker', () => {
  const testPages = parseJson('cloudflare/pages-test/wrangler.jsonc');
  const productionPages = parseJson('cloudflare/pages-production/wrangler.jsonc');
  const testBinding = (testPages.services || []).find((item) => item.binding === 'CHECKIN_SERVICE');
  const productionBinding = (productionPages.services || []).find((item) => item.binding === 'CHECKIN_SERVICE');
  assert.deepEqual(testBinding, { binding: 'CHECKIN_SERVICE', service: 'jinshan20-checkin-test' });
  assert.deepEqual(productionBinding, { binding: 'CHECKIN_SERVICE', service: 'jinshan20-checkin' });
  assert.match(performanceBuildSource, /await import\('\.\/apply-checkin-service-split\.mjs'\)/);
  assert.match(workflowSource, /checkin-service\/deploy-production/);
  assert.match(workflowSource, /Workers R2 Storage \/ Edit/);
  assert.doesNotMatch(workflowSource, /continue-on-error/);
});

test('production smoke workflow verifies live aligned checkin-v1 service', () => {
  assert.match(smokeWorkflowSource, /Check-in binding production smoke/);
  assert.match(smokeWorkflowSource, /api\/checkin-service-health/);
  assert.match(smokeWorkflowSource, /x-jinshan-service-version/);
  assert.match(smokeWorkflowSource, /checkin-v1/);
  assert.match(smokeWorkflowSource, /mediaSigningAligned/);
  assert.match(smokeWorkflowSource, /checkin-binding\/production-smoke/);
  assert.doesNotMatch(smokeWorkflowSource, /continue-on-error/);
});

test('check-in service split generator is idempotent', () => {
  const firstRoute = read('cloudflare/routes/student.js');
  const firstWorker = read('cloudflare/worker.js');
  execFileSync(process.execPath, ['scripts/apply-checkin-service-split.mjs'], { stdio: 'pipe' });
  assert.equal(read('cloudflare/routes/student.js'), firstRoute);
  assert.equal(read('cloudflare/worker.js'), firstWorker);
});
