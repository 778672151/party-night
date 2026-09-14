// 魔方接力 双人对局（独立用例，不往 regress.mjs 里插代码）
//   node test/browser/test-cube.mjs
import { connect, createRoom, joinRoom, waitPlayers, startGame, sleep, assert } from './lib.mjs';

const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2);

const H = (await A.eval('PN.app.isHost()')) ? A : B;
const O = H === A ? B : A;
const idA = await A.eval('PN.app.me().id');
const idB = await B.eval('PN.app.me().id');
const pageOf = (pid) => (pid === idA ? A : B);

await startGame(H, 'cube');
await H.waitFor(`PN.app.state.mode === 'cube' && PN.app.state.g && PN.app.state.g.phase === 'play'`, '进入对局', 30000);
await O.waitFor(`PN.app.state.mode === 'cube'`, '对方进入对局', 30000);

const g0 = JSON.parse(await H.eval('JSON.stringify({seed:PN.app.state.g.seed, players:PN.app.state.g.players, turn:PN.app.state.g.turnIdx, rounds:PN.app.state.g.rounds})'));
assert(typeof g0.seed === 'number', '房主生成打乱种子：' + g0.seed);
assert(g0.turn === 0 && g0.rounds === 1, '默认 1 个魔方、先加入的先转');
assert(await H.eval('document.querySelectorAll(".cb-frame").length') === 1, '原作整包跑在 iframe 里');
assert(await H.eval('document.querySelectorAll("[data-face]").length') >= 12, '屏幕提供 12 个转动按钮（6 面 × 正反转）');

// 等两端就绪，并核对初始 stateKey 一致
let ready = false, same0 = false;
for (let i = 0; i < 80; i++) {
  const a = JSON.parse(await H.eval('JSON.stringify(PN.screens.cube.debug())'));
  const b = JSON.parse(await O.eval('JSON.stringify(PN.screens.cube.debug())'));
  if (a.key && a.key.length > 10 && b.key && b.key.length > 10) { ready = true; if (a.key === b.key) same0 = true; break; }
  await sleep(500);
}
assert(ready, '两端原作都就绪（能读到 stateKey）');
assert(same0, '两端魔方初始状态一致（stateKey 相同）');

// 该谁转谁转：点真实按钮
const actor = pageOf(g0.players[0]);
const before = await H.eval('PN.app.state.g.log.length');
await actor.click('[data-face="R"]');
await H.waitFor('PN.app.state.g.log.length === ' + (before + 1), '房主记录一次转动', 20000);
assert(true, '第一次转动被房主记录（权威日志 +1）');
await H.waitFor('PN.app.state.g.turnIdx === 1', '换人', 20000);
assert(true, '转一步就交给对方');

// 两端落地后 stateKey 必须一致 —— 这是双人兼容的核心
let agree = false;
for (let i = 0; i < 60; i++) {
  const a = JSON.parse(await H.eval('JSON.stringify(PN.screens.cube.debug())'));
  const b = JSON.parse(await O.eval('JSON.stringify(PN.screens.cube.debug())'));
  if (a.applied >= 1 && b.applied >= 1 && a.key === b.key) { agree = true; assert(true, '两端落地后 stateKey 一致：' + a.key.slice(0, 24) + '…'); break; }
  await sleep(400);
}
assert(agree, '两端魔方没有分叉');

// 再转两步（其中一步带撇）确认持续一致
const p2 = pageOf(g0.players[1]);
await p2.eval('document.querySelectorAll("[data-face]")[1].click(); 1');   // "U'"
await H.waitFor('PN.app.state.g.log.length === ' + (before + 2), '第二步', 20000);
const p1 = pageOf(g0.players[0]);
await p1.click('[data-face="F"]');
await H.waitFor('PN.app.state.g.log.length === ' + (before + 3), '第三步', 20000);
let agree3 = false;
for (let i = 0; i < 60; i++) {
  const a = JSON.parse(await H.eval('JSON.stringify(PN.screens.cube.debug())'));
  const b = JSON.parse(await O.eval('JSON.stringify(PN.screens.cube.debug())'));
  if (a.applied >= 3 && b.applied >= 3 && a.key === b.key) { agree3 = true; break; }
  await sleep(400);
}
assert(agree3, '连转三步（含带撇）后两端仍然一致');

// 越位：不是你的回合发转动要被拒
const wrong = pageOf(g0.players[1]);
const lb = await H.eval('PN.app.state.g.log.length');
await wrong.eval('PN.screens.cube.send({ t: "move", m: "D" }); 1');
await sleep(800);
assert(await H.eval('PN.app.state.g.log.length') === lb, '不是你的回合发转动会被房主拒绝');

// 复原结算（自动化里真解魔方不现实，直接走"复原上报"这条权威路径）
const cur = pageOf(await H.eval('PN.app.state.g.players[PN.app.state.g.turnIdx]'));
await cur.eval('PN.screens.cube.send({ t: "solved" }); 1');
await H.waitFor(`PN.app.state.g.phase === 'over'`, '复原后结算', 25000);
const over = JSON.parse(await H.eval('JSON.stringify({ played:PN.app.state.g.played, moves:PN.app.state.g.moves })'));
assert(over.played === 1, '复原一次即完成本局（本局 ' + over.moves + ' 步）');
assert(await H.eval('document.body.innerText.indexOf("总积分") >= 0') === true, '结算界面出现总积分');
assert(await H.eval('PN.app.state.players.every(function(p){return p.score>=2;})') === true, '双方各得 2 分');

const eH = await H.consoleErrors(), eO = await O.consoleErrors();
assert(eH === '[]', '房主页面全程无 JS 报错：' + eH);
assert(eO === '[]', '对方页面全程无 JS 报错：' + eO);

await A.dispose(); await B.dispose();
console.log('\n全部通过');
