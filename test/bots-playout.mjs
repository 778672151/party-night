// 真打：在**默认 15×15** 上把整局打完，量机器人每步思考时间 + 查停顿/非法落子
//   node test/bots-playout.mjs
// 说明：一局里只有一个机器人（产品就是"1 真人 + 1 机器人"，minPlayers=2），
// 所以对手用一个"会下棋但不聪明"的合成对手来推进局面，只量**机器人自己**的耗时。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');

const ctx = vm.createContext({
  console, JSON, Math, Date, Object, Array, String, Number, Boolean, isNaN, parseInt, parseFloat, Error, RegExp,
  setTimeout: () => ({}), clearTimeout: () => {}, setInterval: () => ({}), clearInterval: () => {},
});
ctx.globalThis = ctx;
vm.runInContext('var PN={games:{},pick:{},Banks:{}};', ctx);
vm.runInContext(read('src/bots.js'), ctx, { filename: ROOT + 'src/bots.js' });
vm.runInContext(read('src/games/gomoku.js'), ctx, { filename: ROOT + 'src/games/gomoku.js' });
const G = vm.runInContext('PN.games.gomoku', ctx);
const R = G._rules;
const SIZE = 15;   // ★ 产品默认 15×15（之前的测试都跑 9×9，这里专门用默认值）

/** 合成对手：优先堵/连（简单一步扫描），否则随机 —— 用来把局面推到真实复杂度 */
function opponentMove(board, n, me) {
  const opp = me === 1 ? 2 : 1;
  const empties = [];
  for (let i = 0; i < board.length; i++) if (board[i] === 0) empties.push(i);
  // ① 能赢就赢
  for (const i of empties) {
    board[i] = me;
    const w = R.checkWin(board, n, i % n, Math.floor(i / n));
    board[i] = 0;
    if (w) return i;
  }
  // ② 对方能赢就堵
  for (const i of empties) {
    board[i] = opp;
    const w = R.checkWin(board, n, i % n, Math.floor(i / n));
    board[i] = 0;
    if (w) return i;
  }
  // ③ 否则挑一个靠近已有子的空位
  const near = empties.filter(i => {
    const x = i % n, y = Math.floor(i / n);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < n && ny >= 0 && ny < n && board[ny * n + nx] !== 0) return true;
    }
    return false;
  });
  const pool = near.length ? near : empties;
  return pool[Math.floor(Math.random() * pool.length)];
}

function runGame(diff, botIsBlack, maxSteps) {
  const board = new Array(SIZE * SIZE).fill(0);
  // players 固定：bot:1 永远坐 players[0]（= 黑）。机器人执白时把它放 players[1]。
  const players = botIsBlack ? ['bot:1', 'human'] : ['human', 'bot:1'];
  const botColor = botIsBlack ? 1 : 2;
  let turn = 1, moves = 0;
  const timings = [], botMoves = [];
  const t0 = Date.now();
  for (let step = 0; step < maxSteps; step++) {
    let x, y;
    if (turn === botColor) {
      const g = { n: SIZE, board, turn, moves: [], phase: 'play', pending: null, winner: 0, winCells: [], players };
      const host = {
        g: () => g,
        player: (id) => ({ id, name: id, online: true }),
        state: { settings: { gomoku: { difficulty: diff } } },
        now: () => Date.now(), emit: () => {},
      };
      const s0 = Date.now();
      const t = G.botTurn(host);
      timings.push(Date.now() - s0);
      if (!t || !t.action) return { result: 0, moves, timings, botMoves, total: Date.now() - t0, why: 'botTurn 返回 null（第 ' + moves + ' 手后）' };
      x = t.action.x; y = t.action.y;
    } else {
      const i = opponentMove(board, SIZE, turn);
      x = i % SIZE; y = Math.floor(i / SIZE);
    }
    const i = y * SIZE + x;
    if (board[i] !== 0) return { result: 0, moves, timings, botMoves, total: Date.now() - t0, why: '落子撞已有子 ' + x + ',' + y };
    board[i] = turn;
    moves++;
    if (turn === botColor) botMoves.push(x + ',' + y);
    if (R.checkWin(board, SIZE, x, y)) return { result: turn, moves, timings, botMoves, total: Date.now() - t0, why: null };
    if (R.boardFull(board)) return { result: 0, moves, timings, botMoves, total: Date.now() - t0, why: null };
    turn = turn === 1 ? 2 : 1;
  }
  return { result: 0, moves, timings, botMoves, total: Date.now() - t0, why: '步数上限' };
}

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };

console.log('在**默认 15×15**上打整局（机器人走真 botTurn，对手是合成对手）\n');

for (const diff of ['easy', 'normal', 'hard']) {
  for (const botIsBlack of [true, false]) {
    const runs = [];
    for (let i = 0; i < 4; i++) runs.push(runGame(diff, botIsBlack, SIZE * SIZE));
    const all = runs.flatMap(r => r.timings).sort((a, b) => a - b);
    const p50 = all[Math.floor(all.length * 0.5)] || 0;
    const p95 = all[Math.floor(all.length * 0.95)] || 0;
    const mx = all[all.length - 1] || 0;
    const wrong = runs.filter(r => r.why);
    const role = botIsBlack ? '执黑' : '执白';
    console.log('  ' + (diff + ' ' + role).padEnd(14) + ' 步数/局=' + runs.map(r => r.moves).join(',') +
      '  机器人每步 ms: p50=' + p50 + ' p95=' + p95 + ' max=' + mx);
    if (wrong.length) console.log('      异常: ' + JSON.stringify(wrong.map(r => r.why)));
    ok(wrong.length === 0, diff + ' ' + role + '：4 局全部正常下完（无 null、无非法落子）');
    ok(mx < 1000, diff + ' ' + role + '：最慢一步 ' + mx + 'ms < 1000ms（不会让人等）');
    ok(p95 < 300, diff + ' ' + role + '：95% 的步在 ' + p95 + 'ms 内');
  }
}

console.log('\n满盘边界（只剩少量空位时不能卡死）');
{
  const board = new Array(SIZE * SIZE).fill(0);
  for (let i = 0; i < board.length - 10; i++) board[i] = (i % 2) + 1;
  const g = { n: SIZE, board, turn: 1, moves: [], phase: 'play', pending: null, winner: 0, winCells: [], players: ['bot:1', 'h'] };
  const host = { g: () => g, player: (id) => ({ id, name: id, online: true }), state: { settings: { gomoku: { difficulty: 'hard' } } }, now: () => Date.now(), emit: () => {} };
  const s = Date.now();
  const t = G.botTurn(host);
  const dt = Date.now() - s;
  console.log('  只剩 10 个空位：思考 ' + dt + 'ms → ' + (t ? 'x=' + t.action.x + ' y=' + t.action.y : 'null'));
  ok(dt < 1000, '满盘思考 ' + dt + 'ms < 1000ms');
}

console.log('\n' + (fail ? '有 ' + fail + ' 项未通过' : '全部通过'));
process.exit(fail ? 1 : 0);
