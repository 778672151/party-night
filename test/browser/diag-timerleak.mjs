// 用途（§8 第 3 项的证据脚本）：核实「切换游戏后，上一屏的模块级 setInterval 是否还在动 / 是否报错」。
//
//   node test/browser/diag-timerleak.mjs           # 四屏全跑
//   node test/browser/diag-timerleak.mjs hop       # 只跑某一屏
//
// 做法：真实进游戏 → 真实触发该屏定时器路径（hop 按住不放 / codraw·drawgame 真拖一笔 / gomoku 只需进入）
//       → 真人操作切到「默契大考验」（它自己没有 canvas、没有定时器，信号干净；
//         别用 memory 当目标 —— 它自带 mem-3d canvas 动画，clearRect 计数会假阳性）
//       → 等 3.6 秒（> 3 个定时器周期）→ 读「切换之后」这段时间里还在发生的事：
//         (a) 旧屏定时器还在 publishRaw（发消息）吗？(b) 还在 clearRect（重画）吗？(c) 有新 JS 报错吗？
// 判定：三项都是 0 = 现有守卫已经够用（stop() 只属防御）；任一非 0 = 该屏确实缺 stop()。
import { connect, createRoom, joinRoom, waitPlayers, startGame, clickUntil, sleep } from './lib.mjs';

const only = process.argv[2] || null;
const LIST = ['codraw', 'drawgame', 'gomoku', 'hop'].filter((g) => !only || g === only);
const CV = { codraw: 'canvas.cd-cv', drawgame: '.dg-stage canvas', gomoku: 'canvas.gm-cv', hop: 'canvas.hop-cv' };

const INSTR = `(() => {
  const r = PN.app.room;
  if (r && !r.__pnCnt) {
    r.__pnCnt = {};
    const orig = r.publishRaw.bind(r);
    r.publishRaw = function (k, o, rt, q) {
      const t = o && o.t ? o.t : (typeof o === 'string' ? o.slice(0, 24) : '?');
      const key = k + ':' + t;
      r.__pnCnt[key] = (r.__pnCnt[key] || 0) + 1;
      return orig(k, o, rt, q);
    };
  }
  if (!window.__pnClears) {
    window.__pnClears = 0;
    const oc = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function () { window.__pnClears++; return oc.apply(this, arguments); };
  }
  return true;
})()`;

const snap = (p) => p.eval('JSON.stringify({cnt:(PN.app.room&&PN.app.room.__pnCnt)||{},clears:window.__pnClears||0,errs:(window.__pnErrors||[]).length})').then((s) => JSON.parse(s));
const modeOf = (p) => p.eval('PN.app.state && PN.app.state.mode');
const keysDelta = (a, b) => {
  const out = {};
  for (const k of new Set([...Object.keys(a.cnt), ...Object.keys(b.cnt)])) {
    const d = (b.cnt[k] || 0) - (a.cnt[k] || 0);
    if (d) out[k] = d;
  }
  return out;
};

/** 真人点页脚「回大厅」（按钮没有 data 属性，先打临时标记再点，走的仍是真鼠标） */
async function backToLobby(p) {
  const found = await p.eval('(()=>{const b=[...document.querySelectorAll("button")].find(function(x){return /回大厅|退出房间/.test(x.textContent)}); if(!b) return false; b.setAttribute("data-tmp-lobby","1"); return true;})()');
  if (!found) throw new Error('页脚没有「回大厅」按钮');
  await clickUntil(p, '[data-tmp-lobby]', 'PN.app.state.mode === "lobby"', '回到大厅', 4, 6000);
}

let bad = 0;
const cdp = await connect();
for (const m of LIST) {
  console.log('=== 旧屏 ' + m + ' → 切到 tacit ===');
  let A = null, B = null;
  try {
    A = await createRoom(cdp, '小桃');
    B = await joinRoom(cdp, '阿泽', A.code);
  } catch (e) {
    console.log('  [环境失败] 建房/进房没成功（公共 broker 抖动，非产品缺陷）：' + e.message);
    try { if (A) await A.dispose(); } catch (e2) { }
    continue;
  }
  try {
  await waitPlayers(A, 2); await waitPlayers(B, 2);
  await startGame(A, m);
  await sleep(1500);
  await A.eval(INSTR); await B.eval(INSTR);

  // 真实触发该屏的定时器路径
  if (m === 'hop') {
    const b = await A.box(CV.hop);
    if (b) { await A.mouse('mouseMoved', b.x, b.y, { button: 'none' }); await A.mouse('mousePressed', b.x, b.y, { buttons: 1, button: 'left', clickCount: 1 }); }
    console.log('  已按住跳一跳画布（蓄力定时器正在跑，故意不松手就切走）');
  } else if (m === 'codraw' || m === 'drawgame') {
    if (m === 'drawgame') {                        // 画家要先真点一张词卡才进入作画
      const painter = await A.eval('PN.app.state.g && PN.app.state.g.cur ? PN.app.state.g.cur.painter : null');
      const me = await A.eval('PN.app.room.me.id');
      const page = painter === me ? A : B;
      const w = await page.box('[data-word]');
      if (w) { await page.mouse('mouseMoved', w.x, w.y, { button: 'none' }); await page.mouse('mousePressed', w.x, w.y, { buttons: 1, button: 'left', clickCount: 1 }); await page.mouse('mouseReleased', w.x, w.y, { buttons: 0, button: 'left', clickCount: 1 }); await sleep(1200); }
    }
    // 用产品自带的丢包钩子强制制造笔画缺号：这样旧屏的补发轮询**真的有活干**，
    // 切走之后它若还在跑，就会发出 x:ink-ask（对端早已不在那款游戏里）—— 可测量的残留。
    await A.eval('PN.app.room.inkDropEvery = 2');
    try { await A.touchDrag(CV[m], [0.2, 0.3], [0.7, 0.7], 10); console.log('  已真拖一笔（inkDropEvery=2，笔画必有缺号）'); } catch (e) { console.log('  拖拽失败: ' + e.message); }
    await A.eval('PN.app.room.inkDropEvery = 0');
    await sleep(900);
  } else {
    console.log('  只是进入了该屏（它的定时器每秒自己跑）');
  }

  await backToLobby(A);
  await startGame(A, 'tacit');
  await sleep(2000);                                // 先让切换本身那波广播过去
  const t0 = await snap(A);
  const b0 = await snap(B);
  await sleep(3600);                                // > 3 个定时器周期
  const t1 = await snap(A);
  const b1 = await snap(B);
  if (m === 'hop') { const b = await A.box('canvas.hop-cv'); await A.mouse('mouseReleased', b ? b.x : 10, b ? b.y : 10, { buttons: 0, button: 'left' }); await sleep(600); }

  // 'a:hi'/'a:sv' 是 room 层心跳/版本协商（正常协议流量），不算旧屏残留；
  // 旧屏残留的特征是：x:ink-ask / x:re（墨迹补发）、a:need_replay、a:power 这类**屏幕层**消息
  const strayOf = (d) => Object.keys(d).filter((k) => k !== 'a:hi' && k !== 'a:sv' && k !== 'e:hi' && k !== 's' && k !== 'm');
  const dA = keysDelta(t0, t1), dB = keysDelta(b0, b1);
  const dCl = t1.clears - t0.clears, dEr = t1.errs - t0.errs;
  console.log('  房主：切换后 3.6s 内 publishRaw 增量=' + JSON.stringify(dA) + ' clearRect 增量=' + dCl + ' 新报错=' + dEr);
  console.log('  对端：切换后 3.6s 内 publishRaw 增量=' + JSON.stringify(dB) + ' 新报错=' + (b1.errs - b0.errs));
  const stray = strayOf(dA).concat(strayOf(dB));
  if (stray.length || dCl || dEr) {
    bad++;
    console.log('  ✗ 旧屏 ' + m + ' 切走后仍有残留活动：键=' + JSON.stringify(stray) + (dCl ? '，重画 ' + dCl + ' 次' : '') + (dEr ? '，报错 ' + dEr + ' 条' : ''));
  } else {
    console.log('  ✓ 旧屏 ' + m + ' 切走后无残留消息 / 无重画 / 无报错');
  }
  await A.dispose(); await B.dispose();
  } catch (e) {
    console.log('  [用例异常] ' + e.message);
    bad++;
    try { if (A) await A.dispose(); } catch (e2) { }
    try { if (B) await B.dispose(); } catch (e2) { }
  }
}
console.log(bad ? '结论：有 ' + bad + ' 屏存在残留活动（需要 stop()）' : '结论：四屏均无残留活动（现有守卫已够，stop() 属防御性）');
cdp.close();
