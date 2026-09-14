// 入口系统（阶段三）：统一卡片 + 游戏目录 + 分区 + 扩展性
//   node test/catalog-test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const BANKS = {
  draw: JSON.parse(read('data/draw.json')),
  tacit: JSON.parse(read('data/tacit.json')),
  memory: JSON.parse(read('data/memory.json')),
  codraw: JSON.parse(read('data/codraw.json')),
  mini: JSON.parse(read('data/mini.json')),
};
function loadPage() {
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    JSON, Math, Date, Promise, Object, Array, String, Number, Boolean, isNaN,
    parseInt, parseFloat, Error, RegExp, WeakMap, TextEncoder, TextDecoder, document: undefined,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = { __PN_BANKS__: BANKS };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var PN = { games: {}, pick: {}, Banks: {} };', ctx);
  for (const f of ['src/data.js', 'src/screens-common.js']) vm.runInContext(read(f), ctx, { filename: ROOT + f });
  // 把 5 个玩法文件的注册表也挂进来（只要 PN.games[id]，不跑游戏逻辑）
  for (const f of ['drawgame', 'tacit', 'memory', 'codraw', 'gomoku', 'hop', 'mine', 'soko', 'domino', 'cube']) {
    const src = read('src/games/' + f + '.js').replace(/^[\s\S]*?PN\.games\[ID\] = game;/m, 'PN.games["' + f + '"] = game;');
    const only = src.replace(/\(\(function[\s\S]*?$/, '');
    vm.runInContext(read('src/games/' + f + '.js'), ctx, { filename: ROOT + f });
  }
  return { PN: vm.runInContext('PN', ctx), ctx, vm };
}
const P = loadPage();
const GC = P.PN.gameCommon;

console.log('[1] 目录：联机游戏 + 小游戏厅合成一份视图');
const cat = GC.catalog();
const online = cat.filter(x => x.kind === 'online');
const mini = cat.filter(x => x.kind === 'mini');
ok(online.length === 10, '目录里有 9 款联机游戏：' + online.map(x => x.id).join(','));
ok(mini.length === 16, '目录里有 16 款小游戏');
ok(cat.every(x => x.id && x.title && x.emoji && x.group), '每一项都有 id/标题/图标/分组');
ok(cat.every(x => x.desc !== undefined), '每一项都有说明（可为空串）');
ok(online.every(x => x.players), '联机游戏都带人数信息：' + online.map(x => x.id + '(' + x.players + ')').join(' '));
ok(mini.every(x => x.tags.length && x.tags[0]), '小游戏都带分类标签');
ok(online.filter(x => x.origin).length >= 1, '有来源信息的游戏会被带进目录（' +
  online.filter(x => x.origin).map(x => x.id + '←' + x.origin.slug).join(',') + '）');

console.log('\n[2] 分区：联机在前、小游戏厅在后');
const secs = GC.sections(cat);
ok(secs.length === 2, '分成 2 个区（联机 / 小游戏厅），实际 ' + secs.length);
ok(secs[0].group === 'online' && secs[1].group === 'mini', '顺序是 online → mini');
ok(secs[0].items.length === 10 && secs[1].items.length === 16, '每区数量正确（9 / 16）');
ok(!!GC.groupTitle.online && !!GC.groupTitle.mini, '每个区有标题与副标题：' + GC.groupTitle.online + ' | ' + GC.groupTitle.mini);

console.log('\n[3] 卡片：两种游戏共用同一个函数，且保留旧类名（向后兼容）');
const onlineCard = GC.gameCard({ kind: 'online', id: 'demo', emoji: '🎮', title: '测试', desc: '说明', tags: ['标签'], players: '2' });
const miniCard = GC.gameCard({ kind: 'mini', id: 'm1', emoji: '🐳', title: '小游戏', desc: '说明', tags: ['治愈'] });
ok(onlineCard.includes('modecard') && onlineCard.includes('gcard'), '联机卡片同时带 .gcard 与旧类名 .modecard');
ok(onlineCard.includes('data-mode="demo"'), '联机卡片带 data-mode（旧的大厅脚本靠它工作）');
ok(miniCard.includes('mini-card') && miniCard.includes('gcard'), '小游戏卡片同时带 .gcard 与旧类名 .mini-card');
ok(miniCard.includes('data-mini="m1"'), '小游戏卡片带 data-mini（浮层靠它打开）');
ok(onlineCard.includes('gc-ico') && miniCard.includes('gc-ico'), '两种卡片内部元素统一为 .gc-*');
ok(!GC.gameCard({ title: '<script>x</script>' }).includes('<script>'), '标题会转义（不执行注入）');

console.log('\n[4] 扩展性：新增一款游戏，入口零改动就能出现');
const before = GC.catalog().length;
P.vm.runInContext('PN.games.demoNew = { id: "demoNew", name: "新游戏", emoji: "🆕", blurb: "刚加的", minPlayers: 2, maxPlayers: 2, meta: { group: "online", tags: ["新"] } };', P.ctx);
const after = GC.catalog();
ok(after.length === before + 1, '目录自动多出一项（' + before + ' → ' + after.length + '），没有任何入口代码改动');
const added = after.filter(x => x.id === 'demoNew')[0];
ok(added && added.title === '新游戏' && added.players === '2', '新游戏信息自动出现在目录里');
ok(GC.sections(after)[0].items.length === 11, '新游戏自动归入联机分区（9 → 10）');

console.log('\n[5] 没有 meta 的老游戏也不能崩');
P.vm.runInContext('PN.games.demoLegacy = { id: "demoLegacy", name: "老游戏", emoji: "📦", blurb: "没有 meta", minPlayers: 2, maxPlayers: 4 };', P.ctx);
const legacy = GC.catalog().filter(x => x.id === 'demoLegacy')[0];
ok(legacy && legacy.group === 'online' && legacy.tags.length === 0, '缺 meta 时默认归入 online、标签为空（不报错）');
ok(GC.sections(GC.catalog()).length === 2, '老游戏不会凭空多出一个分区');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
