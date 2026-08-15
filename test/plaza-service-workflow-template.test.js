import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync('deploy/plaza-service.workflow.yml', 'utf8');
const activeWorkflow = fs.readFileSync('.github/workflows/plaza-service.yml', 'utf8');
const testConfig = JSON.parse(fs.readFileSync('cloudflare/plaza-service/wrangler.test.jsonc', 'utf8'));
const productionConfig = JSON.parse(fs.readFileSync('cloudflare/plaza-service/wrangler.production.jsonc', 'utf8'));

test('广场服务工作流先验证再部署，仓库内容只读且仅允许写提交状态', () => {
  assert.match(workflow, /^name: Plaza service validation and deployment/m);
  assert.match(workflow, /^permissions:\s*\r?\n  contents: read\r?\n  statuses: write$/m);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /pull-requests: write|issues: write|actions: write/);
  assert.match(workflow, /^  validate:/m);
  assert.match(workflow, /^  deploy-test:/m);
  assert.match(workflow, /^  deploy-production:/m);
  assert.match(workflow, /needs: validate/);
  assert.match(workflow, /pnpm test -- test\/plaza-detail-fast-path\.test\.js test\/plaza-detail-instant-open\.test\.js test\/plaza-service-split\.test\.js/);
});

test('专项验证和部署直接使用已验证源码且不再生成Worker代码', () => {
  assert.match(workflow, /'scripts\/apply-plaza-detail-fast-path\.mjs'/);
  assert.match(workflow, /'scripts\/apply-plaza-detail-instant-open\.mjs'/);
  assert.match(workflow, /'templates\/plaza-detail-fast-path\.txt'/);
  const validateBlock = workflow.slice(workflow.indexOf('  validate:'), workflow.indexOf('  deploy-test:'));
  assert.match(validateBlock, /pnpm test -- test\/plaza-detail-fast-path\.test\.js/);
  assert.match(validateBlock, /verify-no-auto-patch-chain\.mjs/);
  assert.doesNotMatch(validateBlock, /- run: node scripts\/apply-plaza-detail-fast-path\.mjs/);
  assert.doesNotMatch(validateBlock, /- run: node scripts\/apply-plaza-service-split\.mjs/);
  const productionBlock = workflow.slice(workflow.indexOf('  deploy-production:'), workflow.indexOf('  publish-production-status:'));
  assert.doesNotMatch(productionBlock, /node scripts\/(?:apply|finalize)-/);
});

test('生产部署只允许main推送或main上的手动生产执行', () => {
  assert.match(workflow, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /inputs\.environment == 'production'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(workflow, /^  pull_request:/m);
  assert.match(workflow, /environment: cloudflare-production/);
});

test('工作流使用现有Cloudflare密钥并部署到正确配置', () => {
  assert.match(workflow, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /secrets\.CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /working-directory: cloudflare\/plaza-service/);
  assert.match(workflow, /pnpm exec wrangler deploy --dry-run --config wrangler\.test\.jsonc/);
  assert.match(workflow, /pnpm exec wrangler deploy --config wrangler\.test\.jsonc/);
  assert.match(workflow, /pnpm exec wrangler deploy --dry-run --config wrangler\.production\.jsonc/);
  assert.match(workflow, /pnpm exec wrangler deploy --config wrangler\.production\.jsonc/);
  assert.doesNotMatch(workflow, /cloudflare\/wrangler-action|\bnpx\s+wrangler/);
  assert.equal(testConfig.name, 'jinshan20-plaza-test');
  assert.equal(productionConfig.name, 'jinshan20-plaza');
  assert.equal(testConfig.workers_dev, false);
  assert.equal(productionConfig.workers_dev, false);
});

test('生产部署发布可读取的待处理和最终提交状态', () => {
  assert.match(workflow, /^  mark-production-pending:/m);
  assert.match(workflow, /^  publish-production-status:/m);
  assert.match(workflow, /plaza-service\/deploy-production/g);
  assert.match(workflow, /--arg state pending/);
  assert.match(workflow, /needs\.deploy-production\.result == 'success'/);
  assert.match(workflow, /actions\/runs\/\$\{GITHUB_RUN_ID\}/);
  assert.match(workflow, /\/statuses\/\$\{GITHUB_SHA\}/);
  assert.match(workflow, /always\(\)/);
});

test('authentication failures remain failures and report only the required permission action', () => {
  assert.match(workflow, /Authentication error\.\*10000/);
  assert.match(workflow, /exit "\$deploy_status"/);
  assert.match(workflow, /Workers Scripts \/ Edit/);
  assert.doesNotMatch(workflow, /continue-on-error|\|\| true/);
});

test('正式工作流与已审查模板完全一致', () => {
  assert.equal(activeWorkflow, workflow);
});
