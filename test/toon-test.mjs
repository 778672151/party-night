// 三渲二渲染层：色阶/投影/缓动/弹簧/动画循环（零依赖，假 canvas 计数）
//   node test/toon-test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
function section(n, fn) { console.log('\n' + n); try { fn(); } catch (e) { fail++; console.log('  ✗ 抛异常: ' + (e && e.message)); } }

/* 假 canvas + 计数 ctx：验证"真的画了东西、而且会被自动停掉" */
function fakeCanvas(w) {
  const ops = [];
  const ctx = new Proxy({}, {
    get(_, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'canvas') return { width: 0, height: 0 };
      if (k === 'setTransform' || k === 'save' || k === 'restore' || k === 'beginPath' || k === 'moveTo' ||
        k === 'lineTo' || k === 'closePath' || k === 'fill' || k === 'stroke' || k === 'arc' || k === 'ellipse' ||
        k === 'quadraticCurveTo' || k === 'translate' || k === 'scale' || k === 'rotate' ||
        k === 'fillRect' || k === 'strokeText' || k === 'fillText') return (...a) => { ops.push(k); };
      return undefined;
    },
    set() { return true; },
  });
  return {
    ops, isConnected: true,
    style: {}, width: 0, height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: w, height: w * 0.72, left: 0, top: 0 }),
  };
}

let pending = [];
const sandbox = {
  console, JSON, Math, Date, Promise, Object, Array, String, Number, Boolean, isNaN, parseInt, parseFloat,
  Error, RegExp, WeakMap, TextEncoder, TextDecoder,
  requestAnimationFrame: (fn) => { pending.push(fn); return pending.length; },
  devicePixelRatio: 3,   // 故意超过 2，验证 DPR 被压到 2
};
sandbox.globalThis = sandbox;
const ctxv = vm.createContext(sandbox);
vm.runInContext('var PN = {};', ctxv);
vm.runInContext(read('src/toon.js'), ctxv, { filename: 'src/toon.js' });
const T = vm.runInContext('PN.Toon', ctxv);

function lum(hex) {
  const s = hex.replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

section('[1] 三段色阶（三渲二的核心）：顶面最亮、左面最暗、描边最深', function () {
  const t = T.tone('#ff8fb8');
  ok(lum(t.top) > lum(t.right), '顶面 比 右面 亮');
  ok(lum(t.right) > lum(t.left), '右面 比 左面 亮');
  ok(lum(t.rim) > lum(t.top), '顶边高光 比 顶面 还亮');
  ok(lum(t.line) < lum(t.left), '描边 比所有面都深');
  const keys = ['top', 'left', 'right', 'rim', 'line'].map(k => t[k]);
  ok(new Set(keys).size === 5, '五个颜色互不相同（真的分出了层次）');
  ok(/^#[0-9a-f]{6}$/.test(t.top), '输出是合法 hex：' + t.top);
});

section('[2] 等距投影方向正确（+x 往右下、+z 往左下、+y 往上）', function () {
  const cam = { ox: 100, oy: 100, zoom: 1, a: 0.866, b: 0.5, unit: 26 };
  const o = T.project(0, 0, 0, cam);
  const px = T.project(1, 0, 0, cam), pz = T.project(0, 0, 1, cam), py = T.project(0, 1, 0, cam);
  ok(o.x === 100 && o.y === 100, '原点落在相机偏移处');
  ok(px.x > o.x && px.y > o.y, '+x 方向 → 右下（' + Math.round(px.x) + ',' + Math.round(px.y) + '）');
  ok(pz.x < o.x && pz.y > o.y, '+z 方向 → 左下（' + Math.round(pz.x) + ',' + Math.round(pz.y) + '）');
  ok(py.y < o.y && Math.abs(py.x - o.x) < 1e-9, '+y（高度）→ 垂直向上');
  ok(Math.abs((px.x - o.x) + (pz.x - o.x)) < 1e-9, '等距水平方向左右对称');
  const zoom2 = T.project(1, 0, 0, { ...cam, zoom: 2 });
  ok(Math.abs((zoom2.x - cam.ox) - (px.x - cam.ox) * 2) < 1e-9, 'zoom 线性放大');
});

section('[3] 深度排序：越靠近观察者（x+z 越大）越后画', function () {
  const list = [{ x: 2, z: 0, id: 'near' }, { x: 0, z: 0, id: 'far' }, { x: 1, z: 0, id: 'mid' }];
  const sorted = T.sortByDepth(list);
  ok(sorted[0].id === 'far' && sorted[2].id === 'near', '远→近：' + sorted.map(o => o.id).join(' → '));
  ok(list[0].id === 'near', '不修改原数组（返回副本）');
  ok(T.depth(1, 2) === 3, 'depth = x + z');
});

section('[4] 缓动都在端点收敛且单调', function () {
  ok(T.easeOutCubic(0) === 0 && T.easeOutCubic(1) === 1, 'easeOutCubic 端点 0 → 1');
  ok(T.easeInOutSine(0) === 0 && Math.abs(T.easeInOutSine(1) - 1) < 1e-9, 'easeInOutSine 端点 0 → 1');
  ok(Math.abs(T.easeOutBack(0)) < 1e-9 && Math.abs(T.easeOutBack(1) - 1) < 1e-9, 'easeOutBack 端点 0 → 1');
  ok(T.easeOutBack(0.6) > 1, 'easeOutBack 中段会"过冲"（弹性感，t=0.6 时 ' + T.easeOutBack(0.6).toFixed(3) + '）');
  let prev = -1, mono = true;
  for (let i = 0; i <= 10; i++) { const v = T.easeOutCubic(i / 10); if (v < prev) mono = false; prev = v; }
  ok(mono, 'easeOutCubic 单调不回退');
  ok(T.easeOutCubic(-5) === 0 && T.easeOutCubic(9) === 1, '超范围输入被夹住（不炸）');
});

section('[5] 弹簧会收敛到目标（挤压回弹靠它）', function () {
  let s = { v: 0, vel: 0 };
  for (let i = 0; i < 240; i++) s = T.spring(s.v, 1, s.vel, 1 / 60);
  ok(Math.abs(s.v - 1) < 0.01, '1 秒后收敛到 1（当前 ' + s.v.toFixed(4) + '）');
  let o = { v: 0, vel: 0 }, maxV = 0;
  for (let i = 0; i < 60; i++) { o = T.spring(o.v, 1, o.vel, 1 / 60); maxV = Math.max(maxV, o.v); }
  ok(maxV > 1, '过程中会冲过目标再回来（有回弹，峰值 ' + maxV.toFixed(3) + '）');
});

section('[6] 粒子：生成、受重力、到寿命就消失', function () {
  const list = T.burst([], { x: 0, y: 0 }, 8, '#fff', { speed: 100 });
  ok(list.length === 8, '一次生成 8 个粒子');
  const before = list[0].y;
  T.stepParticles(list, 0.05, null);
  ok(list[0].y !== before, '重力让它动了');
  let n = 0;
  while (list.length && n < 500) { T.stepParticles(list, 0.05, null); n++; }
  ok(list.length === 0, '寿命到了就全部回收（不会无限堆积）');
});

section('[7] 动画循环：真的画了、DPR 压到 2、canvas 被移除就自动停', function () {
  const cv = fakeCanvas(360);
  let drawn = 0, lastWH = null;
  const stop = T.animate(cv, (ctx, W, H, dt) => {
    drawn++;
    lastWH = [W, H];
    T.plate(ctx, { ox: W / 2, oy: H / 2, zoom: 1, unit: 22 }, 0, 0, 1, 1, 0.6, '#8ad7ff');
  }, { ratio: 0.72 });
  ok(pending.length >= 1, '注册了 rAF');
  for (let i = 0; i < 3 && pending.length; i++) { const fn = pending.shift(); fn(16 * (i + 1)); }
  ok(drawn === 3, '连续三帧都执行了绘制（' + drawn + ' 次）');
  ok(lastWH && lastWH[0] === 360, '按 CSS 宽度绘制（' + (lastWH && lastWH[0]) + 'px）');
  ok(cv.width === Math.floor(360 * 2), 'DPR 被压到上限 2：canvas.width=' + cv.width);
  // 一个 plate = 3 个可见面（左/右/顶）各一次 fill，3 帧就是 9 次：面数不对说明三渲二只画了个平片
  ok(cv.ops.filter(o => o === 'fill').length === 9, 'plate 每帧填 3 个面 × 3 帧 = 9 次 fill（实得 ' + cv.ops.filter(o => o === 'fill').length + '）');
  ok(cv.ops.includes('stroke'), 'plate 有描边（三渲二不能只有平涂）');
  cv.isConnected = false;
  const n0 = drawn;
  while (pending.length) pending.shift()(999);
  ok(drawn === n0, 'canvas 从页面移除后不再绘制（省电）');
  ok(typeof stop === 'function', '返回 stop 句柄');
});

section('[8] 颜色工具：mix/lighten/darken 与边界夹紧', function () {
  ok(T.mix('#000000', '#ffffff', 0.5) === '#808080' || T.mix('#000000', '#ffffff', 0.5) === '#7f7f7f' ||
     /#(80|7f)80(80|7f)/.test(T.mix('#000000', '#ffffff', 0.5)), '黑白中点 ≈ 灰：' + T.mix('#000000', '#ffffff', 0.5));
  ok(T.mix('#ff0000', '#00ff00', 0) === '#ff0000', 'k=0 取前者');
  ok(T.mix('#ff0000', '#00ff00', 1) === '#00ff00', 'k=1 取后者');
  ok(T.mix('#ff0000', '#00ff00', 9) === '#00ff00' && T.mix('#ff0000', '#00ff00', -9) === '#ff0000', 'k 超范围被夹住');
  // 关键回归：深色基色也必须能压暗（否则三段色阶会糊成一档）
  ok(T.lighten('#4b3a63', 0.3) !== '#4b3a63', '亮色基色：lighten 生效 → ' + T.lighten('#4b3a63', 0.3));
  ok(T.darken('#4b3a63', 0.3) !== '#4b3a63', '深色基色：darken 也生效 → ' + T.darken('#4b3a63', 0.3));
  ok(lum(T.darken('#4b3a63', 0.3)) < lum('#4b3a63'), 'darken 确实更暗（不是只换色相）');
  ok(lum(T.lighten('#241d38', 0.4)) > lum('#241d38') && lum(T.darken('#241d38', 0.4)) < lum('#241d38'),
    '极暗色两端都能拉开');
});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
