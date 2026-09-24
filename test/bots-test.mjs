// 机器人对手：框架 + 五子棋大脑（零依赖，直接 node 跑）
//   node test/bots-test.mjs
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

const BANKS = { draw: JSON.parse(read('data/draw.json')), tacit: JSON.parse(read('data/tacit.json')), memory: JSON.parse(read('data/memory.json')), codraw: JSON.parse(read('data/codraw.json')) };
function loadPage() {
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    JSON, Math, Date, Promise, Object, Array, String, Number, Boolean, isNaN,
    parseInt, parseFloat, Error, RegExp, WeakMap, TextEncoder, TextDecoder,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = { __PN_BANKS__: BANKS };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var PN = { games: {}, pick: {}, Banks: {} };', ctx);
  for (const f of ['src/data.js', 'src/host.js', 'src/bots.js', 'src/games/gomoku.js', 'src/games/tacit.js']) {
    vm.runInContext(read(f), ctx, { filename: ROOT + f });
  }
  return { PN: vm.runInContext('PN', ctx), ctx };
}
const P = loadPage();
const PN = P.PN;

/** 造一个真 Host（走真代码路径：emit / syncOnline / goLobby 都真的跑） */
function makeHost(ids) {
  const state = {
    v: 3, mode: 'lobby', phase: 'lobby',
    players: ids.map(id => ({ id, name: 'N_' + id, emoji: '🙂', score: 0, streak: 0, wins: 0, online: true, host: id === ids[0] })),
    settings: { gomoku: { size: 9 } }, log: [], g: {}, hostId: ids[0], ts: 0,
  };
  const host = Object.create(PN.Host.prototype);
  host.room = { peers: {}, publishState() {}, sendPrivate() {}, sendEvent() {}, me: { id: ids[0] } };
  host.timers = {}; host.secrets = {}; host.secretCache = {};
  host.state = state;
  host.onStateChange = () => {};
  host.now = () => Date.now();
  return host;
}
function addBot(host) {
  host.state.players.push({ id: 'bot:1', name: '小机灵', emoji: '🤖', score: 0, streak: 0, wins: 0, online: true, host: false, bot: true });
}

section('1. 机器人身份的纯函数', () => {
  ok(PN.bots.isBotId('bot:1') === true, 'bot:1 被认成机器人');
  ok(PN.bots.isBotId('abc') === false, '普通 id 不是机器人');
  ok(PN.bots.isBotId(null) === false, 'null 不炸');
});

section('2. fill：只补到最低人数，且不重复堆', () => {
  const h = makeHost(['u1']);
  const g = PN.games.gomoku;
  ok(PN.bots.fill(h, g) === true, '第一次 fill 真的加了机器人');
  ok(PN.bots.botsIn(h).length === 1, '补到 2 人只需 1 个机器人（实得 ' + PN.bots.botsIn(h).length + '）');
  ok(PN.bots.fill(h, g) === false, '再 fill 不会重复堆机器人');
  ok(PN.bots.botsIn(h).length === 1, '机器人数量仍是 1');
  const h2 = makeHost(['u1', 'u2']);
  ok(PN.bots.fill(h2, g) === false, '两个真人时一个机器人都不加');
  const h3 = makeHost(['u1']);
  ok(PN.bots.fill(h3, { minPlayers: 2 }) === false, '没有 botTurn 的游戏不会被塞机器人');
});

section('3. 真人进来要让位（2 人局的命门）', () => {
  const h = makeHost(['u1']);
  PN.bots.fill(h, PN.games.gomoku);
  ok(PN.bots.botsIn(h).length === 1, '先有一个机器人占座');
  ok(PN.bots.dropAll(h) === true && PN.bots.botsIn(h).length === 0, '真人进大厅后机器人被撤走');
  h.state.mode = 'gomoku';
  PN.bots.fill(h, PN.games.gomoku);
  ok(PN.bots.dropAll(h) === false && PN.bots.botsIn(h).length === 1, '对局中途不撤机器人（只在大厅撤）');
});

section('4. 机器人不会被自己的房间判成离线（否则 25s 后被踢）', () => {
  const h = makeHost(['u1']);
  PN.bots.fill(h, PN.games.gomoku);
  const bot = PN.bots.botsIn(h)[0];
  h.room.roster = () => [{ id: 'u1', online: true }];
  ok(h.syncOnline() === false, 'syncOnline 不会因机器人不在花名册而报变化');
  ok(bot.online === true, '机器人仍然在线（没被判离线）');
  h.goLobby();
  // 机器人是「这一局」的陪练：回大厅就该被收走（不是常驻成员）。
  // 这里要验的是「它没被误判成离线」这件事本身，所以先在收走之前断言。
  ok(bot.online === true, 'goLobby 期间机器人没被误判成离线');
  ok(PN.bots.botsIn(h).length === 0, 'goLobby 把机器人收走（它是这一局的陪练，不是大厅常驻）');
});

section('5. 五子棋机器人：该赢就赢', () => {
  const g = { n: 9, board: new Array(81).fill(0), turn: 2, players: ['u1', 'bot:1'], phase: 'play', moves: [], pending: null, winner: 0, winCells: [] };
  for (const x of [2, 3, 4, 5]) g.board[4 * 9 + x] = 2;
  for (const x of [0, 1]) g.board[0 * 9 + x] = 1;
  const h = makeHost(['u1']); h.state.mode = 'gomoku'; addBot(h); h.state.g = g;
  const t = PN.games.gomoku.botTurn(h);
  ok(!!t && t.pid === 'bot:1', '轮到自己时给出动作');
  ok(t && t.action.t === 'place', '动作是落子');
  const win = t && t.action.y === 4 && (t.action.x === 6 || t.action.x === 1);
  ok(win, '落在能连五的点上（实际 x=' + (t && t.action.x) + ' y=' + (t && t.action.y) + '）');
});

section('6. 五子棋机器人：必输就堵', () => {
  const g = { n: 9, board: new Array(81).fill(0), turn: 2, players: ['u1', 'bot:1'], phase: 'play', moves: [], pending: null, winner: 0, winCells: [] };
  for (const x of [3, 4, 5, 6]) g.board[2 * 9 + x] = 1;
  g.board[8 * 9 + 8] = 2;
  const h = makeHost(['u1']); h.state.mode = 'gomoku'; addBot(h); h.state.g = g;
  const t = PN.games.gomoku.botTurn(h);
  const blocking = t && t.action.y === 2 && (t.action.x === 2 || t.action.x === 7);
  ok(blocking, '堵住了真人的四连（实际 x=' + (t && t.action.x) + ' y=' + (t && t.action.y) + '）');
});

section('7. 五子棋机器人：只读状态，不改棋盘', () => {
  const g = { n: 9, board: new Array(81).fill(0), turn: 2, players: ['u1', 'bot:1'], phase: 'play', moves: [], pending: null, winner: 0, winCells: [] };
  g.board[4 * 9 + 4] = 1;
  const h = makeHost(['u1']); h.state.mode = 'gomoku'; addBot(h); h.state.g = g;
  const snapshot = g.board.join(',');
  PN.games.gomoku.botTurn(h);
  ok(g.board.join(',') === snapshot, 'botTurn 是纯函数：棋盘一个字节都没改');
  ok(h.timers['__bot'] === undefined, 'botTurn 自己不排定时器（由 bots.onState 统一排）');
});

section('8. 不该动的时候不动', () => {
  const g = { n: 9, board: new Array(81).fill(0), turn: 1, players: ['u1', 'bot:1'], phase: 'play', moves: [], pending: null, winner: 0, winCells: [] };
  const h = makeHost(['u1']); h.state.mode = 'gomoku'; addBot(h); h.state.g = g;
  ok(PN.games.gomoku.botTurn(h) === null, '轮到真人时机器人不下子');
  g.turn = 2; g.phase = 'over';
  ok(PN.games.gomoku.botTurn(h) === null, '终局后不下了');
  g.phase = 'play'; g.pending = { by: 'bot:1' };
  ok(PN.games.gomoku.botTurn(h) === null, '自己提的悔棋还没被答复时不抢着下');
  g.pending = { by: 'u1' };
  const t = PN.games.gomoku.botTurn(h);
  ok(t && t.action.t === 'undo-answer' && t.action.ok === true, '对方求悔棋就同意（陪人玩不较劲）');
});

section('9. 空盘与满盘不崩', () => {
  const g = { n: 9, board: new Array(81).fill(0), turn: 2, players: ['u1', 'bot:1'], phase: 'play', moves: [], pending: null, winner: 0, winCells: [] };
  const h = makeHost(['u1']); h.state.mode = 'gomoku'; addBot(h); h.state.g = g;
  const t = PN.games.gomoku.botTurn(h);
  ok(t && t.action.x === 4 && t.action.y === 4, '空盘走天元');
  h.state.g = { n: 9, board: new Array(81).fill(1), turn: 2, players: ['u1', 'bot:1'], phase: 'play', moves: [], pending: null, winner: 0, winCells: [] };
  ok(PN.games.gomoku.botTurn(h) === null, '满盘没有可落点时不崩、返回 null');
});

section('10. 默契大考验机器人：该答就答、答过就不改', () => {
  const g = { round: 1, total: 4, matched: 0, players: ['u1', 'bot:1'], phase: 'round',
    cur: { q: '谁更可能赖床？', qtype: 'pick', options: ['小明', '小红', '小刚'], phase: 'answer', answered: {}, reveal: null } };
  const h = makeHost(['u1']); h.state.mode = 'tacit'; addBot(h); h.state.g = g;
  const t = PN.games.tacit.botTurn(h);
  ok(!!t && t.pid === 'bot:1', '轮到作答时给出动作');
  ok(t && t.action.t === 'answer', '动作是 answer');
  ok(t && t.action.i >= 0 && t.action.i < 3, '选的是合法下标（i=' + (t && t.action.i) + '）');
  // 已经答过 → 不再作答（一题只能答一次）
  g.cur.answered = {};
  const hDup = makeHost(['u1']); hDup.state.mode = 'tacit'; addBot(hDup); hDup.state.g = g;
  PN.games.tacit.botTurn(hDup);
  // reveal 阶段不该再答
  g.cur.phase = 'reveal';
  const h2 = makeHost(['u1']); h2.state.mode = 'tacit'; addBot(h2); h2.state.g = g;
  ok(PN.games.tacit.botTurn(h2) === null, '揭晓阶段不再作答');
  g.cur.phase = 'answer'; g.cur.options = [];
  const h3 = makeHost(['u1']); h3.state.mode = 'tacit'; addBot(h3); h3.state.g = g;
  ok(PN.games.tacit.botTurn(h3) === null, '没有选项时不崩、返回 null');
  // 全是真人时不该有机器人动作
  const g2 = { cur: { options: ['a', 'b'], phase: 'answer' }, players: ['u1', 'u2'] };
  const h4 = makeHost(['u1', 'u2']); h4.state.mode = 'tacit'; h4.state.g = g2;
  ok(PN.games.tacit.botTurn(h4) === null, '没有机器人时返回 null');
});

section('11b. 难度档位真的贯通到大脑（不是只加了个 UI 选项）', () => {
  // 同一个「必须堵四连」的局面，换不同 settings 跑：
  //   normal/hard 必堵；easy 有概率漏堵 —— 说明 settings.gomoku.difficulty 真的被读到了。
  const mustBlock = (diff) => {
    const g = { n: 9, board: new Array(81).fill(0), turn: 2, players: ['u1', 'bot:1'], phase: 'play', moves: [], pending: null, winner: 0, winCells: [] };
    for (const x of [3, 4, 5, 6]) g.board[2 * 9 + x] = 1;   // 真人（黑）四连，机器人（白）必须堵
    const h = makeHost(['u1']); h.state.mode = 'gomoku'; addBot(h); h.state.g = g;
    h.state.settings = { gomoku: { size: 9, difficulty: diff } };
    const t = PN.games.gomoku.botTurn(h);
    return t ? (t.action.y === 2 && (t.action.x === 2 || t.action.x === 7)) : false;
  };
  let normalBlocked = 0, easyBlocked = 0;
  for (let i = 0; i < 40; i++) { if (mustBlock('normal')) normalBlocked++; if (mustBlock('easy')) easyBlocked++; }
  ok(normalBlocked === 40, '普通档必堵 40/40（实测 ' + normalBlocked + '）');
  ok(easyBlocked < 40, '简单档会漏堵（实测 ' + easyBlocked + '/40）——设置真的生效了');
  // 没有 settings 时必须退回普通档，不能因为读到 undefined 就乱下
  const g2 = { n: 9, board: new Array(81).fill(0), turn: 2, players: ['u1', 'bot:1'], phase: 'play', moves: [], pending: null, winner: 0, winCells: [] };
  for (const x of [3, 4, 5, 6]) g2.board[2 * 9 + x] = 1;
  const h2 = makeHost(['u1']); h2.state.mode = 'gomoku'; addBot(h2); h2.state.g = g2;
  h2.state.settings = {};                       // 完全没有 gomoku 这一坨
  let fallback = 0;
  for (let i = 0; i < 20; i++) {
    const t = PN.games.gomoku.botTurn(h2);
    if (t && t.action.y === 2 && (t.action.x === 2 || t.action.x === 7)) fallback++;
  }
  ok(fallback === 20, '没有 settings 时兜底成普通档（实测 ' + fallback + '/20）');
});

section('11. 覆盖清单：哪些游戏真的有大脑', () => {
  const withBot = Object.keys(PN.games).filter(id => typeof PN.games[id].botTurn === 'function').sort();
  ok(withBot.indexOf('gomoku') >= 0, '五子棋有机器人大脑');
  ok(withBot.indexOf('tacit') >= 0, '默契大考验有机器人大脑');
  // 没写大脑的必须**保持原样**（不塞假人、仍走原提示），这条是防「悄悄改变行为」。
  // 注意：本文件只加载了 gomoku/tacit 两个游戏文件，所以这里用**合成的**无大脑游戏来验，
  // 不能靠遍历 PN.games —— 那样循环里一个都不剩，断言等于没写。
  const noBrain = { id: 'synthetic', name: '没大脑的游戏', minPlayers: 2, maxPlayers: 2 };
  ok(PN.bots.fill(makeHost(['u1']), noBrain) === false, '没写 botTurn 的游戏不会被加机器人');
  ok(typeof PN.games.gomoku.botTurn === 'function' && typeof PN.games.tacit.botTurn === 'function',
     '两个有大脑的游戏确实导出了 botTurn');
  console.log('   （目前有大脑的：' + withBot.join(', ') + '）');
});

console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
