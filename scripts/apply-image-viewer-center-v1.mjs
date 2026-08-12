import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const marker = '/* IMAGE_VIEWER_CENTER_V1 */';
const stylePath = path.join(root, 'public', 'style.css');

if (!fs.existsSync(stylePath)) throw new Error('public/style.css不存在');
const source = fs.readFileSync(stylePath, 'utf8');
if (!source.includes(marker)) {
  const css = `

${marker}
/* Keep the original image centered in the usable viewport on WeChat and mobile browsers. */
.image-viewer { display: block; padding: 0; overflow: hidden; }
.image-viewer-stage {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  overflow: auto;
}
.image-viewer-stage .image-shell {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: auto;
  height: auto;
  max-width: 100vw;
  max-height: 100vh;
  max-height: 100dvh;
  aspect-ratio: auto;
  overflow: visible;
  animation: none;
  background: #050507;
}
.image-viewer-stage .image-shell img {
  display: block;
  width: auto;
  height: auto;
  max-width: 100vw;
  max-height: 100vh;
  max-height: 100dvh;
  object-fit: contain;
}
`;
  fs.writeFileSync(stylePath, `${source.trimEnd()}${css}`, 'utf8');
}

const result = fs.readFileSync(stylePath, 'utf8');
if (!result.includes(marker)
    || !result.includes('align-items: center;')
    || !result.includes('justify-content: center;')
    || !result.includes('width: auto;')
    || !result.includes('height: auto;')
    || !result.includes('object-fit: contain;')) {
  throw new Error('高清原图居中样式生成不完整');
}

console.log('Applied centered high-resolution image viewer without changing image quality.');
