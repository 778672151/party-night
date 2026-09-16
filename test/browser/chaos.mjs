// 稳定性破坏测试（真浏览器双人）：模拟玩家各种「乱来」的操作，找卡死/卡退/隔离问题
//   node test/browser/chaos.mjs            # 全部
//   node test/browser/chaos.mjs switch     # 单个场景
// 每个场景独立建房，互不干扰。断言只看不变的量：模式合法、双方一致、无 JS 报错、能回到房间。
import {
  connect, createRoom, joinRoom, waitPlayers, sleep, assert, APP,
} from './lib.mjs';

const GAMES = ['gomoku', 'soko', 'mine', 'memory', 'hop', 'tacit', 'codraw', 'cube', 'domino', 'go'];
const S = {};

const modeOf = (p) => p.eval('(PN.app && PN.app.state && PN.app.state.mode) || "?"');
const errsOf = async (p) => { try { return JSON.parse(await p.consoleErrors()); } catch (e) { return []; } };

async function pair(cdp) {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2);
  await waitPlayers(B, 2);
  return [A, B];
}

/** 收集两端的报错，作为「没有抽搐/异常」的证据 */
async function noErrors(pages, label) {
  let bad = [];
  for (const p of pages) {
    const errs = await errsOf(p);
    if (errs.length) bad.push(p.name + ':' + errs.slice(0, 2).join(' / '));
  }
  assert(bad.length === 0, label + ' 无 JS 报错' + (bad.length ? '（' + bad.join('；') + '）' : ''));
}

/* ============ 场景：疯狂切换游戏（隔离性）============ */
S.switch = async (cdp) => {
  const [A, B] = await pair(cdp);
  const seq = ['gomoku', 'soko', 'mine', 'hop', 'memory', 'cube', 'domino', 'go', 'tacit'];
  let ok = true, why = '';
  for (const m of seq) {
    await A.eval('PN.app.send({t:"start", mode:' + JSON.stringify(m) + '})');
    await sleep(700);
    const a = await modeOf(A), b = await modeOf(B);
    if (a !== m || b !== m) { ok = false; why = m + ' → A=' + a + ' B=' + b; break; }
    // 立刻回大厅，再切下一个（最容易暴露旧局残留）
    await A.eval('PN.app.send({t:"lobby"})');
    await sleep(500);
    const a2 = await modeOf(A);
    if (a2 !== 'lobby') { ok = false; why = '回大厅失败：' + a2; break; }
  }
  assert(ok, '连续切换 9 款游戏且每次都回大厅，双方模式始终一致' + (ok ? '' : '（' + why + '）'));
  await noErrors([A, B], '切换游戏');
  await A.dispose(); await B.dispose();
};

/* ============ 场景：连点「开始」============ */
S.double = async (cdp) => {
  const [A, B] = await pair(cdp);
  await A.eval('(()=>{for(let i=0;i<8;i++) PN.app.send({t:"start", mode:"gomoku"}); return true;})()');
  await sleep(1200);
  const a = await modeOf(A), b = await modeOf(B);
  assert(a === 'gomoku' && b === 'gomoku', '连点开始 8 次后仍是正常一局（A=' + a + ' B=' + b + '）');
  const st = await A.eval('JSON.stringify({phase:PN.app.state.phase, players:(PN.app.state.players||[]).length, g:!!PN.app.state.g})');
  const o = JSON.parse(st);
  assert(o.phase === 'round' || o.phase === 'play', '连点后 phase 正常（' + o.phase + '）');
  assert(o.players === 2, '连点后仍是 2 名玩家（' + o.players + '）');
  await noErrors([A, B], '连点开始');
  await A.dispose(); await B.dispose();
};

/* ============ 场景：游戏中途一方退出再回来 ============ */
S.midquit = async (cdp) => {
  const [A, B] = await pair(cdp);
  await A.eval('PN.app.send({t:"start", mode:"gomoku"})');
  await sleep(900);
  // B 走「退出房间」，再重新进同一房号
  const code = await A.eval('PN.app.room.code');
  await B.eval('PN.app.send({t:"lobby"})');
  await sleep(800);
  await B.eval('try{PN.app.room.leave()}catch(e){}');
  await B.dispose();
  await sleep(600);
  const B2 = await joinRoom(cdp, '阿泽', code);
  await sleep(1500);
  const a = await modeOf(A), b = await modeOf(B2);
  assert(a === 'gomoku', '一方退出后房主这边仍在局中（mode=' + a + '）');
  assert(b === 'gomoku', '退回房间的人重新进房后能回到同一局（mode=' + b + '）');
  await noErrors([A, B2], '中途退出再回来');
  await A.dispose(); await B2.dispose();
};

/* ============ 场景：一局结束后双方都能正常回到房间 ============ */
S.over = async (cdp) => {
  const [A, B] = await pair(cdp);
  await A.eval('PN.app.send({t:"start", mode:"gomoku"})');
  await sleep(900);
  // 用规则内的一手结束不了，直接把 state 推到 over（模拟「某方获胜」）
  await A.eval('(()=>{const h=PN.app.host; const g=h.state.g; h.state.phase="over"; h.state.g=g; h.emit(); return true;})()');
  await sleep(1000);
  const aOver = await A.eval('PN.app.state.phase');
  assert(aOver === 'over', '房主侧进入终局（phase=' + aOver + '）');
  const bOver = await B.eval('PN.app.state.phase');
  assert(bOver === 'over', '对端也看到终局（phase=' + bOver + '）');
  // 房主点「回大厅」→ 双方都应回到房间
  await A.eval('PN.app.send({t:"lobby"})');
  await sleep(1200);
  const a = await modeOf(A), b = await modeOf(B);
  assert(a === 'lobby', '房主回到房间（mode=' + a + '）');
  assert(b === 'lobby', '对端也回到房间（mode=' + b + '）');
  await noErrors([A, B], '终局回房间');
  await A.dispose(); await B.dispose();
};

/* ============ 场景：对局中房主消失，另一端接管 ============ */
S.migrate = async (cdp) => {
  const [A, B] = await pair(cdp);
  await A.eval('PN.app.send({t:"start", mode:"gomoku"})');
  await sleep(900);
  const code = await A.eval('PN.app.room.code');
  await A.eval('try{PN.app.room.leave()}catch(e){}');
  await A.dispose();
  await sleep(1500);
  // B 应当接管房主，并且对局不能丢（这正是「突然退回房间」的原始场景）
  let became = false;
  for (let i = 0; i < 40; i++) {
    if (await B.eval('!!PN.app.room.isHost')) { became = true; break; }
    await sleep(500);
  }
  assert(became, '房主消失后另一端接管成为房主');
  const b = await modeOf(B);
  assert(b === 'gomoku', '接管后对局没有被重置为大厅（mode=' + b + '）—— 原「突然退回房间」场景');
  await noErrors([B], '房主迁移');
  await B.dispose();
};

/* ============ 场景：乱点乱拖（抽搐/报错）============ */
S.spam = async (cdp) => {
  const [A, B] = await pair(cdp);
  await A.eval('PN.app.send({t:"start", mode:"codraw"})');
  await sleep(1500);
  // 在画布上快速乱拖 + 到处乱点，模拟手忙脚乱的玩家
  for (const p of [A, B]) {
    try {
      await p.touchDrag('.dg-stage canvas', [0.2, 0.3], [0.8, 0.7], 20);
      await p.touchDrag('.dg-stage canvas', [0.7, 0.2], [0.3, 0.8], 20);
    } catch (e) {}
  }
  for (let i = 0; i < 12; i++) {
    const sel = ['.btn.primary', '.modecard', '.ghead', '.players-grid button', 'body'][i % 5];
    try { await A.click(sel); } catch (e) {}
    await sleep(120);
  }
  await sleep(800);
  const a = await modeOf(A);
  assert(a === 'codraw' || a === 'lobby', '乱点乱拖后模式仍然合法（' + a + '）');
  await noErrors([A, B], '乱点乱拖');
  await A.dispose(); await B.dispose();
};

const only = process.argv[2];
const cdp = await connect();
const names = only ? [only] : Object.keys(S);
for (const n of names) {
  if (!S[n]) { console.log('未知场景: ' + n); continue; }
  console.log('\n=== 场景 ' + n + ' ===');
  try { await S[n](cdp); }
  catch (e) { assert(false, '场景 ' + n + ' 抛异常: ' + (e && e.message)); }
}
cdp.close();
