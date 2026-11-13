import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const LIBS = [
  ['src/xlsx.full.min.js', 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'],
  ['src/exceljs.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js']
];

for (const [f, url] of LIBS) {
  if (!existsSync(f)) {
    console.log('首次构建：下载 ' + f + ' ...');
    const res = await fetch(url);
    if (!res.ok) throw new Error('下载失败（' + res.status + '），请手动下载后放到 ' + f);
    writeFileSync(f, Buffer.from(await res.arrayBuffer()));
    console.log('已保存到 ' + f);
  }
}

const html = readFileSync('src/index.html', 'utf8');
const css = readFileSync('src/app.css', 'utf8');
const js = readFileSync('src/app.js', 'utf8');
const lib = readFileSync('src/xlsx.full.min.js', 'utf8');
const exl = readFileSync('src/exceljs.min.js', 'utf8');

const safe = (s) => s.split('</script').join('<\\/script');

let out = html
  .replace('<link rel="stylesheet" href="app.css">', () => '<style>\n' + css + '\n</style>')
  .replace('<script src="xlsx.full.min.js"></script>', () => '<script>\n' + safe(lib) + '\n</script>')
  .replace('<script src="exceljs.min.js"></script>', () => '<script>\n' + safe(exl) + '\n</script>')
  .replace('<script src="app.js"></script>', () => '<script>\n' + safe(js) + '\n</script>');

const left = ['href="app.css"', 'src="xlsx.full.min.js"', 'src="exceljs.min.js"', 'src="app.js"'].filter((m) => out.includes(m));
if (left.length) throw new Error('inline failed: ' + left.join(', '));
writeFileSync('分栏打印.html', out, 'utf8');
console.log('built 分栏打印.html', (Buffer.byteLength(out) / 1024 / 1024).toFixed(2) + ' MB');
