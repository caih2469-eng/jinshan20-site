import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('public/app.js');
let source = fs.readFileSync(file, 'utf8');
const start = source.indexOf('async function openPlazaPost');
if (start >= 0 && source.slice(start).includes('plaza-detail-page')) {
  const pattern = /^(?:async\s+function|function|const|let|class)\s+[A-Za-z_$][\w$]*/gm;
  pattern.lastIndex = start + 1;
  const end = pattern.exec(source)?.index ?? source.length;
  const section = source.slice(start, end);
  const fixed = section.replaceAll('</section></div>`', '</section>`');
  if (fixed !== section) {
    source = source.slice(0, start) + fixed + source.slice(end);
    fs.writeFileSync(file, source, 'utf8');
  }
  const finalSection = (fixed || section);
  if (finalSection.includes('modal-backdrop') || finalSection.includes('</section></div>`')) {
    throw new Error('活动广场独立详情页仍残留浮窗包装标签');
  }
}

console.log('Finalized full-page Plaza detail markup.');
