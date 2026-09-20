// 修好后：真点围棋棋盘（把 iframe 内部滚到棋盘可见再点）
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
await A.eval('PN.app.send({t:"start", mode:"go"})');
await sleep(3800);

// 把外层滚到 stage，再让 iframe 内部把棋盘滚进视野
await A.eval('document.querySelector(".sk-stage").scrollIntoView({block:"center"})');
await sleep(600);
await A.eval('(()=>{var d=document.querySelector("iframe").contentDocument; var cv=d.querySelector("canvas"); if(cv) cv.scrollIntoView({block:"center"}); return true;})()');
await sleep(600);

const geo = JSON.parse(await A.eval(`JSON.stringify((function(){
  var f=document.querySelector('iframe'), d=f.contentDocument, cv=d.querySelector('canvas');
  var fr=f.getBoundingClientRect(), cr=cv.getBoundingClientRect();
  return {abs:{x:Math.round(fr.x+cr.left),y:Math.round(fr.y+cr.top),w:Math.round(cr.width),h:Math.round(cr.height)},innerH:innerHeight,g:{size:PN.app.state.g.size,turnIdx:PN.app.state.g.turnIdx,me:PN.app.room.me.id,players:PN.app.state.g.players}};
})())`));
console.log('画布绝对位置: ' + JSON.stringify(geo.abs) + ' 视口高=' + geo.innerH);
console.log('棋盘 n=' + geo.g.size + ' 该我走=' + (geo.g.players[geo.g.turnIdx] === geo.g.me));

// 在画布可见范围内挑几个交叉点真点
const n = geo.g.size || 19;
let log0 = await A.eval('(PN.app.state.g.log||[]).length');
let hits = 0;
for (const [ix, iy] of [[4, 4], [5, 5], [6, 6], [10, 10], [14, 4], [4, 14]]) {
  const margin = geo.abs.w * (n <= 9 ? 0.091 : 0.067);
  const step = (geo.abs.w - 2 * margin) / (n - 1);
  const x = geo.abs.x + margin + step * ix, y = geo.abs.y + margin + step * iy;
  if (y < 10 || y > geo.innerH - 10) { console.log('  (' + ix + ',' + iy + ') y=' + Math.round(y) + ' 超出视口，跳过'); continue; }
  await A.mouse('mouseMoved', x, y, { button: 'none' });
  await A.mouse('mousePressed', x, y, { buttons: 1, button: 'left', clickCount: 1 });
  await A.mouse('mouseReleased', x, y, { buttons: 0, button: 'left', clickCount: 1 });
  await sleep(1100);
  const l = await A.eval('(PN.app.state.g.log||[]).length');
  console.log('  真点交叉点 (' + ix + ',' + iy + ') → 日志 ' + log0 + '→' + l + (l > log0 ? ' ✓' : ''));
  if (l > log0) hits++;
  log0 = l;
  if (hits >= 2) break;
}
const fin = await A.eval('JSON.stringify({log:(PN.app.state.g.log||[]).length,turnIdx:PN.app.state.g.turnIdx})');
const finB = await B.eval('JSON.stringify({log:(PN.app.state.g.log||[]).length})');
console.log('最终 房主=' + fin + ' 对端=' + finB);
console.log('报错: ' + await A.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
