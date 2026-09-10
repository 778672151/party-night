// 手机端显示审查：在真实手机视口下走遍每个界面，报告横向溢出/超出屏幕的元素，并截图
// 用法（Windows Edge + CDP，见 README）：node test/browser/mobile-audit.mjs
import { connect, newPage, createRoom, joinRoom, waitPlayers, startGame, sleep, assert, APP, clickUntil } from './lib.mjs';

const SIZES = [[390, 844, 'iPhone12'], [360, 640, 'Android小屏']];
let problems = 0;

async function setViewport(page, w, h) {
  await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }, page.sid);
  await sleep(400);
}

/** 找出横向溢出 / 跑出屏幕的元素（这是手机端最常见的“显示bug”） */
async function check(page, tag) {
  const raw = await page.eval(`(() => {
    const vw = window.innerWidth, bad = [];
    document.querySelectorAll('#pn-root *, .overlay, .toasts').forEach(function (el) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.right > vw + 0.5 || r.left < -0.5) {
        bad.push({
          t: el.tagName.toLowerCase(),
          c: String(el.className || '').slice(0, 34),
          x: (el.textContent || '').trim().slice(0, 16),
          l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width)
        });
      }
    });
    // 小于 32px 高的可点元素（手机上不好点）
    const tiny = [];
    document.querySelectorAll('#pn-root button, #pn-root input').forEach(function (el) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.height < 32) tiny.push({ t: el.tagName.toLowerCase(), c: String(el.className || '').slice(0, 24), x: (el.textContent || '').trim().slice(0, 12), h: Math.round(r.height) });
    });
    return JSON.stringify({
      vw: vw,
      docScrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      hScroll: document.documentElement.scrollWidth > vw + 1,
      bad: bad.slice(0, 10),
      tiny: tiny.slice(0, 8)
    });
  })()`);
  const o = JSON.parse(raw);
  const has = o.hScroll || o.bad.length;
  if (has) problems++;
  console.log('  ' + (has ? '✗' : '✓') + ' [' + tag + '] 视口' + o.vw + ' 文档宽' + o.docScrollW + (o.hScroll ? ' ← 出现横向滚动!' : ''));
  for (const b of o.bad) console.log('      ↳ 溢出: <' + b.t + ' class="' + b.c + '"> "' + b.x + '" 位置 ' + b.l + '~' + b.r + ' (宽' + b.w + ')');
  if (o.tiny.length) console.log('      · 小于32px高: ' + o.tiny.map(t => t.t + '.' + t.c.split(' ')[0] + '(' + t.h + 'px)').join(', '));
  return o;
}

const cdp = await connect();
console.log('browser =', cdp.browser, '| app =', APP);

for (const [w, h, label] of SIZES) {
  console.log('\n================ ' + label + ' ' + w + 'x' + h + ' ================');
  const A = await createRoom(cdp, '房主');
  const B = await joinRoom(cdp, '乙', A.code);
  const C = await joinRoom(cdp, '丙', A.code);
  const pages = [A, B, C];
  for (const p of pages) await setViewport(p, w, h);

  // 落地页
  const L = await newPage(cdp, APP);
  await setViewport(L, w, h);
  await check(L, '落地页');
  await L.shot('mobile-' + label + '-1-land');
  await L.dispose();

  await waitPlayers(A, 3);
  await check(A, '大厅');
  await A.shot('mobile-' + label + '-2-lobby');
  // 展开设置面板（12 个按钮最容易挤爆）
  await A.eval('PN.app._cfgOpen = {undercover:true}; PN.app.render()');
  await sleep(500);
  await check(A, '大厅-设置展开');
  await A.shot('mobile-' + label + '-3-lobby-cfg');
  await A.eval('PN.app._cfgOpen = {}; PN.app.render()');
  await sleep(300);

  // 谁是卧底
  await startGame(A, 'undercover');
  await check(A, '卧底-setup');
  await clickUntil(A, '[data-go]', 'PN.app.state.g.phase === "describe"', '发词完成');
  await check(A, '卧底-describe');
  await A.shot('mobile-' + label + '-4-uc-describe');
  const ids = {}; for (const p of pages) ids[await p.eval('PN.app.room.me.id')] = p;
  for (const id of Object.keys(ids)) { await ids[id].eval('PN.app.send({t:"desc",text:"这是一个稍微长一点的描述文本，看看会不会把布局挤坏"})'); await sleep(250); }
  await A.waitFor('PN.app.state.g.phase === "vote"', '进入投票');
  await sleep(500);
  await check(A, '卧底-vote(人头按钮×3)');
  await A.shot('mobile-' + label + '-5-uc-vote');
  await A.eval('PN.app.send({t:"lobby"})'); await A.waitFor('PN.app.state.mode === "lobby"', '回大厅'); await sleep(600);

  // 波长
  await startGame(A, 'wavelength');
  await A.waitFor('PN.app.state.g.curPhase === "clue"', '线索');
  await sleep(400);
  await check(A, '波长-clue');
  const psychic = await A.eval('PN.app.state.g.cur');
  await ids[psychic].eval('PN.app.send({t:"clue",text:"偏左一点点"})');
  await A.waitFor('PN.app.state.g.curPhase === "guess"', '猜位置');
  await sleep(500);
  await check(A, '波长-guess');
  await A.shot('mobile-' + label + '-6-wave-guess');
  await A.eval('PN.app.send({t:"lobby"})'); await A.waitFor('PN.app.state.mode === "lobby"', '回大厅'); await sleep(600);

  // 谁最有可能
  await startGame(A, 'mostlikely');
  await A.waitFor('PN.app.state.phase === "vote"', '投票');
  await sleep(500);
  await check(A, '谁最可能-vote');
  await A.shot('mobile-' + label + '-7-ml-vote');
  await A.eval('PN.app.send({t:"lobby"})'); await A.waitFor('PN.app.state.mode === "lobby"', '回大厅'); await sleep(600);

  // 你画我猜（工具条 + 双栏最容易挤爆）
  await startGame(A, 'drawgame');
  await A.waitFor('PN.app.state.g.cur && PN.app.state.g.cur.phase === "pick"', '选词');
  await sleep(400);
  await check(A, '画猜-pick');
  const painter = await A.eval('PN.app.state.g.cur.painter');
  const P = ids[painter];
  await P.waitFor('!!document.querySelector("[data-word]")', '选词卡');
  await clickUntil(P, '[data-word="0"]', 'PN.app.state.g.cur.phase === "draw"', '作画中');
  await sleep(600);
  for (const p of pages) await check(p, '画猜-draw ' + (p === P ? '(画家)' : '(猜词者)'));
  await P.shot('mobile-' + label + '-8-draw-painter');
  const G = pages.find(p => p !== P);
  await G.shot('mobile-' + label + '-9-draw-guesser');
  await A.eval('PN.app.send({t:"lobby"})'); await A.waitFor('PN.app.state.mode === "lobby"', '回大厅'); await sleep(600);

  for (const p of pages) await p.dispose();
}

console.log('\n' + (problems ? ('发现 ' + problems + ' 处可疑布局') : '没有发现横向溢出'));
process.exit(0);
