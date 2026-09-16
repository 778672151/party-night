// 刷新时序诊断：把刷新后每一刻的关键状态打出来，定位对局是在哪一步被洗掉的
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
await A.eval('PN.app.send({t:"start", mode:"gomoku"})');
await sleep(1500);
console.log('刷新前 A.mode=' + await A.eval('PN.app.state.mode') + ' lastState=' + await A.eval('PN.app.room.lastState && PN.app.room.lastState.mode'));

// 装一个「谁调了 fresh」的记录器：重载后立即注入
await A.send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__log = [];
  (function(){ const kick = function(){
    if (window.__pnHooked) return; window.__pnHooked = 1;
    const t = setInterval(function(){
      try {
        const app = window.PN && PN.app; if (!app) return;
        const r = app.room, h = app.host;
        window.__log.push({
          t: Date.now(),
          isHost: r && r.isHost,
          meta: !!(r && r.meta && r.meta.host),
          last: r && r.lastState ? r.lastState.mode : null,
          host: h && h.state ? h.state.mode : null,
          ui: app.state && app.state.mode,
          hasH: !!h
        });
      } catch (e) {}
    }, 400);
  };
  if (document.readyState === 'complete') kick(); else window.addEventListener('load', kick);
  })();
` }, A.sid);

await A.reload();
await sleep(9000);
const log = JSON.parse(await A.eval('JSON.stringify(window.__log||[])'));
console.log('--- 刷新后时间线（相对第一条 ms）---');
const t0 = log.length ? log[0].t : 0;
for (const e of log) {
  console.log(String(e.t - t0).padStart(5) + 'ms isHost=' + e.isHost + ' meta=' + e.meta + ' last=' + e.last + ' host=' + e.host + ' ui=' + e.ui + ' hasH=' + e.hasH);
}
console.log('最终 A.mode=' + await A.eval('PN.app.state.mode'));
console.log('B.mode=' + await B.eval('PN.app.state.mode'));
await A.dispose(); await B.dispose(); cdp.close();
