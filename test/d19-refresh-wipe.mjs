// D19：刷新页面时不能把房间里正在进行的对局覆盖成空大厅
//   node test/d19-refresh-wipe.mjs
// 场景（真实高频）：房主在对局中按 F5。重连后 retained 的 meta 先到、state 后到。
// 旧逻辑：onHost(true) 时 lastState 为空且本机无状态 → fresh() → **广播空大厅** → 两端一起掉回房间。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ui = readFileSync(ROOT + 'src/ui.js', 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

// 1) 源码层：onHost 的分支里必须有 knownRoom 这条守卫，且 fresh 只在最后兜底
const hostBlock = ui.slice(ui.indexOf('onHost: function (isHost)'), ui.indexOf('onState: function (state)'));
ok(hostBlock.length > 0, '前置：找得到 onHost 回调');
ok(/knownRoom/.test(hostBlock), 'D19：onHost 里有「房间已存在」判定（knownRoom）');
// 只看真正的决策链（按行）：adopt → keep → knownRoom 等待 → fresh 兜底，顺序不能乱。
// "keep" 这一步的写法从 self.host.state = ... 换成了 self.host.attach(self.state, true)：
// 裸赋值不会触发 bots.onState，刷新后机器人会僵住；attach 是同一件事的正确入口。
// 语义没变（本文件第 2 段的 decide() 行为断言一字未改），所以这里只跟着换锚点。
const chain = hostBlock.split('\n')
  .filter(l => /^\s*(if|else)\b/.test(l) && /(adopt\(|self\.host\.attach\(self\.state|knownRoom|fresh\()/.test(l))
  .map(l => l.trim());
console.log('   决策链: ' + JSON.stringify(chain));
const seq = chain.join(' | ');
const order = ['adopt(', 'self.host.attach(self.state', 'knownRoom)', 'fresh('].map(k => seq.indexOf(k));
ok(order.every(i => i >= 0) && order[0] < order[1] && order[1] < order[2] && order[2] < order[3],
  'D19：决策链顺序为 adopt → keep → knownRoom 等待 → fresh 兜底（位置 ' + order.join(' < ') + '）');

// 2) 行为层：用等价的决策函数验证四种情形
function decide(opts) {
  const { lastState, uiState, meta } = opts;
  const haveGame = uiState && uiState.mode && uiState.mode !== 'lobby' && uiState.players;
  const knownRoom = !!(meta && meta.host);
  if (lastState && lastState.players) return 'adopt';
  if (haveGame) return 'keep';
  if (knownRoom) return 'wait';
  return 'fresh';
}

const gameState = { mode: 'gomoku', phase: 'play', players: [{ id: 'p1' }, { id: 'p2' }] };

ok(decide({ lastState: gameState, uiState: null, meta: { host: 'p1' } }) === 'adopt',
  'D19：retained state 已到 → adopt（正常路径不变）');
ok(decide({ lastState: null, uiState: gameState, meta: { host: 'p1' } }) === 'keep',
  'D19：本机已有对局、state 未到 → 保住（上一轮修复的路径不变）');
ok(decide({ lastState: null, uiState: null, meta: { host: 'p1' } }) === 'wait',
  'D19：刷新后 meta 先到、state 未到 → 等待，**不** fresh（本次修复点）');
ok(decide({ lastState: null, uiState: null, meta: null }) === 'fresh',
  'D19：全新房间（没有 meta）→ 仍然 fresh（开新房行为不变）');
ok(decide({ lastState: null, uiState: { mode: 'lobby', players: [{ id: 'p1' }] }, meta: { host: 'p1' } }) === 'wait',
  'D19：本机停在空大厅、但房间已存在 → 也不 fresh（不能让空大厅覆盖别人的对局）');

// 3) 兜底：等待必须有超时，否则 retained 状态永不到达时人卡在空白页
ok(/setTimeout\(waitForState/.test(hostBlock), 'D19：等待 retained 状态有超时兜底（不会永远卡住）');
ok(/self\.host\.fresh\(id, name, emoji\)/.test(hostBlock), 'D19：超时后仍能按新房间开局（有出路）');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
