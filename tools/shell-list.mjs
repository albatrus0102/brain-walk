// sw.js 의 SHELL_FILES 가 실제 파일과 맞는지 확인/갱신합니다.
//   node tools/shell-list.mjs          → 확인 (틀리면 종료코드 1)
//   node tools/shell-list.mjs --write  → sw.js 의 목록을 새로 써 넣기
import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const walk = d => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = ['index.html', 'manifest.webmanifest', 'firebase-config.js', ...walk('js'), ...walk('styles'), 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon-180.png', 'icons/badge-72.png']
  .filter(f => !f.endsWith('.svg')).sort();
const list = '[\n  ' + ['./', ...files.map(f => './' + f)].map(f => JSON.stringify(f)).join(',\n  ') + '\n]';
const swPath = path.join(root, 'sw.js'), sw = fs.readFileSync(swPath, 'utf8');
const re = /(\/\*SHELL_START\*\/)[\s\S]*?(\/\*SHELL_END\*\/)/;
const next = sw.replace(re, `$1 ${list} $2`);
if (process.argv.includes('--write')) { fs.writeFileSync(swPath, next); console.log('sw.js 목록을 갱신했어요:', files.length + 1, '개'); }
else if (next !== sw) { console.error('sw.js 의 SHELL_FILES 가 실제 파일과 달라요. `node tools/shell-list.mjs --write` 로 갱신하세요.'); process.exit(1); }
else console.log('SHELL_FILES OK (' + (files.length + 1) + ')');
