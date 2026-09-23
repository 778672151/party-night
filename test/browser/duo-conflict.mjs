// 双人专项：操作冲突 + 显示错位（只读检查，不改业务代码）
//   node test/browser/duo-conflict.mjs
import { connect, createRoom, joinRoom, waitPlayers, sleep, settle, assert } from './lib.mjs';

const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
console.log('房间 ' + A.code + ' 就绪（房主=A/小桃，加入者=B/阿泽）');

/* ========== 1. 显示错位：两端不同视口 ========== */
async function layout(p) {
  return JSON.parse(await p.eval(`JSON.stringify((()=>{
    const vw = window.innerWidth;
    const bad = [];
    document.querySelectorAll('#pn-root *, .overlay, .toasts').forEach(function (el) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.right > vw + 0.5 || r.left < -0.5) bad.push((el.className||el.tagName) + '@' + Math.round(r.left) + '..' + Math.round(r.right));
    });
    return { vw: vw, docW: document.documentElement.scrollWidth, hScroll: document.documentElement.scrollWidth > vw + 1, bad: bad.slice(0, 6) };
  })())`));
}
console.log('\n--- 1. 显示错位：房主桌面 1280 / 加入者手机 390 ---');
await A.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, A.sid);
await B.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, B.sid);
await sleep(1200);
const la = await layout(A), lb = await layout(B);
console.log('  房主(1280)：横向滚动=' + la.hScroll + ' 文档宽=' + la.docW + ' 越界元素=' + JSON.stringify(la.bad));
console.log('  加入者(390)：横向滚动=' + lb.hScroll + ' 文档宽=' + lb.docW + ' 越界元素=' + JSON.stringify(lb.bad));
assert(!la.hScroll && la.bad.length === 0, '房主 1280 视口无横向错位');
assert(!lb.hScroll && lb.bad.length === 0, '加入者 390 视口无横向错位');

/* ========== 2. 长昵称（显示错位常见触发） ========== */
console.log('\n--- 2. 长昵称 ---');
const LONG = '这是一位名字特别特别长的群友朋友同学';
await A.eval('PN.app.send({t:"setName", name:' + JSON.stringify(LONG) + '})');
await sleep(1200);
const nmA = await A.eval('(()=>{const e=document.querySelector(".player .nm");if(!e)return null;const r=e.getBoundingClientRect();const s=getComputedStyle(e);return JSON.stringify({txt:e.textContent,w:Math.round(r.width),scrollW:e.scrollWidth,ellipsis:s.textOverflow})})()');
const nmB = await B.eval('(()=>{const e=document.querySelector(".player .nm");if(!e)return null;const r=e.getBoundingClientRect();return JSON.stringify({txt:e.textContent,w:Math.round(r.width),scrollW:e.scrollWidth})})()');
console.log('  房主端名片：' + nmA);
console.log('  加入者端名片：' + nmB);
const lo2 = await layout(A), lo2b = await layout(B);
console.log('  长昵称后 房主越界=' + JSON.stringify(lo2.bad) + ' 加入者越界=' + JSON.stringify(lo2b.bad));
assert(lo2.bad.length === 0 && lo2b.bad.length === 0, '长昵称不导致两端越界错位');

/* ========== 3. 操作冲突：两人同时点开始（不同游戏） ========== */
console.log('\n--- 3. 操作冲突：房主与加入者同时发 start（不同游戏） ---');
await Promise.all([
  A.eval('PN.app.send({t:"start", mode:"gomoku"})'),
  B.eval('PN.app.send({t:"start", mode:"soko"})'),
]);
await sleep(1800);
const mA = await A.eval('PN.app.state.mode'), mB = await B.eval('PN.app.state.mode');
console.log('  结果：房主 mode=' + mA + ' 加入者 mode=' + mB);
assert(mA === mB, '两人同时发 start 后两端 mode 一致（不撕裂）');
assert(mA === 'gomoku', '非房主的 start 被拒绝（最终仍是房主选的 gomoku）');

/* ========== 4. 操作冲突：同一回合双方同时落子 ========== */
console.log('\n--- 4. 操作冲突：同一回合双方同时落子 ---');
const g0 = JSON.parse(await A.eval('JSON.stringify({players:PN.app.state.g.players,turn:PN.app.state.g.turn})'));
const meA = await A.eval('PN.app.room.me.id');
const blackIsA = g0.players[0] === meA;
const pBlack = blackIsA ? A : B, pWhite = blackIsA ? B : A;
const dump = (page) => page.eval('JSON.stringify({turn:PN.app.state.g.turn,moves:PN.app.state.g.moves.map(m=>({c:m.color,x:m.x,y:m.y})),board:PN.app.state.g.board.filter(v=>v!==0).length})');

// ---- 4a. 确定性断言：不是你的回合，**单独**发也必须被拒绝 ---------------------------
// （旧写法把这条混在"双方同时抢发"里，于是结论取决于谁的网络包先到 —— 见 4b 说明。）
await pWhite.eval('PN.app.send({t:"place", x:9, y:9})');
const gRej = JSON.parse(await settle(() => dump(A), (v) => JSON.parse(v).moves.length === 0));
await sleep(800);   // 再多观察一会儿，确认它"一直没有"生效，而不是"暂时还没到"
assert(gRej.moves.length === 0, '不是你的回合时单独落子被拒绝（实际 ' + gRej.moves.length + ' 手）');
assert(gRej.board === 0, '被拒的落子没有留在棋盘上（实际 ' + gRej.board + ' 颗）');
assert(gRej.turn === g0.turn, '被拒后回合没有推进');

// ---- 4b. 双方同时抢发：允许两种收敛结果，但都必须是一段**合法**着法序列 -------------
// 关键：QoS0 + 公共 broker 下，黑方的包可能比白方先到 —— 那样黑先落子、轮次转白，
// 白方这一手就**理应**被接受（2 手）。旧断言写死 moves===1，只在"白方包先到被拒"时成立，
// 于是一条正确的规则被当成了缺陷（实测 8 次里 4 次红）。这里改为断言真正的不变量。
await Promise.all([
  pBlack.eval('PN.app.send({t:"place", x:1, y:1})'),
  pWhite.eval('PN.app.send({t:"place", x:9, y:9})'),
]);
// 等抢发真正收敛（QoS0 下最多要等一个 ACT_RETRY_MS 重传周期），不要睡死 1500ms 就判。
// 关键：必须等**两端读数一致**才算收敛 —— 只等房主就问对端，仍会读到"对端还没收到"而假红
// （§7.3：跨端断言必须等对端收敛；之前只 settle 了 A 就立刻读 B，8 次里红了 5 次）。
const bothAgree = async () => {
  const [a, b] = await Promise.all([dump(A), dump(B)]);
  return JSON.stringify([a, b]);
};
await settle(bothAgree, (v) => {
  const [a, b] = JSON.parse(v);
  return JSON.parse(a).moves.length >= 1 && a === b;
});
const g1 = JSON.parse(await dump(A));
const g1b = JSON.parse(await dump(B));
console.log('  抢子后：房主 ' + JSON.stringify(g1) + ' / 加入者 ' + JSON.stringify(g1b));
assert(g1.moves.length >= 1 && g1.moves.length <= 2, '抢发后生效 1~2 手（实际 ' + g1.moves.length + ' 手）');
assert(g1.moves[0] && g1.moves[0].c === 1, '先落子的必是黑方（gomoku 黑恒为 1）');
assert(g1.moves.every((m, i) => i === 0 || m.c !== g1.moves[i - 1].c), '同一方不可能连走两手（黑白交替）');
assert(new Set(g1.moves.map(m => m.x + ',' + m.y)).size === g1.moves.length, '没有同一格被落两次');
assert(g1.board === g1.moves.length, '棋盘上的子数与着法数一致（实际 ' + g1.board + ' 颗）');
assert(JSON.stringify(g1) === JSON.stringify(g1b), '两端棋盘/回合完全一致');

/* ========== 5. 操作冲突：开局瞬间两人同时抢换游戏 ========== */
console.log('\n--- 5. 操作冲突：开局后立刻连点换游戏/回大厅 ---');
await Promise.all([
  A.eval('(()=>{for(let i=0;i<5;i++) PN.app.send({t:"start", mode:"memory"}); return true;})()'),
  B.eval('(()=>{for(let i=0;i<5;i++) PN.app.send({t:"lobby"}); return true;})()'),
]);
await sleep(2000);
const mA2 = await A.eval('PN.app.state.mode'), mB2 = await B.eval('PN.app.state.mode');
console.log('  结果：房主 mode=' + mA2 + ' 加入者 mode=' + mB2);
assert(mA2 === mB2, '混战连点后两端 mode 仍一致');
const eA = JSON.parse(await A.consoleErrors()), eB = JSON.parse(await B.consoleErrors());
console.log('  JS 报错：房主 ' + eA.length + ' 条 / 加入者 ' + eB.length + ' 条' + (eA.length ? ' 例：' + eA[0] : '') + (eB.length ? ' 例：' + eB[0] : ''));
assert(eA.length === 0 && eB.length === 0, '混战连点过程中无 JS 报错');

/* ========== 6. 操作冲突：一方操作时另一方刷新 ========== */
console.log('\n--- 6. 操作冲突：房主操作中，加入者刷新页面 ---');
await A.eval('PN.app.send({t:"lobby"})'); await sleep(800);
await A.eval('PN.app.send({t:"start", mode:"gomoku"})'); await sleep(1200);
await B.reload();
await sleep(4000);
const mA3 = await A.eval('PN.app.state.mode');
let mB3 = '?';
for (let i = 0; i < 30; i++) { mB3 = await B.eval('PN.app.state.mode'); if (mB3 === 'gomoku') break; await sleep(400); }
console.log('  刷新后：房主 mode=' + mA3 + ' 加入者 mode=' + mB3);
assert(mA3 === 'gomoku' && mB3 === 'gomoku', '一方刷新后双方仍在同一局');

console.log('\nDUO-CONFLICT 结束');
await A.dispose(); await B.dispose(); cdp.close();
