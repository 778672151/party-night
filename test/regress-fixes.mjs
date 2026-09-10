// 回归：这一轮审查发现并修掉的缺陷（零依赖，直接 node 跑）
// 每条都对应一个真实线上缺陷，把 src 改回旧代码就会挂。
//   node test/regress-fixes.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
/** 每节独立跑：旧代码缺函数/抛异常时也如实记成失败，而不是让整个套件崩掉 */
function section(name, fn) {
  console.log('\n' + name);
  try { fn(); } catch (e) { fail++; console.log('  ✗ 抛异常: ' + (e && e.message)); }
}

/** 每个「页面」一个独立 vm 上下文：闭包互不相通，和真实的多浏览器一致 */
function loadPage() {
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    JSON, Math, Date, Promise, Object, Array, String, Number, Boolean, isNaN,
    parseInt, parseFloat, Error, RegExp, WeakMap, TextEncoder, TextDecoder,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = {};
  sandbox.window.__PN_BANKS__ = {
    undercover: JSON.parse(read('data/undercover.json')),
    wavelength: JSON.parse(read('data/wavelength.json')),
    mostlikely: JSON.parse(read('data/mostlikely.json')),
    draw: JSON.parse(read('data/draw.json')),
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var PN = { games: {}, pick: {}, Banks: {} };', ctx);
  for (const f of ['src/data.js', 'src/host.js', 'src/games/undercover.js', 'src/games/wavelength.js', 'src/games/drawgame.js', 'src/games/mostlikely.js']) {
    vm.runInContext(read(f), ctx, { filename: ROOT + f });
  }
  return { PN: vm.runInContext('PN', ctx), ctx };
}

/** 假房主：接口与真实 Host 一致（sendSecret 一定会写缓存，这点很关键） */
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
    toast() {}, event() {}, goLobby() {}, emit() {}, revealAll() {},
    addScore(id, n) { const p = this.player(id); if (p) p.score += n; },
    after(n, ms, fn) { timers[n] = fn; }, every() {}, clearTimer(n) { delete timers[n]; },
    sendSecret(pid, obj) { this.sent.push([pid, obj]); this.secretCache[pid] = Object.assign({}, this.secretCache[pid], obj); },
    requestSecret(pid, obj) { this.sent.push([pid, obj]); },
    resendSecret(pid) { if (this.secretCache[pid]) this.sent.push([pid, this.secretCache[pid]]); },
  };
}

/** 拿到真实 Host.prototype（用来单测 _lobbyAction / markOffline 这些宿主方法） */
function hostProto(page) { return Object.getPrototypeOf(vm.runInContext('Object.create(PN.Host.prototype)', page.ctx)); }
function hostLike(page, state, room) {
  return Object.assign(Object.create(hostProto(page)), {
    state, room, timers: {}, amHost: () => true, emit() {}, toast() {}, now: () => Date.now(), clearAll() {},
    after(n, ms, fn) { this.timers[n] = fn; }, clearTimer(n) { delete this.timers[n]; },
    coerce: (cur, v) => (typeof cur === 'number' ? (isNaN(Number(v)) ? cur : Number(v)) : (typeof cur === 'boolean' ? !!v : v)),
  });
}

const IDS4 = ['p1', 'p2', 'p3', 'p4'];
const IDS3 = ['p1', 'p2', 'p3'];
const UC = () => ({ undercover: { numUnder: 1, blank: false, textMode: true, roundSec: 180 } });

/* ============ 1. 题目答案绝不能出现在广播 state.g 里（作弊级泄露） ============ */
section('[1] state.g 不许夹带答案', function () {
  {
    const A = loadPage();
    const h = makeHost(A, IDS4, UC());
    const M = A.PN.games.undercover;
    M.init(h); M.action(h, { t: 'start' }, 'p1');
    const words = Object.values(h.secretCache).map(s => s.word).filter(Boolean);
    const g = JSON.stringify(h.state.g);
    ok(words.length > 0, '牌已私下发出去（词 = ' + JSON.stringify([...new Set(words)]) + '）');
    ok(!words.some(w => g.includes(w)), '卧底词对没有出现在 state.g（旧版在 g.used 里明文广播）');
  }
  {
    const A = loadPage();
    const h = makeHost(A, IDS3, { drawgame: { rounds: 3, drawSec: 90 } });
    A.PN.games.drawgame.init(h);
    const painter = h.g().cur.painter;
    const words = h.secretCache[painter].words || [];
    const g = JSON.stringify(h.state.g);
    ok(words.length === 3, '画家拿到 3 个候选词');
    ok(!words.some(w => g.includes(w)), '候选词没有出现在 state.g（旧版在 g.used 里明文广播）');
  }
});

/* ============ 2. 大厅设置必须写进 settings[模式]，并且真的被游戏读到 ============ */
section('[2] 大厅设置真的生效', function () {
  const A = loadPage();
  const h = makeHost(A, IDS4, {
    undercover: { numUnder: 1, blank: false, textMode: true, roundSec: 180 },
    wavelength: { rounds: 6 }, mostlikely: { rounds: 8, eachSec: 30 }, drawgame: { rounds: 6, drawSec: 90 },
  });
  const self = hostLike(A, h.state, h.room);
  self._lobbyAction({ t: 'settings', mode: 'undercover', values: { numUnder: 2, blank: true, textMode: false, roundSec: 90 } }, 'p1');
  ok(h.state.settings.undercover.blank === true && h.state.settings.undercover.numUnder === 2,
    '设置写进了 settings.undercover（旧版写成顶层 settings.blank，游戏永远读不到）');
  ok(!h.state.settings.blank, '没有污染顶层 settings');

  const M = A.PN.games.undercover;
  M.init(h); M.action(h, { t: 'start' }, 'p1');
  ok(h.g().numUnder === 2 && h.g().blank === true && h.g().textMode === false, '开局后 numUnder/blank/textMode 全部来自设置');
  const sec = Math.round((h.g().deadline - Date.now()) / 1000);
  ok(sec >= 89 && sec <= 91, '每轮时长按 90 秒设置生效（实测 ' + sec + '）');
});

/* ============ 3. 房主迁移：三个游戏都不能断链 ============ */
section('[3] 房主迁移（刷新/掉线换主）', function () {
  {
    const A = loadPage();
    const hA = makeHost(A, IDS4, UC());
    const M = A.PN.games.undercover;
    M.init(hA); M.action(hA, { t: 'start' }, 'p1');
    for (const id of hA.g().alive.slice()) M.action(hA, { t: 'desc', text: 'x' }, id);
    const roles = {}; for (const id of IDS4) roles[id] = hA.secretCache[id].role;

    const B = loadPage();
    const hB = makeHost(B, IDS4, JSON.parse(JSON.stringify(hA.state.settings)), 'p2');
    hB.state = JSON.parse(JSON.stringify(hA.state));
    hB.state.hostId = 'p2';
    B.PN.games.undercover.resume(hB);
    ok(hB.sent.some(x => x[1] && x[1].recover), '新房主向玩家索要上报');
    ok(Object.keys(hB.secretCache).length === 0, '索要动作没有污染 secretCache（旧版会把缓存写成 {recover:true}，玩家上报全被 if (!cache) 挡掉）');

    for (const id of IDS4) B.PN.games.undercover.action(hB, { t: 'recover', word: hA.secretCache[id].word, role: roles[id] }, id);
    const civil = IDS4.find(id => roles[id] !== 'under');
    const other = IDS4.find(id => id !== civil);
    for (const id of hB.g().alive.slice()) B.PN.games.undercover.action(hB, { t: 'vote', id: id === civil ? other : civil }, id);
    ok(hB.g().phase === 'describe', '迁移后投票能结算，且淘汰平民后继续下一轮（旧版 checkWin 里 p.under 为 undefined 直接 TypeError 卡死）');
  }
  {
    const A = loadPage();
    const hA = makeHost(A, IDS3, { drawgame: { rounds: 3, drawSec: 90 } });
    const D = A.PN.games.drawgame;
    D.init(hA);
    const painter = hA.g().cur.painter;
    D.action(hA, { t: 'pick', i: 0 }, painter);
    const answer = hA.secretCache[painter].answer;

    const B = loadPage();
    const hB = makeHost(B, IDS3, JSON.parse(JSON.stringify(hA.state.settings)), 'p2');
    hB.state = JSON.parse(JSON.stringify(hA.state));
    hB.state.hostId = 'p2';
    B.PN.games.drawgame.resume(hB);
    ok(hB.sent.some(x => x[1] && x[1].recover), '新房主向画家索要答案');
    B.PN.games.drawgame.action(hB, { t: 'repaint', answer: answer, words: hA.secretCache[painter].words }, painter);
    const guesser = IDS3.find(id => id !== painter);
    B.PN.games.drawgame.action(hB, { t: 'guess', text: answer }, guesser);
    ok(!!(hB.g().cur.guessed && hB.g().cur.guessed[guesser]), '迁移后猜中依然算数（旧版答案丢失，整回合只能空转到超时）');
  }
  {
    const A = loadPage();
    const hA = makeHost(A, IDS3, { wavelength: { rounds: 4 } });
    const W = A.PN.games.wavelength;
    W.init(hA);
    const psychic = hA.g().cur;
    const target = hA.secretCache[psychic].target;

    const B = loadPage();
    const hB = makeHost(B, IDS3, JSON.parse(JSON.stringify(hA.state.settings)), 'p2');
    hB.state = JSON.parse(JSON.stringify(hA.state));
    hB.state.hostId = 'p2';
    B.PN.games.wavelength.resume(hB);
    B.PN.games.wavelength.action(hB, { t: 'reportTarget', target: target }, psychic);
    ok(hB.secretCache[psychic] && hB.secretCache[psychic].target === target,
      '靶心由通灵者原样报回，不会被重新随机（旧版每次迁移都换数，线索和猜测全对不上）');
  }
});

/* ============ 4. 掉线：只标离线、保住积分，且不拖住全桌 ============ */
section('[4] 掉线处理', function () {
  {
    const A = loadPage();
    const h = makeHost(A, IDS4, UC());
    const self = hostLike(A, h.state, h.room);
    self.state.players[1].score = 9;
    self.markOffline('p2');
    ok(self.player('p2') !== null && self.player('p2').score === 9, '掉线的人留在名单里、积分保留（旧版被 filter 删掉，回来变 0 分）');
    ok(self.player('p2').online === false, '掉线的人标记为离线');
    ok(!!self.timers['drop_p2'], '给宽限期而不是当场踢出对局（刷新回来还能接着玩）');
    self.upsertPlayer('p2');
    ok(self.player('p2').online === true && !self.timers['drop_p2'], '人回来后取消移出、重新在线');
  }
  {
    const A = loadPage();
    const h = makeHost(A, IDS4, UC());
    const M = A.PN.games.undercover;
    M.init(h); M.action(h, { t: 'start' }, 'p1');
    for (const id of h.g().alive.slice()) M.action(h, { t: 'desc', text: 'x' }, id);
    h.state.players.find(p => p.id === 'p4').online = false;
    for (const id of h.g().alive.slice().filter(x => x !== 'p4')) {
      M.action(h, { t: 'vote', id: id === 'p1' ? 'p2' : 'p1' }, id);
    }
    ok(h.g().phase !== 'vote', '缺一个掉线的人也能结算投票（旧版要干等到遗嘱超时）');
  }
});

/* ============ 5. 谁是卧底：全员挂机不能无限循环 ============ */
section('[5] 挂机兜底', function () {
  const A = loadPage();
  const h = makeHost(A, IDS4, UC());
  const M = A.PN.games.undercover;
  M.init(h); M.action(h, { t: 'start' }, 'p1');
  let guard = 0;
  while (h.g().phase !== 'over' && guard++ < 500) {
    if (h.g().phase === 'describe') h.timers.describe && h.timers.describe();
    else if (h.g().phase === 'vote') h.timers.vote && h.timers.vote();
    else break;
  }
  ok(h.g().phase === 'over', '全员挂机会在第 12 轮兜底结束（旧版 round 无限涨，永远打不完）');
  ok(h.g().round === 12, '结束时的轮数 = 12（实测 ' + h.g().round + '）');
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
