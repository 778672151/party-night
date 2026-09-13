// 小游戏厅：清单与文件一致性（零依赖）
//   node test/mini-test.mjs
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const bank = JSON.parse(readFileSync(ROOT + 'data/mini.json', 'utf8'));
const games = bank.games || [];
console.log('[1] 清单');
ok(games.length >= 10, '小游戏数量 ' + games.length + ' 款（≥10）');
ok(new Set(games.map(g => g.id)).size === games.length, 'id 不重复');
ok(games.every(g => g.title && g.emoji && g.desc), '每款都有标题/图标/说明');
ok(games.every(g => g.cat), '每款都有分类标签');
ok(games.some(g => g.cat === '同屏双人'), '至少有一款是"同屏双人"（两个人凑一屏玩）');

console.log('\n[2] 文件都在（没有死链）');
const missing = games.filter(g => !existsSync(ROOT + 'mini/' + g.dir + '/index.html'));
ok(missing.length === 0, '16 款入口文件都存在' + (missing.length ? '：缺 ' + missing.map(m => m.id).join(',') : ''));

console.log('\n[3] 每个游戏是真东西（不是空壳）');
// 注意：多文件工程（Vite 打的那种）入口 index.html 可能只有 1KB，真正的代码在同目录 assets/ 里，
// 所以要看**整个目录**的体积，不能只看入口文件大小。
const thin = [];
let total = 0;
for (const g of games) {
  if (!existsSync(ROOT + 'mini/' + g.dir + '/index.html')) continue;
  const dir = ROOT + 'mini/' + g.dir;
  let all = 0;
  const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const fp = d + '/' + f.name; if (f.isDirectory()) walk(fp); else all += statSync(fp).size; } };
  walk(dir);
  total += all;
  if (all < 20 * 1024) thin.push(g.id + '(' + all + 'B)');
}
ok(thin.length === 0, '没有"只有一个空壳"的游戏（每个目录 >20KB）' + (thin.length ? '：' + thin.join(',') : ''));
ok(total > 1024 * 1024, '小游戏总体积 ' + Math.round(total / 1024) + ' KB（>1MB，说明文件是完整的）');
ok(total < 30 * 1024 * 1024, '总体积 ' + Math.round(total / 1048576 * 100) / 100 + ' MB（<30MB，没有把巨物塞进仓库）');

console.log('\n[4] 清单里的目录与磁盘上的一致');
const onDisk = readdirSync(ROOT + 'mini', { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
const inBank = games.map(g => g.dir).sort();
const extra = onDisk.filter(d => !inBank.includes(d));
const lost = inBank.filter(d => !onDisk.includes(d));
ok(extra.length === 0, '磁盘上没有"清单外"的孤立游戏目录' + (extra.length ? '：' + extra.join(',') : ''));
ok(lost.length === 0, '清单里的每一款都在磁盘上' + (lost.length ? '：' + lost.join(',') : ''));

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
