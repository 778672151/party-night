// 最小复现：两个 MqttClient 互相收发，看是否单向
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.PN = {};
eval(readFileSync(join(root, 'src/mqtt.js'), 'utf8'));
const { MqttClient } = PN;
const topic = 'pn3/DBGTEST/' + Math.random().toString(36).slice(2, 6);
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function mk(tag) {
  return new Promise((resolve) => {
    const c = new MqttClient({
      urls: ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'],
      clientId: 'dbg_' + tag + '_' + Math.random().toString(36).slice(2, 7),
      keepalive: 45,
      onStatus: (s, d) => console.log('  [' + tag + '] status ' + s + ' ' + (d || '')),
      onConnect: () => { c.subscribe([topic + '/#']); resolve(c); },
      onMessage: (t, b) => console.log('  [' + tag + '] RECV ' + t + ' = ' + new TextDecoder().decode(b))
    });
    c.connect();
  });
}

const A = await mk('A');
await wait(1500);
const B = await mk('B');
await wait(1500);
console.log('--- A 发 3 条 ---');
for (let i = 1; i <= 3; i++) { A.publish(topic + '/a', new TextEncoder().encode('fromA' + i)); await wait(700); }
console.log('--- B 发 3 条 ---');
for (let i = 1; i <= 3; i++) { B.publish(topic + '/a', new TextEncoder().encode('fromB' + i)); await wait(700); }
await wait(1500);
A.end(); B.end();
await wait(300);
process.exit(0);
