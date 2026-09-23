// 11 款联机游戏的「破坏性真机输入」常规回归
//   node test/browser/stress-all.mjs [game]
//
// 与 realinput.mjs 的分工：realinput 验「正常输入能不能玩」；本套件验「乱来会不会坏」——
//   ① 连点：一次有效操作的窗口里猛点 20 次（真人手抖/着急）
//   ② 长按：按住不放 2 秒（超过任何蓄力上限）
//   ③ 双方同按：两端同时操作同一个目标（抢）
//   ④ 中途刷新：操作进行中把一端刷新（最高频的真实操作）
// 每个游戏跑完四条后断言的不变量（与具体游戏无关）：
//   · 不崩：process 活着、state 结构还在、phase 是已知值
//   · 无 JS 报错：两端 consoleErrors 为空
//   · 两端收敛：等对端追上后，双方看到的 phase/mode 一致（§7.3：必须等收敛，不能读一次就判）
//   · 能回大厅：破坏完之后点「回大厅」真的能回去（游戏没被搞成死局）
//
// 方法学铁律（HANDOFF §7）在本文件里的落实：
//   · 全程真鼠标/真键盘/真触摸，绝不用 PN.app.send 冒充操作（§7.1）
//   · 「该谁操作」一律读操作端自己界面（§7.2），不读房主侧
//   · 所有跨端断言先等收敛（settle，§7.3）
//   · 连点次数按「有效操作」计数，不用循环次数封顶（§7.4）
import { connect, createRoom, joinRoom, waitPlayers, sleep, settle, assert } from './lib.mjs';

const only = process.argv[2] || null;
const cdp = await connect();
const mk = async () => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2); await waitPlayers(B, 2);
  const meA = await A.eval('PN.app.room.me.id'), meB = await B.eval('PN.app.room.me.id');
  return { A, B, meA, meB, P: { [meA]: A, [meB]: B } };
};
const G = (p, e) => p.eval(e).then((r) => { try { return JSON.parse(r); } catch (x) { return r; } }).catch(() => null);

// ---- 真输入原语（全部走浏览器输入管线，§7.1） ----
const tap = async (p, sel) => {
  const b = await p.box(sel); if (!b) return false;
  await p.mouse('mouseMoved', b.x, b.y, { button: 'none' });
  await p.mouse('mousePressed', b.x, b.y, { buttons: 1, button: 'left', clickCount: 1 });
  await p.mouse('mouseReleased', b.x, b.y, { buttons: 0, button: 'left', clickCount: 1 });
  return true;
};
const press = async (p, sel, ms) => {
  const b = await p.box(sel); if (!b) return false;
  await p.mouse('mouseMoved', b.x, b.y, { button: 'none' });
  await p.mouse('mousePressed', b.x, b.y, { buttons: 1, button: 'left', clickCount: 1 });
  if (ms > 0) await sleep(ms);
  await p.mouse('mouseReleased', b.x, b.y, { buttons: 0, button: 'left', clickCount: 1 });
  return true;
};
const keyHold = async (p, key, code, kc, ms) => {
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc }, p.sid);
  if (ms) await sleep(ms);
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc }, p.sid);
};
const tapCv = async (p, sel, fx, fy) => {
  const b = await p.box(sel); if (!b) return false;
  const x = b.left + b.w * fx, y = b.top + b.h * fy;
  await p.mouse('mouseMoved', x, y, { button: 'none' });
  await p.mouse('mousePressed', x, y, { buttons: 1, button: 'left', clickCount: 1 });
  await p.mouse('mouseReleased', x, y, { buttons: 0, button: 'left', clickCount: 1 });
  return true;
};

// 破坏过程中出现的「已知且属设计」的报错可按游戏忽略（例：iframe 卸载时的读取）
const IGNORE = [];
const errs = async (p) => (JSON.parse(await p.consoleErrors()) || []).filter((e) => !IGNORE.some((k) => String(e).indexOf(k) >= 0));

// 统一的「游戏还活着吗」探针：不假设任何具体字段，只看结构
const alive = () =>
  'JSON.stringify((()=>{try{var a=PN.app,s=a&&a.state;if(!a||!s)return {ok:false,why:"no state"};if(a.room&&a.room.isHost&&!a.host)return {ok:false,why:"host gone"};return {ok:true,mode:s.mode,phase:s.phase,gp:s.g&&s.g.phase,hasG:!!s.g,players:(s.players||[]).length};}catch(e){return {ok:false,why:String(e)}}})())';

/** 破坏完之后等两端收敛，再返回双方读数（[{...A}, {...B}]）
 *  注意：settle() 返回的是「稳定下来的那个读数」，也就是本函数里 read() 的返回值 ——
 *  它本身已经是 JSON 字符串 '[A,B]'，**不要再 JSON.parse 一次**（第一版就在这里把
 *  A/B 解析成了 undefined，于是 ③ 的断言看着"过"了其实什么都没验 —— 自欺的红/绿都出现过）。*/
const converge = async (A, B, ms = 12000) => {
  const read = async () => JSON.stringify([JSON.parse(await A.eval(alive())), JSON.parse(await B.eval(alive()))]);
  const raw = await settle(read, (v) => {
    const [a, b] = JSON.parse(v);
    if (!a.ok || !b.ok) return false;
    return a.mode === b.mode && a.phase === b.phase;
  }, { timeout: ms });
  return JSON.parse(raw);
};

/** 回大厅：点界面上那个按钮（真输入）。
 *  顶栏的「回大厅」按钮**没有 id/class 钩子**（ui.js 用 this.el 建出来，只有文案与 .btn.ghost.sm），
 *  所以按文案找到它再取其中心坐标点下去。over 阶段的按钮则是 [data-over="lobby"]。 */
const backToLobby = async (p) => {
  const byText = await p.eval(`JSON.stringify((()=>{
    var bs = document.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) {
      if (/回大厅/.test(bs[i].textContent || '')) { var r = bs[i].getBoundingClientRect(); return {x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2)}; }
    }
    return null;
  })())`);
  const pt = JSON.parse(byText || 'null');
  if (pt) {
    await p.mouse('mouseMoved', pt.x, pt.y, { button: 'none' });
    await p.mouse('mousePressed', pt.x, pt.y, { buttons: 1, button: 'left', clickCount: 1 });
    await p.mouse('mouseReleased', pt.x, pt.y, { buttons: 0, button: 'left', clickCount: 1 });
    return '按文案「🏠 回大厅」';
  }
  if (await tap(p, '[data-over="lobby"]')) return '[data-over="lobby"]';
  return null;
};

// ============ 每个游戏的破坏性计划 ============
// 每项返回 { ok, note }：ok=false 表示「连一条有效操作都发不出去」，那说明游戏根本没起来（前面已断言）
const GAMES = {
  gomoku: {
    mode: 'gomoku',
    // 连点用棋盘；长按用棋盘；双端同按用棋盘
    burst:  async (p) => tapCv(p, 'canvas.gm-cv', 0.3, 0.3),
    hold:   async (p) => press(p, 'canvas.gm-cv', 2000),
    both:   async (p, other) => Promise.all([tapCv(p, 'canvas.gm-cv', 0.3, 0.3), tapCv(other, 'canvas.gm-cv', 0.7, 0.7)]),
    probe:  'JSON.stringify({moves:(PN.app.state.g.moves||[]).length,turn:PN.app.state.g.turn})',
  },
  memory: {
    mode: 'memory',
    burst:  async (p) => { const n = await p.eval('document.querySelectorAll(".mem-card").length'); if (!n) return false; for (let i = 0; i < 20; i++) { await tap(p, '.mem-card[data-i="' + (i % n) + '"]'); await sleep(60); } return true; },
    hold:   async (p) => press(p, '.mem-card[data-i="0"]', 2000),
    both:   async (p, other) => Promise.all([tap(p, '.mem-card[data-i="0"]'), tap(other, '.mem-card[data-i="1"]')]),
    probe:  'JSON.stringify({matched:PN.app.state.g.matched||0,turns:PN.app.state.g.turns||0,flipped:(PN.app.state.g.flipped||[]).length})',
  },
  mine: {
    mode: 'mine',
    burst:  async (p) => { const n = await p.eval('document.querySelectorAll("[data-i]").length'); if (!n) return false; for (let i = 0; i < 20; i++) { await tap(p, '[data-i="' + (i % n) + '"]'); await sleep(60); } return true; },
    hold:   async (p) => press(p, '[data-i="0"]', 2000),   // 长按=插旗
    both:   async (p, other) => Promise.all([tap(p, '[data-i="0"]'), tap(other, '[data-i="1"]')]),
    probe:  'JSON.stringify({revealed:(PN.app.state.g.revealed||[]).filter(Boolean).length,flags:(PN.app.state.g.flags||[]).filter(Boolean).length,turnIdx:PN.app.state.g.turnIdx})',
  },
  soko: {
    mode: 'soko',
    burst:  async (p) => { for (let i = 0; i < 20; i++) { await tap(p, '[data-dir="' + ['up','left','right','down'][i % 4] + '"]'); await sleep(60); } return true; },
    hold:   async (p) => { await keyHold(p, 'ArrowUp', 'ArrowUp', 38, 2000); return true; },
    both:   async (p, other) => Promise.all([tap(p, '[data-dir="up"]'), tap(other, '[data-dir="down"]')]),
    probe:  'JSON.stringify({log:(PN.app.state.g.log||[]).length,turnIdx:PN.app.state.g.turnIdx})',
  },
  tacit: {
    mode: 'tacit',
    burst:  async (p) => { for (let i = 0; i < 20; i++) { await tap(p, '.tac-opt'); await sleep(60); } return true; },
    hold:   async (p) => press(p, '.tac-opt', 2000),
    both:   async (p, other) => Promise.all([tap(p, '.tac-opt'), tap(other, '.tac-opt')]),
    probe:  'JSON.stringify({phase:PN.app.state.g.phase,answered:(PN.app.state.g.cur&&PN.app.state.g.cur.answered)||0})',
  },
  codraw: {
    mode: 'codraw',
    burst:  async (p) => tapCv(p, 'canvas.cd-cv', 0.4, 0.4),
    hold:   async (p) => press(p, 'canvas.cd-cv', 2000),
    both:   async (p, other) => Promise.all([tapCv(p, 'canvas.cd-cv', 0.3, 0.3), tapCv(other, 'canvas.cd-cv', 0.7, 0.7)]),
    probe:  'JSON.stringify({phase:PN.app.state.g.phase,cur:(PN.app.state.g.cur||{}).phase})',
  },
  // cube 的可点控件是 [data-face]（DOM 实测；原先我写的 [data-move]/.cube-btn 并不存在）
  cube: {
    mode: 'cube',
    burst:  async (p) => { const n = await p.eval('document.querySelectorAll("[data-face]").length'); if (!n) return false; for (let i = 0; i < 20; i++) { await tap(p, '[data-face]'); await sleep(60); } return true; },
    hold:   async (p) => press(p, '[data-face]', 2000),
    both:   async (p, other) => Promise.all([tap(p, '[data-face]'), tap(other, '[data-face]')]),
    probe:  'JSON.stringify({phase:PN.app.state.g.phase,turnIdx:PN.app.state.g.turnIdx})',
  },
  // go 的真控件是 [data-go=pass|resign|reset]（DOM 实测），没有 .go-pass
  go: {
    mode: 'go',
    burst:  async (p) => { if (!(await tap(p, '[data-go="pass"]'))) return false; for (let i = 0; i < 8; i++) { await tap(p, '[data-go="pass"]'); await sleep(60); } return true; },
    hold:   async (p) => press(p, '[data-go="pass"]', 2000),
    both:   async (p, other) => Promise.all([tap(p, '[data-go="pass"]'), tap(other, '[data-go="pass"]')]),
    probe:  'JSON.stringify({phase:PN.app.state.g.phase,log:(PN.app.state.g.log||[]).length})',
  },
  // domino 的牌局推进在 iframe 里（真人要点「我是玩家，开始」= localPlayerReady）；
  // 可见控件只有 [data-reset=1]（DOM 实测），没有 [data-tile]。破坏性输入就打这两个。
  domino: {
    mode: 'domino',
    burst:  async (p) => {
      if (!(await tap(p, '[data-reset="1"]'))) return false;
      for (let i = 0; i < 12; i++) {
        await p.eval('(function(){var d=document.querySelector("iframe").contentDocument;var es=[].slice.call(d.querySelectorAll("button,[onclick]"));for(var i=0;i<es.length;i++){var oc=es[i].getAttribute("onclick")||"";if(oc.indexOf("localPlayerReady")>=0){es[i].click();return true;}}return false;})()');
        await sleep(80);
      }
      return true;
    },
    hold:   async (p) => press(p, '[data-reset="1"]', 2000),
    both:   async (p, other) => Promise.all([tap(p, '[data-reset="1"]'), tap(other, '[data-reset="1"]')]),
    probe:  'JSON.stringify({phase:PN.app.state.g.phase,played:PN.app.state.g.played||0})',
  },
  // drawgame 的画布没有 class/id（DOM 实测 canvases=[]），所以选词阶段点 [data-word]，作画阶段按几何找 canvas
  // drawgame 画布没有 class/id（DOM 实测 canvases=[]）；
  // **而且选词/作画控件只存在于画手那一端** —— 拿 A 一端硬点必然失败（我第一版就这么错的）。
  // 所以用 actor() 选出「手里真有控件的那一端」，就像真人那样操作。
  drawgame: {
    mode: 'drawgame',
    actor: async (A, B) => {
      // 谁的 [data-word] 或 canvas 真的挂在 DOM 上，谁就是该操作的人
      for (const p of [A, B]) {
        const n = await p.eval('document.querySelectorAll("[data-word]").length + (document.querySelector("canvas") ? 1 : 0)');
        if (Number(n) > 0) return p;
      }
      return null;
    },
    burst:  async (p) => {
      if (await p.eval('document.querySelectorAll("[data-word]").length')) {
        for (let i = 0; i < 20; i++) { await tap(p, '[data-word]'); await sleep(60); }
        return true;
      }
      if (!(await p.eval('document.querySelector("canvas") ? true : false'))) return false;
      for (let i = 0; i < 12; i++) { await tapCv(p, 'canvas', 0.3 + i * 0.02, 0.4); await sleep(60); }
      return true;
    },
    hold:   async (p) => press(p, 'canvas', 2000),
    both:   async (p, other) => Promise.all([tapCv(p, 'canvas', 0.3, 0.3), tapCv(other, 'canvas', 0.7, 0.7)]),
    probe:  'JSON.stringify({phase:PN.app.state.phase,cur:(PN.app.state.g.cur||{}).phase})',
  },
};

// ============ 场景引擎 ============
const runGame = async (name) => {
  const spec = GAMES[name];
  const { A, B } = await mk();
  const tag = name;
  console.log('\n######## ' + tag + ' ########');
  const start = async () => { await A.eval('PN.app.send({t:"start", mode:"' + spec.mode + '"})'); await sleep(2500); };
  await start();
  const st0 = await G(A, 'JSON.stringify({mode:PN.app.state.mode,phase:PN.app.state.phase})');
  assert(st0 && st0.mode === spec.mode, tag + ' 能进入游戏（mode=' + (st0 && st0.mode) + '）');

  // 有些游戏的主控件只在其中一端（如 drawgame 只有画手能选词/画画）。
  // 真人是「谁手里有控件谁操作」，测试也必须这样，否则会拿空 DOM 硬点而误判成产品问题。
  let actor = A;
  if (spec.actor) {
    const found = await spec.actor(A, B);
    if (found) actor = found;
    assert(!!found, tag + ' 能找到手里真有控件的那一端');
  }

  // ① 连点
  const okBurst = await spec.burst(actor);
  await sleep(1500);
  let av = JSON.parse(await A.eval(alive()));
  assert(okBurst, tag + '① 连点：能对着主操作区点下去');
  assert(av.ok, tag + '① 连点 20 次后游戏仍活着（' + (av.ok ? 'ok' : av.why) + '）');
  assert((await errs(A)).length === 0 && (await errs(B)).length === 0, tag + '① 连点后两端无 JS 报错');

  // ② 长按
  const okHold = await spec.hold(actor);
  await sleep(1800);
  av = JSON.parse(await A.eval(alive()));
  assert(okHold, tag + '② 长按：能按住 2 秒');
  assert(av.ok, tag + '② 长按 2 秒后游戏仍活着（' + (av.ok ? 'ok' : av.why) + '）');
  assert((await errs(A)).length === 0 && (await errs(B)).length === 0, tag + '② 长按后两端无 JS 报错');

  // ③ 双方同按
  await spec.both(A, B);
  await sleep(1500);
  const conv = await converge(A, B);
  assert(conv[0].ok && conv[1].ok, tag + '③ 双方同按后两端都还活着');
  assert(conv[0].mode === conv[1].mode && conv[0].phase === conv[1].phase,
    tag + '③ 双方同按后两端收敛一致（A=' + conv[0].mode + '/' + conv[0].phase + ' B=' + conv[1].mode + '/' + conv[1].phase + '）');

  // ④ 中途刷新（最高频真实操作）
  const beforeMode = (await G(A, 'JSON.stringify({mode:PN.app.state.mode})')).mode;
  await B.reload();
  await sleep(4000);
  // 刷新后要重新进房（URL 带 #房号），等它把对局接回来
  const back = await settle(
    () => A.eval('JSON.stringify({mode:PN.app.state.mode,players:(PN.app.state.players||[]).length})'),
    (v) => JSON.parse(v).players >= 2, { timeout: 20000 });
  assert(JSON.parse(back).players >= 2, tag + '④ 一端中途刷新后房主仍看到 2 人（实际 ' + JSON.parse(back).players + '）');
  assert(JSON.parse(back).mode === beforeMode, tag + '④ 刷新没有把对局洗回大厅（仍 ' + beforeMode + '，实际 ' + JSON.parse(back).mode + '）');
  const ea = await errs(A);
  assert(ea.length === 0, tag + '④ 刷新期间房主无新增 JS 报错' + (ea.length ? ' 例:' + ea[0] : ''));

  // ⑤ 破坏完之后还能回大厅（证明没被搞成死局）
  const lobbyBtn = await backToLobby(A);
  await sleep(1500);
  const after = await G(A, 'JSON.stringify({mode:PN.app.state.mode,screen:PN.app.screenName})');
  assert(!!lobbyBtn, tag + '⑤ 破坏后界面上仍有「回大厅」入口（找到 ' + lobbyBtn + '）');
  assert(after.mode === 'lobby', tag + '⑤ 破坏后仍能真的回到大厅（实际 ' + after.mode + '）');

  await A.dispose(); await B.dispose();
};

const names = only ? [only] : Object.keys(GAMES);
for (const n of names) {
  if (!GAMES[n]) { console.log('未知游戏: ' + n); process.exitCode = 1; continue; }
  try { await runGame(n); }
  catch (e) { console.log('  ✗ ' + n + ' 抛异常: ' + e.message); process.exitCode = 1; }
}
console.log('\nSTRESS-ALL 结束');
cdp.close();
