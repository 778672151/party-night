// 真实 broker 多客户端测试脚手架：加载内核 + 建桌 + 等待工具
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeClock } from './faketimers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

export function loadPN() {
  globalThis.window = globalThis.window || {};
  globalThis.window.__PN_BANKS__ = {
    draw: JSON.parse(read('data/draw.json')),
  };
  globalThis.PN = { games: {}, pick: {}, Banks: {} };
  const core = ['src/data.js', 'src/crypto.js', 'src/mqtt.js', 'src/wire.js', 'src/room.js', 'src/host.js',
    'src/games/drawgame.js'];
  for (const p of core) eval(read(p));
  return globalThis.PN;
}

export const wait = (ms) => new Promise(r => setTimeout(r, ms));
export const sleepUntil = async (fn, ms, what) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(200); }
  throw new Error('等待超时: ' + what);
};

function makeFactory(code) {
  const { Room, Host } = globalThis.PN;
  return (id, name, emoji) => new Promise((resolve) => {
    const client = { id, name, emoji, state: null, secrets: [], events: [], host: null, clock: null, isHost: false };
    const room = new Room({
      code, identity: { id, name, emoji }, brokerIndex: 0,
      onStatus: () => {},
      onRoster: () => {},
      onHost: (isHost) => {
        if (isHost) {
          if (!client.host) client.host = new Host(room, () => {});
          client.clock = makeClock(client.host);
          if (room.lastState && room.lastState.players && room.lastState.players.length) client.host.adopt(room.lastState);
          else client.host.fresh(id, name, emoji);
        }
        client.isHost = isHost;
      },
      onState: (state) => { if (!client.isHost) client.state = state; },
      onAction: (action, from) => { if (client.host && client.isHost) client.host.dispatch(action, from); },
      onEvent: (ev) => client.events.push(ev),
      onPrivate: (obj) => client.secrets.push(obj),
      onPeer: () => {},
      // 房主旁听墨迹通道留回放（浏览器里是 ui.js 干的，harness 要等价，否则回放永远是空的）
      onInk: (msg, from) => {
        if (client.host && client.isHost) {
          const g = globalThis.PN.games[client.host.state.mode];
          if (g && g.onInk) g.onInk(client.host, msg, from);
        }
      }
    });
    client.room = room;
    room.start().then(() => resolve(client));
  });
}

/** specs: [[id,name,emoji], ...] 第一个必须是房主候选 */
export async function makeTable(specs) {
  const code = globalThis.PN.randCode(6);
  const mk = makeFactory(code);
  const players = [];
  for (let i = 0; i < specs.length; i++) {
    players.push(await mk(specs[i][0], specs[i][1], specs[i][2]));
    if (i === 0) await sleepUntil(() => players[0].isHost, 15000, '房主当选');
  }
  const table = {
    code, players, wait, sleepUntil,
    get h() { return players[0].host; },
    get host() { return players[0].host; },
    byId: (id) => players.find(p => p.id === id),
    online: () => players.filter(p => p.isHost || p.state),
    add: async (id, name, emoji) => { const c = await mk(id, name, emoji); players.push(c); return c; },
    close: () => { for (const p of players) { try { p.room.leave(); } catch (e) {} } }
  };
  await sleepUntil(() => players[0].host && players[0].host.state
    && players[0].host.state.players.filter(p => p.online).length >= specs.length, 25000, '全员进房');
  await wait(500);
  return table;
}

export function asserter(table) {
  return (cond, msg) => {
    if (!cond) {
      console.error('FAIL', msg);
      console.error('state=', JSON.stringify(table.h.state));
      process.exit(1);
    }
  };
}
