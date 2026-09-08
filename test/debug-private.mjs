// 4 个真实 Room：房主连发私密消息，统计到达（复现揭示丢失）
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

function mk(id, quiet) {
  const c = { id, priv: [] };
  const room = new Room({
    code, identity: { id, name: id, emoji: 'x' },
    onStatus: () => {}, onRoster: () => {}, onHost: () => {}, onState: () => {}, onAction: () => {}, onEvent: () => {}, onPeer: () => {},
    onPrivate: (obj) => { c.priv.push(obj); if (!quiet) console.log('  [' + id + '] privIN to=' + obj.to + ' tag=' + obj.tag); }
  });
  c.room = room;
  return room.start().then(() => c);
}

const H = await mk('aaa1', true);
await wait(5000); // 等房主当选
const B = await mk('bbb1', true), C = await mk('ccc1', true), D = await mk('ddd1', true);
await wait(6000); // 等心跳互相认识
console.log('H.isHost=' + H.room.isHost + ' peers=' + Object.keys(H.room.peers).join(','));
console.log('B peers=' + Object.keys(B.room.peers).join(',') + ' hostId=' + B.room.hostId);

// 连发 3 条私密消息（模拟 reveal）
console.log('--- 连发 3 条 ---');
const ps = [B, C, D].map((c, i) => H.room.sendPrivate(c.id, { to: c.id, tag: 'burst' + i }));
await Promise.all(ps);
await wait(3000);
console.log('到达: B=' + B.priv.length + ' C=' + C.priv.length + ' D=' + D.priv.length);

// 对照：每条间隔 500ms
B.priv = []; C.priv = []; D.priv = [];
console.log('--- 间隔 500ms 发 3 条 ---');
for (const [i, c] of [B, C, D].entries()) { await H.room.sendPrivate(c.id, { to: c.id, tag: 'slow' + i }); await wait(500); }
await wait(3000);
console.log('到达: B=' + B.priv.length + ' C=' + C.priv.length + ' D=' + D.priv.length);

for (const c of [H, B, C, D]) c.room.leave(true);
await wait(400);
process.exit(0);
