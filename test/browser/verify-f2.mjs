// 阶段4 F2 验证：drawgame（心有灵犀）里非画家离开后，是否与其余游戏一致地收尾
import { connect, createRoom, joinRoom, waitPlayers, startGame, sleep, assert } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2);
const H = (await A.eval('PN.app.isHost()')) ? A : B;
const O = H === A ? B : A;
await startGame(H, 'drawgame');
await H.waitFor('PN.app.state.mode === "drawgame" && PN.app.state.g && PN.app.state.g.cur', 'drawgame 开局', 30000);
const painterId = await H.eval('PN.app.state.g.cur.painter');
const idA = await A.eval('PN.app.me().id');
// 让「非画家」那端主动退出
const leaver = (painterId === idA) ? B : A;
const keeper = (painterId === idA) ? A : B;
console.log('画家=' + (painterId === idA ? '小桃' : '阿泽') + ' 退出者=' + (painterId === idA ? '阿泽' : '小桃'));
await leaver.eval('window.confirm=function(){return true;}; 1');
const clickRes = await leaver.eval('(function(){ var bs=document.querySelectorAll("button"); for (var i=0;i<bs.length;i++){ if (bs[i].textContent.indexOf("退出房间")>=0){ bs[i].click(); return "clicked"; } } return "notfound:"+bs.length; })()').catch((e) => 'evalerr:' + e.message.slice(0,40));
console.log('点击结果=' + clickRes);
await sleep(1500);
console.log('房主端 名册=' + await keeper.eval('JSON.stringify(PN.app.state.players.map(function(p){return p.name+(p.online?"+":"-")}))') + ' cur相位=' + await keeper.eval('(PN.app.state.g&&PN.app.state.g.cur&&PN.app.state.g.cur.phase)||"-"'));
try {
  await keeper.waitFor('PN.app.state.g && PN.app.state.g.phase === "over"', '对方离开后收尾', 25000);
  assert(true, 'F2：非画家离开后 drawgame 收尾（g.phase=over）');
} catch (e) {
  assert(false, 'F2：非画家离开后 drawgame 未收尾 —— ' + e.message);
}
const toasts = await keeper.eval('JSON.stringify([].slice.call(document.querySelectorAll(".toast")).map(function(t){return t.textContent;}))');
console.log('  toasts=' + toasts);
assert(toasts.indexOf('对方离开了') >= 0, 'F2：提示「对方离开了」可见');
console.log('错误=' + await keeper.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
