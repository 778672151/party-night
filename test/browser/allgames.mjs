// 每款联机游戏：开局 → 强制终局 → 双方看到终局 → 双方都能回到房间 → 再来一局还能开
//   node test/browser/allgames.mjs
import { connect, createRoom, joinRoom, waitPlayers, sleep, assert } from './lib.mjs';

const GAMES = ['gomoku', 'soko', 'mine', 'memory', 'hop', 'tacit', 'codraw', 'cube', 'domino', 'go', 'drawgame'];

/** 把房主状态推到 over（模拟「这一局分出胜负」），各游戏 over 形状不同，所以只动通用字段 */
const forceOver = (p) => p.eval('(()=>{const h=PN.app.host;const g=h.state.g||{};h.state.phase="over";if(g) Object.assign(g,{phase:"over"});h.emit();return true;})()');

const modeOf = (p) => p.eval('(PN.app && PN.app.state && PN.app.state.mode) || "?"');
const phaseOf = (p) => p.eval('(PN.app && PN.app.state && PN.app.state.phase) || "?"');

const cdp = await connect();
let failed = [];
for (const m of GAMES) {
  console.log('\n=== ' + m + ' ===');
  try {
    const A = await createRoom(cdp, '小桃');
    const B = await joinRoom(cdp, '阿泽', A.code);
    await waitPlayers(A, 2); await waitPlayers(B, 2);
    await A.eval('PN.app.send({t:"start", mode:' + JSON.stringify(m) + '})');
    await sleep(1400);
    const a1 = await modeOf(A), b1 = await modeOf(B);
    assert(a1 === m && b1 === m, '开局双方一致（A=' + a1 + ' B=' + b1 + '）');
    if (a1 !== m || b1 !== m) failed.push(m + ':开局');
    // 强制终局
    await forceOver(A);
    await sleep(1200);
    const pa = await phaseOf(A), pb = await phaseOf(B);
    assert(pa === 'over' && pb === 'over', '双方都看到终局（A=' + pa + ' B=' + pb + '）');
    if (pa !== 'over' || pb !== 'over') failed.push(m + ':终局');
    // 房主点「回大厅」→ 双方都应回到房间
    await A.eval('PN.app.send({t:"lobby"})');
    await sleep(1400);
    const a2 = await modeOf(A), b2 = await modeOf(B);
    assert(a2 === 'lobby' && b2 === 'lobby', '双方都回到房间（A=' + a2 + ' B=' + b2 + '）');
    if (a2 !== 'lobby' || b2 !== 'lobby') failed.push(m + ':回房间');
    // 再来一局：还能正常开
    await A.eval('PN.app.send({t:"start", mode:' + JSON.stringify(m) + '})');
    await sleep(1400);
    const a3 = await modeOf(A), b3 = await modeOf(B);
    assert(a3 === m && b3 === m, '再来一局仍能正常开（A=' + a3 + ' B=' + b3 + '）');
    if (a3 !== m || b3 !== m) failed.push(m + ':再来一局');
    // 报错检查
    const eA = JSON.parse(await A.consoleErrors()), eB = JSON.parse(await B.consoleErrors());
    assert(eA.length === 0 && eB.length === 0, '无 JS 报错' + (eA.length || eB.length ? '（' + [...eA, ...eB].slice(0, 2).join(' / ') + '）' : ''));
    if (eA.length || eB.length) failed.push(m + ':报错');
    await A.dispose(); await B.dispose();
  } catch (e) {
    assert(false, m + ' 抛异常: ' + (e && e.message || '').slice(0, 120));
    failed.push(m + ':异常');
  }
}
console.log('\n失败清单: ' + (failed.length ? failed.join(', ') : '无'));
cdp.close();
