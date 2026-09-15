// 大厅「质感」客观测量：尺寸/间距/字号/空白，供改造前后对比（不靠肉眼）
import { connect, newPage, createRoom, sleep, APP } from './lib.mjs';
const cdp = await connect();
const p = await newPage(cdp, APP);
await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, p.sid);
const A = await createRoom(cdp, '小桃');
await A.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, A.sid);
await sleep(600);
await sleep(1500);
const out = await A.eval(`JSON.stringify((() => {
  const q = (s) => document.querySelector(s);
  const cs = (el, k) => el ? getComputedStyle(el)[k] : null;
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; };
  const cards = [...document.querySelectorAll('.modecard')];
  const root = q('#pn-root') || document.body;
  return {
    viewport: { w: innerWidth, h: innerHeight },
    rootBox: box(root),
    topbar: box(q('.topbar') || q('.roomcode')),
    codeFont: cs(q('.roomcode .code'), 'fontSize'),
    gameNameFont: cs(q('.modecard .gc-nm'), 'fontSize'),
    descFont: cs(q('.modecard .gc-desc'), 'fontSize'),
    cardCount: cards.length,
    card0: box(cards[0]),
    card1: box(cards[1]),
    gridCols: cs(q('.modegrid'), 'gridTemplateColumns'),
    gridGap: cs(q('.modegrid'), 'gap'),
    lastCardBottom: cards.length ? Math.round(cards[cards.length - 1].getBoundingClientRect().bottom) : null,
    docHeight: document.documentElement.scrollHeight,
    blankBelow: cards.length ? Math.round(innerHeight - cards[cards.length - 1].getBoundingClientRect().bottom) : null,
    sectionTitles: [...document.querySelectorAll('.game-head b, .mini-head b')].map(e => e.textContent),
    miniCollapsed: !!q('.mini-sec.collapsed')
  };
})())`);
console.log(JSON.stringify(JSON.parse(out), null, 1));
await A.dispose(); cdp.close();
