// D18 复现：轮到你走的那个人掉线了，另一头会永远等下去（卡死）
//   node test/d18-offline-stall.mjs
// 机制：掉线有两条来路 ——
//   ① broker 代发遗嘱 'bye'(dropped) → markOffline() → 排一个 DROP_GRACE_MS 后的 onLeave（有人收尾）
//   ② 心跳超时被 syncOnline() 直接标成 offline → **没有**排任何 onLeave（无人收尾）
// 公共 broker 是 QoS0，遗嘱丢包很常见，于是走 ② —— 对手掉线后这一局没人收尾，卡死。
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
vm.runInContext('var PN = { games: {}, pick: {}, Banks: {}, Toon: {} };', ctx);
for (const f of ['src/data.js', 'src/host.js', 'src/games/gomoku.js']) vm.runInContext(read(f), ctx, { filename: ROOT + f });

const roster = [{ id: 'p1', online: true }, { id: 'p2', online: true }];
const room = {
  isHost: true, me: { id: 'p1' },
  peers: { p1: { id: 'p1', name: '甲' }, p2: { id: 'p2', name: '乙' } },
  roster: () => roster,
  sendPrivate() {}, sendEvent() {}, publishState() {},
};
const Host = vm.runInContext('PN.Host', ctx);
const host = new Host(room, function () {});
host.fresh('p1', '甲', '😎');
host.upsertPlayer('p2', { name: '乙', emoji: '🙂' });
host.dispatch({ t: 'start', mode: 'gomoku' }, 'p1');
ok(host.state.mode === 'gomoku', '前置：已开一局五子棋');

// 让「轮到走的那个人」掉线：从花名册里消失（心跳超时被清理），但**没有** bye 遗嘱
const turnId = host.state.g.players[host.state.g.turn === 1 ? 0 : 1];
ok(!!turnId, '前置：拿到「该他走」的那位玩家（' + turnId + '）');
roster.splice(roster.findIndex(r => r.id === turnId), 1);
const changed = host.syncOnline();
ok(changed, 'syncOnline 发现有人掉线（掉线者是 ' + turnId + '）');
ok(host.player(turnId).online === false, '掉线者已被标记为 offline');

// 关键：有没有任何定时器负责「收尾」这一局？
const dropTimers = Object.keys(host.timers).filter(k => k.indexOf('drop_') === 0);
ok(dropTimers.length > 0,
  '掉线后应当排一个宽限期定时器来收尾（否则对手永远等下去，就是卡死）' +
  (dropTimers.length ? '，实际：' + dropTimers.join(',') : '，实际：没有任何 drop_* 定时器'));

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
