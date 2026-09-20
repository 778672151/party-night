// 诊断：房主自己开房后，自己的名字多久才出现在名单里（是不是有延迟/空白）
import { connect, newPage, sleep, APP } from './lib.mjs';
const cdp = await connect();
const p = await newPage(cdp, APP);
await sleep(1500);

// 打点：记录 room.meta 出现、host.state 建立、state.players 出现的最早时刻
await p.eval(`(()=>{ window.__marks=[]; const t0=Date.now();
  window.__t0=t0;
  const tick=setInterval(function(){
    try{
      const app=window.PN&&PN.app; if(!app) return;
      const r=app.room;
      window.__marks.push({ms:Date.now()-t0,
        meta:!!(r&&r.meta&&r.meta.host), isHost:!!(r&&r.isHost),
        hostState:!!(app.host&&app.host.state), players:(app.state&&app.state.players)?app.state.players.length:-1,
        screen:app.screenName});
    }catch(e){}
  },100);
})()`);

await p.fill('#pn-name', '小桃');
const tClick = Date.now();
await p.click('#pn-create');
// 等到名单里有自己
let sawSelf = null;
for (let i = 0; i < 120; i++) {
  const n = Number(await p.eval('PN.app.state && PN.app.state.players ? PN.app.state.players.length : -1'));
  if (n >= 1) { sawSelf = Date.now() - tClick; break; }
  await sleep(100);
}
console.log('点「开个房」到「名单里出现自己」耗时: ' + (sawSelf === null ? '(12000ms 内始终没出现 ✗)' : sawSelf + 'ms'));
await p.fill('#pn-name', '小桃').catch(()=>{});

const marks = JSON.parse(await p.eval('JSON.stringify((window.__marks||[]).slice(0,60))'));
console.log('--- 打点（每 100ms，前 40 条）---');
for (const m of marks.slice(0, 40)) {
  console.log(String(m.ms).padStart(5) + 'ms meta=' + (m.meta?1:0) + ' isHost=' + (m.isHost?1:0) + ' hostState=' + (m.hostState?1:0) + ' players=' + String(m.players).padStart(2) + ' screen=' + m.screen);
}
await p.dispose(); cdp.close();
