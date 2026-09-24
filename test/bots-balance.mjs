// 平衡性实测 + 参数扫描：让休闲玩家**有机会赢**，同时保证三档确实不同
//   node test/bots-balance.mjs          # 只量当前 LEVELS
//   node test/bots-balance.mjs sweep    # 扫一批候选参数，挑最好的一组
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
const N = 15;   // 产品默认盘

/** 休闲玩家：会连五、会堵四连、会堵活三，但有 missRate 概率看漏；
 *  剩余手在已有子附近随机挑。这是"偶尔玩两把的朋友"的合理近似。 */
function casualMove(board, me, missRate) {
  const opp = me === 1 ? 2 : 1;
  const empties = [];
  for (let i = 0; i < board.length; i++) if (board[i] === 0) empties.push(i);
  const near = empties.filter(i => {
    const x = i % N, y = Math.floor(i / N);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < N && ny >= 0 && ny < N && board[ny * N + nx] !== 0) return true;
    }
    return false;
  });
  const pool = near.length ? near : empties;
  if (Math.random() >= missRate) {
    for (const i of pool) { board[i] = me; const w = R.checkWin(board, N, i % N, Math.floor(i / N)); board[i] = 0; if (w) return i; }
    for (const i of pool) { board[i] = opp; const w = R.checkWin(board, N, i % N, Math.floor(i / N)); board[i] = 0; if (w) return i; }
    for (const i of pool) {                       // 堵活三
      board[i] = opp;
      let three = false;
      for (let d = 0; d < 4; d++) {
        const dx = [1, 0, 1, 1][d], dy = [0, 1, 1, -1][d];
        let c = 1;
        for (let s = 1; s < 5; s++) { const x = (i % N) + dx * s, y = Math.floor(i / N) + dy * s; if (x < 0 || x >= N || y < 0 || y >= N || board[y * N + x] !== opp) break; c++; }
        for (let s = 1; s < 5; s++) { const x = (i % N) - dx * s, y = Math.floor(i / N) - dy * s; if (x < 0 || x >= N || y < 0 || y >= N || board[y * N + x] !== opp) break; c++; }
        if (c >= 3) { three = true; break; }
      }
      board[i] = 0;
      if (three) return i;
    }
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function oneGame(diff, missRate) {
  const board = new Array(N * N).fill(0);
  const botIsBlack = Math.random() < 0.5;
  const players = botIsBlack ? ['bot:1', 'human'] : ['human', 'bot:1'];
  const botColor = botIsBlack ? 1 : 2;
  let turn = 1;
  for (let step = 0; step < N * N; step++) {
    let i;
    if (turn === botColor) {
      const g = { n: N, board, turn, moves: [], phase: 'play', pending: null, winner: 0, winCells: [], players };
      const host = { g: () => g, player: (id) => ({ id, name: id, online: true }),
        state: { settings: { gomoku: { difficulty: diff } } }, now: () => Date.now(), emit: () => {} };
      const t = G.botTurn(host);
      if (!t || !t.action) return 'human';
      i = t.action.y * N + t.action.x;
    } else i = casualMove(board, turn, missRate);
    if (board[i] !== 0) return 'draw';
    board[i] = turn;
    if (R.checkWin(board, N, i % N, Math.floor(i / N))) return turn === botColor ? 'bot' : 'human';
    if (R.boardFull(board)) return 'draw';
    turn = turn === 1 ? 2 : 1;
  }
  return 'draw';
}

function humanWinRate(diff, games, missRate) {
  let win = 0;
  for (let k = 0; k < games; k++) if (oneGame(diff, missRate) === 'human') win++;
  return win / games;
}

if (process.argv[2] === 'sweep') {
  // 扫参数：目标是 normal ≈ 45~55%、easy ≈ 65~80%、hard <= 15%（休闲玩家胜率）
  const GAMES = 40;
  const cands = [];
  for (const blunder of [0.15, 0.25, 0.35, 0.45]) {
    cands.push({ blunder, atk: 0.80, def: 0.85, blockFive: 0.97, blockThree: 0.85, topN: 4, lookahead: false });
  }
  console.log('扫描 ' + cands.length + ' 组（每组 ' + GAMES + ' 局），找 normal 的甜蜜点…\n');
  const rows = [];
  for (const c of cands) {
    G._rules.LEVELS.normal = c;
    // 两种玩家强度都量：新手（25% 看漏）与"会玩"（8% 看漏），给出诚实区间
    const wrNew = humanWinRate('normal', GAMES, 0.25);
    const wrOk = humanWinRate('normal', GAMES, 0.08);
    rows.push({ c, wrNew, wrOk });
    console.log('  blunder=' + String(c.blunder).padEnd(5) +
      ' → 新手胜率 ' + String(Math.round(wrNew * 100)).padStart(3) + '%' +
      '  会玩胜率 ' + String(Math.round(wrOk * 100)).padStart(3) + '%');
  }
  // 目标：新手能赢（>=35%），会玩的人有来有回（不要求他稳赢，20~60% 都算合理）
  const good = rows.filter(r => r.wrNew >= 0.35 && r.wrOk >= 0.20);
  if (good.length) {
    const pick = good.sort((a, b) => Math.abs(a.wrNew - 0.5) - Math.abs(b.wrNew - 0.5))[0];
    console.log('\n建议 normal：' + JSON.stringify(pick.c));
    console.log('  → 新手胜率 ' + Math.round(pick.wrNew * 100) + '%，会玩胜率 ' + Math.round(pick.wrOk * 100) + '%');
  } else {
    console.log('\n没有同时满足「新手 >=35% 且 会玩 >=20%」的候选，需要继续加大 blunder');
  }
} else {
  const GAMES = Number(process.argv[3]) || 60;
  console.log('休闲玩家（会堵活三、25% 看漏）对三档机器人，各 ' + GAMES + ' 局\n');
  const rep = {};
  for (const diff of ['easy', 'normal', 'hard']) {
    const wr = humanWinRate(diff, GAMES, 0.25);
    rep[diff] = wr;
    console.log('  ' + diff.padEnd(7) + ' 玩家胜率 ' + Math.round(wr * 100) + '%');
  }
  console.log('\n判据（产品体验，不是断言）：');
  console.log('  · easy 应明显比 normal 松：' + Math.round(rep.easy * 100) + '% vs ' + Math.round(rep.normal * 100) + '%');
  console.log('  · normal 应让休闲玩家有机会赢（目标 40~60%）：实际 ' + Math.round(rep.normal * 100) + '%'
    + (rep.normal >= 0.40 && rep.normal <= 0.60 ? ' ✓' : ' ⚠ 偏离'));
  console.log('  · hard 应该认真下（目标 <=15%）：实际 ' + Math.round(rep.hard * 100) + '%'
    + (rep.hard <= 0.15 ? ' ✓' : ' ⚠ 偏离'));
}
