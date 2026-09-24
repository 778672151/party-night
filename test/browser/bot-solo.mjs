// 单人也能开局：真浏览器里一个人点一下，真的和机器人下起来
//   node test/browser/bot-solo.mjs
import { connect, createRoom, waitPlayers, sleep, APP, assert } from './lib.mjs';

const cdp = await connect();
const A = await createRoom(cdp, '小桃');
await waitPlayers(A, 1);

console.log('=== 1. 大厅里只有一个人 ===');
const lobby = JSON.parse(await A.eval('JSON.stringify({players:(PN.app.state.players||[]).map(p=>({id:p.id,online:p.online,bot:!!p.bot}))})'));
console.log('  玩家=' + JSON.stringify(lobby.players));
assert(lobby.players.length === 1, '只有 1 个人在大厅');
assert(!lobby.players.some(p => p.bot), '开局前大厅里没有机器人');

console.log('=== 2. 一个真人开五子棋：应该真的开起来，并配一个机器人 ===');
// 用真点击（不是 PN.app.send），走和真人完全一样的路径
// 开始按钮在卡片**内部**：.gcard[data-mode=gomoku] [data-act=start]（gameCard 的结构）
const clicked = await A.eval('(function(){var c=document.querySelector(".gcard[data-mode=\\"gomoku\\"]");if(!c)return "no-card";var b=c.querySelector("[data-act=\\"start\\"]");if(!b)return "no-button";if(b.disabled)return "disabled";b.click();return "clicked";})()');
console.log('  点击开始按钮 → ' + clicked);
assert(clicked === 'clicked', '五子棋的开始按钮可点（房主）');

// 等它真的进入这一局
let okReady = false;
for (let i = 0; i < 60; i++) {
  okReady = await A.eval('PN.app.screenName === "gomoku" && !!PN.app.state.g && PN.app.state.g.phase === "play"');
  if (okReady) break;
  await sleep(400);
}
const st = JSON.parse(await A.eval('JSON.stringify({screen:PN.app.screenName,mode:PN.app.state.mode,phase:(PN.app.state.g||{}).phase,players:(PN.app.state.players||[]).map(p=>({id:p.id,name:p.name,bot:!!p.bot,online:p.online})),gp:(PN.app.state.g||{}).players,turn:(PN.app.state.g||{}).turn})'));
console.log('  screen=' + st.screen + ' phase=' + st.phase);
console.log('  名单=' + JSON.stringify(st.players));
console.log('  g.players=' + JSON.stringify(st.gp) + ' turn=' + st.turn);
assert(okReady, '一个人真的开起了五子棋（没有被"人数不够"挡住）');
assert(st.players.some(p => p.bot), '名单里配了机器人（bot:true）');
assert(st.players.filter(p => p.bot && p.online).length === 1, '机器人是在线的');
assert(Array.isArray(st.gp) && st.gp.some(id => String(id).indexOf('bot:') === 0), '机器人进了 g.players，参与轮次判定');

console.log('=== 3. 机器人会自己动（不靠人替它走）===');
const before = JSON.parse(await A.eval('JSON.stringify({moves:(PN.app.state.g.moves||[]).length,turn:PN.app.state.g.turn})'));
console.log('  起手：moves=' + before.moves + ' turn=' + before.turn);
// 真人那一步：如果轮到真人就真点棋盘；否则等机器人先走
let guard = 0, moved = 0;
while (guard++ < 90) {
  const g = JSON.parse(await A.eval('JSON.stringify({moves:(PN.app.state.g.moves||[]).length,turn:PN.app.state.g.turn,phase:PN.app.state.g.phase,gp:PN.app.state.g.players})'));
  if (g.phase !== 'play') break;
  const botColor = g.gp[0] === 'bot:1' || String(g.gp[0]).indexOf('bot:') === 0 ? 1 : 2;
  if (g.turn !== botColor) {
    // 轮到真人：五子棋棋盘是 canvas，必须用**真鼠标**点在格子中心（不能点 DOM 元素）。
    // 先问出画布几何 + 一个空格的坐标，再走 CDP 真点击。
    const box = await A.eval('JSON.stringify((function(){var cv=document.querySelector("canvas");if(!cv)return null;var r=cv.getBoundingClientRect();var gg=PN.app.state.g;return {x:r.x,y:r.y,w:r.width,h:r.height,n:gg.n,board:gg.board};})())');
    if (!box || box === 'null') break;
    const b = JSON.parse(box);
    const pad = b.w * 0.06, cell = (b.w - pad * 2) / (b.n - 1);
    let target = null;
    for (let i = 0; i < b.board.length && !target; i++) {
      if (b.board[i] === 0) target = { x: i % b.n, y: Math.floor(i / b.n) };
    }
    if (!target) break;
    const px = b.x + pad + target.x * cell, py = b.y + pad + target.y * cell;
    await A.mouse('mouseMoved', px, py, { button: 'none' });
    await A.mouse('mousePressed', px, py, { buttons: 1, button: 'left', clickCount: 1 });
    await A.mouse('mouseReleased', px, py, { buttons: 0, button: 'left', clickCount: 1 });
  }
  await sleep(500);
  const g2 = JSON.parse(await A.eval('JSON.stringify({moves:(PN.app.state.g.moves||[]).length})'));
  moved = g2.moves;
}
const fin = JSON.parse(await A.eval('JSON.stringify({moves:(PN.app.state.g.moves||[]).length,phase:PN.app.state.g.phase,turn:PN.app.state.g.turn})'));
console.log('  结束时：moves=' + fin.moves + ' phase=' + fin.phase);
assert(fin.moves > before.moves, '对局真的推进了（机器人落过子，moves ' + before.moves + '→' + fin.moves + '）');

console.log('=== 3b. 机器人必须在牌桌上被标出来（不能让人以为是陌生人）===');
// ⚠️ 对局中**大厅名册根本不渲染**（.player 一个都没有），玩家的名字只出现在计分板 .sbrow 里。
// 所以这里查的是计分板 —— 我第一版查 .player 得到空数组，是查错了地方。
const rows = JSON.parse(await A.eval("JSON.stringify([].slice.call(document.querySelectorAll('.sbrow')).map(function(el){return { text:(el.textContent||'').trim(), isBot:el.classList.contains('bot'), tag:(el.querySelector('.bot-tag')||{}).textContent||null };}))"));
console.log('  计分板=' + JSON.stringify(rows));
assert(rows.length >= 2, '计分板列出了双方（实际 ' + rows.length + ' 行）');
const botRow = rows.filter(r => r.isBot)[0];
assert(!!botRow, '有一行被标成机器人（.sbrow.bot）');
assert(botRow && botRow.tag === '机器人', '那一行带「机器人」标签（实测 ' + (botRow ? botRow.tag : '无') + '）');
// 真人的那一行不能被误标
const humanRows = rows.filter(r => !r.isBot);
assert(humanRows.every(r => !r.tag), '真人那几行没有被误标成机器人');

console.log('=== 4. 无 JS 报错 ===');
const errs = JSON.parse(await A.consoleErrors());
assert(errs.length === 0, '单人对局全程无 JS 报错' + (errs[0] ? ' 例:' + errs[0] : ''));

await A.dispose(); cdp.close();
console.log('\n===== 单人开局（机器人对手）通过 =====');
