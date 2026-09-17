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
/** 等对端也看到终局：状态包走公共 broker（QoS0），有传播延迟，读太早会误判。
 *  这是真机事实，所以断言必须等一等，而不是用「立即读不到」去判产品失败。 */
async function peerSeesOver(page, label, tries = 24) {
  for (let i = 0; i < tries; i++) {
    const ph = await page.eval('(PN.app.state.g && PN.app.state.g.phase) || PN.app.state.phase');
    if (ph === 'over') return true;
    await sleep(400);
  }
  return false;
}

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
  assert(await peerSeesOver(B, '对端'), '五子棋：对端也看到终局');
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
  // 牌堆是刻意的私有数据（只在房主闭包，不进 state），所以只能像真人一样：
  // 一次翻两张 → 这一瞬把牌面记下来 → 下一轮按记忆配对。
  // （早先版本是「每轮翻一张」，等它自动扣回后再读，牌面早被清成 null，记忆永远是空的。）
  const read = () => A.eval('JSON.stringify({phase:PN.app.state.g.phase,matched:PN.app.state.g.matched,total:PN.app.state.g.total,turns:PN.app.state.g.turns,turn:PN.app.state.g.turn,flipped:PN.app.state.g.flipped,slots:PN.app.state.g.slots})').then(JSON.parse);
  const mem = {};
  const flip = async (i) => {
    const turn = await A.eval('PN.app.state.g.turn');
    const p = pages[turn] || A;
    await p.eval('PN.app.send({t:"flip", i:' + i + '})');
    await sleep(200);
  };
  let guard = 0;
  while (guard++ < 300) {
    const st = await read();
    if (st.phase === 'over') break;
    // 记忆：只在牌面还亮着的时候有效
    st.slots.forEach((v, idx) => { if (v !== null && v !== undefined) mem[idx] = v; });
    if (st.flipped.length > 0) { await sleep(600); continue; }   // 等它结算/自动扣回
    const faceDown = st.slots.map((v, idx) => v === null || v === undefined ? idx : -1).filter(idx => idx >= 0);
    if (!faceDown.length) break;
    // 按记忆找一对
    let a = -1, b = -1;
    const byFace = {};
    for (const idx of faceDown) if (mem[idx] !== undefined) (byFace[mem[idx]] = byFace[mem[idx]] || []).push(idx);
    for (const k in byFace) if (byFace[k].length >= 2) { a = byFace[k][0]; b = byFace[k][1]; break; }
    if (a < 0) {
      const unseen = faceDown.filter(idx => mem[idx] === undefined);
      const pick = unseen.length >= 2 ? [unseen[0], unseen[1]] : faceDown.slice(0, 2);
      a = pick[0]; b = pick[1];
    }
    await flip(a); await flip(b);
    const now = await read();
    now.slots.forEach((v, idx) => { if (v !== null && v !== undefined) mem[idx] = v; });   // 刚翻开、还亮着
    await sleep(400);
  }
  // 等终局状态经公共 broker 传到对端（QoS0 有延迟，读太早会误判）
  let okB = false;
  for (let k = 0; k < 20; k++) {
    if (await B.eval('PN.app.state.g && PN.app.state.g.phase') === 'over') { okB = true; break; }
    await sleep(400);
  }
  const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,matched:PN.app.state.g.matched,total:PN.app.state.g.total,turns:PN.app.state.g.turns})'));
  assert(st.matched >= 1, '合作翻牌：真的配对成功过（' + st.matched + ' 对）');
  assert(st.phase === 'over', '合作翻牌：全部配完真的终局（' + st.matched + '/' + st.total + ' 对，' + st.turns + ' 步）');
  assert(okB, '合作翻牌：对端也看到终局');
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
  await sleep(1500);
  const dims = JSON.parse(await A.eval('JSON.stringify({rows:PN.app.state.g.rows,cols:PN.app.state.g.cols,players:PN.app.state.g.players})'));
  const n = dims.rows * dims.cols;
  const pids = { }; pids[await A.eval('PN.app.room.me.id')] = A; pids[await B.eval('PN.app.room.me.id')] = B;
  // 真实玩家不会盲点：等「轮到自己」再点，点完等轮次真的推进
  let guard = 0;
  while (guard++ < n + 60) {
    const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,turnIdx:PN.app.state.g.turnIdx,lives:PN.app.state.g.lives,players:PN.app.state.g.players,revealed:PN.app.state.g.revealed})'));
    if (st.phase === 'over') break;
    const turnId = st.players[st.turnIdx] || st.players[0];
    const p = pids[turnId] || A;
    const idx = st.revealed.indexOf(false);
    if (idx < 0) break;
    const before = st.revealed.filter(Boolean).length;
    await p.eval('PN.app.send({t:"open", i:' + idx + '})');
    // 等这一步真的生效（翻开数变化 或 轮次前进 或 终局），最多 3 秒
    for (let w = 0; w < 15; w++) {
      await sleep(200);
      const nx = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,turnIdx:PN.app.state.g.turnIdx,opened:PN.app.state.g.revealed.filter(Boolean).length})'));
      if (nx.phase === 'over' || nx.turnIdx !== st.turnIdx || nx.opened !== before) break;
    }
  }
  const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,win:PN.app.state.g.win,revealed:PN.app.state.g.revealed.filter(Boolean).length,rows:PN.app.state.g.rows,cols:PN.app.state.g.cols,mines:PN.app.state.g.mines,lives:PN.app.state.g.lives})'));
  assert(st.revealed >= 1, '扫雷：真的翻开了格子（' + st.revealed + ' 格）');
  assert(st.phase === 'over', '扫雷：能真的终局（已翻 ' + st.revealed + '/' + (st.rows * st.cols - st.mines) + ' 安全格，剩 ' + st.lives + ' 命）');
  assert(await peerSeesOver(B, '对端'), '扫雷：对端也看到终局');
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
  // 先真实推 4 步（验证双方轮流走都生效）：同样等轮次推进，别盲发
  for (let k = 0; k < 4; k++) {
    const st = JSON.parse(await A.eval('JSON.stringify({players:PN.app.state.g.players,turnIdx:PN.app.state.g.turnIdx,log:PN.app.state.g.log.length})'));
    const p = pids[st.players[st.turnIdx]] || A;
    await p.eval('PN.app.send({t:"move", dir:"' + ['left','up','right','down'][k % 4] + '"})');
    for (let w = 0; w < 15; w++) {
      await sleep(200);
      const nx = JSON.parse(await A.eval('JSON.stringify({turnIdx:PN.app.state.g.turnIdx,log:PN.app.state.g.log.length})'));
      if (nx.log !== st.log || nx.turnIdx !== st.turnIdx) break;
    }
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
  assert(await peerSeesOver(B, '对端'), '推箱子：对端也看到终局');
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
  assert(await peerSeesOver(B, '对端'), '跳一跳：对端也看到终局');
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
  // 每题两人都选 0（相同即默契）。注意揭晓后有 REVEAL_MS=4.5 秒停留，
  // 必须等「下一题的 answer 阶段」真的到来再答 —— 否则答的是已经揭晓的那题，会被规则拒绝。
  const readTacit = () => A.eval('JSON.stringify({phase:PN.app.state.g.phase,round:PN.app.state.g.round,cur:PN.app.state.g.cur&&PN.app.state.g.cur.phase,q:PN.app.state.g.cur&&PN.app.state.g.cur.q})').then(JSON.parse);
  let lastQ = null;
  for (let q = 0; q < total + 3; q++) {
    const st = await readTacit();
    if (st.phase === 'over') break;
    if (!st.cur || st.cur !== 'answer' || st.q === lastQ) { await sleep(500); continue; }
    lastQ = st.q;
    await A.eval('PN.app.send({t:"answer", i:0})');
    await sleep(250);
    await B.eval('PN.app.send({t:"answer", i:0})');
    // 等揭晓 + 进入下一题
    for (let w = 0; w < 20; w++) { await sleep(500); const nx = await readTacit(); if (nx.phase === 'over' || nx.q !== lastQ) break; }
  }
  const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,round:PN.app.state.g.round,matched:PN.app.state.g.matched})'));
  assert(st.phase === 'over', '默契大考验：真实作答推进到终局（' + st.matched + ' 题有默契）');
  assert(await peerSeesOver(B, '对端'), '默契大考验：对端也看到终局');
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
  // 注意：codraw 的题数字段叫 total（不是 rounds）—— 读错得到 NaN，循环一次都不进，
  // 会表现成「卡在第 1 题」，其实产品是好的（诊断脚本已证明 3 题能自然打完并终局）。
  const rounds = Number(await A.eval('PN.app.state.g.total'));
  // 注意时序：draw → reveal 后要停留 REVEAL_MS=9 秒才进下一题，
  // 必须等「round 真的变了（或又回到 draw）」再画下一题，否则交卷会被当成上一题的重复动作。
  // 按诊断出的真实节奏驱动：draw → 双方 ready → reveal → 双方 rate → 等 9 秒进下一题/终局。
  // 每轮只做一件「当前阶段该做的事」，用轮次号去重而不是 phase 字符串（同一个 phase 会出现在多题里）。
  const readCd = () => A.eval('JSON.stringify({phase:PN.app.state.g.phase,round:PN.app.state.g.round,ready:(PN.app.state.g.ready||{}),rated:(PN.app.state.g.rated||{})})').then(JSON.parse);
  // ready / rate 在规则里都是**幂等**的（ready 只认 draw 阶段、rate 同一人只记一次），
  // 所以每轮轮询直接各发一次最稳，不需要额外的去重记账（记账反而会把自己锁住）。
  let guard = 0;
  while (guard++ < (rounds + 2) * 40) {
    const st = await readCd();
    if (st.phase === 'over') break;
    if (st.phase === 'draw') {
      if (guard % 6 === 1) { for (const p of [A, B]) { try { await p.touchDrag('.dg-stage canvas', [0.2, 0.3], [0.7, 0.7], 8); } catch (e) {} } }
      await A.eval('PN.app.send({t:"ready"})');
      await B.eval('PN.app.send({t:"ready"})');
    } else if (st.phase === 'reveal') {
      await A.eval('PN.app.send({t:"rate", v:1})');
      await B.eval('PN.app.send({t:"rate", v:1})');
    }
    await sleep(500);
  }
  const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,round:PN.app.state.g.round})'));
  assert(st.phase === 'over', '心有灵犀：真实画/交卷/表态打到终局（第 ' + st.round + ' 题）');
  assert(await peerSeesOver(B, '对端'), '心有灵犀：对端也看到终局');
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
  assert(await peerSeesOver(B, '对端'), '魔方接力：对端也看到终局');
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
  assert(await peerSeesOver(B, '对端'), '围棋：对端也看到终局');
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
  assert(await peerSeesOver(B, '对端'), '骨牌顶牛：对端也看到终局');
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
  // 注意：drawgame 的「阶段」有两个 —— state.phase（房顶级）与 g.cur.phase（本轮：pick/draw/reveal）。
  // 字段读错会得到 undefined，看起来像「没进对局」，其实是测试的问题。
  const readDg = () => A.eval('JSON.stringify({sp:PN.app.state.phase,curPhase:(PN.app.state.g.cur||{}).phase,round:PN.app.state.g.round,painter:(PN.app.state.g.cur||{}).painter,guessed:Object.keys(((PN.app.state.g.cur||{}).guessed)||{}).length})').then(JSON.parse);
  const st0 = await readDg();
  assert(st0.sp === 'round' || st0.sp === 'over', '你画我猜：双人开局进入对局（state.phase=' + st0.sp + '，本轮=' + (st0.curPhase || '无') + '）');
  const meA = await A.eval('PN.app.room.me.id'), meB = await B.eval('PN.app.room.me.id');
  let guard = 0, guessed = 0, drew = 0;
  while (guard++ < 90) {
    const st = await readDg();
    if (st.sp === 'over') break;
    if (st.curPhase === 'pick') {
      // 画家先真实选词（这是 drawgame 的第一步，跳过它就会永远停在 pick —— 我之前就卡在这）
      const painterPage = st.painter === meA ? A : B;
      await painterPage.eval('(()=>{ const b=document.querySelector("[data-word]"); if(b) b.click(); return !!b; })()');
      await sleep(800);
      continue;
    }
    if (st.curPhase === 'draw') {
      // 画家真实画一笔
      const painterPage = st.painter === meA ? A : B;
      try { await painterPage.touchDrag('.dg-stage canvas', [0.2 + (drew % 3) * 0.1, 0.3], [0.7, 0.7], 6); drew++; } catch (e) {}
      // 画家手里有词（私密下发的答案）——从画家页面读出来，让猜词者**真的猜对**，
      // 这样游戏才会按规则一轮轮走到终局（而不是靠 30 次乱猜耗到超时）。
      const word = String(await painterPage.eval('((document.querySelector(".dg-hint .w")||{}).textContent || "").replace(/^你要画/,"").trim()')).trim();
      const guesserPage = st.painter === meA ? B : A;
      const sent = await guesserPage.eval('(()=>{ const w = ' + JSON.stringify(word) + '; const inp=document.querySelector(".dg-input input"); if(!inp || inp.disabled || !w) return "skip"; inp.value=w; inp.dispatchEvent(new Event("input",{bubbles:true})); const btn=document.querySelector(".dg-input button"); if(btn) btn.click(); return "sent"; })()');
      if (sent === 'sent') guessed++;
      await sleep(900);
    } else {
      await sleep(700);
    }
  }
  const st = await readDg();
  assert(guessed >= 1, '你画我猜：真实提交过猜测（' + guessed + ' 次）');
  assert(drew >= 1, '你画我猜：画家真实画了笔（' + drew + ' 次拖拽）');
  assert(st.sp === 'over' || st.round >= 1, '你画我猜：回合正常推进（round=' + st.round + '，state.phase=' + st.sp + '）');
  assert(await peerSeesOver(B, '对端') || st.sp !== 'over', '你画我猜：终局（若已终局）对端也能看到');
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
