// 对照实验：CDN three vs 本地 three
import { connect, newPage, sleep, APP } from './lib.mjs';
const cdp = await connect();
const p = await newPage(cdp, APP);
await p.eval(`(function(){ document.documentElement.innerHTML = '<body style="margin:0"><iframe id="f" style="width:100%;height:100%;border:0" src="/mini/plus-2265f7c6/index.html?cb=' + Math.random() + '"></iframe></body>'; return 1; })()`);
await sleep(13000);
const st = await p.eval(`(function(){
  var f = document.getElementById('f');
  var w = f.contentWindow, d = f.contentDocument;
  var booted = false;
  try { booted = !!(w.tallgrass && w.tallgrass.puzzle); } catch (e) {}
  var boot = '';
  try { var el = d.querySelector('.boot'); if (el && el.innerText) boot = el.innerText.slice(0, 80); } catch (e) {}
  var res = [];
  try { res = w.performance.getEntriesByType('resource').map(function(r){ return r.name; }); } catch (e) {}
  function cnt(s){ var n = 0; for (var i = 0; i < res.length; i++) if (res[i].indexOf(s) >= 0) n++; return n; }
  return JSON.stringify({ booted: booted, boot: boot, vendor: cnt('/vendor/'), cdn: cnt('jsdelivr'), hdr: cnt('.hdr'), n: res.length });
})()`);
console.log('RESULT ' + st);
console.log('ERRORS ' + await p.consoleErrors());
await p.dispose(); cdp.close();
