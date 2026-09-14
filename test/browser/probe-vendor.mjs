// 离线可用性验证：原作的 three 必须从本地 vendor/ 加载（不再依赖 jsdelivr）
//   node test/browser/probe-vendor.mjs
import { connect, newPage, sleep, assert, APP } from './lib.mjs';
const cdp = await connect();
const p = await newPage(cdp, APP);

await p.eval(`(() => {
  document.documentElement.innerHTML = '<body style="margin:0"><iframe id="f" style="width:100%;height:100%;border:0" src="/mini/plus-2265f7c6/index.html"></iframe></body>';
  return 1;
})()`);

let booted = false;
for (let i = 0; i < 70; i++) {
  booted = await p.eval('(() => { try { const w = document.getElementById("f").contentWindow; return !!(w && w.tallgrass && w.tallgrass.puzzle); } catch (e) { return false; } })()');
  if (booted) break;
  await sleep(500);
}
assert(booted, '改成本地 three 之后，原作仍然能 boot');

const res = JSON.parse(await p.eval(`(() => {
  const w = document.getElementById('f').contentWindow;
  const list = w.performance.getEntriesByType('resource').map(r => r.name);
  return JSON.stringify({
    vendor: list.filter(n => n.includes('/vendor/')).length,
    jsdelivr: list.filter(n => n.includes('jsdelivr')).length,
    hdr: list.filter(n => /polyhaven|\.hdr/i.test(n)).length,
    threeUrl: (list.find(n => n.includes('three.module')) || '(没找到)').replace(w.location.origin, ''),
    addonUrl: (list.find(n => /RGBELoader|HDRLoader/.test(n)) || '(没找到)').replace(w.location.origin, ''),
  });
})()`));
console.log('\n=== 离线加载验证 ===');
console.log('  three    : ' + res.threeUrl);
console.log('  addon    : ' + res.addonUrl);
console.log('  本地 vendor 资源: ' + res.vendor + ' 个');
console.log('  jsdelivr 资源   : ' + res.jsdelivr + ' 个（必须为 0）');
console.log('  天空 HDR        : ' + res.hdr + ' 个（外部，缺了要有兜底）');
assert(res.jsdelivr === 0, 'three/addon 已全部走本地，jsdelivr 请求为 0');
assert(res.vendor > 0, '确实从 vendor/ 加载了 ' + res.vendor + ' 个资源');
await p.dispose(); cdp.close();
