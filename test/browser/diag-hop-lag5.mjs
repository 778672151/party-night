// 直接在页面里插桩：记录 canvas 收到 pointerdown/pointerup 的次数，以及那一刻的 isMine/ended/lives
// 目的：区分「事件没到」/「事件到了但 isMine 为假被守卫挡」/「发出去了但房主没收」
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
const meA = await A.eval('PN.app.room.me.id'), meB = await B.eval('PN.app.room.me.id');
const P = {}; P[meA] = A; P[meB] = B;
await A.eval('PN.app.send({t:"start", mode:"hop"})');
await sleep(2500);

// 给两端的 hop 画布装探针 + 包住 ui.send 统计 charge/release
const inst = 'window.__hop={down:0,up:0,send:[],guard:[]}; (function(){ var cv=document.querySelector("canvas.hop-cv"); if(!cv) return "nocv"; cv.addEventListener("pointerdown", function(){ window.__hop.down++; }, true); cv.addEventListener("pointerup", function(){ window.__hop.up++; }, true); var u=PN.app; if(!u.__wrapped){ var o=u.send.bind(u); u.__wrapped=1; u.send=function(m){ try{ if(m&&(m.t==="charge"||m.t==="release")) window.__hop.send.push(m.t+(m.hold?"("+m.hold+")":"")); }catch(e){} return o(m); }; } return "ok"; })()';
console.log('A 插桩: ' + await A.eval(inst));
console.log('B 插桩: ' + await B.eval(inst));

let bad = 0, ok = 0;
for (let i = 0; i < 20; i++) {
  const h = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,pid:(PN.app.state.g.attempt||{}).pid,ended:!!((PN.app.state.g.attempt||{}).ended),lives:(PN.app.state.g.attempt||{}).lives,idx:(PN.app.state.g.attempt||{}).idx,score:(PN.app.state.g.attempt||{}).score})'));
  if (h.phase === 'over') break;
  if (!h.pid) { await sleep(400); continue; }
  const pg = P[h.pid]; if (!pg) { await sleep(400); continue; }
  if (h.ended || h.lives <= 0) { await sleep(400); continue; }
  const isA = pg === A;
  // 清零探针
  await pg.eval('window.__hop.down=0; window.__hop.up=0; window.__hop.send=[]');
  const box = await pg.box('canvas.hop-cv');
  await pg.mouse('mouseMoved', box.x, box.y, { button: 'none' });
  await pg.mouse('mousePressed', box.x, box.y, { buttons: 1, button: 'left', clickCount: 1 });
  await sleep(600);
  await pg.mouse('mouseReleased', box.x, box.y, { buttons: 0, button: 'left', clickCount: 1 });
  await sleep(1500);
  const probe = JSON.parse(await pg.eval('JSON.stringify(window.__hop)'));
  const a = JSON.parse(await A.eval('JSON.stringify({idx:(PN.app.state.g.attempt||{}).idx,lives:(PN.app.state.g.attempt||{}).lives,score:(PN.app.state.g.attempt||{}).score,last:(PN.app.state.g.attempt||{}).last})'));
  const moved = a.idx !== h.idx || a.lives !== h.lives || a.score !== h.score || a.last;
  if (moved) ok++; else bad++;
  console.log('第' + (i + 1) + '跳 [' + (isA ? 'A' : 'B') + '] ' + (moved ? '✓' : '✗没反应') + '  canvas down=' + probe.down + ' up=' + probe.up + ' 发出的消息=' + JSON.stringify(probe.send) + ' | 房主 idx ' + h.idx + '→' + a.idx + ' last=' + a.last);
}
console.log('');
console.log('生效=' + ok + ' 没反应=' + bad);
console.log('判据：down=0 → 事件没到画布（测试点击问题）；down=1但send无charge → 被 isMine 守卫挡；send有charge/release但房主没变 → 房主侧问题');
await A.dispose(); await B.dispose(); cdp.close();
