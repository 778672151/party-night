import { connect, newPage, APP, sleep } from '/home/zuoye/派对游戏/test/browser/lib.mjs';
const cdp = await connect();
const p = await newPage(cdp, APP);
await sleep(2000);
await p.eval('try{localStorage.clear()}catch(e){}');
await p.reload(); await sleep(2500);
await p.fill('#pn-name', '计时');
const t0 = Date.now();
await p.click('#pn-create');
let isHostMs = null, metaMs = null;
for (let i = 0; i < 400; i++) {
  const s = JSON.parse(await p.eval('JSON.stringify((()=>{try{const r=PN.app&&PN.app.room;return {meta: !!(r&&r.meta&&r.meta.host), isHost: !!(r&&r.isHost)};}catch(e){return {};}})())'));
  const ms = Date.now() - t0;
  if (metaMs === null && s.meta) metaMs = ms;
  if (isHostMs === null && s.isHost) { isHostMs = ms; break; }
  await sleep(100);
}
console.log('CLICK → meta 发布   : ' + metaMs + 'ms');
console.log('CLICK → 当选房主    : ' + isHostMs + 'ms   (v1.14.23 线上实测 20213ms)');
await p.dispose(); cdp.close();
