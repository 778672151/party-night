// 我的修复是否让「新加入者」变慢？加入者应立刻看到大厅（而不是等 5 秒兜底）
import { connect, createRoom, sleep, newPage, APP } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
console.log('房主创建完成，房号=' + A.code + '，房主名单=' + await A.eval('JSON.stringify((PN.app.state.players||[]).map(p=>p.name))'));

const t0 = Date.now();
const B = await newPage(cdp, APP + '#' + A.code);
// 等页面就绪（有 #pn-name 才填）
await B.waitFor('#pn-name', 15000).catch(()=>{});
await B.fill('#pn-name', '阿泽');
await B.click('#pn-join');
// 等到加入者看到 2 人
let seen = null;
for (let i = 0; i < 120; i++) {
  const n = Number(await B.eval('(PN.app.state&&PN.app.state.players||[]).length'));
  if (n >= 2) { seen = Date.now() - t0; break; }
  await sleep(100);
}
console.log('加入者「看到 2 人」耗时: ' + (seen === null ? '>12s ✗' : seen + 'ms'));
console.log('加入者最终名单=' + await B.eval('JSON.stringify((PN.app.state.players||[]).map(p=>p.name))'));
console.log('房主最终名单=' + await A.eval('JSON.stringify((PN.app.state.players||[]).map(p=>p.name))'));
console.log('加入者 screen=' + await B.eval('PN.app.screenName') + ' mode=' + await B.eval('PN.app.state.mode'));
console.log('加入者报错=' + await B.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
