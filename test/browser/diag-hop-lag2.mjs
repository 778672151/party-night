// 精确判定：跳一跳「没反应」时，按键瞬间房主侧 attempt 处于什么状态
//（ended=true 表示正处在 1.4s 换人窗口 —— 此时按不动是正确行为；weak 表示力度太小落回原地）
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
const meA = await A.eval('PN.app.room.me.id'), meB = await B.eval('PN.app.room.me.id');
const P = {}; P[meA] = A; P[meB] = B;
await A.eval('PN.app.send({t:"start", mode:"hop"})');
await sleep(2500);

let ok = 0, skip = 0;
const rows = [];
for (let i = 0; i < 26; i++) {
  const h = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,pid:(PN.app.state.g.attempt||{}).pid,ended:!!((PN.app.state.g.attempt||{}).ended),lives:(PN.app.state.g.attempt||{}).lives,idx:(PN.app.state.g.attempt||{}).idx,score:(PN.app.state.g.attempt||{}).score,fly:!!((PN.app.state.g.attempt||{}).fly),round:PN.app.state.g.round})'));
  if (h.phase === 'over') break;
  if (!h.pid) { await sleep(500); continue; }
  const pg = P[h.pid]; if (!pg) { await sleep(500); continue; }
  // 只在「能动」的时候按（ended=false 且 lives>0），这才是真人能操作的状态
  if (h.ended || h.lives <= 0) { await sleep(400); continue; }
  const box = await pg.box('canvas.hop-cv');
  await pg.mouse('mouseMoved', box.x, box.y, { button: 'none' });
  await pg.mouse('mousePressed', box.x, box.y, { buttons: 1, button: 'left', clickCount: 1 });
  await sleep(600);
  await pg.mouse('mouseReleased', box.x, box.y, { buttons: 0, button: 'left', clickCount: 1 });
  await sleep(1400);
  const a = JSON.parse(await A.eval('JSON.stringify({lives:(PN.app.state.g.attempt||{}).lives,idx:(PN.app.state.g.attempt||{}).idx,score:(PN.app.state.g.attempt||{}).score,last:(PN.app.state.g.attempt||{}).last,ended:!!((PN.app.state.g.attempt||{}).ended)})'));
  const moved = a.lives !== h.lives || a.idx !== h.idx || a.score !== h.score;
  if (moved) ok++; else skip++;
  rows.push({ i: i + 1, moved, before: { ended: h.ended, fly: h.fly, idx: h.idx, lives: h.lives }, after: { idx: a.idx, lives: a.lives, score: a.score, last: a.last, ended: a.ended } });
}
console.log('仅在 ended=false 时按：生效=' + ok + ' 没反应=' + skip);
rows.filter(function (r) { return !r.moved; }).forEach(function (r) {
  console.log('  没反应: 按前 ended=' + r.before.ended + ' fly=' + r.before.fly + ' idx=' + r.before.idx + ' lives=' + r.before.lives + ' → 按后 idx=' + r.after.idx + ' lives=' + r.after.lives + ' score=' + r.after.score + ' last=' + r.after.last + ' ended=' + r.after.ended);
});
console.log('报错 A=' + await A.consoleErrors() + ' B=' + await B.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
