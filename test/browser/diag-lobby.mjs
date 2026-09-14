import { connect, newPage, sleep, APP } from './lib.mjs';
const cdp = await connect();
const p = await newPage(cdp, APP);
await sleep(2500);
const out = await p.eval(`(function(){
  var c = document.querySelector('.modecard') || document.querySelector('.mini-card');
  if (!c) return 'no card';
  var ico = c.querySelector('.gc-ico');
  var wrap = ico ? ico.parentElement : null;
  function d(el){ if(!el) return '-'; var s = getComputedStyle(el); return el.className + '[' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height) + ' bg=' + s.backgroundColor + ' radius=' + s.borderRadius + ' border=' + s.borderTopWidth + ' shadow=' + (s.boxShadow||'').slice(0,40) + ']'; }
  return 'card=' + d(c) + ' || wrap=' + d(wrap) + ' || ico=' + d(ico) + ' || wrapHTML=' + (wrap ? wrap.outerHTML.slice(0, 160) : '-');
})()`);
console.log('LOBBY ' + out);
await p.dispose(); cdp.close();
