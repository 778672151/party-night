// 五子棋机器人棋力：档位是否真的有差别 + 是否强于随机（用**真对局**量，不看代码）
//   node test/bots-strength.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const ctx = vm.createContext({
  console, JSON, Math, Date, Object, Array, String, Number, Boolean, isNaN, parseInt, parseFloat, Error, RegExp,
  setTimeout: () => ({}), clearTimeout: () => {}, setInterval: () => ({}), clearInterval: () => {},
});
ctx.globalThis = ctx;
vm.runInContext('var PN = { games: {}, pick: {}, Banks: {} };', ctx);
// botTurn 用 PN.bots.isBotId 认自己人 —— 不加载 bots.js 的话它会认为"这局没有机器人"而返回 null
vm.runInContext(read('src/bots.js'), ctx, { filename: ROOT + 'src/bots.js' });
vm.runInContext(read('src/games/gomoku.js'), ctx, { filename: ROOT + 'src/games/gomoku.js' });
const G = vm.runInContext('PN.games.gomoku', ctx);
const R = G._rules;
const N = 9;

/** 用 botTurn 的算法直接对下：me 执黑先。返回 1/2 胜者，0 平 */
function playOne(diffBlack, diffWhite) {
  const board = new Array(N * N).fill(0);
  const players = ['b', 'w'];
  let turn = 1;
  for (let step = 0; step < N * N; step++) {
    // 两个都是"机器人"，但 botTurn 一次只驱动 g.players 里**第一个** bot。
    // 于是让"该走的那一方"坐 players[0]（即执黑位），难度也按该走方给 ——
    // 这样每步都由「轮到的那一方、用它的难度」来算，等价于两档各下各的棋。
    const mover = turn === 1 ? 'bot:1' : 'bot:2';
    const other = turn === 1 ? 'bot:2' : 'bot:1';
    const g = { n: N, board, turn, players: [mover, other], moves: [], phase: 'play', pending: null, winner: 0, winCells: [] };
    const host = {
      g: () => g,
      player: (id) => ({ id, name: id, online: true }),
      state: { settings: { gomoku: { difficulty: turn === 1 ? diffBlack : diffWhite } } },
      now: () => 0,
      emit: () => {},
    };
    const t = G.botTurn(host);
    if (!t || !t.action) return turn === 1 ? 2 : 1;   // 没得下 = 对方赢
    const x = t.action.x, y = t.action.y;
    const i = y * N + x;
    if (board[i] !== 0) throw new Error('机器人落到了已占的格子 ' + x + ',' + y);
    board[i] = turn;
    if (R.checkWin(board, N, x, y)) return turn;
    if (R.boardFull(board)) return 0;
    turn = turn === 1 ? 2 : 1;
  }
  return 0;
}

/** 随机对手：用来当"地板"，证明机器人确实不是瞎下 */
function playVsRandom(diff, botIsBlack) {
  const board = new Array(N * N).fill(0);
  let turn = 1;
  for (let step = 0; step < N * N; step++) {
    const botTurnNow = (turn === 1) === botIsBlack;
    let x, y;
    if (botTurnNow) {
      // ⚠️ botTurn 用 colorOf(g, id) 判断"该不该我走"，而 colorOf 看的是 players[0]=黑、players[1]=白。
      // 所以机器人执黑时 players 必须是 ['bot:1','human']；执白时必须反过来，否则 botTurn 返回 null。
      const g = {
        n: N, board, turn, moves: [], phase: 'play', pending: null, winner: 0, winCells: [],
        players: botIsBlack ? ['bot:1', 'human'] : ['human', 'bot:1'],
      };
      const host = {
        g: () => g, player: (id) => ({ id, name: id, online: true }),
        state: { settings: { gomoku: { difficulty: diff } } }, now: () => 0, emit: () => {},
      };
      const t = G.botTurn(host);
      if (!t || !t.action) throw new Error('botTurn 该动却没动：turn=' + turn + ' botIsBlack=' + botIsBlack);
      x = t.action.x; y = t.action.y;
    } else {
      const empties = [];
      for (let i = 0; i < board.length; i++) if (board[i] === 0) empties.push(i);
      const pick = empties[Math.floor(Math.random() * empties.length)];
      x = pick % N; y = Math.floor(pick / N);
    }
    const i = y * N + x;
    board[i] = turn;
    if (R.checkWin(board, N, x, y)) return turn;
    if (R.boardFull(board)) return 0;
    turn = turn === 1 ? 2 : 1;
  }
  return 0;
}

console.log('五子棋棋力量测\n');

// ⚠️ 先说清一件事：**9×9 上先手几乎必胜**，所以「胜率」根本区分不出档位强弱。
// 实测（各 20 局）：hard vs hard 黑 20 白 0；normal vs normal 黑 20 白 0；
// 甚至 easy vs easy 也是黑 13 白 7 —— 同档对下就是"谁先手谁赢"。
// 所以我用**战术探针**（该堵四连时堵不堵、该赢时赢不赢）来量档位，而不是用胜率。
// 顺带把这条实测记下来，免得后人再拿胜率当棋力指标。

/** 必须堵：对手（白）四连，机器人执黑必须堵在两端之一 */
function mustBlock(diff, times) {
  let blocked = 0;
  for (let i = 0; i < times; i++) {
    const board = new Array(N * N).fill(0);
    for (const x of [3, 4, 5, 6]) board[2 * N + x] = 2;   // 白四连
    board[7 * N + 7] = 1;
    const g = { n: N, board, turn: 1, players: ['bot:1', 'h'], moves: [], phase: 'play', pending: null, winner: 0, winCells: [] };
    const host = { g: () => g, player: (id) => ({ id, name: id, online: true }), state: { settings: { gomoku: { difficulty: diff } } }, now: () => 0, emit: () => {} };
    const t = G.botTurn(host);
    if (t && t.action.y === 2 && (t.action.x === 2 || t.action.x === 7)) blocked++;
  }
  return blocked;
}
/** 必须赢：自己有活四，机器人必须直接连五 */
function mustWin(diff, times) {
  let won = 0;
  for (let i = 0; i < times; i++) {
    const board = new Array(N * N).fill(0);
    for (const x of [3, 4, 5, 6]) board[4 * N + x] = 1;   // 机器人（黑）四连
    board[0] = 2;
    const g = { n: N, board, turn: 1, players: ['bot:1', 'h'], moves: [], phase: 'play', pending: null, winner: 0, winCells: [] };
    const host = { g: () => g, player: (id) => ({ id, name: id, online: true }), state: { settings: { gomoku: { difficulty: diff } } }, now: () => 0, emit: () => {} };
    const t = G.botTurn(host);
    if (t && t.action.y === 4 && (t.action.x === 2 || t.action.x === 7)) won++;
  }
  return won;
}

console.log('  战术探针（各 40 次，看**行为**而不是看代码）：');
const blockRate = {};
for (const d of ['easy', 'normal', 'hard']) {
  blockRate[d] = mustBlock(d, 40);
  console.log('    ' + d.padEnd(7) + ' 必堵四连：堵住 ' + blockRate[d] + '/40');
}
console.log('    ' + '必赢'.padEnd(7) + '（连五）');
for (const d of ['easy', 'normal', 'hard']) {
  const w = mustWin(d, 40);
  console.log('      ' + d.padEnd(7) + ' 必胜局面：赢下 ' + w + '/40');
  ok(w === 40, d + ' 档在必胜局面 40/40 直接连五（机器人"故意不赢"会很假）');
}

// 核心判据：普通/困难必须**该堵就堵**；简单档要明显漏堵（否则它不叫简单）
ok(blockRate.normal === 40, '普通档必堵四连 40/40（实测 ' + blockRate.normal + '）');
ok(blockRate.hard === 40, '困难档必堵四连 40/40（实测 ' + blockRate.hard + '）');
ok(blockRate.easy < 40, '简单档确实会漏堵（实测 ' + blockRate.easy + '/40）——这是它能被击败的原因');
ok(blockRate.easy > 0, '简单档也不是完全瞎下（实测 ' + blockRate.easy + '/40）——仍有一半概率看见');

// 地板：三档对**随机**对手都该赢（证明确实在下棋，而不是乱走）
console.log('\n  对随机对手（各 20 局，先手各半）：');
for (const d of ['easy', 'normal', 'hard']) {
  let win = 0;
  for (let i = 0; i < 20; i++) {
    const botIsBlack = i % 2 === 0;
    const r = playVsRandom(d, botIsBlack);
    const botColor = botIsBlack ? 1 : 2;
    if (r === botColor) win++;
  }
  const rate = Math.round(win / 20 * 100);
  console.log('    ' + d.padEnd(7) + ' 胜率 ' + rate + '%（' + win + '/20）');
  ok(rate >= 80, d + ' 档对随机对手胜率 >= 80%（实测 ' + rate + '%）');
}

console.log('\n  （记录：9×9 同档对下先手几乎必胜 —— 所以"胜率"不能当棋力指标，' +
  '真正的档位差异要看上面的战术探针。）');

console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
