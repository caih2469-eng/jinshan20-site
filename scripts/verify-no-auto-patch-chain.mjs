import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const assetVersionSource = readFileSync('scripts/apply-build-asset-version.mjs', 'utf8');
const failures = [];
const automaticScriptNames = new Set([
  'prestart', 'start', 'poststart',
  'precheck', 'check', 'postcheck',
  'pretest', 'test', 'posttest',
  'validate'
]);
const patchCommand = /node\s+scripts\/(?:apply|finalize)-(?!build-asset-version\.mjs)[^\s&]+/g;

for (const [name, command] of Object.entries(packageJson.scripts || {})) {
  if (!automaticScriptNames.has(name)) continue;
  const matches = command.match(patchCommand) || [];
  for (const match of matches) failures.push(`package.json 的 ${name} 仍自动运行 ${match}`);
}

for (const file of readdirSync('.github/workflows').filter((name) => /\.ya?ml$/i.test(name))) {
  const path = join('.github/workflows', file);
  const content = readFileSync(path, 'utf8');
  const matches = content.match(patchCommand) || [];
  for (const match of matches) failures.push(`${path} 仍自动运行 ${match}`);
}

if (/import\(['"]\.\/(?:apply|finalize)-/.test(assetVersionSource)) {
  failures.push('apply-build-asset-version.mjs 仍会间接导入补丁生成器');
}

if (failures.length) {
  console.error('自动补丁链校验失败：');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('自动补丁链校验通过：启动、测试和部署均直接使用已提交源码。');
