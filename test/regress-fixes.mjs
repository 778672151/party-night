// 回归：核心缺陷的护栏（零依赖，直接 node 跑）
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
  sandbox.window.__PN_BANKS__ = { draw: JSON.parse(read('data/draw.json')) };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var PN = { games: {}, pick: {}, Banks: {} };', ctx);
  for (const f of ['src/data.js', 'src/host.js', 'src/games/drawgame.js']) {
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
const DG = () => ({ drawgame: { rounds: 6, drawSec: 90, roundsPerSet: 3 } });
/** 开局到作画，返回 {h, M, painter, words, answer} */
function startDrawing(page, settings) {
  const h = makeHost(page, IDS4, settings || DG());
  const M = page.PN.games.drawgame;
  M.init(h);
  const painter = h.g().cur.painter;
  const words = h.sent.find(s => s[1] && s[1].words)[1].words;
  M.action(h, { t: 'pick', i: 0 }, painter);
  return { h, M, painter, words, answer: words[0] };
}

/* ============ 1. 题目答案绝不能出现在广播 state.g 里（作弊级泄露） ============ */
section('[1] state.g 不许夹带答案', function () {
  const A = loadPage();
  const s = startDrawing(A);
  const dump = JSON.stringify(s.h.state.g);
  ok(s.words && s.words.length === 3, '候选词只走私密通道发给画家（state 里没有）');
  ok(dump.indexOf(s.answer) < 0, '作画阶段 state.g 里搜不到答案「' + s.answer + '」');
  ok(dump.indexOf(s.words[1]) < 0 && dump.indexOf(s.words[2]) < 0,
    '另外两个候选词也没混进 state.g（旧版 g.used 会把 3 个候选词广播给所有人）');
  ok(s.h.state.g.cur.wordLen === s.answer.length, '只广播字数 wordLen=' + s.answer.length);
  ok(s.h.state.g.cur.phase === 'draw', '进入作画阶段');
});

/* ============ 2. 大厅设置必须真的写进 settings.<mode> 并被玩法读到 ============ */
section('[2] 设置真的生效', function () {
  {
    const A = loadPage();
    const h = makeHost(A, IDS4, DG());
    const self = hostLike(A, h.state, h.room);
    self._lobbyAction({ t: 'settings', mode: 'drawgame', values: { drawSec: 60, rounds: 3 } }, 'p1');
    ok(h.state.settings.drawgame.drawSec === 60 && h.state.settings.drawgame.rounds === 3,
      '设置写进 settings.drawgame（旧版写成顶层 settings[k]，游戏永远读不到）');
  }
  {
    const A = loadPage();
    const h = makeHost(A, IDS4, { drawgame: { rounds: 6, drawSec: 45, roundsPerSet: 3 } });
    const M = A.PN.games.drawgame;
    M.init(h);
    M.action(h, { t: 'pick', i: 0 }, h.g().cur.painter);
    const left = h.g().cur.deadline - h.now();
    ok(Math.abs(left - 45000) < 2000, '作画倒计时用的是设置里的 45s（实测 ' + Math.round(left / 1000) + 's）');
  }
});

/* ============ 3. 房主掉线换主：闭包全丢，答案靠画家回报恢复 ============ */
section('[3] 房主迁移', function () {
  const A = loadPage();
  const s = startDrawing(A);
  // 新房主只继承 retained state（模块闭包、rd.answer 全都不在）
  const hB = makeHost(A, IDS4, DG(), 'p2');
  hB.state.g = JSON.parse(JSON.stringify(s.h.state.g));
  s.M.resume(hB);
  ok(hB.state.g.cur.phase === 'draw', '新房主接着在作画阶段（状态是 retained 的，不中断对局）');
  s.M.action(hB, { t: 'repaint', answer: s.answer, words: s.words }, s.painter);
  if (hB.timers.drawgame_draw) hB.timers.drawgame_draw();      // 直接触发揭晓
  ok(hB.state.g.cur.reveal === s.answer,
    '换主后答案被画家回报恢复，揭晓 = ' + JSON.stringify(hB.state.g.cur.reveal) + '（旧版丢掉答案，揭晓变成「???」）');
});

/* ============ 4. 掉线：只标离线、保住积分，不拖住全桌 ============ */
section('[4] 掉线处理', function () {
  const A = loadPage();
  const h = makeHost(A, IDS4, DG());
  const self = hostLike(A, h.state, h.room);
  self.state.players[1].score = 9;
  self.markOffline('p2');
  ok(self.player('p2') !== null && self.player('p2').score === 9,
    '掉线的人留在名单里、积分保留（旧版被 filter 删掉，回来变 0 分）');
  ok(self.player('p2').online === false, '掉线的人标记为离线');
  ok(!!self.timers['drop_p2'], '给宽限期而不是当场踢出对局（刷新回来还能接着玩）');
  self.upsertPlayer('p2');
  ok(self.player('p2').online === true && !self.timers['drop_p2'], '人回来后取消移出、重新在线');
});

/* ============ 5. 挂机兜底：画家一直不选词也不能卡死 ============ */
section('[5] 挂机兜底', function () {
  const A = loadPage();
  const h = makeHost(A, IDS4, DG());
  const M = A.PN.games.drawgame;
  M.init(h);
  const painter = h.g().cur.painter;
  ok(h.g().cur.phase === 'pick', '开局停在选词阶段');
  ok(!!h.timers.drawgame_pick, '有 30 秒选词兜底计时器');
  h.timers.drawgame_pick();                     // 画家一直不选
  ok(h.g().cur.phase === 'draw', '超时自动选词并进入作画，不会无限等画家');
  ok(h.g().cur.painter === painter, '还是同一位画家，没有把人换掉');
  ok(!!h.state.g.cur.deadline, '自动选词后倒计时正常起算');
});

/* ============ 6. 刷新/丢包后「整段回放」能自愈 ============
 * 墨迹通道补得了「笔画里的洞」，补不了「整段都没收到」——刷新时那次私密消息
 * 只要丢一次，玩家就会永远看着白板。这条钉住 self-heal。 */
section('[6] 整段回放自愈（need_replay）', function () {
  {
    const A = loadPage();
    const s = startDrawing(A);
    const h = s.h, M = s.M;
    const guesser = IDS4.filter(id => id !== s.painter)[0];
    // 真实墨迹消息的形状（见 screens-drawgame 的 sendInk）：s 是这一块的点，i0 是它在整笔里的起点
    M.onInk(h, { t: 'stroke', id: 'pX1', r: h.g().round, color: '#333', w: 3, i0: 0, s: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }, s.painter);

    h.sent.length = 0;
    M.action(h, { t: 'need_replay' }, guesser);
    const got = h.sent.find(e => e[0] === guesser && e[1] && e[1].replay);
    ok(!!got, '猜词者手里整段没有时主动要 → 房主补发当前回合的回放');
    ok(got && got[1].replay.length === 1 && got[1].replay[0].id === 'pX1',
      '补发的就是那一笔（' + (got && got[1].replay ? got[1].replay.length : 0) + ' 条）');
    ok(!(got && got[1].answer), '猜词者仍然拿不到答案（只给画家）');

    h.sent.length = 0;
    M.action(h, { t: 'need_replay' }, s.painter);
    const gp = h.sent.find(e => e[0] === s.painter);
    ok(gp && gp[1] && gp[1].answer === s.answer, '画家来要 → 连自己的词一起补（刷新后也不会看不到词）');
  }
  {
    // 房主手里也没有（比如它自己也是刚接管）→ 应当去请画家补报，而不是干等着
    const A = loadPage();
    const s = startDrawing(A);
    const guesser = IDS4.filter(id => id !== s.painter)[0];
    s.h.sent.length = 0;
    s.M.action(s.h, { t: 'need_replay' }, guesser);
    const req = s.h.sent.find(e => e[0] === s.painter);
    ok(req && req[1] && req[1].recover === true, '房主手里没有回放 → 请画家补报一次（recover 请求）');
  }
  {
    const A = loadPage();
    const s = startDrawing(A);
    s.h.g().cur.phase = 'reveal';
    s.h.sent.length = 0;
    s.M.action(s.h, { t: 'need_replay' }, IDS4.filter(i => i !== s.painter)[0]);
    ok(s.h.sent.length === 0, '不在作画阶段不响应（避免乱补）');
  }
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
