// D14 最小验证：emitSoon 用的是裸 setTimeout，不受 clearAll 管辖 → 会活着跨过 goLobby/换局
//   node test/d14-emitsoon-test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  return ctx;
}
const ctx = loadPage();
const hostProto = Object.getPrototypeOf(vm.runInContext('Object.create(PN.Host.prototype)', ctx));

function mkHost() {
  let emits = 0;
  const state = { mode: 'hop', phase: 'play', players: [{ id: 'p1', online: true }], settings: {}, log: [], g: {}, hostId: 'p1', ts: 0 };
  const h = Object.assign(Object.create(hostProto), {
    state, secretCache: {}, timers: {}, room: { peers: {}, publishState() {} },
    amHost: () => true, toast() {}, now: () => Date.now(), onStateChange() {},
    emit() { emits++; },
    count() { return emits; },   // 不能用 getter：Object.assign 会把 getter 求值成快照（第一次写这个用例就栽在这）
  });
  return h;
}

console.log('\nD14 emitSoon 是否受 clearAll 管辖');
const h = mkHost();
h.emitSoon(30);                                  // 跳一跳里就是这么排的
h.goLobby();                                     // 立刻回大厅（真实实现：首行 clearAll + 换状态）
const after = h.count();
await sleep(80);                                 // 越过 30ms 窗口
ok(after === 1, '前置：goLobby 本身只 emit 一次（真实 goLobby 被 hostProto 覆写为计数）');
ok(h.count() === after, 'D14：goLobby 之后不应再冒出延迟的 emit（现在会多出一次）');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
