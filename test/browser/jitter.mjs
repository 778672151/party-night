// 抽搐量化：一局游戏里整树重建（UI.clear()）多少次。重建=画面闪、拖拽/输入被打断。
//   node test/browser/jitter.mjs
// 注意：动作签名必须与游戏一致，否则「发出去了」但状态没变，会量出假的 0。
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';

const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);

await A.eval(`(()=>{ if(window.__wrap) return true; window.__wrap=1; window.__rf=0;
  const proto = Object.getPrototypeOf(PN.app);
  const orig = proto.clear;
  proto.clear = function(){ window.__rf++; return orig.apply(this, arguments); };
  return true; })()`);

/** 让「该走的人」发一个动作，并返回是否真的改变了状态 */
async function act(expr) {
  const r = await A.eval('(()=>{ try { ' + expr + ' } catch(e) { return ' + JSON.stringify('ERR ') + ' + e.message; } })()');
  return r;
}

async function measure(mode, seconds, driver) {
  await A.eval('PN.app.send({t:"start", mode:' + JSON.stringify(mode) + '})');
  await sleep(1600);
  await A.eval('window.__rf = 0');
  const t0 = Date.now();
  const side = await driver();
  await sleep(seconds * 1000);
  const n = Number(await A.eval('window.__rf')) || 0;
  const secs = (Date.now() - t0) / 1000;
  console.log(mode.padEnd(9) + secs.toFixed(1) + 's | 重建 ' + String(n).padStart(3) + ' 次 (' + (n / secs).toFixed(1) + '/s) | ' + side);
  await A.eval('PN.app.send({t:"lobby"})');
  await sleep(800);
}

await measure('gomoku', 6, async () => {
  // 真实的五子棋动作：{t:'place', x, y}；从房主视角找当前轮到谁
  const who = await A.eval('(()=>{const g=PN.app.state.g; return g.players[0]===PN.app.room.me.id ? "A" : "B";})()');
  for (let i = 0; i < 6; i++) {
    const page = (await A.eval('(()=>{const g=PN.app.state.g; return g.players[0]===PN.app.room.me.id ? "A":"B";})()')) === 'A' ? A : B;
    await page.eval('(()=>{const g=PN.app.state.g; const me=PN.app.room.me.id; if(g.players[g.turn===1?0:1]!==me) return; const i=' + i + '; PN.app.send({t:"place", x:(i*2)%13, y:(i*3)%13});})()');
    await sleep(500);
  }
  const filled = await A.eval('PN.app.state.g.moves.length');
  return '房主先手=' + who + ' 落子数=' + filled;
});

await measure('hop', 7, async () => {
  for (let i = 0; i < 3; i++) {
    await A.eval('(()=>{ if(PN.app.state.g.attempt && PN.app.state.g.attempt.pid===PN.app.room.me.id) PN.app.send({t:"charge"}); })()');
    await sleep(350);
    await A.eval('(()=>{ if(PN.app.state.g.attempt && PN.app.state.g.attempt.pid===PN.app.room.me.id) PN.app.send({t:"jump"}); })()');
    await sleep(900);
  }
  return '总分=' + JSON.stringify(await A.eval('JSON.stringify(PN.app.state.g.totals)'));
});

await measure('mine', 6, async () => {
  const n0 = await A.eval('PN.app.state.g.board ? PN.app.state.g.board.length : -1');
  await A.eval('(()=>{const g=PN.app.state.g; const me=PN.app.room.me.id; if(g.turn!=null && g.players[g.turnIdx||0]!==me) return; PN.app.send({t:"dig", i:0});})()');
  await sleep(500);
  return 'board 长度=' + n0 + ' 已挖=' + await A.eval('JSON.stringify(PN.app.state.g.revealed||PN.app.state.g.open||null)');
});

await A.dispose(); await B.dispose(); cdp.close();
