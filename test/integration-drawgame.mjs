// 真实 broker 集成测试：你画我猜（选词 → 作画 → 聊天/猜词 → 全员猜中提前揭晓 → 回放）
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
assert(Array.isArray(h.state.g.chat) && h.state.g.chat.length === 0, '开局聊天记录为空数组');
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
assert(h.state.g.cur.wordLen === words[0].length, 'state 下发字数 wordLen=' + words[0].length + '，got=' + h.state.g.cur.wordLen);
assert(h.state.g.cur.hint && typeof h.state.g.cur.hint === 'object', 'state 下发提示 hint 对象');
assert(h.state.g.cur.guessed && Object.keys(h.state.g.cur.guessed).length === 0, '开局无人猜中');
assert(h.state.g.chat.some(m => m.k === 'sys' && m.text.indexOf('来画') >= 0), '聊天区有「谁在画」系统消息');

// 画家重连能拿回自己的词（刷新页面不至于失忆）
await sleepUntil(() => painter.secrets.some(s => s.obj && s.obj.answer === words[0]), 20000, '画家收到答案 secret');

// 画笔数据（peer 通道）经真实网络：两条笔画
painter.room.sendAction({ t: 'peer', msg: { t: 'stroke', id: 'k1', color: '#222222', w: 9, s: [[100, 100], [600, 600]] } });
painter.room.sendAction({ t: 'peer', msg: { t: 'stroke', id: 'k2', color: '#ff4d4d', w: 4, s: [[600, 600], [900, 200]] } });

// 中途加入：应通过私密通道收到画笔回放（按笔画 id 分块）
const late = await t.add('e0000001', '小E', '🐼');
await sleepUntil(() => late.secrets.some(s => s.obj && Array.isArray(s.obj.replay) && s.obj.replay.length >= 2), 25000, '晚到者收到画笔回放');
await sleepUntil(() => h.state.players.some(p => p.id === late.id && p.online), 15000,
  '中途加入者进名单（否则猜对也不计分）');
assert(h.state.players.some(p => p.id === late.id), '中途加入者出现在玩家列表里');
const replay = late.secrets.filter(s => s.obj && Array.isArray(s.obj.replay)).pop().obj.replay;
assert(replay.length === 2, '回放 = 2 条笔画，got=' + replay.length);
assert(replay[0].id === 'k1' && replay[0].s.length === 2 && replay[1].color === '#ff4d4d', '回放块带 id/颜色/点集');

// 猜错 → 进聊天区（不是揭晓）
const others = t.players.filter(p => p.id !== painterId);
const guesser = others[0];
guesser.room.sendAction({ t: 'guess', text: '随便乱猜一个' });
await sleepUntil(() => h.state.g.chat.some(m => m.k === 'msg' && m.text === '随便乱猜一个'), 20000, '错误猜测进聊天区');
assert(h.state.g.cur.phase === 'draw', '猜错不揭晓，继续画');

// 差一点 → 橙色提示
if (words[0].length >= 2) {
  const close = words[0].slice(0, words[0].length - 1);
  guesser.room.sendAction({ t: 'guess', text: close });
  await sleepUntil(() => h.state.g.chat.some(m => m.k === 'near'), 20000, '「差一点」提示');
  assert(h.state.g.cur.phase === 'draw', '差一点不揭晓');
}

// 全员猜中 → 提前揭晓（逐个确认登记，便于定位丢包）
for (const p of others) {
  p.room.sendAction({ t: 'guess', text: words[0] });
  await sleepUntil(() => h.state.g.cur.guessed[p.id], 15000, p.name + '(' + p.id + ') 的猜中登记');
}
// 全员猜中后是「延时 1.4s 揭晓」；测试里 host.after 是手动队列，得手动泵一次
const clock = t.players[0].clock;
assert(clock.has('drawgame_draw'), '全员猜中后排了揭晓计时器');
assert(h.state.g.cur.phase === 'draw', '泵之前还在作画阶段');
clock.pump('drawgame_draw');
assert(h.state.g.cur.phase === 'reveal', '揭晓计时器触发 → reveal，got=' + h.state.g.cur.phase);
assert(h.state.g.cur.reveal === words[0], '揭晓答案进 state（客户端可见）');
assert(h.state.g.chat.some(m => m.k === 'ok'), '聊天区有「猜中了」记录');
const okMsg = h.state.g.chat.filter(m => m.k === 'ok').pop();
assert(okMsg.text.indexOf(words[0]) === -1, '「猜中了」不泄露答案原文：' + okMsg.text);
for (const p of others) {
  assert(h.state.players.find(x => x.id === p.id).score > 0, p.name + ' 猜对得分');
}
assert(h.state.players.find(x => x.id === painterId).score >= 100, '画家按被猜中次数加分');

console.log('PASS 真实联机：你画我猜跑通（选词→作画→聊天/猜错/差一点→全员猜中提前揭晓→回放），答案 = "' + words[0] + '"');
t.close();
process.exit(0);
