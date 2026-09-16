// 诊断切换游戏时的不同步：B 是「一直没收到」还是「收到后被回退」？
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);

// 在 B 页面里记录每一次 onState 收到的 mode/ts/hostId，方便看回退
await B.eval('(()=>{ if(window.__trace) return true; window.__trace=[]; const r=PN.app.room; const old=r.cb.onState; r.cb.onState=function(s,retained){ window.__trace.push({mode:s.mode, ts:s.ts, host:s.hostId, ret:!!retained, at:Date.now()}); return old.apply(this,arguments); }; return true; })()');

for (const m of ['mine', 'gomoku', 'soko']) {
  const t0 = Date.now();
  await A.eval('PN.app.send({t:"start", mode:' + JSON.stringify(m) + '})');
  await sleep(700);
  const a = await A.eval('PN.app.state&&PN.app.state.mode');
  const b = await B.eval('PN.app.state&&PN.app.state.mode');
  console.log(m + ': A=' + a + ' B=' + b + (a === b ? '  ok' : '  ★不同步'));
  if (a !== b) {
    // 再等久一点，看 B 会不会最终跟上（丢包 vs 回退）
    await sleep(2500);
    console.log('   再等 2.5s: B=' + await B.eval('PN.app.state&&PN.app.state.mode'));
    const tr = JSON.parse(await B.eval('JSON.stringify((window.__trace||[]).slice(-8))'));
    console.log('   B 最近收到的 state：');
    for (const t of tr) console.log('     mode=' + t.mode + ' ts=' + t.ts + ' host=' + String(t.host).slice(0,6) + ' ret=' + t.ret + ' 距今' + (Date.now() - t.at) + 'ms');
  }
  await A.eval('PN.app.send({t:"lobby"})'); await sleep(600);
}
await A.dispose(); await B.dispose(); cdp.close();
