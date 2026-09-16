// D17 复现：换游戏时不经过「回大厅」直接 start，上一局的定时器仍然活着
//   node test/d17-timer-leak.mjs
// 危害：旧局的倒计时/轮询回调继续打在新局的 state 上 —— 表现就是「抽搐」或一局莫名结束。
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
for (const f of ['src/data.js', 'src/host.js', 'src/games/tacit.js', 'src/games/gomoku.js']) {
  vm.runInContext(read(f), ctx, { filename: ROOT + f });
}

function makeHost() {
  const room = {
    isHost: true, me: { id: 'p1' }, peers: { p1: { id: 'p1', name: '甲' }, p2: { id: 'p2', name: '乙' } },
    roster: () => [{ id: 'p1', online: true }, { id: 'p2', online: true }],
    sendPrivate() {}, sendEvent() {}, publishState() {},
  };
  const Host = vm.runInContext('PN.Host', ctx);
  const host = new Host(room, function () {});
  host.fresh('p1', '甲', '😎');
  host.upsertPlayer('p2', { name: '乙', emoji: '🙂' });
  return host;
}

// 直接手工注册一个「上一局的」定时器：模拟任何一款游戏开局时留下的倒计时
const host = makeHost();
host.dispatch({ t: 'start', mode: 'tacit' }, 'p1');
host.after('tacit_answer', 60000, function () {});
host.every('tacit_tick', 5000, function () {});
const before = Object.keys(host.timers).slice();
ok(before.length > 0, '前置：当前局确实有活着的定时器（' + before.join(',') + '）');

// 玩家「换游戏」：不点回大厅，直接开另一款（大厅里每张卡都能直接开始）
host.dispatch({ t: 'start', mode: 'gomoku' }, 'p1');
const leaked = Object.keys(host.timers).filter(k => k.indexOf('tacit') === 0);
ok(host.state.mode === 'gomoku', '已切到 gomoku（mode=' + host.state.mode + '）');
ok(leaked.length === 0, '换游戏后上一局的定时器必须被清空' + (leaked.length ? '，实际残留：' + leaked.join(',') : ''));

// 「再来一局」也必须先把本局的旧定时器清掉，否则两套倒计时同时跑
const h2 = makeHost();
h2.dispatch({ t: 'start', mode: 'tacit' }, 'p1');
h2.after('tacit_answer', 60000, function () {});
const seqBefore = h2._timerSeq || 0;
h2.dispatch({ t: 'again' }, 'p1');
const stillPair = Object.keys(h2.timers).filter(k => k.indexOf('tacit') === 0);
ok(stillPair.length <= 2, '再来一局后定时器没有成倍堆积（' + stillPair.length + ' 个：' + stillPair.join(',') + '）');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
