import { connect, newPage, sleep } from '/home/zuoye/派对游戏/test/browser/lib.mjs';
const cdp = await connect();
const p = await newPage(cdp, 'https://778672151.github.io/party-night/?cachebust=' + Date.now());
await sleep(3500);
await p.eval('try{localStorage.clear()}catch(e){}');
await p.reload(); await sleep(3000);
const ver = await p.eval('(document.querySelector(\'meta[name=pn-version]\')||{}).content');
console.log('线上产物版本 =', ver);
await p.fill('#pn-name', '线上计时');
const t0 = Date.now();
await p.click('#pn-create');
let isHostMs = null;
for (let i = 0; i < 400; i++) {
  if (await p.eval('!!(PN.app&&PN.app.room&&PN.app.room.isHost)')) { isHostMs = Date.now() - t0; break; }
  await sleep(100);
}
console.log('LIVE 线上 CLICK → 当选房主 : ' + isHostMs + 'ms   (修复前实测 20213ms)');
console.log(isHostMs !== null && isHostMs < 10000 ? '✅ 修复已在线生效' : '❌ 仍未生效');
await p.dispose(); cdp.close();
