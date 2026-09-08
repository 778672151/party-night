// 单向投递统计：A 每 4s 发一次，B 晚 3s 连上，跑 40s，统计到达率
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
globalThis.window = { __PN_BANKS__: { undercover: [], wavelength: [], mostlikely: [], draw: [] } };
globalThis.PN = { games: {}, pick: {}, Banks: {} };
for (const p of ['src/data.js', 'src/crypto.js', 'src/mqtt.js', 'src/room.js']) eval(read(p));
const { MqttClient, Room } = PN;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const mode = process.argv[2] || 'raw';

async function rawTest() {
  const topic = 'pn3/ASYM' + Math.random().toString(36).slice(2, 6) + '/a';
  let recvA = 0, recvB = 0;
  const mk = (tag) => new Promise((res) => {
    const c = new MqttClient({
      urls: ['wss://broker.emqx.io:8084/mqtt'], clientId: 'asym_' + tag + '_' + Math.random().toString(36).slice(2, 7), keepalive: 45,
      onStatus: (s) => { if (s === 'disconnected') console.log('  [' + tag + '] 掉线'); },
      onConnect: () => { c.subscribe([topic]); res(c); },
      onMessage: (t, b) => { const s = new TextDecoder().decode(b); if (s.startsWith('A')) recvA++; else recvB++; }
    });
    c.connect();
  });
  const A = await mk('A');
  await wait(3000);
  const B = await mk('B');
  let sentA = 0, sentB = 0;
  const iv = setInterval(() => { sentA++; A.publish(topic, new TextEncoder().encode('A' + sentA)); sentB++; B.publish(topic, new TextEncoder().encode('B' + sentB)); }, 4000);
  await wait(40000);
  clearInterval(iv);
  await wait(2000);
  console.log('RAW 模式: A 发 ' + sentA + ' 收到 ' + recvA + ' | B 发 ' + sentB + ' 收到 ' + recvB);
  A.end(); B.end();
}

async function roomTest() {
  const code = PN.randCode(6);
  let recvA = 0, recvB = 0;
  const mk = (id, counter) => {
    const room = new Room({
      code, identity: { id, name: id, emoji: 'x' },
      onStatus: (s) => { if (s === 'disconnected') console.log('  [' + id + '] 掉线'); },
      onRoster: () => {}, onHost: () => {}, onState: () => {}, onAction: () => {}, onEvent: () => {}, onPeer: () => {}, onPrivate: () => {}
    });
    const orig = room._onMessage.bind(room);
    room._onMessage = (t, b) => { const m = room._dec(b); if (m && m.t === 'hi') { if (m.id === 'aaa1') recvA++; else recvB++; } return orig(t, b); };
    return room.start().then(() => room);
  };
  const A = await mk('aaa1');
  await wait(3000);
  const B = await mk('bbb1');
  await wait(40000);
  console.log('ROOM 模式: 收到 aaa1 的心跳 ' + recvA + ' 次 | 收到 bbb1 的心跳 ' + recvB + ' 次（各自约 10 次发送）');
  console.log('  A.isHost=' + A.isHost + ' hostId=' + A.hostId + ' | B.isHost=' + B.isHost + ' hostId=' + B.hostId);
  console.log('  A peers=' + Object.keys(A.peers).join(',') + ' | B peers=' + Object.keys(B.peers).join(','));
  A.leave(true); B.leave(true);
}

if (mode === 'raw') await rawTest(); else await roomTest();
await wait(400);
process.exit(0);
