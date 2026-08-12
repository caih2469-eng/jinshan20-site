import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* PLAZA_UNDER_1S_AND_MEMBER_IMAGE_LIMIT_V1 */';
const read = (relative) => {
  const file = path.join(root, relative);
  return { file, source: fs.readFileSync(file, 'utf8') };
};
const write = (file, source) => fs.writeFileSync(file, source, 'utf8');
const replaceOnce = (source, search, replacement, label) => {
  if (!source.includes(search)) throw new Error(`Required source block is missing: ${label}`);
  return source.replace(search, replacement);
};

{
  const { file, source } = read('scripts/student-admin-flow.template.js');
  if (!source.includes(marker)) {
    const alreadyAligned = source.includes('Number(effectiveTask.memberImageLimit || effectiveTask.imageLimit)')
      && source.includes('Math.min(8, Math.max(1,');
    const next = alreadyAligned ? source : replaceOnce(source,
      'const imageLimit = Math.max(1, Number(effectiveTask.memberImageLimit) || 1);',
      'const imageLimit = Math.max(1, Math.min(8, Number(effectiveTask.memberImageLimit || effectiveTask.imageLimit) || 1));',
      'member check-in image-limit source');
    write(file, `${marker}\n${next}`);
  }
}

{
  const { file, source } = read('cloudflare/routes/student.js');
  if (!source.includes(marker)) {
    const alreadyAligned = source.includes('Number(effectiveTask.memberImageLimit || effectiveTask.imageLimit)')
      && source.includes('Math.min(8, Math.max(1,');
    const next = alreadyAligned ? source : replaceOnce(source,
      'const imageLimit = Math.max(1, Number(effectiveTask.memberImageLimit) || 1);',
      'const imageLimit = Math.max(1, Math.min(8, Number(effectiveTask.memberImageLimit || effectiveTask.imageLimit) || 1));',
      'generated member check-in image-limit source');
    write(file, `${marker}\n${next}`);
  }
}

{
  const { file, source } = read('public/app.js');
  let next = source;
  const hasPrefetchReuse = next.includes('studentPlazaPrefetchPromise || prefetchStudentPlaza()')
    && next.includes('const preloadedResult = firstPagePromise');
  if (!next.includes(marker)) next = `${marker}\n${next}`;
  if (!hasPrefetchReuse) {
    const replacement = `  // Reuse the bootstrap/home prefetch instead of issuing a second D1 request when the\n  // user enters Plaza immediately after the home screen becomes interactive.\n  const firstPagePromise = safeSort === 'latest' && page === 1 && !safeQuery\n    ? (studentPlazaPrefetchPromise || prefetchStudentPlaza())\n    : null;\n  const preloadedResult = firstPagePromise\n    ? await Promise.resolve(firstPagePromise).catch(() => null)\n    : null;\n  const result = preloadedResult || await api(path);`;
    const bootstrapBlock = `  const bootstrapResult = safeSort === 'latest' && page === 1 && !safeQuery\n    ? await Promise.resolve(window.__BOOTSTRAP_PLAZA_PROMISE__).catch(() => null)\n    : null;\n  const result = bootstrapResult || await api(path);`;
    const directResult = /  const result = await api\(path\);\n(?=  writeViewCache\(plazaViewCache, cacheKey, result\);)/;
    if (next.includes(bootstrapBlock)) {
      next = replaceOnce(next, bootstrapBlock, replacement, 'Plaza bootstrap result');
    } else {
      const plazaStart = next.indexOf('async function plaza(');
      const plazaEnd = next.indexOf('const renderAdminCommentsPage', plazaStart);
      const beforePlaza = next.slice(0, plazaStart);
      const plazaSection = next.slice(plazaStart, plazaEnd);
      const afterPlaza = next.slice(plazaEnd);
      if (plazaStart < 0 || plazaEnd < plazaStart || !directResult.test(plazaSection)) {
        throw new Error('Required source block is missing: Plaza direct result');
      }
      next = `${beforePlaza}${plazaSection.replace(directResult, replacement)}${afterPlaza}`;
    }
  }
  if (!next.includes('2048w')) {
    throw new Error('The 2048w detail-image quality contract is missing; aborting generation.');
  }
  if (next !== source) write(file, next);
}

for (const [relative, required] of [
  ['scripts/student-admin-flow.template.js', marker],
  ['cloudflare/routes/student.js', marker],
  ['cloudflare/routes/student.js', 'Number(effectiveTask.memberImageLimit || effectiveTask.imageLimit)'],
  ['public/app.js', marker],
  ['public/app.js', 'studentPlazaPrefetchPromise || prefetchStudentPlaza()'],
  ['public/app.js', "preload.fetchPriority = index < 2 ? 'high' : 'auto';"],
  ['public/app.js', '2048w']
]) {
  if (!read(relative).source.includes(required)) {
    throw new Error(`Generated-source verification failed: ${relative} is missing ${required}`);
  }
}

console.log('Applied under-1s Plaza request reuse and aligned member check-in image limits without reducing image quality.');
