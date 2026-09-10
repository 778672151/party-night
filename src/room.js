/* ===== 房间层：主题编码 / 成员心跳 / 房主选举 / 私密下发 ===== */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};
  var TE = new TextEncoder(), TD = new TextDecoder();

  var BROKERS = [
    { id: 'A', url: 'wss://broker.emqx.io:8084/mqtt', name: 'EMQX 公共' },
    { id: 'B', url: 'wss://broker.hivemq.com:8884/mqtt', name: 'HiveMQ 公共' }
  ];
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var NS = 'pn3';
  var BEAT_MS = 4000;      // 心跳间隔
  var OFFLINE_MS = 13000;  // 超过判定掉线
  var DEAD_ROOM_MS = 6 * 3600 * 1000;
  var PM_RETRY_MS = 1200;  // 私密消息未确认重传间隔（公共 broker QoS0 会丢包）
  var PM_MAX_TRIES = 9;    // 约 15 秒内持续重传
  var PM_WAIT_MS = 4000;   // 对端未就绪时等待其上线的最长时间
  var ACT_RETRY_MS = 1500; // 动作未回执重传间隔
  var ACT_MAX_TRIES = 5;

  function randCode(n) {
    var s = '';
    for (var i = 0; i < (n || 4); i++) s += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
    return s;
  }
  function now() { return Date.now(); }

  /**
   * opts: { code, identity:{id,name,emoji}, brokerIndex,
   *         onRoster(list), onHost(isHost, hostId), onState(state), onAction(action, from),
   *         onEvent(ev), onPeer(msg, from), onPrivate(obj), onStatus(s, d) }
   */
  function Room(opts) {
    this.code = String(opts.code || '').toUpperCase();
    this.me = opts.identity;
    this.brokerIndex = opts.brokerIndex || 0;
    this.base = NS + '/' + this.code;
    this.seed = 'PN|' + this.code + '|v3';
    this.cb = opts;
    this.box = new PN.Crypt.Box();
    this.peers = {};        // id -> {id,name,emoji,pub,lastSeen}
    this.hostId = null;
    this.meta = null;
    this.isHost = false;
    this.lastState = null;
    this.mqtt = null;
    this._beat = null;
    this._elect = null;
    this._claimAt = 0;
    this._joinedAt = 0;
    this._pmSeq = 0;
    this._pending = {};     // mid -> {to,env,mid,tries,timer}  待确认的私密消息
    this._seen = {};        // mid -> ts  已投递过的私密消息（去重）
    this.ready = false;
  }

  Room.prototype.topic = function (k) { return this.base + '/' + k; };

  Room.prototype._enc = function (obj) {
    return PN.Crypt.xor(TE.encode(JSON.stringify(obj)), this.seed);
  };
  Room.prototype._dec = function (bytes) {
    if (!bytes || !bytes.length) return null;
    try { return JSON.parse(TD.decode(PN.Crypt.xor(bytes, this.seed))); } catch (e) { return null; }
  };

  Room.prototype.start = function () {
    var self = this;
    return self.box.init().then(function () {
      self.me.pub = self.box.pub;
      var urls = [BROKERS[self.brokerIndex % BROKERS.length].url];
      for (var i = 0; i < BROKERS.length; i++) if (i !== (self.brokerIndex % BROKERS.length)) urls.push(BROKERS[i].url);
      self.mqtt = new PN.MqttClient({
        urls: urls,
        clientId: 'pn_' + self.me.id + '_' + Math.random().toString(36).slice(2, 7),
        keepalive: 45,
        // dropped:true 表示这是 broker 代发的遗嘱（真掉线）；主动 leave() 发的 bye 不带这个标记。
        // 房主据此决定是「标离线保留积分」还是「真的移出房间」。
        will: { topic: self.topic('a'), payload: self._enc({ t: 'bye', id: self.me.id, dropped: true }) },
        onStatus: function (s, d) { self.cb.onStatus && self.cb.onStatus(s, d); },
        onConnect: function () {
          self.mqtt.subscribe([self.base + '/#']);
          self._beacon();
          self.ready = true;
        },
        onMessage: function (t, bytes, retained) { self._onMessage(t, bytes, retained); }
      });
      self._joinedAt = now();
      self.mqtt.connect();
      self._beat = setInterval(function () { self._beacon(); self._sweep(); self._election(); }, BEAT_MS);
      return self;
    });
  };

  Room.prototype._beacon = function () {
    this.publishRaw('a', { t: 'hi', id: this.me.id, name: this.me.name, emoji: this.me.emoji, pub: this.me.pub, ts: now() });
  };

  Room.prototype.publishRaw = function (k, obj, retain, queue) {
    if (!this.mqtt) return;
    this.mqtt.publish(this.topic(k), this._enc(obj), { retain: !!retain, queue: queue === undefined ? (k === 'a' || k === 'p') : !!queue });
  };

  Room.prototype._onMessage = function (topic, bytes, retained) {
    var self = this;
    var k = topic.slice(self.base.length + 1);
    var msg = self._dec(bytes);
    if (!msg) { if (k === 'm' && (!bytes || !bytes.length)) self.meta = null; return; }

    if (k === 'a') {
      if (msg.t === 'hi') {
        var was = self.peers[msg.id];
        self.peers[msg.id] = { id: msg.id, name: msg.name, emoji: msg.emoji, pub: msg.pub, lastSeen: now() };
        if (!was && msg.id !== self.me.id) self.cb.onRoster && self.cb.onRoster(self.roster(), 'join', msg.id);
        else self.cb.onRoster && self.cb.onRoster(self.roster());
        if (self.isHost && !was && msg.id !== self.me.id) {
          // 房主的 hi 不保留，晚到者学不到房主 → 收到新人 hi 时重播一次
          self.publishRaw('a', { t: 'hi', id: self.me.id, name: self.me.name, emoji: self.me.emoji, pub: self.me.pub, ts: now() });
          self.cb.onAction && self.cb.onAction({ t: '_joined', id: msg.id }, msg.id);
        }
        return;
      }
      if (msg.t === 'bye') {
        delete self.peers[msg.id];
        self.cb.onRoster && self.cb.onRoster(self.roster(), 'leave', msg.id);
        if (self.isHost) self.cb.onAction && self.cb.onAction({ t: '_left', id: msg.id, dropped: !!msg.dropped }, msg.id);
        return;
      }
      if (self.peers[msg.from]) self.peers[msg.from].lastSeen = now();
      if (msg.mid && self.isHost) {
        // 房主回执 + 去重：动作丢包时客户端会重传，重复包只确认不重复执行
        self.publishRaw('k', { to: msg.from, from: self.me.id, mid: msg.mid });
        if (self._seen[msg.mid]) return;
        self._seen[msg.mid] = now();
        self._trimSeen();
      }
      if (self.isHost) self.cb.onAction && self.cb.onAction(msg, msg.from);
      return;
    }
    if (k === 's') {
      self.lastState = msg;
      if (msg.hostId) {
        var hp = null;
        if (msg.players) for (var pi = 0; pi < msg.players.length; pi++) if (msg.players[pi].id === msg.hostId) hp = msg.players[pi];
        self._noteHost(msg.hostId, hp && hp.name, hp && hp.emoji);
      }
      if (!self.isHost || (msg.hostId && msg.hostId !== self.me.id)) self.cb.onState && self.cb.onState(msg, retained);
      return;
    }
    if (k === 'm') {
      // 双抢收敛：谁的 meta 更新谁说了算，旧的那方主动让位并重播自己（避免互相让位导致无房主）
      var mine = self.meta && self.meta.host === self.me.id ? self.meta : null;
      if (mine && (msg.ts || 0) < (mine.ts || 0)) { self.publishRaw('m', mine, true); return; }
      self.meta = msg;
      self._noteHost(msg.host, msg.hostName);
      if (msg.host !== self.hostId) { self.hostId = msg.host; self._applyHost(); }
      return;
    }
    if (k === 'e') { if (msg.from !== self.me.id) self.cb.onEvent && self.cb.onEvent(msg); return; }
    if (k === 'x') {
      if (msg.from === self.me.id) return;
      if (!PN.Wire.isV4(msg)) return; // 协议版本不匹配：整条丢弃，不和老实现对暗号
      if (msg.t === 'ink-ask') { if (msg.to === self.me.id) self._answerInk(msg); return; }
      if (self.cb.onInk) self.cb.onInk(msg, msg.from, false);
      self.cb.onPeer && self.cb.onPeer(msg, msg.from);
      return;
    }
    if (k === 'k') {
      if (msg.to !== self.me.id) return;
      var pd = self._pending[msg.mid];
      if (pd) { clearTimeout(pd.timer); delete self._pending[msg.mid]; }
      return;
    }
    if (k === 'p') {
      if (msg.to !== self.me.id) return;
      if (msg.mid) {
        // 先回执再投递：重传的重复包只确认不重复触发
        self.publishRaw('k', { to: msg.from, from: self.me.id, mid: msg.mid });
        if (self._seen[msg.mid]) return;
        self._seen[msg.mid] = now();
        self._trimSeen();
      }
      var sender = self.peers[msg.from];
      self.box.open(sender ? sender.pub : (msg.pub || null), msg.env).then(function (obj) {
        if (obj) self.cb.onPrivate && self.cb.onPrivate(obj, msg.from);
      });
      return;
    }
  };

  Room.prototype._applyHost = function () {
    var self = this;
    var host = this.hostId === this.me.id;
    var was = this.isHost;
    this.isHost = host;
    this.cb.onHost && this.cb.onHost(host, this.hostId);
    // 新当选/接管：把已知成员补发给状态机，否则"先到的人"在房主上任前发过 hi，会永远进不了名单
    if (host && !was) {
      var list = this.roster();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id !== self.me.id) self.cb.onAction && self.cb.onAction({ t: '_joined', id: list[i].id }, list[i].id);
      }
    }
  };

  /** 从保留的 meta/state 里发现房主：晚到者收不到房主的历史 hi，必须靠这两处补上，
   *  否则名单缺房主、且会误判房主掉线而抢主 */
  Room.prototype._noteHost = function (id, name, emoji) {
    if (!id || id === this.me.id) return;
    var p = this.peers[id];
    if (!p) {
      this.peers[id] = { id: id, name: name || '房主', emoji: emoji || '😎', pub: null, lastSeen: now() };
      this.cb.onRoster && this.cb.onRoster(this.roster(), 'join', id);
    } else {
      p.lastSeen = now();
      if (name && p.name !== name) p.name = name;
      if (emoji && p.emoji !== emoji) p.emoji = emoji;
    }
  };

  Room.prototype.roster = function () {
    var out = [], t = now();
    this.peers[this.me.id] = { id: this.me.id, name: this.me.name, emoji: this.me.emoji, pub: this.me.pub, lastSeen: t };
    for (var k in this.peers) if (Object.prototype.hasOwnProperty.call(this.peers, k)) {
      var p = this.peers[k];
      out.push({ id: p.id, name: p.name, emoji: p.emoji, pub: p.pub, online: (t - p.lastSeen) < OFFLINE_MS, lastSeen: p.lastSeen });
    }
    out.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    return out;
  };

  Room.prototype._sweep = function () {
    var t = now(), changed = false;
    for (var k in this.peers) if (Object.prototype.hasOwnProperty.call(this.peers, k)) {
      if (k !== this.me.id && t - this.peers[k].lastSeen > OFFLINE_MS * 6) { delete this.peers[k]; changed = true; }
    }
    if (changed) this.cb.onRoster && this.cb.onRoster(this.roster());
  };

  /** 房主选举：meta 缺失 / 房主掉线 → 在线 id 最小者接管 */
  Room.prototype._election = function () {
    if (!this.mqtt || !this.mqtt.connected) return;
    var t = now();
    var alive = this.roster().filter(function (p) { return p.online; }).map(function (p) { return p.id; }).sort();
    if (!alive.length) return;
    var hp = this.hostId ? this.peers[this.hostId] : null;
    var hostAlive = !!(hp && (t - hp.lastSeen) < OFFLINE_MS * 2);
    var metaDead = this.meta && this.meta.ts && (t - this.meta.ts > DEAD_ROOM_MS);
    // 已知房主但还没收到它心跳（刚进房）→ 先观察一个心跳周期，别急着抢
    if (this.hostId && !hostAlive && (t - this._joinedAt) < BEAT_MS * 2) return;
    if (hostAlive && !metaDead) return;
    if (alive[0] !== this.me.id) return;
    if (t - this._claimAt < 6000) return;
    this._claimAt = t;
    this.claimHost();
  };

  Room.prototype.claimHost = function () {
    this.hostId = this.me.id;
    this.meta = { code: this.code, host: this.me.id, hostName: this.me.name, ts: now(), ver: 3 };
    this.publishRaw('m', this.meta, true);
    this._applyHost();
    if (this.lastState) this.publishState(this.lastState);
  };

  Room.prototype.publishState = function (state) {
    state.hostId = this.me.id;
    state.ts = now();
    this.lastState = state;
    this.publishRaw('s', state, true);
  };
  Room.prototype._sendAct = function (rec) {
    var self = this;
    if (!self._pending[rec.mid]) return;
    rec.tries++;
    var out = {}, k;
    for (k in rec.payload) out[k] = rec.payload[k];
    out.mid = rec.mid;
    // 动作不进断线队列：排队的话重连时会一次性涌入，落到已经换过轮的新一轮里
    // （比如你掉线前拖的猜测，回来时已经开了新回合）。重传机制本身已经覆盖短暂抖动。
    self.publishRaw('a', out, false, false);
    if (rec.tries >= ACT_MAX_TRIES) { delete self._pending[rec.mid]; return; }
    clearTimeout(rec.timer);
    rec.timer = setTimeout(function () { self._sendAct(rec); }, ACT_RETRY_MS);
  };

  Room.prototype.sendAction = function (action) {
    action.from = this.me.id;
    action.ts = now();
    if (this.isHost) { this.cb.onAction && this.cb.onAction(action, this.me.id); return; }
    var mid = this.me.id + ':' + (++this._pmSeq) + ':' + Math.random().toString(36).slice(2, 6);
    var rec = { payload: action, mid: mid, tries: 0, timer: null };
    this._pending[mid] = rec;
    this._sendAct(rec);
  };
  Room.prototype.sendEvent = function (ev) { ev.from = this.me.id; this.publishRaw('e', ev); };
  Room.prototype.sendPeer = function (msg) {
    msg.from = this.me.id;
    this.publishRaw('x', PN.Wire.pack('x', msg, msg.r));
  };

  /** 墨迹直达：不再走「画家→房主→转发」两跳，直接广播给全房（房主也订阅，照常留一份回放） */
  Room.prototype.sendInk = function (msg) {
    var self = this;
    if (!self._inkOut) self._inkOut = new PN.Wire.Out(4);
    msg.from = self.me.id;
    if (msg.t === 'stroke') {
      msg = self._inkOut.pack(msg.id, msg.i0, msg.s, { r: msg.r, color: msg.color, w: msg.w });
      msg.from = self.me.id;
    }
    // 自测钩子：每 N 块丢 1 块（QoS0 的公共 broker 真的会丢），用来验证补发能把笔画还原
    if (self.inkDropEvery) {
      self._inkSent = (self._inkSent || 0) + 1;
      if (self._inkSent % self.inkDropEvery === 0) { self._inkOut.dropped++; return; }
    }
    self.publishRaw('x', PN.Wire.pack('x', msg, msg.r));
    // 自己发出去的也回调一次：房主自己画的时候，回放数据同样要留一份
    if (self.cb.onInk) self.cb.onInk(msg, self.me.id, true);
  };

  /** 发现缺号：向发送者要一次补发（补发是广播的，一次就能同时修好所有人） */
  Room.prototype.askInk = function (to, id, fromIdx) {
    if (!to || !this.mqtt) return;
    // 注意别叫 from：from 已经是「发起人」这个信封字段了，再叫 from 会把「缺到哪个下标」覆盖掉
    this.publishRaw('x', PN.Wire.pack('x', { t: 'ink-ask', to: to, id: id, fromIdx: fromIdx, from: this.me.id }));
  };

  Room.prototype._answerInk = function (ask) {
    if (!this._inkOut) return;
    var chunks = this._inkOut.missing(ask.id, ask.fromIdx);
    for (var i = 0; i < chunks.length; i++) {
      var c = {}, k;
      for (k in chunks[i]) if (Object.prototype.hasOwnProperty.call(chunks[i], k)) c[k] = chunks[i][k];
      c.from = this.me.id;
      c.re = 1; // 标记：这是补发
      // 补发也必须过信封！否则会被接收端的版本校验（isV4）当成老消息丢掉，补发等于没发
      this.publishRaw('x', PN.Wire.pack('x', c, c.r));
    }
  };
  Room.prototype._trimSeen = function () {
    var keys = Object.keys(this._seen);
    if (keys.length <= 300) return;
    keys.sort(function (a, b) { return this._seen[a] - this._seen[b]; }.bind(this));
    for (var i = 0; i < keys.length - 150; i++) delete this._seen[keys[i]];
  };

  /** 重传直到收到对端回执（'k'）；对端去重，故重传安全 */
  Room.prototype._sendPriv = function (rec) {
    var self = this;
    if (!self._pending[rec.mid]) return;
    rec.tries++;
    self.publishRaw('p', { to: rec.to, from: self.me.id, pub: self.me.pub, mid: rec.mid, env: rec.env });
    if (rec.tries >= PM_MAX_TRIES) { delete self._pending[rec.mid]; return; }
    clearTimeout(rec.timer);
    rec.timer = setTimeout(function () { self._sendPriv(rec); }, PM_RETRY_MS * (rec.tries >= 3 ? 2 : 1));
  };

  /** 等对端出现在花名册（加入稍晚于建房时不要静默丢弃） */
  Room.prototype._waitPeer = function (pid, ms) {
    var self = this, t0 = now();
    return new Promise(function (resolve) {
      (function poll() {
        if (self.peers[pid]) return resolve(self.peers[pid]);
        if (now() - t0 >= ms) return resolve(null);
        setTimeout(poll, 250);
      })();
    });
  };

  Room.prototype.sendPrivate = function (pid, obj) {
    var self = this;
    if (pid === self.me.id) { self.cb.onPrivate && self.cb.onPrivate(obj, self.me.id); return Promise.resolve(); }
    return self._waitPeer(pid, PM_WAIT_MS).then(function (peer) {
      if (!peer) return null;
      var mid = self.me.id + ':' + (++self._pmSeq) + ':' + Math.random().toString(36).slice(2, 6);
      return self.box.seal(peer.pub, obj).then(function (env) {
        var rec = { to: pid, mid: mid, env: env, tries: 0, timer: null };
        self._pending[mid] = rec;
        self._sendPriv(rec);
        return mid;
      });
    });
  };

  Room.prototype.leave = function (disband) {
    if (this._beat) clearInterval(this._beat);
    for (var mid in this._pending) clearTimeout(this._pending[mid].timer);
    this._pending = {};
    this.publishRaw('a', { t: 'bye', id: this.me.id });
    if (disband && this.isHost) {
      this.mqtt.publish(this.topic('m'), new Uint8Array(0), { retain: true });
      this.mqtt.publish(this.topic('s'), new Uint8Array(0), { retain: true });
    }
    var m = this.mqtt;
    setTimeout(function () { try { m.end(); } catch (e) {} }, 250);
  };

  /** 探测房间是否已存在（用于建房防撞号 / 加入前校验）：Promise<meta|null> */
  Room.probe = function (code, brokerIndex, ms) {
    return new Promise(function (resolve) {
      var base = NS + '/' + code.toUpperCase();
      var seed = 'PN|' + code.toUpperCase() + '|v3';
      var done = false;
      var c = new PN.MqttClient({
        urls: [BROKERS[(brokerIndex || 0) % BROKERS.length].url],
        clientId: 'pn_probe_' + Math.random().toString(36).slice(2, 9),
        onConnect: function () { c.subscribe([base + '/m']); },
        onMessage: function (t, bytes) {
          if (done) return;
          var meta = null;
          try { meta = JSON.parse(new TextDecoder().decode(PN.Crypt.xor(bytes, seed))); } catch (e) {}
          if (meta) { done = true; try { c.end(); } catch (e) {} resolve(meta); }
        }
      });
      c.connect();
      setTimeout(function () { if (!done) { done = true; try { c.end(); } catch (e) {} resolve(null); } }, ms || 2500);
    });
  };

  PN.Room = Room;
  PN.BROKERS = BROKERS;
  PN.randCode = randCode;
  PN.NS = NS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
