// 用 lib 自带的真实 click()（内部会 scrollIntoView）确认小游戏浮层：真人能否打开/关闭
import { connect, createRoom, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
await sleep(1800);
// 展开小游戏厅
await A.click('.mini-sec .mini-head');
await sleep(800);
console.log('展开后卡片数: ' + await A.eval('document.querySelectorAll(".mini-card").length'));
const err0 = JSON.parse(await A.consoleErrors());
await A.click('.mini-card');            // 真实点击（内部先滚动到可见）
await sleep(2000);
const st = await A.eval('JSON.stringify({ov:!!document.querySelector(".mini-ov"),title:(document.querySelector(".mini-title")||{}).textContent||null,src:(document.querySelector(".mini-frame")||{}).src||null})');
console.log('真点第一张小游戏卡 → ' + st);
// iframe 是否真的加载起来了
await sleep(3000);
console.log('iframe 状态: ' + await A.eval('JSON.stringify({src:(document.querySelector(".mini-frame")||{}).src||"",loaded:(()=>{const f=document.querySelector(".mini-frame"); return !!(f&&f.contentDocument&&f.contentDocument.body&&f.contentDocument.body.children.length>0);})()})'));
// 关闭
await A.click('#mini-close');
await sleep(900);
console.log('点返回大厅 → ' + await A.eval('JSON.stringify({ov:!!document.querySelector(".mini-ov"),cards:document.querySelectorAll(".modecard").length,mini:document.querySelectorAll(".mini-card").length,mode:PN.app.state.mode})'));
const err1 = JSON.parse(await A.consoleErrors());
console.log('报错: 之前 ' + err0.length + ' → 之后 ' + err1.length + (err1.length ? ' 例:' + err1[0] : ''));
await A.dispose(); cdp.close();
