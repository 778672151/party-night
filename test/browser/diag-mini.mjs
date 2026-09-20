// 诊断：小游戏浮层到底能不能打开（我的测试点错了元素？还是真打不开？）
import { connect, createRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
await sleep(1500);

// 展开小游戏厅
await A.eval('(()=>{const s=document.querySelector(".mini-sec"); if(s&&s.classList.contains("collapsed")){const h=s.querySelector(".mini-head"); if(h)h.click();} return true;})()');
await sleep(800);
const info = JSON.parse(await A.eval('JSON.stringify({cards:document.querySelectorAll(".mini-card").length, firstId:(document.querySelector(".mini-card")||{}).dataset?document.querySelector(".mini-card").dataset.mini:null, visible:(()=>{const c=document.querySelector(".mini-card"); if(!c)return null; const r=c.getBoundingClientRect(); return {w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top)};})()})'));
console.log('小游戏卡片: ' + JSON.stringify(info));

// 用真实元素点击（按 handler 用的 dataset.mini 找卡片）
const before = JSON.parse(await A.consoleErrors());
await A.eval('(()=>{const c=document.querySelector(".mini-card[data-mini]"); if(!c) return "noc"; c.click(); return "ok";})()');
await sleep(1500);
const opened = await A.eval('JSON.stringify({overlay:!!document.querySelector(".overlay"), title:(document.querySelector(".overlay .modal h3, .overlay h3, .overlay .mtitle")||{}).textContent||null, iframe:!!document.querySelector(".overlay iframe"), body:document.querySelectorAll(".overlay *").length})');
console.log('点击 .mini-card[data-mini] 后: ' + opened);
const after = JSON.parse(await A.consoleErrors());
console.log('新增报错: ' + (after.length - before.length) + (after.length ? '  例:' + after[after.length-1] : ''));

// 关掉浮层，确认大厅完好
await A.eval('(()=>{const b=document.querySelector(".overlay .ov-close, .overlay .close, .overlay [data-act=close]"); if(b){b.click(); return "closed-by-btn";} const o=document.querySelector(".overlay"); if(o){o.remove(); return "removed";} return "none";})()');
await sleep(600);
console.log('关闭后: ' + await A.eval('JSON.stringify({overlay:!!document.querySelector(".overlay"),cards:document.querySelectorAll(".modecard").length,mini:document.querySelectorAll(".mini-card").length})'));
await A.dispose(); cdp.close();
