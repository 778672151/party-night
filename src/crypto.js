/* ===== 轻量加密层：房间混淆 XOR + 可选 ECDH 端到端私密信封 ===== */
(function (root) {
  'use strict';
  var TE = new TextEncoder(), TD = new TextDecoder();

  function h32(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function keystream(seed, len) {
    var x = h32(seed) || 0x9e3779b9, out = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      x ^= (x << 13); x >>>= 0; x ^= (x >>> 17); x ^= (x << 5); x >>>= 0;
      out[i] = (x ^ (i * 167)) & 0xff;
    }
    return out;
  }
  function xor(bytes, seed) {
    var ks = keystream(seed, bytes.length), out = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ ks[i];
    return out;
  }
  function b64e(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64d(s) {
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  var subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;

  /* 私密信封：优先 ECDH-P256 + AES-GCM（https 环境）；否则退化为共享口令 XOR（file:// 环境） */
  function Box() {
    this.mode = 'xor';
    this.secret = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    this.pub = 'x:' + this.secret;
    this._priv = null;
    this._cache = {};
  }
  Box.prototype.init = function () {
    var self = this;
    if (!subtle) return Promise.resolve(self);
    return subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
      .then(function (kp) {
        self._priv = kp.privateKey;
        return subtle.exportKey('raw', kp.publicKey);
      })
      .then(function (raw) { self.mode = 'ecdh'; self.pub = 'e:' + b64e(new Uint8Array(raw)); return self; })
      .catch(function () { return self; });
  };
  Box.prototype._key = function (peerPub) {
    var self = this;
    if (self._cache[peerPub]) return self._cache[peerPub];
    var p = subtle.importKey('raw', b64d(peerPub.slice(2)), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
      .then(function (pk) { return subtle.deriveBits({ name: 'ECDH', public: pk }, self._priv, 256); })
      .then(function (bits) { return subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); });
    self._cache[peerPub] = p;
    return p;
  };
  Box.prototype._pairSeed = function (peerPub) {
    var a = this.pub.slice(2), b = peerPub.slice(2);
    return (a < b ? a + '|' + b : b + '|' + a);
  };
  /** 返回 Promise<{n?:string,c:string}> */
  Box.prototype.seal = function (peerPub, obj) {
    var data = TE.encode(JSON.stringify(obj));
    if (this.mode !== 'ecdh' || !peerPub || peerPub.charAt(0) !== 'e') {
      return Promise.resolve({ c: b64e(xor(data, this._pairSeed(peerPub || 'x:none'))) });
    }
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return this._key(peerPub)
      .then(function (k) { return subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, data); })
      .then(function (ct) { return { n: b64e(iv), c: b64e(new Uint8Array(ct)) }; });
  };
  /** 返回 Promise<any|null> */
  Box.prototype.open = function (peerPub, env) {
    var self = this;
    if (!env || !env.c) return Promise.resolve(null);
    if (!env.n || self.mode !== 'ecdh' || !peerPub || peerPub.charAt(0) !== 'e') {
      try { return Promise.resolve(JSON.parse(TD.decode(xor(b64d(env.c), self._pairSeed(peerPub || 'x:none'))))); }
      catch (e) { return Promise.resolve(null); }
    }
    return self._key(peerPub)
      .then(function (k) { return subtle.decrypt({ name: 'AES-GCM', iv: b64d(env.n) }, k, b64d(env.c)); })
      .then(function (pt) { return JSON.parse(TD.decode(new Uint8Array(pt))); })
      .catch(function () { return null; });
  };

  root.PN = root.PN || {};
  root.PN.Crypt = { h32: h32, xor: xor, keystream: keystream, b64e: b64e, b64d: b64d, Box: Box, hasSubtle: !!subtle };
})(typeof globalThis !== 'undefined' ? globalThis : this);
