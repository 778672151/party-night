// 合成测试：把 3 个 PUBLISH 包拼成一个 WS 帧喂给 _parse，看能否拆出 3 条
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.PN = {};
eval(readFileSync(join(root, 'src/mqtt.js'), 'utf8'));
const { MqttClient } = PN;
const TE = new TextEncoder();
function varint(len) { const out = []; do { let b = len % 128; len = Math.floor(len / 128); if (len > 0) b |= 0x80; out.push(b); } while (len > 0); return new Uint8Array(out); }
function str(s) { const b = TE.encode(s); const o = new Uint8Array(b.length + 2); o[0] = b.length >> 8; o[1] = b.length & 255; o.set(b, 2); return o; }
function pack(type, flags, parts) {
  let len = 0; for (const p of parts) len += p.length;
  const body = new Uint8Array(len); let o = 0; for (const p of parts) { body.set(p, o); o += p.length; }
  const vl = varint(body.length); const out = new Uint8Array(1 + vl.length + body.length);
  out[0] = (type << 4) | flags; out.set(vl, 1); out.set(body, 1 + vl.length); return out;
}
const topic = 'pn3/ABCDEF/p';
const packets = [1, 2, 3].map(i => pack(3, 0, [str(topic), TE.encode('MSG' + i + ':' + 'x'.repeat(300))]));
console.log('单包字节数:', packets.map(p => p.length).join(','));

const c = new MqttClient({ urls: [], clientId: 'parse_test', onMessage: (t, b) => console.log('  收到 topic=' + t + ' body=' + new TextDecoder().decode(b).slice(0, 6)) });

// 场景 1：3 包拼成 1 个 chunk
const all = new Uint8Array(packets.reduce((a, p) => a + p.length, 0));
{ let o = 0; for (const p of packets) { all.set(p, o); o += p.length; } }
console.log('--- 场景1: 单个 chunk 含 3 包 ---');
c.buf = new Uint8Array(0); c._parse.call(Object.assign(c, { buf: all }));
console.log('  剩余 buf=' + c.buf.length);

// 场景 2：逐字节喂
console.log('--- 场景2: 逐字节喂 ---');
c.buf = new Uint8Array(0);
for (let i = 0; i < all.length; i++) {
  const merged = new Uint8Array(c.buf.length + 1); merged.set(c.buf, 0); merged[c.buf.length] = all[i]; c.buf = merged; c._parse();
}
console.log('  剩余 buf=' + c.buf.length);

// 场景 3：前 2 包一个 chunk，第 3 包下一个 chunk
console.log('--- 场景3: 2包+1包 ---');
c.buf = new Uint8Array(0);
const p12 = new Uint8Array(packets[0].length + packets[1].length); p12.set(packets[0], 0); p12.set(packets[1], packets[0].length);
c.buf = p12; c._parse(); console.log('  剩余 buf=' + c.buf.length);
c.buf = packets[2]; c._parse(); console.log('  剩余 buf=' + c.buf.length);
