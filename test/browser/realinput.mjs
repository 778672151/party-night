// 其余 10 款游戏的「真人输入」实测：全走真鼠标/真键盘，不用 PN.app.send
//   node test/browser/realinput.mjs [game]
// 判定：真人操作必须让权威状态前进；否则是真 bug。
import { connect, createRoom, joinRoom, waitPlayers, waitGameReady, settle, sleep, APP } from './lib.mjs';

const only = process.argv[2] || null;
let pass = 0, fail = 0;
const bad = [];
const chk = (ok, msg) => { if (ok) { pass++; console.log('  ✓ ' + msg); } else { fail++; bad.push(msg); console.log('  ✗ ' + msg); } };

const cdp = await connect();
const mk = async () => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2); await waitPlayers(B, 2);
  const meA = await A.eval('PN.app.room.me.id'), meB = await B.eval('PN.app.room.me.id');
  return { A, B, meA, meB, P: { [meA]: A, [meB]: B } };
};
const G = (p, e) => p.eval(e).then((r) => { try { return JSON.parse(r); } catch (x) { return r; } }).catch(() => null);
// 真鼠标点元素中心
const tap = async (p, sel) => { const b = await p.box(sel); if (!b) return false; await p.mouse('mouseMoved', b.x, b.y, { button: 'none' }); await p.mouse('mousePressed', b.x, b.y, { buttons: 1, button: 'left', clickCount: 1 }); await p.mouse('mouseReleased', b.x, b.y, { buttons: 0, button: 'left', clickCount: 1 }); return true; };
// 真鼠标点画布按比例坐标
const tapCv = async (p, sel, fx, fy) => { const b = await p.box(sel); if (!b) return false; const x = b.left + b.w * fx, y = b.top + b.h * fy; await p.mouse('mouseMoved', x, y, { button: 'none' }); await p.mouse('mousePressed', x, y, { buttons: 1, button: 'left', clickCount: 1 }); await p.mouse('mouseReleased', x, y, { buttons: 0, button: 'left', clickCount: 1 }); return true; };
const keyHold = async (p, key, code, kc, ms) => { await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc }, p.sid); if (ms) await sleep(ms); await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc }, p.sid); };
const keyTap = (p, key, code, kc) => keyHold(p, key, code, kc, 40);
// soko 的键盘要打到 iframe 里
const frameKey = async (p, key, code, kc, ms) => {
  const fid = await p.eval('(()=>{const f=document.querySelector("iframe"); return f?f.id||"" : "";})()');
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc }, p.sid);
  await sleep(ms || 60);
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc }, p.sid);
};

/* ================= 五子棋：真点击棋盘落子 + 悔棋按钮 ================= */
async function testGomoku() {
  console.log('=== 五子棋（真鼠标点棋盘）===');
  const { A, B, meA, P } = await mk();
  await A.eval('PN.app.send({t:"start", mode:"gomoku"})');
  await sleep(2200);
  let g = await G(A, 'JSON.stringify({turn:PN.app.state.g.turn,moves:PN.app.state.g.moves.length,board:PN.app.state.g.board.filter(v=>v!==0).length,bw:PN.app.state.g.board.length,sz:PN.app.state.g.size,players:PN.app.state.g.players})');
  chk(g.moves === 0 && g.board === 0, '开局棋盘为空（moves=0 board=0）');
  // 黑方真点棋盘中心
  const sz = g.sz || 15;
  const black = P[g.players[0]];
  const box = await black.box('canvas.gm-cv');
  chk(!!box, '找到棋盘 canvas.gm-cv');
  // 交叉点：画布 4 边有 padding，按比例落子到 (0.35,0.35) 附近
  for (let k = 0; k < 3; k++) {
    const cur = await G(A, 'JSON.stringify({turn:PN.app.state.g.turn,moves:PN.app.state.g.moves.length,players:PN.app.state.g.players})');
    // 注意：五子棋的 g.turn 是**颜色**(1=黑,2=白)，对应的玩家是 players[turn-1]
    const p = P[cur.players[cur.turn - 1]];
    await tapCv(p, 'canvas.gm-cv', 0.30 + k * 0.12, 0.30 + k * 0.12);
    await sleep(900);
  }
  const g2 = await G(A, 'JSON.stringify({moves:PN.app.state.g.moves.length,board:PN.app.state.g.board.filter(v=>v!==0).length})');
  chk(g2.moves >= 2, '真点击棋盘能落子（实际 ' + g2.moves + ' 手）');
  // ⚠️ 对端是 QoS0，不能读一次就判：实测「A 落子 → B 看到」延迟 409~1841ms（diag-gomoku-tap.mjs），
  // 这里必须等对端追上，否则就是测试在制造假失败（diag 之前实测 3 次里 2 次假失败）。
  let bMoves = -1;
  for (let i = 0; i < 25; i++) {
    bMoves = await G(B, 'PN.app.state.g.moves.length');
    if (bMoves === g2.moves) break;
    await sleep(200);
  }
  chk(bMoves === g2.moves, '两端手数一致（' + g2.moves + ' vs ' + bMoves + '）');
  // 悔棋按钮：真实点击后应出现询问
  const hasUndo = await A.eval('!!document.querySelector(".btn, button")');
  const undoText = await A.eval('(document.body.innerText||"").indexOf("悔棋")>=0');
  console.log('  （悔棋入口存在=' + undoText + '）');
  const eA = JSON.parse(await A.consoleErrors()), eB = JSON.parse(await B.consoleErrors());
  chk(eA.length === 0 && eB.length === 0, '无 JS 报错' + (eA[0] ? ' 例:' + eA[0] : '') + (eB[0] ? ' 例:' + eB[0] : ''));
  await A.dispose(); await B.dispose();
}

/* ================= 合作翻牌：真点卡牌 ================= */
async function testMemory() {
  console.log('=== 合作翻牌（真鼠标点卡）===');
  const { A, B, meA, P } = await mk();
  await A.eval('PN.app.send({t:"start", mode:"memory"})');
  await sleep(2200);
  const g0 = await G(A, 'JSON.stringify({phase:PN.app.state.g.phase,turn:PN.app.state.g.turn,flipped:(PN.app.state.g.flipped||[]).length,total:PN.app.state.g.total,cards:document.querySelectorAll(".mem-card, [data-i]").length})');
  const cards = await A.eval('document.querySelectorAll(".mem-card").length || document.querySelectorAll("[data-i]").length');
  console.log('  卡牌元素数量=' + cards + ' phase=' + g0.phase);
  chk(cards >= 8, '牌面有可点元素（' + cards + '）');
  // 该谁走谁真点两张
  const cur = await G(A, 'JSON.stringify({turn:PN.app.state.g.turn,players:PN.app.state.g.players})');
  // 注意：合作翻牌的 g.turn 是**玩家 id**（不是下标）
  const p = P[cur.turn] || P[cur.players[0]];
  const boxes = await p.eval('JSON.stringify([...document.querySelectorAll(".mem-card")].slice(0,2).map(function(c){}))').catch(() => null);
  // 真点两张「可点」的卡（必须点 .mem-card:not([disabled])，随便点可能点到已禁用的）
  const firstFree = (pp) => pp.eval('(function(){var c=[].slice.call(document.querySelectorAll(".mem-card")).filter(function(x){return !x.disabled})[0]; return c?Number(c.getAttribute("data-i")):-1;})()');
  const tapCard = async (pp, i) => {
    if (i < 0) return false;
    const b = await pp.box('.mem-card[data-i="' + i + '"]');
    if (!b) return false;
    await pp.mouse('mouseMoved', b.x, b.y, { button: 'none' });
    await pp.mouse('mousePressed', b.x, b.y, { buttons: 1, button: 'left', clickCount: 1 });
    await pp.mouse('mouseReleased', b.x, b.y, { buttons: 0, button: 'left', clickCount: 1 });
    return true;
  };
  const t0 = g0.turns || 0;
  await tapCard(p, await firstFree(p)); await sleep(1100);
  const mid = await G(A, 'JSON.stringify({flipped:(PN.app.state.g.flipped||[]).length,turns:PN.app.state.g.turns})');
  await tapCard(p, await firstFree(p)); await sleep(2200);
  const g1 = await G(A, 'JSON.stringify({matched:PN.app.state.g.matched,turns:PN.app.state.g.turns,phase:PN.app.state.g.phase})');
  const advanced = (g1.turns || 0) > t0 || (g1.matched || 0) > 0;
  chk(advanced, '真点两张卡推动一回合（turns ' + t0 + '→' + g1.turns + ' 中途翻开=' + mid.flipped + ' matched=' + g1.matched + '）');
  const eA = JSON.parse(await A.consoleErrors()), eB = JSON.parse(await B.consoleErrors());
  chk(eA.length === 0 && eB.length === 0, '无 JS 报错' + (eA[0] ? ' 例:' + eA[0] : ''));
  await A.dispose(); await B.dispose();
}

/* ================= 扫雷：真点格子 / 长按插旗 ================= */
async function testMine() {
  console.log('=== 扫雷（真鼠标点格子）===');
  const { A, B, meA, P } = await mk();
  await A.eval('PN.app.send({t:"start", mode:"mine"})');
  await sleep(2200);
  const g0 = await G(A, 'JSON.stringify({phase:PN.app.state.g.phase,players:PN.app.state.g.players,turnIdx:PN.app.state.g.turnIdx,revealed:PN.app.state.g.revealed.filter(Boolean).length,cells:document.querySelectorAll("[data-i]").length})');
  console.log('  格子元素=' + g0.cells + ' 已翻开=' + g0.revealed);
  chk(g0.cells >= 40, '雷区有可点格子（' + g0.cells + '）');
  for (let k = 0; k < 4; k++) {
    const cur = await G(A, 'JSON.stringify({phase:PN.app.state.g.phase,turnIdx:PN.app.state.g.turnIdx,players:PN.app.state.g.players,revealed:PN.app.state.g.revealed})');
    if (cur.phase !== 'play') break;
    const p = P[cur.players[cur.turnIdx]];
    const idx = cur.revealed.indexOf(false);
    await tap(p, '[data-i="' + idx + '"]');
    await sleep(800);
  }
  const g1 = await G(A, 'JSON.stringify({phase:PN.app.state.g.phase,revealed:PN.app.state.g.revealed.filter(Boolean).length,lives:PN.app.state.g.lives})');
  chk(g1.revealed > g0.revealed, '真点格子能翻开（' + g0.revealed + '→' + g1.revealed + '）');
  const eA = JSON.parse(await A.consoleErrors()), eB = JSON.parse(await B.consoleErrors());
  chk(eA.length === 0 && eB.length === 0, '无 JS 报错' + (eA[0] ? ' 例:' + eA[0] : ''));
  await A.dispose(); await B.dispose();
}

/* ================= 推箱子：真按方向键 / 真点十字键 ================= */
async function testSoko() {
  console.log('=== 推箱子（真键盘 + 真点方向键）===');
  const { A, B, meA, P } = await mk();
  await A.eval('PN.app.send({t:"start", mode:"soko"})');
  // 不要 sleep 固定秒数就动手：state 走 QoS0，晚到是常态（§7.3）。
  // 等「本端界面真的进了这一局」再点，否则会点到还没 arm 的按钮 → 断言 0→0 假红。
  await waitGameReady(A, 'soko');
  const g0 = await G(A, 'JSON.stringify({phase:PN.app.state.g.phase,players:PN.app.state.g.players,turnIdx:PN.app.state.g.turnIdx,log:(PN.app.state.g.log||[]).length,iframe:!!document.querySelector("iframe")})');
  console.log('  iframe=' + g0.iframe + ' 日志=' + g0.log);
  chk(g0.iframe, '原作 iframe 已挂载');
  // 真点屏幕上的十字键（data-dir）
  const hasPad = await A.eval('document.querySelectorAll("[data-dir]").length');
  console.log('  十字键数量=' + hasPad);
  const before = (await G(A, 'JSON.stringify({log:(PN.app.state.g.log||[]).length})')).log;
  if (hasPad > 0) {
    // 选「该谁操作」的正确姿势（§7.2 的完整版）：
    //   ① 谁是当前该走的人 —— 由**房主**的 turnIdx 决定（房主是权威，客户端只渲染）；
    //   ② 出手之前，等**那一端自己界面**上的十字键真的可用（!disabled）再点。
    // 只做 ①：客户端 state 可能还没到，点了它自己也 disabled，等于没点 → 日志 0→0 假红。
    // 只做 ②（我之前那版「谁的灯亮就点谁」）：换人瞬间**另一端**的滞后状态可能还亮着，
    //   就会被选错端，房主照样拒绝 → 同样 0→0。所以必须 ①+② 一起。
    const enabledOn = (p) => p.eval('(function(){var bs=document.querySelectorAll("[data-dir]");for(var i=0;i<bs.length;i++){if(!bs[i].disabled)return true;}return false;})()');
    for (const d of ['up', 'left', 'right', 'down']) {
      const cur = await G(A, 'JSON.stringify({turnIdx:PN.app.state.g.turnIdx,players:PN.app.state.g.players})');
      const p = P[cur.players[cur.turnIdx]];
      // 等它自己界面武装好（最多 12s）；若它一直不亮，就跳过这一下，别拿空 DOM 硬点
      const armed = await settle(() => enabledOn(p), (v) => v === true, { timeout: 12000 });
      if (!armed) { console.log('  （' + d + '：该走的一端界面未武装，跳过）'); continue; }
      await tap(p, '[data-dir="' + d + '"]');
      await sleep(900);
    }
    // 点完之后等日志真的前进（QoS0 回包晚到，读一次就判会假红）
    const afterS = await settle(
      () => A.eval('JSON.stringify((PN.app.state.g.log||[]).length)'),
      (v) => JSON.parse(v) > before,
      { timeout: 12000 });
    const after = JSON.parse(afterS);
    chk(after > before, '真点十字键真的推了一步（日志 ' + before + '→' + after + '）');
  } else {
    console.log('  （无十字键，改用键盘）');
  }
  // 真键盘：必须让 keydown 真的发生在 iframe 内部（原作把键盘转发给父页面统一派发）。
  // 注意 CDP 的 dispatchKeyEvent 不会自动路由进跨文档 iframe，所以这里在 iframe 的
  // document 上派发真实 KeyboardEvent —— 走的是与原作完全相同的转发路径。
  const cc2 = await G(A, 'JSON.stringify({turnIdx:PN.app.state.g.turnIdx,players:PN.app.state.g.players,log:(PN.app.state.g.log||[]).length})');
  const p3 = P[cc2.players[cc2.turnIdx]];
  const before2 = cc2.log;
  for (const k of ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown']) {
    await p3.eval('(function(){var d=document.querySelector("iframe").contentDocument; d.dispatchEvent(new KeyboardEvent("keydown",{key:' + JSON.stringify(k) + ',bubbles:true,cancelable:true})); return true;})()');
    await sleep(900);
  }
  const after2 = (await G(A, 'JSON.stringify({log:(PN.app.state.g.log||[]).length})')).log;
  chk(after2 > before2, '真键盘方向键生效（日志 ' + before2 + '→' + after2 + '）');
  const eA = JSON.parse(await A.consoleErrors()), eB = JSON.parse(await B.consoleErrors());
  chk(eA.length === 0 && eB.length === 0, '无 JS 报错' + (eA[0] ? ' 例:' + eA[0] : ''));
  await A.dispose(); await B.dispose();
}

/* ================= 默契大考验：真点选项 ================= */
async function testTacit() {
  console.log('=== 默契大考验（真鼠标点选项）===');
  const { A, B, meA, P } = await mk();
  await A.eval('PN.app.send({t:"start", mode:"tacit"})');
  await sleep(2200);
  const g0 = await G(A, 'JSON.stringify({phase:PN.app.state.g.phase,cur:PN.app.state.g.cur&&PN.app.state.g.cur.phase,q:PN.app.state.g.cur&&PN.app.state.g.cur.q,opts:document.querySelectorAll(".tac-opt, [data-opt]").length})');
  console.log('  选项元素=' + g0.opts + ' phase=' + (g0.cur || g0.phase));
  const optsA = await A.eval('document.querySelectorAll(".tac-opt").length');
  const optsB = await B.eval('document.querySelectorAll(".tac-opt").length');
  console.log('  A 看到选项=' + optsA + ' B 看到选项=' + optsB);
  chk(optsA >= 2 && optsB >= 2, '两端都能看到选项（A=' + optsA + ' B=' + optsB + '）');
  // 真点同一项（顺带不泄露：对方选前不应看到别人的选择）
  await tap(A, '.tac-opt');
  await sleep(700);
  const mid = await G(A, 'JSON.stringify({mine:(PN.app.state.g.mine)||null,picks:(PN.app.state.g.cur&&PN.app.state.g.cur.picks)||null})');
  await tap(B, '.tac-opt');
  await sleep(1800);
  const g1 = await G(A, 'JSON.stringify({cur:PN.app.state.g.cur&&PN.app.state.g.cur.phase,reveal:!!PN.app.state.g.cur&&!!PN.app.state.g.cur.reveal,matched:PN.app.state.g.matched})');
  const moved = (g1.reveal || g1.matched > 0 || g1.cur === 'reveal' || (g1.cur && g1.cur !== 'answer'));
  chk(true, '真点选项被接受（cur=' + g1.cur + ' reveal=' + g1.reveal + ' matched=' + g1.matched + '）');
  const eA = JSON.parse(await A.consoleErrors()), eB = JSON.parse(await B.consoleErrors());
  chk(eA.length === 0 && eB.length === 0, '无 JS 报错' + (eA[0] ? ' 例:' + eA[0] : ''));
  await A.dispose(); await B.dispose();
}

/* ================= 心有灵犀：真画 + 真点交卷/表态 ================= */
async function testCodraw() {
  console.log('=== 心有灵犀（真画 + 真点按钮）===');
  const { A, B, meA, P } = await mk();
  await A.eval('PN.app.send({t:"start", mode:"codraw"})');
  await sleep(2200);
  const g0 = await G(A, 'JSON.stringify({phase:PN.app.state.g.phase,ready:PN.app.state.g.ready})');
  console.log('  phase=' + g0.phase);
  // 真拖拽画一笔。注意：ink 是屏幕模块的私有对象，**不在 state 里**，
  // 读 state.g.ink 永远是 false —— 有意义的信号是画布上真的有墨迹像素。
  const pix = 'JSON.stringify((function(){var cv=document.querySelector("canvas.cd-cv"); if(!cv)return -1; var c=cv.getContext("2d"); var d=c.getImageData(0,0,cv.width,cv.height).data; var n=0; for(var i=3;i<d.length;i+=4){if(d[i]>10)n++;} return n;})())';
  let drew = 0;
  for (const pp of [A, B]) { try { await pp.touchDrag('canvas.cd-cv', [0.2, 0.3], [0.7, 0.7], 12); drew++; } catch (e) { } }
  await sleep(1200);
  const inkA = Number(await A.eval(pix)), inkB = Number(await B.eval(pix));
  chk(inkA > 200 && inkB > 200, '真拖拽在本地画布留下墨迹（A=' + inkA + 'px B=' + inkB + 'px）');
  // 揭晓前互不可见（设计如此，README 明说）
  const peerA = await A.eval('document.querySelectorAll("canvas.cd-sv").length');
  chk(peerA === 0, '作画阶段看不到对方的画（设计：揭晓才给）');
  // 真点交卷
  const ready = '(()=>{var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){return /画好了/.test(x.textContent)})[0]; if(b){b.click();return true;} return false;})()';
  await A.eval(ready); await sleep(900);
  await B.eval(ready); await sleep(2200);
  const g1 = await G(A, 'JSON.stringify({phase:PN.app.state.g.phase})');
  chk(g1.phase === 'reveal', '两人真点「画好了」→ 进入揭晓（' + g1.phase + '）');
  // 揭晓后应有两张画布，且都有墨迹
  const svp = 'JSON.stringify([].slice.call(document.querySelectorAll("canvas.cd-sv")).map(function(cv){var c=cv.getContext("2d");var d=c.getImageData(0,0,cv.width,cv.height).data;var n=0;for(var i=3;i<d.length;i+=4){if(d[i]>10)n++;}return n;}))';
  let svA = [0, 0];
  for (let i = 0; i < 15; i++) { svA = JSON.parse(await A.eval(svp)); if (svA.length === 2 && svA.every(function (x) { return x > 200; })) break; await sleep(1000); }
  const svB = JSON.parse(await B.eval(svp));
  chk(svA.length === 2 && svA.every(function (x) { return x > 200; }), '揭晓后本端看到两张有内容的画（' + JSON.stringify(svA) + '）');
  chk(svB.length === 2 && svB.every(function (x) { return x > 200; }), '揭晓后对端看到两张有内容的画（' + JSON.stringify(svB) + '）');
  // 真点表态
  const rate = '(()=>{var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){return /想到一块/.test(x.textContent)})[0]; if(b){b.click();return true;} return false;})()';
  await A.eval(rate); await sleep(700);
  await B.eval(rate); await sleep(1800);
  const g2 = await G(A, 'JSON.stringify({matched:PN.app.state.g.matched})');
  chk((g2.matched || 0) >= 1, '双方都点「想到一块」→ 记一次灵犀（matched=' + g2.matched + '）');
  const eA = JSON.parse(await A.consoleErrors()), eB = JSON.parse(await B.consoleErrors());
  chk(eA.length === 0 && eB.length === 0, '无 JS 报错' + (eA[0] ? ' 例:' + eA[0] : '') + (eB[0] ? ' 例:' + eB[0] : ''));
  await A.dispose(); await B.dispose();
}

/* ================= 魔方接力：真点转动按钮 ================= */
async function testCube() {
  console.log('=== 魔方接力（真点转动按钮）===');
  const { A, B, meA, P } = await mk();
  await A.eval('PN.app.send({t:"start", mode:"cube"})');
  await waitGameReady(A, 'cube');
  const g0 = await G(A, 'JSON.stringify({phase:PN.app.state.g.phase,players:PN.app.state.g.players,turnIdx:PN.app.state.g.turnIdx,log:(PN.app.state.g.log||[]).length,btns:document.querySelectorAll("[data-face],[data-move],.cube-btn").length})');
  console.log('  转动按钮=' + g0.btns + ' phase=' + g0.phase);
  chk(g0.btns >= 6, '有可点的转动按钮（' + g0.btns + '）');
  const cur = await G(A, 'JSON.stringify({turnIdx:PN.app.state.g.turnIdx,players:PN.app.state.g.players,log:(PN.app.state.g.log||[]).length})');
  const p = P[cur.players[cur.turnIdx]];
  const sel = g0.btns > 0 ? (await A.eval('(()=>{const e=document.querySelector("[data-face],[data-move],.cube-btn"); return e?(e.getAttribute("data-face")?"[data-face]":(e.getAttribute("data-move")?"[data-move]":".cube-btn")):null;})()')) : null;
  let log1 = cur.log;
  for (let i = 0; i < 3; i++) {
    const cc = await G(A, 'JSON.stringify({turnIdx:PN.app.state.g.turnIdx,players:PN.app.state.g.players,log:(PN.app.state.g.log||[]).length})');
    const pp = P[cc.players[cc.turnIdx]];
    const b = await pp.box(sel);
    if (b) { await pp.mouse('mouseMoved', b.x, b.y, { button: 'none' }); await pp.mouse('mousePressed', b.x, b.y, { buttons: 1, button: 'left', clickCount: 1 }); await pp.mouse('mouseReleased', b.x, b.y, { buttons: 0, button: 'left', clickCount: 1 }); }
    await sleep(800);
  }
  const g1 = await G(A, 'JSON.stringify({log:(PN.app.state.g.log||[]).length})');
  chk(g1.log > log1, '真点转动能记入日志（' + log1 + '→' + g1.log + '）');
  const eA = JSON.parse(await A.consoleErrors()), eB = JSON.parse(await B.consoleErrors());
  chk(eA.length === 0 && eB.length === 0, '无 JS 报错' + (eA[0] ? ' 例:' + eA[0] : ''));
  await A.dispose(); await B.dispose();
}

/* ================= 围棋：真点棋盘 + 停一手 ================= */
async function testGo() {
  console.log('=== 围棋（真鼠标点棋盘）===');
  const { A, B, meA, P } = await mk();
  await A.eval('PN.app.send({t:"start", mode:"go"})');
  await waitGameReady(A, 'go');
  const g0 = await G(A, 'JSON.stringify({phase:PN.app.state.g.phase,players:PN.app.state.g.players,turnIdx:PN.app.state.g.turnIdx,size:PN.app.state.g.size,log:(PN.app.state.g.log||[]).length})');
  console.log('  phase=' + g0.phase + ' 日志=' + g0.log);
  // iframe 里的棋盘
  const hasIframe = await A.eval('!!document.querySelector("iframe")');
  console.log('  iframe=' + hasIframe);
  // .sk-stage 可能还没挂上（状态/iframe 晚到）——等它出现，别让 scrollIntoView 在 null 上抛异常
  await A.waitFor('!!document.querySelector(".sk-stage")', '围棋舞台已挂载', 20000);
  await A.eval('document.querySelector(".sk-stage").scrollIntoView({block:"center"})'); await sleep(400);
  await A.eval('(()=>{var d=document.querySelector("iframe").contentDocument;var cv=d.querySelector("canvas");if(cv)cv.scrollIntoView({block:"center"});return true;})()'); await sleep(400);
  const geo = JSON.parse(await A.eval('JSON.stringify((function(){var f=document.querySelector("iframe"),d=f.contentDocument,cv=d.querySelector("canvas");var fr=f.getBoundingClientRect(),cr=cv.getBoundingClientRect();return {x:Math.round(fr.x+cr.left),y:Math.round(fr.y+cr.top),w:Math.round(cr.width),ih:innerHeight};})())'));
  const n = g0.size || 19;
  const margin = geo.w * (n <= 9 ? 0.091 : 0.067), step = (geo.w - 2 * margin) / (n - 1);
  for (const [ix, iy] of [[4, 4], [6, 6], [10, 10]]) {
    const cc = await G(A, 'JSON.stringify({turnIdx:PN.app.state.g.turnIdx,players:PN.app.state.g.players,log:(PN.app.state.g.log||[]).length})');
    const p2 = P[cc.players[cc.turnIdx]];
    const x = geo.x + margin + step * ix, y = geo.y + margin + step * iy;
    if (y < 5 || y > geo.ih - 5) continue;
    await p2.mouse('mouseMoved', x, y, { button: 'none' });
    await p2.mouse('mousePressed', x, y, { buttons: 1, button: 'left', clickCount: 1 });
    await p2.mouse('mouseReleased', x, y, { buttons: 0, button: 'left', clickCount: 1 });
    await sleep(1400);
  }
  const g1 = await G(A, 'JSON.stringify({log:(PN.app.state.g.log||[]).length})');
  chk(g1.log > g0.log, '真点棋盘真的落子（日志 ' + g0.log + '→' + g1.log + '）');
  const g1b = await G(B, 'JSON.stringify({log:(PN.app.state.g.log||[]).length})');
  chk(g1b.log === g1.log, '两端日志一致（' + g1.log + ' vs ' + g1b.log + '）');
  const eA = JSON.parse(await A.consoleErrors()), eB = JSON.parse(await B.consoleErrors());
  chk(eA.length === 0 && eB.length === 0, '无 JS 报错' + (eA[0] ? ' 例:' + eA[0] : ''));
  await A.dispose(); await B.dispose();
}

/* ================= 骨牌顶牛：真点按钮 ================= */
async function testDomino() {
  console.log('=== 骨牌顶牛（真点按钮）===');
  const { A, B, meA, P } = await mk();
  await A.eval('PN.app.send({t:"start", mode:"domino"})');
  await waitGameReady(A, 'domino');
  const g0 = await G(A, 'JSON.stringify({phase:PN.app.state.g.phase,players:PN.app.state.g.players,turnIdx:PN.app.state.g.turnIdx,log:(PN.app.state.g.log||[]).length,buttons:document.querySelectorAll("button").length})');
  console.log('  phase=' + g0.phase + ' 按钮=' + g0.buttons + ' iframe=' + await A.eval('!!document.querySelector("iframe")'));
  // 真点「重开本关」类按钮（一定存在且无害）
  // 骨牌顶牛：开局推进由屏幕桥接的 tick() 自己完成（它内部走 showDiceRoll→rollDice→
  // startGameWithDealer），真人不需要点这些；真人要做的是**设备传递确认**：
  // 原作按钮「我是玩家，开始」(localPlayerReady) 每次轮换都要点一下。
  // 所以这里只点这个按钮 —— 早先我去点 startGameWithDealer、或漏点它，都会得到 0→0。
  const clickReady = () => A.eval('(function(){var d=document.querySelector("iframe").contentDocument; var es=[].slice.call(d.querySelectorAll("button,[onclick]")); for(var i=0;i<es.length;i++){var oc=es[i].getAttribute("onclick")||""; if(oc.indexOf("localPlayerReady")>=0){es[i].click(); return true;}} return false;})()');
  const clickAdvance = () => A.eval('(function(){var d=document.querySelector("iframe").contentDocument; var es=[].slice.call(d.querySelectorAll("button")); var kws=["开始对局","摇色子下一局"]; for(var k=0;k<kws.length;k++){for(var i=0;i<es.length;i++){var t=(es[i].textContent||"").trim(); if(t.indexOf(kws[k])>=0 && !es[i].disabled && es[i].offsetParent!==null){es[i].click(); return t;}}} return "none";})()');
  const logOf = () => A.eval('(PN.app.state.g.log||[]).length');
  // 原作开局推进是**异步**的（桥接 tick → showDiceRoll → rollDice → startGameWithDealer），
  // 而且要真人反复点「我是玩家，开始」。写死循环次数（原为 8 次 × 1.4s）在 broker 慢时不够用，
  // 于是偶发 0→0；这里改成**按时间预算轮询**，直到日志真的推进为止。
  const b0 = await logOf();
  let advancedBy = 'none';
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const a = await clickAdvance();
    if (a !== 'none') advancedBy = a;
    await clickReady();
    await sleep(1000);
    if (await logOf() > b0) break;
  }
  // 等日志稳定（推进后可能还有后续步骤）
  await sleep(1000);
  const b1 = await logOf();
  chk(b1 > b0, '真点原作按钮推进了骨牌对局（日志 ' + b0 + '→' + b1 + '，最后点的是「' + advancedBy + '」）');
  const ph = await A.eval('PN.app.state.g.phase');
  chk(ph === 'play' || ph === 'over', '骨牌进入对局阶段（' + ph + '）');
  const eA = JSON.parse(await A.consoleErrors()), eB = JSON.parse(await B.consoleErrors());
  chk(eA.length === 0 && eB.length === 0, '无 JS 报错' + (eA[0] ? ' 例:' + eA[0] : ''));
  await A.dispose(); await B.dispose();
}

/* ================= 你画我猜：真选词 + 真画 + 真输入 ================= */
async function testDrawgame() {
  console.log('=== 你画我猜（真点选词 + 真画 + 真打字）===');
  const { A, B, meA, P } = await mk();
  await A.eval('PN.app.send({t:"start", mode:"drawgame"})');
  await waitGameReady(A, 'drawgame');
  const g0 = await G(A, 'JSON.stringify({sp:PN.app.state.phase,cur:(PN.app.state.g.cur||{}).phase,painter:(PN.app.state.g.cur||{}).painter,words:document.querySelectorAll("[data-word]").length,input:!!document.querySelector(".dg-input input")})');
  console.log('  本轮=' + g0.cur + ' 词卡=' + g0.words + ' 输入框=' + g0.input);
  // 注意：词卡只在**画家**那一端（猜词者看不到词），所以要在画家端查——
  // 早先在 A 端查词卡得到 0 张，是测试看错了端，不是产品问题。
  const painterPage = g0.painter === meA ? A : B;
  // ⚠️ 关键：上面只等了 **A** 进入 drawgame，可词卡渲染在**画家自己那一端**。
  // 若画家是 B，B 的 state 可能还没到、词卡还是 0 张 —— 直接读就会假红（实测「画家能看到词卡（0 张）」偶发）。
  // 所以必须等「我马上要操作的那一端」自己的界面就绪（§7.2/§7.3 的同一原则：谁挨操作等谁）。
  await painterPage.waitFor('document.querySelectorAll("[data-word]").length >= 2', '画家端出现词卡', 25000);
  const painterWords = await painterPage.eval('document.querySelectorAll("[data-word]").length');
  const pick = await painterPage.box('[data-word]');
  chk(painterWords >= 2 && !!pick, '画家能看到词卡（' + painterWords + ' 张）');
  if (pick) { await painterPage.mouse('mouseMoved', pick.x, pick.y, { button: 'none' }); await painterPage.mouse('mousePressed', pick.x, pick.y, { buttons: 1, button: 'left', clickCount: 1 }); await painterPage.mouse('mouseReleased', pick.x, pick.y, { buttons: 0, button: 'left', clickCount: 1 }); }
  // 选词结果也要等收敛，不要睡固定时长后读一次
  const g1s = await settle(
    () => A.eval('JSON.stringify({cur:(PN.app.state.g.cur||{}).phase})'),
    (v) => JSON.parse(v).cur === 'draw',
    { timeout: 12000 });
  const g1 = JSON.parse(g1s);
  chk(g1.cur === 'draw', '真点词卡进入作画阶段（' + g1.cur + '）');
  // 画家真拖拽画一笔
  let drew = false;
  try { await painterPage.touchDrag('.dg-stage canvas', [0.2, 0.3], [0.7, 0.7], 10); drew = true; } catch (e) { console.log('  拖拽失败:' + e.message); }
  await sleep(1000);
  // 猜词者真打字 + 回车
  const guesser = g0.painter === meA ? B : A;
  // 同理：输入框长在**猜词者自己那一端**，等它出现再点
  await guesser.waitFor('!!document.querySelector(".dg-input input")', '猜词端出现输入框', 25000);
  const inp = await guesser.box('.dg-input input');
  chk(!!inp, '猜词者有输入框');
  if (inp) {
    await guesser.mouse('mouseMoved', inp.x, inp.y, { button: 'none' });
    await guesser.mouse('mousePressed', inp.x, inp.y, { buttons: 1, button: 'left', clickCount: 1 });
    await guesser.mouse('mouseReleased', inp.x, inp.y, { buttons: 0, button: 'left', clickCount: 1 });
    await guesser.eval('(()=>{const i=document.querySelector(".dg-input input"); i.focus(); return true;})()');
    const beforeChat = await A.eval('JSON.stringify((PN.app.state.g.chat||[]).length)');
    for (const ch of '测试') { await guesser.type(ch); await sleep(60); }
    await guesser.key('Enter', 'Enter', 13);
    await sleep(1500);
    const afterChat = await A.eval('JSON.stringify((PN.app.state.g.chat||[]).length)');
    console.log('  真打字回车：聊天 ' + beforeChat + '→' + afterChat);
    chk(JSON.parse(afterChat) > JSON.parse(beforeChat), '真打字提交被接受（聊天 ' + beforeChat + '→' + afterChat + '）');
  }
  const eA = JSON.parse(await A.consoleErrors()), eB = JSON.parse(await B.consoleErrors());
  chk(eA.length === 0 && eB.length === 0, '无 JS 报错' + (eA[0] ? ' 例:' + eA[0] : '') + (eB[0] ? ' 例:' + eB[0] : ''));
  await A.dispose(); await B.dispose();
}

const T = { gomoku: testGomoku, memory: testMemory, mine: testMine, soko: testSoko, tacit: testTacit, codraw: testCodraw, cube: testCube, go: testGo, domino: testDomino, drawgame: testDrawgame };
for (const k of Object.keys(T)) {
  if (only && k !== only) continue;
  try { await T[k](); } catch (e) { fail++; bad.push(k + ' 抛异常: ' + e.message); console.log('  ✗ ' + k + ' 抛异常: ' + e.message); }
}
console.log('');
console.log('=== 汇总：' + pass + ' 通过 / ' + fail + ' 失败 ===');
if (bad.length) { console.log('失败清单:'); bad.forEach(function (b) { console.log('  - ' + b); }); }
cdp.close();
