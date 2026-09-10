// 回归：真实浏览器里「画到一半断笔」
// 机理：每条状态消息都会走 ui.render() → clear()（root.innerHTML=''）→ 画布元素被拆出文档。
//       画布正是持有指针捕获的元素，浏览器随即释放捕获并抛 pointercancel → 笔画当场断掉。
//       jsdom 没有指针捕获语义，所以旧测试全绿也测不出来 —— 这里直接断言「落笔期间 DOM 不许重建」。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 本仓库的 test/ 是零依赖的；这条用例需要 DOM，所以 jsdom 是可选的：
//   npm i jsdom --no-save    （装好后重跑本文件；没装则跳过，不算失败）
let JSDOM = null;
try { ({ JSDOM } = await import('jsdom')); }
catch (e) { console.log('SKIP regress-drawgame-screen：未安装 jsdom（npm i jsdom --no-save 后重跑）'); process.exit(0); }

const P = (process.env.PN_SRC || fileURLToPath(new URL('../src/', import.meta.url))) + '/';
const dom = new JSDOM('<!doctype html><html><body><div id="pn-root"></div></body></html>', { runScripts: 'outside-only' });
const w = dom.window, doc = w.document;
try { Object.defineProperty(w, 'devicePixelRatio', { value: 1, configurable: true }); } catch (e) {}

let RECT = { width: 612, height: 612 };
let rectCalls = 0;
w.Element.prototype.getBoundingClientRect = function () {
  rectCalls++;
  if (!this.isConnected) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  return { left: 0, top: 0, right: RECT.width, bottom: RECT.height, width: RECT.width, height: RECT.height, x: 0, y: 0 };
};
const calls = [];
w.HTMLCanvasElement.prototype.getContext = function () {
  const rec = { calls };
  return new Proxy(rec, {
    get(t, k) { if (k === 'canvas') return this; if (k in t) return t[k]; return (...a) => { calls.push([String(k), a]); }; },
    set(t, k, v) { t[k] = v; return true; }
  });
};

w.eval(`
  globalThis.PN = globalThis.PN || {};
  PN.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); };
  PN.screens = PN.screens || {};
  PN.gameCommon = {
    gameHeader: function () { return '<div class="ghead"></div>'; },
    deadlineChip: function () { return '<span class="pill">90s</span>'; },
    scoreboard: function () { return '<div class="sb"></div>'; },
    overButtons: function () { return '<div></div>'; }
  };
`);
w.eval(readFileSync(P + 'ui.js', 'utf8'));           // 真实 ui.js：要测的就是它的 deferRender 钩子
w.eval(readFileSync(P + 'screens-drawgame.js', 'utf8'));

const UI = w.PN.UI, S = w.PN.screens.drawgame;
w.PN.screens.drawgame = S;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

function pointer(el, type, x, y) {
  const Ctor = w.PointerEvent || w.MouseEvent;
  el.dispatchEvent(new Ctor(type, { clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
}
function baseState(stamp) {
  return {
    v: 3, mode: 'drawgame', phase: 'round', hostId: 'p1', log: [],
    players: [{ id: 'p1', name: '甲', emoji: '😎', score: 0, online: true }, { id: 'p2', name: '乙', emoji: '🐱', score: 0, online: true }],
    settings: { drawgame: { rounds: 6, drawSec: 90 } },
    g: {
      round: 1, startedAt: stamp, used: [], order: ['p1', 'p2'], orderIdx: 0,
      cur: { painter: 'p1', left: 'p2', right: 'p2', phase: 'draw', deadline: Date.now() + 90000, wordLen: 2, hint: {}, guessed: {}, reveal: null },
      done: false, winner: null, chat: [{ k: 'sys', id: '', name: '', text: '第 1 回合：甲 来画！', t: 1 }]
    }
  };
}
// 用真实的 UI.prototype.render 驱动真实屏幕：等价于线上 onState → ui.render()
function makeFakeUI(state, id) {
  const sent = [];
  const u = {
    sent, root: doc.getElementById('pn-root'), screen: S, screenName: 'drawgame',
    state, secrets: {},
    pid: () => id || 'p1',
    send: (a) => sent.push(a),
    renderTopbar: () => {},
    renderGameFooter: () => doc.createElement('div')
  };
  u.el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  u.h = function (html) { const d = doc.createElement('div'); d.innerHTML = html; return d.firstElementChild; };
  u.clear = UI.prototype.clear;
  u.render = UI.prototype.render;
  u.flushRender = UI.prototype.flushRender;
  u.snapshotInput = UI.prototype.snapshotInput; // 通用草稿抢救（新增）
  u.restoreInput = UI.prototype.restoreInput;
  return u;
}

console.log('\n[1] ui.js 钩子：deferRender 为真时不许 clear()，并记下待渲染');
const fake = makeFakeUI(baseState(1));
let screenRendered = 0;
fake.screen = { name: 'x', render: function () { screenRendered++; return doc.createElement('div'); }, deferRender: function () { return true; } };
fake.root.innerHTML = '<p>旧内容</p>';
UI.prototype.render.call(fake);
ok(screenRendered === 0, 'deferRender 期间屏幕 render 没被调用');
ok(fake.root.innerHTML === '<p>旧内容</p>', 'DOM 没被清空（画布不会被拆掉）');
ok(fake._renderPending === true, '记下了待补渲染 _renderPending');
fake.screen.deferRender = function () { return false; };
UI.prototype.flushRender.call(fake);
ok(screenRendered === 1 && fake._renderPending === false, 'flushRender 补了一次渲染并清标记');
UI.prototype.flushRender.call(fake);
ok(screenRendered === 1, '没有待渲染时 flushRender 是空操作（不会无限重渲染）');

console.log('\n[2] 画家落笔期间来状态消息：画布必须原地存活、笔画继续');
const ui1 = makeFakeUI(baseState(1000));
UI.prototype.render.call(ui1);
const cv1 = doc.querySelector('canvas');
ok(!!cv1 && cv1.isConnected, '画布已挂载（缓冲区 ' + cv1.width + '×' + cv1.height + '）');
const node1 = doc.getElementById('pn-root').firstElementChild;

rectCalls = 0;
calls.length = 0;
// 探针：记录「clear() 之后画布是否离开了文档」。真实浏览器就是在这一刻释放指针捕获 + 抛 pointercancel。
// jsdom 不会因此派发 pointercancel，所以必须直接探测 DOM 脱落这一前提条件。
let tornOutMidStroke = 0;
const origClear = ui1.clear;
ui1.clear = function () { origClear.call(this); if (!cv1.isConnected) tornOutMidStroke++; };
pointer(cv1, 'pointerdown', 100, 100);
pointer(cv1, 'pointermove', 200, 200);
ok(S.deferRender.call(ui1) === true, '落笔中 deferRender = true（冻结重建）');

// 关键动作：模拟一条状态消息到达（聊天/猜词/加入都会触发）
UI.prototype.render.call(ui1);
ok(tornOutMidStroke === 0, '落笔期间画布一次都没被拆出文档（旧代码：拆 1 次 → 捕获丢失 → pointercancel → 断笔）');
ok(cv1.isConnected === true, '状态消息到达后画布仍在文档里');
ok(doc.querySelector('canvas') === cv1, '还是同一个画布节点，位图不丢');
ok(ui1._renderPending === true, '这次状态更新被记为待补渲染');

const before = calls.filter(c => c[0] === 'lineTo').length;
pointer(cv1, 'pointermove', 300, 150);
const after = calls.filter(c => c[0] === 'lineTo').length;
ok(after > before, '重建风波之后笔画继续画（lineTo ' + before + ' → ' + after + '）');

pointer(cv1, 'pointerup', 300, 150);
const msgs = ui1.sent.filter(a => a.t === 'peer' && a.msg && a.msg.t === 'stroke');
ok(msgs.length >= 1 && msgs[msgs.length - 1].msg.s.length >= 2, '抬手把笔画发出去（' + msgs.length + ' 块）');
ok(rectCalls <= 6, '整笔只量了 ' + rectCalls + ' 次矩形（旧代码每次 pointermove 都量 → 强制整页重排）');

console.log('\n[3] 抬手后把被跳过的渲染补上');
await new Promise(r => setTimeout(r, 30));
ok(ui1._renderPending === false, 'pointerup 后自动补渲染');
ok(!!doc.querySelector('canvas'), '补渲染后画布照旧在');
ok(S.deferRender.call(ui1) === false, '落笔结束 → deferRender = false，状态更新恢复正常重建');

console.log('\n[4] 非落笔状态下，状态更新仍然正常重建（不能把整页卡死）');
const cvBefore = doc.querySelector('canvas');
UI.prototype.render.call(ui1);
ok(doc.querySelector('canvas') === cvBefore, '未落笔时重建：复用同一画布节点，笔画不丢');

console.log('\n[5] 中文输入法：回车确认候选词 ≠ 提交；拼音上屏中不许重建 DOM');
const ui2 = makeFakeUI(baseState(2000), 'p2'); // 猜词者视角：输入框可用
UI.prototype.render.call(ui2);
const cv2 = doc.querySelector('canvas');
const inp2 = doc.querySelector('.dg-input input');
ok(!inp2.disabled, '猜词者输入框可用（可聚焦）');
const CE = w.CompositionEvent || w.Event;
inp2.focus();
inp2.value = 'xiong';
inp2.dispatchEvent(new CE('compositionstart', { bubbles: true }));
inp2.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
ok(!ui2.sent.some(a => a.t === 'guess'), '组合中的回车不提交（旧代码会把半个拼音当答案发出去）');

let torn2 = 0;
const oc2 = ui2.clear;
ui2.clear = function () { oc2.call(this); if (!cv2.isConnected) torn2++; };
UI.prototype.render.call(ui2);
ok(torn2 === 0, '拼音上屏中不重建 DOM（旧代码：输入框被拆 → 未上屏拼音全丢）');
ok(ui2._renderPending === true, '这次状态更新被挂起等上屏');

inp2.value = '熊猫';
inp2.dispatchEvent(new CE('compositionend', { bubbles: true }));
inp2.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
ok(ui2.sent.some(a => a.t === 'guess' && a.text === '熊猫'), '上屏后回车正常提交：' + JSON.stringify(ui2.sent.filter(a => a.t === 'guess')));
await new Promise(r => setTimeout(r, 30));
ok(ui2._renderPending === false, '上屏结束后自动补渲染（挂起的更新不会丢）');

console.log('\n[6] 换轮：画布必须清空（同一局 startedAt 不变，只有 round 变）');
const ui3 = makeFakeUI(baseState(3000), 'p1'); // p1 是画家
UI.prototype.render.call(ui3);
const cvA = doc.querySelector('canvas');
S.mounted.call(ui3, doc.getElementById('pn-root').firstElementChild);
pointer(cvA, 'pointerdown', 40, 40);
pointer(cvA, 'pointermove', 120, 120);
pointer(cvA, 'pointerup', 120, 120);
ok(ui3.sent.some(a => a.t === 'peer' && a.msg.t === 'stroke' && a.msg.r === 1), '第 1 轮画了一笔（带轮次标记 r=1）');

const st2 = baseState(3000); // 同一局：startedAt 与第 1 轮完全相同
st2.g.round = 2;
st2.g.orderIdx = 1;
st2.g.cur.painter = 'p2';
ui3.state = st2; // 真实路径：onState 先更新 ui.state 再 render
UI.prototype.render.call(ui3);
const cvB = doc.querySelector('canvas');
ok(cvB !== cvA, '换轮后是全新画布（旧画布连同内容一起丢掉）');
RECT = { width: 640, height: 640 };
calls.length = 0;
S.mounted.call(ui3, doc.getElementById('pn-root').firstElementChild);
const paintOps = c => c[0] === 'lineTo' || c[0] === 'quadraticCurveTo' || c[0] === 'arc';
ok(calls.filter(paintOps).length === 0, '新轮画布重绘 0 笔（旧代码把上一轮的画原样重绘出来 → 就是你看到的「没清」）');

calls.length = 0;
S.onPeer({ t: 'stroke', id: 'k9r1', r: 1, color: '#222222', w: 9, s: [[100, 100], [200, 200]] });
ok(calls.filter(c => c[0] === 'lineTo').length === 0, '上一轮的笔画残尾被丢弃（不会在新画布上冒鬼影）');
calls.length = 0;
S.onPeer({ t: 'stroke', id: 'k1r2', r: 2, color: '#222222', w: 9, s: [[100, 100], [200, 200]] });
ok(calls.filter(c => c[0] === 'lineTo').length >= 1, '当前轮的笔画正常落地');

RECT = { width: 660, height: 660 };
calls.length = 0;
S.mounted.call(ui3, doc.getElementById('pn-root').firstElementChild);
ok(calls.filter(c => c[0] === 'lineTo').length >= 1, '当前轮笔画确实在画布上（重绘 1 笔）');
S.onPeer({ t: 'clear', r: 1 });
RECT = { width: 680, height: 680 };
calls.length = 0;
S.mounted.call(ui3, doc.getElementById('pn-root').firstElementChild);
ok(calls.filter(c => c[0] === 'lineTo').length >= 1, '上一轮的 clear 被忽略（新轮内容没被误清）');
S.onPeer({ t: 'clear', r: 2 });
RECT = { width: 700, height: 700 };
calls.length = 0;
S.mounted.call(ui3, doc.getElementById('pn-root').firstElementChild);
ok(calls.filter(c => c[0] === 'lineTo').length === 0, '当前轮的 clear 正常清空');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);