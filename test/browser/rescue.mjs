// 挽救机制验收：玩家漏收一次 state（QoS0 丢包）后，必须能自己补回来
//   node test/browser/rescue.mjs
import { connect, createRoom, joinRoom, waitPlayers, sleep, assert } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
await A.eval('PN.app.send({t:"start", mode:"gomoku"})');
await sleep(1200);

// 在 B 上统计「收到 state」的次数
await B.eval('(()=>{ if(window.__svCount!==undefined) return true; window.__svCount=0; window.__svLast=null; const r=PN.app.room; const old=r.cb.onState; r.cb.onState=function(s,ret){ window.__svCount++; window.__svLast={mode:s.mode, sv:s.sv}; return old.apply(this,arguments); }; return true; })()');

// 模拟 B 漏收：把 B 的 lastState 版本拉回很旧（等价于中间那几包 state 全丢了）
await B.eval('(()=>{ PN.app.room.lastState.sv = 0; window.__svCount = 0; return true; })()');
const before = await B.eval('JSON.stringify({sv: PN.app.room.lastState.sv, cnt: window.__svCount})');

// 房主心跳：带上当前版本 → B 应当发现自己落后并请求补发
const hostSv = await A.eval('PN.app.room._stateSeq || 0');
await A.eval('PN.app.room._beacon()');
await sleep(2500);
const after = JSON.parse(await B.eval('JSON.stringify({sv: PN.app.room.lastState.sv, cnt: window.__svCount, mode: PN.app.state && PN.app.state.mode})'));

console.log('房主版本=' + hostSv + ' | B 补发前=' + before + ' | B 补发后=' + JSON.stringify(after));
assert(after.cnt >= 1, '漏收 state 的玩家自己请求到了补发（收到 ' + after.cnt + ' 次）');
assert(after.sv >= hostSv, '补发后 B 的版本追上了房主（B=' + after.sv + ' 房主=' + hostSv + '）');
assert(after.mode === 'gomoku', '补发后画面仍在对局中（mode=' + after.mode + '）');
console.log('RESCUE 结束');
await A.dispose(); await B.dispose(); cdp.close();
