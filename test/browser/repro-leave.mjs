// 阶段1 复现：非房主点「退出房间」后，房主端到底把他当「离开」还是「掉线」(dropped)？
import { connect, createRoom, joinRoom, waitPlayers, startGame, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2);
const H = (await A.eval('PN.app.isHost()')) ? A : B;
const O = H === A ? B : A;
const roster = async () => await H.eval('JSON.stringify(PN.app.state.players.map(function(p){return p.name+":"+(p.online?"在线":"离线");}))');
const modeOf = async () => await H.eval('String(PN.app.state.mode)');

await startGame(H, 'memory');
await H.waitFor('PN.app.state.mode === "memory" && PN.app.state.g && PN.app.state.g.phase === "play"', '进入对局', 30000);
console.log('进入对局 mode=' + await modeOf() + ' 名册=' + await roster());

// 非房主点「退出房间」（弹窗自动确认）
const clicked = await O.eval('(function(){ var bs=document.querySelectorAll("button"); for (var i=0;i<bs.length;i++){ if (bs[i].textContent.indexOf("退出房间")>=0){ bs[i].click(); return "clicked"; } } return "notfound"; })()');
console.log('非房主按钮=' + clicked);
await sleep(200);

// 房主端在 8 秒内采样：被 clean leave 就该立刻消失；若是掉线则会以「离线」留在名册里
for (let i = 1; i <= 8; i++) {
  await sleep(1000);
  console.log('T+' + i + 's 名册=' + await roster() + ' mode=' + await modeOf() + ' 屏幕=' + await H.eval('PN.app.state.screen || (PN.app.state.mode||"")'));
}
console.log('房主错误=' + await H.consoleErrors());
await H.dispose(); await cdp.close();
