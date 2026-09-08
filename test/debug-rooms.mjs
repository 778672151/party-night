// 两个真实 Room，逐条打印发布/接收的主题，定位单向投递
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
globalThis.window = { __PN_BANKS__: { undercover: [], wavelength: [], mostlikely: [], draw: [] } };
globalThis.PN = { games: {}, pick: {}, Banks: {} };
for (const p of ['src/data.js', 'src/crypto.js', 'src/mqtt.js', 'src/room.js']) eval(read(p));
const { Room } = PN;
const code = PN.randCode(6);
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function mk(id) {
  const room = new Room({
    code, identity: { id, name: id, emoji: 'x' },
    onStatus: (s, d) => console.log('  [' + id + '] status ' + s + ' ' + (d || '')),
    onRoster: (list) => console.log('  [' + id + '] roster ' + list.map(p => p.id + (p.online ? '' : '(off)')).join(',')),
    onHost: (isHost) => console.log('  [' + id + '] host=' + isHost),
    onAction: (a, from) => console.log('  [' + id + '] ACTION t=' + a.t + ' from=' + from),
    onState: () => {}, onEvent: () => {}, onPeer: () => {}, onPrivate: () => {}
  });
  const origPub = room.publishRaw.bind(room);
  room.publishRaw = (k, obj, retain) => {
    if (k === 'a') console.log('  [' + id + '] PUB ' + room.topic(k) + ' t=' + (obj && obj.t));
    return origPub(k, obj, retain);
  };
  const origOn = room._onMessage.bind(room);
  room._onMessage = (topic, bytes, retained) => {
    const k = topic.slice(room.base.length + 1);
    const m = room._dec(bytes);
    if (m && (m.t === 'hi' || m.t === 'bye')) console.log('  [' + id + '] IN  ' + topic + ' t=' + m.t + ' from=' + m.id + (retained ? ' [retained]' : ''));
    return origOn(topic, bytes, retained);
  };
  return room.start();
}

const A = await mk('aaa1');
await wait(3000);
const B = await mk('bbb1');
await wait(14000); // 跑过 3 个心跳周期
console.log('--- 最终状态 ---');
console.log('A peers:', Object.keys(A.peers), 'isHost=' + A.isHost, 'hostId=' + A.hostId);
console.log('B peers:', Object.keys(B.peers), 'isHost=' + B.isHost, 'hostId=' + B.hostId);
A.leave(true); await wait(400); B.leave(true); await wait(400);
process.exit(0);
