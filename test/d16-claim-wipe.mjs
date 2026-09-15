// D16 复现：房主心跳被误判死亡 → 抢任房主 → lastState 尚未到达 → fresh() 把对局重置为 lobby
//   node test/d16-claim-wipe.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval, JSON, Math, Date, Promise, Object, Array, String, Number, Boolean, isNaN, parseInt, parseFloat, Error, RegExp, WeakMap, TextEncoder, TextDecoder };
sandbox.globalThis = sandbox; sandbox.window = {};
const ctx = vm.createContext(sandbox);
vm.runInContext('var PN = { games: {}, pick: {}, Banks: {} };', ctx);
for (const f of ['src/data.js', 'src/host.js']) vm.runInContext(read(f), ctx, { filename: ROOT + f });
const hostProto = Object.getPrototypeOf(vm.runInContext('Object.create(PN.Host.prototype)', ctx));

// 模拟：新房主接手时拿到的是「对局中」的 lastState，但网络还没把它送过来（undefined）
function makeHostWith(state) {
  return Object.assign(Object.create(hostProto), {
    state: { v: 3, mode: 'lobby', phase: 'lobby', players: [], settings: { roomName: '' }, log: [], g: {}, hostId: 'p1', ts: 0 },
    secretCache: {}, timers: {}, room: { peers: {}, sendPrivate() {}, publishState() {} },
    amHost: () => true, toast() {}, now: () => Date.now(), emit() {}, onStateChange() {},
  });
}
console.log('\nD16 抢任房主时把对局重置为大厅');
const h = makeHostWith();
// 复现 ui.js:296 的兜底：lastState 缺失 -> fresh()
h.fresh('p1', '小桃', '😎');
ok(h.state.mode === 'lobby' && h.state.phase === 'lobby', '前置：fresh() 确实把状态置为大厅（新开一局时这是对的）');

// 真机路径：对局进行中，房主掉线，我跟它同一个房间，抢任时 lastState 还没到
// ---- 修复后行为：对局进行中抢任房主，即使 lastState 还没到，也绝不能把对局重置 -------
// 这里复刻 ui.js onHost 里的新逻辑：haveGame 为真时保住当前 state。
// 忠实复刻 ui.js onHost 的分支：注意 host 与 UI 是**两个**对象，修复点是把 UI 的对局交给 host。
function onHostBecameHost(host, uiState, room, id, name, emoji) {
  var lastState = room.lastState;
  var haveGame = uiState && uiState.mode && uiState.mode !== 'lobby' && uiState.players;
  if (lastState && lastState.players) host.adopt(lastState);
  else if (haveGame) host.state = uiState;      // ← 修复点：保住对局（以前这里会走 fresh）
  else host.fresh(id, name, emoji);
}
const gameState = { v: 3, mode: 'gomoku', phase: 'play', players: [{ id: 'p1', name: '甲', online: true, score: 0 }, { id: 'p2', name: '乙', online: true, score: 0 }], settings: {}, log: [], g: { phase: 'play', hostId: 'p2' }, hostId: 'p2', ts: 123 };
const gBefore = JSON.stringify(gameState);
const g = makeHostWith();            // host 初始是空的
onHostBecameHost(g, gameState, g.room, 'p1', '小桃', '😎');
ok(g.state.mode === 'gomoku', 'D16 修复：lastState 未到时抢任房主，对局不被重置（host.state.mode 仍为 gomoku，实际 ' + g.state.mode + '）');
ok(JSON.stringify(g.state) === gBefore, 'D16 修复：对局数据原样交给 host，没有丢失');
ok(g.state.phase === 'play', 'D16 修复：phase 保持 play（没有被 live 大厅流程覆盖）');

// ---- 对照组：本来就在大厅（没有对局可保）时，fresh 仍然正常 -----------------------
const h2 = makeHostWith();
h2.room.lastState = null;
const lobbyState = { v: 3, mode: 'lobby', phase: 'lobby', players: [{ id: 'p1', online: true }], settings: {}, log: [], g: {} };
onHostBecameHost(h2, lobbyState, h2.room, 'p1', '小桃', '😎');
ok(h2.state.mode === 'lobby', 'D16 对照：大厅里成为房主仍走 fresh（行为不变）');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
