// 真人只会「看到轮到自己」才按。这里改成：只在**操作端自己的本地状态**说 isMine 时按。
// 若这样可以 100% 生效，说明之前的"没反应"是测试按早了（按房主状态按、操作端还没跟上），非产品缺陷。
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
const meA = await A.eval('PN.app.room.me.id'), meB = await B.eval('PN.app.room.me.id');
const P = {}; P[meA] = A; P[meB] = B;
await A.eval('PN.app.send({t:"start", mode:"hop"})');
await sleep(2500);

// 找到「操作端自己认为该我走」的那一端（真人也是这样看界面的）
const findMine = async () => {
  for (const pid of Object.keys(P)) {
    const s = JSON.parse(await P[pid].eval('JSON.stringify({mine:(function(){var g=PN.app.state.g;return !!(g&&g.attempt&&g.attempt.pid===PN.app.room.me.id&&!g.attempt.ended&&g.attempt.lives>0&&g.phase==="play")})(),idx:(PN.app.state.g.attempt||{}).idx,lives:(PN.app.state.g.attempt||{}).lives})'));
    if (s.mine) return { pid, page: P[pid], idx: s.idx, lives: s.lives };
  }
  return null;
};

let ok = 0, skip = 0, over = false;
for (let i = 0; i < 40; i++) {
  const ph = await A.eval('PN.app.state.g.phase');
  if (ph === 'over') { over = true; break; }
  const mine = await findMine();
  if (!mine) { await sleep(300); continue; }
  const box = await mine.page.box('canvas.hop-cv');
  await mine.page.mouse('mouseMoved', box.x, box.y, { button: 'none' });
  await mine.page.mouse('mousePressed', box.x, box.y, { buttons: 1, button: 'left', clickCount: 1 });
  await sleep(600);
  await mine.page.mouse('mouseReleased', box.x, box.y, { buttons: 0, button: 'left', clickCount: 1 });
  await sleep(1400);
  const a = JSON.parse(await A.eval('JSON.stringify({idx:(PN.app.state.g.attempt||{}).idx,lives:(PN.app.state.g.attempt||{}).lives,score:(PN.app.state.g.attempt||{}).score,last:(PN.app.state.g.attempt||{}).last,pid:(PN.app.state.g.attempt||{}).pid})'));
  const moved = a.idx !== mine.idx || a.lives !== mine.lives || a.pid !== mine.pid || a.score > 0 || a.last;
  if (moved) ok++; else { skip++; console.log('  没反应 #' + (i + 1) + ': 按前端=' + mine.page === A ? 'A' : 'B' + ' idx=' + mine.idx + ' lives=' + mine.lives + ' → 按后 idx=' + a.idx + ' lives=' + a.lives + ' last=' + a.last); }
}
console.log('只在操作端本地 isMine 时按：生效=' + ok + ' 没反应=' + skip + ' 是否终局=' + over);
console.log('报错 A=' + await A.consoleErrors() + ' B=' + await B.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
