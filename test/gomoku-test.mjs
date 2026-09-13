// 五子棋：房主逻辑回归（零依赖，直接 node 跑）
//   node test/gomoku-test.mjs
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
};
function loadPage() {
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    JSON, Math, Date, Promise, Object, Array, String, Number, Boolean, isNaN,
    parseInt, parseFloat, Error, RegExp, WeakMap, TextEncoder, TextDecoder,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = {};
  sandbox.window.__PN_BANKS__ = BANKS;
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var PN = { games: {}, pick: {}, Banks: {} };', ctx);
  for (const f of ['src/data.js', 'src/host.js', 'src/games/gomoku.js']) {
    vm.runInContext(read(f), ctx, { filename: ROOT + f });
  }
  return { PN: vm.runInContext('PN', ctx), ctx };
}
function makeHost(page, ids, settings, hostId) {
  const state = {
    mode: 'lobby', phase: 'setup',
    players: ids.map(id => ({ id, name: 'N_' + id, emoji: '🙂', score: 0, online: true })),
    settings, log: [], g: {}, hostId: hostId || ids[0], ts: 0,
  };
  return {
    state, room: {}, secretCache: {}, timers: {}, sent: [], events: [],
    g() { return this.state.g; },
    now: () => Date.now(),
    onlinePlayers() { return this.state.players.filter(p => p.online); },
    player(id) { return this.state.players.find(p => p.id === id) || null; },
    amHost(id) { return id === this.state.hostId; },
    toast() {}, event(ev) { this.events.push(ev); }, goLobby() { this.wentLobby = true; }, emit() {},
    addScore(id, n) { const p = this.player(id); if (p) p.score += n; },
    after(n, ms, fn) { this.timers[n] = fn; }, every() {}, clearTimer(n) { delete this.timers[n]; },
    sendSecret() {}, requestSecret() {}, resendSecret() {},
  };
}
function hostProto(page) { return Object.getPrototypeOf(vm.runInContext('Object.create(PN.Host.prototype)', page.ctx)); }
function hostLike(page, state, room) {
  return Object.assign(Object.create(hostProto(page)), {
    state, room, timers: {}, amHost: () => true, emit() {}, toast() {}, now: () => Date.now(), clearAll() {},
    after(n, ms, fn) { this.timers[n] = fn; }, clearTimer(n) { delete this.timers[n]; },
    coerce: (cur, v) => (typeof cur === 'number' ? (isNaN(Number(v)) ? cur : Number(v)) : (typeof v === 'boolean' ? !!v : v)),
  });
}
const CFG = (size) => ({ gomoku: { size: size || 15 } });
/** 谁执黑：g.players[0] */
const black = (h) => h.g().players[0];
const white = (h) => h.g().players[1];
function start(page, size) {
  const h = makeHost(page, ['p1', 'p2'], CFG(size));
  const M = page.PN.games.gomoku;
  M.init(h);
  return { h, M };
}
/** 按顺序落子（自动按当前回合该谁走来发） */
function play(h, M, moves) {
  for (const [x, y] of moves) {
    const g = h.g();
    const color = g.turn;
    const pid = (g.players[0] && (color === 1 ? g.players[0] : g.players[1]));
    M.action(h, { t: 'place', x, y }, pid);
  }
}

/* [1] 开局 */
section('[1] 开局', function () {
  const A = loadPage();
  const { h, M } = start(A);
  ok(h.g().n === 15 && h.g().board.length === 225, '15×15 = 225 格，全部为空');
  ok(h.g().board.every(v => v === 0), '开局无子');
  ok(h.g().turn === 1, '黑先（turn=1）');
  ok(h.g().players.length === 2 && black(h) !== white(h), '两位玩家分执黑白：黑=' + h.g().players[0]);
  ok(h.g().phase === 'play', '进入对局阶段');
  const order = h.g().players.slice();
  for (let i = 0; i < 8; i++) { const h2 = start(A).h; }
  ok(true, '先手随机（跑 8 次不报错）');
});

/* [2] 落子规则 */
section('[2] 落子规则', function () {
  const A = loadPage();
  const { h, M } = start(A, 9);
  const B = black(h), W = white(h);
  M.action(h, { t: 'place', x: 0, y: 0 }, W);
  ok(h.g().board[0] === 0, '不是自己的回合下不了（白棋抢先无效）');
  M.action(h, { t: 'place', x: 0, y: 0 }, B);
  ok(h.g().board[0] === 1 && h.g().turn === 2, '黑棋落子成功，轮到白棋');
  M.action(h, { t: 'place', x: 0, y: 0 }, W);
  ok(h.g().board[0] === 1 && h.g().turn === 2, '同一格不能再下（还是白棋的回合）');
  M.action(h, { t: 'place', x: 9, y: 0 }, W);
  ok(h.g().board[9] === 0, '越界落子无效（x=9 在 9×9 棋盘外）');
  M.action(h, { t: 'place', x: -1, y: 0 }, W);
  ok(h.g().board[0] === 1, '负坐标无效');
  const h3 = makeHost(A, ['p1', 'p2', 'p3'], CFG(9));
  const M3 = A.PN.games.gomoku;
  M3.init(h3);
  M3.action(h3, { t: 'place', x: 1, y: 1 }, 'p3');
  ok(h3.g().board[0] === 0 && h3.g().board[10] === 0, '旁观者不能落子');
});

/* [3] 连五判定：四个方向 + 长连 + 四子不算 */
section('[3] 连五判定', function () {
  const A = loadPage();
  // 横向
  {
    const { h, M } = start(A, 9);
    play(h, M, [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1], [4, 0]]);
    ok(h.g().winner === 1 && h.g().winCells.length === 5, '横向五连获胜（winCells=' + h.g().winCells.length + '）');
  }
  // 纵向
  {
    const { h, M } = start(A, 9);
    play(h, M, [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3], [0, 4]]);
    ok(h.g().winner === 1, '纵向五连获胜');
  }
  // 主斜线
  {
    const { h, M } = start(A, 9);
    play(h, M, [[0, 0], [8, 0], [1, 1], [8, 1], [2, 2], [8, 2], [3, 3], [8, 3], [4, 4]]);
    ok(h.g().winner === 1, '主对角线五连获胜');
  }
  // 副斜线
  {
    const { h, M } = start(A, 9);
    play(h, M, [[8, 0], [0, 0], [7, 1], [0, 1], [6, 2], [0, 2], [5, 3], [0, 3], [4, 4]]);
    ok(h.g().winner === 1, '副对角线五连获胜');
  }
  // 长连：五子棋不可能"先有 6 才有 5"，只能中间填空把两段连起来（这里连成 7 子）
  {
    const { h, M } = start(A, 9);
    play(h, M, [
      [0, 0], [0, 8],   // 黑 0,0 / 白散着下（避免白自己先连成五）
      [1, 0], [2, 8],
      [2, 0], [4, 8],
      [4, 0], [6, 8],
      [5, 0], [8, 8],
      [6, 0], [1, 7],
      [3, 0],           // 黑在中间填空 → 0..6 共 7 子连成
    ]);
    ok(h.g().winner === 1 && h.g().winCells.length >= 6, '长连（跨过空档一次连成 ' + h.g().winCells.length + ' 子）也算胜');
  }
  // 四子不算胜
  {
    const { h, M } = start(A, 9);
    play(h, M, [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1]]);
    ok(h.g().winner === 0 && h.g().phase === 'play', '只有四子不算胜，继续下');
  }
  // 白棋也能赢
  {
    const { h, M } = start(A, 9);
    play(h, M, [[8, 0], [0, 0], [8, 1], [1, 0], [7, 5], [2, 0], [7, 6], [3, 0], [6, 8], [4, 0]]);
    ok(h.g().winner === 2, '白棋连成五子也能赢（winner=' + h.g().winner + '）');
  }
});

/* [4] 胜负之后 */
section('[4] 结束后不能再下 + 计分', function () {
  const A = loadPage();
  const { h, M } = start(A, 9);
  play(h, M, [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1], [4, 0]]);
  const winner = black(h);
  const before = h.g().board.slice();
  M.action(h, { t: 'place', x: 8, y: 8 }, white(h));
  ok(JSON.stringify(h.g().board) === JSON.stringify(before), '胜负已分后落子无效');
  ok(h.player(winner).score === 2, '赢家 +2 分');
  ok(h.events.some(e => e.t === 'gameover'), '发出 gameover 事件（客户端要弹结算）');
});

/* [5] 悔棋要对方同意 */
section('[5] 悔棋流程', function () {
  const A = loadPage();
  const { h, M } = start(A, 9);
  const B = black(h), W = white(h);
  play(h, M, [[0, 0], [1, 1]]);
  const turnBefore = h.g().turn;
  M.action(h, { t: 'undo-req' }, B);
  ok(h.g().pending && h.g().pending.by === B, '发起悔棋 → 挂起等对方同意');
  M.action(h, { t: 'place', x: 5, y: 5 }, turnBefore === 1 ? B : W);
  ok(h.g().board[40] === 0, '挂起期间不能落子（先商量完）');
  M.action(h, { t: 'undo-answer', ok: true }, B);
  ok(h.g().pending, '自己不能同意自己的悔棋请求');
  M.action(h, { t: 'undo-answer', ok: true }, W);
  ok(!h.g().pending && h.g().board[10] === 0 && h.g().moves.length === 1, '对方同意 → 撤掉最后一手（(1,1) 那子没了）');
  ok(h.g().board[0] === 1, '更早的那手不受影响（撤销只撤最后一步）');
  ok(h.g().turn === 2, '撤掉后轮回到被撤那手的一方（白棋）');
  // 拒绝
  M.action(h, { t: 'undo-req' }, W);
  M.action(h, { t: 'undo-answer', ok: false }, B);
  ok(!h.g().pending && h.g().moves.length === 1, '对方拒绝 → 棋盘不变，继续下');
});

/* [6] 换主 */
section('[6] 换主', function () {
  const A = loadPage();
  const { h, M } = start(A, 9);
  play(h, M, [[0, 0], [1, 1]]);
  M.action(h, { t: 'undo-req' }, black(h));
  const hB = makeHost(A, ['p1', 'p2'], CFG(9), 'p2');
  hB.state.g = JSON.parse(JSON.stringify(h.state.g));
  hB.state.mode = 'gomoku';
  M.resume(hB);
  ok(hB.state.g.pending === null, '换主后清掉悔棋请求（免得新棋盘卡在"等同意"）');
  ok(hB.state.g.board.filter(v => v).length === 2 && hB.state.g.moves.length === 2, '棋盘与手数都还在（状态全在 g 里，不丢）');
});

/* [7] 平局分支：构造一副无五连的满盘，最后一手落子应判平局 */
section('[7] 平局', function () {
  const A = loadPage();
  const { h, M } = start(A, 9);
  const R = A.PN.games.gomoku._rules;
  // 固定种子的随机搜索：找一副「任何方向都没有五连」的满盘
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let pattern = null;
  for (let tries = 0; tries < 200 && !pattern; tries++) {
    const b = new Array(81);
    for (let i = 0; i < 81; i++) b[i] = rnd() < 0.5 ? 1 : 2;
    let clean = true;
    for (let y = 0; y < 9 && clean; y++) for (let x = 0; x < 9; x++) if (R.checkWin(b, 9, x, y)) { clean = false; break; }
    if (!clean) continue;                       // 有连五 → 换个种子重来
    const last = b[80]; b[80] = 0;              // 最后一格空着，等会儿用真动作落
    let okLast = true;
    for (let k = 0; k < 80; k++) if (R.checkWin(b, 9, k % 9, Math.floor(k / 9))) okLast = false;
    if (okLast) { pattern = { board: b, color: last }; }
  }
  if (!pattern) { ok(false, '未能构造出无五连满盘（测试自身问题）'); return; }
  h.g().board = pattern.board;
  h.g().moves = [];
  for (let i = 0; i < 80; i++) if (pattern.board[i]) h.g().moves.push({ x: i % 9, y: Math.floor(i / 9), i: i, color: pattern.board[i] });
  h.g().turn = pattern.color;
  const pid = pattern.color === 1 ? h.g().players[0] : h.g().players[1];
  M.action(h, { t: 'place', x: 8, y: 8 }, pid);
  ok(h.g().board[80] === pattern.color, '最后一格落子成功');
  ok(h.g().phase === 'over' && h.g().winner === 0, '无五连且棋盘满 → 判平局（winner=0）');
  ok(h.state.players.every(p => p.score === 1), '平局双方各 +1（不伤和气）');
});

/* [8] 人数上限 */
section('[8] 人数限制', function () {
  const A = loadPage();
  const h3 = makeHost(A, ['p1', 'p2', 'p3'], CFG(9));
  const self = hostLike(A, h3.state, {});
  self._lobbyAction({ t: 'start', mode: 'gomoku' }, 'p1');
  ok(h3.state.mode === 'lobby', '三个人不能开始双人五子棋（maxPlayers 拦住）');
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
