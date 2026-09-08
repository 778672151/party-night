// 真实 broker 集成测试：波长（心有灵犀）一回合完整跑通
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

h.dispatch({ t: 'start', mode: 'wavelength' }, 'host01');
assert(h.state.mode === 'wavelength' && h.state.g.curPhase === 'clue', '进入第一回合 clue，got=' + h.state.g.curPhase);
const psychicId = h.state.g.cur;
const psychic = t.byId(psychicId);
console.log('  通灵者 = ' + psychicId + '，波段 ' + h.state.g.left + ' ↔ ' + h.state.g.right);

// 私密目标值必须经 broker 送达通灵者（ECDH 加密 + ACK 重传）
await sleepUntil(() => psychic.secrets.some(s => s.obj && typeof s.obj.target === 'number'), 20000, '通灵者收到目标值');
const secret = psychic.secrets.filter(s => s.obj && typeof s.obj.target === 'number').pop().obj;
assert(secret.target >= 0 && secret.target <= 100, '目标值在 0-100: ' + secret.target);

// 线索：通灵者经真实网络发给房主
psychic.room.sendAction({ t: 'clue', text: '测试线索' });
await sleepUntil(() => h.state.g.curPhase === 'guess', 20000, '进入 guess');
assert(h.state.g.clue === '测试线索', '线索送达房主，got=' + h.state.g.clue);

// 猜测：其余玩家全部经真实网络提交
const others = t.players.filter(p => p.id !== psychicId);
for (let i = 0; i < others.length; i++) {
  others[i].room.sendAction({ t: 'guess', v: i === 0 ? secret.target : 20 + i * 7 });
}
await sleepUntil(() => h.state.g.curPhase === 'reveal', 25000, '进入 reveal');

const rv = h.state.g.reveal;
assert(!!rv, '有揭示数据');
assert(rv.target === secret.target, '揭示目标值 = 通灵者私密值 (' + rv.target + ' vs ' + secret.target + ')');
assert(rv.guesses.length === others.length, '所有猜测都被统计: ' + rv.guesses.length + '/' + others.length);
assert(rv.guesses.some(x => x.distance === 0), '有人正中目标');
assert(h.state.players.some(p => p.score > 0), '有人得分');
assert(psychic.secrets.length >= 1, '私密通道可用');

console.log('PASS 真实联机：波长一回合跑通，目标 ' + rv.target + '，猜测 ' + rv.guesses.length + ' 人，最佳 ' + rv.bestId);
t.close();
process.exit(0);
