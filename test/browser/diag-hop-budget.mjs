// 量一局跳一跳真机打到终局需要多少「真人按」步数（判断压力测试 60 步够不够）
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
const meA = await A.eval('PN.app.room.me.id'), meB = await B.eval('PN.app.room.me.id');
const P = {}; P[meA] = A; P[meB] = B;
const st = (p) => p.eval('JSON.stringify({phase:PN.app.state.g.phase,round:PN.app.state.g.round,pid:(PN.app.state.g.attempt||{}).pid,idx:(PN.app.state.g.attempt||{}).idx,lives:(PN.app.state.g.attempt||{}).lives,ended:!!(PN.app.state.g.attempt||{}).ended})').then(JSON.parse);

for (let run = 0; run < 3; run++) {
  await A.eval('PN.app.send({t:"lobby"})'); await sleep(900);
  await A.eval('PN.app.send({t:"start", mode:"hop"})'); await sleep(2500);
  const minePage = async (tries = 5) => {
    for (let t = 0; t < tries; t++) {
      for (const pid of Object.keys(P)) {
        const m = await P[pid].eval('(function(){var g=PN.app.state.g;return !!(g&&g.attempt&&g.attempt.pid===PN.app.room.me.id&&!g.attempt.ended&&g.attempt.lives>0&&g.phase==="play")})()');
        if (m) return P[pid];
      }
      await sleep(200);
    }
    return null;
  };
  let steps = 0, moves = 0, noMine = 0;
  while (steps < 200) {
    const cur = await st(A);
    if (cur.phase === 'over') break;
    const p = await minePage(3);
    if (!p) { noMine++; await sleep(300); continue; }
    steps++;
    const b = await p.box('canvas.hop-cv');
    await p.mouse('mouseMoved', b.x, b.y, { button: 'none' });
    await p.mouse('mousePressed', b.x, b.y, { buttons: 1, button: 'left', clickCount: 1 });
    await sleep(650);
    await p.mouse('mouseReleased', b.x, b.y, { buttons: 0, button: 'left', clickCount: 1 });
    await sleep(1250);
    moves++;
  }
  const f = await st(A);
  console.log('第' + (run + 1) + '局: 有效按键=' + moves + ' 空转(等不到该走)=' + noMine + ' → phase=' + f.phase + ' round=' + f.round);
}
console.log('报错 A=' + await A.consoleErrors() + ' B=' + await B.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
