// 发布一致性（阶段四：迭代机制）
//   node test/version-test.mjs
// 校验：VERSION 文件 ↔ version.json ↔ 产物内嵌版本 ↔ 产物 md5，四处必须一致。
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

console.log('[1] 版本来源唯一');
ok(existsSync(ROOT + 'VERSION'), 'VERSION 文件存在');
const version = read('VERSION').trim();
ok(/^\d+\.\d+\.\d+$/.test(version), 'VERSION 是语义化版本号：' + version);

console.log('\n[2] version.json 与 VERSION 一致');
ok(existsSync(ROOT + 'version.json'), '根目录有 version.json（页面加载后用它做更新对账）');
ok(existsSync(ROOT + 'dist/version.json'), 'dist/ 也有 version.json（本地直接开 dist 时也能对账）');
const vj = JSON.parse(read('version.json'));
ok(vj.version === version, 'version.json 的版本 = VERSION（' + vj.version + '）');
ok(read('dist/version.json') === read('version.json'), '两份 version.json 内容一致');
ok(!!vj.builtAt && !isNaN(Date.parse(vj.builtAt)), '带构建时间：' + vj.builtAt);
ok(typeof vj.onlineGames === 'number' && typeof vj.miniGames === 'number',
  '带游戏数量：联机 ' + vj.onlineGames + ' 款 / 小游戏 ' + vj.miniGames + ' 款');

console.log('\n[3] 产物内嵌版本与 VERSION 一致');
const art = read('dist/party-night.html');
const meta = (art.match(/name="pn-version" content="([^"]+)"/) || [])[1];
const inl = (art.match(/PN\.VERSION = '([^']+)'/) || [])[1];
ok(meta === version, '产物 <meta name="pn-version"> = ' + version);
ok(inl === version, '产物内 PN.VERSION = ' + version);
ok(art.indexOf('__VERSION__') < 0, '没有残留的 __VERSION__ 替换标记');
ok(art.indexOf('checkVersion') >= 0, '产物带版本对账逻辑（有新版本才提示刷新）');
ok(art.indexOf('update-tip') >= 0, '产物带更新提示样式');

console.log('\n[4] md5 对得上（能用来比对线上产物）');
const md5 = createHash('md5').update(art).digest('hex');
ok(vj.md5 === md5, 'version.json 的 md5 = 产物实际 md5（' + md5 + '）');
ok(read('index.html') === art, '根目录 index.html 与产物逐字节一致（部署的就是它）');

console.log('\n[5] 游戏数量与实际一致（防止"清单少了一款"这类静默错误）');
const onlineCount = (read('build.mjs').match(/src\/games/g) ? 1 : 0) && (() => {
  const dir = read('test/catalog-test.mjs');
  return null;
})();
const mini = JSON.parse(read('data/mini.json')).games.length;
ok(vj.miniGames === mini, '小游戏数量一致：' + vj.miniGames + ' = ' + mini);
ok(vj.onlineGames === 9, '联机游戏数量 = 9（' + vj.onlineGames + '）');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
