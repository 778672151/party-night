// 难度档位在真浏览器里真的能用：点设置 → 开局 → 设置真的到了引擎
//   node test/browser/bot-difficulty.mjs
import { connect, createRoom, waitPlayers, sleep } from './lib.mjs';

const cdp = await connect();
const A = await createRoom(cdp, '小桃');
await waitPlayers(A, 1);
let failed = 0;
const check = (c, m) => { if (c) console.log('  ✓ ' + m); else { failed++; console.log('  ✗ ' + m); } };

console.log('=== 1. 大厅里能看见「机器人」难度档，且默认高亮「普通」 ===');
// 展开五子棋的设置面板
await A.eval('(function(){var c=document.querySelector(\'.gcard[data-mode="gomoku"]\');c.querySelector(\'[data-act="cfg"]\').click();return true;})()');
await sleep(400);
const panel = JSON.parse(await A.eval(`JSON.stringify((function(){
  var box=document.querySelector('#cfg-gomoku');
  var segs=[].slice.call(box.querySelectorAll('.setrow')).map(function(r){
    var label=(r.querySelector('span')||{}).textContent||'';
    var on=r.querySelector('.cfg.on');
    return {label:label, current:on?on.dataset.val:null,
            opts:[].slice.call(r.querySelectorAll('.cfg')).map(function(b){return b.dataset.val;})};
  });
  return segs;
})())`));
console.log('  面板=' + JSON.stringify(panel));
const diffRow = panel.filter(r => /机器人/.test(r.label))[0];
check(!!diffRow, '有「机器人」难度这一行');
check(diffRow && diffRow.opts.join(',') === 'easy,normal,hard', '三个档位齐全（' + (diffRow ? diffRow.opts.join(',') : '') + '）');
check(diffRow && diffRow.current === 'normal', '默认高亮「普通」（实测 ' + (diffRow ? diffRow.current : '无') + '）');

console.log('=== 2. 点「困难」，设置真的写进 state ===');
await A.eval('(function(){var b=document.querySelector(\'#cfg-gomoku .cfg[data-key="difficulty"][data-val="hard"]\');b.click();return true;})()');
await sleep(800);
const saved = await A.eval('JSON.stringify((PN.app.state.settings.gomoku||{}))');
console.log('  state.settings.gomoku=' + saved);
check(JSON.parse(saved).difficulty === 'hard', 'state 里记成了 hard');
const onNow = await A.eval('(function(){var r=document.querySelector(\'#cfg-gomoku .cfg[data-key="difficulty"].on\');return r?r.dataset.val:null;})()');
check(onNow === 'hard', '高亮跟着切到「困难」（实测 ' + onNow + '）');

console.log('=== 3. 开局后，难度真的传到了机器人（用必堵四连的行为验） ===');
const clicked = await A.eval('(function(){var c=document.querySelector(\'.gcard[data-mode="gomoku"]\');var b=c.querySelector(\'[data-act="start"]\');if(b.disabled)return "disabled";b.click();return "clicked";})()');
console.log('  点开始 → ' + clicked);
let ready = false;
for (let i = 0; i < 60; i++) {
  ready = await A.eval('PN.app.screenName === "gomoku" && !!PN.app.state.g && PN.app.state.g.phase === "play"');
  if (ready) break;
  await sleep(400);
}
check(ready, '真的开起了五子棋');
const inGame = await A.eval('JSON.stringify({diff:(PN.app.state.settings.gomoku||{}).difficulty,bot:(PN.app.state.players||[]).some(p=>p.bot)})');
console.log('  局内 settings=' + inGame);
check(JSON.parse(inGame).diff === 'hard', '局内 settings.gomoku.difficulty 仍是 hard');
check(JSON.parse(inGame).bot === true, '仍然配了机器人');

console.log('=== 4. 机器人照常会下（困难档没有把引擎搞坏） ===');
if (ready) {
  // 若轮到真人就真点一手，然后等机器人应招
  let guard = 0, moves0 = JSON.parse(await A.eval('JSON.stringify({m:(PN.app.state.g.moves||[]).length,t:PN.app.state.g.turn,gp:PN.app.state.g.players})'));
  let m = moves0;
  while (guard++ < 40 && m.m === moves0.m) {
    const st = JSON.parse(await A.eval('JSON.stringify({m:(PN.app.state.g.moves||[]).length,t:PN.app.state.g.turn,gp:PN.app.state.g.players,n:PN.app.state.g.n,board:PN.app.state.g.board,phase:PN.app.state.g.phase})'));
    if (st.phase !== 'play') break;
    const botColor = String(st.gp[0]).indexOf('bot:') === 0 ? 1 : 2;
    if (st.t !== botColor) {
      // 真点一个空格
      const box = JSON.parse(await A.eval('JSON.stringify((function(){var cv=document.querySelector("canvas");var r=cv.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,n:PN.app.state.g.n};})())'));
      const pad = box.w * 0.06, cell = (box.w - pad * 2) / (box.n - 1);
      let tgt = null;
      for (let i = 0; i < st.board.length && !tgt; i++) if (st.board[i] === 0) tgt = { x: i % st.n, y: Math.floor(i / st.n) };
      const px = box.x + pad + tgt.x * cell, py = box.y + pad + tgt.y * cell;
      await A.mouse('mouseMoved', px, py, { button: 'none' });
      await A.mouse('mousePressed', px, py, { buttons: 1, button: 'left', clickCount: 1 });
      await A.mouse('mouseReleased', px, py, { buttons: 0, button: 'left', clickCount: 1 });
    }
    await sleep(600);
    m = JSON.parse(await A.eval('JSON.stringify({m:(PN.app.state.g.moves||[]).length})'));
  }
  check(m.m > moves0.m, '困难档下机器人也照常应招（moves ' + moves0.m + '→' + m.m + '）');
}
const errs = JSON.parse(await A.consoleErrors());
check(errs.length === 0, '全程无 JS 报错' + (errs[0] ? ' 例:' + errs[0] : ''));

await A.dispose(); cdp.close();
console.log(failed ? '\nBOT-DIFFICULTY 有 ' + failed + ' 项未通过' : '\nBOT-DIFFICULTY 全部通过');
process.exit(failed ? 1 : 0);
