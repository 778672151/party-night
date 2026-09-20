// 跳一跳 真人破坏性压力测试：连点/满蓄力/同时按/切后台/双方抢按
import { connect, createRoom, joinRoom, waitPlayers, sleep, assert } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
const meA = await A.eval('PN.app.room.me.id'), meB = await B.eval('PN.app.room.me.id');
const P = {}; P[meA] = A; P[meB] = B;

/** 按「操作端**自己**界面显示轮到你」选人 —— 真人就是这么操作的。
 *  不能用房主侧 attempt.pid：1.4s 换人窗口里房主侧还指向刚掉下去的那位
 *（ended=true, lives=0），而他界面显示「等对方」；此时按键被 doCharge 的 isMine 守卫
 *  正确挡掉，看起来像"没反应"（实测 diag-hop-lag6.mjs，非产品缺陷）。 */
const minePage = async (tries = 25) => {
  for (let t = 0; t < tries; t++) {
    for (const pid of Object.keys(P)) {
      const isMine = await P[pid].eval('(function(){var g=PN.app.state.g;return !!(g&&g.attempt&&g.attempt.pid===PN.app.room.me.id&&!g.attempt.ended&&g.attempt.lives>0&&g.phase==="play")})()');
      if (isMine) return P[pid];
    }
    await sleep(200);
  }
  return null;
};
const st = (p) => p.eval('JSON.stringify({phase:PN.app.state.g.phase,round:PN.app.state.g.round,pid:PN.app.state.g.attempt&&PN.app.state.g.attempt.pid,idx:PN.app.state.g.attempt&&PN.app.state.g.attempt.idx,lives:PN.app.state.g.attempt&&PN.app.state.g.attempt.lives,charging:!!(PN.app.state.g.attempt&&PN.app.state.g.attempt.charging),totals:PN.app.state.g.totals})').then(JSON.parse).catch(()=>null);
await A.eval('PN.app.send({t:"start", mode:"hop"})');
await sleep(2500);

const press = async (p, ms, target) => {
  const b = await p.box(target || 'canvas.hop-cv');
  if (!b) return false;
  await p.mouse('mouseMoved', b.x, b.y, { button: 'none' });
  await p.mouse('mousePressed', b.x, b.y, { buttons: 1, button: 'left', clickCount: 1 });
  if (ms > 0) await sleep(ms);
  await p.mouse('mouseReleased', b.x, b.y, { buttons: 0, button: 'left', clickCount: 1 });
  return true;
};

/* 1. 疯狂连点（真人手抖/着急）*/
console.log('--- 1. 连点 20 次（每次按住 50ms）---');
let s = await st(A);
let page = (await minePage()) || ((s.pid === meA) ? A : B);
for (let i = 0; i < 20; i++) { await press(page, 50); await sleep(120); }
await sleep(1500);
let s1 = await st(A);
console.log('  连点后: phase=' + s1.phase + ' round=' + s1.round + ' pid换人=' + (s.pid !== s1.pid) + '  → ' + (s1.phase === 'play' ? '✓ 未崩' : '✗ ' + s1.phase));

/* 2. 满蓄力（按住超过 MAX_HOLD 1150ms）*/
console.log('--- 2. 满蓄力按住 2000ms（超过上限）---');
s = await st(A);
page = (await minePage()) || ((s.pid === meA) ? A : B);
await press(page, 2000);
await sleep(1600);
s1 = await st(A);
console.log('  满蓄力后: idx ' + s.idx + '→' + s1.idx + ' lives ' + s.lives + '→' + s1.lives + '  → ' + (s1.phase === 'play' ? '✓ 正常' : '✗ ' + s1.phase));

/* 3. 双方同时猛按（抢）*/
console.log('--- 3. 双方同时按 5 秒 ---');
s = await st(A);
page = (await minePage()) || ((s.pid === meA) ? A : B); // 谁该走（以他自己界面为准）
const other = page === A ? B : A;
await Promise.all([
  (async () => { for (let i = 0; i < 8; i++) { await press(page, 200); await sleep(150); } })(),
  (async () => { for (let i = 0; i < 8; i++) { await press(other, 200); await sleep(150); } })(),
]);
await sleep(1800);
s1 = await st(A);
const s1b = await st(B);
console.log('  A 看到: phase=' + s1.phase + ' round=' + s1.round + ' / B 看到: phase=' + s1b.phase + ' round=' + s1b.round);
console.log('  → ' + (s1.phase === s1b.phase && s1.round === s1b.round ? '✓ 两端一致，未崩' : '✗ 两端不一致'));

/* 4. 用完一局：确认最终能终局 */
// 注意：这里限制的是「**有效按键**次数」，不是循环次数。
// 实测（diag-hop-budget.mjs）打完一局 3 回合正常只要 26~29 次有效按键，
// 但换人窗口里 minePage 会空转（实测最多 57 次空转）——若用循环次数封顶，
// 空转会把预算吃光，于是「打不到终局」被误报成失败。
console.log('--- 4. 打到终局（最多 90 次有效按键）---');
let presses = 0, spins = 0;
while (presses < 90 && spins < 200) {
  const cur = await st(A);
  if (cur.phase === 'over') break;
  if (!cur.pid) { spins++; await sleep(400); continue; }
  const p = await minePage(3);
  if (!p) { spins++; await sleep(300); continue; }
  presses++;
  await press(p, 700);
  await sleep(1300);
}
console.log('  （有效按键 ' + presses + ' 次，空转 ' + spins + ' 次）');
// 打不完时打印卡在哪，避免只看到一句 "仍能真实终局 ✗" 而不知原因
{
  const dbg = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,round:PN.app.state.g.round,attempt:(PN.app.state.g.attempt||null),totals:PN.app.state.g.totals,attempts:PN.app.state.g.attempts})'));
  if (dbg.phase !== 'over') console.log('  ⚠ 未终局，当前状态: round=' + dbg.round + ' attempt=' + JSON.stringify(dbg.attempt) + ' attempts=' + JSON.stringify(dbg.attempts));
}
// 必须等对端收敛再断言：实测（diag-hop-over-lag.mjs）房主进入 over 后，
// 对端看到 over 的延迟样本 = [105, 2, 5605, 14, 1]ms —— 最长 5.6s。
// 立刻读会读到 "A=over B=play"，那是 QoS0 传播延迟，不是失步。
let finB = await st(B);
for (let k = 0; k < 24 && finB.phase !== 'over'; k++) { await sleep(500); finB = await st(B); }
const finA = await st(A);
console.log('  phase A=' + finA.phase + ' B=' + finB.phase + ' round=' + finA.round + ' totals=' + JSON.stringify(finA.totals));
assert(finA.phase === 'over' && finB.phase === 'over', '压力测试后仍能真实终局');
assert(finA.round <= 3, '轮数不超过设定（实际 ' + finA.round + '）');
const eA = JSON.parse(await A.consoleErrors()), eB = JSON.parse(await B.consoleErrors());
console.log('JS 报错: A=' + eA.length + ' B=' + eB.length + (eA.length ? ' 例:' + eA[0] : '') + (eB.length ? ' 例:' + eB[0] : ''));
assert(eA.length === 0 && eB.length === 0, '压力测试无 JS 报错');
console.log('HOP-STRESS 结束');
await A.dispose(); await B.dispose(); cdp.close();
