import { connect, newPage, sleep, APP } from './lib.mjs';
const cdp = await connect();
const p = await newPage(cdp, APP);
await p.eval(`(() => {
  document.documentElement.innerHTML = '<body style="margin:0"><iframe id="f" style="width:100%;height:100%;border:0" src="/mini/rubik-anime-lab-0b0c6984/index.html"></iframe></body>';
  return 1;
})()`);
await sleep(4500);
console.log('PROBE ' + await p.eval(`(() => {
  const w = document.getElementById('f').contentWindow;
  const t = (code) => { try { return String(w.eval(code)); } catch (e) { return 'ERR:' + e.message.slice(0, 50); } };
  return JSON.stringify({
    api: t('typeof __cubeAPI'),
    apiKeys: t('(typeof __cubeAPI === "object" && __cubeAPI) ? JSON.stringify(Object.keys(__cubeAPI).slice(0, 30)) : "-"'),
    appKeys: t('(typeof __cubeApp === "object" && __cubeApp) ? JSON.stringify(Object.keys(__cubeApp).slice(0, 30)) : "-"'),
    fns: t('(typeof __cubeAPI === "object" && __cubeAPI) ? JSON.stringify(Object.keys(__cubeAPI).filter(function(k){return typeof __cubeAPI[k] === "function";})) : "-"'),
    gameState: t('(typeof gameState !== "undefined") ? typeof gameState : "undef"'),
    canvases: String(document.querySelectorAll("canvas").length),
  });
})()`));
await p.dispose(); cdp.close();
