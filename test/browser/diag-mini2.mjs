// 用真鼠标点击 + 正确选择器（.mini-ov）确认小游戏浮层
import { connect, createRoom, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
await sleep(1500);
await A.eval('(()=>{const s=document.querySelector(".mini-sec"); if(s&&s.classList.contains("collapsed")){const h=s.querySelector(".mini-head"); if(h)h.click();} return true;})()');
await sleep(800);

// 真鼠标点第一张小游戏卡
const box = await A.box('.mini-card[data-mini]');
console.log('第一张小游戏卡位置: ' + JSON.stringify(box));
if (box) { await A.mouse('mouseMoved', box.x + box.w / 2, box.y + box.h / 2, { button: 'none' }); await A.mouse('mousePressed', box.x + box.w / 2, box.y + box.h / 2, { buttons: 1 }); await A.mouse('mouseReleased', box.x + box.w / 2, box.y + box.h / 2, { buttons: 0 }); }
await sleep(1600);
console.log('真鼠标点击后: ' + await A.eval('JSON.stringify({ov:!!document.querySelector(".mini-ov"),title:(document.querySelector(".mini-title")||{}).textContent||null,src:(document.querySelector(".mini-frame")||{}).src||null})'));
// 等 iframe 真的加载
await sleep(2500);
console.log('iframe 加载后: ' + await A.eval('JSON.stringify({ov:!!document.querySelector(".mini-ov"),src:((document.querySelector(".mini-frame")||{}).src||"").split("/").slice(-2).join("/"),ready:(()=>{try{return !!document.querySelector(".mini-frame").contentDocument}catch(e){return "cross"}})()})'));
// 点「返回大厅」
const cb = await A.box('#mini-close');
if (cb) { await A.mouse('mouseMoved', cb.x + cb.w / 2, cb.y + cb.h / 2, { button: 'none' }); await A.mouse('mousePressed', cb.x + cb.w / 2, cb.y + cb.h / 2, { buttons: 1 }); await A.mouse('mouseReleased', cb.x + cb.w / 2, cb.y + cb.h / 2, { buttons: 0 }); }
await sleep(900);
console.log('点返回后: ' + await A.eval('JSON.stringify({ov:!!document.querySelector(".mini-ov"),cards:document.querySelectorAll(".modecard").length,mini:document.querySelectorAll(".mini-card").length,mode:PN.app.state.mode})'));
console.log('报错: ' + await A.consoleErrors());
await A.dispose(); cdp.close();
