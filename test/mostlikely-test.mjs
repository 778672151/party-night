import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const g = globalThis;
g.PN = { games: {}, pick: {}, Banks: {} };
// 存根词库与 pick
g.PN.Banks.mostlikely = { prompts: ['最有可能在群里发60秒语音的人', '最有可能凌晨三点发疯的人'] };
g.PN.pick.prompt = () => '最有可能在群里发60秒语音的人';
// 假房间
const events = [], secrets = [];
const fakeRoom = {
  isHost: true,
  me: { id: 'p1' },
  peers: { p1: {}, p2: {}, p3: {} },
  publishState: (s) => { published.push(JSON.parse(JSON.stringify(s))); },
  sendEvent: (ev) => { events.push(ev); },
  sendPrivate: (id, obj) => { secrets.push({ id, obj }); }
};
let published = [];
eval(read('src/host.js'));
eval(read('src/games/mostlikely.js'));
// 可控假时钟：after 只入队，手动 pump
const H = PN.Host;
const host = new H(fakeRoom, () => {});
let q = [];
host.after = (name, ms, fn) => { host.timers[name] = { fake: true }; q.push({ name, fn }); };
host.every = (name, ms, fn) => { host.timers[name] = { fake: true }; q.push({ name, fn }); };
host.clearTimer = (name) => { delete host.timers[name]; q = q.filter(t => t.name !== name); };
const pump = (name) => {
  const i = q.findIndex(t => t.name === name);
  if (i < 0) throw new Error('计时器不存在: ' + name);
  const t = q.splice(i, 1)[0];
  t.fn();
};

host.fresh('p1', '房主', '😎');
host.upsertPlayer('p2', { name: '小A', emoji: '🐱' });
host.upsertPlayer('p3', { name: '小B', emoji: '🐶' });
host.dispatch({ t: 'start', mode: 'mostlikely' }, 'p1');

const assert = (cond, msg) => { if (!cond) { console.error('FAIL', msg, JSON.stringify(host.state)); process.exitCode = 1; throw new Error(msg); } };
assert(host.state.mode === 'mostlikely', 'mode');
assert(host.state.phase === 'vote', 'phase vote 初始');
assert(host.state.g.cur && host.state.g.cur.q, '有题目');
// 全员投票（房主也投）：3 票都投给 p1 → 提前结算
host.dispatch({ t: 'vote', id: 'p1' }, 'p2');
host.dispatch({ t: 'vote', id: 'p1' }, 'p3');
assert(host.state.phase === 'vote', '未满票不结算');
host.dispatch({ t: 'vote', id: 'p1' }, 'p1');
assert(host.state.phase === 'reveal', '满票即结算 reveal，got=' + host.state.phase);
assert(host.state.g.last.winners.join() === 'p1', 'p1 是赢家');
assert(host.player('p1').score === 9, 'p1 得 9 分(3票)，got=' + host.player('p1').score);
assert(events.some(e => e.t === 'reveal'), '广播 reveal');
// 手动 pump 自动推进计时器 → 第2题
pump('next');
assert(host.state.g.round === 2 && host.state.phase === 'vote', '自动进入第2题，got=' + host.state.g.round + '/' + host.state.phase);
console.log('PASS mostlikely 逻辑集成测试');
console.log('事件:', events.map(e => e.t).join(','));
