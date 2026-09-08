// 复现：先发 ~1.8KB 保留状态包，紧接着 3 条 ~350B 私密包，重复 6 轮，统计到达
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.PN = {};
eval(readFileSync(join(root, 'src/mqtt.js'), 'utf8'));
const { MqttClient } = PN;
const base = 'pn3/BS' + Math.random().toString(36).slice(2, 6);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const TE = new TextEncoder(), TD = new TextDecoder();

const counts = {};
const mk = (tag, onMsg) => new Promise((res) => {
  const c = new MqttClient({
    urls: ['wss://broker.emqx.io:8084/mqtt'], clientId: 'bs2_' + tag + '_' + Math.random().toString(36).slice(2, 7), keepalive: 45,
    onStatus: () => {}, onConnect: () => { c.subscribe([base + '/#']); res(c); }, onMessage: onMsg
  });
  c.connect();
});
const subs = [];
for (const t of ['s1', 's2', 's3', 's4']) { counts[t] = []; subs.push(await mk(t, (topic, b) => { const s = TD.decode(b); if (s[0] === 'P') counts[t].push(s.slice(0, 3)); })); }
const P = await mk('pub', () => {});
await wait(1500);

for (let round = 1; round <= 6; round++) {
  for (const t of Object.keys(counts)) counts[t] = [];
  const state = 'S' + 'y'.repeat(1830);
  P.publish(base + '/s', TE.encode(state), { retain: true });
  /* 无延迟 */
  for (let i = 1; i <= 3; i++) P.publish(base + '/p', TE.encode('P' + round + i + ':' + 'z'.repeat(340)));
  await wait(2500);
  const r = Object.keys(counts).map(t => t + '=' + counts[t].length).join(' ');
  const detail = counts.s1.join(',');
  console.log('第' + round + '轮: ' + r + (counts.s1.length !== 3 ? '  <-- 丢失! s1=' + detail : ''));
}
for (const c of [...subs, P]) c.end();
await wait(300);
process.exit(0);
