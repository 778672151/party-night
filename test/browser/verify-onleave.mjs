// 阶段4 F1 验证：对方离开后，cube/go 是否与其余游戏一致地收尾 + 提示
import { connect, createRoom, joinRoom, waitPlayers, startGame, sleep, assert } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
let B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2);
const H = (await A.eval('PN.app.isHost()')) ? A : B;
let O = H === A ? B : A;
for (const mode of ['cube', 'go']) {
  await startGame(H, mode);
  await H.waitFor('PN.app.state.mode === "' + mode + '" && PN.app.state.g && PN.app.state.g.phase === "play"', mode + ' 开局', 30000);
  await O.eval('window.confirm=function(){return true;}; 1');
  await O.eval('(function(){ var bs=document.querySelectorAll("button"); for (var i=0;i<bs.length;i++){ if (bs[i].textContent.indexOf("退出房间")>=0){ bs[i].click(); return 1; } } return 0; })()').catch(() => {});
  await H.waitFor('PN.app.state.g.phase === "over"', mode + ' 对方离开后收尾', 25000);
  const txt = await H.eval('(document.body.innerText||"")');
  assert(txt.indexOf('对方离开了') >= 0, mode + '：房主端出现「对方离开了」提示');
  console.log('  ✓ ' + mode + '：对方离开后房主端 phase=over 且提示可见');
  // 回到大厅，准备下一款
  await H.eval('(function(){ var bs=document.querySelectorAll("button"); for (var i=0;i<bs.length;i++){ if (bs[i].textContent.indexOf("回大厅")>=0){ bs[i].click(); return 1; } } return 0; })()');
  await H.waitFor('PN.app.state.mode === "lobby"', mode + ' 回大厅', 20000);
  await O.dispose();
  O = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(H, 2);
}
assert(await H.consoleErrors() === '[]', '房主页无报错：' + await H.consoleErrors());
console.log('ONLEAVE 验证通过');
await H.dispose(); if (O) await O.dispose(); await cdp.close();
