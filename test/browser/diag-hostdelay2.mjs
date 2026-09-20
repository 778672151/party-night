// 复核：用稳定的 createRoom（它内部会等 roomcode/connected/meta）成功后，再看「名单里有没有自己」
import { connect, createRoom, sleep, newPage, APP } from './lib.mjs';
const cdp = await connect();

// A) 稳定路径：createRoom 自己会等 meta 发布
const t0 = Date.now();
const A = await createRoom(cdp, '小桃');
console.log('createRoom 成功耗时 ' + (Date.now() - t0) + 'ms，房号=' + A.code);
// 立刻读名单
const snap = JSON.parse(await A.eval('JSON.stringify({isHost:PN.app.room.isHost,players:(PN.app.state.players||[]).map(p=>p.name),hostState:!!(PN.app.host&&PN.app.host.state),meta:!!(PN.app.room.meta&&PN.app.room.meta.host)})'));
console.log('createRoom 返回后立刻读：isHost=' + snap.isHost + ' meta=' + snap.meta + ' hostState=' + snap.hostState + ' players=' + JSON.stringify(snap.players));
// 再等到名单里有自己
let waited = null;
for (let i = 0; i < 120; i++) {
  const n = Number(await A.eval('(PN.app.state.players||[]).length'));
  if (n >= 1) { waited = i * 100; break; }
  await sleep(100);
}
console.log('再等 ' + (waited === null ? '>12000ms 仍未出现 ✗' : waited + 'ms 后名单=' + JSON.stringify(JSON.parse(await A.eval('JSON.stringify((PN.app.state.players||[]).map(p=>p.name))')))));
console.log('最终界面显示：' + await A.eval('(document.body.innerText||"").replace(/\n/g," | ").slice(0,140)'));
await A.dispose(); cdp.close();
