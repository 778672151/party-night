// 诊断：单人为什么进不了跳一跳（区分闸门 vs init 崩溃 vs 点击问题）
import { connect, createRoom, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
await sleep(2000);
await A.eval('window.__errs=[]; window.addEventListener("error", e => window.__errs.push(String(e.message)));');
console.log('玩家列表: ' + await A.eval('JSON.stringify((PN.app.state.players||[]).map(p=>({id:p.id, online:p.online})))'));
console.log('卡片存在: ' + await A.eval('!![...document.querySelectorAll(".modecard")].find(x=>x.dataset.mode==="hop")'));
console.log('bundle 里的 minPlayers: ' + await A.eval('PN.games.hop.minPlayers'));
console.log('在线人数(客户端口径): ' + await A.eval('(PN.app.state.players||[]).filter(p=>p.online).length'));
// 实验1：直接 send（当前 minPlayers）
await A.eval('PN.app.send({t:"start", mode:"hop"})');
await sleep(1200);
console.log('实验1 直接send后 mode=' + await A.eval('PN.app.state.mode') + ' toasts=' + await A.eval('(()=>[...document.querySelectorAll(".toast")].map(t=>t.textContent).join(" | "))()'));
// 实验2：页面内把 minPlayers 改成 1（不重新构建）再 send
await A.eval('PN.games.hop.minPlayers = 1');
await A.eval('PN.app.send({t:"start", mode:"hop"})');
await sleep(1500);
console.log('实验2 minPlayers=1 后 mode=' + await A.eval('PN.app.state.mode') + ' phase=' + await A.eval('PN.app.state.phase') + ' attempt=' + await A.eval('!!(PN.app.state.g&&PN.app.state.g.attempt)'));
console.log('页面报错: ' + await A.eval('JSON.stringify(window.__errs||[])'));
await A.dispose(); cdp.close();
