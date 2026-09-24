// 单人局里房主刷新：state 还在（retained），但**定时器随页面死了** —— 机器人必须能继续动
//   node test/browser/bot-refresh.mjs
import { connect, createRoom, waitPlayers, sleep } from './lib.mjs';

const cdp = await connect();
const A = await createRoom(cdp, '小桃');
await waitPlayers(A, 1);
let failed = 0;
const check = (c, m) => { if (c) console.log('  ✓ ' + m); else { failed++; console.log('  ✗ ' + m); } };

console.log('=== 1. 单人开一局五子棋 ===');
await A.eval('(function(){var c=document.querySelector(\'.gcard[data-mode="gomoku"]\');c.querySelector(\'[data-act="start"]\').click();return true;})()');
let ready = false;
for (let i = 0; i < 60; i++) { ready = await A.eval('PN.app.screenName==="gomoku" && !!PN.app.state.g && PN.app.state.g.phase==="play"'); if (ready) break; await sleep(400); }
check(ready, '开起来了');
const code = await A.eval('PN.app.room.code');
const before = JSON.parse(await A.eval('JSON.stringify({moves:(PN.app.state.g.moves||[]).length,gp:PN.app.state.g.players,turn:PN.app.state.g.turn,n:PN.app.state.g.n})'));
console.log('  房号=' + code + ' moves=' + before.moves + ' g.players=' + JSON.stringify(before.gp) + ' turn=' + before.turn);
check(String(before.gp.join(',')).indexOf('bot:') >= 0, '局里有机器人');

console.log('=== 2. 让真人走一手，把局面停在「轮到机器人」（这样刷新后才知道它该不该动） ===');
// 走到轮到机器人
let guard = 0;
while (guard++ < 40) {
  const st = JSON.parse(await A.eval('JSON.stringify({t:PN.app.state.g.turn,gp:PN.app.state.g.players,m:(PN.app.state.g.moves||[]).length,phase:PN.app.state.g.phase,n:PN.app.state.g.n,board:PN.app.state.g.board})'));
  if (st.phase !== 'play') break;
  const botColor = String(st.gp[0]).indexOf('bot:') === 0 ? 1 : 2;
  if (st.t === botColor) break;                        // 已经轮到机器人
  // 真点一手
  const box = JSON.parse(await A.eval('JSON.stringify((function(){var cv=document.querySelector("canvas");var r=cv.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,n:PN.app.state.g.n};})())'));
  const pad = box.w * 0.06, cell = (box.w - pad * 2) / (box.n - 1);
  let tgt = null;
  for (let i = 0; i < st.board.length && !tgt; i++) if (st.board[i] === 0) tgt = { x: i % st.n, y: Math.floor(i / st.n) };
  const px = box.x + pad + tgt.x * cell, py = box.y + pad + tgt.y * cell;
  await A.mouse('mouseMoved', px, py, { button: 'none' });
  await A.mouse('mousePressed', px, py, { buttons: 1, button: 'left', clickCount: 1 });
  await A.mouse('mouseReleased', px, py, { buttons: 0, button: 'left', clickCount: 1 });
  await sleep(700);
}
const atRefresh = JSON.parse(await A.eval('JSON.stringify({t:PN.app.state.g.turn,gp:PN.app.state.g.players,m:(PN.app.state.g.moves||[]).length,phase:PN.app.state.g.phase})'));
const botColorNow = String(atRefresh.gp[0]).indexOf('bot:') === 0 ? 1 : 2;
console.log('  刷新前：moves=' + atRefresh.m + ' turn=' + atRefresh.t + '（机器人颜色=' + botColorNow + '）');
check(atRefresh.phase !== 'play' || atRefresh.t === botColorNow, '前提：刷新前正好轮到机器人');

console.log('=== 3. 房主刷新页面（定时器会随页面消失） ===');
await A.eval('location.reload()');
await sleep(5000);
const afterReload = JSON.parse(await A.eval('JSON.stringify({mode:PN.app.state.mode,screen:PN.app.screenName,phase:(PN.app.state.g||{}).phase,m:(PN.app.state.g.moves||[]).length,bots:(PN.app.state.players||[]).filter(p=>p.bot).length,botOnline:(PN.app.state.players||[]).filter(p=>p.bot&&p.online).length})'));
console.log('  刷新后：' + JSON.stringify(afterReload));
check(afterReload.mode === 'gomoku', '刷新后仍在五子棋局里（state 真的 retained 回来了）');
check(afterReload.bots === 1, '刷新后机器人还在名单里');
check(afterReload.botOnline === 1, '刷新后机器人没有被误判成离线');

console.log('=== 4. 关键：刷新后机器人**还会继续动**（新页面的定时器必须重新排上） ===');
let moved = false, m0 = afterReload.m, tries = 0;
for (tries = 0; tries < 40; tries++) {
  const st = JSON.parse(await A.eval('JSON.stringify({m:(PN.app.state.g.moves||[]).length,phase:PN.app.state.g.phase,t:PN.app.state.g.turn,gp:PN.app.state.g.players})'));
  if (st.m > m0) { moved = true; break; }
  if (st.phase !== 'play') break;
  // 若轮到真人，就替真人点一手，把球交回机器人
  const botColor = String(st.gp[0]).indexOf('bot:') === 0 ? 1 : 2;
  if (st.t !== botColor) {
    const box = JSON.parse(await A.eval('JSON.stringify((function(){var cv=document.querySelector("canvas");if(!cv)return null;var r=cv.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,n:PN.app.state.g.n};})())'));
    if (!box) break;
    const pad = box.w * 0.06, cell = (box.w - pad * 2) / (box.n - 1);
    const bd = JSON.parse(await A.eval('JSON.stringify(PN.app.state.g.board)'));
    let tgt = null;
    for (let i = 0; i < bd.length && !tgt; i++) if (bd[i] === 0) tgt = { x: i % st.gp.length >= 0 ? i % box.n : 0, y: Math.floor(i / box.n) };
    const px = box.x + pad + tgt.x * cell, py = box.y + pad + tgt.y * cell;
    await A.mouse('mouseMoved', px, py, { button: 'none' });
    await A.mouse('mousePressed', px, py, { buttons: 1, button: 'left', clickCount: 1 });
    await A.mouse('mouseReleased', px, py, { buttons: 0, button: 'left', clickCount: 1 });
  }
  await sleep(700);
}
const fin = JSON.parse(await A.eval('JSON.stringify({m:(PN.app.state.g.moves||[]).length,phase:PN.app.state.g.phase})'));
console.log('  最终：moves=' + m0 + '→' + fin.m + ' phase=' + fin.phase + '（试了 ' + tries + ' 轮）');
check(fin.m > m0, '刷新后机器人确实继续动了（moves ' + m0 + '→' + fin.m + '）');

console.log('=== 5. 无 JS 报错 ===');
const errs = JSON.parse(await A.consoleErrors());
check(errs.length === 0, '刷新前后全程无 JS 报错' + (errs[0] ? ' 例:' + errs[0] : ''));

await A.dispose(); cdp.close();
console.log(failed ? '\nBOT-REFRESH 有 ' + failed + ' 项未通过' : '\nBOT-REFRESH 全部通过');
process.exit(failed ? 1 : 0);
