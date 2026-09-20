// 跳一跳其余真人路径：轻点(弱跳)/提前收工/再来一局/中途刷新
import { connect, createRoom, joinRoom, waitPlayers, sleep, assert } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
const meA = await A.eval('PN.app.room.me.id'), meB = await B.eval('PN.app.room.me.id');
const P = {}; P[meA] = A; P[meB] = B;
const g = (p, expr) => p.eval(expr).then(JSON.parse).catch(() => null);
const st = (p) => g(p, 'JSON.stringify({phase:PN.app.state.g.phase,round:PN.app.state.g.round,pid:PN.app.state.g.attempt&&PN.app.state.g.attempt.pid,idx:PN.app.state.g.attempt&&PN.app.state.g.attempt.idx,score:PN.app.state.g.attempt&&PN.app.state.g.attempt.score,lives:PN.app.state.g.attempt&&PN.app.state.g.attempt.lives,ended:PN.app.state.g.attempt&&PN.app.state.g.attempt.ended,totals:PN.app.state.g.totals,w:PN.app.state.g.winner})');

await A.eval('PN.app.send({t:"start", mode:"hop"})');
await sleep(2500);
const who = async () => { const s = await st(A); return P[s.pid] ? (s.pid === meA ? 'A' : 'B') : '?'; };

/** 按「操作端**自己**界面显示轮到你」来选人 —— 真人就是这么操作的。
 *  不能用房主侧 attempt.pid：在 1.4s 换人窗口里房主侧还指向刚掉下去的那位
 *（ended=true, lives=0），而他界面显示的是「等对方」；此时按键会被 doCharge 的
 *  isMine 守卫正确挡掉，看起来像"没反应"（实测 diag-hop-lag6.mjs）。 */
const minePage = async (tries = 25) => {
  for (let t = 0; t < tries; t++) {
    for (const pid of Object.keys(P)) {
      const isMine = await P[pid].eval('(function(){var g=PN.app.state.g;return !!(g&&g.attempt&&g.attempt.pid===PN.app.room.me.id&&!g.attempt.ended&&g.attempt.lives>0&&g.phase==="play")})()');
      if (isMine) return P[pid];
    }
    await sleep(200);
  }
  return null;
};

/* 1. 轻点（弱跳）：落回原地，不得分、不断命 */
// s0/s1/s5 声明在块外：步骤 2 起要复用它们（写在块内会变成块级作用域）
let s0, s1, s5;
s0 = await st(A);
let page = await minePage();
const box = page ? await page.box('canvas.hop-cv') : null;
if (!page || !box) { console.log('1) 跳过：等不到「该我走」的一刻'); } else {
let x = box.x, y = box.y;
await page.mouse('mouseMoved', x, y, { button: 'none' });
await page.mouse('mousePressed', x, y, { buttons: 1, button: 'left', clickCount: 1 });
await sleep(60);
await page.mouse('mouseReleased', x, y, { buttons: 0, button: 'left', clickCount: 1 });
await sleep(1600);
s1 = await st(A);
console.log('1) 轻点60ms: idx ' + s0.idx + '→' + s1.idx + ' 命 ' + s0.lives + '→' + s1.lives + ' 分 ' + s0.score + '→' + s1.score + '  → ' + (s1.lives === s0.lives ? '✓ 不断命（弱跳落回原地）' : '✗ 扣命了'));
}

/* 2. 提前收工：轮到谁，谁点 */
s0 = await st(A);
const cur = await minePage();
if (cur) await cur.click('[data-giveup]'); else console.log('   （等不到该走的一方，跳过提前收工）');
await sleep(2200);
s1 = await st(A);
console.log('2) 提前收工: ended=' + s0.ended + '→' + s1.ended + ' pid 换人=' + (s0.pid !== s1.pid) + '  → ' + (s0.pid !== s1.pid ? '✓ 换人成功' : (s1.ended ? '（等换人）' : '✗ 没换人')));

/* 3. 打到终局 */
for (let i = 0; i < 40; i++) {
  const s = await st(A);
  if (s.phase === 'over') break;
  if (!s.pid) { await sleep(600); continue; }
  const p = await minePage(5);
  if (!p) { await sleep(400); continue; }
  const bx = await p.box('canvas.hop-cv');
  await p.mouse('mouseMoved', bx.x, bx.y, { button: 'none' });
  await p.mouse('mousePressed', bx.x, bx.y, { buttons: 1, button: 'left', clickCount: 1 });
  await sleep(600);
  await p.mouse('mouseReleased', bx.x, bx.y, { buttons: 0, button: 'left', clickCount: 1 });
  await sleep(1300);
}
let fin = await st(A), finB = await st(B);
console.log('3) 终局: phase=' + fin.phase + ' 轮数=' + fin.round + ' totals=' + JSON.stringify(fin.totals) + ' 对端=' + finB.phase);
assert(fin.phase === 'over' && finB.phase === 'over', '跳一跳真的打到终局且两端一致');
assert(Object.keys(fin.totals || {}).length >= 2, '两人都有得分记录');

/* 4. 再来一局（房主点） */
await A.eval('PN.app.send({t:"again"})');
await sleep(2500);
const r2 = await st(A), r2b = await st(B);
console.log('4) 再来一局: phase=' + r2.phase + ' round=' + r2.round + ' 对端 round=' + r2b.round + ' pid=' + (r2.pid ? '有' : 'null') + '  → ' + (r2.phase === 'play' && r2.round === 1 ? '✓ 重开成功' : '（phase=' + r2.phase + '）'));

/* 5. 中途刷新：刷新方回来还能继续跳 */
s5 = await st(A);
const curPage = (await minePage()) || A;
const label = curPage === A ? 'A/小桃' : 'B/阿泽';
await curPage.reload();
await sleep(5000);
const s5b = await st(A), s5c = await st(B);
console.log('5) 中途刷新（' + label + ' 刷新）: 房主侧 phase=' + s5b.phase + ' ' + s5b.pid + ' / 刷新方 phase=' + s5c.phase + ' ' + s5c.pid + '  → ' + (s5b.phase === 'play' && s5c.phase === 'play' ? '✓ 仍在同一局' : '✗ 丢了'));

const eA = JSON.parse(await A.consoleErrors()), eB = JSON.parse(await B.consoleErrors());
console.log('JS 报错: A=' + eA.length + ' B=' + eB.length + (eA.length ? ' 例:' + eA[0] : '') + (eB.length ? ' 例:' + eB[0] : ''));
console.log('HOP-REAL2 结束');
await A.dispose(); await B.dispose(); cdp.close();
