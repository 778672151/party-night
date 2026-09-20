// 真人手势：按住大按钮后「滑出按钮再松手」是否会卡在蓄力中
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
await A.eval('PN.app.send({t:"start", mode:"hop"})');
await sleep(2500);

const btn = await A.box('[data-hold]');
console.log('大按钮 box: ' + JSON.stringify(btn));

// 场景1：正常按住 → 原地松手
await A.mouse('mouseMoved', btn.x, btn.y, { button: 'none' });
await A.mouse('mousePressed', btn.x, btn.y, { buttons: 1, button: 'left', clickCount: 1 });
await sleep(600);
console.log('按住中: charging=' + await A.eval('!!PN.app.state.g.attempt.charging'));
await A.mouse('mouseReleased', btn.x, btn.y, { buttons: 0, button: 'left', clickCount: 1 });
await sleep(1500);
console.log('场景1 原地松手 → ' + await A.eval('JSON.stringify({charging:!!PN.app.state.g.attempt.charging,idx:PN.app.state.g.attempt.idx,lives:PN.app.state.g.attempt.lives})'));

// 场景2：按住 → 滑出按钮 → 松手（真实滑手）
await A.mouse('mouseMoved', btn.x, btn.y, { button: 'none' });
await A.mouse('mousePressed', btn.x, btn.y, { buttons: 1, button: 'left', clickCount: 1 });
await sleep(400);
console.log('场景2 按住中: charging=' + await A.eval('!!PN.app.state.g.attempt.charging'));
// 拖到画布上方（离开按钮）
await A.mouse('mouseMoved', btn.x, btn.y - 200, { buttons: 1, button: 'left' });
await sleep(300);
await A.mouse('mouseReleased', btn.x, btn.y - 200, { buttons: 0, button: 'left', clickCount: 1 });
await sleep(1600);
const s2 = JSON.parse(await A.eval('JSON.stringify({charging:!!PN.app.state.g.attempt.charging,idx:PN.app.state.g.attempt.idx,lives:PN.app.state.g.attempt.lives,power:PN.app.state.g.power})'));
console.log('场景2 滑出后松手 → ' + JSON.stringify(s2));
console.log('  → ' + (s2.charging ? '✗ 卡在蓄力中（本轮无法继续）' : '✓ 正常结算'));

// 对手视角：会不会一直看到对方在蓄力
console.log('对手看到的 charging=' + await B.eval('!!PN.app.state.g.attempt.charging') + ' power=' + await B.eval('PN.app.state.g.power'));
console.log('报错: ' + await A.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
