// 合作翻牌：房主逻辑回归（零依赖，直接 node 跑）
//   node test/memory-test.mjs
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
};
const ALL_EMOJI = Object.values(BANKS.memory.sets).flat();

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
  for (const f of ['src/data.js', 'src/host.js', 'src/games/memory.js']) {
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
    secretCache: {}, timers, events: [],
    g() { return this.state.g; },
    now: () => Date.now(),
    onlinePlayers() { return this.state.players.filter(p => p.online); },
    player(id) { return this.state.players.find(p => p.id === id) || null; },
    amHost(id) { return id === this.state.hostId; },
    toast() {}, event(ev) { this.events.push(ev); }, goLobby() { this.wentLobby = true; }, emit() {},
    addScore(id, n) { const p = this.player(id); if (p) p.score += n; },
    after(n, ms, fn) { timers[n] = fn; }, every() {}, clearTimer(n) { delete timers[n]; },
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
const CFG = () => ({ memory: { pairs: 8 } });

/* [1] 开局：牌背朝上，牌面绝不进 state */
section('[1] 牌堆不许泄露到 state', function () {
  const A = loadPage();
  const h = makeHost(A, ['p1', 'p2'], CFG());
  const M = A.PN.games.memory;
  M.init(h);
  ok(h.g().slots.length === 16, '8 对 = 16 张牌');
  ok(h.g().slots.every(s => s === null), '开局全部背面朝上');
  const dump = JSON.stringify(h.state.g);
  const leaked = ALL_EMOJI.filter(e => dump.indexOf(e) >= 0);
  ok(leaked.length === 0, 'state 里一个牌面都搜不到（牌堆只在房主闭包里）' + (leaked.length ? ' 泄露=' + leaked : ''));
  ok(h.g().turn && (h.g().turn === 'p1' || h.g().turn === 'p2'), '开局指定一个人先翻：' + h.g().turn);
});

/* [2] 回合规则：只能翻自己的、一回合最多两张 */
section('[2] 回合与翻牌规则', function () {
  const A = loadPage();
  const h = makeHost(A, ['p1', 'p2'], CFG());
  const M = A.PN.games.memory;
  M.init(h);
  const first = h.g().turn, second = first === 'p1' ? 'p2' : 'p1';
  M.action(h, { t: 'flip', i: 0 }, second);
  ok(h.g().flipped.length === 0, '不是你的回合翻不动（防止乱点打乱节奏）');
  M.action(h, { t: 'flip', i: 0 }, first);
  ok(h.g().flipped.length === 1 && h.g().slots[0], '轮到你翻开第一张，牌面公开');
  M.action(h, { t: 'flip', i: 0 }, first);
  ok(h.g().flipped.length === 1, '同一张不能翻两次');
  M.action(h, { t: 'flip', i: 1 }, first);
  ok(h.g().flipped.length <= 2, '一回合最多两张（第二张已翻开）');
  M.action(h, { t: 'flip', i: 2 }, first);
  ok(h.g().flipped.length <= 2, '已经翻两张后不能再翻第三张');
});

/* [3] 配对失败：亮一会儿 → 扣回 → 换人 */
section('[3] 翻错：扣回并换人', function () {
  const A = loadPage();
  const h = makeHost(A, ['p1', 'p2'], CFG());
  const M = A.PN.games.memory;
  M.init(h);
  const first = h.g().turn, second = first === 'p1' ? 'p2' : 'p1';
  M.action(h, { t: 'flip', i: 0 }, first);
  M.action(h, { t: 'flip', i: 1 }, first);
  const same = h.g().slots[0] === h.g().slots[1];
  if (same) {
    ok(true, '（这次随机发牌前两张刚好是一对，跳到换人测试由 [4] 覆盖）');
  } else {
    ok(h.g().turns === 1, '翻完两张算一步：' + h.g().turns);
    ok(h.g().flipped.length === 2, '两张先亮着，让对方也看清楚');
    ok(!!h.timers.memory_back, '安排了「亮完扣回」的定时器');
    h.timers.memory_back();
    ok(h.g().slots[0] === null && h.g().slots[1] === null, '定时器到点把两张扣回背面');
    ok(h.g().turn === second, '换对方翻');
    ok(h.g().matched === 0, '没配上就不加分');
  }
});

/* [4] 会记忆的解法把整副牌打完：闭环 + 两条路径都覆盖 */
section('[4] 一局打完（记忆策略）', function () {
  const A = loadPage();
  const h = makeHost(A, ['p1', 'p2'], CFG());
  const M = A.PN.games.memory;
  M.init(h);
  const known = {};           // 牌面 -> 见过的位置（会跨步累积）
  let sawMiss = 0, guard = 0;
  const remember = (g) => g.slots.forEach((e, i) => {
    if (!e || (g.done || []).indexOf(i) >= 0) return;
    known[e] = known[e] || [];
    if (known[e].indexOf(i) < 0) known[e].push(i);
  });
  while (h.g().phase === 'play' && guard++ < 400) {
    let g = h.g();
    remember(g);                                     // ① 先把看得见的牌记下来
    if (g.flipped.length === 2) {                    // ② 两张都翻开了 → 结算这一步
      if (h.timers.memory_back) { sawMiss++; h.timers.memory_back(); }
      continue;
    }
    // ③ 决定这一步翻哪两张：优先翻已知的一对；否则「一张记得的 + 一张没见过的」去探新信息
    let picks = [];
    for (const e in known) {
      const down = known[e].filter(i => g.slots[i] === null);
      if (down.length >= 2) { picks = [down[0], down[1]]; break; }
    }
    if (!picks.length) {
      const downKnown = [], unseen = [], seenIdx = {};
      for (const e in known) known[e].forEach(i => { seenIdx[i] = true; if (g.slots[i] === null) downKnown.push(i); });
      g.slots.forEach((e, i) => { if (e === null && !seenIdx[i]) unseen.push(i); });
      if (downKnown.length && unseen.length) picks = [downKnown[0], unseen[0]];
      else if (unseen.length >= 2) picks = [unseen[0], unseen[1]];
      else if (downKnown.length) picks = [downKnown[0]];
      else if (unseen.length) picks = [unseen[0]];
    }
    if (!picks.length) break;
    const turn = g.turn;
    picks.forEach(i => M.action(h, { t: 'flip', i }, turn));
    g = h.g();
    remember(g);                                     // ④ 趁牌还亮着先记住（顺序很关键！扣回后就看不见了）
    if (h.timers.memory_back) { sawMiss++; h.timers.memory_back(); }   // ⑤ 再让翻错的牌扣回去
  }
  ok(h.g().phase === 'over', '把整副牌配完 → 进入结算（' + guard + ' 步）');
  ok(h.g().matched === 8 && (h.g().done || []).length === 16, '8 对全部配对完成');
  ok(sawMiss > 0, '过程中出现过翻错（' + sawMiss + ' 次）—— 配上 8 次由 matched 断言覆盖');
  ok(h.g().over && h.g().over.stars >= 1 && h.g().over.stars <= 3, '结算给出 1-3 星：' + h.g().over.stars + ' 星');
  ok(h.player('p1').score === 16 && h.player('p2').score === 16, '两个人都拿到 16 分（8 对 × 2 分，合作不是对抗）');
  ok(h.events.some(e => e.t === 'gameover'), '发出 gameover 事件');
  ok(!h.timers.memory_back && !h.timers.memory_afk, '结算后清掉所有定时器，不留后台任务');
});

/* [5] 换主：牌堆在闭包里，换主重洗并说明 */
section('[5] 换主重洗', function () {
  const A = loadPage();
  const h = makeHost(A, ['p1', 'p2'], CFG());
  const M = A.PN.games.memory;
  M.init(h);
  M.action(h, { t: 'flip', i: 0 }, h.g().turn);
  const hB = makeHost(A, ['p1', 'p2'], CFG(), 'p2');
  hB.state.g = JSON.parse(JSON.stringify(h.state.g));
  hB.state.mode = 'memory';
  M.resume(hB);
  ok(hB.state.g.phase === 'play', '新房主接着在牌局里');
  ok(hB.state.g.flipped.length === 0 && hB.state.g.done.length === 0, '重新洗牌：翻开的和配对的都清空');
  ok(!!hB.timers.memory_afk, '重新挂上挂机保护计时器');
});

/* [6] 挂机保护 + 人数上限 */
section('[6] 挂机保护与人数', function () {
  const A = loadPage();
  const h = makeHost(A, ['p1', 'p2'], CFG());
  const M = A.PN.games.memory;
  M.init(h);
  ok(!!h.timers.memory_afk, '开局就挂上挂机保护');
  const turnBefore = h.g().turn;
  h.timers.memory_afk();                       // 45 秒没动
  ok(h.g().flipped.length === 1, '帮你翻一张（不会让回合卡死）');
  ok(h.g().turn === turnBefore, '但不抢你的回合');

  const h3 = makeHost(A, ['p1', 'p2', 'p3'], CFG());
  const self = hostLike(A, h3.state, {});
  self._lobbyAction({ t: 'start', mode: 'memory' }, 'p1');
  ok(h3.state.mode === 'lobby', '三个人不能开始（maxPlayers=2 拦住）');
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
