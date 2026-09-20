// 跳一跳实测截图：开局 / 蓄力中 / 起跳后，用真实输入
import { connect, createRoom, joinRoom, waitPlayers, sleep, SHOTS } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
await A.eval('PN.app.send({t:"start", mode:"hop"})');
await sleep(2500);
await A.shot('hop-1-start');
console.log('开局截图 ok，状态=' + await A.eval('JSON.stringify({round:PN.app.state.g.round,pid:PN.app.state.g.attempt&&PN.app.state.g.attempt.pid,lives:PN.app.state.g.attempt&&PN.app.state.g.attempt.lives})'));

// 真实按住不放 → 截「蓄力中」
const box = await A.box('canvas.hop-cv');
const x = box.x, y = box.y;
await A.mouse('mouseMoved', x, y, { button: 'none' });
await A.mouse('mousePressed', x, y, { buttons: 1, button: 'left', clickCount: 1 });
await sleep(700);
console.log('蓄力中: charging=' + await A.eval('!!PN.app.state.g.attempt.charging') + ' power=' + await A.eval('PN.app.state.g.power'));
await A.shot('hop-2-charging');
await A.mouse('mouseReleased', x, y, { buttons: 0, button: 'left', clickCount: 1 });
await sleep(260);
await A.shot('hop-3-flying');
await sleep(2000);
await A.shot('hop-4-after');
console.log('跳后: ' + await A.eval('JSON.stringify({idx:PN.app.state.g.attempt.idx,score:PN.app.state.g.attempt.score,lives:PN.app.state.g.attempt.lives})'));
// 对手视角
await B.shot('hop-5-opponent');
console.log('报错 A=' + await A.consoleErrors() + ' B=' + await B.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
