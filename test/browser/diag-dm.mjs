// 骨牌顶牛：在 iframe 内真点原作牌/按钮，看是否上报成动作
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

// iframe 内结构
const inner = await A.eval('JSON.stringify((function(){var f=document.querySelector("iframe"); if(!f)return null; var d=f.contentDocument; if(!d)return "no-doc"; return {title:(d.title||""), buttons:[].slice.call(d.querySelectorAll("button")).map(function(b){return (b.textContent||"").trim().slice(0,14)}).slice(0,14), clickables:[].slice.call(d.querySelectorAll("[onclick]")).map(function(e){return e.getAttribute("onclick").slice(0,22)}).slice(0,12)};})())');
console.log('iframe 内: ' + inner);

// 在 iframe 内真点「开始/确认」类按钮，推进到 playing
const clickInside = async (p, sel) => p.eval('(function(){var d=document.querySelector("iframe").contentDocument; var e=d.querySelector(' + JSON.stringify(sel) + '); if(!e)return false; e.click(); return true;})()');
for (const sel of ['[onclick*="startGameWithDealer"]', '[onclick*="rollDice"]', '[onclick*="localPlayerReady"]', '[onclick*="confirmPlay"]']) {
  const ok = await clickInside(A, sel);
  if (ok) { console.log('点了 ' + sel); await sleep(1200); }
}
await sleep(1500);
console.log('推进后: ' + JSON.stringify(await st()));

// 找可出的牌并真点
const tiles = await A.eval('JSON.stringify((function(){var d=document.querySelector("iframe").contentDocument; var els=[].slice.call(d.querySelectorAll("[onclick*=\"playTile\"],[onclick*=\"confirmPlay\"],.tile,.domino-tile")); return {n:els.length, sample:els.slice(0,4).map(function(e){return {tag:e.tagName,cls:e.className,oc:(e.getAttribute("onclick")||"").slice(0,30)}})};})())');
console.log('可点牌: ' + tiles);
const before = (await st()).log;
const n = JSON.parse(tiles).n;
if (n > 0) {
  await A.eval('(function(){var d=document.querySelector("iframe").contentDocument; var e=[].slice.call(d.querySelectorAll("[onclick*=\"playTile\"],[onclick*=\"confirmPlay\"],.tile,.domino-tile"))[0]; if(e){e.click(); return true;} return false;})()');
  await sleep(2500);
}
const after = await st();
console.log('真点牌后: ' + JSON.stringify(after) + '  日志 ' + before + '→' + after.log);
console.log('报错 A=' + await A.consoleErrors() + ' B=' + await B.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
