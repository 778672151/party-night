// 关键判定：真人看着自己界面（显示"轮到你"）时按下，会不会丢？还是会显示卡住？
// 场景：故意在「房主已换人、但操作端界面还没跟上」的瞬间按（真人手快时就是这个窗口）。
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
const meA = await A.eval('PN.app.room.me.id'), meB = await B.eval('PN.app.room.me.id');
const P = {}; P[meA] = A; P[meB] = B;
await A.eval('PN.app.send({t:"start", mode:"hop"})');
await sleep(2500);

// 观察：一次正常跳跃后，操作端界面从「刚跳完」到「房主已换人」的滞后有多久？
let maxLag = 0, samples = 0;
for (let i = 0; i < 8; i++) {
  const h = JSON.parse(await A.eval('JSON.stringify({pid:(PN.app.state.g.attempt||{}).pid,ended:!!((PN.app.state.g.attempt||{}).ended),phase:PN.app.state.g.phase,lives:(PN.app.state.g.attempt||{}).lives,idx:(PN.app.state.g.attempt||{}).idx})'));
  if (h.phase === 'over' || !h.pid) { await sleep(400); continue; }
  const pg = P[h.pid];
  const box = await pg.box('canvas.hop-cv');
  await pg.mouse('mouseMoved', box.x, box.y, { button: 'none' });
  await pg.mouse('mousePressed', box.x, box.y, { buttons: 1, button: 'left', clickCount: 1 });
  await sleep(600);
  await pg.mouse('mouseReleased', box.x, box.y, { buttons: 0, button: 'left', clickCount: 1 });
  // 立刻连续采样：操作端认为该谁走 vs 房主认为该谁走
  const t0 = Date.now();
  let lag = 0;
  for (let k = 0; k < 40; k++) {
    const host = (await A.eval('(PN.app.state.g.attempt||{}).pid||""'));
    const mineNow = await pg.eval('(function(){var g=PN.app.state.g;return (g&&g.attempt)?g.attempt.pid:""})()');
    if (mineNow === host) { lag = Date.now() - t0; break; }
    await sleep(50);
  }
  samples++;
  if (lag > maxLag) maxLag = lag;
  await sleep(1600);
}
console.log('跳跃后「操作端 pid 追平房主 pid」最长耗时 = ' + maxLag + 'ms（采样 ' + samples + ' 次）');
console.log('≈ 这就是真人可能"按早了"的窗口：这段时间内操作端看到的还是上一手信息。');
console.log('报错 A=' + await A.consoleErrors() + ' B=' + await B.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
