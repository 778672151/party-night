// 精确到守卫：按键那一刻，操作端本地 g.attempt 的各个字段是什么，被哪一条挡掉
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
const meA = await A.eval('PN.app.room.me.id'), meB = await B.eval('PN.app.room.me.id');
const P = {}; P[meA] = A; P[meB] = B;
await A.eval('PN.app.send({t:"start", mode:"hop"})');
await sleep(2500);

// 包装 ui.send 记录 charge/release；并在 doCharge 前记录本地 attempt 快照
const inst = 'window.__h={sent:[],snap:[]}; (function(){ var u=PN.app; if(!u.__w2){ var o=u.send.bind(u); u.__w2=1; u.send=function(m){ try{ if(m&&(m.t==="charge"||m.t==="release")) window.__h.sent.push(m.t); }catch(e){} return o(m); }; } var cv=document.querySelector("canvas.hop-cv"); if(cv && !cv.__p2){ cv.__p2=1; cv.addEventListener("pointerdown", function(){ var g=PN.app.state.g; var a=(g&&g.attempt)||{}; window.__h.snap.push({pid:a.pid,ended:!!a.ended,lives:a.lives,idx:a.idx,fly:!!a.fly,myid:PN.app.room.me.id,mine:a.pid===PN.app.room.me.id,phase:g&&g.phase}); }, true); } return "ok"; })()';

let bad = 0, ok = 0;
for (let i = 0; i < 22; i++) {
  const h = JSON.parse(await A.eval('JSON.stringify({phase:PN.app.state.g.phase,pid:(PN.app.state.g.attempt||{}).pid,ended:!!((PN.app.state.g.attempt||{}).ended),lives:(PN.app.state.g.attempt||{}).lives,idx:(PN.app.state.g.attempt||{}).idx,score:(PN.app.state.g.attempt||{}).score})'));
  if (h.phase === 'over') break;
  if (!h.pid) { await sleep(400); continue; }
  const pg = P[h.pid]; if (!pg) { await sleep(400); continue; }
  if (h.ended || h.lives <= 0) { await sleep(300); continue; }
  await pg.eval(inst);
  await pg.eval('window.__h={sent:[],snap:[]}');
  const box = await pg.box('canvas.hop-cv');
  await pg.mouse('mouseMoved', box.x, box.y, { button: 'none' });
  await pg.mouse('mousePressed', box.x, box.y, { buttons: 1, button: 'left', clickCount: 1 });
  await sleep(600);
  await pg.mouse('mouseReleased', box.x, box.y, { buttons: 0, button: 'left', clickCount: 1 });
  await sleep(1500);
  const pr = JSON.parse(await pg.eval('JSON.stringify(window.__h)'));
  const a = JSON.parse(await A.eval('JSON.stringify({idx:(PN.app.state.g.attempt||{}).idx,lives:(PN.app.state.g.attempt||{}).lives,score:(PN.app.state.g.attempt||{}).score,last:(PN.app.state.g.attempt||{}).last})'));
  const moved = a.idx !== h.idx || a.lives !== h.lives || a.score !== h.score || a.last;
  if (moved) ok++; else {
    bad++;
    console.log('✗没反应 第' + (i + 1) + '跳: 发出的消息=' + JSON.stringify(pr.sent) + '  按下瞬间本地快照=' + JSON.stringify(pr.snap));
  }
}
console.log('生效=' + ok + ' 没反应=' + bad);
console.log('报错 A=' + await A.consoleErrors() + ' B=' + await B.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
