// 判定跳一跳「偶尔没反应」是不是「操作端本地状态还没跟上（QoS0 延迟）」造成的
// 假设：doCharge 需要 isMine 为真；若我按的是「房主认为该走的人」，而他本地还没收到状态，就会静默跳过。
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
const meA = await A.eval('PN.app.room.me.id'), meB = await B.eval('PN.app.room.me.id');
const P = {}; P[meA] = A; P[meB] = B;
await A.eval('PN.app.send({t:"start", mode:"hop"})');
await sleep(2500);

// 每次操作前，同时记录「房主认为的 pid」与「操作端本地 isMine」与「两端 mode/round」
let skipped = 0, ok = 0, mismatchBefore = 0;
const probe = (p) => p.eval('JSON.stringify({pid:(PN.app.state.g.attempt||{}).pid,isMine:(function(){var g=PN.app.state.g;return !!(g&&g.attempt&&g.attempt.pid===PN.app.room.me.id)})(),charging:!!((PN.app.state.g.attempt||{}).charging),myMode:PN.app.state.mode})').then(JSON.parse);

for (let i = 0; i < 24; i++) {
  const hostSt = JSON.parse(await A.eval('JSON.stringify({pid:(PN.app.state.g.attempt||{}).pid,lives:(PN.app.state.g.attempt||{}).lives,idx:(PN.app.state.g.attempt||{}).idx,phase:PN.app.state.g.phase})'));
  if (hostSt.phase === 'over') break;
  const pg = P[hostSt.pid];
  if (!pg) { await sleep(600); continue; }
  const before = await probe(pg);
  const beforeHost = JSON.parse(await A.eval('JSON.stringify({lives:(PN.app.state.g.attempt||{}).lives,idx:(PN.app.state.g.attempt||{}).idx})'));
  if (!before.isMine) mismatchBefore++;
  const box = await pg.box('canvas.hop-cv');
  await pg.mouse('mouseMoved', box.x, box.y, { button: 'none' });
  await pg.mouse('mousePressed', box.x, box.y, { buttons: 1, button: 'left', clickCount: 1 });
  await sleep(600);
  const mid = await probe(pg);
  await pg.mouse('mouseReleased', box.x, box.y, { buttons: 0, button: 'left', clickCount: 1 });
  await sleep(1300);
  const afterHost = JSON.parse(await A.eval('JSON.stringify({lives:(PN.app.state.g.attempt||{}).lives,idx:(PN.app.state.g.attempt||{}).idx,pid:(PN.app.state.g.attempt||{}).pid})'));
  const moved = afterHost.lives !== beforeHost.lives || afterHost.idx !== beforeHost.idx;
  if (moved) ok++; else skipped++;
  console.log('第' + (i + 1) + '跳: 房主pid=' + hostSt.pid.slice(0, 6) + ' 操作端本地isMine=' + before.isMine + ' -> charging=' + mid.charging + ' | ' + (moved ? '✓生效' : '✗没反应') + (before.isMine ? '' : '   ← 本地还没跟上'));
}
console.log('');
console.log('汇总: 生效=' + ok + ' 没反应=' + skipped + '；其中「按键前本地 isMine 就是 false」的有 ' + mismatchBefore + ' 次');
console.log('→ 若「没反应」几乎都发生在本地 isMine=false 时，则属测试读房主状态、操作端未跟上（测试问题），不是产品缺陷');
console.log('报错 A=' + await A.consoleErrors() + ' B=' + await B.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
