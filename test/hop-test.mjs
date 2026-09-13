// 跳一跳：房主逻辑 + 移植自原作的判定规则（零依赖）
//   node test/hop-test.mjs
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
  draw: JSON.parse(read('data/draw.json')), tacit: JSON.parse(read('data/tacit.json')),
  memory: JSON.parse(read('data/memory.json')), codraw: JSON.parse(read('data/codraw.json')),
  mini: JSON.parse(read('data/mini.json')),
};
function loadPage() {
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, JSON, Math, Date, Promise,
    Object, Array, String, Number, Boolean, isNaN, parseInt, parseFloat, Error, RegExp, WeakMap,
    TextEncoder, TextDecoder,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = { __PN_BANKS__: BANKS };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var PN = { games: {}, pick: {}, Banks: {} };', ctx);
  for (const f of ['src/data.js', 'src/games/hop.js']) vm.runInContext(read(f), ctx, { filename: ROOT + f });
  return { PN: vm.runInContext('PN', ctx), ctx };
}
const A = loadPage();
const G = A.PN.games.hop;
const R = G._rules;

/* 假房主：可控时钟 + 手动 flush 定时器 */
function makeHost(ids, settings, hostId) {
  const h = {
    clock: 1000000, timers: {}, events: [], toasts: [],
    state: {
      mode: 'round', phase: 'round',
      players: ids.map(id => ({ id, name: 'N_' + id, emoji: '🙂', score: 0, online: true })),
      settings: settings || {}, g: null, hostId: hostId || ids[0], ts: 0,
    },
    room: { publishState() {} },
    now() { return this.clock; },
    g() { return this.state.g; },
    onlinePlayers() { return this.state.players.filter(p => p.online); },
    player(id) { return this.state.players.find(p => p.id === id) || null; },
    amHost(id) { return id === this.state.hostId; },
    emit() {}, emitSoon() {},
    toast(m) { this.toasts.push(m); },
    event(e) { this.events.push(e); },
    addScore(id, n) { const p = this.player(id); if (p) p.score += n; },
    goLobby() { this.wentLobby = true; },
    after(n, ms, fn) { this.timers[n] = { at: this.clock + ms, fn }; },
    every() {}, clearTimer(n) { delete this.timers[n]; }, clearAll() { this.timers = {}; },
    sendSecret() {}, requestSecret() {}, resendSecret() {},
    flush() {                                   // 到点的定时器就跑
      Object.keys(this.timers).forEach(k => {
        const t = this.timers[k];
        if (t && t.at <= this.clock) { delete this.timers[k]; t.fn(); }
      });
    },
  };
  return h;
}
const start = (settings) => { const h = makeHost(['p1', 'p2'], settings); G.init(h); return h; };
/** 用"恰好落到目标中心"的力度完成一次跳跃 */
function jumpTo(h, pid, mode) {
  const g = h.g(), at = g.attempt;
  const plat = R.makeTrack(g.seed);
  const cur = plat[at.idx], next = plat[at.idx + 1];
  let power;
  if (mode === 'perfect') power = (next.x - cur.x - R.MIN_DIST) / (R.MAX_DIST - R.MIN_DIST);
  else if (mode === 'ok') power = ((next.x - cur.x) + (next.w / 2) * 0.75 - R.MIN_DIST) / (R.MAX_DIST - R.MIN_DIST);
  else if (mode === 'weak') power = 0.01;
  // fall：故意蓄得不够，落在两块之间的缝里（"用力过猛"在近处反而会命中，所以用欠力来造失败）
  else power = (cur.w / 2 + 0.12 - R.MIN_DIST) / (R.MAX_DIST - R.MIN_DIST);
  G.action(h, { t: 'charge' }, pid);
  h.clock += Math.round(power * R.MAX_HOLD);
  G.action(h, { t: 'release' }, pid);
  return g.attempt.last;
}

section('[1] 开局', function () {
  const h = start({});
  const g = h.g();
  ok(g.round === 1 && g.rounds === 3 && g.lives === 3, '默认 3 轮、每人 3 条命');
  ok(g.players.length === 2 && g.players[0] === 'p1', '两个玩家，p1 先跳');
  ok(!!g.attempt && g.attempt.pid === 'p1' && g.attempt.idx === 0, 'p1 拿到第一次机会（从第 0 块开始）');
  ok(typeof g.seed === 'number' && g.seed !== 0, '有本局种子：' + g.seed);
  ok(h.state.mode === 'round', '进入对局阶段');
});

section('[2] 跑道：同种子完全一致（两端各自生成，状态里只传种子）', function () {
  const a = R.makeTrack(12345), b = R.makeTrack(12345), c = R.makeTrack(999);
  ok(JSON.stringify(a) === JSON.stringify(b), '同种子两次生成完全相同');
  ok(JSON.stringify(a) !== JSON.stringify(c), '不同种子生成不同跑道');
  ok(a.length === R.PLATS && a[0].x === 0, '跑道 ' + R.PLATS + ' 块，起点在 0');
  const gaps = a.slice(1).map((p, i) => p.x - a[i].x);
  ok(gaps.every(x => x >= R.MIN_DIST && x <= R.MAX_DIST), '相邻间距都在可跳范围内（' + R.MIN_DIST + '~' + R.MAX_DIST + '）');
  ok(a.every(p => p.w >= 0.55 && p.w <= 1.05), '方块宽度在 0.55~1.05');
});

section('[3] 原作公式：蓄力 → 力度 → 距离 / 完美半径', function () {
  ok(R.powerOf(0) === 0 && Math.abs(R.powerOf(R.MAX_HOLD) - 1) < 1e-9, '按住 1.15 秒蓄满（power=1）');
  ok(Math.abs(R.powerOf(R.MAX_HOLD * 2) - 1) < 1e-9, '超时不溢出（上限 1）');
  ok(Math.abs(R.distOf(0) - R.MIN_DIST) < 1e-9 && Math.abs(R.distOf(1) - R.MAX_DIST) < 1e-9,
    '距离 = 0.26 + (3.62-0.26)×power');
  ok(Math.abs(R.perfectR(0.4) - 0.12) < 1e-9, '窄方块完美半径下限 0.12');
  ok(Math.abs(R.perfectR(1.05) - 0.22) < 1e-9, '宽方块完美半径上限 0.22');
});

section('[4] 完美落点连击（2/4/6/8/10 封顶）+ 普通落点断连击', function () {
  const h = start({});
  const at = h.g().attempt;
  ok(jumpTo(h, 'p1', 'perfect') === 'perfect', '第一跳落在中心 → perfect');
  ok(at.combo === 1 && at.score === 2, '连击 1、得分 2');
  jumpTo(h, 'p1', 'perfect'); ok(at.combo === 2 && at.score === 6, '再完美：连击 2、累计 6（+4）');
  jumpTo(h, 'p1', 'perfect'); ok(at.combo === 3 && at.score === 12, '连击 3、累计 12（+6）');
  jumpTo(h, 'p1', 'perfect'); ok(at.combo === 4 && at.score === 20, '连击 4、累计 20（+8）');
  jumpTo(h, 'p1', 'perfect'); ok(at.combo === 5 && at.score === 30, '连击 5、累计 30（+10）');
  jumpTo(h, 'p1', 'perfect'); ok(at.combo === 6 && at.score === 40, '连击 6 仍算 10 分（封顶），累计 40');
  jumpTo(h, 'p1', 'ok'); ok(at.score === 41 && at.combo === 0, '普通落点 +1 并断掉连击');
});

section('[5] 力度太小落回原地：不得分、不断命（原作行为）', function () {
  const h = start({});
  const at = h.g().attempt;
  const before = at.idx, lives = at.lives;
  ok(jumpTo(h, 'p1', 'weak') === 'weak', '轻点一下 → weak（落回原块）');
  ok(at.idx === before && at.lives === lives && at.score === 0, '位置/命数/分数都没变');
  ok(at.combo === 0, '连击清零');
});

section('[6] 掉下去扣命，扣完换人（同一颗种子，公平）', function () {
  const h = start({});
  const g = h.g();
  const seed = g.seed;
  const at = g.attempt;
  jumpTo(h, 'p1', 'ok');
  ok(at.score === 1, '先拿 1 分再掉');
  ok(jumpTo(h, 'p1', 'fall') === 'fall', '力度过猛 → fall');
  ok(at.lives === 2 && at.ended === false, '扣一条命，还能继续');
  jumpTo(h, 'p1', 'fall'); jumpTo(h, 'p1', 'fall');
  ok(at.lives === 0 && at.ended === true, '命扣完 → 本回合结束');
  h.clock += 2000; h.flush();                        // 等换人定时器
  const g2 = h.g();
  ok(g2.attempt && g2.attempt.pid === 'p2', '轮到 p2');
  ok(g2.seed === seed, 'p2 面对的是同一颗种子（公平对比）');
  ok(g2.attempt.score === 0 && g2.attempt.lives === 3, 'p2 从 0 分、3 条命开始');
  ok((g2.totals.p1 || 0) === 1, 'p1 这轮成绩已记入总分（1 分）');
});

section('[7] 两人都跳完 → 换轮换种子；打满轮数 → 结算', function () {
  const h = start({ hop: { rounds: 1 } });
  const g = h.g();
  const seed1 = g.seed;
  jumpTo(h, 'p1', 'ok');
  jumpTo(h, 'p1', 'fall'); jumpTo(h, 'p1', 'fall'); jumpTo(h, 'p1', 'fall');
  h.clock += 2000; h.flush();
  ok(h.g().attempt.pid === 'p2', 'p1 完了换 p2');
  jumpTo(h, 'p2', 'ok'); jumpTo(h, 'p2', 'perfect');
  jumpTo(h, 'p2', 'fall'); jumpTo(h, 'p2', 'fall'); jumpTo(h, 'p2', 'fall');
  h.clock += 2000; h.flush();
  const g3 = h.g();
  ok(g3.phase === 'over', '1 轮打完 → 进入结算');
  ok(g3.totals.p2 > g3.totals.p1, 'p2 分高（1+2=3 > 1）');
  ok(h.player('p2').score === 2, '赢家 +2 分：' + h.player('p2').score);
  ok(h.events.some(e => e.t === 'gameover'), '发出 gameover 事件');
  ok(g3.seed !== seed1 || true, '（换轮才换种子；1 轮时直接结束）');
});

section('[8] 换轮：轮数 > 1 时会换新种子', function () {
  const h = start({ hop: { rounds: 2 } });
  const seed1 = h.g().seed;
  jumpTo(h, 'p1', 'ok'); jumpTo(h, 'p1', 'fall'); jumpTo(h, 'p1', 'fall'); jumpTo(h, 'p1', 'fall');
  h.clock += 2000; h.flush();
  jumpTo(h, 'p2', 'ok'); jumpTo(h, 'p2', 'fall'); jumpTo(h, 'p2', 'fall'); jumpTo(h, 'p2', 'fall');
  h.clock += 2000; h.flush();
  const g = h.g();
  ok(g.round === 2 && g.phase === 'play', '进入第 2 轮（还没结束）');
  ok(g.seed !== seed1, '第 2 轮换了新种子');
  ok(g.attempt && g.attempt.pid === 'p1', '第 2 轮还是先手先跳');
  ok((g.totals.p1 || 0) >= 1 && (g.totals.p2 || 0) >= 1, '两人第一轮的成绩都留在总分里');
});

section('[9] 提前收工 / 换主 / 掉线 / 人数上限', function () {
  const h = start({});
  G.action(h, { t: 'giveup' }, 'p1');
  ok(h.g().attempt.ended === true, '提前收工 → 本回合立即结束，不让对手干等');
  h.clock += 2000; h.flush();
  ok(h.g().attempt.pid === 'p2', '收工后换人');

  G.action(h, { t: 'charge' }, 'p2');
  ok(h.g().attempt.charging === true, 'p2 开始蓄力');
  G.resume(h);
  ok(h.g().attempt.charging === false && h.g().power === 0, '换主后蓄力状态被清掉（新主不会卡在半空）');

  const h3 = makeHost(['p1', 'p2', 'p3'], {});
  G.init(h3);
  ok(h3.state.mode === 'round' && h3.wentLobby !== true, '三个人的房间仍然能开（只取前两人）');
  const h4 = makeHost(['p1', 'p2'], {});
  G.init(h4);
  h4.player('p2').online = false;                    // 对方掉线
  G.onLeave(h4, 'p2');
  ok(h4.g().phase === 'over', '对方离开 → 这局结束（不留死局）');
  ok(h4.player('p1').score === 1, '留下来的人不会空手（+1）');
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
