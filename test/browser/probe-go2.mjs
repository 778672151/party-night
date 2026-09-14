import { connect, newPage, sleep, APP } from './lib.mjs';
const cdp = await connect();
const p = await newPage(cdp, APP);
await p.eval(`(() => {
  document.documentElement.innerHTML = '<body style="margin:0"><iframe id="f" style="width:100%;height:100%;border:0" src="/mini/demo-29b78d69/index.html"></iframe></body>';
  return 1;
})()`);
await sleep(4500);
console.log('PROBE ' + await p.eval(`(() => {
  const w = document.getElementById('f').contentWindow;
  const t = (code) => { try { return String(w.eval(code)); } catch (e) { return 'ERR:' + e.message.slice(0, 40); } };
  return JSON.stringify({
    typeofYiApp: t('typeof YiApp'),
    yiKeys: t('(typeof YiApp === "object" && YiApp) ? JSON.stringify(Object.keys(YiApp).slice(0, 24)) : "-"'),
    yiMethods: t('(typeof YiApp === "object" && YiApp) ? JSON.stringify(Object.keys(YiApp).filter(function(k){return typeof YiApp[k] === "function";}).slice(0, 24)) : "-"'),
    hasState: t('(typeof YiApp === "object" && YiApp && YiApp.state) ? JSON.stringify(Object.keys(YiApp.state).slice(0, 16)) : "-"'),
  });
})()`));
await p.dispose(); cdp.close();
