// 排查小游戏卡点不动：是坐标在视口外，还是真有东西挡住
import { connect, createRoom, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
await sleep(1500);
await A.eval('(()=>{const s=document.querySelector(".mini-sec"); if(s&&s.classList.contains("collapsed")){const h=s.querySelector(".mini-head"); if(h)h.click();} return true;})()');
await sleep(800);

console.log('视口: ' + await A.eval('JSON.stringify({iw:innerWidth,ih:innerHeight,scrollY:Math.round(scrollY)})'));
const box = await A.box('.mini-card[data-mini]');
console.log('卡片 box: ' + JSON.stringify(box));

// 滚到卡片可见
await A.eval('document.querySelector(".mini-card[data-mini]").scrollIntoView({block:"center"})');
await sleep(600);
const box2 = await A.box('.mini-card[data-mini]');
console.log('滚动后 box: ' + JSON.stringify(box2) + '  视口内? ' + (box2 && box2.y >= 0 && box2.y <= 600 ? '是' : '否'));

// 命中测试：这个点的最上层元素是谁？
const hit = await A.eval('(()=>{const c=document.querySelector(".mini-card[data-mini]"); const r=c.getBoundingClientRect(); const x=r.left+r.width/2, y=r.top+r.height/2; const el=document.elementFromPoint(x,y); return JSON.stringify({x:Math.round(x),y:Math.round(y),top:el?(el.className||el.tagName):null, isCard: !!(el&&el.closest(".mini-card")), pointerEvents: getComputedStyle(c).pointerEvents});})()');
console.log('命中测试: ' + hit);

// 真点击（滚动后）
if (box2 && box2.y >= 0 && box2.y <= 600) {
  const x = box2.x + box2.w / 2, y = box2.y + box2.h / 2;
  await A.mouse('mouseMoved', x, y, { button: 'none' });
  await A.mouse('mousePressed', x, y, { buttons: 1 });
  await A.mouse('mouseReleased', x, y, { buttons: 0 });
  await sleep(1600);
}
console.log('点击后: ' + await A.eval('JSON.stringify({ov:!!document.querySelector(".mini-ov"),title:(document.querySelector(".mini-title")||{}).textContent||null})'));
await A.dispose(); cdp.close();
