// TLS 透传中继：4 个端口分别对应 4 个客户端，解析 TLS 记录长度统计实际写出字节
import net from 'node:net';
const TARGET = { host: 'broker.emqx.io', port: 8084 };
const PORTS = { 18884: 'host01', 18885: 'b0000001', 18886: 'c0000001', 18887: 'd0000001' };
const t0 = Date.now();
const ts = () => Date.now() + ' (+' + ((Date.now() - t0) / 1000).toFixed(2) + 's)';

function scanTls(tag, dir, chunk, state) {
  state.buf = Buffer.concat([state.buf, chunk]);
  while (state.buf.length >= 5) {
    const type = state.buf[0], len = state.buf.readUInt16BE(3);
    if (state.buf.length < 5 + len) return;
    const payload = state.buf.subarray(5, 5 + len);
    state.buf = state.buf.subarray(5 + len);
    if (type === 0x17) {
      const op = payload[0];
      console.log(ts() + ' [' + tag + '] ' + dir + ' APP len=' + len + (op === 0x82 ? ' (WS binary)' : op === 0x81 ? ' (WS text)' : op === 0x88 ? ' (WS close)' : op === 0x89 ? ' (WS ping)' : ' op=0x' + (op || 0).toString(16)));
    } else if (type === 0x16) {
      console.log(ts() + ' [' + tag + '] ' + dir + ' HANDSHAKE len=' + len);
    }
  }
}

for (const port of Object.keys(PORTS)) {
  const tag = PORTS[port];
  net.createServer((client) => {
    const up = net.connect(TARGET.port, TARGET.host);
    const stUp = { buf: Buffer.alloc(0) }, stDown = { buf: Buffer.alloc(0) };
    client.on('data', (d) => { scanTls(tag, '→broker', d, stUp); up.write(d); });
    up.on('data', (d) => { scanTls(tag, '←broker', d, stDown); client.write(d); });
    client.on('error', () => up.destroy());
    up.on('error', () => client.destroy());
    client.on('close', () => up.destroy());
    up.on('close', () => client.destroy());
  }).listen(Number(port), '127.0.0.1');
}
console.log('proxy listening 18884-18887 -> ' + TARGET.host + ':' + TARGET.port);
