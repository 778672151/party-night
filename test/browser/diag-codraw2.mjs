// 用 playall 里那套循环驱动 codraw，逐轮打印状态，看卡在哪里
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
await A.eval('PN.app.send({t:"start", mode:"codraw"})');
await sleep(1500);
const rounds = Number(await A.eval('PN.app.state.g.rounds'));
console.log('rounds=' + rounds);
const readCd = () => A.eval('JSON.stringify({phase:PN.app.state.g.phase,round:PN.app.state.g.round,ready:(PN.app.state.g.ready||{}),rated:(PN.app.state.g.rated||{})})').then(JSON.parse);
let guard = 0, printed = 0;
while (guard++ < (rounds + 2) * 40) {
  const st = await readCd();
  if (printed < 24) { console.log('#' + guard + ' phase=' + st.phase + ' round=' + st.round + ' ready=' + JSON.stringify(st.ready) + ' rated=' + JSON.stringify(st.rated)); printed++; }
  if (st.phase === 'over') { console.log('>>> 终局 at #' + guard); break; }
  if (st.phase === 'draw') {
    if (guard % 6 === 1) { for (const p of [A, B]) { try { await p.touchDrag('.dg-stage canvas', [0.2, 0.3], [0.7, 0.7], 8); } catch (e) {} } }
    const ra = await A.eval('PN.app.send({t:"ready"})');
    const rb = await B.eval('PN.app.send({t:"ready"})');
    if (printed <= 24) console.log('   发送 ready');
  } else if (st.phase === 'reveal') {
    await A.eval('PN.app.send({t:"rate", v:1})');
    await B.eval('PN.app.send({t:"rate", v:1})');
  }
  await sleep(500);
}
console.log('最终: ' + await A.eval('JSON.stringify({phase:PN.app.state.g.phase,round:PN.app.state.g.round,matched:PN.app.state.g.matched})'));
await A.dispose(); await B.dispose(); cdp.close();
