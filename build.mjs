import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// SheetJS 不打进仓库（950 KB 第三方代码），构建时按需下载并内联
const LIB = 'src/xlsx.full.min.js';
const LIB_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';

if (!existsSync(LIB)) {
  console.log('首次构建：下载 SheetJS ...');
  const res = await fetch(LIB_URL);
  if (!res.ok) throw new Error('下载失败（' + res.status + '），请手动下载后放到 ' + LIB);
  writeFileSync(LIB, Buffer.from(await res.arrayBuffer()));
  console.log('已保存到 ' + LIB);
}

const html = readFileSync('src/index.html', 'utf8');
const css = readFileSync('src/app.css', 'utf8');
const js = readFileSync('src/app.js', 'utf8');
const lib = readFileSync(LIB, 'utf8');

const safe = (s) => s.split('</script').join('<\/script');

let out = html
  .replace('<link rel="stylesheet" href="app.css">', () => '<style>\n' + css + '\n</style>')
  .replace('<script src="xlsx.full.min.js"></script>', () => '<script>\n' + safe(lib) + '\n</script>')
  .replace('<script src="app.js"></script>', () => '<script>\n' + safe(js) + '\n</script>');

const left = ['href="app.css"', 'src="xlsx.full.min.js"', 'src="app.js"'].filter((m) => out.includes(m));
if (left.length) throw new Error('内联失败：' + left.join(', '));

writeFileSync('index.html', out, 'utf8');
console.log('已生成 index.html  ' + (out.length / 1024 / 1024).toFixed(2) + ' MB');
