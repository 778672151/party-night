// 诊断第4项：同一回合双方抢落子，到底是「白子非法生效」还是「我的测试预期写错」
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
await A.eval('PN.app.send({t:"start", mode:"gomoku"})');
await sleep(1500);

const st0 = JSON.parse(await A.eval('JSON.stringify({players:PN.app.state.g.players,turn:PN.app.state.g.turn,moves:PN.app.state.g.moves.length,me:PN.app.room.me.id})'));
const meA = st0.me;
const blackIsA = st0.players[0] === meA;
const pBlack = blackIsA ? A : B, pWhite = blackIsA ? B : A;
console.log('黑=' + (blackIsA ? 'A/小桃' : 'B/阿泽') + ' 白=' + (blackIsA ? 'B/阿泽' : 'A/小桃') + ' 当前 turn=' + st0.turn + ' 已落子=' + st0.moves);

// 先只让白方（不该走的一方）单发一手，确认它是否被拒绝
await pWhite.eval('PN.app.send({t:"place", x:9, y:9})');
await sleep(1200);
const s1 = JSON.parse(await A.eval('JSON.stringify({moves:PN.app.state.g.moves.length,turn:PN.app.state.g.turn})'));
console.log('白方单发一手后：moves=' + s1.moves + ' turn=' + s1.turn + (s1.moves === 0 ? '  → 被拒绝 ✓' : '  → ✗ 竟然生效了'));

// 再让黑方正常走一手，然后看轮到谁
await pBlack.eval('PN.app.send({t:"place", x:1, y:1})');
await sleep(1200);
const s2 = JSON.parse(await A.eval('JSON.stringify({moves:PN.app.state.g.moves.length,turn:PN.app.state.g.turn,board:PN.app.state.g.board.filter(v=>v!==0).length})'));
console.log('黑方走一手后：moves=' + s2.moves + ' turn=' + s2.turn + ' board=' + s2.board);

// 现在真正「同一回合双方同时抢」：黑先手，双方同时发
await Promise.all([
  pBlack.eval('PN.app.send({t:"place", x:2, y:2})'),
  pWhite.eval('PN.app.send({t:"place", x:10, y:10})'),
]);
await sleep(1500);
const s3 = JSON.parse(await A.eval('JSON.stringify({moves:PN.app.state.g.moves.length,turn:PN.app.state.g.turn,board:PN.app.state.g.board.filter(v=>v!==0).length,last:PN.app.state.g.last})'));
const s3b = JSON.parse(await B.eval('JSON.stringify({moves:PN.app.state.g.moves.length,turn:PN.app.state.g.turn,board:PN.app.state.g.board.filter(v=>v!==0).length})'));
console.log('同时抢一手后：房主 ' + JSON.stringify(s3));
console.log('                加入者 ' + JSON.stringify(s3b));
console.log('判定：这一轮只应增加 1 手（黑方的），实际增加 ' + (s3.moves - s2.moves) + ' 手');
await A.dispose(); await B.dispose(); cdp.close();
