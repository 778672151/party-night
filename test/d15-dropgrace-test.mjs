// D15 最小验证：掉线宽限定时器在玩家回来后是否被取消
//   node test/d15-dropgrace-test.mjs
// 不看 25 秒后的结果，直接检查 pending 的 'drop_<id>' 定时器是否还在（快速、确定）。
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
  sandbox.globalThis = sandbox; sandbox.window = {};
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var PN = { games: {}, pick: {}, Banks: {} };', ctx);
  for (const f of ['src/data.js', 'src/host.js']) vm.runInContext(read(f), ctx, { filename: ROOT + f });
  return ctx;
}
const ctx = loadPage();
const hostProto = Object.getPrototypeOf(vm.runInContext('Object.create(PN.Host.prototype)', ctx));

let onLeaveCalls = 0;
const h = Object.assign(Object.create(hostProto), {
  state: { mode: 'gomoku', phase: 'play', players: [{ id: 'p1', name: '甲', online: true, score: 0, wins: 0, streak: 0 }], settings: {}, log: [], g: {}, hostId: 'p1', ts: 0 },
  secretCache: {}, timers: {}, room: { peers: { p1: { id: 'p1' } } },
  amHost: () => true, toast() {}, now: () => Date.now(), emit() {}, onStateChange() {},
});
// 别动 PN.games（避免动产品态），直接观察 timers
console.log('\nD15 掉线宽限定时器在回归后是否取消');
h.markOffline('p1');
ok(!!h.timers['drop_p1'], '前置：markOffline 排了 drop_p1 宽限定时器');
h.upsertPlayer('p1');                       // 玩家回来了（走真实实现）
ok(h.player('p1').online === true, '前置：upsertPlayer 后已标记在线');
ok(!h.timers['drop_p1'], 'D15：玩家回来后 drop_p1 宽限定时器应被取消（否则 25s 后仍会 onLeave）');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
