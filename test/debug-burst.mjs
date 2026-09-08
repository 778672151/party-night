// 突发连发测试：1 个发布者，3 个订阅者，连续发 3 条 ~300B 消息，统计到达
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.PN = {};
eval(readFileSync(join(root, 'src/mqtt.js'), 'utf8'));
const { MqttClient } = PN;
const base = 'pn3/BURST' + Math.random().toString(36).slice(2, 6);
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function mk(tag, onMsg) {
  return new Promise((resolve) => {
    const c = new MqttClient({
      urls: ['wss://broker.emqx.io:8084/mqtt'],
      clientId: 'burst_' + tag + '_' + Math.random().toString(36).slice(2, 7),
      keepalive: 45,
      onStatus: () => {},
      onConnect: () => { c.subscribe([base + '/#']); resolve(c); },
      onMessage: (t, b) => onMsg(tag, t, b)
    });
    c.connect();
  });
}

const got = { s1: [], s2: [], s3: [] };
const S1 = await mk('s1', (tag, t, b) => got.s1.push(new TextDecoder().decode(b)));
const S2 = await mk('s2', (tag, t, b) => got.s2.push(new TextDecoder().decode(b)));
const S3 = await mk('s3', (tag, t, b) => got.s3.push(new TextDecoder().decode(b)));
const P = await mk('pub', () => {});
await wait(1200);

// 模拟 reveal：3 条各 ~300B，同步连发
const payloads = [1, 2, 3].map(i => new TextEncoder().encode('MSG' + i + ':' + 'x'.repeat(300)));
console.log('payload sizes:', payloads.map(p => p.length).join(','));
for (const p of payloads) P.publish(base + '/p', p);
await wait(2500);
console.log('到达统计: s1=' + got.s1.length + ' s2=' + got.s2.length + ' s3=' + got.s3.length);
console.log('s1:', got.s1.map(s => s.slice(0, 5)).join(' '));
console.log('s2:', got.s2.map(s => s.slice(0, 5)).join(' '));
console.log('s3:', got.s3.map(s => s.slice(0, 5)).join(' '));

// 对照：每条之间 await 700ms
got.s1 = []; got.s2 = []; got.s3 = [];
for (const p of payloads) { P.publish(base + '/p', p); await wait(700); }
await wait(2000);
console.log('慢发到达: s1=' + got.s1.length + ' s2=' + got.s2.length + ' s3=' + got.s3.length);
for (const c of [S1, S2, S3, P]) c.end();
await wait(300);
process.exit(0);
