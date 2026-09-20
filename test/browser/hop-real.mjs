// 跳一跳「真人输入」实测：真鼠标按住/松手 + 真空格键，完整玩 2 人 3 轮
//   node test/browser/hop-real.mjs
// 关键：不走 PN.app.send()，全部用浏览器输入管线产生可信事件。
import { connect, createRoom, joinRoom, waitPlayers, sleep, assert } from './lib.mjs';

const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
const meA = await A.eval('PN.app.room.me.id'), meB = await B.eval('PN.app.room.me.id');
const P = {}; P[meA] = A; P[meB] = B;
console.log('房间 ' + A.code + ' 就绪');

await A.eval('PN.app.send({t:"start", mode:"hop"})');
await sleep(2500);
const st0 = JSON.parse(await A.eval('JSON.stringify({mode:PN.app.state.mode,phase:PN.app.state.g.phase?PN.app.state.g.phase:null,round:PN.app.state.g.round,rounds:PN.app.state.g.rounds,lives:PN.app.state.g.lives,attempt:PN.app.state.g.attempt&&{pid:PN.app.state.g.attempt.pid,lives:PN.app.state.g.attempt.lives,idx:PN.app.state.g.attempt.idx,ended:PN.app.state.g.attempt.ended,charging:!!PN.app.state.g.attempt.charging}})')); 
console.log('开局: ' + JSON.stringify(st0));

// 找到跳跃画布
const cvSel = await A.eval('(()=>{const c=document.querySelector("canvas.hop-cv, .hop-stage canvas, canvas"); return c? (c.className||"canvas") : null;})()');
console.log('画布选择器: ' + cvSel);

// 真人操作：按住 canvas 一段时间再松开（真 pointer 事件）
async function realJump(page, ms) {
  const box = await page.box('canvas');
  if (!box) { console.log('    ✗ 找不到画布'); return false; }
  const x = box.x, y = box.y;   // box() 已返回中心点
  await page.mouse('mouseMoved', x, y, { button: 'none' });
  await page.mouse('mousePressed', x, y, { buttons: 1, button: 'left', clickCount: 1 });
  await sleep(ms);
  await page.mouse('mouseReleased', x, y, { buttons: 0, button: 'left', clickCount: 1 });
  return true;
}
// 真人操作：空格（必须真的「按住」：keyDown → 等待 → keyUp。
// 注意 lib.key(key,code,keyCode) 是 keyDown+keyUp 连发、中间不等待，不能用来模拟蓄力）
async function spaceJump(page, ms) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 }, page.sid);
  await sleep(ms);
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 }, page.sid);
}

const readG = (p) => p.eval('JSON.stringify({phase:PN.app.state.g.phase,round:PN.app.state.g.round,attempt:PN.app.state.g.attempt&&{pid:PN.app.state.g.attempt.pid,lives:PN.app.state.g.attempt.lives,score:PN.app.state.g.attempt.score,idx:PN.app.state.g.attempt.idx,ended:PN.app.state.g.attempt.ended,charging:!!PN.app.state.g.attempt.charging,fly:!!PN.app.state.g.attempt.fly},totals:PN.app.state.g.totals,attempts:PN.app.state.g.attempts})').then(JSON.parse);

let jumps = 0, eff = 0;
for (let step = 0; step < 60; step++) {
  const g = await readG(A);
  if (g.phase === 'over') { console.log('>>> 终局 at step ' + step); break; }
  if (!g.attempt || g.attempt.ended) { await sleep(700); continue; }
  // 关键：按「操作端自己界面显示轮到你」来选人，而不是按房主侧 attempt.pid。
  // 实测（diag-hop-lag6.mjs）：在 1.4s 换人窗口里，房主侧 attempt 还是刚掉下去那一位
  //（ended=true, lives=0），此时**操作端界面显示的是「等对方」、mine=false** ——
  // 真人不会在这个窗口操作；若按房主状态硬按，doCharge 的 isMine 守卫会正确挡掉，
  // 表现出来就是"没反应"（其实是我的测试按错了人/按早了，不是产品缺陷）。
  let who = null;
  for (const pid of Object.keys(P)) {
    const mineNow = await P[pid].eval('(function(){var g=PN.app.state.g;return !!(g&&g.attempt&&g.attempt.pid===PN.app.room.me.id&&!g.attempt.ended&&g.attempt.lives>0&&g.phase==="play")})()');
    if (mineNow) { who = P[pid]; break; }
  }
  if (!who) { await sleep(400); continue; }
  const label = who === A ? 'A/小桃' : 'B/阿泽';
  const before = JSON.parse(await who.eval('JSON.stringify({idx:PN.app.state.g.attempt.idx,score:PN.app.state.g.attempt.score,lives:PN.app.state.g.attempt.lives,round:PN.app.state.g.round})'));
  // 交替使用真鼠标 / 真空格，覆盖两种输入方式
  const useSpace = jumps % 2 === 1;
  const hold = 300 + (jumps % 5) * 180;
  if (useSpace) await spaceJump(who, hold); else await realJump(who, hold);
  jumps++;
  // ⚠️ 不能固定睡 1400ms 就读一次：QoS0 下状态回包实测 400~1800ms+，晚到会被误判「没反应」。
  // 改成轮询等本端 state 变化（最多 3.5s），这才是「真人输入生效」的本意。
  let after = null;
  for (let w = 0; w < 18; w++) {
    after = JSON.parse(await who.eval('JSON.stringify({idx:PN.app.state.g.attempt?PN.app.state.g.attempt.idx:-1,score:PN.app.state.g.attempt?PN.app.state.g.attempt.score:-1,lives:PN.app.state.g.attempt?PN.app.state.g.attempt.lives:-1,round:PN.app.state.g.round,ended:PN.app.state.g.attempt?PN.app.state.g.attempt.ended:null})').catch(() => '{}'));
    if (after.idx !== before.idx || after.score !== before.score || after.lives !== before.lives || after.round !== before.round || after.ended) break;
    await sleep(200);
  }
  const moved = after && (after.idx !== before.idx || after.score !== before.score || after.lives !== before.lives || after.round !== before.round || after.ended);
  if (moved) eff++;
  console.log('  第' + (jumps) + '跳 ' + label + (useSpace ? ' [空格]' : ' [鼠标]') + ' 按住' + hold + 'ms → idx ' + before.idx + '→' + after.idx + ' 分 ' + before.score + '→' + after.score + ' 命 ' + before.lives + '→' + after.lives + ' 回合 ' + before.round + '→' + after.round + '  ' + (moved ? '✓生效' : '✗没反应'));
}

const fin = await readG(A);
console.log('最终: phase=' + fin.phase + ' round=' + fin.round + ' totals=' + JSON.stringify(fin.totals));
// ⚠️ 终局的 over 往往是**最后一包** state：QoS0 丢了要等心跳带 sv 协商补发（心跳 ~5s），
// 立即读一次会假报「两端 phase 不一致」。等对端收敛，最多 10s。
let finB = null;
for (let w = 0; w < 50; w++) {
  finB = await readG(B);
  if (finB.phase === fin.phase) break;
  await sleep(200);
}
console.log('对端: phase=' + finB.phase + ' round=' + finB.round + ' totals=' + JSON.stringify(finB.totals));
assert(jumps > 0, '真人输入能触发跳跃（共 ' + jumps + ' 次）');
assert(eff > 0, '真人输入真的生效（' + eff + '/' + jumps + ' 次有状态变化）');
assert(fin.phase === finB.phase, '两端 phase 一致');
const eA = JSON.parse(await A.consoleErrors()), eB = JSON.parse(await B.consoleErrors());
console.log('JS 报错: 房主 ' + eA.length + ' 对端 ' + eB.length + (eA.length ? ' 例:' + eA[0] : '') + (eB.length ? ' 例:' + eB[0] : ''));
console.log('HOP-REAL 结束');
await A.dispose(); await B.dispose(); cdp.close();
