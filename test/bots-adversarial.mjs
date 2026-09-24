// 机器人对手：对抗性/生命周期边界（专挑危险交互）
//   node test/bots-adversarial.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
function section(n, fn) { console.log('\n' + n); try { fn(); } catch (e) { fail++; console.log('  ✗ 抛异常: ' + (e && e.message)); } }

const BANKS = { draw: JSON.parse(read('data/draw.json')), tacit: JSON.parse(read('data/tacit.json')), memory: JSON.parse(read('data/memory.json')), codraw: JSON.parse(read('data/codraw.json')) };
function loadPage() {
  const sandbox = {
    console, JSON, Math, Date, Promise, Object, Array, String, Number, Boolean, isNaN,
    parseInt, parseFloat, Error, RegExp, WeakMap, TextEncoder, TextDecoder,
    setTimeout: (fn, ms) => ({ fn, ms: ms || 0, dead: false }),   // 只登记，由测试快进
    clearTimeout: (id) => { if (id) id.dead = true; },
    setInterval: (fn, ms) => ({ fn, ms: ms || 0, dead: false, rep: true }),
    clearInterval: (id) => { if (id) id.dead = true; },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = { __PN_BANKS__: BANKS };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var PN = { games: {}, pick: {}, Banks: {} };', ctx);
  for (const f of ['src/data.js', 'src/host.js', 'src/bots.js', 'src/games/gomoku.js', 'src/games/tacit.js']) {
    vm.runInContext(read(f), ctx, { filename: ROOT + f });
  }
  return { PN: vm.runInContext('PN', ctx) };
}
const PN = loadPage().PN;

function makeHost(ids, hostId) {
  const me = { id: hostId || ids[0], name: 'N_' + (hostId || ids[0]), emoji: '🙂', pub: null };
  const state = {
    v: 3, mode: 'lobby', phase: 'lobby',
    players: ids.map(id => ({ id, name: 'N_' + id, emoji: '🙂', score: 0, streak: 0, wins: 0, online: true, host: id === (hostId || ids[0]) })),
    settings: { gomoku: { size: 9 }, tacit: { rounds: 4 } }, log: [], g: {}, hostId: hostId || ids[0], ts: 0,
  };
  const host = Object.create(PN.Host.prototype);
  host.room = {
    peers: {}, publishState() {}, sendPrivate() {}, sendEvent() {}, me,
    roster() {
      this.peers[this.me.id] = { id: this.me.id, name: this.me.name, emoji: this.me.emoji, pub: null, lastSeen: Date.now() };
      return Object.keys(this.peers).map(k => ({ id: k, online: this.peers[k].online !== false }));
    },
  };
  host.timers = {}; host.secrets = {}; host.secretCache = {};
  host.state = state; host.onStateChange = () => {}; host.now = () => Date.now();
  host.published = 0;
  const origPublish = host.room.publishState;
  host.room.publishState = () => { host.published++; };
  return host;
}
/** 把已登记的 host 定时器全部跑掉（复刻 after() 的 delete 行为），返回跑了几个 */
function runTimers(host, max = 400) {
  let n = 0;
  while (n++ < max) {
    const keys = Object.keys(host.timers);
    if (!keys.length) break;
    const k = keys[0];
    const id = host.timers[k];
    delete host.timers[k];
    if (id && !id.dead) id.fn();
  }
  return n;
}
function humansTurn(host) {
  const g = host.g();
  const botColor = g.players[0] === 'bot:1' ? 1 : 2;
  return g.turn !== botColor;
}
function humanMove(host, id) {
  const g = host.g();
  for (let i = 0; i < g.board.length; i++) {
    if (g.board[i] === 0) { host.dispatch({ t: 'place', x: i % g.n, y: Math.floor(i / g.n) }, id); return true; }
  }
  return false;
}

section('A. 重复 emit 不会排出多个机器人定时器（否则一步棋走两次）', () => {
  const h = makeHost(['u1']);
  h.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
  // 连发 5 次 emit
  for (let i = 0; i < 5; i++) h.emit();
  const tickCount = Object.keys(h.timers).filter(k => k === '__bot').length;
  ok(tickCount <= 1, '无论 emit 几次，机器人定时器最多 1 个（实际 ' + tickCount + '）');
});

section('B. 机器人一个回合只落一子（不能靠重复 emit 连走）', () => {
  const h = makeHost(['u1']);
  h.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
  // 先把「该真人走」这一手补上，让局面停在**轮到机器人**上
  if (humansTurn(h)) humanMove(h, 'u1');
  ok(!humansTurn(h), '局面已停在轮到机器人（前提成立）');
  const before = h.g().moves.length;
  for (let i = 0; i < 8; i++) h.emit();     // 疯狂 emit
  runTimers(h);
  const after = h.g().moves.length;
  ok(after - before === 1, '机器人只多走了 1 手（' + before + '→' + after + '）');
});

section('C. 回大厅后机器人定时器被清干净（不许跨局打一枪）', () => {
  const h = makeHost(['u1']);
  h.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
  if (humansTurn(h)) humanMove(h, 'u1');    // 制造一个在排队的机器人定时器
  // 前提必须成立：确实有一个在排队的机器人定时器，否则这段什么都没验到
  ok(!!h.timers['__bot'], '前提：确实有一个在排队的机器人定时器');
  // 把这个「还没跑」的回调**抓在手里** —— 模拟 clearTimeout 万一失效、旧回调仍然会跑的最坏情况。
  // （不能只靠 goLobby 清空 timers 就算完：那是"正常路径"，这里要验"异常路径"的兜底。）
  const stale = h.timers['__bot'];
  h.goLobby();
  ok(Object.keys(h.timers).length === 0, '回大厅后 host.timers 全空（实际 "' + Object.keys(h.timers).join(',') + '"）');
  h.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
  // 让新局的 Robot 定时器先别跑：只单独执行那个"旧回调"，看它会不会动新局
  const newTimers = Object.keys(h.timers);
  const snapshotMoves = h.g().moves.length;
  if (stale && typeof stale.fn === 'function') stale.fn();   // 直接调旧回调，绕过 clearAll
  ok(h.g().moves.length === snapshotMoves,
     '旧回调单独执行时不会动新局（moves 仍是 ' + h.g().moves.length + '，新局待跑定时器 ' + newTimers.join(',') + '）');
});

section('D. 再来一局：机器人还在，且新局能正常打', () => {
  const h = makeHost(['u1']);
  h.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
  // 打到终局
  let guard = 0;
  while (h.g().phase === 'play' && guard++ < 80) {
    if (humansTurn(h)) humanMove(h, 'u1');
    runTimers(h);
  }
  ok(h.g().phase === 'over', '第一局打完了');
  const botsBefore = PN.bots.botsIn(h).length;
  h.dispatch({ t: 'again' }, 'u1');
  ok(h.state.mode === 'gomoku', '再来一局仍在五子棋');
  ok(h.g().phase === 'play', '新局进入 play');
  ok(PN.bots.botsIn(h).length === botsBefore, '机器人数量没变（' + PN.bots.botsIn(h).length + '）');
  ok(h.g().players.indexOf('bot:1') >= 0, '机器人仍在新局的 g.players 里');
  // 新局也要能推进
  if (humansTurn(h)) humanMove(h, 'u1');
  const before = h.g().moves.length;
  runTimers(h);
  ok(h.g().moves.length > before, '新局里机器人照常应招（' + before + '→' + h.g().moves.length + '）');
});

section('E. 换房主（adopt）：新主机接手后机器人照常动', () => {
  const h1 = makeHost(['u1']);
  h1.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
  // 把局面停在「正好轮到机器人」——注意**不能**跑 runTimers，否则机器人先走完又轮回真人。
  // 快照必须带着「轮到机器人」这个状态，才能验出接手后机器人还会不会动。
  let wait = 0;
  while (!humansTurn(h1) && wait++ < 30) runTimers(h1);   // 先让机器人该走的都走完
  if (h1.g().phase === 'play' && humansTurn(h1)) humanMove(h1, 'u1');
  const snapshot = JSON.parse(JSON.stringify(h1.state));
  ok(h1.g().phase !== 'play' || !humansTurn(h1), '前提：快照停在轮到机器人（phase=' + h1.g().phase + '）');
  // 新房主 u2 接手（真人 u1 还在局里）
  const h2 = makeHost(['u1', 'u2'], 'u2');
  h2.room.peers['u1'] = { id: 'u1', online: true };
  h2.adopt(snapshot);
  ok(PN.bots.botsIn(h2).length === 1, '接手后机器人还在名单里');
  ok(h2.state.hostId === 'u2', '房主变成 u2');
  // 快照就是「轮到机器人」，接手后机器人必须照常应招 —— 这才是换房主后机器人还有效的证据。
  // 注意：新房主 u2 并不在 g.players 里（他是接手的人，不是这局的参与者），
  // 所以这里**不能**让 u2 落子；只能跑定时器看机器人动不动。
  const before = h2.g().moves.length;
  runTimers(h2);
  ok(h2.g().moves.length > before, '接手后机器人照常应招（' + before + '→' + h2.g().moves.length + '）');
  ok(h2.g().moves[before] && h2.g().moves[before].color === (h2.g().players[0] === 'bot:1' ? 1 : 2),
     '那一手确实是机器人的颜色');
});

section('F. 真人永久离开：机器人不会自己跟自己下到天荒地老', () => {
  const h = makeHost(['u1']);
  h.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
  if (humansTurn(h)) humanMove(h, 'u1');
  // 真人掉线并被判定离线
  h.room.roster = () => [{ id: 'u1', online: false }];
  h.syncOnline();
  ok(h.player('u1').online === false, '真人被标记离线');
  // 跑掉宽限定时器（25s 后的 onLeave）
  runTimers(h);
  const g = h.g();
  ok(g.phase === 'over', '人走了这盘就结束，不会无限下（phase=' + g.phase + '）');
  // 结束后不该再有机器人定时器
  const pending = Object.keys(h.timers).filter(k => k === '__bot').length;
  ok(pending === 0, '终局后没有遗留的机器人定时器（实际 ' + pending + '）');
});

section('G. 机器人不会替真人走棋（真人在线时绝不越权）', () => {
  const h = makeHost(['u1']);
  h.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
  // 强制轮到真人
  let guard = 0;
  while (!humansTurn(h) && guard++ < 20) runTimers(h);
  const before = h.g().moves.length;
  runTimers(h);
  ok(h.g().moves.length === before, '轮真人时机器人一动不动（守卫 ' + guard + '）');
  // 而且真人那一格必须真的能下（机器人没占）
  const g = h.g();
  const empties = g.board.filter(v => v === 0).length;
  ok(empties > 0, '棋盘上还有空位给真人（' + empties + ' 个）');
});

section('H. 机器人不会重复落子在同一格', () => {
  const h = makeHost(['u1']);
  h.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
  let guard = 0;
  while (h.g().phase === 'play' && guard++ < 80) {
    if (humansTurn(h)) humanMove(h, 'u1');
    runTimers(h);
  }
  const moves = h.g().moves;
  const seen = new Set(moves.map(m => m.x + ',' + m.y));
  ok(seen.size === moves.length, '没有重复落子（' + moves.length + ' 手，' + seen.size + ' 个不同点）');
  // 每一步的颜色必须和 g.players 的先后一致
  const firstColor = moves[0].color;
  let alternating = true;
  moves.forEach((m, i) => { if (m.color !== (i % 2 === 0 ? firstColor : (firstColor === 1 ? 2 : 1))) alternating = false; });
  ok(alternating, '黑白严格交替（没有连下两手）');
});

console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
