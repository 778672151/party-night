import { readFileSync } from 'node:fs';
eval(readFileSync(new URL('../src/mqtt.js', import.meta.url), 'utf8'));
const { MqttClient } = globalThis.PN;
const URLS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const room = 'pn/smoke-' + Math.random().toString(36).slice(2, 8);
const log = [];
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const mk = (name, onMsg) => new Promise((res, rej) => {
  const c = new MqttClient({
    urls: URLS, clientId: 'pn_' + name + '_' + Math.random().toString(36).slice(2, 8),
    onStatus: (s, d) => log.push(`[${name}] ${s} ${d || ''}`),
    onMessage: (t, b, retained) => onMsg && onMsg(t, new TextDecoder().decode(b), retained),
    onConnect: () => res(c),
  });
  c.connect();
  setTimeout(() => rej(new Error(name + ' connect timeout')), 12000);
});

const got = [];
const A = await mk('A', (t, p, r) => got.push({ who: 'A', t, p, r }));
A.subscribe([room + '/#']);
await wait(600);
const B = await mk('B');
B.publish(room + '/m', JSON.stringify({ hello: 'meta' }), { retain: true });
B.publish(room + '/a', '普通消息 ✅');
await wait(1200);
const gotC = [];
const C = await mk('C', (t, p, r) => gotC.push({ t, p, r }));
C.subscribe([room + '/m']);
await wait(1500);
B.publish(room + '/m', '', { retain: true }); // 清除 retained
await wait(600);

const checks = [
  ['A 收到普通消息', got.some(g => g.t === room + '/a' && g.p === '普通消息 ✅')],
  ['A 收到 meta', got.some(g => g.t === room + '/m')],
  ['C 晚进房收到 retained 快照', gotC.some(g => g.r === true && g.p.includes('meta'))],
];
console.log(log.join('\n'));
console.log('---');
for (const [n, ok] of checks) console.log((ok ? 'PASS ' : 'FAIL ') + n);
console.log('A收到:', JSON.stringify(got), '\nC收到:', JSON.stringify(gotC));
[A, B, C].forEach(c => c.end());
process.exit(checks.every(c => c[1]) ? 0 : 1);
