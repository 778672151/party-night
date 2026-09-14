// 诊断：three 切本地后原作为什么起不来（用 CDP 的 console/异常域，可靠）
import { connect, newPage, sleep, APP } from './lib.mjs';
const cdp = await connect();
const p = await newPage(cdp, APP);
await p.eval(`(() => {
  document.documentElement.innerHTML = '<body style="margin:0"><iframe id="f" style="width:100%;height:100%;border:0" src="/mini/plus-2265f7c6/index.html"></iframe></body>';
  return 1;
})()`);
await sleep(13000);
const st = JSON.parse(await p.eval(`(() => {
  const f = document.getElementById('f');
  let w = null; try { w = f.contentWindow; } catch (e) {}
  const d = f.contentDocument;
  let boot = '';
  try {
    const el = d.querySelector('[class*=boot], #boot, .boot');
    boot = el ? el.innerText.replace(/\s+/g, ' ').slice(0, 120) : '(没有启动遮罩)';
  } catch (e) { boot = 'err ' + e.message; }
  return JSON.stringify({
    booted: !!(w && w.tallgrass && w.tallgrass.puzzle),
    readyState: d ? d.readyState : '?',
    boot: boot,
    scripts: d ? d.querySelectorAll('script').length : -1,
  });
})()`));
console.log('STATE ' + JSON.stringify(st));
console.log('ERRORS ' + await p.consoleErrors());
await p.dispose(); cdp.close();
