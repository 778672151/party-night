// 把源码 + 词库打包成单个 HTML 文件
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const tpl = readFileSync(join(root, 'index.template.html'), 'utf8');
const css = readFileSync(join(root, 'src/style.css'), 'utf8');

const scripts = [
  'src/data.js',
  'src/crypto.js',
  'src/mqtt.js',
  'src/wire.js',
  'src/room.js',
  'src/host.js',
  ...readdirSync(join(root, 'src/games')).filter(f => f.endsWith('.js')).sort().map(f => 'src/games/' + f),
  'src/screens-common.js',
  'src/screens-drawgame.js',
  'src/ui.js',
  'src/app.js',
];
let src = scripts.map(p => {
  const s = readFileSync(join(root, p), 'utf8');
  return '/* ===== ' + p + ' ===== */\n' + s;
}).join('\n');

const banks = {};
for (const f of ['draw']) {
  banks[f] = JSON.parse(readFileSync(join(root, 'data', f + '.json'), 'utf8'));
}
const banksJson = JSON.stringify(banks).replace(/</g, '\\u003c');

let out = tpl
  .replace('__CSS__', () => css)
  .replace('__BANKS__', () => banksJson)
  .replace('__SCRIPTS__', () => src);
mkdirSync(join(root, 'dist'), { recursive: true });
const dest = join(root, 'dist/party-night.html');
writeFileSync(dest, out);
console.log('built', dest, Math.round(out.length / 1024) + ' KB');
