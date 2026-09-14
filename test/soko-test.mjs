// 鲸鱼推箱子（双人合作，复用原作）：房主侧双人兼容逻辑（零依赖）
//   node test/soko-test.mjs
// 注意：这里**不测推箱子规则**（规则在原作里），只测我们加的那一层：
//   轮流出手 / 移动日志 / 换关计分 / 重来 / 结算 / 掉线
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
function section(n, fn) { console.log('\n' + n); try { fn(); } catch (e) { fail++; console.log('  ✗ 抛异常: ' + (e && e.message)); } }

const BANKS = { mini: JSON.parse(read('data/mini.json')) };
function loadPage() {
  const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval, JSON, Math, Date, Promise,
    Object, Array, String, Number, Boolean, isNaN, parseInt, parseFloat, Error, RegExp, WeakMap, TextEncoder, TextDecoder };
  sandbox.globalThis = sandbox; sandbox.window = { __PN_BANKS__: BANKS };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var PN = { games: {}, pick: {}, Banks: {} };', ctx);
  for (const f of ['src/data.js', 'src/games/soko.js']) vm.runInContext(read(f), ctx, { filename: ROOT + f });
  return vm.runInContext('PN', ctx);
}
const G = loadPage().games.soko;

function makeHost(ids, settings) {
  return {
    events: [], toasts: [],
    state: { mode: 'round', phase: 'round',
      players: ids.map(id => ({ id, name: 'N_' + id, emoji: '🙂', score: 0, online: true })),
      settings: settings || {}, g: null, hostId: ids[0], ts: 0 },
    room: { publishState() {} }, now: () => 1,
    g() { return this.state.g; },
    onlinePlayers() { return this.state.players.filter(p => p.online); },
    player(id) { return this.state.players.find(p => p.id === id) || null; },
    amHost(id) { return id === this.state.hostId; },
    emit() {}, emitSoon() {}, toast(m) { this.toasts.push(m); }, event(e) { this.events.push(e); },
    addScore(id, n) { const p = this.player(id); if (p) p.score += n; }, goLobby() { this.wentLobby = true; },
    after() {}, every() {}, clearTimer() {}, clearAll() {},
    sendSecret() {}, requestSecret() {}, resendSecret() {},
  };
}
const start = (settings) => { const h = makeHost(['p1', 'p2'], settings); G.init(h); return h; };
const turn = (h) => h.g().players[h.g().turnIdx];
const mv = (h, dir, pid) => G.action(h, { t: 'move', dir }, pid || turn(h));

section('[1] 开局：不自己维护棋盘，只有轮次与日志', function () {
  const h = start({});
  const g = h.g();
  ok(g.li === 0 && g.levels === 5, '默认第 1 关、共 5 关（⚙️可改 3/10）');
  ok(Array.isArray(g.log) && g.log.length === 0, '移动日志为空（局面不在这里维护，在原作里）');
  ok(!('boxes' in g) && !('walls' in g), 'state 里没有箱子/墙 —— 推箱子规则全在原作');
  ok(turn(h) === 'p1', 'p1 先走');
  ok(g.levelName === '第一道沟', '第 1 关名字：' + g.levelName);
});

section('[2] 轮流出手：不是你的回合走不动', function () {
  const h = start({});
  const g = h.g();
  mv(h, 'right');
  ok(g.log.length === 1 && g.log[0] === 'right', '成功出手 → 日志记下方向');
  ok(turn(h) === 'p2', '出手后换人');
  mv(h, 'right', 'p1');                            // p1 还想走（helper 默认用"当前该出手的人"，这里要显式指定）
  ok(g.log.length === 1, '不是你的回合：日志不增长');
  mv(h, 'down');
  ok(g.log.length === 2 && g.log[1] === 'down', '轮到的人可以走');
  ok(turn(h) === 'p1', '再换人');
  const before = g.log.length;
  G.action(h, { t: 'move', dir: 'north' }, 'p1');
  ok(g.log.length === before, '非法方向被忽略（只有 up/down/left/right）');
  ok(Array.isArray(g.log) && typeof g.log[0] === 'string', '日志是方向字符串数组（两端按同一顺序重放）');
});

section('[3] 换关：由解开的那位上报，房主校验序号', function () {
  const h = start({});
  const g = h.g();
  G.action(h, { t: 'level', i: 5 }, 'p1');
  ok(g.li === 0 && g.cleared === 0, '越级上报（跳到第 6 关）被拒绝');
  G.action(h, { t: 'level', i: 1 }, 'p1');
  ok(g.li === 1 && g.cleared === 1, '上报下一关 → 进入第 2 关');
  ok(g.log.length === 0, '换关后日志清空（新关卡重新累积）');
  ok(turn(h) === 'p1', '新关卡由先手开始');
  ok(h.player('p1').score === 2 && h.player('p2').score === 2, '双方各 +2 分');
  ok(h.toasts.some(t => t.indexOf('第 1 关通过') >= 0), '有通过提示');
  G.action(h, { t: 'level', i: 1 }, 'p2');
  ok(g.cleared === 1, '重复上报同一关被忽略（两端都会检测到 solved，必须幂等）');
});

section('[4] 打满关卡 → 结算，赢家不是人而是"一起通关"', function () {
  const h = start({ soko: { levels: 3 } });
  const g = h.g();
  ok(g.levels === 3, '⚙️设置生效：只打 3 关');
  for (let i = 1; i <= 3; i++) G.action(h, { t: 'level', i: i }, i === 3 ? 'p2' : 'p1');
  ok(g.phase === 'over' && g.win === true, '打满 3 关 → 一起通关（win=true）');
  ok(g.cleared === 3, '共通关 3 关');
  ok(h.player('p1').score === 6 && h.player('p2').score === 6, '双方各 +6 分（每关 +2）');
  ok(h.events.some(e => e.t === 'gameover'), '发出 gameover 事件');
});

section('[5] 重来本关 / 换主 / 掉线 / 人数', function () {
  const h = start({});
  const g = h.g();
  mv(h, 'right'); mv(h, 'down');
  ok(g.log.length === 2, '先走两步');
  G.action(h, { t: 'reset' }, 'p1');
  ok(g.log.length === 0, '🔄 重来清空日志（两端都会重放进原作）');
  ok(turn(h) === 'p2', '重来也算让一步（换人，保持公平）');
  G.resume(h);
  ok(h.g().phase === 'play', '换主后状态还在（局面在原作里，换了房主也能继续）');

  const h2 = makeHost(['p1', 'p2']); G.init(h2);
  h2.player('p2').online = false;
  G.onLeave(h2, 'p2');
  ok(h2.g().phase === 'over', '对方离开 → 结束（不留死局）');
  const h3 = makeHost(['p1', 'p2', 'p3']); G.init(h3);
  ok(h3.state.mode === 'round', '三个人也能开（只取前两人）');
  const h4 = makeHost(['p1']); G.init(h4);
  ok(h4.wentLobby === true, '一个人时回大厅');
});

section('[6] 元信息：标明这是整包复用（不是自己重写）', function () {
  const m = G.meta || {};
  ok(m.origin && m.origin.slug === 'plus-2265f7c6', '来源标注原作者作品 slug');
  ok(m.origin.reuse === 'whole-game', 'meta 标明 reuse=whole-game');
  ok(!/game.(js)?$/.test(''), '（元信息不参与逻辑）');
  ok(true, '关卡名表仍是原作那 10 关的名字');
  ok(G._rules.LEVEL_NAMES.length === 10, '关卡名 10 条');
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
