// 骨牌顶牛：真点原作 iframe 里的「出牌」按钮，验证是否上报成动作（避开嵌套引号）
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
const meA = await A.eval('PN.app.room.me.id');
await A.eval('PN.app.send({t:"start", mode:"domino"})');
await sleep(5000);
const st = () => A.eval('JSON.stringify({phase:PN.app.state.g.phase,turnIdx:PN.app.state.g.turnIdx,players:PN.app.state.g.players,log:(PN.app.state.g.log||[]).length})').then(JSON.parse);
console.log('开局: ' + JSON.stringify(await st()));

// 在 iframe 内按 onclick 里的函数名找按钮（用 indexOf，不写嵌套引号）
const clickFn = (p, name) => p.eval('(function(){var d=document.querySelector("iframe").contentDocument; var es=[].slice.call(d.querySelectorAll("button,[onclick]")); var hit=null; for(var i=0;i<es.length;i++){ var oc=es[i].getAttribute("onclick")||""; if(oc.indexOf(' + JSON.stringify(name) + ')>=0){hit=es[i];break;} } if(!hit)return "none"; hit.click(); return (hit.textContent||"").trim().slice(0,12); })()');
for (const fn of ['startGameWithDealer', 'localPlayerReady']) { const r = await clickFn(A, fn); console.log('点 ' + fn + ' → ' + r); await sleep(1300); }
await sleep(1200);
console.log('推进后: ' + JSON.stringify(await st()));

// 找「出牌」按钮并真点
const found = await A.eval('JSON.stringify((function(){var d=document.querySelector("iframe").contentDocument; var es=[].slice.call(d.querySelectorAll("button")); return es.map(function(b,i){return {i:i,t:(b.textContent||"").trim().slice(0,10),dis:b.disabled,vis:b.offsetParent!==null}}).filter(function(x){return /出牌|扣牌|不出|过/.test(x.t)||x.vis}).slice(0,14);})())');
console.log('候选按钮: ' + found);

const before = (await st()).log;
const clicked = await A.eval('(function(){var d=document.querySelector("iframe").contentDocument; var es=[].slice.call(d.querySelectorAll("button")); var hit=null; for(var i=0;i<es.length;i++){ var t=(es[i].textContent||"").trim(); if((t.indexOf("出牌")>=0||t.indexOf("扣牌")>=0) && !es[i].disabled){hit=es[i];break;} } if(!hit)return "none"; hit.click(); return t2=(hit.textContent||"").trim(); })()');
console.log('真点: ' + clicked);
await sleep(2500);
const after = await st();
console.log('真点后: ' + JSON.stringify(after) + '  日志 ' + before + '→' + after.log + (after.log > before ? ' ✓ 生效' : ' （可能不是该座位/无牌可出）'));
console.log('报错 A=' + await A.consoleErrors() + ' B=' + await B.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
