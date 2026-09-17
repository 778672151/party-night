// 诊断：心有灵犀在真浏览器里为何卡在第 1 题
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
await A.eval('PN.app.send({t:"start", mode:"codraw"})');
await sleep(2000);
const Rd = () => A.eval('JSON.stringify({phase:PN.app.state.g.phase,round:PN.app.state.g.round,total:PN.app.state.g.total,ready:PN.app.state.g.ready,rated:PN.app.state.g.rated,matched:PN.app.state.g.matched})').then(JSON.parse);
console.log('开局:', JSON.stringify(await Rd()));
for (let r = 0; r < 3; r++) {
  // draw 阶段：两端各自画一笔 + ready
  await A.touchDrag('.dg-stage canvas', [0.2, 0.3], [0.7, 0.7], 6).catch(()=>{});
  await B.touchDrag('.dg-stage canvas', [0.2, 0.5], [0.7, 0.5], 6).catch(()=>{});
  await A.eval('PN.app.send({t:"ready"})'); await sleep(300);
  await B.eval('PN.app.send({t:"ready"})'); await sleep(1200);
  console.log('ready 后:', JSON.stringify(await Rd()));
  // reveal 阶段：两端 rate
  await A.eval('PN.app.send({t:"rate", v:1})'); await sleep(300);
  await B.eval('PN.app.send({t:"rate", v:1})'); await sleep(1500);
  console.log('rate 后:', JSON.stringify(await Rd()));
  // 等 REVEAL_MS=9s 进下一题
  for (let w = 0; w < 24; w++) { await sleep(500); const s = await Rd(); if (s.phase !== 'reveal' || s.round !== r + 1) break; }
  console.log('等 9 秒后:', JSON.stringify(await Rd()));
}
await A.dispose(); await B.dispose(); cdp.close();
