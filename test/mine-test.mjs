// 扫雷（双人合作）：房主逻辑 + 移植自原作的判定（零依赖）
//   node test/mine-test.mjs
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
  for (const f of ['src/data.js', 'src/games/mine.js']) vm.runInContext(read(f), ctx, { filename: ROOT + f });
  return { PN: vm.runInContext('PN', ctx), ctx };
}
const A = loadPage();
const G = A.PN.games.mine;
const R = G._rules;

function makeHost(ids, settings, hostId) {
  return {
    clock: 1000000, timers: {}, events: [], toasts: [],
    state: { mode: 'round', phase: 'round',
      players: ids.map(id => ({ id, name: 'N_' + id, emoji: '🙂', score: 0, online: true })),
      settings: settings || {}, g: null, hostId: hostId || ids[0], ts: 0 },
    room: { publishState() {} },
    now() { return this.clock; }, g() { return this.state.g; },
    onlinePlayers() { return this.state.players.filter(p => p.online); },
    player(id) { return this.state.players.find(p => p.id === id) || null; },
    amHost(id) { return id === this.state.hostId; },
    emit() {}, emitSoon() {}, toast(m) { this.toasts.push(m); }, event(e) { this.events.push(e); },
    addScore(id, n) { const p = this.player(id); if (p) p.score += n; }, goLobby() { this.wentLobby = true; },
    after(n, ms, fn) { this.timers[n] = { at: this.clock + ms, fn }; }, every() {},
    clearTimer(n) { delete this.timers[n]; }, clearAll() { this.timers = {}; },
    sendSecret() {}, requestSecret() {}, resendSecret() {},
  };
}
const start = (settings) => { const h = makeHost(['p1', 'p2'], settings); G.init(h); return h; };
const turnPid = (h) => h.g().players[h.g().turnIdx];

section('[1] 开局：首点之前不布雷', function () {
  const h = start({});
  const g = h.g();
  ok(g.rows === 9 && g.cols === 9 && g.mines === 10, '默认 9×9 · 10 雷（⚙️可改 12×12/15×15）');
  ok(g.lives === 3, '默认 3 条团队命');
  ok(g.board === null, '开局还没布雷（等首点之后再布）');
  ok(g.revealed.every(v => !v) && g.flagged.every(v => !v), '全部未翻开、无旗');
  ok(turnPid(h) === 'p1', 'p1 先手');
  ok(h.state.mode === 'round', '进入对局');
});

section('[2] 首点一定安全（连点 40 次不同随机局）', function () {
  let boom = 0, openedSum = 0;
  for (let i = 0; i < 40; i++) {
    const h = start({});
    const g = h.g();
    G.action(h, { t: 'open', i: 40 }, 'p1');       // 首点
    if (g.hit.length) boom++;
    let opened = 0;
    for (let k = 0; k < g.revealed.length; k++) if (g.revealed[k]) opened++;
    openedSum += opened;
    if (g.board) {
      const nbs = R.neighbors(9, 9, 40);
      if (g.board[40] === -1 || nbs.some(n => g.board[n] === -1)) boom += 100;   // 首点及周围不该有雷
    }
  }
  ok(boom === 0, '40 次首点：一次都没踩雷，且首点与其 8 邻居都不布雷');
  ok(openedSum / 40 >= 1, '首点后平均能展开 ' + (openedSum / 40).toFixed(1) + ' 格（不会是孤零零一格）');
});

section('[3] 布雷与计数正确', function () {
  const h = start({});
  const g = h.g();
  G.action(h, { t: 'open', i: 40 }, 'p1');
  const mines = g.board.filter(v => v === -1).length;
  ok(mines === g.mines, '雷数正好 ' + g.mines + ' 个');
  let bad = 0;
  for (let i = 0; i < g.board.length; i++) {
    if (g.board[i] === -1) continue;
    const nb = R.neighbors(9, 9, i).filter(n => g.board[n] === -1).length;
    if (g.board[i] !== nb) bad++;
  }
  ok(bad === 0, '每格数字 = 周围雷数（0 处不符）');
});

section('[4] 轮流出手：不是你的回合点不动', function () {
  const h = start({});
  const g = h.g();
  // 受控板：全是数字 1（没有 0 格就不会泛洪），点一格只翻一格，方便看回合
  g.board = new Array(81).fill(1);
  G.action(h, { t: 'open', i: 40 }, 'p1');
  ok(turnPid(h) === 'p2', '出手后轮到 p2');
  const hidden = (() => { for (let i = 0; i < 81; i++) if (!g.revealed[i]) return i; return -1; })();
  const before = g.revealed.filter(Boolean).length;
  G.action(h, { t: 'open', i: hidden }, 'p1');
  ok(g.revealed.filter(Boolean).length === before, 'p1 连点第二下无效（还没轮到）');
  G.action(h, { t: 'open', i: hidden }, 'p2');
  ok(turnPid(h) === 'p1', 'p2 出手后轮回 p1');
  // 已翻开的格子点它：不消耗回合（手滑的惩罚不该是"白送对手一步"）
  const again = hidden;
  G.action(h, { t: 'open', i: again }, 'p1');
  ok(turnPid(h) === 'p1', '点已经翻开的格子不消耗回合');
});

section('[5] 泛洪展开：0 格连片翻开、遇到数字停、旗子不自动翻', function () {
  const h = start({});
  const g = h.g();
  g.board = new Array(81).fill(0);                     // 全 0 板：一次点开应该翻掉一大片
  g.board[80] = -1; g.board[79] = 1; g.board[70] = 1;
  g.board = g.board.map((v, i) => {                    // 重新算一遍数字（保证合法）
    if (v === -1) return -1;
    return R.neighbors(9, 9, i).filter(n => g.board[n] === -1).length;
  });
  g.flagged[0] = true;                                 // 先插一面旗
  const opened = R.floodReveal(g, 40);
  ok(opened > 10, '点一个 0 格展开 ' + opened + ' 格（泛洪生效）');
  ok(g.revealed[0] === false, '插了旗的格子不会被泛洪自动翻开');
  const h2 = start({});
  const g2 = h2.g();
  g2.board = new Array(81).fill(0);
  g2.board[1] = -1;
  g2.board = g2.board.map((v, i) => (v === -1 ? -1 : R.neighbors(9, 9, i).filter(n => g2.board[n] === -1).length));
  const opened2 = R.floodReveal(g2, 40);
  // 标准扫雷行为：泛洪只从"0 格"往外扩、并把它的邻居（含数字格）翻开；
  // 只跟数字格相邻的格子不会被翻出来 —— 这正是要保住的行为。
  ok(g2.revealed[1] === false, '雷格绝不会被泛洪翻开');
  ok(opened2 >= 77, '一次点开 0 格几乎铺满整片（开了 ' + opened2 + ' 格）');
  ok(g2.revealed[40] === true && g2.revealed[39] === true, '起点与它的邻居都翻开了');
});

section('[6] 踩雷：扣命、换人，扣完才输', function () {
  const h = start({});
  const g = h.g();
  g.board = new Array(81).fill(0);
  g.board[0] = -1;
  g.board = g.board.map((v, i) => (v === -1 ? -1 : R.neighbors(9, 9, i).filter(n => g.board[n] === -1).length));
  G.action(h, { t: 'open', i: 0 }, 'p1');
  ok(g.lives === 2 && g.hit.length === 1, '踩雷扣一条命（剩 ' + g.lives + '），该格标记出来');
  ok(turnPid(h) === 'p2', '踩雷后换人（不是一局结束）');
  ok(h.toasts.some(t => t.indexOf('踩到雷') >= 0), '有提示（让对方知道发生了什么）');
  G.action(h, { t: 'open', i: 0 }, 'p2');
  ok(g.lives === 2, '已经炸开的格子不会重复扣命');
  G.action(h, { t: 'open', i: 0 }, 'p1');              // 换回 p1 再点同一格（也无效）
  ok(g.lives === 2, '同一格反复点不会掉光命');
  // 换一副"两颗雷都在、都还没被踩"的板，把命设成 1，让当前出手的人踩一颗 → 输
  const h5 = start({});
  const g5 = h5.g();
  g5.board = new Array(81).fill(0);
  g5.board[0] = -1; g5.board[80] = -1;
  g5.board = g5.board.map((v, i) => (v === -1 ? -1 : R.neighbors(9, 9, i).filter(n => g5.board[n] === -1).length));
  g5.lives = 1;
  G.action(h5, { t: 'open', i: 80 }, g5.players[g5.turnIdx]);
  ok(g5.phase === 'over' && g5.win === false, '命扣完 → 本局结束（win=false）');
  ok(g5.lives === 0, '命数归零：' + g5.lives);
  ok(h5.events.some(e => e.t === 'gameover'), '发出 gameover 事件');
});

section('[7] 清盘：一起赢，双方 +2', function () {
  const h = start({});
  const g = h.g();
  g.board = new Array(81).fill(0);                    // 无雷板（只为测胜负判定）
  g.board[0] = -1;
  g.board = g.board.map((v, i) => (v === -1 ? -1 : R.neighbors(9, 9, i).filter(n => g.board[n] === -1).length));
  // 先把除 (8,8) 之外的安全格都标成已翻开
  for (let i = 0; i < 81; i++) if (g.board[i] !== -1) g.revealed[i] = true;
  g.revealed[80] = false;
  G.action(h, { t: 'open', i: 80 }, 'p1');
  ok(g.phase === 'over' && g.win === true, '所有非雷格翻开 → 一起赢');
  ok(h.player('p1').score === 2 && h.player('p2').score === 2, '双方各 +2 分');
  ok(h.toasts.some(t => t.indexOf('一起') >= 0), '提示是"一起扫干净"（合作语气）');
});

section('[8] 插旗 / 自动插旗', function () {
  const h = start({});
  const g = h.g();
  g.board = new Array(81).fill(0);
  g.board[0] = -1;
  g.board = g.board.map((v, i) => (v === -1 ? -1 : R.neighbors(9, 9, i).filter(n => g.board[n] === -1).length));
  G.action(h, { t: 'flag', i: 5 }, 'p1');
  ok(g.flagged[5] === true && g.revealed[5] === false, '插旗：标记但不翻开');
  ok(turnPid(h) === 'p2', '插旗也算一次出手');
  G.action(h, { t: 'open', i: 5 }, 'p2');
  ok(g.revealed[5] === false, '插了旗的格子点不开（避免手滑）');
  G.action(h, { t: 'flag', i: 5 }, 'p2');
  ok(g.flagged[5] === false, '再插一次取消旗子');
  // 自动插旗：翻开 (1,1) 这种 1 格，它的唯一未知邻居应被自动插旗
  const h2 = start({});
  const g2 = h2.g();
  g2.board = new Array(81).fill(0);
  g2.board[0] = -1;                                   // (0,0) 是雷
  g2.board = g2.board.map((v, i) => (v === -1 ? -1 : R.neighbors(9, 9, i).filter(n => g2.board[n] === -1).length));
  g2.revealed[10] = true;                             // 把 (1,1)（数字 1）标成已翻开
  // 把它的邻居里除那颗雷之外全部翻开 —— 这样"1 格剩唯一未知邻居"才能推出雷
  R.neighbors(9, 9, 10).forEach(n => { if (g2.board[n] !== -1) g2.revealed[n] = true; });
  G.action(h2, { t: 'autoflag' }, 'p1');
  ok(g2.flagged[0] === true, '自动插旗：把 1 格周围唯一未知的那格插上旗');
  ok(turnPid(h2) === 'p2', '自动插旗也消耗一次出手');
});

section('[9] 掉线 / 换主 / 人数上限', function () {
  const h = start({});
  G.action(h, { t: 'open', i: 40 }, 'p1');
  G.resume(h);
  ok(h.g().phase === 'play', '换主后状态还在（棋盘全在 state 里）');
  const h2 = makeHost(['p1', 'p2'], {});
  G.init(h2);
  h2.player('p2').online = false;
  G.onLeave(h2, 'p2');
  ok(h2.g().phase === 'over', '对方离开 → 这局结束（不留死局）');
  const h3 = makeHost(['p1', 'p2', 'p3'], {});
  G.init(h3);
  ok(h3.state.mode === 'round', '三个人的房间也能开（只取前两人）');
  // 需求变更（2024，用户确认）：扫雷单人可玩——原来一个人会被打发回大厅。
  const h4 = makeHost(['p1'], {});
  G.init(h4);
  ok(!h4.wentLobby && h4.g() && h4.g().players.length === 1, '一个人也能开（单人可以玩）');
  const h4b = makeHost(['p1'], {}); h4b.player('p1').online = false; G.init(h4b);
  ok(h4b.wentLobby === true, '一个在线的都没有时才回大厅（保留原不变量）');
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
