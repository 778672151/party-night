// 假设验证：在 onmessage 回调里同步连发 3 条，是否丢包
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.PN = {};
eval(readFileSync(join(root, 'src/mqtt.js'), 'utf8'));
const { MqttClient } = PN;
const base = 'pn3/RE' + Math.random().toString(36).slice(2, 6);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const TE = new TextEncoder(), TD = new TextDecoder();

let B = null, A = null, received = [];
const mk = (tag, onMsg) => new Promise((res) => {
  const c = new MqttClient({
    urls: ['wss://broker.emqx.io:8084/mqtt'], clientId: 're_' + tag + '_' + Math.random().toString(36).slice(2, 7), keepalive: 45,
    onStatus: () => {}, onConnect: () => { c.subscribe([base + '/#']); res(c); }, onMessage: onMsg
  });
  c.connect();
});

B = await mk('B', (t, b) => { const s = TD.decode(b); if (s[0] === 'P') received.push(s.slice(0, 4)); });
A = await mk('A', (t, b) => {
  const s = TD.decode(b);
  if (s[0] === 'T') { // 收到触发消息后，在回调内同步连发 3 条
    for (let i = 1; i <= 3; i++) A.publish(base + '/p', TE.encode('P' + s.slice(1) + i + ':' + 'z'.repeat(340)));
  }
});
await wait(1500);

for (let round = 1; round <= 6; round++) {
  received = [];
  B.publish(base + '/t', TE.encode('T' + round));
  await wait(2500);
  console.log('第' + round + '轮: 到达 ' + received.length + '/3 ' + (received.length !== 3 ? '<-- 丢失! ' + received.join(',') : ''));
}
A.end(); B.end();
await wait(300);
process.exit(0);
