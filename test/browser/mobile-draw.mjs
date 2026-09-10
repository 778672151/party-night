// 复现手机端「画笔藕断丝连」：用真实 touch 事件在手机视口下画，检查笔迹连续性
import { connect, newPage, createRoom, joinRoom, waitPlayers, startGame, sleep, assert, APP, clickUntil } from './lib.mjs';

const cdp = await connect();
console.log('browser =', cdp.browser, '| app =', APP);
const A = await createRoom(cdp, '房主');
const B = await joinRoom(cdp, '乙', A.code);
for (const p of [A, B]) { await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, p.sid); }
await waitPlayers(A, 2);
await startGame(A, 'drawgame');

await A.waitFor('PN.app.state.g.cur && PN.app.state.g.cur.phase === "pick"', '选词');
const aId = await A.eval('PN.app.room.me.id');
const painter = await A.eval('PN.app.state.g.cur.painter');
const P = painter === aId ? A : B, G = painter === aId ? B : A;
await P.waitFor('!!document.querySelector("[data-word]")', '选词卡');
await clickUntil(P, '[data-word="0"]', 'PN.app.state.g.cur.phase === "draw"', '作画中');
await sleep(800);
console.log('画家 =', P.name);

// 记录画笔画发出去的每一块
await P.eval('window.__sends = []; const _o = PN.app.send.bind(PN.app); PN.app.send = a => { window.__sends.push(a); return _o(a); }');

async function touchStroke(page, pts) {
  const box = await page.box('.dg-stage canvas');
  const px = (f, i) => ({ x: box.left + box.w * f, y: box.top + box.h * (0.15 + 0.7 * i) });
  const first = pts[0];
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.left + box.w * first[0], y: box.top + box.h * first[1], id: 1 }] }, page.sid);
  for (const [fx, fy] of pts.slice(1)) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.left + box.w * fx, y: box.top + box.h * fy, id: 1 }] }, page.sid);
    await sleep(12);
  }
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, page.sid);
  await sleep(300);
}

// 一笔慢速横线（手指慢慢划）
const slow = [];
for (let i = 0; i <= 40; i++) slow.push([0.1 + 0.8 * i / 40, 0.3 + 0.05 * Math.sin(i / 3)]);
await touchStroke(P, slow);
// 一笔快速斜线（手指一甩）
const fast = [];
for (let i = 0; i <= 12; i++) fast.push([0.15 + 0.7 * i / 12, 0.7 - 0.4 * i / 12]);
await touchStroke(P, fast);
await sleep(2000);

const MEASURE = `(() => {
  const c = document.querySelector('.dg-stage canvas');
  if (!c) return JSON.stringify({ ink: -1, comps: -1 });
  const W = c.width, H = c.height;
  const d = c.getContext('2d').getImageData(0, 0, W, H).data;
  let ink = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
  // 数「连通的墨迹块」：一笔连续画下来应该只有几块；藕断丝连时会变成十几块
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
const mine = JSON.parse(await P.eval(MEASURE));
const other = JSON.parse(await G.eval(MEASURE));
const mineInk = mine.ink, otherInk = other.ink;
console.log('画家: 墨迹', mine.ink, '像素 /', mine.comps, '块');
console.log('彼端: 墨迹', other.ink, '像素 /', other.comps, '块   ← 画两笔，两块才算连续');
console.log('提示行文本 =', JSON.stringify(await G.eval("document.querySelector('.dg-hint') ? document.querySelector('.dg-hint').innerText : ''")).slice(0, 120));

// 统计发出去的笔画块数与「相邻点最大间距」（断笔/拉丝的直接证据）
const stats = await P.eval(`(() => {
  const strokes = {};
  window.__sends.filter(a => a.t === 'peer' && a.msg && a.msg.t === 'stroke').forEach(function (a) {
    (strokes[a.msg.id] = strokes[a.msg.id] || []).push.apply(strokes[a.msg.id], a.msg.s);
  });
  const out = [];
  for (const id in strokes) {
    const p = strokes[id];
    let maxGap = 0, gapAt = -1;
    for (let i = 1; i < p.length; i++) {
      const d = Math.hypot(p[i][0] - p[i-1][0], p[i][1] - p[i-1][1]);
      if (d > maxGap) { maxGap = d; gapAt = i; }
    }
    out.push({ id: id, pts: p.length, maxGap: Math.round(maxGap), gapAt: gapAt });
  }
  return JSON.stringify(out);
})()`);
console.log('画家墨迹像素 =', mineInk, '| 另一端墨迹像素 =', otherInk);
console.log('发出的笔画统计（归一化坐标 0~1000，间距 >60 就肉眼可见断/拉丝）:');
for (const s of JSON.parse(stats)) console.log('   ', JSON.stringify(s));
console.log('另一端 CSS/缓冲尺寸 =', await G.eval("(()=>{const c=document.querySelector('.dg-stage canvas');return c? (c.clientWidth+'x'+c.clientHeight+' buffer '+c.width+'x'+c.height):'no canvas'})()"));
await P.shot('mdraw-painter'); await G.shot('mdraw-guesser');
await A.dispose(); await B.dispose(); cdp.close();
process.exit(0);
