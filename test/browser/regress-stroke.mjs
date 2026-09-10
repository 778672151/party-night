// 回归：画笔同步必须连续（真浏览器 + 真 broker + 手机视口 + 真实 touch）
// 旧代码：接收端每收到一块从「本块第一个点」起笔，块与块之间那段永远不画 →
//   快画 = 一截一截（藕断丝连）；慢画（一块只含 1 个点）= 整段都画不出来（别人看不到）。
//   node test/browser/regress-stroke.mjs
import { connect, createRoom, joinRoom, waitPlayers, startGame, sleep, APP, clickUntil } from './lib.mjs';

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const MEASURE = `(() => {
  const c = document.querySelector('.dg-stage canvas');
  if (!c) return JSON.stringify({ ink: -1, comps: -1 });
  const W = c.width, H = c.height;
  const d = c.getContext('2d').getImageData(0, 0, W, H).data;
  let ink = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
  const seen = new Uint8Array(W * H); let comps = 0; const st = [];
  for (let i = 0; i < W * H; i++) {
    if (seen[i] || d[i * 4 + 3] === 0) continue;
    comps++; st.push(i); seen[i] = 1;
    while (st.length) {
      const p = st.pop(), x = p % W, y = (p - x) / W;
      if (x > 0 && !seen[p - 1] && d[(p - 1) * 4 + 3] > 0) { seen[p - 1] = 1; st.push(p - 1); }
      if (x < W - 1 && !seen[p + 1] && d[(p + 1) * 4 + 3] > 0) { seen[p + 1] = 1; st.push(p + 1); }
      if (y > 0 && !seen[p - W] && d[(p - W) * 4 + 3] > 0) { seen[p - W] = 1; st.push(p - W); }
      if (y < H - 1 && !seen[p + W] && d[(p + W) * 4 + 3] > 0) { seen[p + W] = 1; st.push(p + W); }
    }
  }
  return JSON.stringify({ ink: ink, comps: comps });
})()`;

const cdp = await connect();
console.log('browser =', cdp.browser, '| app =', APP);
const A = await createRoom(cdp, '房主');
const B = await joinRoom(cdp, '乙', A.code);
for (const p of [A, B]) await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, p.sid);
await waitPlayers(A, 2);
// 画画时长调短：提示每 max(6, drawSec/(字数+1)) 秒揭一个字，30 秒能保证采样窗口内真的有揭字
await A.eval('PN.app.send({t:"settings",mode:"drawgame",values:{rounds:3,drawSec:30}})');
await sleep(500);
await startGame(A, 'drawgame');
await A.waitFor('PN.app.state.g.cur && PN.app.state.g.cur.phase === "pick"', '选词');
const aId = await A.eval('PN.app.room.me.id');
const painter = await A.eval('PN.app.state.g.cur.painter');
const P = painter === aId ? A : B, G = painter === aId ? B : A;
await P.waitFor('!!document.querySelector("[data-word]")', '选词卡');
await clickUntil(P, '[data-word="0"]', 'PN.app.state.g.cur.phase === "draw"', '作画中');
await sleep(600);
await P.eval('window.__sends = []; const _o = PN.app.send.bind(PN.app); PN.app.send = a => { window.__sends.push(a); return _o(a); }');

async function touchStroke(page, pts, gapMs) {
  const box = await page.box('.dg-stage canvas');
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.left + box.w * pts[0][0], y: box.top + box.h * pts[0][1], id: 1 }] }, page.sid);
  for (const [fx, fy] of pts.slice(1)) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.left + box.w * fx, y: box.top + box.h * fy, id: 1 }] }, page.sid);
    await sleep(gapMs);
  }
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, page.sid);
  await sleep(250);
}

const line = (n, f0, f1, t0, t1) => Array.from({ length: n + 1 }, (_, i) => [f0 + (f1 - f0) * i / n, t0 + (t1 - t0) * i / n]);

console.log('\n[1] 慢慢画一笔（每 150ms 一个点 → 每块只含 1 个点，最容易暴露 bug）');
await touchStroke(P, line(12, 0.15, 0.85, 0.25, 0.25), 150);
let m = JSON.parse(await P.eval(MEASURE)), o = JSON.parse(await G.eval(MEASURE));
console.log('  画家 ink=' + m.ink + ' comps=' + m.comps + ' | 彼端 ink=' + o.ink + ' comps=' + o.comps);
assert(o.ink > m.ink * 0.85, '慢画一笔，另一端看到的墨迹量不少于画家的 85%（旧代码这里是 0 或个位数）');

console.log('\n[2] 再正常速度画一笔，检查有没有「一截一截」');
await touchStroke(P, line(30, 0.15, 0.85, 0.55, 0.65), 12);
await sleep(1500);
m = JSON.parse(await P.eval(MEASURE)); o = JSON.parse(await G.eval(MEASURE));
const strokes = JSON.parse(await P.eval('JSON.stringify([...new Set(window.__sends.filter(a=>a.t==="peer"&&a.msg&&a.msg.t==="stroke").map(a=>a.msg.id))])'));
console.log('  画家 ink=' + m.ink + ' comps=' + m.comps + ' | 彼端 ink=' + o.ink + ' comps=' + o.comps + ' | 共发出 ' + strokes.length + ' 笔');
assert(o.ink > m.ink * 0.85, '两笔都同步过去了（另一端墨迹 ≥ 画家 85%）');
assert(o.comps <= strokes.length + 1, '另一端墨迹块数 ≈ 笔画数（' + o.comps + ' ≤ ' + (strokes.length + 1) + '），没有碎成一截一截');

console.log('\n[3] 两笔之间不许出现「起点连到终点」的多余连线');
// 先把前面两笔清掉，否则它们会落在走廊里，测的就不是「多余连线」了
// 必须点真实的「清空」按钮：客户端会忽略自己发出去的 peer 消息，
// 所以本机的清空是在按钮回调里做的（local.strokes=[] + redrawAll + 广播）
await P.eval("[].slice.call(document.querySelectorAll('.dg-tools button')).filter(function(b){return b.textContent.indexOf('清空')>=0})[0].click()");
await sleep(900);
const clearedP = JSON.parse(await P.eval(MEASURE)), clearedG = JSON.parse(await G.eval(MEASURE));
console.log('  清空后：画家 ink=' + clearedP.ink + ' | 彼端 ink=' + clearedG.ink);
// 上半区画一笔、下半区画一笔，中间那条带子必须是干净的
await touchStroke(P, line(10, 0.15, 0.35, 0.15, 0.15), 60);
await touchStroke(P, line(10, 0.65, 0.85, 0.85, 0.85), 60);
await sleep(1500);
const BAND = `(() => {
  const c = document.querySelector('.dg-stage canvas');
  const W = c.width, H = c.height;
  const d = c.getContext('2d').getImageData(0, 0, W, H).data;
  let n = 0;
  const y0 = Math.round(H * 0.35), y1 = Math.round(H * 0.65);
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 0) n++;
  return n;
})()`;
const bandP = await P.eval(BAND), bandG = await G.eval(BAND);
console.log('  中间走廊墨迹：画家 ' + bandP + ' 像素，彼端 ' + bandG + ' 像素（应为 0）');
assert(bandP < 20, '画家画布两笔之间没有多余连线');
assert(bandG < 20, '另一端两笔之间没有多余连线（旧现象：起点和终点之间突然连一道）');

console.log('\n[4] 猜词者的掩码必须和房主状态逐字一致，且只会越揭越多');
const expectMask = async (page) => page.eval(`(() => {
  const cur = PN.app.state.g.cur || {};
  const len = cur.wordLen || 0, hint = cur.hint || {};
  let out = '';
  for (let i = 0; i < len; i++) out += (hint[i] ? hint[i] : '＿') + (i < len - 1 ? ' ' : '');
  return out;
})()`);
let last = '', revealed = -1, ok = true;
for (let i = 0; i < 6; i++) {
  const shown = (await G.eval("(document.querySelector('.dg-hint')||{}).innerText || ''")).split('\n').pop().trim();
  const want = await expectMask(G);
  if (shown !== want) { ok = false; console.log('    第' + i + '次不一致: 显示 ' + JSON.stringify(shown) + ' 期望 ' + JSON.stringify(want)); }
  const n = (shown.match(/[^＿\s]/g) || []).length;
  if (n < revealed) { ok = false; console.log('    揭开的字变少了: ' + revealed + ' → ' + n); }
  revealed = Math.max(revealed, n);
  last = shown;
  await sleep(2500);
}
console.log('  掩码采样 =', JSON.stringify(last), '揭开字数 =', revealed);
assert(ok, '掩码与房主状态始终一致、且揭开的字不会回退（旧现象：词一直变）');

console.log('\n[5] 猜词者不该看到任何 HTML 源码');
const hint = await G.eval("document.querySelector('.dg-hint') ? document.querySelector('.dg-hint').innerText : ''");
const hintHtml = await G.eval("document.querySelector('.dg-hint') ? document.querySelector('.dg-hint').innerHTML : ''");
console.log('  提示行文本 =', JSON.stringify(hint), '| HTML =', JSON.stringify(hintHtml).slice(0, 90));
assert(!hint.includes('<span') && !hint.includes('class='), '提示行显示的是掩码，不是 <span> 源码');
assert(hint.includes('＿'), '提示行确实有掩码字符');

const hintShot = await G.shot('stroke-guesser');
console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
await A.dispose(); await B.dispose(); cdp.close();
process.exit(fail ? 1 : 0);
