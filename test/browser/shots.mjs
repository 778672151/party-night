// 视觉基线 / 对比截图：落地页 → 大厅 → 选词 → 作画 → 揭晓
//   node test/browser/shots.mjs before   （或 after）
import { connect, createRoom, joinRoom, waitPlayers, startGame, sleep, clickUntil, newPage, APP } from './lib.mjs';

const tag = process.argv[2] || 'shot';
const cdp = await connect();
const L = await newPage(cdp, APP);
await sleep(700);
console.log('  ' + await L.shot(tag + '-1-land'));
await L.dispose();

const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2);
await sleep(600);
console.log('  ' + await A.shot(tag + '-2-lobby'));
const H = (await A.eval('PN.app.isHost()')) ? A : B;
await startGame(H, 'drawgame');
const aId = await A.eval('PN.app.room.me.id');
await A.waitFor('PN.app.state.g.cur && PN.app.state.g.cur.phase === "pick"', '选词');
const painterId = await A.eval('PN.app.state.g.cur.painter');
const P = painterId === aId ? A : B, G = painterId === aId ? B : A;
await P.waitFor('!!document.querySelector("[data-word]")', '选词卡');
await sleep(400);
console.log('  ' + await P.shot(tag + '-3-pick'));
await Promise.all([P.shot(tag + '-4-pick-guesser').then(p => G.eval('1'))]);
await clickUntil(P, '[data-word="0"]', 'PN.app.state.g.cur.phase === "draw"', '作画');
await P.touchDrag('.dg-stage canvas', [0.22, 0.40], [0.78, 0.58], 22);
await P.touchDrag('.dg-stage canvas', [0.30, 0.62], [0.68, 0.30], 18);
await sleep(1500);
console.log('  ' + await P.shot(tag + '-5-draw-painter'));
console.log('  ' + await G.shot(tag + '-6-draw-guesser'));
const answer = await P.eval('(PN.app.secrets.drawgame && PN.app.secrets.drawgame.mine && PN.app.secrets.drawgame.mine.answer) || null');
if (answer) {
  await G.fill('.dg-input input', answer);
  await G.key('Enter', 'Enter', 13);
  await G.waitFor('PN.app.state.g.cur && PN.app.state.g.cur.phase === "reveal"', '揭晓', 25000).catch(() => {});
  await sleep(1200);
  console.log('  ' + await G.shot(tag + '-7-reveal'));
}
await A.dispose(); await B.dispose(); cdp.close();
console.log('截图完成 → pn-shots/');
process.exit(0);
