// 默契大考验的单人局：一个人点开始 → 配机器人 → 机器人会作答 → 能打完
//   node test/browser/bot-tacit.mjs
import { connect, createRoom, waitPlayers, sleep } from './lib.mjs';

const cdp = await connect();
const A = await createRoom(cdp, '小桃');
await waitPlayers(A, 1);
let failed = 0;
const check = (c, m) => { if (c) console.log('  ✓ ' + m); else { failed++; console.log('  ✗ ' + m); } };

console.log('=== 1. 默认设置是 8 题，单人点开始应配机器人开起来 ===');
await A.eval('(function(){var c=document.querySelector(\'.gcard[data-mode="tacit"]\');c.querySelector(\'[data-act="start"]\').click();return true;})()');
let ready = false;
for (let i = 0; i < 60; i++) {
  ready = await A.eval('PN.app.screenName==="tacit" && !!PN.app.state.g && !!PN.app.state.g.cur');
  if (ready) break;
  await sleep(400);
}
check(ready, '一个人真的开起了默契大考验');
const st = JSON.parse(await A.eval('JSON.stringify({mode:PN.app.state.mode,bots:(PN.app.state.players||[]).filter(p=>p.bot).map(p=>p.name),gp:(PN.app.state.g||{}).players,opts:((PN.app.state.g||{}).cur||{}).options,phase:((PN.app.state.g||{}).cur||{}).phase})'));
console.log('  mode=' + st.mode + ' 机器人=' + JSON.stringify(st.bots) + ' options=' + (st.opts || []).length + ' phase=' + st.phase);
check(st.mode === 'tacit', '进的是默契游戏');
check(st.bots.length === 1, '配了 1 个机器人（' + JSON.stringify(st.bots) + '）');
check(String(st.gp.join(',')).indexOf('bot:') >= 0, '机器人进了 g.players');

console.log('=== 2. 机器人会自己作答（不等真人）===');
// 真人在页面上真点一个选项
// 选项按钮是 .tac-opt（screens-tacit.js:62），**没有** data-i 属性，序号就是它在列表里的位置。
// 已选过的会带 .chosen 且自己那端是 .dim（不能点）—— 这里挑第一个可点的。
const clicked = await A.eval('(function(){var es=[].slice.call(document.querySelectorAll(".tac-opt"));for(var i=0;i<es.length;i++){if(!es[i].classList.contains("dim")){es[i].click();return "clicked:"+i;}}return "none";})()');
console.log('  真人点选 → ' + clicked);
check(clicked !== 'none', '真人的选项可点');
// 等这一题被揭晓（answer → reveal），说明两边都答了
let revealed = false;
for (let i = 0; i < 50; i++) {
  const ph = await A.eval('((PN.app.state.g||{}).cur||{}).phase');
  if (ph === 'reveal') { revealed = true; break; }
  if (ph === null || ph === undefined) break;
  await sleep(500);
}
check(revealed, '这一题进入了揭晓阶段（说明机器人也答了）');
if (revealed) {
  const rev = JSON.parse(await A.eval('JSON.stringify(((PN.app.state.g||{}).cur||{}).reveal||{})'));
  const names = (rev.picks || []).map(p => p.name + '=' + p.label);
  console.log('  揭晓：' + JSON.stringify(names) + ' match=' + rev.match);
  const botPick = (rev.picks || []).filter(p => String(p.id).indexOf('bot:') === 0)[0];
  check(!!botPick, '揭晓里能看到机器人的作答');
  check(botPick && botPick.i >= 0, '机器人答的是合法选项（i=' + (botPick ? botPick.i : '无') + '）');
}

console.log('=== 3. 机器人不抢答、每题只答一次 ===');
const answered = JSON.parse(await A.eval('JSON.stringify(Object.keys(((PN.app.state.g||{}).cur||{}).answered||{}).filter(function(k){return k.indexOf("bot:")===0;}))'));
check(answered.length <= 1, '机器人这题最多记一次作答（实际 ' + answered.length + '）');

console.log('=== 4. 无 JS 报错 ===');
const errs = JSON.parse(await A.consoleErrors());
check(errs.length === 0, '全程无 JS 报错' + (errs[0] ? ' 例:' + errs[0] : ''));

await A.dispose(); cdp.close();
console.log(failed ? '\nBOT-TACIT 有 ' + failed + ' 项未通过' : '\nBOT-TACIT 全部通过');
process.exit(failed ? 1 : 0);
