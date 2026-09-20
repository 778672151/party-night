// 判定：是「监听器没绑」还是「绑了但后来 DOM 被重建掉了」
import { connect, createRoom, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
await sleep(2000);
await A.eval('(()=>{const s=document.querySelector(".mini-sec"); if(s&&s.classList.contains("collapsed")){const h=s.querySelector(".mini-head"); if(h)h.click();} return true;})()');
await sleep(1000);

// 在卡片上装一个探针，看点击事件到底有没有到卡片
await A.eval(`(()=>{ window.__hits=0; const c=document.querySelector('.mini-card'); if(c) c.addEventListener('click', function(){ window.__hits++; }, true); return true; })()`);

// 记录当前卡片节点身份，10 秒后再看是不是同一个节点
const idBefore = await A.eval('(()=>{const c=document.querySelector(".mini-card"); window.__c=c; return c?c.dataset.mini:null;})()');
console.log('节点 id=' + idBefore);
await sleep(10000);
const same = await A.eval('document.querySelector(".mini-card")===window.__c');
console.log('10 秒后还是同一个 DOM 节点吗: ' + same + (same ? '  → 监听器应该还在' : '  → DOM 被重建了！监听器丢失'));

// 现在真点一下
await A.eval('document.querySelector(".mini-card").scrollIntoView({block:"center"})');
await sleep(500);
const b = await A.box('.mini-card');
const x = b.x + b.w / 2, y = b.y + b.h / 2;
await A.mouse('mouseMoved', x, y, { button: 'none' });
await A.mouse('mousePressed', x, y, { buttons: 1 });
await A.mouse('mouseReleased', x, y, { buttons: 0 });
await sleep(1200);
console.log('点击后: 探针命中=' + await A.eval('window.__hits') + ' 浮层=' + await A.eval('!!document.querySelector(".mini-ov")'));
console.log('说明: 探针命中但浮层没开 = 大厅的监听器丢了; 探针也没命中 = 事件没到卡片');
await A.dispose(); cdp.close();
