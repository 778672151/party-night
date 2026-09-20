// 诊断：① 围棋真点棋盘为何无反应 ② 你画我猜「词卡 0 张」
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);

/* ---------- 围棋 ---------- */
console.log('########## 围棋 ##########');
await A.eval('PN.app.send({t:"start", mode:"go"})');
await sleep(3500);
console.log('结构: ' + await A.eval(`JSON.stringify((function(){
  var f=document.querySelector('iframe');
  var out={iframe:!!f, cv:document.querySelectorAll('canvas').length, btns:[].slice.call(document.querySelectorAll('button')).map(function(b){return b.textContent.trim()}).slice(0,10)};
  if(f){ var r=f.getBoundingClientRect(); out.frameRect={x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; }
  out.g={players:PN.app.state.g.players,turnIdx:PN.app.state.g.turnIdx,turn:PN.app.state.g.turn,log:(PN.app.state.g.log||[]).length,phase:PN.app.state.g.phase};
  return out;
})())`));
// iframe 内结构
console.log('iframe 内部: ' + await A.eval(`JSON.stringify((function(){
  var f=document.querySelector('iframe'); if(!f) return null;
  try{ var d=f.contentDocument; if(!d) return {cross:true};
    return {canvases:[].slice.call(d.querySelectorAll('canvas')).map(function(c){var r=c.getBoundingClientRect();return {cls:c.className,w:Math.round(r.width),h:Math.round(r.height),l:Math.round(r.left),t:Math.round(r.top)}}),
            divs:d.querySelectorAll('div').length, title:(d.title||'')};
  }catch(e){ return {err:e.message}; }
})())`));
// 真点 iframe 中央
const fr = JSON.parse(await A.eval('JSON.stringify((function(){var f=document.querySelector("iframe");var r=f.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})())'));
const pts = [[0.5,0.45],[0.45,0.5],[0.55,0.5],[0.5,0.55],[0.35,0.35]];
for (const [fx,fy] of pts) {
  const x = fr.x + fr.w*fx, y = fr.y + fr.h*fy;
  await A.mouse('mouseMoved', x, y, { button: 'none' });
  await A.mouse('mousePressed', x, y, { buttons: 1, button: 'left', clickCount: 1 });
  await A.mouse('mouseReleased', x, y, { buttons: 0, button: 'left', clickCount: 1 });
  await sleep(1100);
  const log = await A.eval('(PN.app.state.g.log||[]).length');
  console.log('  真点 (' + fx + ',' + fy + ') → 日志=' + log);
}
// 对照：屏幕上的「停一手」按钮
console.log('屏幕按钮: ' + await A.eval('JSON.stringify([].slice.call(document.querySelectorAll("button")).map(function(b){return b.textContent.trim()}))'));

/* ---------- 你画我猜 ---------- */
console.log('########## 你画我猜 ##########');
await A.eval('PN.app.send({t:"lobby"})'); await sleep(1200);
await A.eval('PN.app.send({t:"start", mode:"drawgame"})');
await sleep(3000);
console.log('本轮: ' + await A.eval(`JSON.stringify((function(){
  var g=PN.app.state.g||{}; var cur=g.cur||{};
  return {sp:PN.app.state.phase,curPhase:cur.phase,painter:cur.painter,me:PN.app.room.me.id,isPainter:cur.painter===PN.app.room.me.id,
          words:[].slice.call(document.querySelectorAll('[data-word]')).map(function(b){return b.textContent.trim()}),
          myWord:(document.querySelector('.dg-hint .w')||{}).textContent||null,
          secret:!!(PN.app.secrets&&PN.app.secrets.drawgame)};
})())`));
console.log('对端本轮: ' + await B.eval(`JSON.stringify((function(){var g=PN.app.state.g||{};var cur=g.cur||{};return {curPhase:cur.phase,painter:cur.painter,isPainter:cur.painter===PN.app.room.me.id,words:document.querySelectorAll('[data-word]').length}})())`));
console.log('报错 A=' + await A.consoleErrors() + ' B=' + await B.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
