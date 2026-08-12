import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* APPROVED_LAYOUT_TEAM_DRAFT_720_V2 */';

const read = (relativePath) => {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) throw new Error(`${relativePath}不存在`);
  return { file, source: fs.readFileSync(file, 'utf8') };
};
const readTemplate = (name) => fs.readFileSync(path.join(root, 'scripts/templates', name), 'utf8');
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');
const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`未找到${label}，已停止以避免误改`);
  return next;
};

const teamHistoryFrontend = readTemplate('team-history-frontend.txt');
const teamHistoryBackend = readTemplate('team-history-backend.txt');
const allMembersGuard = readTemplate('team-all-members-guard.txt');
const existingImagesFragment = readTemplate('task-existing-images-fragment.txt');
const approvedCss = readTemplate('approved-layout-team-draft-720.css');

{
  const { file, source } = read('public/app.js');
  if (!source.includes(marker)) {
    let next = source;
    next = replaceOnce(next, 'const MEDIA_THUMB_MAX_EDGE = 640;', 'const MEDIA_THUMB_MAX_EDGE = 720;', '720px前端缩略图尺寸');
    next = next.replace('const MEDIA_THUMB_MAX_SIZE_MB = 0.22;', 'const MEDIA_THUMB_MAX_SIZE_MB = 0.28;');
    next = next.replace('const MEDIA_THUMB_QUALITY = 0.82;', 'const MEDIA_THUMB_QUALITY = 0.84;');
    next = next.replace(/(data-perf-image="(?:history-thumb|plaza-thumb|plaza-detail-thumb|admin-checkin-thumb)"[\s\S]{0,260}?)width="640" height="480"/g, '$1width="720" height="540"');

    next = replaceOnce(
      next,
      '      <button id="historyCheckins"><span>✓</span><strong>历史打卡</strong><small>查看记录</small></button>',
      '      <button id="historyCheckins"><span>✓</span><strong>个人累计</strong><small>${Number(checkinStats.personalDays || 0)}天 · 查看</small></button>',
      '个人累计入口'
    );
    next = replaceOnce(
      next,
      '      <button id="teamCheckinStats"><span>◇</span><strong>队伍累计</strong><small>${dashboard.teamSummary?.team ? `${Number(checkinStats.teamDays || 0)}天` : \'未加入\'}</small></button>',
      '      <button id="teamCheckinStats"><span>◇</span><strong>队伍累计</strong><small>${dashboard.teamSummary?.team ? `${Number(checkinStats.teamDays || 0)}天 · 查看` : \'未加入\'}</small></button>',
      '队伍累计入口'
    );

    const oldTeamClick = [
      "  document.querySelector('#teamCheckinStats').onclick = () => void openDialog({",
      "    title: '队伍累计打卡',",
      "    message: dashboard.teamSummary?.team",
      "      ? `${dashboard.teamSummary.team.name} 已累计完成 ${Number(checkinStats.teamDays || 0)} 天队伍汇总提交。`",
      "      : '当前尚未加入队伍。',",
      "    notice: true,",
      "    confirmText: '知道了'",
      "  });"
    ].join('\n');
    next = replaceOnce(next, oldTeamClick, "  document.querySelector('#teamCheckinStats').onclick = () => void openTeamCheckinHistory();", '队伍累计历史入口事件');

    next = replaceOnce(next, '<h2 id="historyDrawerTitle">历史打卡</h2>', '<h2 id="historyDrawerTitle">个人累计打卡</h2>', '个人累计抽屉标题');
    next = replaceOnce(next, '<p class="muted">正在读取历史打卡…</p>', '<p class="muted">正在读取个人打卡记录…</p>', '个人历史加载文字');
    next = replaceOnce(next, 'function memberCheckinForm(task) {', `${teamHistoryFrontend}function memberCheckinForm(task) {`, '队伍累计历史函数位置');

    const oldCaptainButton = "${task.isCaptain ? `<button class=\"secondary\" data-task=\"${task.id}\" ${task.availabilityError || ['submitted','approved'].includes(task.submission?.status) ? 'disabled' : ''}>${task.submission ? '继续编辑队伍作品' : '队长汇总提交'}</button>` : '<p class=\"muted\">队伍作品由管理员指定的队长汇总提交。</p>'}";
    const newCaptainButton = "${task.isCaptain ? `<button class=\"secondary\" data-task=\"${task.id}\" ${task.availabilityError || Number(task.teamProgress?.total || 0) === 0 || Number(task.teamProgress?.completed || 0) < Number(task.teamProgress?.total || 0) || ['submitted','approved'].includes(task.submission?.status) ? 'disabled' : ''}>${task.submission ? '继续编辑队伍作品' : '队长汇总提交'}</button>${Number(task.teamProgress?.total || 0) > 0 && Number(task.teamProgress?.completed || 0) < Number(task.teamProgress?.total || 0) ? '<p class=\"bad\">所有队员完成当天个人打卡后，队长才能汇总提交。</p>' : ''}` : '<p class=\"muted\">队伍作品由管理员指定的队长汇总提交。</p>'}";
    next = replaceOnce(next, oldCaptainButton, newCaptainButton, '队伍全员完成前禁用汇总按钮');

    next = replaceOnce(next, '<div class="image-preview" id="taskPreview"></div>', existingImagesFragment, '草稿已保存图片回填');
    next = replaceOnce(next, "  const form = document.querySelector('#taskSend');", "  const form = document.querySelector('#taskSend');\n  prepareDynamicContent(app);", '队伍草稿图片交互绑定');

    const oldPlazaField = /      \$\{user\.trackId === 'interaction' \? `<label class="check-label"><input name="isPublic" type="checkbox" \$\{current\?\.isPublic \? 'checked' : ''\}>[^\n]*<\/label>\r?\n      <div id="plazaCopyField"[\s\S]*?<\/div>` : ''\}/;
    const newPlazaField = "      ${user.trackId === 'interaction' ? `<label class=\"check-label\"><input name=\"isPublic\" type=\"checkbox\" ${current?.isPublic ? 'checked' : ''}> 同意发布至活动广场</label>` : ''}";
    next = replaceOnce(next, oldPlazaField, newPlazaField, '删除广场二次文案字段');
    next = replaceOnce(
      next,
      /  if \(form\.isPublic\) form\.isPublic\.onchange = \(\) => \{\r?\n    document\.querySelector\('#plazaCopyField'\)\.style\.display = form\.isPublic\.checked \? 'block' : 'none';\r?\n  \};\r?\n/,
      '',
      '删除广场二次文案显示事件'
    );
    next = next.replaceAll("plazaCopy: form.plazaCopy?.value || ''", 'plazaCopy: form.copy.value');

    /* PREPARED_ADMIN_POST_GRID_MATCH_V3 */


    write(file, marker + '\n' + next);
  }
}

{
  const { file, source } = read('cloudflare/routes/student.js');
  if (!source.includes(marker)) {
    let next = source;
    next = replaceOnce(next, '    const plazaCopy = cleanText(body.plazaCopy, 2000);', '    const plazaCopy = cleanText(body.copy, 2000);', '广场文案复用活动文案');
    next = replaceOnce(next, /    if \(intent === 'submitted' && isPublic && !plazaCopy\) return json\(\{ error: '[^']*' \}, 400\);\r?\n/, '', '删除广场二次文案后端校验');
    next = replaceOnce(next, /    const intent = body\.intent === 'draft' \? 'draft' : 'submitted';\r?\n/, "    const intent = body.intent === 'draft' ? 'draft' : 'submitted';\n" + allMembersGuard, '队伍全员完成后端校验');
    /* PREPARED_TEAM_HISTORY_ANCHOR_V2 */
    next = replaceOnce(
      next,
      '  const submissionMatch = route.match',
      teamHistoryBackend + '  const submissionMatch = route.match',
      '队伍历史接口位置'
    );
    write(file, marker + '\n' + next);
  }
}

{
  const { file, source } = read('cloudflare/routes/media.js');
  if (!source.includes(marker)) {
    const next = replaceOnce(source, 'const THUMB_MAX_EDGE = 640;', 'const THUMB_MAX_EDGE = 720;', '720px服务端缩略图尺寸');
    write(file, marker + '\n' + next);
  }
}

{
  const { file, source } = read('public/style.css');
  if (!source.includes(marker)) write(file, `${source}\n${approvedCss}`);
}

console.log('Applied safe approved compact layouts, restored team workflow and upgraded thumbnails to 720px WebP.');
