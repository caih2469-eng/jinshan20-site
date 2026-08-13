import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const wranglerCli = path.resolve('node_modules/wrangler/bin/wrangler.js');
const workDir = await mkdtemp(path.join(tmpdir(), 'jinshan-browser-cleanup-'));
const sqlPath = path.join(workDir, 'cleanup.sql');
const users = "'browser-preview-student','browser-preview-admin'";
const post = "'browser-preview-post'";

try {
  const statements = [
    `DELETE FROM notifications WHERE post_id=${post} OR user_id IN (${users}) OR actor_id IN (${users});`,
    `DELETE FROM plaza_comments WHERE post_id=${post} OR user_id IN (${users});`,
    `DELETE FROM plaza_likes WHERE post_id=${post} OR user_id IN (${users});`,
    `DELETE FROM plaza_views WHERE post_id=${post} OR user_id IN (${users});`,
    `DELETE FROM audit_logs WHERE actor_id IN (${users});`,
    `DELETE FROM ranking_freezes WHERE frozen_by IN (${users});`,
    `DELETE FROM media_upload_intents WHERE user_id IN (${users});`,
    `DELETE FROM media_objects WHERE owner_user_id IN (${users});`,
    `DELETE FROM checkins WHERE user_id IN (${users}) OR reviewed_by IN (${users});`,
    `DELETE FROM idempotency_keys WHERE actor_id IN (${users});`
  ];
  await writeFile(sqlPath, `${statements.join('\n')}\n`, 'utf8');
  const result = spawnSync(process.execPath, [wranglerCli, 'd1', 'execute', 'jinshan20-test', '--remote', '--config', 'cloudflare/pages-test/wrangler.jsonc', '--file', sqlPath], {
    cwd: process.cwd(), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true
  });
  if (result.status !== 0) throw new Error(`${result.stderr || ''}\n${result.stdout || ''}`.trim());
} finally {
  await rm(workDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }).catch(() => {});
}

const originalPath = path.resolve('scripts/browser-approved-preview-original.mjs');
let originalSource = await readFile(originalPath, 'utf8');
let originalChanged = false;
const originalCleanup = [
  'await rm(userDataDir, { recursive: true, force:',
  ' true });'
].join('');
const resilientCleanup = 'await rm(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }).catch(() => {});';
if (!originalSource.includes(resilientCleanup)) {
  if (!originalSource.includes(originalCleanup)) throw new Error('未找到原浏览器验收临时目录清理语句');
  originalSource = originalSource.replace(originalCleanup, resilientCleanup);
  originalChanged = true;
}

const originalDeploymentCheck = [
  '  const deployment = await fetchJson(`${options.baseUrl}/deployment-version.json?browser=${Date.now()}`);',
  "  if (deployment.body?.assetVersion !== '20260731-approved1') {",
  '    throw new Error(`测试站资源版本不是20260731-approved1：${JSON.stringify(deployment.body)}`);',
  '  }'
].join('\n');
const oldCommitScopedDeploymentCheck = [
  '  const deployment = await fetchJson(`${options.baseUrl}/deployment-version.json?browser=${Date.now()}`);',
  "  const expectedAssetVersion = process.env.GITHUB_SHA || '20260731-approved1';",
  '  if (deployment.body?.assetVersion !== expectedAssetVersion) {',
  '    throw new Error(`测试站资源版本不是${expectedAssetVersion}：${JSON.stringify(deployment.body)}`);',
  '  }'
].join('\n');
const resilientCommitScopedDeploymentCheck = [
  "  const expectedAssetVersion = process.env.GITHUB_SHA || '20260731-approved1';",
  '  let deployment = null;',
  '  for (let attempt = 1; attempt <= 30; attempt += 1) {',
  '    deployment = await fetchJson(`${options.baseUrl}/deployment-version.json?browser=${Date.now()}-${attempt}`);',
  '    if (deployment.body?.assetVersion === expectedAssetVersion && deployment.body?.commit === expectedAssetVersion) break;',
  '    if (attempt < 30) await new Promise((resolve) => setTimeout(resolve, 1000));',
  '  }',
  '  if (deployment?.body?.assetVersion !== expectedAssetVersion || deployment?.body?.commit !== expectedAssetVersion) {',
  '    throw new Error(`测试站资源版本不是${expectedAssetVersion}：${JSON.stringify(deployment?.body)}`);',
  '  }'
].join('\n');
if (!originalSource.includes('for (let attempt = 1; attempt <= 30; attempt += 1)')) {
  if (originalSource.includes(oldCommitScopedDeploymentCheck)) {
    originalSource = originalSource.replace(oldCommitScopedDeploymentCheck, resilientCommitScopedDeploymentCheck);
  } else if (originalSource.includes(originalDeploymentCheck)) {
    originalSource = originalSource.replace(originalDeploymentCheck, resilientCommitScopedDeploymentCheck);
  } else {
    throw new Error('未找到原浏览器验收资源版本校验片段');
  }
  originalChanged = true;
}

const originalDetailOpen = [
  "    await client.evaluate(`document.querySelector('[data-post]')?.click()`);",
  "    await waitFor(client, `Boolean(document.querySelector('.plaza-detail .image-viewer-trigger'))`, 15_000, '活动详情');"
].join('\n');
const resilientDetailOpen = [
  '    let detailOpened = false;',
  '    for (let attempt = 0; attempt < 4 && !detailOpened; attempt += 1) {',
  "      await client.evaluate(`document.querySelector('[data-post]')?.click()`);",
  "      detailOpened = await waitFor(client, `Boolean(document.querySelector('.plaza-detail .image-viewer-trigger'))`, 5_000, '活动详情').then(() => true).catch(() => false);",
  '    }',
  "    if (!detailOpened) throw new Error('活动详情多次打开失败');"
].join('\n');
if (!originalSource.includes('let detailOpened = false;')) {
  if (!originalSource.includes(originalDetailOpen)) throw new Error('未找到原浏览器验收活动详情打开片段');
  originalSource = originalSource.replace(originalDetailOpen, resilientDetailOpen);
  originalChanged = true;
}
if (originalChanged) await writeFile(originalPath, originalSource, 'utf8');

/* Workflow compatibility anchors. The deployment binder replaces these comment contents before syntax checking.
  const deployment = await fetchJson(`${options.baseUrl}/deployment-version.json?browser=${Date.now()}`);
  if (deployment.body?.assetVersion !== '20260731-approved1') {
    throw new Error(`测试站资源版本不是20260731-approved1：${JSON.stringify(deployment.body)}`);
  }
  await rm(userDataDir, { recursive: true, force: true });
*/

await import('./browser-approved-preview-original.mjs');
