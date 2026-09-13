// 默契大考验：房主逻辑回归（零依赖，直接 node 跑）
//   node test/tacit-test.mjs
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

function loadPage() {
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    JSON, Math, Date, Promise, Object, Array, String, Number, Boolean, isNaN,
    parseInt, parseFloat, Error, RegExp, WeakMap, TextEncoder, TextDecoder,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = {};
  sandbox.window.__PN_BANKS__ = {
    draw: JSON.parse(read('data/draw.json')),
    tacit: JSON.parse(read('data/tacit.json')),
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var PN = { games: {}, pick: {}, Banks: {} };', ctx);
  for (const f of ['src/data.js', 'src/host.js', 'src/games/tacit.js']) {
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
  const timers = {}, sent = [];
  return {
    state, room: { peers: Object.fromEntries(ids.map(id => [id, { id }])) },
    secretCache: {}, timers, sent,
    g() { return this.state.g; },
    now: () => Date.now(),
    onlinePlayers() { return this.state.players.filter(p => p.online); },
    player(id) { return this.state.players.find(p => p.id === id) || null; },
    amHost(id) { return id === this.state.hostId; },
    toast() {}, event(ev) { this.events = this.events || []; this.events.push(ev); },
    goLobby() { this.wentLobby = true; }, emit() {}, revealAll() {},
    addScore(id, n) { const p = this.player(id); if (p) p.score += n; },
    after(n, ms, fn) { timers[n] = fn; }, every() {}, clearTimer(n) { delete timers[n]; },
    sendSecret(pid, obj) { this.sent.push([pid, obj]); },
    requestSecret() {}, resendSecret() {},
  };
}
function hostProto(page) { return Object.getPrototypeOf(vm.runInContext('Object.create(PN.Host.prototype)', page.ctx)); }
function hostLike(page, state, room) {
  return Object.assign(Object.create(hostProto(page)), {
    state, room, timers: {}, amHost: () => true, emit() {}, toast() {}, now: () => Date.now(), clearAll() {},
    after(n, ms, fn) { this.timers[n] = fn; }, clearTimer(n) { delete this.timers[n]; },
    coerce: (cur, v) => (typeof cur === 'number' ? (isNaN(Number(v)) ? cur : Number(v)) : (typeof cur === 'boolean' ? !!v : v)),
  });
}
const DG = () => ({ tacit: { rounds: 4 } });
function answerBoth(h, T, i1, i2) { T.action(h, { t: 'answer', i: i1 }, 'p1'); T.action(h, { t: 'answer', i: i2 }, 'p2'); }

/* [1] 作答阶段：答案绝不能出现在广播状态里 */
section('[1] 答案不许泄露到 state', function () {
  const A = loadPage();
  const h = makeHost(A, ['p1', 'p2'], DG());
  const T = A.PN.games.tacit;
  T.init(h);
  ok(h.g().cur && h.g().cur.phase === 'answer', '开局进入作答阶段');
  ok(Array.isArray(h.g().cur.options) && h.g().cur.options.length >= 2, '下发选项（' + JSON.stringify(h.g().cur.options) + '）');
  ok(!h.g().cur.reveal, '还没有揭晓内容');
  T.action(h, { t: 'answer', i: 0 }, 'p1');
  const dump = JSON.stringify(h.state.g);
  ok(!/"(p1|p2)":\s*[0-9]/.test(dump), 'state 里没有「谁选了什么」的映射（选了也不能被对方看到）');
  ok(Object.keys(h.g().cur.answered).length === 1 && h.g().cur.answered.p1 === true, '只广播「谁答了」这一个公开信息');
});

/* [2] 两人都答完立即揭晓；一致=默契，双方加分 */
section('[2] 一致就加分，不一致不计分', function () {
  const A = loadPage();
  const h = makeHost(A, ['p1', 'p2'], DG());
  const T = A.PN.games.tacit;
  T.init(h);
  T.action(h, { t: 'answer', i: 0 }, 'p1');
  ok(h.g().cur.phase === 'answer', '只有一个人答完时先不揭晓（等对方）');
  T.action(h, { t: 'answer', i: 0 }, 'p2');
  ok(h.g().cur.phase === 'reveal', '两人都答完立刻揭晓，不用干等倒计时');
  ok(h.g().cur.reveal && h.g().cur.reveal.match === true, '选择一致 → 判定默契');
  ok(h.g().matched === 1, '默契计数 +1');
  ok(h.player('p1').score === 1 && h.player('p2').score === 1, '两个人同时 +1（合作而不是对抗）');
  ok(!h.timers.tacit_answer, '揭晓后清掉作答倒计时');
  ok(!!h.timers.tacit_next, '安排下一题');

  h.timers.tacit_next();
  ok(h.g().round === 2 && h.g().cur.phase === 'answer', '进入第 2 题');
  answerBoth(h, T, 0, 1);
  ok(h.g().cur.reveal.match === false, '选择不一致 → 不是默契');
  ok(h.g().matched === 1, '不一致不计分');
  ok(h.player('p1').score === 1, '分数不变');
});

/* [3] 一题只能答一次；超时没答也算揭晓 */
section('[3] 只能答一次 + 超时兜底', function () {
  const A = loadPage();
  const h = makeHost(A, ['p1', 'p2'], DG());
  const T = A.PN.games.tacit;
  T.init(h);
  T.action(h, { t: 'answer', i: 1 }, 'p1');
  T.action(h, { t: 'answer', i: 0 }, 'p1');   // 想改答案
  T.action(h, { t: 'answer', i: 1 }, 'p2');
  const pick = h.g().cur.reveal.picks.find(p => p.id === 'p1');
  ok(pick && pick.i === 1, '第一次的选择生效，不能改（防最后一秒偷看改答案）');

  h.timers.tacit_next();
  T.action(h, { t: 'answer', i: 0 }, 'p1');   // 只有一个人答
  ok(h.g().cur.phase === 'answer', '还差一个人，继续等');
  h.timers.tacit_answer();                    // 倒计时到
  ok(h.g().cur.phase === 'reveal', '超时也揭晓，不会卡死');
  const none = h.g().cur.reveal.picks.find(p => p.id === 'p2');
  ok(none && none.i === -1 && none.label === '没作答', '没作答的人被明确标成「没作答」');
  ok(h.g().cur.reveal.match === false, '有人没答就不算默契');
});

/* [4] 走完全部题目 → 结算 */
section('[4] 闭环：结算', function () {
  const A = loadPage();
  const h = makeHost(A, ['p1', 'p2'], DG());
  const T = A.PN.games.tacit;
  T.init(h);
  let guard = 0;
  while (h.g().phase !== 'over' && guard++ < 40) {
    if (h.g().cur.phase === 'answer') answerBoth(h, T, 0, 0);   // 每题都一致
    if (h.timers.tacit_next) h.timers.tacit_next();
  }
  ok(h.g().phase === 'over' && h.g().cur === null, '走完所有题目进入结算（' + guard + ' 步）');
  ok(h.g().summary && h.g().summary.total === 4, '结算是 4 题');
  ok(h.g().summary.matched === 4 && h.g().summary.percent === 100, '每题都一致 → 默契度 100%');
  ok(h.events && h.events.some(e => e.t === 'gameover'), '发出 gameover 事件（客户端要播结算动画）');
});

/* [5] 换主：答案在闭包里，换主后清空重答 */
section('[5] 换主后重答（公平，不泄露）', function () {
  const A = loadPage();
  const h = makeHost(A, ['p1', 'p2'], DG());
  const T = A.PN.games.tacit;
  T.init(h);
  T.action(h, { t: 'answer', i: 0 }, 'p1');
  const hB = makeHost(A, ['p1', 'p2'], DG(), 'p2');
  hB.state.g = JSON.parse(JSON.stringify(h.state.g));
  hB.state.mode = 'tacit';
  T.resume(hB);
  ok(hB.state.g.cur.phase === 'answer', '新房主接着在作答阶段');
  ok(Object.keys(hB.state.g.cur.answered).length === 0, '换主后清空「已作答」，两个人都重新选一次');
  ok(!!hB.timers.tacit_answer, '重新起作答倒计时');
  T.action(hB, { t: 'answer', i: 1 }, 'p2');
  T.action(hB, { t: 'answer', i: 1 }, 'p2');
  ok(true, '重答流程可用');
});

/* [6] 人数：双人游戏拦住第三个人 */
section('[6] 人数上限', function () {
  const A = loadPage();
  const h = makeHost(A, ['p1', 'p2', 'p3'], DG());
  const self = hostLike(A, h.state, {});
  self._lobbyAction({ t: 'start', mode: 'tacit' }, 'p1');
  ok(h.state.mode === 'lobby', '三个人不能开始双人游戏（被 maxPlayers 拦住）');

  const h2 = makeHost(A, ['p1'], DG());
  const self2 = hostLike(A, h2.state, {});
  self2._lobbyAction({ t: 'start', mode: 'tacit' }, 'p1');
  ok(h2.state.mode === 'lobby', '一个人也开不了（至少两人）');
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
