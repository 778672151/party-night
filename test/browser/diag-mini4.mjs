// 为什么 handler 不生效：查 card.dataset.mini 是否有值、Banks.mini() 能否查到
import { connect, createRoom, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
await sleep(1500);
await A.eval('(()=>{const s=document.querySelector(".mini-sec"); if(s&&s.classList.contains("collapsed")){const h=s.querySelector(".mini-head"); if(h)h.click();} return true;})()');
await sleep(800);
console.log(await A.eval(`JSON.stringify((()=>{
  const c = document.querySelector('.mini-card');
  const banks = (PN.Banks && PN.Banks.mini) ? PN.Banks.mini() : null;
  return {
    cls: c && c.className,
    dataset: c ? JSON.parse(JSON.stringify(c.dataset)) : null,
    attrMini: c ? c.getAttribute('data-mini') : null,
    attrMiniShow: c ? c.getAttribute('data-mini-show') : null,
    banksLen: banks ? banks.length : null,
    banksFirst: banks && banks[0] ? {id: banks[0].id, dir: banks[0].dir, title: banks[0].title} : null,
    matchFound: !!(banks && banks.filter(function(x){return x.id === (c && c.dataset.mini)})[0])
  };
})())`));
// 手动直接调用 openMini 看它是否本身能工作
console.log('直接调用 openMini: ' + await A.eval('(()=>{ try{ const m=(PN.Banks.mini()||[])[0]; PN.app.openMini(m); return "called:"+!!document.querySelector(".mini-ov"); }catch(e){ return "throw:"+e.message; } })()'));
await sleep(1200);
console.log('调用后浮层: ' + await A.eval('JSON.stringify({ov:!!document.querySelector(".mini-ov"), title:(document.querySelector(".mini-title")||{}).textContent||null, src:(document.querySelector(".mini-frame")||{}).src||null})'));
await A.dispose(); cdp.close();
