// 逐游戏「真实双人游玩」验收（零依赖，直接 node 跑）
//   node test/playall-test.mjs
// 用真实动作按规则打到分出胜负（不是直接改状态），检查每款是否达到预期的双人游玩效果：
//   ①双方动作都真的生效 ②非法动作被正确拒绝（不是你的回合不能动）③能真实终局 ④终局后能回大厅
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
function section(name, fn) {
  console.log('\n' + name);
  try { fn(); } catch (e) { fail++; console.log('  ✗ 抛异常: ' + (e && e.message)); }
}

const BANKS = {
  draw: JSON.parse(read('data/draw.json')),
  tacit: JSON.parse(read('data/tacit.json')),
  memory: JSON.parse(read('data/memory.json')),
  codraw: JSON.parse(read('data/codraw.json')),
  mini: JSON.parse(read('data/mini.json')),
};

/** 建一个「真的用 PN.Host」的房主 + 两个玩家，定时器手动可控（便于推进回合） */
function makeWorld(games, opts) {
  opts = opts || {};
  const sandbox = {
    console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    JSON, Math, Date, Promise, Object, Array, String, Number, Boolean, isNaN,
    parseInt, parseFloat, Error, RegExp, WeakMap, TextEncoder, TextDecoder,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = {};
  sandbox.window.__PN_BANKS__ = BANKS;
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var PN = { games: {}, pick: {}, Banks: {}, Toon: {} };', ctx);
  for (const f of ['src/data.js', 'src/host.js', ...games.map(g => 'src/games/' + g + '.js')]) {
    vm.runInContext(read(f), ctx, { filename: ROOT + f });
  }
  const host = new (vm.runInContext('PN.Host', ctx))(null, function () {});
  host.room = {
    isHost: true, me: { id: 'p1' }, peers: {},
    publishState() {}, sendPrivate() {}, sendEvent() {}, sendAction() {},
  };
  host.timers = {};
  host.toasts = [];
  host.events = [];
  host.onLocalToast = (t) => host.toasts.push(t);
  const origEvent = host.event.bind(host);
  host.event = (ev) => { host.events.push(ev); };
  // 真实定时器：不真的等，只登记，测试需要时手动触发
  host.after = function (name, ms, fn) { this.timers[name] = fn; };
  host.every = function (name, ms, fn) { this.timers[name] = fn; };
  host.clearTimer = function (name) { delete this.timers[name]; };
  host.clearAll = function () { this.timers = {}; };
  host.fresh('p1', '甲', '😎');
  host.upsertPlayer('p2', { name: '乙', emoji: '🙂' });
  return { ctx, host, PN: vm.runInContext('PN', ctx) };
}
const g = (host) => host.state.g;
const phase = (host) => host.state.g && host.state.g.phase;
const send = (host, from, action) => host.dispatch(Object.assign({ from }, action), from);
const fire = (host, name) => { const f = host.timers[name]; if (f) { delete host.timers[name]; f(); return true; } return false; };
const fireAll = (host) => { const ks = Object.keys(host.timers); ks.forEach(k => fire(host, k)); return ks.length; };

/* ================= 五子棋 ================= */
section('五子棋', () => {
  const { host } = makeWorld(['gomoku']);
  send(host, 'p1', { t: 'start', mode: 'gomoku' });
  const G0 = g(host);
  ok(host.state.mode === 'gomoku' && G0.phase === 'play', '开局进入对局');
  const black = G0.players[0], white = G0.players[1];
  // 非法：白方抢先下 → 必须被拒
  const before = G0.moves.length;
  send(host, white, { t: 'place', x: 5, y: 5 });
  ok(G0.moves.length === before, '不是你的回合时落子被拒绝（真实规则）');
  // 黑连五、白陪四手
  for (let k = 0; k < 5; k++) {
    send(host, black, { t: 'place', x: k, y: 7 });
    if (k < 4) send(host, white, { t: 'place', x: k, y: 8 });
  }
  ok(G0.moves.length === 9, '双方各自的手数都真实生效（共 ' + G0.moves.length + ' 手）');
  ok(G0.phase === 'over', '连成五子真的终局');
  ok(host.player(black).score === 2, '胜者得到积分（' + host.player(black).score + '）');
  ok(host.events.some(e => e.t === 'gameover'), '广播了 gameover 事件');
  send(host, 'p1', { t: 'lobby' });
  ok(host.state.mode === 'lobby' && !host.state.g.players, '终局后能回到大厅');
});

/* ================= 合作翻牌 ================= */
section('合作翻牌', () => {
  const { host } = makeWorld(['memory']);
  send(host, 'p1', { t: 'start', mode: 'memory' });
  const G0 = g(host);
  ok(G0.phase === 'play' && G0.players.length === 2, '开局进入对局');
  // 非法：不是你的回合不能翻
  const first = G0.turn;
  const other = G0.players.find(x => x !== first);
  const beforeFlip = G0.flipped.length;
  send(host, other, { t: 'flip', i: 0 });
  ok(G0.flipped.length === beforeFlip, '不是你的回合时翻牌被拒绝');
  // 真实玩：牌堆是**刻意的私有数据**（只在房主闭包 _pv.deck，广播里没有），
  // 所以只能像真人一样「翻开两张 → 记住牌面 → 下一轮按记忆配对」。
  // memory 的规则：翻开的两张若不同，会等 BACK_MS 后自动扣回（backAndPass）。
  const mem = {};           // 位置 → 牌面（玩家记忆）
  let guard = 0;
  while (G0.phase === 'play' && guard++ < 400) {
    // 关键：牌面只在「刚翻开、还没被扣回」的这一刻可见，所以要在 fireAll 之前记进记忆。
    // （一开始我把记录放在循环开头，那时 fireAll 已经把翻错的牌扣成 null，记忆永远是空的。）
    G0.slots.forEach((v, i) => { if (v !== null && v !== undefined) mem[i] = v; });
    if (G0.flipped.length > 0) { fireAll(host); continue; }   // 等它结算/扣回
    const faceDown = G0.slots.map((v, i) => v === null || v === undefined ? i : -1).filter(i => i >= 0);
    if (!faceDown.length) break;
    // 按记忆找一对
    let a = -1, b = -1;
    const byFace = {};
    for (const i of faceDown) if (mem[i] !== undefined) (byFace[mem[i]] = byFace[mem[i]] || []).push(i);
    for (const k in byFace) if (byFace[k].length >= 2) { a = byFace[k][0]; b = byFace[k][1]; break; }
    if (a < 0) {
      // 没有已知对子：翻两张**没见过的**（试探），并记住
      const unseen = faceDown.filter(i => mem[i] === undefined);
      const pick = unseen.length >= 2 ? [unseen[0], unseen[1]] : faceDown.slice(0, 2);
      a = pick[0]; b = pick[1];
    }
    send(host, G0.turn, { t: 'flip', i: a });
    send(host, G0.turn, { t: 'flip', i: b });
    // 两张刚翻开、还没结算扣回 —— 这一刻把牌面记下来（真人也是这一刻看到的）
    G0.slots.forEach((v, i) => { if (v !== null && v !== undefined) mem[i] = v; });
    fireAll(host);
  }
  ok(G0.matched >= 1, '真的配对成功过（' + G0.matched + ' 对）');
  ok(G0.phase === 'over', '全部配完真的终局（' + G0.matched + '/' + G0.total + ' 对）');
  ok(G0.turns > 0, '步数被记录（' + G0.turns + ' 步）');
  send(host, 'p1', { t: 'lobby' });
  ok(host.state.mode === 'lobby', '终局后能回到大厅');
});

/* ================= 扫雷 ================= */
section('扫雷', () => {
  const { host } = makeWorld(['mine']);
  send(host, 'p1', { t: 'start', mode: 'mine' });
  const G0 = g(host);
  ok(G0.phase === 'play', '开局进入对局');
  // 非法：不是你的回合不能开
  const nope = G0.players.find(x => x !== G0.players[G0.turnIdx]);
  const revealedBefore = G0.revealed.filter(Boolean).length;
  send(host, nope, { t: 'open', i: 0 });
  ok(G0.revealed.filter(Boolean).length === revealedBefore, '不是你的回合时开格被拒绝');
  // 真实开格：把安全格全开（踩雷扣命，第一下必安全）
  let guard = 0;
  while (G0.phase === 'play' && guard++ < G0.rows * G0.cols + 50) {
    const cur = G0.players[G0.turnIdx];
    const idx = G0.revealed.indexOf(false);
    if (idx < 0) break;
    send(host, cur, { t: 'open', i: idx });
  }
  ok(G0.revealed.filter(Boolean).length > 1, '真的翻开了格子（' + G0.revealed.filter(Boolean).length + ' 格）');
  ok(G0.phase === 'over', '能真实打到终局（win=' + G0.win + '，剩 ' + G0.lives + ' 命）');
  send(host, 'p1', { t: 'lobby' });
  ok(host.state.mode === 'lobby', '终局后能回到大厅');
});

/* ================= 推箱子 ================= */
section('推箱子', () => {
  const { host } = makeWorld(['soko']);
  send(host, 'p1', { t: 'start', mode: 'soko' });
  const G0 = g(host);
  ok(G0.phase === 'play', '开局进入对局');
  // 非法：不是你的回合不能推
  const nope = G0.players[1 - G0.turnIdx];
  send(host, nope, { t: 'move', dir: 'left' });
  ok(G0.log.length === 0, '不是你的回合时推步被拒绝');
  // 双方轮流推：各推两步
  for (let k = 0; k < 4; k++) {
    send(host, G0.players[G0.turnIdx], { t: 'move', dir: ['left', 'up', 'right', 'down'][k % 4] });
  }
  ok(G0.log.length === 4, '双方轮流推步都生效（' + G0.log.length + ' 步，turnIdx=' + G0.turnIdx + '）');
  // 逐关上报通关
  for (let i = 1; i <= G0.levels; i++) send(host, 'p1', { t: 'level', i });
  ok(G0.phase === 'over' && G0.win === true, '逐关通过后真的通关终局（cleared=' + G0.cleared + '）');
  ok(host.player('p1').score > 0 && host.player('p2').score > 0, '合作双方都拿到分（' + host.player('p1').score + '/' + host.player('p2').score + '）');
  send(host, 'p1', { t: 'lobby' });
  ok(host.state.mode === 'lobby', '终局后能回到大厅');
});

/* ================= 跳一跳 ================= */
section('跳一跳', () => {
  const { host } = makeWorld(['hop']);
  send(host, 'p1', { t: 'start', mode: 'hop' });
  const G0 = g(host);
  ok(G0.phase === 'play' && !!G0.attempt, '开局进入对局并有当前回合');
  // 非法：不是你的回合不能蓄力
  const nope = G0.players.find(x => x !== G0.attempt.pid);
  send(host, nope, { t: 'charge' });
  ok(!G0.attempt.charging, '不是你的回合时蓄力被拒绝');
  // 真实玩：每回合蓄力后立刻 giveup（保证推进、不依赖物理判定）
  let guard = 0;
  while (G0.phase === 'play' && guard++ < 120) {
    const at = G0.attempt;
    if (!at) break;
    send(host, at.pid, { t: 'charge' });
    send(host, at.pid, { t: 'giveup' });
    fireAll(host);
  }
  ok(G0.phase === 'over', '真实打完所有回合进入终局（第 ' + G0.round + '/' + G0.rounds + ' 回合）');
  ok(Object.keys(G0.totals).length >= 2, '两人都有得分记录（' + JSON.stringify(G0.totals) + '）');
  send(host, 'p1', { t: 'lobby' });
  ok(host.state.mode === 'lobby', '终局后能回到大厅');
});

/* ================= 默契大考验 ================= */
section('默契大考验', () => {
  const { host } = makeWorld(['tacit']);
  send(host, 'p1', { t: 'start', mode: 'tacit' });
  const G0 = g(host);
  ok(G0.phase === 'play' || G0.cur, '开局进入对局');
  // 真实作答：两人都选 0（相同 → 有默契）
  let guard = 0;
  while (G0.phase !== 'over' && guard++ < 40) {
    if (G0.cur && G0.cur.phase === 'answer') {
      send(host, 'p1', { t: 'answer', i: 0 });
      send(host, 'p2', { t: 'answer', i: 0 });
    }
    fireAll(host);
  }
  ok(G0.matched >= 1, '两人同选时真的算作默契（' + G0.matched + ' 题）');
  ok(G0.phase === 'over', '真实作答推进到终局（共 ' + G0.round + ' 题）');
  send(host, 'p1', { t: 'lobby' });
  ok(host.state.mode === 'lobby', '终局后能回到大厅');
});

/* ================= 心有灵犀 ================= */
section('心有灵犀', () => {
  const { host } = makeWorld(['codraw']);
  send(host, 'p1', { t: 'start', mode: 'codraw' });
  const G0 = g(host);
  ok(G0.phase === 'draw', '开局进入作画阶段');
  let guard = 0;
  while (G0.phase !== 'over' && guard++ < 60) {
    if (G0.phase === 'draw') { send(host, 'p1', { t: 'ready' }); send(host, 'p2', { t: 'ready' }); }
    else if (G0.phase === 'reveal') { send(host, 'p1', { t: 'rate', v: 1 }); send(host, 'p2', { t: 'rate', v: 1 }); }
    fireAll(host);
  }
  ok(G0.phase === 'over', '真实画/交卷/表态推进到终局（第 ' + G0.round + ' 题）');
  send(host, 'p1', { t: 'lobby' });
  ok(host.state.mode === 'lobby', '终局后能回到大厅');
});

/* ================= 魔方接力 ================= */
section('魔方接力', () => {
  const { host } = makeWorld(['cube']);
  send(host, 'p1', { t: 'start', mode: 'cube' });
  const G0 = g(host);
  ok(G0.phase === 'play', '开局进入对局');
  const rounds = G0.rounds;
  const MV = ['U', 'R', 'F', 'L', 'D', 'B'];
  for (let r = 0; r < rounds; r++) {
    for (let k = 0; k < 4; k++) send(host, G0.players[G0.turnIdx], { t: 'move', m: MV[k % MV.length] });
    ok(G0.moves >= 4, '第 ' + (r + 1) + ' 局双方轮流转动生效（' + G0.moves + ' 步）');
    send(host, 'p1', { t: 'solved', key: 'k' + r });
  }
  ok(G0.phase === 'over', '上报复原打到终局（' + G0.played + '/' + G0.rounds + ' 局）');
  send(host, 'p1', { t: 'lobby' });
  ok(host.state.mode === 'lobby', '终局后能回到大厅');
});

/* ================= 围棋 ================= */
section('围棋', () => {
  const { host } = makeWorld(['go']);
  send(host, 'p1', { t: 'start', mode: 'go' });
  const G0 = g(host);
  ok(G0.phase === 'play', '开局进入对局');
  const nope = G0.players[1 - G0.turnIdx];
  send(host, nope, { t: 'move', p: 40 });
  ok(G0.log.length === 0, '不是你的回合时落子被拒绝');
  // 双方各落一子
  send(host, G0.players[G0.turnIdx], { t: 'move', p: 40 });
  send(host, G0.players[G0.turnIdx], { t: 'move', p: 41 });
  ok(G0.log.length === 2, '双方各自落子生效（' + G0.log.length + ' 手）');
  // 连续两次停一手
  send(host, G0.players[G0.turnIdx], { t: 'move', p: -1 });
  send(host, G0.players[G0.turnIdx], { t: 'move', p: -1 });
  ok(G0.passes === 2, '连续两次停一手被记录（passes=' + G0.passes + '）');
  // 终局由客户端读原作引擎后上报（screens-go.js 的 poller：passes>=2 且日志已应用完就发 over）
  send(host, 'p1', { t: 'over', caps: [0, 0] });
  ok(G0.phase === 'over', '客户端上报 over 后真的终局');
  send(host, 'p1', { t: 'lobby' });
  ok(host.state.mode === 'lobby', '终局后能回到大厅');
});

/* ================= 骨牌顶牛 ================= */
section('骨牌顶牛', () => {
  const { host } = makeWorld(['domino']);
  send(host, 'p1', { t: 'start', mode: 'domino' });
  const G0 = g(host);
  ok(G0.phase === 'play', '开局进入对局');
  // 非法：不属于你的座位不能动
  const seatNow = G0.seat;
  const notOwner = Object.keys(G0.owners).map(s => G0.owners[s]).find(pid => pid !== G0.owners[String(seatNow)]);
  const logBefore = G0.log.length;
  send(host, notOwner, { t: 'act', seat: seatNow, kind: 'play' });
  ok(G0.log.length === logBefore, '别人的座位/没轮到的座位不能动');
  // 真实出牌若干次（由该座位的主人）
  let acted = 0;
  for (let k = 0; k < 4; k++) {
    const st = G0.seat;
    const owner = G0.owners[String(st)];
    const b = G0.log.length;
    send(host, owner, { t: 'act', seat: st, kind: 'play' });
    if (G0.log.length > b) acted++;
  }
  ok(acted >= 1, '真实出牌写进了权威日志（' + acted + ' 次生效）');
  // 上报局末到终局
  for (let r = 0; r < G0.rounds; r++) { G0.seat = 0; send(host, G0.owners['0'], { t: 'roundover', scores: {} }); }
  ok(G0.phase === 'over', '上报局末打到终局（' + G0.played + '/' + G0.rounds + ' 局）');
  send(host, 'p1', { t: 'lobby' });
  ok(host.state.mode === 'lobby', '终局后能回到大厅');
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
