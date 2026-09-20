// 精确诊断：真点围棋棋盘时，事件到底落在哪、有没有到 canvas
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
await A.eval('PN.app.send({t:"start", mode:"go"})');
await sleep(3800);

const info = JSON.parse(await A.eval(`JSON.stringify((function(){
  var f=document.querySelector('iframe'); var d=f.contentDocument;
  var cv=d.querySelector('canvas');
  var fr=f.getBoundingClientRect(), cr=cv.getBoundingClientRect();
  return {frame:{x:Math.round(fr.x),y:Math.round(fr.y),w:Math.round(fr.width),h:Math.round(fr.height)},
          canvasAbs:{x:Math.round(fr.x+cr.left),y:Math.round(fr.y+cr.top),w:Math.round(cr.width),h:Math.round(cr.height)},
          canvasRect:{l:Math.round(cr.left),t:Math.round(cr.top),w:Math.round(cr.width),h:Math.round(cr.height)},
          scrollY:Math.round(scrollY), innerH:innerHeight,
          goStage:(function(){var e=document.querySelector('.go-stage');if(!e)return null;var r=e.getBoundingClientRect();return {y:Math.round(r.y),h:Math.round(r.height)}})()};
})())`));
console.log('几何: ' + JSON.stringify(info));
console.log('画布绝对位置 y=' + info.canvasAbs.y + ' 高=' + info.canvasAbs.h + ' 视口高=' + info.innerH + '  → ' + (info.canvasAbs.y + info.canvasAbs.h <= info.innerH ? '完整可见' : '超出视口下方（' + (info.canvasAbs.y + info.canvasAbs.h - info.innerH) + 'px 看不见）') );

// 记录 document 上的 click 落点
await A.eval('window.__clk=[]; document.addEventListener("click",function(e){window.__clk.push((e.target.className||e.target.tagName)+"@"+Math.round(e.clientY))},true)');
// 真点画布正中心
const cx = info.canvasAbs.x + info.canvasAbs.w / 2, cy = info.canvasAbs.y + info.canvasAbs.h / 2;
console.log('点 (' + Math.round(cx) + ',' + Math.round(cy) + ')');
await A.mouse('mouseMoved', cx, cy, { button: 'none' });
await A.mouse('mousePressed', cx, cy, { buttons: 1, button: 'left', clickCount: 1 });
await A.mouse('mouseReleased', cx, cy, { buttons: 0, button: 'left', clickCount: 1 });
await sleep(1200);
console.log('主文档收到的 click: ' + await A.eval('JSON.stringify(window.__clk)'));
console.log('日志=' + await A.eval('(PN.app.state.g.log||[]).length'));

// 对照：把 iframe 滚进视野后再点
await A.eval('document.querySelector(".sk-stage").scrollIntoView({block:"center"})');
await sleep(800);
const info2 = JSON.parse(await A.eval(`JSON.stringify((function(){var f=document.querySelector('iframe');var d=f.contentDocument;var cv=d.querySelector('canvas');var fr=f.getBoundingClientRect(),cr=cv.getBoundingClientRect();
  return {canvasAbs:{x:Math.round(fr.x+cr.left),y:Math.round(fr.y+cr.top),w:Math.round(cr.width),h:Math.round(cr.height)},innerH:innerHeight};})())`));
console.log('滚动后画布: ' + JSON.stringify(info2));
const cx2 = info2.canvasAbs.x + info2.canvasAbs.w / 2, cy2 = info2.canvasAbs.y + info2.canvasAbs.h / 2;
await A.mouse('mouseMoved', cx2, cy2, { button: 'none' });
await A.mouse('mousePressed', cx2, cy2, { buttons: 1, button: 'left', clickCount: 1 });
await A.mouse('mouseReleased', cx2, cy2, { buttons: 0, button: 'left', clickCount: 1 });
await sleep(1500);
console.log('滚动后真点中心 → 日志=' + await A.eval('(PN.app.state.g.log||[]).length'));
console.log('iframe 内是否也记录到 click: ' + await A.eval('(function(){try{return "err"}catch(e){return e.message}})()'));
console.log('报错: ' + await A.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
