// 用途：查清「五子棋另一端真点棋盘到底能不能落子」+ 测「落子 → 对端看到」的真实延迟
//   node test/browser/diag-gomoku-tap.mjs
// 注意（上一版脚本的教训）：所有点击都点在画布中心 = A 刚占的那一格，被正确拒绝，
// 于是看起来像「B 点不动」。这一版每手都点**不同的空格**，并打印 elementFromPoint。
import { connect, createRoom, joinRoom, waitPlayers, startGame, sleep } from './lib.mjs';

const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
await startGame(A, 'gomoku');
await sleep(600);

const WATCH = `(() => {
  window.__tapHits = 0;
  const cv = document.querySelector('canvas.gm-cv');
  if (cv) cv.addEventListener('click', function () { window.__tapHits++; }, true);
  return !!cv;
})()`;
await A.eval(WATCH); await B.eval(WATCH);

const info = (p) => p.eval(`JSON.stringify((function(){
  var g = PN.app.state.g || {};
  var me = PN.app.room.me.id;
  var mine = (g.players && g.players[0] === me) ? 1 : 2;
  var pt = document.elementFromPoint(210, 411);
  return { screen: PN.app.screenName, moves: (g.moves||[]).length, turn: g.turn, me: mine,
           myTurn: g.turn === mine, hit: pt ? (pt.tagName + '.' + (pt.className||'')) : 'null' };
})())`).then(JSON.parse);

// 按格子编号真点：cx/cy 是 0..n-1 的交叉点（画布 padding 0.055，与产品 cellFrom 同一套换算）
const tapCell = async (p, cx, cy) => {
  const b = await p.box('canvas.gm-cv');
  if (!b) { console.log('  画布 box 为空 → 点不到'); return; }
  const x = b.left + b.w * 0.055 + (b.w - b.w * 0.11) * (cx / 14);
  const y = b.top + b.h * 0.055 + (b.h - b.h * 0.11) * (cy / 14);
  await p.mouse('mouseMoved', x, y, { button: 'none' });
  await p.mouse('mousePressed', x, y, { buttons: 1, button: 'left', clickCount: 1 });
  await p.mouse('mouseReleased', x, y, { buttons: 0, button: 'left', clickCount: 1 });
  console.log('  真点交叉点 (' + cx + ',' + cy + ') @(' + Math.round(x) + ',' + Math.round(y) + ')');
};

// 交替落子：黑方从 (3,3) 开始沿对角线走，白方从 (4,4) 开始——每手都是不同的空格
const cells = [[3, 3], [4, 4], [5, 5], [6, 4], [4, 6], [6, 6], [7, 5], [5, 7]];
let bad = 0;
for (let k = 0; k < 6; k++) {
  const ia = await info(A), ib = await info(B);
  const page = ia.myTurn ? A : B;
  const tag = ia.myTurn ? 'A(黑)' : 'B(白)';
  const [cx, cy] = cells[k];
  console.log('--- 第' + (k + 1) + '手：轮到 ' + tag + '（A.moves=' + ia.moves + ' B.moves=' + ib.moves + '）---');
  await tapCell(page, cx, cy);
  const t0 = Date.now();
  let ok = false, lag = null;
  for (let i = 0; i < 25; i++) {                       // 最多等 5s
    const a = await info(A), b = await info(B);
    if (a.moves > ia.moves && b.moves === a.moves) { ok = true; lag = Date.now() - t0; break; }
    await sleep(200);
  }
  const hitsA = await A.eval('window.__tapHits'), hitsB = await B.eval('window.__tapHits');
  const fA = await info(A), fB = await info(B);
  console.log('  到达画布计数：A=' + hitsA + ' B=' + hitsB + '；elementFromPoint: A=' + fA.hit + ' B=' + fB.hit);
  if (ok) console.log('  ✓ 生效，对端在 ' + lag + 'ms 内看到（两端 ' + fA.moves + ' 手一致）');
  else { bad++; console.log('  ✗ 5s 内没生效（A=' + fA.moves + ' B=' + fB.moves + '）—— 需要继续查'); }
}
const eA = await A.consoleErrors(), eB = await B.consoleErrors();
console.log('报错 A=' + eA + ' B=' + eB);
console.log(bad ? '结论：有 ' + bad + ' 手未生效 → 不是单纯延迟，要查' : '结论：6 手全部生效 → 真机双人落子没问题，realinput 的偶发失败是时序等待不足');
await A.dispose(); await B.dispose(); cdp.close();
