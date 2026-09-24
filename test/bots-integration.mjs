// 集成：单人在真 Host 上开局 → 机器人自动补位 → 自动应招 → 直到终局
//   node test/bots-integration.mjs
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
  const timers = [];
  const sandbox = {
    console, JSON, Math, Date, Promise, Object, Array, String, Number, Boolean, isNaN,
    parseInt, parseFloat, Error, RegExp, WeakMap, TextEncoder, TextDecoder,
    // 受控时钟：setTimeout 只登记，由测试手动快进，这样机器人一定能"出手"而不用真等
    setTimeout: (fn, ms) => { const id = { fn, ms: ms || 0, dead: false }; timers.push(id); return id; },
    clearTimeout: (id) => { if (id) id.dead = true; },
    setInterval: (fn, ms) => { const id = { fn, ms: ms || 0, dead: false, rep: true }; timers.push(id); return id; },
    clearInterval: (id) => { if (id) id.dead = true; },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = { __PN_BANKS__: BANKS };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var PN = { games: {}, pick: {}, Banks: {} };', ctx);
  for (const f of ['src/data.js', 'src/host.js', 'src/bots.js', 'src/games/gomoku.js']) {
    vm.runInContext(read(f), ctx, { filename: ROOT + f });
  }
  return { PN: vm.runInContext('PN', ctx), ctx, timers };
}
const P = loadPage(); const PN = P.PN;

function makeHost(ids) {
  const state = {
    v: 3, mode: 'lobby', phase: 'lobby',
    players: ids.map(id => ({ id, name: 'N_' + id, emoji: '🙂', score: 0, streak: 0, wins: 0, online: true, host: id === ids[0] })),
    settings: { gomoku: { size: 9 } }, log: [], g: {}, hostId: ids[0], ts: 0,
  };
  const host = Object.create(PN.Host.prototype);
  // 花名册必须像真 room.roster() 一样列出**所有** peers（含自己）。
  // 之前这里写死成只返回 u1，于是第二个真人一进来就被 syncOnline 判成离线，
  // 机器人又被补了回来 —— 是测试的假花名册不真实，不是产品缺陷。
  // 花名册必须像真 room.roster() 一样：它每轮都会**把房主自己写进 peers**
  // （room.js:257 this.peers[this.me.id] = {...}）。少了这一步，goLobby() 的
  // !!room.peers[p.id] 会把房主自己判成离线 —— 是测试假花名册不真实，不是产品缺陷。
  host.room = {
    peers: {}, publishState() {}, sendPrivate() {}, sendEvent() {}, me: { id: ids[0], name: 'N_' + ids[0], emoji: '🙂', pub: null },
    roster() {
      this.peers[this.me.id] = { id: this.me.id, name: this.me.name, emoji: this.me.emoji, pub: this.me.pub, lastSeen: Date.now() };
      return Object.keys(this.peers).map(k => ({ id: k, online: true }));
    },
  };
  host.timers = {}; host.secrets = {}; host.secretCache = {};
  host.state = state; host.onStateChange = () => {}; host.now = () => Date.now();
  return host;
}
/** 让所有已登记的定时器到点（最多 200 轮，防死循环） */
function flush(timers) {
  let n = 0;
  while (n++ < 200) {
    const live = timers.filter(t => !t.dead && !t.done);
    if (!live.length) break;
    live.sort((a, b) => a.ms - b.ms);
    const t = live[0]; t.done = true;
    if (!t.rep) {
      // 从 host.timers 里把登记名删掉（复刻 clearTimer 的行为）
      for (const k in PN.hostTimers) {}
    }
    t.fn();
  }
}
// 把 host.after 登记的 timer 句柄也标记 done，避免重复触发
function runHostTimers(host) {
  let n = 0;
  while (n++ < 300) {
    const keys = Object.keys(host.timers);
    if (!keys.length) break;
    const k = keys[0];
    const id = host.timers[k];
    delete host.timers[k];        // 复刻 after() 里的 delete self.timers[name]
    if (id && !id.dead) id.fn();
  }
}

section('1. 一个人开五子棋：机器人自动补位并开局', () => {
  const h = makeHost(['u1']);
  h.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
  ok(h.state.mode === 'gomoku', '真的进了五子棋（没被人不够挡住）');
  ok(PN.bots.botsIn(h).length === 1, '自动补了 1 个机器人');
  ok(h.state.players.length === 2, '名单是 2 人');
  const g = h.g();
  ok(g.phase === 'play', '局面进入 play');
  ok(g.players.length === 2 && g.players.indexOf('bot:1') >= 0, '机器人进了 g.players 参与轮次');
});

section('2. 机器人会自己应招（走真 dispatch，不是直接改 state）', () => {
  const h = makeHost(['u1']);
  h.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
  const g = h.g();
  // 先让真人走一步（如果黑是机器人就先跑定时器）
  let guard = 0;
  while (h.g().phase === 'play' && guard++ < 60) {
    const me = h.g();
    const botColor = me.players.indexOf('bot:1') >= 0 ? (me.players[0] === 'bot:1' ? 1 : 2) : 0;
    if (me.turn !== botColor) {
      // 轮到真人：随便找个能下的点
      let placed = false;
      for (let i = 0; i < me.board.length && !placed; i++) {
        if (me.board[i] === 0) { const n = me.n; h.dispatch({ t: 'place', x: i % n, y: Math.floor(i / n) }, 'u1'); placed = true; }
      }
      if (!placed) break;
    }
    runHostTimers(h);       // 轮到机器人：把定时器跑掉，它自己 dispatch
  }
  ok(guard < 60, '在 60 步内结束（没死循环）');
  const fin = h.g();
  ok(fin.phase === 'over', '对局真的走到了终局（phase=' + fin.phase + '）');
  ok(fin.moves.length >= 9, '双方都真的落了子（共 ' + fin.moves.length + ' 手）');
  const botMoves = fin.moves.filter(m => (h.player('bot:1') && true));
  const botCells = fin.board.filter((v, i) => {
    const x = i % fin.n, y = Math.floor(i / fin.n);
    return fin.moves.some(m => m.x === x && m.y === y && m.color === (fin.players[0] === 'bot:1' ? 1 : 2));
  }).length;
  ok(botCells > 0, '机器人确实在棋盘上落了子（' + botCells + ' 子）');
});

section('3. 机器人不会把局面卡死（真人不走时它也不抢）', () => {
  const h = makeHost(['u1']);
  h.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
  const g = h.g();
  const humanColor = g.players[0] === 'u1' ? 1 : 2;
  // 保证轮到真人
  let guard = 0;
  while (g.turn !== humanColor && guard++ < 20) runHostTimers(h);
  const before = h.g().moves.length;
  runHostTimers(h);        // 轮到真人，跑光定时器
  ok(h.g().moves.length === before, '轮到真人时机器人一步都不下（没替人走棋）');
});

section('4. 第二个真人进来：机器人让位，两个真人正常开局', () => {
  const h = makeHost(['u1']);
  h.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
  ok(PN.bots.botsIn(h).length === 1, '先有机器人在座');
  h.goLobby();
  // 回大厅就收走（机器人属于上一局）；下面再验真人进来时不会被机器人挡座。
  ok(PN.bots.botsIn(h).length === 0, '回大厅机器人被收走（这样大厅里不会杵着假人）');
  // 第二个真人进来
  h.room.peers['u2'] = { id: 'u2', name: '阿泽', emoji: '🙂' };
  h.dispatch({ t: 'hi' }, 'u2');
  ok(PN.bots.botsIn(h).length === 0, '真人进来后机器人被撤走（座位让出来了）');
  h.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
  const g = h.g();
  ok(g.players.length === 2 && g.players.indexOf('bot:1') < 0, '这一局是两个真人，没有机器人');
  ok(PN.bots.botsIn(h).length === 0, '开局也不会再补机器人（人已经够了）');
});

section('5. 没有大脑的游戏：维持原样，不塞假人', () => {
  // 造一个 minPlayers 2 但没 botTurn 的游戏
  PN.games.fake = { id: 'fake', name: '假游戏', minPlayers: 2, maxPlayers: 2, init: (host) => { host.state.mode = 'fake'; host.state.g = {}; host.emit(); } };
  const h = makeHost(['u1']);
  h.dispatch({ t: 'start', mode: 'fake' }, 'u1');
  ok(PN.bots.botsIn(h).length === 0, '没写 botTurn 的游戏不会被塞机器人');
  ok(h.state.mode === 'lobby', '于是仍留在大厅（走原提示路径）');
});

section('6. 边界：对局中途真人掉线/回来，机器人不能被当成替罪羊', () => {
  const h = makeHost(['u1']);
  h.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
  const bot = PN.bots.botsIn(h)[0];
  const g = h.g();
  ok(g.players.indexOf('bot:1') >= 0, '开局时机器人在局中');
  // 真人掉线 → syncOnline 走一遍（花名册里只剩房主自己）
  h.room.roster = () => [{ id: 'u1', online: false }];
  h.syncOnline();
  ok(bot.online === true, '真人掉线不会连带把机器人判离线');
  ok(h.g().players.indexOf('bot:1') >= 0, '机器人仍在局中（对局不被打断）');
});

section('7. 边界：反复开局不会越堆越多机器人', () => {
  const h = makeHost(['u1']);
  // 正确的不变量：机器人是「这一局」的陪练 ——
  //   ① 对局中：恰好 1 个；② 回大厅后：0 个（收走，别在大厅里杵着假人）；
  //   ③ 再开一局：又恰好 1 个（按需重配，不会是 2 个）。
  let perGameMax = 0, lobbyMax = 0;
  for (let i = 0; i < 4; i++) {
    h.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
    perGameMax = Math.max(perGameMax, PN.bots.botsIn(h).length);
    if (h.state.players.length > 2) { h.state.players.length = 2; }   // 只做防爆记录，不掩盖下面断言
    h.goLobby();
    lobbyMax = Math.max(lobbyMax, PN.bots.botsIn(h).length);
  }
  ok(perGameMax === 1, '每局对局中机器人恰好 1 个（实测最多 ' + perGameMax + '）');
  ok(lobbyMax === 0, '回大厅后机器人被收走（实测最多 ' + lobbyMax + '）');
  ok(h.state.players.length === 1, '名单没被机器人撑爆（现在 ' + h.state.players.length + ' 人）');
  h.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
  ok(PN.bots.botsIn(h).length === 1, '再开一局仍是 1 个机器人，没有累积');
  ok(h.state.players.length === 2, '这一局名单是 2 人（' + h.state.players.length + '）');
});

section('8. 边界：机器人不该抢真人的分数/身份', () => {
  const h = makeHost(['u1']);
  h.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
  const bot = PN.bots.botsIn(h)[0];
  ok(bot.host === false, '机器人不是房主');
  ok(h.state.hostId === 'u1', '房主仍是真人');
  ok(bot.score === 0, '机器人初始 0 分');
  // 机器人不能靠 setName 冒充
  h.dispatch({ t: 'setName', name: '房主是我' }, 'bot:1');
  ok(h.state.hostId === 'u1', '机器人发 setName 也抢不走房主身份');
});

section('9. 边界：真人进来时若正处于对局，机器人不动（不破坏牌局）', () => {
  const h = makeHost(['u1']);
  h.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
  const gPlayers = h.g().players.slice();
  h.room.peers['u2'] = { id: 'u2', name: '阿泽', emoji: '🙂' };
  h.dispatch({ t: 'hi' }, 'u2');
  ok(PN.bots.botsIn(h).length === 1, '对局中途来人，机器人仍在（不撤）');
  ok(h.g().players.join(',') === gPlayers.join(','), 'g.players 没被中途插人破坏');
});

/* 这两个小助手只在文件内部用：判断"现在轮到真人了吗" / 替真人落一子。
 * 注意 g.players[0] 执黑、[1] 执白（见 gomoku 的 colorOf）。 */
function humansTurn(host) {
  const g = host.g();
  const botColor = String(g.players[0]).indexOf('bot:') === 0 ? 1 : 2;
  return g.turn !== botColor;
}
function humanMove(host, id) {
  const g = host.g();
  for (let i = 0; i < g.board.length; i++) {
    if (g.board[i] === 0) { host.dispatch({ t: 'place', x: i % g.n, y: Math.floor(i / g.n) }, id); return true; }
  }
  return false;
}

section('10. 刷新/接手：attach() 之后机器人必须继续动（定时器随旧页面死了）', () => {
  // 造一个「轮到机器人」的局面（模拟刷新前那一刻）
  const h1 = makeHost(['u1']);
  h1.dispatch({ t: 'start', mode: 'gomoku' }, 'u1');
  let g = 0;
  while (!humansTurn(h1) && g++ < 30) runHostTimers(h1);
  if (h1.g().phase === 'play' && humansTurn(h1)) humanMove(h1, 'u1');
  const snap = JSON.parse(JSON.stringify(h1.state));
  ok(h1.g().phase !== 'play' || !humansTurn(h1), '前提：快照停在轮到机器人');

  // 新页面（定时器全没了）拿到这份 retained 状态 → 必须走 attach
  const h2 = makeHost(['u1']);
  h2.attach(snap, true);
  ok(!!h2.timers['__bot'], 'attach() 之后立刻重排了机器人定时器');

  // 裸赋值（错误做法）不会排定时器 —— 把这条反例也钉住，防止以后有人改回去
  const h3 = makeHost(['u1']);
  h3.state = JSON.parse(JSON.stringify(snap));
  ok(!h3.timers['__bot'], '裸赋值 host.state 不会排定时器（所以刷新后机器人会僵住 —— 这就是当初的 bug）');

  const before = h2.g().moves.length;
  runHostTimers(h2);
  ok(h2.g().moves.length > before, 'attach 之后机器人真的动了（' + before + '→' + h2.g().moves.length + '）');
});

section('11. attach 不会把 hostId 抢错', () => {
  // 本文件的 makeHost(ids) 没有 hostId 参数，me.id 恒为 ids[0]（= 'u1'）。
  // 所以「认自己为房主」的期望值是 'u1'，不是别的 —— 快照里故意写个 'someone-else' 才验得出来。
  const h = makeHost(['u1', 'u2']);
  const meId = 'u1';
  const mkSnap = () => ({ v: 3, mode: 'lobby', phase: 'lobby', players: [], settings: {}, log: [], g: {}, hostId: 'someone-else', ts: 0 });
  h.attach(mkSnap(), true);
  ok(h.state.hostId === 'someone-else', 'keepHostId=true 时保留快照里的原 hostId（实测 ' + h.state.hostId + '）');
  // attach 会深拷贝，所以每次都要新造一份快照
  h.attach(mkSnap());
  ok(h.state.hostId === meId, '不传 keepHostId 时认自己为房主（实测 ' + h.state.hostId + '，应为 ' + meId + '）');
});

console.log('\n===== 结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
