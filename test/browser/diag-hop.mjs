// 钉死跳一跳死锁：跳一次后 fly 是否一直非空、charge 是否被客户端守卫挡掉
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
await A.eval('PN.app.send({t:"start", mode:"hop"})');
await sleep(2500);

const g0 = JSON.parse(await A.eval('JSON.stringify({pid:PN.app.state.g.attempt.pid,fly:PN.app.state.g.attempt.fly,charging:!!PN.app.state.g.attempt.charging,lives:PN.app.state.g.attempt.lives,ended:PN.app.state.g.attempt.ended})'));
console.log('开局 attempt: ' + JSON.stringify(g0) + '  （fly=' + g0.fly + '）');

// 第 1 跳：真鼠标按住 300ms
const box = await A.box('canvas.hop-cv') || await A.box('canvas');
console.log('画布 box: ' + JSON.stringify(box));
let x, y;
if (box) { x = box.x; y = box.y; } else { console.log('✗ 没找到画布'); }
await A.mouse('mouseMoved', x, y, { button: 'none' });
await A.mouse('mousePressed', x, y, { buttons: 1, button: 'left', clickCount: 1 });
await sleep(320);
await A.mouse('mouseReleased', x, y, { buttons: 0, button: 'left', clickCount: 1 });
await sleep(1500);

const g1 = JSON.parse(await A.eval('JSON.stringify({pid:PN.app.state.g.attempt.pid,fly:PN.app.state.g.attempt.fly,charging:!!PN.app.state.g.attempt.charging,lives:PN.app.state.g.attempt.lives,idx:PN.app.state.g.attempt.idx,ended:PN.app.state.g.attempt.ended})'));
console.log('第1跳后 attempt: ' + JSON.stringify({pid:g1.pid,fly:!!g1.fly,charging:g1.charging,lives:g1.lives,idx:g1.idx,ended:g1.ended}));
console.log('  → fly 非空? ' + (g1.fly ? '是 ✗（这就是死锁源）' : '否'));

// 关键对照：客户端 doCharge 的守卫是否阻止发送
console.log('--- 客户端 doCharge 守卫判定 ---');
console.log(await A.eval('(()=>{var g=PN.app.state.g, at=g.attempt; return JSON.stringify({isMine: at.pid===PN.app.room.me.id, hasFly: !!at.fly, ended: !!at.ended, lives: at.lives, willReturn: !!(at.fly||at.ended||at.lives<=0)});})()'));

// 第 2 跳：真鼠标（应当因 fly 非空而无反应）
await A.mouse('mouseMoved', x, y, { button: 'none' });
await A.mouse('mousePressed', x, y, { buttons: 1, button: 'left', clickCount: 1 });
await sleep(480);
const mid = await A.eval('JSON.stringify({charging:!!PN.app.state.g.attempt.charging,fly:!!PN.app.state.g.attempt.fly})');
console.log('第2跳按住中 charging 状态: ' + mid);
await A.mouse('mouseReleased', x, y, { buttons: 0, button: 'left', clickCount: 1 });
await sleep(1400);
const g2 = JSON.parse(await A.eval('JSON.stringify({lives:PN.app.state.g.attempt.lives,idx:PN.app.state.g.attempt.idx,fly:!!PN.app.state.g.attempt.fly,round:PN.app.state.g.round})'));
console.log('第2跳后: ' + JSON.stringify(g2) + '  → 与第1跳后相同? ' + (g2.lives===g1.lives && g2.idx===g1.idx ? '是 ✗ 完全没反应' : '否'));

// 对照：绕过客户端守卫，直接 send charge+release 是否有效（证明是客户端守卫的问题）
console.log('--- 对照：直接 send charge/release（绕过守卫）---');
await A.eval('PN.app.send({t:"charge"})');
await sleep(500);
await A.eval('PN.app.send({t:"release", hold:500})');
await sleep(1400);
const g3 = JSON.parse(await A.eval('JSON.stringify({lives:PN.app.state.g.attempt.lives,idx:PN.app.state.g.attempt.idx,fly:!!PN.app.state.g.attempt.fly})'));
console.log('绕过守卫后: ' + JSON.stringify(g3) + '  → 状态变了? ' + (g3.lives!==g1.lives || g3.idx!==g1.idx ? '是 ✓ 证明房主侧没问题，是客户端守卫挡住' : '否'));
console.log('报错: ' + await A.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
