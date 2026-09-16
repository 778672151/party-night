// 定位「连续切换游戏」时那个 TypeError: Cannot read properties of undefined (reading 'length')
// 逐步切换，每步后立刻取报错与堆栈，找出是哪一次切换、哪个函数。
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const SEQ = ['gomoku', 'soko', 'mine', 'hop', 'memory', 'cube', 'domino', 'go', 'tacit', 'codraw', 'drawgame'];
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);

// 装一个能拿到堆栈的采集器（__pnErrors 只存了 message）
async function install(p) { await p.eval('(()=>{ if(window.__pnStacks) return true; window.__pnStacks=[]; window.addEventListener("error", e=>{ window.__pnStacks.push({msg:String(e.message), stack:String((e.error&&e.error.stack)||"")}); }); return true; })()'); }
await install(A); await install(B);

async function take(p) { return JSON.parse(await p.eval('JSON.stringify(window.__pnStacks||[])')).splice(0); }

for (const m of SEQ) {
  await take(A); await take(B);
  await A.eval('PN.app.send({t:"start", mode:' + JSON.stringify(m) + '})');
  await sleep(800);
  const mode = await A.eval('PN.app.state && PN.app.state.mode');
  const eA = await take(A);
  const eB = await take(B);
  if (eA.length || eB.length) {
    console.log('\n★ 切换到 ' + m + ' 出错（mode=' + mode + '）');
    for (const e of eA.slice(0, 1)) console.log('  [A] ' + e.msg + '\n      ' + e.stack.split('\n').slice(0, 5).join('\n      '));
    for (const e of eB.slice(0, 1)) console.log('  [B] ' + e.msg + '\n      ' + e.stack.split('\n').slice(0, 5).join('\n      '));
  } else {
    console.log('  ok  ' + m + ' (mode=' + mode + ')');
  }
  await A.eval('PN.app.send({t:"lobby"})');
  await sleep(500);
}
await A.dispose(); await B.dispose(); cdp.close();
