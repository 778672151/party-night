// 阶段1 验收：连续「进房 → 开局 → 返回大厅 → 再进 → 退出房间 → 返回大厅」多轮
// 断言：状态一致、无残留（名册/URL/模式）、无重复回调（名册无重复项）、无报错
import { connect, createRoom, joinRoom, waitPlayers, startGame, sleep, assert } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
let B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2);
const H = (await A.eval('PN.app.isHost()')) ? A : B;
let O = H === A ? B : A;
const snap = async (pg) => JSON.parse(await pg.eval('JSON.stringify({mode:PN.app.state.mode,players:PN.app.state.players.map(function(p){return p.name+(p.online?"+":"-");}),hash:location.hash})'));

let ok = 0;
for (let round = 1; round <= 3; round++) {
  await startGame(H, 'memory');
  await H.waitFor('PN.app.state.mode === "memory" && PN.app.state.g && PN.app.state.g.phase === "play"', '第' + round + '轮开局', 30000);
  assert(true, '第' + round + '轮：两人进入对局（' + JSON.stringify((await snap(H)).players) + '）');
  ok++;

  // 非房主点「退出房间」（自动确认弹窗）→ 该页整页刷新回落地面
  await O.eval('window.confirm=function(){return true;}; 1');
  await O.eval('(function(){ var bs=document.querySelectorAll("button"); for (var i=0;i<bs.length;i++){ if (bs[i].textContent.indexOf("退出房间")>=0){ bs[i].click(); return 1; } } return 0; })()').catch(() => {});
  await sleep(2500);
  const hs = await snap(H);
  assert(hs.players.length === 1 && hs.players.indexOf('阿泽+') < 0 && hs.players.indexOf('阿泽-') < 0, '第' + round + '轮：对方离开后房主端名册干净（' + JSON.stringify(hs.players) + '，无重复项/无离线残留）');
  ok++;

  // 房主「回大厅」（结算页或顶栏都走 send({t:'lobby'})）
  const back = await H.eval('(function(){ var bs=document.querySelectorAll("button"); for (var i=0;i<bs.length;i++){ if (bs[i].textContent.indexOf("回大厅")>=0){ bs[i].click(); return "clicked"; } } return "notfound"; })()');
  await H.waitFor('PN.app.state.mode === "lobby"', '第' + round + '轮回大厅', 20000);
  const ls = await snap(H);
  assert(ls.mode === 'lobby', '第' + round + '轮：房主回到大厅（mode=' + ls.mode + '，按钮=' + back + '）');
  ok++;

  // 对方重新进房，进入下一轮
  await O.dispose();
  O = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(H, 2);
  ok++;
}
const errs = await H.consoleErrors();
assert(errs === '[]', '全程房主页无 JS 报错：' + errs);
console.log('CYCLE 完成 3 轮，检查点 ' + ok + ' 项，房主页 URL hash=' + (await snap(H)).hash + '，名册=' + JSON.stringify((await snap(H)).players));
await H.dispose(); if (O && O.dispose) await O.dispose(); await cdp.close();
