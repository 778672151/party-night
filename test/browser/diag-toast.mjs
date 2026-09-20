// 验证：提示条不再压住游戏头；且不会撞到底部输入条
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);

const probe = (p) => p.eval(`JSON.stringify((function(){
  var t=document.querySelector('.toast');
  var gh=document.querySelector('.ghead');
  var ib=document.querySelector('.inputbar');
  var r=function(e){if(!e)return null;var b=e.getBoundingClientRect();return {top:Math.round(b.top),bottom:Math.round(b.bottom)};};
  var tr=r(t), gr=r(gh), ir=r(ib);
  var ov=function(a,b){if(!a||!b)return 0;return Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));};
  return {toast:tr, ghead:gr, inputbar:ir, overlapGhead:ov(tr,gr), overlapInput:ov(tr,ir)};
})())`).then(JSON.parse);

// 逐个游戏类型测：hop（游戏头）、drawgame（游戏头+底部输入条）
for (const mode of ['hop', 'drawgame']) {
  await A.eval('PN.app.send({t:"lobby"})'); await sleep(900);
  await A.eval('PN.app.send({t:"start", mode:' + JSON.stringify(mode) + '})');
  await sleep(3000);
  // 触发一条 toast
  await A.eval('PN.app.toast && PN.app.toast("测试提示条位置","info")');
  await sleep(500);
  const r = await probe(A);
  console.log(mode + ': toast=' + JSON.stringify(r.toast) + ' ghead=' + JSON.stringify(r.ghead) + ' inputbar=' + JSON.stringify(r.inputbar));
  console.log('   与游戏头重叠=' + r.overlapGhead + 'px  与输入条重叠=' + r.overlapInput + 'px  → ' + (r.overlapGhead === 0 ? '✓ 不压游戏头' : '✗ 仍压住') + ' / ' + (r.overlapInput === 0 ? '✓ 不撞输入条' : '✗ 撞输入条'));
}
console.log('报错: ' + await A.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
