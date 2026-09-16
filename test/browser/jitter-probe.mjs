// 先验证计数手段本身有效，再谈数值
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);

const installed = await A.eval(`(()=>{ if(window.__wrap) return 'already'; window.__wrap=1; window.__rf=0;
  const proto = Object.getPrototypeOf(PN.app);
  const orig = proto.clear;
  proto.clear = function(){ window.__rf++; return orig.apply(this, arguments); };
  window.__clearIsSame = (proto.clear !== orig);
  return 'installed'; })()`);
console.log('安装: ' + installed + '  包装生效=' + await A.eval('window.__clearIsSame'));

// 手动强制一次渲染，看计数器是否 +1
await A.eval('window.__rf = 0');
await A.eval('PN.app.render()');
await sleep(300);
console.log('手动 render() 后 __rf=' + await A.eval('window.__rf'));

// 走一手真实的棋（房主先手，直接驱动 host）
await A.eval('window.__rf = 0');
await A.eval('PN.app.send({t:"start", mode:"gomoku"})');
await sleep(1500);
console.log('开局后 __rf=' + await A.eval('window.__rf'));
await A.eval('window.__rf = 0');
const turnId = await A.eval('PN.app.state.g.players[0] === PN.app.room.me.id ? "host" : "peer"');
console.log('房主是否先手: ' + turnId);
// 让房主走一手（若房主不是先手则先让 B 走）
// 五子棋的真实动作是 {t:'place', x, y}（不是 move/p）
const moved = await A.eval('(()=>{const g=PN.app.state.g; const me=PN.app.room.me.id; if(g.players[0]!==me) return "notMyTurn"; PN.app.send({t:"place", x:7, y:8}); return "sent";})()');
await sleep(1600);
console.log('发棋: ' + moved + '  A.__rf=' + await A.eval('window.__rf'));
console.log('board[8*15+7] 是否落子: ' + await A.eval('PN.app.state.g.board[8*PN.app.state.g.n+7]'));
await A.dispose(); await B.dispose(); cdp.close();
