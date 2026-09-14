// 查清 F1 的提示可见性：读 .toast 元素本身，并确认 host.toast -> ui.toast 链路
import { connect, createRoom, joinRoom, waitPlayers, startGame, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2);
const H = (await A.eval('PN.app.isHost()')) ? A : B;
const O = H === A ? B : A;
console.log('host.toast 类型=' + await H.eval('typeof PN.app.host.toast') + ' ui.toast 类型=' + await H.eval('typeof PN.app.toast'));
await startGame(H, 'cube');
await H.waitFor('PN.app.state.mode === "cube" && PN.app.state.g && PN.app.state.g.phase === "play"', 'cube 开局', 30000);
await O.eval('window.confirm=function(){return true;}; 1');
await O.eval('(function(){ var bs=document.querySelectorAll("button"); for (var i=0;i<bs.length;i++){ if (bs[i].textContent.indexOf("退出房间")>=0){ bs[i].click(); return 1; } } return 0; })()').catch(() => {});
for (let i = 1; i <= 5; i++) {
  await sleep(700);
  const toasts = await H.eval('JSON.stringify([].slice.call(document.querySelectorAll(".toast")).map(function(t){return t.textContent;}))');
  const phase = await H.eval('String(PN.app.state.g && PN.app.state.g.phase)');
  console.log('T+' + (i * 0.7).toFixed(1) + 's phase=' + phase + ' toasts=' + toasts);
}
console.log('错误=' + await H.consoleErrors());
await H.dispose(); await cdp.close();
