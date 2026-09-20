// 判定围棋：真点棋盘是否**永远**无效（对比「停一手」按钮）
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
await A.eval('PN.app.send({t:"start", mode:"go"})');
await sleep(3800);
const log = () => A.eval('(PN.app.state.g.log||[]).length');
const who = () => A.eval('PN.app.state.g.players[PN.app.state.g.turnIdx]===PN.app.room.me.id');
console.log('它是我该走吗: ' + await who());

// iframe 内 canvas 的真实位置
const c = await A.eval(`JSON.stringify((function(){var f=document.querySelector('iframe');var d=f.contentDocument;var cv=d.querySelector('canvas');var r=cv.getBoundingClientRect();var fr=f.getBoundingClientRect();
  return {canvasLocal:{l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)},frame:{x:Math.round(fr.x),y:Math.round(fr.y)}};})())`);
console.log('canvas: ' + c);
const cc = JSON.parse(c);
// 换算到主页面坐标 = iframe 位置 + canvas 在 iframe 内的位置
const pts = [];
for (let i = 3; i <= 7; i++) for (let j = 3; j <= 5; j++) pts.push([cc.frame.x + cc.canvasLocal.l + cc.canvasLocal.w * i / 19, cc.frame.y + cc.canvasLocal.t + cc.canvasLocal.h * j / 19]);
let clicked = 0;
for (const [x, y] of pts.slice(0, 10)) {
  const before = await log();
  await A.mouse('mouseMoved', x, y, { button: 'none' });
  await A.mouse('mousePressed', x, y, { buttons: 1, button: 'left', clickCount: 1 });
  await A.mouse('mouseReleased', x, y, { buttons: 0, button: 'left', clickCount: 1 });
  await sleep(700);
  const after = await log();
  clicked++;
  if (after > before) { console.log('  第' + clicked + '次点到有效点 → 日志 ' + before + '→' + after + ' ✓'); }
}
console.log('真点棋盘 ' + clicked + ' 次，日志=' + await log() + '  → ' + (await log() > 0 ? '有效' : '✗ 完全无效'));

// 对照：真点「停一手」
const pb = await A.box('[data-go="pass"]');
console.log('停一手按钮: ' + JSON.stringify(pb) + ' 禁用=' + await A.eval('(document.querySelector("[data-go=pass]")||{}).disabled'));
if (pb) {
  const before = await log();
  await A.mouse('mouseMoved', pb.x, pb.y, { button: 'none' });
  await A.mouse('mousePressed', pb.x, pb.y, { buttons: 1, button: 'left', clickCount: 1 });
  await A.mouse('mouseReleased', pb.x, pb.y, { buttons: 0, button: 'left', clickCount: 1 });
  await sleep(1500);
  const after = await log();
  console.log('真点「停一手」→ 日志 ' + before + '→' + after + '  pass 生效=' + (after > before));
}
// 屏幕 debug 信息
console.log('屏幕内部状态: ' + await A.eval('JSON.stringify(PN.screens.go.debug ? PN.screens.go.debug() : null)'));
console.log('报错: ' + await A.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
