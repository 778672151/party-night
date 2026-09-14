// 第27轮受控 A/B 结论：本缺陷与 codraw 抖动无因果（回退修复后 codraw 仍 1 通过/2 失败、失败点各异），故修复已恢复，本用例转为门槛。
//   node test/d12-secretcache-test.mjs
// 不改产品代码，用真实 PN.Host.prototype（只覆写 emit/clearAll 等副作用）暴露问题。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

function loadPage() {
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    JSON, Math, Date, Promise, Object, Array, String, Number, Boolean, isNaN,
    parseInt, parseFloat, Error, RegExp, WeakMap, TextEncoder, TextDecoder,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = {};
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var PN = { games: {}, pick: {}, Banks: {} };', ctx);
  for (const f of ['src/data.js', 'src/host.js']) vm.runInContext(read(f), ctx, { filename: ROOT + f });
  return { PN: vm.runInContext('PN', ctx), ctx };
}
const page = loadPage();
const hostProto = Object.getPrototypeOf(vm.runInContext('Object.create(PN.Host.prototype)', page.ctx));

function mkHost(mode) {
  const sent = [];
  const state = {
    mode, phase: 'setup',
    players: [{ id: 'p1', name: '甲', emoji: '🙂', score: 0, streak: 0, wins: 0, online: true }],
    settings: {}, log: [], g: {}, hostId: 'p1', ts: 0,
  };
  return Object.assign(Object.create(hostProto), {
    state,
    room: { peers: { p1: { id: 'p1' } }, sendPrivate(to, obj) { sent.push({ to, obj }); } },
    secretCache: {}, timers: {}, sent,
    amHost: () => true, emit() {}, toast() {}, now: () => Date.now(),
    clearAll() {}, after(n, ms, fn) { this.timers[n] = fn; }, clearTimer(n) { delete this.timers[n]; },
  });
}

console.log('\nD12 私密缓存跨游戏失效');
const h = mkHost('codraw');
h.sendSecret('p1', { word: '香蕉' });
ok(h.sent.length === 1 && h.sent[0].obj.kind === 'secret' && h.sent[0].obj.obj.word === '香蕉', '前置：sendSecret 已把 A 游戏的秘密下发并缓存');
ok(Object.keys(h.secretCache).length === 1, '前置：secretCache 里有 A 游戏的秘密');
h.goLobby();
ok(Object.keys(h.secretCache).length === 0, 'D12：goLobby（回大厅）后 secretCache 应清空');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
