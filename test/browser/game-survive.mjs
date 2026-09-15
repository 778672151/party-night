// 验收：对局进行中，房主短暂断连（25s 宽限内回来）后，对局必须还在、不能回大厅
import { connect, createRoom, joinRoom, waitPlayers, sleep, assert } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2);
await A.eval('PN.app.send({t:"start", mode:"gomoku"})');
await sleep(1500);
console.log('开局后 A.mode=' + await A.eval('PN.app.state.mode') + ' B.mode=' + await B.eval('PN.app.state.mode'));
// 场景一：只丢一两拍心跳 —— 不该抢主
await B.eval('(()=>{const r=PN.app.room; const hp=r.peers[r.hostId]; if(hp) hp.lastSeen = Date.now() - 999999; r._joinedAt = 0; r._claimAt = 0; r._claimSeen = 0; r._election(); return true;})()');
await sleep(1500);
const m1 = await B.eval('PN.app.state.mode');
const h1 = await B.eval('!!PN.app.room.isHost');
console.log('一次抖动: B.mode=' + m1 + ' isHost=' + h1);
assert(m1 === 'gomoku', '一次心跳抖动后对局仍在（实际 ' + m1 + '）');
assert(h1 === false, '一次心跳抖动不应抢主（实际 isHost=' + h1 + '）');
// 场景二：持续判死（真的抢主成功）—— 对局也必须保住，这是原来必崩的场景
await B.eval('(()=>{const r=PN.app.room; const hp=r.peers[r.hostId]; if(hp) hp.lastSeen = Date.now() - 999999; r._claimSeen = Date.now() - 999999; r._claimAt = 0; r._election(); return true;})()');
await sleep(2500);
const m2 = await B.eval('PN.app.state.mode');
const h2 = await B.eval('!!PN.app.room.isHost');
console.log('持续判死后: B.mode=' + m2 + ' isHost=' + h2);
assert(m2 === 'gomoku', '抢主成功后对局不应被重置为大厅（实际 ' + m2 + '）—— 这就是“突然退回房间”的原场景');
console.log('GAME-SURVIVE 结束');
await A.dispose(); await B.dispose(); cdp.close();
