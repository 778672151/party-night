// 把自己当玩家：在真浏览器里**连打 3 局**单人五子棋（默认 15×15，真鼠标点击）
// 看的是"用起来顺不顺"：机器人有没有卡住、棋盘有没有点不动、能不能顺利再来一局
//   node test/browser/bot-playtest.mjs
import { connect, createRoom, waitPlayers, sleep } from './lib.mjs';

const cdp = await connect();
const A = await createRoom(cdp, '小桃');
await waitPlayers(A, 1);
let failed = 0;
const check = (c, m) => { if (c) console.log('  ✓ ' + m); else { failed++; console.log('  ✗ ' + m); } };

/** 真点棋盘上一个空格（canvas，必须用真鼠标 + 真实几何） */
async function clickCell(page, cellIdx) {
  const box = JSON.parse(await page.eval('JSON.stringify((function(){var cv=document.querySelector("canvas");if(!cv)return null;var r=cv.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,n:PN.app.state.g.n};})())'));
  if (!box) return false;
  const pad = box.w * 0.04, step = (box.w - pad * 2) / (box.n - 1);
  const cx = cellIdx % box.n, cy = Math.floor(cellIdx / box.n);
  const px = box.x + pad + cx * step, py = box.y + pad + cy * step;
  await page.mouse('mouseMoved', px, py, { button: 'none' });
  await page.mouse('mousePressed', px, py, { buttons: 1, button: 'left', clickCount: 1 });
  await page.mouse('mouseReleased', px, py, { buttons: 0, button: 'left', clickCount: 1 });
  return true;
}
async function snapshot(page) {
  return JSON.parse(await page.eval('JSON.stringify((function(){var g=PN.app.state.g||{};return {m:(g.moves||[]).length,phase:g.phase,turn:g.turn,board:g.board,n:g.n,gp:g.players,winner:g.winner};})())'));
}
/** 点「再来一局」（如果画面上有） */
async function clickAgain(page) {
  return await page.eval('(function(){var bs=[].slice.call(document.querySelectorAll("button"));for(var i=0;i<bs.length;i++){var t=(bs[i].textContent||"").trim();if(/再来一局|再玩一次|再来/.test(t)&&!bs[i].disabled){bs[i].click();return t;}}return null;})()');
}

console.log('=== 单人五子棋连打 3 局（真鼠标，默认 15×15）===');
// 开局
await A.eval('(function(){var c=document.querySelector(\'.gcard[data-mode="gomoku"]\');c.querySelector(\'[data-act="start"]\').click();return true;})()');
for (let i = 0; i < 60; i++) { if (await A.eval('PN.app.screenName==="gomoku" && !!PN.app.state.g && PN.app.state.g.phase==="play"')) break; await sleep(400); }
const first = await snapshot(A);
const n = first.n;
console.log('  开局：n=' + n + ' g.players=' + JSON.stringify(first.gp) + '（默认棋盘应为 15）');
check(n === 15, '默认就是 15×15（实测 n=' + n + '）');

for (let game = 1; game <= 3; game++) {
  console.log('  --- 第 ' + game + ' 局 ---');
  let stall = 0, myMoves = 0, lastM = -1, sameCount = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    const st = await snapshot(A);
    if (st.phase !== 'play') break;
    const botColor = String(st.gp[0]).indexOf('bot:') === 0 ? 1 : 2;
    if (st.turn === botColor) {
      // 等机器人动（最多 4 秒；超过就是卡住）
      const waitStart = Date.now();
      let moved = false;
      while (Date.now() - waitStart < 4000) {
        const s2 = await snapshot(A);
        if (s2.m !== st.m || s2.phase !== 'play') { moved = true; break; }
        await sleep(200);
      }
      if (!moved) { stall++; console.log('    ⚠ 机器人 4 秒没动（m=' + st.m + '）'); }
    } else {
      // 真人：找一个空格真点
      const s2 = await snapshot(A);
      let tap = -1;
      for (let i = 0; i < s2.board.length; i++) if (s2.board[i] === 0) { tap = i; break; }
      if (tap < 0) break;
      await clickCell(A, tap);
      myMoves++;
      // 确认这一下真的落上了（真人点了没反应就是 bug）
      let ok = false;
      for (let w = 0; w < 12; w++) {
        const s3 = await snapshot(A);
        if (s3.m > s2.m) { ok = true; break; }
        await sleep(200);
      }
      if (!ok) { console.log('    ⚠ 真点了 (' + (tap % n) + ',' + Math.floor(tap / n) + ') 但没落上'); }
    }
    const cur = await snapshot(A);
    if (cur.m === lastM) sameCount++; else sameCount = 0;
    lastM = cur.m;
    if (sameCount > 20) { console.log('    ⚠ 局面长时间不动，退出本局'); break; }
  }
  const fin = await snapshot(A);
  console.log('    结束：moves=' + fin.m + ' phase=' + fin.phase + ' winner=' + fin.winner + ' 我下了 ' + myMoves + ' 手');
  check(stall === 0, '第 ' + game + ' 局：机器人一次都没卡住（卡 ' + stall + ' 次）');
  check(fin.phase === 'over', '第 ' + game + ' 局真的打完了（phase=' + fin.phase + '）');
  check(fin.m > myMoves, '第 ' + game + ' 局机器人确实在跟我下（它下了 ' + (fin.m - myMoves) + ' 手）');
  if (game < 3) {
    const again = await clickAgain(A);
    await sleep(2500);
    const st2 = await snapshot(A);
    check(!!again, '第 ' + game + ' 局后能点「' + again + '」再来一局');
    check(st2.phase === 'play' && st2.m < fin.m, '新一局真的重开了（phase=' + st2.phase + ' moves=' + st2.m + '）');
  }
}

const errs = JSON.parse(await A.consoleErrors());
check(errs.length === 0, '3 局全程无 JS 报错' + (errs[0] ? ' 例:' + errs[0] : ''));

await A.dispose(); cdp.close();
console.log(failed ? '\nPLAYTEST 有 ' + failed + ' 项未通过' : '\nPLAYTEST 全部通过（连打 3 局）');
process.exit(failed ? 1 : 0);
