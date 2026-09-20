// 真人游玩会遇到的 UI/逻辑排查（只读检查 + 真实点击，不改业务代码）
//   node test/browser/duo-human.mjs
import { connect, createRoom, joinRoom, waitPlayers, sleep, assert } from './lib.mjs';

const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
const meA = await A.eval('PN.app.room.me.id'), meB = await B.eval('PN.app.room.me.id');
const P = {}; P[meA] = A; P[meB] = B;
console.log('房间 ' + A.code + ' 就绪');

const txtOf = (p) => p.eval('(document.body.innerText||"").replace(/[\\n\\r]+/g," | ")');
const has = (s, k) => s.indexOf(k) >= 0;

/* ---- 1. 真人第一步：房主是不是马上看到自己 ---- */
console.log('\n--- 1. 开房后房主立刻的界面 ---');
const hostTxt = await txtOf(A);
console.log('  房主界面片段: ' + hostTxt.slice(0, 110));
assert(!has(hostTxt, '还差一个人'), '房主开房后不应显示「还差一个人」（自己已在房里）');

/* ---- 2. 加入者所见的房号/在线信息是否与房主一致 ---- */
console.log('\n--- 2. 两端在线状态与房号 ---');
const codeA = await A.eval('(document.querySelector(".roomcode .code")||{}).textContent||""');
const codeB = await B.eval('(document.querySelector(".roomcode .code")||{}).textContent||""');
console.log('  房号显示：房主=' + JSON.stringify(codeA) + ' 加入者=' + JSON.stringify(codeB) + ' 实际=' + A.code);
assert(codeA.trim() === A.code && codeB.trim() === A.code, '两端房号显示与实际一致');
const connA = await A.eval('PN.app.conn'), connB = await B.eval('PN.app.conn');
console.log('  连接状态：房主=' + connA + ' 加入者=' + connB);
assert(connA === 'connected' && connB === 'connected', '两端都显示已连接');

/* ---- 3. 中途第三人（真人会拉人进来）---- */
console.log('\n--- 3. 第三人加入（2 人游戏应拒绝/提示上限）---');
const C = await joinRoom(cdp, '第三位', A.code).catch(e => null);
if (C) {
  await sleep(1500);
  const n = await A.eval('(PN.app.state.players||[]).length');
  const mode = await A.eval('PN.app.state.mode');
  console.log('  第三人进房后：房间人数=' + n + ' mode=' + mode);
  // 3 人时房主开 2 人游戏应被拦
  await A.eval('PN.app.send({t:"start", mode:"gomoku"})');
  await sleep(1500);
  const m2 = await A.eval('PN.app.state.mode');
  const toasts = await A.eval('JSON.stringify([...document.querySelectorAll(".toast")].map(t=>t.textContent))');
  console.log('  3 人时开五子棋 → mode=' + m2 + ' 提示=' + toasts);
  assert(m2 === 'lobby', '3 人在房时不能开 2 人游戏（被拦）');
  await C.dispose();
} else console.log('  (第三人未能进房 — 公共 broker 环境问题)');

/* ---- 4. 大厅里真人会点的每一个控件都不该崩 ---- */
console.log('\n--- 4. 大厅控件逐个点一遍（找死链/报错）---');
const clicked = [];
for (const sel of ['#pn-copy', '#pn-share', '.mini-head', '.mini-head', '#pn-editname', '#pn-reset']) {
  const exists = await A.eval('!!document.querySelector(' + JSON.stringify(sel) + ')');
  if (!exists) { console.log('  ' + sel + ' → 不存在（跳过）'); continue; }
  const before = (await A.consoleErrors());
  await A.click(sel).catch(() => {});
  await sleep(600);
  const after = (await A.consoleErrors());
  const grew = JSON.parse(after).length > JSON.parse(before).length;
  clicked.push(sel + (grew ? ' ✗报错' : ' ✓'));
  // 关掉可能打开的弹窗
  await A.eval('(()=>{const o=document.querySelector(".overlay"); if(o) o.remove(); return true;})()').catch(()=>{});
  await sleep(200);
}
console.log('  点击结果: ' + clicked.join('  '));
assert(!clicked.some(s => s.indexOf('✗') >= 0), '大厅控件点击无 JS 报错');

/* ---- 5. 小游戏浮层：打开→关闭后大厅要完好 ---- */
console.log('\n--- 5. 小游戏浮层开关 ---');
const miniCount = await A.eval('document.querySelectorAll(".mini-card").length');
console.log('  小游戏卡数量: ' + miniCount);
if (miniCount > 0) {
  // 小游戏浮层的容器类是 .mini-ov（不是 .overlay），点卡要用 lib 的真实 click（内部会先 scrollIntoView）
  await A.click('.mini-sec .mini-head');
  await sleep(700);
  await A.click('.mini-card');
  await sleep(2000);
  const o1 = JSON.parse(await A.eval('JSON.stringify({ov:!!document.querySelector(".mini-ov"),title:(document.querySelector(".mini-title")||{}).textContent||null,src:(document.querySelector(".mini-frame")||{}).src||""})'));
  console.log('  打开小游戏: 浮层=' + o1.ov + ' 标题=' + JSON.stringify(o1.title));
  assert(o1.ov, '小游戏浮层能打开');
  await sleep(2000);
  const loaded = await A.eval('(()=>{const f=document.querySelector(".mini-frame"); return !!(f&&f.contentDocument&&f.contentDocument.body&&f.contentDocument.body.children.length>0);})()');
  console.log('  iframe 已加载内容: ' + loaded + ' src=' + o1.src.split('/').slice(-2).join('/'));
  assert(loaded, '小游戏 iframe 真的加载出内容');
  await A.click('#mini-close');
  await sleep(900);
  const after = await A.eval('JSON.stringify({ov:!!document.querySelector(".mini-ov"), cards:document.querySelectorAll(".modecard").length, mini:document.querySelectorAll(".mini-card").length, mode:PN.app.state.mode})');
  console.log('  关闭后: ' + after);
  const o = JSON.parse(after);
  assert(!o.ov, '小游戏浮层能正常关闭');
  assert(o.cards === 11 && o.mini === miniCount, '关闭后大厅卡片完好（联机 ' + o.cards + ' / 小游戏 ' + o.mini + '）');
}

/* ---- 6. 游戏内两端看到的信息是否一致 ---- */
console.log('\n--- 6. 开局后两端界面信息一致 ---');
await A.eval('PN.app.send({t:"start", mode:"gomoku"})');
await sleep(1800);
const gTxtA = await A.eval('(document.querySelector(".ghead")||{}).innerText||""');
const gTxtB = await B.eval('(document.querySelector(".ghead")||{}).innerText||""');
console.log('  房主头部=' + JSON.stringify(gTxtA.replace(/\n/g,' ')) + ' / 加入者头部=' + JSON.stringify(gTxtB.replace(/\n/g,' ')));
assert(!!gTxtA && !!gTxtB, '两端都渲染出了游戏头部');
// 轮次提示
const turnA = await A.eval('(document.body.innerText||"").match(/轮到你|等对方|等 .{1,8} 落子/)?.[0] || "无"');
const turnB = await B.eval('(document.body.innerText||"").match(/轮到你|等对方|等 .{1,8} 落子/)?.[0] || "无"');
console.log('  轮次提示：房主=' + JSON.stringify(turnA) + ' 加入者=' + JSON.stringify(turnB));
assert(!(turnA === '轮到你' && turnB === '轮到你'), '同回合不可能两端都显示「轮到你」');

/* ---- 7. 回大厅后两端状态 ---- */
console.log('\n--- 7. 回大厅 ---');
await A.eval('PN.app.send({t:"lobby"})');
await sleep(1500);
const back = JSON.parse(await A.eval('JSON.stringify({mode:PN.app.state.mode,screen:PN.app.screenName,players:(PN.app.state.players||[]).length})'));
const backB = JSON.parse(await B.eval('JSON.stringify({mode:PN.app.state.mode,screen:PN.app.screenName,players:(PN.app.state.players||[]).length})'));
console.log('  房主=' + JSON.stringify(back) + ' 加入者=' + JSON.stringify(backB));
assert(back.mode === 'lobby' && backB.mode === 'lobby', '两端都回到大厅');
// 注意：第三人刚离开时可能还在名单里 —— 这是**有意的掉线宽限**（host.js DROP_GRACE_MS=25000，
// 让刷新/切后台的人 25 秒内回来还在对局），不是丢人。只断言两位主角都在。
const namesA = await A.eval('JSON.stringify((PN.app.state.players||[]).map(p=>p.name))');
assert(namesA.indexOf('小桃') >= 0 && namesA.indexOf('阿泽') >= 0, '回大厅后两位主角都还在（第三人受 25 秒宽限，属设计行为）');
assert(back.players === backB.players, '两端人数一致（没把对方弄丢）');
const eA = JSON.parse(await A.consoleErrors()), eB = JSON.parse(await B.consoleErrors());
console.log('  全程 JS 报错：房主 ' + eA.length + ' / 加入者 ' + eB.length + (eA.length ? ' 例:' + eA[0] : '') + (eB.length ? ' 例:' + eB[0] : ''));
assert(eA.length === 0 && eB.length === 0, '全程无 JS 报错');

console.log('\nDUO-HUMAN 结束');
await A.dispose(); await B.dispose(); cdp.close();
