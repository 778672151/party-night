/* ===== 极简 MQTT 3.1.1 over WebSocket 客户端（零依赖，浏览器/Node 通用） ===== */
(function (root) {
  'use strict';
  var TE = new TextEncoder();
  var TD = new TextDecoder();

  function concat(parts) {
    var n = 0, i;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n), off = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
    return out;
  }
  function varint(len) {
    var out = [];
    do { var b = len % 128; len = Math.floor(len / 128); if (len > 0) b |= 0x80; out.push(b); } while (len > 0);
    return new Uint8Array(out);
  }
  function str(s) {
    var b = TE.encode(s);
    var out = new Uint8Array(b.length + 2);
    out[0] = (b.length >> 8) & 0xff; out[1] = b.length & 0xff; out.set(b, 2);
    return out;
  }
  function u16(n) { return new Uint8Array([(n >> 8) & 0xff, n & 0xff]); }
  function pack(type, flags, parts) {
    var body = concat(parts);
    var vl = varint(body.length);
    var out = new Uint8Array(1 + vl.length + body.length);
    out[0] = (type << 4) | flags;
    out.set(vl, 1); out.set(body, 1 + vl.length);
    return out;
  }
  function toBytes(x) { return typeof x === 'string' ? TE.encode(x) : (x instanceof Uint8Array ? x : new Uint8Array(x)); }

  /**
   * opts: { urls:[wss...], clientId, keepalive, will:{topic,payload,retain},
   *         onConnect(), onMessage(topic, bytes, retained), onStatus(status, detail) }
   */
  function MqttClient(opts) {
    this.urls = opts.urls.slice();
    this.urlIndex = 0;
    this.clientId = opts.clientId || ('pn_' + Math.random().toString(36).slice(2, 12));
    this.keepalive = opts.keepalive || 45;
    this.will = opts.will || null;
    this.onConnect = opts.onConnect || function () {};
    this.onMessage = opts.onMessage || function () {};
    this.onStatus = opts.onStatus || function () {};
    this.ws = null;
    this.buf = new Uint8Array(0);
    this.connected = false;
    this.closed = false;
    this.pid = 1;
    this.retries = 0;
    this.outbox = [];
    this.subs = [];
    this._pingTimer = null;
    this._reconnectTimer = null;
    this._lastIn = 0;
  }

  MqttClient.prototype.status = function (s, d) { this.onStatus(s, d); };

  MqttClient.prototype.connect = function () {
    var self = this;
    if (self.closed) return;
    var url = self.urls[self.urlIndex % self.urls.length];
    self.status('connecting', url);
    var ws;
    try { ws = new WebSocket(url, 'mqtt'); } catch (e) { self._scheduleReconnect(); return; }
    ws.binaryType = 'arraybuffer';
    self.ws = ws;
    self.buf = new Uint8Array(0);
    var opened = false;
    var guard = setTimeout(function () { if (!opened) { try { ws.close(); } catch (e) {} } }, 9000);

    ws.onopen = function () {
      opened = true; clearTimeout(guard);
      var flags = 0x02; // clean session
      var payload = [str(self.clientId)];
      if (self.will) {
        flags |= 0x04; // will flag, qos0
        if (self.will.retain) flags |= 0x20;
        payload.push(str(self.will.topic));
        var wp = toBytes(self.will.payload || '');
        payload.push(u16(wp.length)); payload.push(wp);
      }
      var head = [str('MQTT'), new Uint8Array([4, flags]), u16(self.keepalive)];
      self._send(pack(1, 0, head.concat(payload)));
    };
    ws.onmessage = function (ev) {
      self._lastIn = Date.now();
      var chunk = new Uint8Array(ev.data);
      var merged = new Uint8Array(self.buf.length + chunk.length);
      merged.set(self.buf, 0); merged.set(chunk, self.buf.length);
      self.buf = merged;
      self._parse();
    };
    ws.onerror = function () { /* close 会跟着来 */ };
    ws.onclose = function () {
      clearTimeout(guard);
      var was = self.connected;
      self.connected = false;
      if (self._pingTimer) { clearInterval(self._pingTimer); self._pingTimer = null; }
      if (self.closed) return;
      self.status('disconnected', was ? 'lost' : 'failed');
      if (!was) self.urlIndex++; // 连不上就换下一个 broker
      self._scheduleReconnect();
    };
  };

  MqttClient.prototype._scheduleReconnect = function () {
    var self = this;
    if (self.closed || self._reconnectTimer) return;
    var wait = Math.min(800 * Math.pow(1.7, Math.min(self.retries, 5)), 8000);
    self.retries++;
    self._reconnectTimer = setTimeout(function () { self._reconnectTimer = null; self.connect(); }, wait);
  };

  MqttClient.prototype._send = function (bytes) {
    try {
      if (this.ws && this.ws.readyState === 1) { this.ws.send(bytes); return true; }
    } catch (e) {}
    return false;
  };

  MqttClient.prototype._parse = function () {
    while (this.buf.length >= 2) {
      var mult = 1, len = 0, i = 1, byte;
      do {
        if (i >= this.buf.length) return; // 长度还没收全
        byte = this.buf[i];
        len += (byte & 127) * mult;
        mult *= 128; i++;
        if (i > 5) { this.buf = new Uint8Array(0); return; }
      } while ((byte & 128) !== 0);
      var total = i + len;
      if (this.buf.length < total) return;
      var head = this.buf[0];
      var body = this.buf.subarray(i, total);
      this.buf = this.buf.slice(total);
      this._handle(head >> 4, head & 0x0f, body);
    }
  };

  MqttClient.prototype._handle = function (type, flags, body) {
    var self = this;
    if (type === 2) { // CONNACK
      if (body.length >= 2 && body[1] !== 0) { self.status('error', 'CONNACK=' + body[1]); try { self.ws.close(); } catch (e) {} return; }
      self.connected = true; self.retries = 0;
      self.status('connected', self.urls[self.urlIndex % self.urls.length]);
      if (self._pingTimer) clearInterval(self._pingTimer);
      self._pingTimer = setInterval(function () {
        if (!self.connected) return;
        self._send(new Uint8Array([0xc0, 0x00]));
        if (Date.now() - self._lastIn > (self.keepalive * 1000 + 15000)) { try { self.ws.close(); } catch (e) {} }
      }, Math.max(5000, self.keepalive * 500));
      var pending = self.outbox; self.outbox = [];
      if (self.subs.length) self._doSubscribe(self.subs.slice());
      self.onConnect();
      for (var k = 0; k < pending.length; k++) self.publish(pending[k].t, pending[k].p, pending[k].o);
      return;
    }
    if (type === 3) { // PUBLISH
      var qos = (flags >> 1) & 3;
      var tl = (body[0] << 8) | body[1];
      var topic = TD.decode(body.subarray(2, 2 + tl));
      var off = 2 + tl;
      if (qos > 0) {
        var mid = (body[off] << 8) | body[off + 1]; off += 2;
        if (qos === 1) self._send(pack(4, 0, [u16(mid)]));
      }
      self.onMessage(topic, body.subarray(off), (flags & 1) === 1);
      return;
    }
    if (type === 13) return; // PINGRESP
  };

  MqttClient.prototype._doSubscribe = function (topics) {
    var parts = [u16(this.pid++ & 0xffff)];
    for (var i = 0; i < topics.length; i++) { parts.push(str(topics[i])); parts.push(new Uint8Array([0])); }
    this._send(pack(8, 2, parts));
  };

  MqttClient.prototype.subscribe = function (topics) {
    var add = [];
    for (var i = 0; i < topics.length; i++) if (this.subs.indexOf(topics[i]) < 0) { this.subs.push(topics[i]); add.push(topics[i]); }
    if (add.length && this.connected) this._doSubscribe(add);
  };

  MqttClient.prototype.publish = function (topic, payload, opts) {
    opts = opts || {};
    var bytes = toBytes(payload);
    if (!this.connected) {
      if (opts.queue !== false) { this.outbox.push({ t: topic, p: bytes, o: opts }); if (this.outbox.length > 60) this.outbox.shift(); }
      return false;
    }
    var flags = opts.retain ? 1 : 0;
    return this._send(pack(3, flags, [str(topic), bytes]));
  };

  MqttClient.prototype.end = function () {
    this.closed = true;
    if (this._pingTimer) clearInterval(this._pingTimer);
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    try { this._send(new Uint8Array([0xe0, 0x00])); this.ws.close(); } catch (e) {}
    this.connected = false;
  };

  root.PN = root.PN || {};
  root.PN.MqttClient = MqttClient;
  root.PN.bytes = { concat: concat, str: str, toBytes: toBytes, TE: TE, TD: TD };
})(typeof globalThis !== 'undefined' ? globalThis : this);
