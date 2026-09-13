// 心有灵犀：房主逻辑回归（零依赖，直接 node 跑）
//   node test/codraw-test.mjs
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
  for (const f of ['src/data.js', 'src/wire.js', 'src/canvas-ink.js', 'src/host.js', 'src/games/codraw.js']) {
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
  const timers = {};
  return {
    state, room: { peers: Object.fromEntries(ids.map(id => [id, { id }])) },
    secretCache: {}, timers, sent: [], events: [],
    g() { return this.state.g; },
    now: () => Date.now(),
    onlinePlayers() { return this.state.players.filter(p => p.online); },
    player(id) { return this.state.players.find(p => p.id === id) || null; },
    amHost(id) { return id === this.state.hostId; },
    toast() {}, event(ev) { this.events.push(ev); }, goLobby() { this.wentLobby = true; }, emit() {},
    addScore(id, n) { const p = this.player(id); if (p) p.score += n; },
    after(n, ms, fn) { timers[n] = fn; }, every() {}, clearTimer(n) { delete timers[n]; },
    sendSecret(pid, obj) { this.sent.push([pid, obj]); this.secretCache[pid] = obj; },
    requestSecret(pid, obj) { this.sent.push([pid, obj]); }, resendSecret() {},
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
const CFG = () => ({ codraw: { rounds: 3, sec: 60 } });
/** 造一笔墨迹（形状和 screens-codraw 发出去的一致） */
const stroke = (id, i0, pts, r) => ({ t: 'stroke', id, i0, r: r || 1, color: '#6b5588', w: 4, s: pts });

/* [1] 开局 + 笔迹不进 state */
section('[1] 开局与隐私', function () {
  const A = loadPage();
  const h = makeHost(A, ['p1', 'p2'], CFG());
  const M = A.PN.games.codraw;
  M.init(h);
  ok(h.g().phase === 'draw' && h.g().prompt, '开局进入作画，题目已下发：' + h.g().prompt);
  ok(h.g().total === 3 && h.g().sec === 60, '题数与作画时间来自设置（3 题 / 60 秒）');
  ok(!!h.timers.codraw_draw, '起了作画倒计时');
  M.onInk(h, stroke('c1r1', 0, [[10, 10], [20, 20]], 1), 'p1');
  const dump = JSON.stringify(h.state.g);
  ok(dump.indexOf('c1r1') < 0, '笔迹不进 state（几千个点塞不下也不该广播）');
  ok(h.sent.length === 0, '作画阶段不自动下发任何人的画布');
});

/* [2] 笔迹按作者分开记：两个人各画各的不会串 */
section('[2] 两块画布分开记', function () {
  const A = loadPage();
  const h = makeHost(A, ['p1', 'p2'], CFG());
  const M = A.PN.games.codraw;
  M.init(h);
  M.onInk(h, stroke('a1r1', 0, [[1, 1], [2, 2]]), 'p1');
  M.onInk(h, stroke('b1r1', 0, [[3, 3], [4, 4]]), 'p2');
  M.onInk(h, stroke('a1r1', 2, [[5, 5]]), 'p1');            // 同一笔的续块
  h.sent.length = 0;
  M.action(h, { t: '_joined' }, 'p1');
  const pay = h.sent.find(e => e[0] === 'p1')[1];
  ok(pay.boards && pay.boards.p1 && pay.boards.p1.length === 2, 'p1 拿到自己那两块（含续块）');
  ok(!pay.boards[ 'p2' ], '作画阶段不给对方的画布（揭晓才给）');
  h.sent.length = 0;
  M.action(h, { t: 'need_replay' }, 'p2');
  const pay2 = h.sent.find(e => e[0] === 'p2')[1];
  ok(pay2.boards && pay2.boards.p2 && !pay2.boards.p1, 'p2 也只拿到自己那块');
});

/* [3] 两人都画好 → 立即揭晓；表态决定是否灵犀 */
section('[3] 交卷与表态', function () {
  const A = loadPage();
  const h = makeHost(A, ['p1', 'p2'], CFG());
  const M = A.PN.games.codraw;
  M.init(h);
  M.action(h, { t: 'ready' }, 'p1');
  ok(h.g().phase === 'draw' && h.g().ready.p1 === true, '一个人交卷还在等对方');
  M.action(h, { t: 'ready' }, 'p2');
  ok(h.g().phase === 'reveal', '两个人都画好 → 立刻揭晓，不用干等倒计时');
  ok(!h.timers.codraw_draw, '揭晓后清掉作画倒计时');
  ok(!!h.timers.codraw_reveal, '起了表态兜底计时器');

  M.action(h, { t: 'rate', v: 1 }, 'p1');
  ok(h.g().phase === 'reveal' && h.g().rated.p1 === 1, '一个人表态后等对方');
  M.action(h, { t: 'rate', v: -1 }, 'p1');
  ok(h.g().rated.p1 === 1, '表态只能一次（不能反悔）');
  M.action(h, { t: 'rate', v: -1 }, 'p2');
  ok(h.g().reveal && h.g().reveal.match === false, '一个说像、一个说不像 → 不算灵犀');
  ok(h.player('p1').score === 0, '不算灵犀就不加分');
  ok(h.g().reveal.list.length === 2 && h.g().reveal.list[1].v === -1, '公布两人的表态（' + JSON.stringify(h.g().reveal.list.map(x => x.v)) + '）');
});

section('[4] 都想到一块 → 加分 + 结算', function () {
  const A = loadPage();
  const h = makeHost(A, ['p1', 'p2'], CFG());
  const M = A.PN.games.codraw;
  M.init(h);
  let guard = 0;
  while (h.g().phase !== 'over' && guard++ < 40) {
    if (h.g().phase === 'draw') { M.action(h, { t: 'ready' }, 'p1'); M.action(h, { t: 'ready' }, 'p2'); }
    else if (h.g().phase === 'reveal') {
      // 顺序很重要：先表态（表态后才有 codraw_next），再触发下一题
      if (!h.g().reveal || !h.g().reveal.list.length) { M.action(h, { t: 'rate', v: 1 }, 'p1'); M.action(h, { t: 'rate', v: 1 }, 'p2'); }
      else if (h.timers.codraw_next) h.timers.codraw_next();
    }
  }
  ok(h.g().phase === 'over', '走完全部题目进入结算（' + guard + ' 步）');
  ok(h.g().summary && h.g().summary.total === 3 && h.g().summary.matched === 3, '3 题全部想到一块：' + JSON.stringify(h.g().summary));
  ok(h.g().summary.percent === 100, '灵犀指数 100%');
  ok(h.player('p1').score === 6 && h.player('p2').score === 6, '两个人各 6 分（3 题 × 2 分，合作）');
  ok(h.events.some(e => e.t === 'gameover'), '发出 gameover 事件');
  ok(!h.timers.codraw_draw && !h.timers.codraw_next, '结算后清掉所有定时器');
});

/* [5] 没人表态的兜底 + 揭晓阶段给两张画布 */
section('[5] 表态兜底与揭晓回放', function () {
  const A = loadPage();
  const h = makeHost(A, ['p1', 'p2'], CFG());
  const M = A.PN.games.codraw;
  M.init(h);
  M.onInk(h, stroke('a1r1', 0, [[1, 1]]), 'p1');
  M.onInk(h, stroke('b1r1', 0, [[2, 2]]), 'p2');
  h.timers.codraw_draw();                       // 作画时间到
  ok(h.g().phase === 'reveal', '倒计时到点自动揭晓（谁没画完也照常）');
  h.sent.length = 0;
  M.action(h, { t: 'need_replay' }, 'p1');
  const pay = h.sent.find(e => e[0] === 'p1')[1];
  ok(pay.boards && pay.boards.p1 && pay.boards.p2, '揭晓阶段两张画布都补（要并排展示）');
  h.timers.codraw_reveal();                     // 谁都没表态 → 兜底
  ok(h.g().phase === 'reveal' && h.g().reveal.list.length === 2, '没人表态也照样公布结果，不会卡住');
  ok(h.g().reveal.list.every(x => x.v === 0), '没表态的人被标成「没表态」');
  ok(h.g().reveal.match === false, '没人表态不算灵犀');
  ok(!!h.timers.codraw_next, '安排进入下一题');
});

/* [6] 换主：作画阶段续上倒计时；揭晓阶段向两端要回放 */
section('[6] 换主恢复', function () {
  {
    const A = loadPage();
    const h = makeHost(A, ['p1', 'p2'], CFG());
    const M = A.PN.games.codraw;
    M.init(h);
    const hB = makeHost(A, ['p1', 'p2'], CFG(), 'p2');
    hB.state.g = JSON.parse(JSON.stringify(h.state.g));
    hB.state.mode = 'codraw';
    M.resume(hB);
    ok(hB.state.g.phase === 'draw' && !!hB.timers.codraw_draw, '作画阶段换主 → 倒计时续上');
  }
  {
    const A = loadPage();
    const h = makeHost(A, ['p1', 'p2'], CFG());
    const M = A.PN.games.codraw;
    M.init(h);
    M.action(h, { t: 'ready' }, 'p1');
    M.action(h, { t: 'ready' }, 'p2');
    const hB = makeHost(A, ['p1', 'p2'], CFG(), 'p2');
    hB.state.g = JSON.parse(JSON.stringify(h.state.g));
    hB.state.mode = 'codraw';
    hB.events.length = 0; hB.sent.length = 0;
    M.resume(hB);
    ok(hB.events.some(e => e.t === 'recover_ink'), '揭晓阶段换主 → 通知各端补报笔迹');
    ok(hB.sent.some(e => e[1] && e[1].recover === true), '并向对方要一次上报（新房主手里没有笔迹）');
    ok(!!hB.timers.codraw_reveal, '续上表态兜底计时器');
  }
});

/* [7] 人数上限 */
section('[7] 人数限制', function () {
  const A = loadPage();
  const h = makeHost(A, ['p1', 'p2', 'p3'], CFG());
  const self = hostLike(A, h.state, {});
  self._lobbyAction({ t: 'start', mode: 'codraw' }, 'p1');
  ok(h.state.mode === 'lobby', '三个人不能开始双人游戏（maxPlayers 拦住）');
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
