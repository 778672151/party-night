import { connect, newPage, sleep, APP } from './lib.mjs';
const cdp = await connect();
const p = await newPage(cdp, APP);
await p.eval(`(function(){ document.documentElement.innerHTML = '<body style="margin:0"><iframe id="f" style="width:100%;height:100%;border:0" src="/mini/3d-754ac5bb/index.html"></iframe></body>'; return 1; })()`);
await sleep(5000);
const out = await p.eval(`(function(){
  var w = document.getElementById('f').contentWindow;
  var t = function(code){ try { return String(w.eval(code)); } catch (e) { return 'ERR:' + e.message.slice(0, 45); } };
  return JSON.stringify({
    maze: t('typeof __MAZE__'),
    keys: t('typeof __MAZE__ === "object" ? JSON.stringify(Object.keys(__MAZE__)) : "-"'),
    fns: t('typeof __MAZE__ === "object" ? JSON.stringify(Object.keys(__MAZE__).filter(function(k){ return typeof __MAZE__[k] === "function"; })) : "-"'),
    canvases: w.document.querySelectorAll('canvas').length
  });
})()`);
console.log('MAZE ' + out);
console.log('ERRORS ' + await p.consoleErrors());
await p.dispose(); cdp.close();
