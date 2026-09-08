// 真实 broker 集成测试：你画我猜（选词 → 作画 → 猜中 → 揭示，含中途加入回放）
import { loadPN, makeTable, asserter, sleepUntil } from './harness.mjs';
loadPN();

const t = await makeTable([
  ['host01', '房主', '😎'],
  ['b0000001', '小B', '🐱'],
  ['c0000001', '小C', '🐶'],
  ['d0000001', '小D', '🦊'],
]);
const h = t.h;
const assert = asserter(t);

h.dispatch({ t: 'start', mode: 'drawgame' }, 'host01');
assert(h.state.mode === 'drawgame' && h.state.g.cur && h.state.g.cur.phase === 'pick',
  '进入选词，got=' + JSON.stringify(h.state.g.cur && h.state.g.cur.phase));
const painterId = h.state.g.cur.painter;
const painter = t.byId(painterId);
console.log('  画家 = ' + painterId);

// 候选词走私密通道（ECDH + ACK 重传）
await sleepUntil(() => painter.secrets.some(s => s.obj && s.obj.words && s.obj.words.length === 3), 20000, '画家收到 3 个候选词');
const words = painter.secrets.filter(s => s.obj && s.obj.words).pop().obj.words;

// 选词经真实网络
painter.room.sendAction({ t: 'pick', i: 0 });
await sleepUntil(() => h.state.g.cur.phase === 'draw', 20000, '进入作画');
assert(h.state.g.cur.painter === painterId, '作画者是选词者');

// 画笔数据（peer 通道）经真实网络
painter.room.sendAction({ t: 'peer', msg: { s: [[10, 10, 60, 60], [60, 60, 90, 20]] } });

// 中途加入：应通过私密通道收到画笔回放
const late = await t.add('e0000001', '小E', '🐼');
await sleepUntil(() => late.secrets.some(s => s.obj && Array.isArray(s.obj.replay) && s.obj.replay.length >= 2), 25000, '晚到者收到画笔回放');
const replay = late.secrets.filter(s => s.obj && Array.isArray(s.obj.replay)).pop().obj.replay;
assert(replay.length === 2, '回放段数 = 2，got=' + replay.length);

// 猜词经真实网络
const guesser = t.players.find(p => p.id !== painterId && p.id !== 'host01');
guesser.room.sendAction({ t: 'guess', text: words[0] });
await sleepUntil(() => h.state.g.cur.phase === 'reveal', 20000, '进入揭示');
assert(h.state.players.find(p => p.id === guesser.id).score > 0, '猜对者得分');
assert(h.state.players.find(p => p.id === painterId).score >= 400, '画家加分');

console.log('PASS 真实联机：你画我猜跑通（选词→作画→回放→猜中），答案 = "' + words[0] + '"');
t.close();
process.exit(0);
