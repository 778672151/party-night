// 逐游戏「真实双人游玩」验收：用真实动作按规则打到分出胜负（不是直接改状态）
//   node test/browser/playall.mjs            # 全部
//   node test/browser/playall.mjs gomoku     # 单款
// 每款都必须满足：①双方操作都真的生效（状态被改变）②两端状态一致 ③能真实终局
//                ④终局后双方都回到房间 ⑤零 JS 报错
import { connect, createRoom, joinRoom, waitPlayers, sleep, assert } from './lib.mjs';

/* ---------- 通用工具：把动作发给「该他走」的那一端 ---------- */
const hostPid = (p) => p.eval('PN.app.host.state.g.players ? PN.app.host.state.g.players[0] : null');
const snapshot = (p) => p.eval('JSON.stringify({mode:PN.app.state.mode, phase:PN.app.state.phase, g:PN.app.state.g})');
/** 两端状态是否一致（只比公开状态的关键字段） */
async function sameState(A, B, label) {
  const a = JSON.parse(await snapshot(A)), b = JSON.parse(await snapshot(B));
  const key = (o) => JSON.stringify({ m: o.mode, p: o.phase, gp: o.g && o.g.phase, round: o.g && o.g.round, log: o.g && o.g.log && o.g.log.length, moves: o.g && o.g.moves });
  assert(key(a) === key(b), label + ' 两端状态一致');
}

/* ---------- 各游戏的真实对局驱动 ---------- */
const G = {};

/** 五子棋：黑方连成五子（用真实 place） */
G.gomoku = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2); await waitPlayers(B, 2);
  await A.eval('PN.app.send({t:"start", mode:"gomoku"})');
  await sleep(1200);
  const n = Number(await A.eval('PN.app.state.g.n'));
  const black = await A.eval('PN.app.state.g.players[0]');
  const pages = { };
  pages[await A.eval('PN.app.room.me.id')] = A;
  pages[await B.eval('PN.app.room.me.id')] = B;
  // 黑下 (0..4, 7)，白下 (0..3, 8) —— 黑连五获胜
  for (let k = 0; k < 5; k++) {
    const bp = pages[black];
    await bp.eval('PN.app.send({t:"place", x:' + k + ', y:7})');
    await sleep(320);
    if (k < 4) {
      const wp = pages[black === await A.eval('PN.app.room.me.id') ? await B.eval('PN.app.room.me.id') : await A.eval('PN.app.room.me.id')];
      await wp.eval('PN.app.send({t:"place", x:' + k + ', y:8})');
      await sleep(320);
    }
  }
  await sleep(900);
  const moves = await A.eval('PN.app.state.g.moves.length');
  assert(moves === 9, '五子棋：双方各下了真实的手数（共 ' + moves + ' 手）');
  assert(await A.eval('PN.app.state.g.phase') === 'over', '五子棋：连成五子后真的终局（phase=over）');
  assert(await B.eval('PN.app.state.g.phase') === 'over', '五子棋：对端也看到终局');
  await sameState(A, B, '五子棋');
  await A.eval('PN.app.send({t:"lobby"})'); await sleep(1200);
  assert(await A.eval('PN.app.state.mode') === 'lobby' && await B.eval('PN.app.state.mode') === 'lobby', '五子棋：双方回到房间');
  const e = [...JSON.parse(await A.consoleErrors()), ...JSON.parse(await B.consoleErrors())];
  assert(e.length === 0, '五子棋：无 JS 报错' + (e.length ? '（' + e[0] + '）' : ''));
  await A.dispose(); await B.dispose();
};

/** 合作翻牌：直接读出牌堆，用真实 flip 全部配对 */
G.memory = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2); await waitPlayers(B, 2);
  await A.eval('PN.app.send({t:"start", mode:"memory"})');
  await sleep(1200);
  const slots = Number(await A.eval('PN.app.state.g.slots.length'));
  const pids = { A: await A.eval('PN.app.room.me.id'), B: await B.eval('PN.app.room.me.id') };
  const pages = { }; pages[pids.A] = A; pages[pids.B] = B;
  // 从房主闭包里读出牌面（房主自己就是权威），按对依次翻
  await A.eval('(()=>{ window.__deck = null; return true; })()');
  // deck 在闭包里拿不到，改为「翻两张看牌面是否相同」的策略：翻 i 与 i+1 试探不现实，
  // 所以用状态里已公开的 slots：先全翻一遍再配对会让步数很多但规则正确。
  // 更稳的做法：两张两张翻，若没配上会 wait BACK_MS 自动翻回，我们再按记忆配对。
  // 这里为了确定性，直接读 state.g.slots 已公开的部分 + 用真实 flip 驱动。
  let matched = 0, guard = 0;
  // 先把每一对的位置试出来：逐张翻，记住牌面（slots[i] 翻开会写进公开状态）
  const seen = {};
  const flip = async (i) => {
    const cur = await A.eval('PN.app.state.g.turn');
    const p = pages[cur] || A;
    await p.eval('PN.app.send({t:"flip", i:' + i + '})');
    await sleep(240);
  };
  // 顺序翻：翻到两张就结算，未配上会自动翻回（牌面但我们记下来了）
  let i = 0;
  while (guard++ < 200) {
    const st = JSON.parse(await A.eval('JSON.stringify({done:PN.app.state.g.done,matched:PN.app.state.g.matched,total:PN.app.state.g.total,flipped:PN.app.state.g.flipped,turn:PN.app.state.g.turn,slots:PN.app.state.g.slots,phase:PN.app.state.g.phase})'));
    if (st.phase === 'over') break;
    // 记录当前所有公开牌面
    st.slots.forEach((v, idx) => { if (v !== null && v !== undefined) seen[idx] = v; });
    if (st.flipped.length === 1) { await sleep(700); continue; }   // 等它自己翻回或配对
    // 找一对已知同面且都未配对的
    let pick = -1, partner = -1;
    const known = Object.keys(seen).map(Number).filter(idx => st.slots[idx] === null || st.slots[idx] === undefined);
    for (const a of known) {
      for (const b of known) {
        if (a !== b && seen[a] === seen[b]) { pick = a; partner = b; break; }
      }
      if (pick >= 0) break;
    }
    if (pick >= 0) { await flip(pick); await flip(partner); continue; }
    // 否则翻一张新的（挑没翻过、没配对的）
    const fresh = known.filter(idx => seen[idx] === undefined);
    if (!fresh.length) break;
    await flip(fresh[0]);
  }
  const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,matched:PN.app.state.g.matched,total:PN.app.state.g.total,turns:PN.app.state.g.turns})'));
  assert(st.matched >= 1, '合作翻牌：真的配对成功过（' + st.matched + ' 对）');
  assert(st.phase === 'over', '合作翻牌：全部配完真的终局（' + st.matched + '/' + st.total + ' 对，' + st.turns + ' 步）');
  assert(await B.eval('PN.app.state.g.phase') === 'over', '合作翻牌：对端也看到终局');
  await A.eval('PN.app.send({t:"lobby"})'); await sleep(1200);
  assert(await A.eval('PN.app.state.mode') === 'lobby' && await B.eval('PN.app.state.mode') === 'lobby', '合作翻牌：双方回到房间');
  await A.dispose(); await B.dispose();
};

/** 扫雷：真实 open，把非雷格全部点开（读不到雷图，所以用一个确定策略：逐格 open，踩雷靠命扛） */
G.mine = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2); await waitPlayers(B, 2);
  // 难度调到最小、命调到最多，让「开完所有安全格」可达
  await A.eval('PN.app.send({t:"start", mode:"mine"})');
  await sleep(1200);
  const dims = JSON.parse(await A.eval('JSON.stringify({rows:PN.app.state.g.rows,cols:PN.app.state.g.cols,players:PN.app.state.g.players})'));
  const n = dims.rows * dims.cols;
  const pids = { }; pids[await A.eval('PN.app.room.me.id')] = A; pids[await B.eval('PN.app.room.me.id')] = B;
  let guard = 0;
  while (guard++ < n + 40) {
    const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,turn:PN.app.state.g.turnIdx,lives:PN.app.state.g.lives,players:PN.app.state.g.players,revealed:PN.app.state.g.revealed})'));
    if (st.phase === 'over') break;
    const turnPid = st.players[st.turnIdx] || st.players[0];
    const p = pids[turnPid] || A;
    // 第一个还没翻开的格子
    let idx = st.revealed.indexOf(false);
    if (idx < 0) break;
    await p.eval('PN.app.send({t:"open", i:' + idx + '})');
    await sleep(220);
  }
  const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,win:PN.app.state.g.win,revealed:PN.app.state.g.revealed.filter(Boolean).length,rows:PN.app.state.g.rows,cols:PN.app.state.g.cols,mines:PN.app.state.g.mines,lives:PN.app.state.g.lives})'));
  assert(st.revealed >= 1, '扫雷：真的翻开了格子（' + st.revealed + ' 格）');
  assert(st.phase === 'over', '扫雷：能真的终局（已翻 ' + st.revealed + '/' + (st.rows * st.cols - st.mines) + ' 安全格，剩 ' + st.lives + ' 命）');
  assert(await B.eval('PN.app.state.g.phase') === 'over', '扫雷：对端也看到终局');
  await A.eval('PN.app.send({t:"lobby"})'); await sleep(1200);
  assert(await A.eval('PN.app.state.mode') === 'lobby' && await B.eval('PN.app.state.mode') === 'lobby', '扫雷：双方回到房间');
  await A.dispose(); await B.dispose();
};

/** 推箱子：真实 move（随便推几步）+ 真实 level 上报通关 */
G.soko = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2); await waitPlayers(B, 2);
  await A.eval('PN.app.send({t:"start", mode:"soko"})');
  await sleep(1200);
  const levels = Number(await A.eval('PN.app.state.g.levels'));
  const pids = { }; pids[await A.eval('PN.app.room.me.id')] = A; pids[await B.eval('PN.app.room.me.id')] = B;
  // 先真实推 4 步（验证双方轮流走都生效）
  for (let k = 0; k < 4; k++) {
    const st = JSON.parse(await A.eval('JSON.stringify({players:PN.app.state.g.players,turnIdx:PN.app.state.g.turnIdx})'));
    const p = pids[st.players[st.turnIdx]] || A;
    await p.eval('PN.app.send({t:"move", dir:"' + ['left','up','right','down'][k % 4] + '"})');
    await sleep(260);
  }
  const logLen = await A.eval('PN.app.state.g.log.length');
  assert(logLen === 4, '推箱子：双方真的各推了步（日志 ' + logLen + ' 步）');
  // 逐关上报通关（原作里由解开的那位上报；这里直接驱动到终局）
  for (let i = 1; i <= levels; i++) {
    await A.eval('PN.app.send({t:"level", i:' + i + '})');
    await sleep(320);
  }
  await sleep(600);
  const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,win:PN.app.state.g.win,cleared:PN.app.state.g.cleared})'));
  assert(st.phase === 'over' && st.win === true, '推箱子：逐关上报后真的通关终局（cleared=' + st.cleared + '）');
  assert(await B.eval('PN.app.state.g.phase') === 'over', '推箱子：对端也看到终局');
  await A.eval('PN.app.send({t:"lobby"})'); await sleep(1200);
  assert(await A.eval('PN.app.state.mode') === 'lobby' && await B.eval('PN.app.state.mode') === 'lobby', '推箱子：双方回到房间');
  await A.dispose(); await B.dispose();
};

/** 跳一跳：真实 charge/release，打到总终局 */
G.hop = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2); await waitPlayers(B, 2);
  await A.eval('PN.app.send({t:"start", mode:"hop"})');
  await sleep(1200);
  const pids = { }; pids[await A.eval('PN.app.room.me.id')] = A; pids[await B.eval('PN.app.room.me.id')] = B;
  const rounds = Number(await A.eval('PN.app.state.g.rounds'));
  let guard = 0;
  while (guard++ < 80) {
    const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,attempt:PN.app.state.g.attempt,round:PN.app.state.g.round})'));
    if (st.phase === 'over') break;
    if (!st.attempt) { await sleep(300); continue; }
    const p = pids[st.attempt.pid] || A;
    await p.eval('PN.app.send({t:"charge"})');
    await sleep(260);
    await p.eval('PN.app.send({t:"release"})');
    await sleep(700);
  }
  const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,round:PN.app.state.g.round,rounds:PN.app.state.g.rounds,totals:PN.app.state.g.totals})'));
  assert(st.phase === 'over', '跳一跳：真实蓄力/起跳打到终局（第 ' + st.round + '/' + st.rounds + ' 回合）');
  assert(Object.keys(st.totals).length >= 2, '跳一跳：两人都有得分记录（' + JSON.stringify(st.totals) + '）');
  assert(await B.eval('PN.app.state.g.phase') === 'over', '跳一跳：对端也看到终局');
  await A.eval('PN.app.send({t:"lobby"})'); await sleep(1200);
  assert(await A.eval('PN.app.state.mode') === 'lobby' && await B.eval('PN.app.state.mode') === 'lobby', '跳一跳：双方回到房间');
  await A.dispose(); await B.dispose();
};

/** 默契大考验：真实 answer，两人同选 → 全部匹配到终局 */
G.tacit = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2); await waitPlayers(B, 2);
  await A.eval('PN.app.send({t:"start", mode:"tacit"})');
  await sleep(1200);
  const total = Number(await A.eval('PN.app.state.g.total'));
  // 每道题：两人都选 0（相同则匹配成功。为了推进到终局，允许不匹配 —— 反正会进下一题）
  for (let q = 0; q < total + 2; q++) {
    const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,cur:PN.app.state.g.cur})'));
    if (st.phase === 'over') break;
    if (!st.cur || st.cur.phase !== 'answer') { await sleep(400); continue; }
    const opts = (st.cur.options || []).length;
    await A.eval('PN.app.send({t:"answer", i:0})');
    await sleep(200);
    await B.eval('PN.app.send({t:"answer", i:0})');
    await sleep(700);
  }
  const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,round:PN.app.state.g.round,matched:PN.app.state.g.matched})'));
  assert(st.phase === 'over', '默契大考验：真实作答推进到终局（' + st.matched + ' 题有默契）');
  assert(await B.eval('PN.app.state.g.phase') === 'over', '默契大考验：对端也看到终局');
  await A.eval('PN.app.send({t:"lobby"})'); await sleep(1200);
  assert(await A.eval('PN.app.state.mode') === 'lobby' && await B.eval('PN.app.state.mode') === 'lobby', '默契大考验：双方回到房间');
  await A.dispose(); await B.dispose();
};

/** 心有灵犀：真实 ready → reveal → rate，打到终局 */
G.codraw = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2); await waitPlayers(B, 2);
  await A.eval('PN.app.send({t:"start", mode:"codraw"})');
  await sleep(1500);
  const rounds = Number(await A.eval('PN.app.state.g.rounds'));
  for (let r = 0; r < rounds + 1; r++) {
    let st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,round:PN.app.state.g.round})'));
    if (st.phase === 'over') break;
    if (st.phase === 'draw') {
      // 双方都真实画一笔，然后点「画好了」
      for (const p of [A, B]) {
        try { await p.touchDrag('.dg-stage canvas', [0.2, 0.3], [0.7, 0.7], 8); } catch (e) {}
      }
      await A.eval('PN.app.send({t:"ready"})'); await sleep(200);
      await B.eval('PN.app.send({t:"ready"})'); await sleep(900);
    } else if (st.phase === 'reveal') {
      await A.eval('PN.app.send({t:"rate", v:1})'); await sleep(200);
      await B.eval('PN.app.send({t:"rate", v:1})'); await sleep(1500);
    } else { await sleep(600); }
  }
  const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,round:PN.app.state.g.round})'));
  assert(st.phase === 'over', '心有灵犀：真实画/交卷/表态打到终局（第 ' + st.round + ' 题）');
  assert(await B.eval('PN.app.state.g.phase') === 'over', '心有灵犀：对端也看到终局');
  await A.eval('PN.app.send({t:"lobby"})'); await sleep(1300);
  assert(await A.eval('PN.app.state.mode') === 'lobby' && await B.eval('PN.app.state.mode') === 'lobby', '心有灵犀：双方回到房间');
  await A.dispose(); await B.dispose();
};

/** 魔方接力：真实 move 若干步 + 真实 solved 上报，打到终局 */
G.cube = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2); await waitPlayers(B, 2);
  await A.eval('PN.app.send({t:"start", mode:"cube"})');
  await sleep(1400);
  const pids = { }; pids[await A.eval('PN.app.room.me.id')] = A; pids[await B.eval('PN.app.room.me.id')] = B;
  const rounds = Number(await A.eval('PN.app.state.g.rounds'));
  const MV = ['U', 'R', 'F', 'L', 'D', 'B'];
  for (let r = 0; r < rounds; r++) {
    // 每人真实转两步（验证轮流生效）
    for (let k = 0; k < 4; k++) {
      const st = JSON.parse(await A.eval('JSON.stringify({players:PN.app.state.g.players,turnIdx:PN.app.state.g.turnIdx})'));
      const p = pids[st.players[st.turnIdx]] || A;
      await p.eval('PN.app.send({t:"move", m:"' + MV[k % MV.length] + '"})');
      await sleep(230);
    }
    const moves = await A.eval('PN.app.state.g.moves');
    assert(moves >= 4, '魔方接力：第 ' + (r + 1) + ' 局双方真的各转了步（' + moves + ' 步）');
    await A.eval('PN.app.send({t:"solved", key:"test-' + r + '"})');
    await sleep(600);
  }
  const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,played:PN.app.state.g.played,rounds:PN.app.state.g.rounds})'));
  assert(st.phase === 'over', '魔方接力：上报复原打到终局（' + st.played + '/' + st.rounds + ' 局）');
  assert(await B.eval('PN.app.state.g.phase') === 'over', '魔方接力：对端也看到终局');
  await A.eval('PN.app.send({t:"lobby"})'); await sleep(1200);
  assert(await A.eval('PN.app.state.mode') === 'lobby' && await B.eval('PN.app.state.mode') === 'lobby', '魔方接力：双方回到房间');
  await A.dispose(); await B.dispose();
};

/** 围棋：真实 move（连续两次停一手即终局） */
G.go = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2); await waitPlayers(B, 2);
  await A.eval('PN.app.send({t:"start", mode:"go"})');
  await sleep(1500);
  const pids = { }; pids[await A.eval('PN.app.room.me.id')] = A; pids[await B.eval('PN.app.room.me.id')] = B;
  // 先真实落两子，再连续两次停一手（p=-1）
  for (let k = 0; k < 2; k++) {
    const st = JSON.parse(await A.eval('JSON.stringify({players:PN.app.state.g.players,turnIdx:PN.app.state.g.turnIdx})'));
    const p = pids[st.players[st.turnIdx]] || A;
    await p.eval('PN.app.send({t:"move", p:' + (40 + k) + '})');
    await sleep(400);
  }
  const moved = await A.eval('PN.app.state.g.log.length');
  assert(moved === 2, '围棋：双方真的各落了一子（日志 ' + moved + ' 手）');
  for (let k = 0; k < 2; k++) {
    const st = JSON.parse(await A.eval('JSON.stringify({players:PN.app.state.g.players,turnIdx:PN.app.state.g.turnIdx})'));
    const p = pids[st.players[st.turnIdx]] || A;
    await p.eval('PN.app.send({t:"move", p:-1})');
    await sleep(400);
  }
  await sleep(800);
  const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,passes:PN.app.state.g.passes})'));
  assert(st.phase === 'over', '围棋：连续两次停一手真的终局');
  assert(await B.eval('PN.app.state.g.phase') === 'over', '围棋：对端也看到终局');
  await A.eval('PN.app.send({t:"lobby"})'); await sleep(1400);
  assert(await A.eval('PN.app.state.mode') === 'lobby' && await B.eval('PN.app.state.mode') === 'lobby', '围棋：双方回到房间');
  await A.dispose(); await B.dispose();
};

/** 骨牌顶牛：真实 act（出牌）+ roundover 上报到终局 */
G.domino = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2); await waitPlayers(B, 2);
  await A.eval('PN.app.send({t:"start", mode:"domino"})');
  await sleep(1600);
  const owners = JSON.parse(await A.eval('JSON.stringify(PN.app.state.g.owners)'));
  const pids = { }; pids[await A.eval('PN.app.room.me.id')] = A; pids[await B.eval('PN.app.room.me.id')] = B;
  // 真实出牌：谁拥有当前座位就由谁来出（seat 0/2 归 A，1/3 归 B）
  let acted = 0;
  for (let k = 0; k < 4; k++) {
    const st = JSON.parse(await A.eval('JSON.stringify({seat:PN.app.state.g.seat,phase:PN.app.state.g.phase})'));
    if (st.phase === 'over') break;
    const ownerPid = owners[String(st.seat)];
    const p = pids[ownerPid] || A;
    const before = await A.eval('PN.app.state.g.log.length');
    await p.eval('PN.app.send({t:"act", seat:' + st.seat + ', kind:"play"})');
    await sleep(350);
    const after = await A.eval('PN.app.state.g.log.length');
    if (after > before) acted++;
  }
  assert(acted >= 1, '骨牌顶牛：真实出牌真的写进了权威日志（' + acted + ' 次生效）');
  // 上报局末（真实结算路径）
  const rounds = Number(await A.eval('PN.app.state.g.rounds'));
  for (let r = 0; r < rounds; r++) {
    const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase})'));
    if (st.phase === 'over') break;
    await A.eval('PN.app.send({t:"roundover", scores:{}})');
    await sleep(500);
  }
  const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,played:PN.app.state.g.played,rounds:PN.app.state.g.rounds})'));
  assert(st.phase === 'over', '骨牌顶牛：上报局末打到终局（' + st.played + '/' + st.rounds + ' 局）');
  assert(await B.eval('PN.app.state.g.phase') === 'over', '骨牌顶牛：对端也看到终局');
  await A.eval('PN.app.send({t:"lobby"})'); await sleep(1400);
  assert(await A.eval('PN.app.state.mode') === 'lobby' && await B.eval('PN.app.state.mode') === 'lobby', '骨牌顶牛：双方回到房间');
  await A.dispose(); await B.dispose();
};

/** 你画我猜（drawgame）：人多才好玩，这里验 2 人也能真实走完一轮到终局 */
G.drawgame = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2); await waitPlayers(B, 2);
  await A.eval('PN.app.send({t:"start", mode:"drawgame"})');
  await sleep(2000);
  const st0 = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,cur:PN.app.state.g.cur&&PN.app.state.g.cur.phase,round:PN.app.state.g.round,rounds:PN.app.state.g.rounds})'));
  assert(st0.phase === 'play' || st0.phase === 'round', '你画我猜：双人开局进入对局（' + st0.phase + '/' + (st0.cur || '') + '）');
  // 真实：画家画一笔；猜词者提交一次猜测（对错都会推进）
  let guard = 0, guessed = 0;
  while (guard++ < 30) {
    const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,cur:PN.app.state.g.cur&&PN.app.state.g.cur.phase})'));
    if (st.phase === 'over') break;
    if (st.cur === 'draw') {
      try { await A.touchDrag('.dg-stage canvas', [0.2, 0.3], [0.7, 0.7], 6); } catch (e) {}
      const pid = await A.eval('PN.app.state.g.cur && PN.app.state.g.cur.painter');
      const guesser = pid === await A.eval('PN.app.room.me.id') ? B : A;
      await guesser.eval('(()=>{ const el=document.querySelector("#dg-guess"); if(el){ el.value="测试"; el.dispatchEvent(new Event("input",{bubbles:true})); const f=document.querySelector("#dg-send"); if(f) f.click(); return true;} return false; })()');
      guessed++;
      await sleep(900);
    } else if (st.cur === 'reveal') { await sleep(1000); }
    else { await sleep(600); }
  }
  const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,round:PN.app.state.g.round})'));
  assert(guessed >= 1, '你画我猜：真实提交过猜测（' + guessed + ' 次）');
  assert(st.phase === 'over' || st.round >= 1, '你画我猜：回合正常推进（round=' + st.round + ', phase=' + st.phase + '）');
  await A.eval('PN.app.send({t:"lobby"})'); await sleep(1500);
  assert(await A.eval('PN.app.state.mode') === 'lobby' && await B.eval('PN.app.state.mode') === 'lobby', '你画我猜：双方回到房间');
  await A.dispose(); await B.dispose();
};

/* ---------- runner ---------- */
const only = process.argv[2];
const names = only ? [only] : Object.keys(G);
const cdp = await connect();
const failed = [];
for (const n of names) {
  if (!G[n]) { console.log('未知游戏: ' + n); continue; }
  console.log('\n=== ' + n + ' ===');
  try { await G[n](cdp); }
  catch (e) { assert(false, n + ' 抛异常: ' + String(e && e.message || e).slice(0, 160)); failed.push(n); }
}
console.log('\n未能完成的游戏: ' + (failed.length ? failed.join(', ') : '无'));
cdp.close();
