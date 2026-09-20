// 量化：房主进入 over 后，对端要多久才看到 over（判定 "A=over B=play" 是不是纯传播延迟）
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const lags = [];
for (let run = 1; run <= 5; run++) {
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
    if (await A.eval('PN.app.state.g.phase') === 'over') break;
    const p = await minePage(3);
    if (!p) { await sleep(300); continue; }
    const b = await p.box('canvas.hop-cv');
    await p.mouse('mouseMoved', b.x, b.y, { button: 'none' });
    await p.mouse('mousePressed', b.x, b.y, { buttons: 1, button: 'left', clickCount: 1 });
    await sleep(650);
    await p.mouse('mouseReleased', b.x, b.y, { buttons: 0, button: 'left', clickCount: 1 });
    await sleep(1250);
  }
  // 精确测：从「A 已 over」到「B 也 over」的耗时
  const t0 = Date.now();
  let lag = -1;
  for (let k = 0; k < 60; k++) {
    if (await B.eval('PN.app.state.g.phase') === 'over') { lag = Date.now() - t0; break; }
    await sleep(100);
  }
  lags.push(lag);
  console.log('第' + run + '局: A over 后，B 追上 over 用了 ' + (lag < 0 ? '>6000ms ✗' : lag + 'ms'));
  await A.dispose(); await B.dispose();
}
console.log('样本: ' + JSON.stringify(lags) + '  最大=' + Math.max.apply(null, lags.map(function (x) { return x < 0 ? 99999 : x; })) + 'ms');
cdp.close();
