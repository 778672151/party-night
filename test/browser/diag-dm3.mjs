// 骨牌为何有时 0→0：卡住时画面上有什么可点的
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
await A.eval('PN.app.send({t:"start", mode:"domino"})');
await sleep(5000);

const log = () => A.eval('(PN.app.state.g.log||[]).length');
const btns = () => A.eval('JSON.stringify((function(){var d=document.querySelector("iframe").contentDocument; var es=[].slice.call(d.querySelectorAll("button")); return es.filter(function(b){return b.offsetParent!==null}).map(function(b){return (b.textContent||"").trim().slice(0,10)+(b.disabled?"(禁)":"")}).slice(0,14);})())');
const clickFn = (name) => A.eval('(function(){var d=document.querySelector("iframe").contentDocument; var es=[].slice.call(d.querySelectorAll("button,[onclick]")); for(var i=0;i<es.length;i++){var oc=es[i].getAttribute("onclick")||""; if(oc.indexOf(' + JSON.stringify(name) + ')>=0){es[i].click(); return true;}} return false;})()');
const clickText = (kw) => A.eval('(function(){var d=document.querySelector("iframe").contentDocument; var es=[].slice.call(d.querySelectorAll("button")); for(var i=0;i<es.length;i++){var t=(es[i].textContent||"").trim(); if(t.indexOf(' + JSON.stringify(kw) + ')>=0 && !es[i].disabled && es[i].offsetParent!==null){es[i].click(); return t;}} return "none";})()');

console.log('开局: 日志=' + await log() + ' 按钮=' + await btns());
await clickFn('startGameWithDealer'); await sleep(1500);
console.log('点开始对局: 日志=' + await log() + ' 按钮=' + await btns());
await clickFn('localPlayerReady'); await sleep(1500);
console.log('点我是玩家: 日志=' + await log() + ' 按钮=' + await btns());
for (let i = 0; i < 10; i++) {
  const before = await log();
  let did = 'none';
  for (const kw of ['出牌', '扣牌', '摇色子下一局', '我是玩家，开始', '开始对局']) {
    const r = await clickText(kw);
    if (r !== 'none') { did = r; break; }
  }
  await sleep(1300);
  const after = await log();
  console.log('轮询' + (i + 1) + ': 点[' + did + '] 日志 ' + before + '→' + after + ' 按钮=' + await btns());
  if (after > 0) break;
}
console.log('最终: 日志=' + await log() + ' phase=' + await A.eval('PN.app.state.g.phase'));
console.log('报错 A=' + await A.consoleErrors() + ' B=' + await B.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
