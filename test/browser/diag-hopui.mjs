// 量跳一跳界面的元素重叠（不靠肉眼）
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
await A.eval('PN.app.send({t:"start", mode:"hop"})');
await sleep(2500);

console.log('顶部区域结构: ' + await A.eval(`JSON.stringify((function(){
  var out=[];
  var root=document.querySelector('#pn-root');
  var kids=[].slice.call(root.children);
  kids.forEach(function(k){
    var r=k.getBoundingClientRect();
    out.push({cls:k.className||k.tagName, top:Math.round(r.top), bottom:Math.round(r.bottom), h:Math.round(r.height)});
  });
  return out;
})())`));

console.log('游戏头/提示卡/toast 位置: ' + await A.eval(`JSON.stringify((function(){
  var out={};
  var q=function(s){var e=document.querySelector(s); if(!e)return null; var r=e.getBoundingClientRect(); return {top:Math.round(r.top),bottom:Math.round(r.bottom),left:Math.round(r.left),right:Math.round(r.right)};};
  out.ghead = q('.ghead');
  out.gh = q('.ghead, .game-head');
  out.banner = q('.turn-banner, .my-turn, .card.turn');
  out.toast = q('.toast, .toasts .toast');
  out.cv = q('canvas.hop-cv');
  return out;
})())`));

// 重叠判定：找出所有互相重叠的可见块
console.log('重叠检测: ' + await A.eval(`JSON.stringify((function(){
  var els=[].slice.call(document.querySelectorAll('#pn-root *, .toasts *')).filter(function(e){
    var r=e.getBoundingClientRect(); return r.width>2&&r.height>2&&r.top>=0;
  });
  var bad=[];
  for(var i=0;i<els.length;i++)for(var j=i+1;j<els.length;j++){
    var a=els[i],b=els[j];
    if(a.contains(b)||b.contains(a))continue;
    var x=a.getBoundingClientRect(),y=b.getBoundingClientRect();
    var ov=Math.min(x.right,y.right)-Math.max(x.left,y.left);
    var op=Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top);
    if(ov>4&&op>4){
      // 只报「文字压文字」这类真错位，跳过容器包含 padding 的常见情况
      var at=(a.textContent||'').trim(), bt=(b.textContent||'').trim();
      if(at&&bt) bad.push({a:(a.className||a.tagName)+':'+at.slice(0,10), b:(b.className||b.tagName)+':'+bt.slice(0,10), opx:Math.round(ov), opy:Math.round(op)});
    }
  }
  return bad.slice(0,10);
})())`));
console.log('报错: ' + await A.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
