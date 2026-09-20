// 追查：跳一跳终局时「房主 over / 对端 play」的两端不一致
// 假设：房主 emit 了 over，但对端没收到（QoS0 丢包），或对端状态更新没触发重建。
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
let reproduced = 0;
for (let run = 1; run <= 6; run++) {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2); await waitPlayers(B, 2);
  const meA = await A.eval('PN.app.room.me.id'), meB = await B.eval('PN.app.room.me.id');
  const P = {}; P[meA] = A; P[meB] = B;
  await A.eval('PN.app.send({t:"start", mode:"hop"})');
  await sleep(2500);
  const minePage = async (tries = 4) => {
    for (let t = 0; t < tries; t++) {
      for (const pid of Object.keys(P)) {
        const m = await P[pid].eval('(function(){var g=PN.app.state.g;return !!(g&&g.attempt&&g.attempt.pid===PN.app.room.me.id&&!g.attempt.ended&&g.attempt.lives>0&&g.phase==="play")})()');
        if (m) return P[pid];
      }
      await sleep(200);
    }
    return null;
  };
  for (let i = 0; i < 90; i++) {
    const ph = await A.eval('PN.app.state.g.phase');
    if (ph === 'over') break;
    const p = await minePage(3);
    if (!p) { await sleep(300); continue; }
    const b = await p.box('canvas.hop-cv');
    await p.mouse('mouseMoved', b.x, b.y, { button: 'none' });
    await p.mouse('mousePressed', b.x, b.y, { buttons: 1, button: 'left', clickCount: 1 });
    await sleep(650);
    await p.mouse('mouseReleased', b.x, b.y, { buttons: 0, button: 'left', clickCount: 1 });
    await sleep(1250);
  }
  // 房主 over 后，给对端最多 8 秒追上
  let bPhase = await B.eval('PN.app.state.g.phase');
  let waited = 0;
  for (let k = 0; k < 16 && bPhase !== 'over'; k++) { await sleep(500); waited += 500; bPhase = await B.eval('PN.app.state.g.phase'); }
  const aPhase = await A.eval('PN.app.state.g.phase');
  const mismatch = (aPhase === 'over') !== (bPhase === 'over');
  if (mismatch) reproduced++;
  console.log('第' + run + '局: A=' + aPhase + ' B=' + bPhase + (mismatch ? '  ✗ 不一致（对端等了 ' + waited + 'ms）' : '  ✓ 一致') +
    (mismatch ? '  A.round=' + await A.eval('PN.app.state.g.round') + ' B.round=' + await B.eval('PN.app.state.g.round') : ''));
  // 若不一致，看看对端为什么没收到
  if (mismatch) {
    const dbg = await B.eval('JSON.stringify({mode:PN.app.state.mode,phase:PN.app.state.g.phase,round:PN.app.state.g.round,attempt:PN.app.state.g.attempt,hostId:PN.app.state.hostId,myHost:PN.app.room.isHost,ret:!!PN.app.room.lastState,retPhase:PN.app.room.lastState&&PN.app.room.lastState.g&&PN.app.room.lastState.g.phase})');
    console.log('    对端详情: ' + dbg);
    const dbgA = await A.eval('JSON.stringify({phase:PN.app.state.g.phase,round:PN.app.state.g.round,attempt:PN.app.state.g.attempt,winner:PN.app.state.g.winner,totals:PN.app.state.g.totals,sv:PN.app.state.sv})');
    console.log('    房主详情: ' + dbgA);
  }
  await A.dispose(); await B.dispose();
}
console.log('共复现 ' + reproduced + '/6 次不一致');
cdp.close();
