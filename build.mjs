// 把源码 + 词库打包成单个 HTML 文件
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const tpl = readFileSync(join(root, 'index.template.html'), 'utf8');
const css = readFileSync(join(root, 'src/style.css'), 'utf8');

const scripts = [
  'src/data.js',
  'src/crypto.js',
  'src/mqtt.js',
  'src/wire.js',
  'src/canvas-ink.js',
  'src/toon.js',
  'src/room.js',
  'src/host.js',
  ...readdirSync(join(root, 'src/games')).filter(f => f.endsWith('.js')).sort().map(f => 'src/games/' + f),
  'src/screens-common.js',
  'src/screens-drawgame.js',
  'src/screens-tacit.js',
  'src/screens-memory.js',
  'src/screens-codraw.js',
  'src/screens-gomoku.js',
  'src/screens-hop.js',
  'src/screens-mine.js',
  'src/screens-soko.js',
  'src/screens-domino.js',
  'src/screens-cube.js',
  'src/ui.js',
  'src/app.js',
];
let src = scripts.map(p => {
  const s = readFileSync(join(root, p), 'utf8');
  return '/* ===== ' + p + ' ===== */\n' + s;
}).join('\n');

const banks = {};
for (const f of ['draw', 'tacit', 'memory', 'codraw', 'mini']) {
  banks[f] = JSON.parse(readFileSync(join(root, 'data', f + '.json'), 'utf8'));
}
const banksJson = JSON.stringify(banks).replace(/</g, '\\u003c');

// ===== 版本与发布信息（阶段四：迭代机制）=====
// VERSION 文件是唯一版本来源；产物内嵌版本号，同时在根目录与 dist/ 写 version.json，
// 页面打开/切回前台时对一下版本 → 不一样就提示刷新（GitHub Pages 有缓存，刷新才会拿新版）。
const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
const gameCount = readdirSync(join(root, 'src/games')).filter(f => f.endsWith('.js')).length;
let miniCount = 0;
try { miniCount = (JSON.parse(readFileSync(join(root, 'data/mini.json'), 'utf8')).games || []).length; } catch (e) {}
const releaseInfo = {
  version: version,
  builtAt: new Date().toISOString(),
  onlineGames: gameCount,
  miniGames: miniCount,
};

let out = tpl
  .replace('__CSS__', () => css)
  .replace('__BANKS__', () => banksJson)
  .split('__VERSION__').join(version)   // 版本号可能出现多处（meta + 脚本），要全部替换
  .replace('__SCRIPTS__', () => src);
mkdirSync(join(root, 'dist'), { recursive: true });
const dest = join(root, 'dist/party-night.html');
writeFileSync(dest, out);
// version.json 写两份：仓库根（线上/根目录打开）与 dist/（本地直接开 dist 也能对版本）
releaseInfo.md5 = createHash('md5').update(out).digest('hex');
const vjson = JSON.stringify(releaseInfo, null, 1) + '\n';
writeFileSync(join(root, 'version.json'), vjson);
writeFileSync(join(root, 'dist/version.json'), vjson);
console.log('built', dest, Math.round(out.length / 1024) + ' KB', '| v' + version,
  '| 联机 ' + gameCount + ' 款 / 小游戏 ' + miniCount + ' 款');
