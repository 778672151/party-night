// 用稳定的 joinRoom 复核：加入者到底有没有进名单；并抓两端控制台报错
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
console.log('房主房号=' + A.code + '，房主端名单=' + await A.eval('JSON.stringify((PN.app.state.players||[]).map(p=>p.name))'));

const t0 = Date.now();
const B = await joinRoom(cdp, '阿泽', A.code);   // 内部会等 room.code 与 connected
console.log('joinRoom 返回，耗时 ' + (Date.now() - t0) + 'ms');
for (let i = 0; i < 12; i++) {
  await sleep(500);
  const a = await A.eval('JSON.stringify((PN.app.state.players||[]).map(p=>p.name))');
  const b = await B.eval('JSON.stringify((PN.app.state.players||[]).map(p=>p.name))');
  console.log(String(Date.now()-t0).padStart(5) + 'ms 房主看到=' + a + ' 加入者看到=' + b);
}
// 等双方互相看见（真实用户期待的行为）
let ok = false;
for (let i = 0; i < 30; i++) {
  const a = JSON.parse(await A.eval('JSON.stringify((PN.app.state.players||[]).map(p=>p.name))'));
  if (a.length >= 2) { ok = true; console.log('房主在 ' + (Date.now()-t0) + 'ms 时看到 2 人'); break; }
  await sleep(500);
}
if (!ok) console.log('✗ 15 秒内房主始终只看到 ' + await A.eval('JSON.stringify((PN.app.state.players||[]).map(p=>p.name))'));
console.log('房主控制台报错: ' + await A.consoleErrors());
console.log('加入者控制台报错: ' + await B.consoleErrors());
console.log('房主 isHost=' + await A.eval('PN.app.room.isHost') + ' 加入者 isHost=' + await B.eval('PN.app.room.isHost'));
console.log('加入者 room.hostId=' + await B.eval('PN.app.room.hostId') + ' 自己的 id=' + await B.eval('PN.app.room.me.id'));
console.log('房主 peers=' + await A.eval('JSON.stringify(Object.keys(PN.app.room.peers))'));
console.log('加入者 peers=' + await B.eval('JSON.stringify(Object.keys(PN.app.room.peers))'));
await A.dispose(); await B.dispose(); cdp.close();
