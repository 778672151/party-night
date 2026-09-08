// 真实 broker 集成测试：4 个玩家进程内互连，完整跑一局谁是卧底
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeClock } from './faketimers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

globalThis.window = globalThis.window || {};
globalThis.window.__PN_BANKS__ = {
  undercover: JSON.parse(read('data/undercover.json')),
  wavelength: JSON.parse(read('data/wavelength.json')),
  mostlikely: JSON.parse(read('data/mostlikely.json')),
  draw: JSON.parse(read('data/draw.json')),
};
globalThis.PN = { games: {}, pick: {}, Banks: {} };

const core = ['src/data.js', 'src/crypto.js', 'src/mqtt.js', 'src/room.js', 'src/host.js',
  'src/games/drawgame.js', 'src/games/mostlikely.js', 'src/games/undercover.js', 'src/games/wavelength.js'];
for (const p of core) eval(read(p));

const { Room, Host } = PN;
if (process.env.PROXY) {
  // 每个客户端走独立代理端口，便于在 TLS 层抓包定位
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const PORTS = { host01: 18884, b0000001: 18885, c0000001: 18886, d0000001: 18887 };
  const OrigMqtt = PN.MqttClient;
  function PatchedMqtt(opts) {
    const id = String(opts.clientId || '').split('_')[1] || 'host01';
    return new OrigMqtt(Object.assign({}, opts, { urls: ['wss://127.0.0.1:' + (PORTS[id] || 18884) + '/mqtt'] }));
  }
  PatchedMqtt.prototype = OrigMqtt.prototype;
  PN.MqttClient = PatchedMqtt;
}
if (process.env.DBG) {
  const origH = PN.MqttClient.prototype._handle;
  PN.MqttClient.prototype._handle = function (type, flags, body) {
    if (type === 3) {
      const tl = (body[0] << 8) | body[1];
      const topic = new TextDecoder().decode(body.subarray(2, 2 + tl));
      if (topic.slice(-2) === '/p') console.log('  [wsRECV@' + this.clientId.slice(3, 11) + '] bodyLen=' + (body.length - 2 - tl));
    }
    return origH.apply(this, arguments);
  };
  const origOn = Room.prototype._onMessage;
  Room.prototype._onMessage = function (topic, bytes) {
    const k = topic.slice(this.base.length + 1);
    if (k === 'a') { const m = this._dec(bytes); if (m && (m.t === 'hi' || m.t === 'bye')) console.log('  [in@' + this.me.id + '] ' + m.t + ' from=' + m.id); }
    if (k === 'p') {
      const m = this._dec(bytes);
      const mine = m && m.to === this.me.id;
      console.log('  [pIN@' + this.me.id + '] to=' + (m && m.to) + ' from=' + (m && m.from) + (mine ? ' *mine*' : ' skip'));
      if (mine) {
        const ob = this.box.open.bind(this.box);
        this.box.open = (pub, env) => ob(pub, env).then(o => { console.log('  [open@' + this.me.id + '] ' + (o ? 'ok' : 'NULL')); return o; });
      }
    }
    return origOn.apply(this, arguments);
  };
  const origEl = Room.prototype._election;
  Room.prototype._election = function () {
    const before = this.isHost;
    origEl.call(this);
    if (this.isHost !== before) console.log('  [elect@' + this.me.id + '] ' + before + ' -> ' + this.isHost + ' hostId=' + this.hostId + ' online=' + JSON.stringify(this.roster().filter(p => p.online).map(p => p.id)));
  };
}
const code = PN.randCode(6); // 真随机房号，避免撞上残留房
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const sleepUntil = async (fn, ms, what) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(200); }
  throw new Error('等待超时: ' + what);
};

// 原始 WS 帧探针（每次重连后重新包装）
function wrapWs(room, id) {
  const ws = room.mqtt && room.mqtt.ws;
  if (!ws || ws.__probed) return;
  ws.__probed = true;
  const os = ws.send.bind(ws);
  ws.send = (d) => { const n = d && (d.byteLength !== undefined ? d.byteLength : d.length); if (n > 250) console.log('  [wsSENDRAW@' + id + '] n=' + n); return os(d); };
  const om = ws.onmessage;
  ws.onmessage = (ev) => { const n = ev.data && (ev.data.byteLength !== undefined ? ev.data.byteLength : ev.data.size); if (n > 250) console.log('  [wsFRAME@' + id + '] n=' + n); return om(ev); };
}

const mkPlayer = (id, name, emoji, extra) => {
  const client = { state: null, secrets: [], events: [], host: null, clock: null };
  const room = new Room({
    code, identity: { id, name, emoji }, brokerIndex: 0,
    onStatus: (s, d) => { if (process.env.DBG) console.log('  [status@' + id + '] ' + s + ' ' + (d || '')); },
    onRoster: () => {}, onHost: (isHost) => {
      if (isHost) {
        if (!client.host) client.host = new Host(room, () => {});
        client.clock = makeClock(client.host);
        if (room.lastState && room.lastState.players && room.lastState.players.length) client.host.adopt(room.lastState);
        else client.host.fresh(id, name, emoji);
      }
      client.isHost = isHost;
    },
    onState: (state) => { if (!client.isHost) client.state = state; },
    onAction: (action, from) => {
      if (process.env.DBG) console.log('  [recv@' + id + '] t=' + action.t + ' from=' + from + ' isHost=' + client.isHost);
      if (client.host && client.isHost) client.host.dispatch(action, from);
    },
    onEvent: (ev) => { client.events.push(ev); },
    onPrivate: (obj) => {
      if (process.env.DBG) console.log('  [privIN@' + id + '] kind=' + (obj && obj.kind));
      client.secrets.push(obj);
    },
    onPeer: () => {}
  });
  if (process.env.DBG) setInterval(() => wrapWs(room, id), 300);
  return room.start().then(() => {
    client.room = room;
    if (process.env.DBG) {
      const orig = room.publishRaw.bind(room);
      room.publishRaw = (k, obj, retain) => {
        if (k === 'a') console.log('  [send@' + id + '] t=' + (obj && obj.t) + ' conn=' + !!(room.mqtt && room.mqtt.connected) + ' isHost=' + room.isHost);
        if (k === 'p') console.log('  [pubP@' + id + '] to=' + (obj && obj.to) + ' conn=' + !!(room.mqtt && room.mqtt.connected) + ' rs=' + (room.mqtt && room.mqtt.ws && room.mqtt.ws.readyState));
        return orig(k, obj, retain);
      };
      const origSend = room.mqtt._send.bind(room.mqtt);
      room.mqtt._send = (bytes) => {
        if (bytes[0] >> 4 === 3) {
          let i = 1, len = 0, mult = 1, b;
          do { b = bytes[i]; len += (b & 127) * mult; mult *= 128; i++; } while (b & 128);
          const tl = (bytes[i] << 8) | bytes[i + 1];
          const topic = new TextDecoder().decode(bytes.subarray(i + 2, i + 2 + tl));
          if (topic.slice(-2) === '/p') console.log('  [wsSEND@' + id + '] bodyLen=' + len);
        }
        const ok = origSend(bytes);
        if (!ok) console.log('  [SENDFAIL@' + id + '] len=' + bytes.length + ' readyState=' + (room.mqtt.ws && room.mqtt.ws.readyState) + ' connected=' + room.mqtt.connected);
        return ok;
      };
      const origSP = room.sendPrivate.bind(room);
      room.sendPrivate = (pid, obj) => {
        console.log('  [privOUT@' + id + '] to=' + pid + ' kind=' + (obj && obj.kind) + ' peer=' + !!room.peers[pid] + ' pub=' + (room.peers[pid] ? String(room.peers[pid].pub).slice(0, 6) : '-'));
        return origSP(pid, obj).then(r => r, e => { console.log('  [privERR@' + id + '] to=' + pid + ' ' + e.message); });
      };
    }
    return client;
  });
};

const A = await mkPlayer('host01', '房主', '😎');
await sleepUntil(() => A.isHost, 12000, '房主当选');
const B = await mkPlayer('b0000001', '小B', '🐱');
const C = await mkPlayer('c0000001', '小C', '🐶');
const D = await mkPlayer('d0000001', '小D', '🦊');
await sleepUntil(() => A.host && A.host.state && A.host.state.players.length >= 4, 15000, '4人进房');
await wait(500);

const h = A.host;
const assert = (cond, msg) => { if (!cond) { console.error('FAIL', msg); console.error('state=', JSON.stringify(h.state)); process.exit(1); } };

h.dispatch({ t: 'start', mode: 'undercover' }, 'host01');
assert(h.state.mode === 'undercover' && h.state.g.phase === 'setup', '进入 setup');
h.dispatch({ t: 'pickSide', side: 'random' }, 'host01');
h.dispatch({ t: 'start' }, 'host01');
assert(h.state.g.phase === 'describe', '发词后进入 describe，got=' + h.state.g.phase);
// 房主也是玩家，也要收到自己的秘密（本地私密回调）
await sleepUntil(() => [A, B, C, D].every(c => c.secrets.some(s => s.obj && s.obj.role !== undefined)), 10000, '四人收到秘密词');
const words = [A, B, C, D].map(c => {
  const s = c.secrets.find(x => x.obj && x.obj.role !== undefined);
  return s ? { id: c.room.me.id, word: s.obj.word, role: s.obj.role } : { id: c.room.me.id, word: null, role: null };
});
console.log('词分布:', JSON.stringify(words));
const uniq = [...new Set(words.map(w => w.word))];
const underCount = words.filter(w => w.role === 'under').length;
if (uniq.length !== 2 || underCount !== 1) {
  console.error('每个客户端的完整秘密列表:');
  [A, B, C, D].forEach(c => console.error(c.room.me.id, JSON.stringify(c.secrets)));
  assert(false, '词分布异常：应有 2 种词且 1 个卧底，实际 ' + JSON.stringify(words));
}

// 描述（房主也是玩家，也要描述）
for (const [i, c] of [B, C, D].entries()) c.room.sendAction({ t: 'desc', text: '描述' + (i + 1) });
h.dispatch({ t: 'desc', text: '房主描述' }, 'host01');
await sleepUntil(() => h.state.g.phase === 'vote', 10000, '全员描述进入投票');
// 全员投票：除 B 外都投 B（B 投 host01，规避自投）
for (const c of [B, C, D]) c.room.sendAction({ t: 'vote', id: c.room.me.id === 'b0000001' ? 'host01' : 'b0000001' });
h.dispatch({ t: 'vote', id: 'b0000001' }, 'host01');
await sleepUntil(() => h.state.g.phase !== 'vote', 10000, '投票结算');
await wait(300);
console.log('结算 phase:', h.state.g.phase, '存活:', JSON.stringify(h.state.g.alive), '出局:', JSON.stringify(h.state.g.dead));
// 用计时器把本局推到 over（若无人出局则重投直至出局）
let guard = 0;
while (h.state.g.phase !== 'over' && guard++ < 12) {
  const aliveList = h.state.g.alive.slice();
  if (h.state.g.phase === 'describe') {
    for (const c of [B, C, D].filter(x => aliveList.includes(x.room.me.id))) c.room.sendAction({ t: 'desc', text: '再来' });
    if (aliveList.includes('host01')) h.dispatch({ t: 'desc', text: '再来' }, 'host01');
    try {
      await sleepUntil(() => h.state.g.phase === 'vote' || h.state.g.phase === 'over', 10000, '描述→投票');
    } catch (e) {
      console.error('描述卡住现场: phase=' + h.state.g.phase, 'alive=' + JSON.stringify(h.state.g.alive), 'descCount=' + h.state.g.descCount, 'desc=' + JSON.stringify(h.state.g.desc));
      throw e;
    }
  } else if (h.state.g.phase === 'vote' || h.state.g.phase === 'revote') {
    // 除目标本人外，大家投给第一个存活者；目标本人投别人（规避自投）
    const target = h.state.g.alive[0];
    const alt = h.state.g.alive[1] || h.state.g.alive[0];
    const pick = (voterId) => (voterId === target ? alt : target);
    for (const c of [B, C, D].filter(x => aliveList.includes(x.room.me.id))) c.room.sendAction({ t: 'vote', id: pick(c.room.me.id) });
    if (aliveList.includes('host01')) h.dispatch({ t: 'vote', id: pick('host01') }, 'host01');
    await sleepUntil(() => (h.state.g.phase !== 'vote' && h.state.g.phase !== 'revote') || h.state.g.phase === 'over', 10000, '投票→结算');
  } else if (h.state.g.phase === 'blankGuess') {
    h.clock.pump('blankGuess');
  }
}
assert(h.state.g.phase === 'over', '本局结束 over，got=' + h.state.g.phase);
assert(h.state.g.winner, '有胜方: ' + JSON.stringify(h.state.g.winner));
try {
  await sleepUntil(() => [B, C, D].every(c => c.secrets.some(s => s.kind === 'reveal' && s.obj && s.obj.words)), 15000, '玩家收到终局揭示');
} catch (e) {
  [B, C, D].forEach(c => console.error(c.room.me.id, 'secrets=', JSON.stringify(c.secrets)));
  throw e;
}
console.log('PASS 真实联机：一局谁是卧底完整跑通，胜方 =', JSON.stringify(h.state.g.winner), '词对 =', JSON.stringify(B.secrets.find(s => s.kind === 'reveal').obj.words));

A.room.leave(true); // 房主解散，清掉 retained 快照
await wait(600);
process.exit(0);
