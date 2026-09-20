// 严格验证围棋：双方各用真鼠标在棋盘上落子；并验证「不是你的回合点了不算」
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
const meA = await A.eval('PN.app.room.me.id'), meB = await B.eval('PN.app.room.me.id');
const P = {}; P[meA] = A; P[meB] = B;
await A.eval('PN.app.send({t:"start", mode:"go"})');
await sleep(3800);

const st = () => A.eval('JSON.stringify({log:(PN.app.state.g.log||[]).length,turnIdx:PN.app.state.g.turnIdx,players:PN.app.state.g.players,size:PN.app.state.g.size,phase:PN.app.state.g.phase})').then(JSON.parse);

// 准备：把两端 iframe 都滚到棋盘可见
const prep = async (p) => {
  await p.eval('document.querySelector(".sk-stage").scrollIntoView({block:"center"})');
  await sleep(400);
  await p.eval('(()=>{var d=document.querySelector("iframe").contentDocument;var cv=d.querySelector("canvas");if(cv)cv.scrollIntoView({block:"center"});return true;})()');
  await sleep(400);
};
await prep(A); await prep(B);

const geoOf = (p) => p.eval('JSON.stringify((function(){var f=document.querySelector("iframe"),d=f.contentDocument,cv=d.querySelector("canvas");var fr=f.getBoundingClientRect(),cr=cv.getBoundingClientRect();return {x:Math.round(fr.x+cr.left),y:Math.round(fr.y+cr.top),w:Math.round(cr.width),h:Math.round(cr.height),ih:innerHeight};})())').then(JSON.parse);
const clickPoint = async (p, ix, iy, n) => {
  const ge = await geoOf(p);
  const margin = ge.w * (n <= 9 ? 0.091 : 0.067);
  const step = (ge.w - 2 * margin) / (n - 1);
  const x = ge.x + margin + step * ix, y = ge.y + margin + step * iy;
  if (y < 5 || y > ge.ih - 5) return 'out-of-view';
  await p.mouse('mouseMoved', x, y, { button: 'none' });
  await p.mouse('mousePressed', x, y, { buttons: 1, button: 'left', clickCount: 1 });
  await p.mouse('mouseReleased', x, y, { buttons: 0, button: 'left', clickCount: 1 });
  return 'clicked';
};

let s = await st();
console.log('开局: 日志=' + s.log + ' 轮次idx=' + s.turnIdx + ' n=' + s.size);
chk: {
  // 1. 该走的一方真点 → 应生效
  const p1 = P[s.players[s.turnIdx]];
  const who1 = s.players[s.turnIdx] === meA ? 'A/小桃' : 'B/阿泽';
  let r = await clickPoint(p1, 4, 4, s.size);
  await sleep(1500);
  let s1 = await st();
  console.log('1) ' + who1 + ' 真点(4,4) [' + r + '] → 日志 ' + s.log + '→' + s1.log + ' 轮次=' + s.turnIdx + '→' + s1.turnIdx + (s1.log > s.log ? ' ✓ 生效' : ' ✗ 无效'));

  // 2. 不该走的一方再真点 → 应无效（并且不卡死）
  const p1b = P[s.players[s1.turnIdx]];
  const whoWrong = s1.players[s1.turnIdx] === meA ? 'A/小桃' : 'B/阿泽';
  const pOther = p1b === A ? B : A;
  const wrongName = pOther === A ? 'A/小桃' : 'B/阿泽';
  let r2 = await clickPoint(pOther, 6, 6, s1.size);
  await sleep(1400);
  let s2 = await st();
  console.log('2) 不该走的 ' + wrongName + ' 真点(6,6) [' + r2 + '] → 日志 ' + s1.log + '→' + s2.log + (s2.log === s1.log ? ' ✓ 被正确拒绝' : ' ✗ 竟然生效'));

  // 3. 该走的一方继续真点 → 应生效（证明没卡死）
  let r3 = await clickPoint(p1b, 6, 6, s2.size);
  await sleep(1500);
  const s3 = await st();
  console.log('3) 该走的 ' + whoWrong + ' 真点(6,6) [' + r3 + '] → 日志 ' + s2.log + '→' + s3.log + (s3.log > s2.log ? ' ✓ 生效（未卡死）' : ' ✗ 无效'));

  // 4. 对端是否看到同样的日志
  const sb = await B.eval('(PN.app.state.g.log||[]).length');
  console.log('4) 两端日志一致: 房主=' + s3.log + ' 对端=' + sb + (sb === s3.log ? ' ✓' : ' ✗'));
}
console.log('报错 A=' + await A.consoleErrors() + ' B=' + await B.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
