// 鲸鱼推箱子（双人合作）：房主逻辑 + 关卡数据合法性（零依赖）
//   node test/soko-test.mjs
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
  for (const f of ['src/data.js', 'src/games/soko.js']) vm.runInContext(read(f), ctx, { filename: ROOT + f });
  return { PN: vm.runInContext('PN', ctx), ctx };
}
const A = loadPage();
const G = A.PN.games.soko;
const R = G._rules;

function makeHost(ids, settings) {
  return {
    timers: {}, events: [], toasts: [],
    state: { mode: 'round', phase: 'round',
      players: ids.map(id => ({ id, name: 'N_' + id, emoji: '🙂', score: 0, online: true })),
      settings: settings || {}, g: null, hostId: ids[0], ts: 0 },
    room: { publishState() {} }, now: () => 1,
    g() { return this.state.g; },
    onlinePlayers() { return this.state.players.filter(p => p.online); },
    player(id) { return this.state.players.find(p => p.id === id) || null; },
    amHost(id) { return id === this.state.hostId; },
    emit() {}, emitSoon() {}, toast(m) { this.toasts.push(m); }, event(e) { this.events.push(e); },
    addScore(id, n) { const p = this.player(id); if (p) p.score += n; }, goLobby() { this.wentLobby = true; },
    after() {}, every() {}, clearTimer() {}, clearAll() {},
    sendSecret() {}, requestSecret() {}, resendSecret() {},
  };
}
const start = (settings) => { const h = makeHost(['p1', 'p2'], settings); G.init(h); return h; };
const turnPid = (h) => h.g().players[h.g().turnIdx];
const mv = (h, dir, pid) => G.action(h, { t: 'move', dir }, pid || turnPid(h));

section('[1] 关卡数据合法（箱子数 = 目标数，否则无解）', function () {
  ok(R.LEVELS.length === 10, '共 10 关（沿用原作的原创关卡）');
  let bad = [];
  R.PARSED.forEach((L, i) => {
    const boxes = R.boxList({ boxes: L.boxes }).length;
    const goals = R.goalTotal(L);
    if (boxes !== goals || boxes === 0) bad.push((i + 1) + '关(' + boxes + '箱/' + goals + '目标)');
    if (L.whale < 0) bad.push((i + 1) + '关无玩家');
  });
  ok(bad.length === 0, '10 关的箱子数都等于目标数、都有玩家' + (bad.length ? '：' + bad.join(',') : ''));
  const l1 = R.levelAt(0);
  ok(l1.rows === 5 && l1.cols === 7 && l1.par === 2, '第 1 关 5×7、参考步数 2');
});

section('[2] 开局与轮次', function () {
  const h = start({});
  const g = h.g();
  ok(g.li === 0 && g.levels === 5, '默认从第 1 关开始、共 5 关（⚙️可改 3/10）');
  ok(g.phase === 'play' && g.moves === 0 && g.pushes === 0, '对局开始，步数归零');
  ok(turnPid(h) === 'p1', 'p1 先走');
  ok(!turnPid(h).includes('x'), '轮次取的是玩家 id');
});

section('[3] 推箱子规则：走/撞墙/推/推不动（纯函数 + 房主各测一遍）', function () {
  // 合成小地图（坐标写清楚，免得再拿"以为的墙"当墙）：
  //   行0 #####   行1 # . # → (1,2)=目标
  //   行2 #@$ # → (2,1)=玩家 (2,2)=箱子 (2,3)=空地
  //   行3 #   #   行4 #####   → (2,0) 和 (2,4) 都是墙
  const L = R.parse(['#####', '# . #', '#@$ #', '#   #', '#####']);
  const w = (r, c) => r * L.cols + c;
  const mk = () => ({ boxes: L.boxes.slice(), whale: L.whale });
  ok(L.whale === w(2, 1) && L.boxes[w(2, 2)] === true && L.goals[w(1, 2)] === true,
    '解析 XSB：玩家(2,1)、箱子(2,2)、目标(1,2)');
  let s = mk(), r1 = R.step(L, s, 0, 1);
  ok(r1.moved === true && r1.pushed === true && r1.to === w(2, 3), '往右推动：箱子 (2,2)→(2,3)');
  s = mk(); let r2 = R.step(L, s, -1, 0);
  ok(r2.moved === true && r2.pushed === false && r2.whale === w(1, 1), '往上走空地：只是走，不是推');
  s = mk(); let r3 = R.step(L, s, 0, -1);
  ok(r3.moved === false, '往左是墙 (2,0)：走不动');
  s = mk(); s.boxes[w(2, 2)] = false; s.boxes[w(2, 3)] = true; s.whale = w(2, 2);
  ok(R.step(L, s, 0, 1).moved === false, '把箱子往墙 (2,4) 里推：推不动');
  s = mk(); s.boxes[w(2, 3)] = true; s.whale = w(2, 1);
  ok(R.step(L, s, 0, 1).moved === false, '一次只能推一个箱子：前面还有一个箱子就走不动');
  // 房主层：真的走不动时不该消耗回合
  const h = start({});
  const g = h.g();
  mv(h, 'up');                                    // 第 1 关内部是通的：(2,1)→(1,1) 成功
  ok(g.moves === 1 && turnPid(h) === 'p2', '走到空地：步数 1、换人');
  const t = turnPid(h), pos = g.whale;
  mv(h, 'up', t);                                 // (0,1) 是边界墙
  ok(g.whale === pos && g.moves === 1, '撞边界墙：位置与步数都不变');
  ok(turnPid(h) === t, '撞墙不消耗回合（免得白送对手一步）');
  mv(h, 'down');                                  // p2 走回 (2,1)
  mv(h, 'right');                                 // p1 往右推箱子
  ok(g.moves === 3 && g.pushes === 1, '推动箱子：步数 +1 且计入推动数（' + g.moves + ' 步 / ' + g.pushes + ' 推）');
});

section('[4] 第 1 关按 par 步通关（2 次推动）', function () {
  const h = start({});
  const g = h.g();
  mv(h, 'right');                                // 推箱 (2,2)→(2,3)
  ok(g.pushes === 1 && g.cleared === 0, '第一次推动后还没通关');
  const firstMoves = g.moves;
  mv(h, 'right');                                // 推箱 (2,3)→(2,4) 落在目标点上
  ok(g.cleared === 1, '第二次推动通关');
  ok(firstMoves === 1, '第一推动后记到 1 步');
  ok(h.toasts.some(t => t.indexOf('用了 2 步') >= 0), '提示里写的是"用了 2 步 —— 与原作 par 一致"');
  ok(h.player('p1').score === 2 && h.player('p2').score === 2, '通关双方各 +2');
  ok(g.li === 1, '自动进入第 2 关');
  ok(g.phase === 'play' && g.moves === 0 && g.pushes === 0, '新关卡步数归零');
  ok(g.levelId === 'grove-02', '第 2 关是 grove-02（' + g.levelName + '）');
});

section('[5] 通关后能一直打到最后一关 → 结算', function () {
  const h = start({ soko: { levels: 3 } });
  const g = h.g();
  ok(g.levels === 3, '⚙️设置生效：只打 3 关');
  for (let i = 0; i < 3; i++) {
    // 直接把箱子摆到目标点上，再随便走一步触发结算（只为测流程，不是测解谜）
    g.boxes = g.goals.slice();
    const dir = (() => {                                   // 找一个走得通的方向
      for (const d of ['right', 'left', 'up', 'down']) {
        const r = Math.floor(g.whale / g.cols), c = g.whale % g.cols;
        const dd = { right: [0, 1], left: [0, -1], up: [-1, 0], down: [1, 0] }[d];
        const nr = r + dd[0], nc = c + dd[1];
        if (nr < 0 || nc < 0 || nr >= g.rows || nc >= g.cols) continue;
        const ni = nr * g.cols + nc;
        if (!g.walls[ni] && !g.boxes[ni]) return d;
      }
      return null;
    })();
    if (!dir) { ok(false, '第 ' + (i + 1) + ' 关找不到能走的方向（测试自身问题）'); break; }
    mv(h, dir);
  }
  ok(g.phase === 'over' && g.win === true, '打满 3 关 → 一起通关');
  ok(g.cleared === 3, '共通关 3 关');
  ok(h.player('p1').score === 6 && h.player('p2').score === 6, '双方各 +6 分（每关 +2）');
  ok(h.events.some(e => e.t === 'gameover'), '发出 gameover 事件');
});

section('[6] 重来本关', function () {
  const h = start({});
  const g = h.g();
  mv(h, 'right');
  const moved = g.moves;
  G.action(h, { t: 'reset' }, 'p2');
  ok(g.moves === 0 && g.pushes === 0, '重来把本关的步数/推动归零');
  ok(g.boxes.indexOf(true) >= 0, '箱子回到初始位置');
  ok(turnPid(h) === 'p1', '重来也算让一步（轮次会换，保持公平）');
  ok(moved === 1, '（重来前的步数确实是 1）');
});

section('[7] 掉线 / 换主 / 人数 / 单人', function () {
  const h = start({});
  G.resume(h);
  ok(h.g().phase === 'play', '换主后状态还在（棋盘全在 state 里）');
  const h2 = makeHost(['p1', 'p2']); G.init(h2);
  h2.player('p2').online = false;
  G.onLeave(h2, 'p2');
  ok(h2.g().phase === 'over', '对方离开 → 结束（不留死局）');
  const h3 = makeHost(['p1', 'p2', 'p3']); G.init(h3);
  ok(h3.state.mode === 'round', '三个人也能开（只取前两人）');
  const h4 = makeHost(['p1']); G.init(h4);
  ok(h4.wentLobby === true, '一个人时回大厅');
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
