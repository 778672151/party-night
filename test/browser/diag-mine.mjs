// 诊断：扫雷在真浏览器里为何只翻开 4 格就停住
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
await A.eval('PN.app.send({t:"start", mode:"mine"})');
await sleep(1500);
const pids = {}; pids[await A.eval('PN.app.room.me.id')] = 'A'; pids[await B.eval('PN.app.room.me.id')] = 'B';
for (let k = 0; k < 8; k++) {
  const st = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,turnIdx:PN.app.state.g.turnIdx,players:PN.app.state.g.players,lives:PN.app.state.g.lives,revealed:PN.app.state.g.revealed})'));
  if (st.phase === 'over') { console.log('已终局'); break; }
  const turnPid = st.players[st.turnIdx];
  const who = pids[turnPid];
  const page = who === 'A' ? A : B;
  const idx = st.revealed.indexOf(false);
  const before = st.revealed.filter(Boolean).length;
  await page.eval('PN.app.send({t:"open", i:' + idx + '})');
  await sleep(500);
  const st2 = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,turnIdx:PN.app.state.g.turnIdx,lives:PN.app.state.g.lives,revealed:PN.app.state.g.revealed})'));
  const after = st2.revealed.filter(Boolean).length;
  console.log('第' + (k+1) + '次: 轮到 ' + who + '（' + turnPid.slice(0,6) + '） 开 i=' + idx + ' → 翻开 ' + before + '→' + after + ' turnIdx ' + st.turnIdx + '→' + st2.turnIdx + ' lives=' + st2.lives + ' phase=' + st2.phase);
  // 本地端认为自己该走吗？
  const local = await A.eval('JSON.stringify({myTurn: (function(){const g=PN.app.state.g; return g.players[g.turnIdx]===PN.app.room.me.id;})()})');
  const localB = await B.eval('JSON.stringify({myTurn: (function(){const g=PN.app.state.g; return g.players[g.turnIdx]===PN.app.room.me.id;})()})');
  console.log('   A本地轮次=' + local + '  B本地轮次=' + localB);
}
console.log('最终: ' + await A.eval('JSON.stringify({phase:PN.app.state.g.phase,revealed:PN.app.state.g.revealed.filter(Boolean).length,lives:PN.app.state.g.lives})'));
await A.dispose(); await B.dispose(); cdp.close();
