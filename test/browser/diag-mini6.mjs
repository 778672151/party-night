// 精确判定：真鼠标点击时，事件到底落在谁身上（打印 elementFromPoint 与 CDP 命中）
import { connect, createRoom, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
await sleep(2000);
await A.eval('(()=>{const s=document.querySelector(".mini-sec"); if(s&&s.classList.contains("collapsed")){const h=s.querySelector(".mini-head"); if(h)h.click();} return true;})()');
await sleep(1000);

// 用一个「事件捕获器」记录 document 上所有 click 的 target
await A.eval(`(()=>{ window.__log=[]; document.addEventListener('click', function(e){ window.__log.push((e.target.className||e.target.tagName)+''); }, true); return true; })()`);

await A.eval('document.querySelector(".mini-card").scrollIntoView({block:"center"})');
await sleep(600);
const b = await A.box('.mini-card');
console.log('box after scroll: ' + JSON.stringify(b));
const x = b.x + b.w / 2, y = b.y + b.h / 2;
console.log('点击坐标: ' + Math.round(x) + ',' + Math.round(y) + '  视口高=' + await A.eval('innerHeight'));

// 这个点在页面坐标系里是谁
console.log('elementFromPoint: ' + await A.eval('(()=>{const el=document.elementFromPoint(' + Math.round(x) + ',' + Math.round(y) + '); return el? (el.className||el.tagName)+' + JSON.stringify(' | closest-mini-card=') + '+!!el.closest(".mini-card") : "null";})()'));

await A.mouse('mouseMoved', x, y, { button: 'none' });
await A.mouse('mousePressed', x, y, { buttons: 1 });
await A.mouse('mouseReleased', x, y, { buttons: 0 });
await sleep(1000);
console.log('document 收到的 click target: ' + await A.eval('JSON.stringify(window.__log)'));
console.log('浮层: ' + await A.eval('!!document.querySelector(".mini-ov")'));

// 对照：直接用 DOM click() 能不能开
await A.eval('document.querySelector(".mini-card").click()');
await sleep(800);
console.log('DOM .click() 后浮层: ' + await A.eval('!!document.querySelector(".mini-ov")') + '  日志=' + await A.eval('JSON.stringify(window.__log.slice(-2))'));
await A.dispose(); cdp.close();
