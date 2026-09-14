import { connect, newPage, sleep, APP } from './lib.mjs';
const cdp = await connect();
const p = await newPage(cdp, APP);
await p.eval(`(() => {
  document.documentElement.innerHTML = '<body style="margin:0"><iframe id="f" style="width:100%;height:100%;border:0" src="/mini/demo-29b78d69/index.html"></iframe></body>';
  return 1;
})()`);
await sleep(4000);
console.log('PROBE ' + await p.eval(`(() => {
  const w = document.getElementById('f').contentWindow;
  const d = document.getElementById('f').contentDocument;
  const out = {};
  const t = (code) => { try { return String(w.eval(code)); } catch (e) { return 'ERR:' + e.message.slice(0, 40); } };
  out.typeofC = t('typeof C');
  out.typeofGame = t('typeof game');
  out.typeofPlayMove = t('typeof playMove');
  out.n = t('(typeof game !== "undefined" && game) ? game.n : -1');
  out.moves = t('(typeof game !== "undefined" && game) ? game.moves.length : -1');
  out.lsKeys = t('JSON.stringify(Object.keys(localStorage))');
  out.canvas = d ? d.querySelectorAll('canvas').length : -1;
  return JSON.stringify(out);
})()`));
console.log('ERRORS ' + await p.consoleErrors());
await p.dispose(); cdp.close();
