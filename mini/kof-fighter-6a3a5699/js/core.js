/* core.js — 数学/几何/输入 */
window.G = window.G || {};
(function (G) {
  'use strict';
  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sgn(v) { return v < 0 ? -1 : v > 0 ? 1 : 0; }
  function approach(v, t, s) { return v < t ? Math.min(v + s, t) : Math.max(v - s, t); }
  function rnd(a, b) { if (b === undefined) { b = a; a = 0; } return a + Math.random() * (b - a); }
  function rndi(a, b) { return Math.floor(rnd(a, b + 1)); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function chance(p) { return Math.random() < p; }
  function len(x, y) { return Math.sqrt(x * x + y * y); }
  function dist(x1, y1, x2, y2) { return len(x2 - x1, y2 - y1); }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function easeOut(t) { return 1 - (1 - t) * (1 - t); }
  function easeIn(t) { return t * t; }
  function easeOutCubic(t) { var u = 1 - t; return 1 - u * u * u; }
  function easeInOut(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  var EASE = { lin: function (t) { return t; }, in: easeIn, out: easeOut, io: easeInOut, oc: easeOutCubic, sm: smooth,
    snap: function (t) { return t <= 0 ? 0 : 1; } };

  /* 线段最近点：返回 A 上最近点 p、B 上最近点 q 与距离 */
  function segSeg(ax, ay, bx, by, cx, cy, dx, dy) {
    var ux = bx - ax, uy = by - ay, vx = dx - cx, vy = dy - cy, wx = ax - cx, wy = ay - cy;
    var a = ux * ux + uy * uy, b = ux * vx + uy * vy, c = vx * vx + vy * vy;
    var d = ux * wx + uy * wy, e = vx * wx + vy * wy, D = a * c - b * b, s, t;
    if (D < 1e-8) { s = 0; t = (b > c ? d / b : e / c); }
    else { s = (b * e - c * d) / D; t = (a * e - b * d) / D; }
    s = clamp(s, 0, 1); t = clamp(t, 0, 1);
    // 用固定 s 重新求 t，再反求 s（一次迭代足够稳定）
    t = clamp((b * s + e) / (c || 1), 0, 1);
    s = clamp((b * t - d) / (a || 1), 0, 1);
    var px = ax + ux * s, py = ay + uy * s, qx = cx + vx * t, qy = cy + vy * t;
    return { px: px, py: py, qx: qx, qy: qy, d: dist(px, py, qx, qy) };
  }
  /* 胶囊体（线段+半径）相交：返回接触点（两表面之间按半径加权，视觉最准） */
  function capsHit(A, B) {
    var r = segSeg(A.x1, A.y1, A.x2, A.y2, B.x1, B.y1, B.x2, B.y2);
    var rr = A.r + B.r;
    if (r.d >= rr) return null;
    var k = rr > 0 ? A.r / rr : .5;
    var nx = r.qx - r.px, ny = r.qy - r.py, l = len(nx, ny) || 1;
    return { x: r.px + nx * k, y: r.py + ny * k, depth: rr - r.d, nx: nx / l, ny: ny / l,
      px: r.px, py: r.py, qx: r.qx, qy: r.qy };
  }
  function boxOverlap(a, b) {
    return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  }
  G.M = { TAU: TAU, clamp: clamp, lerp: lerp, sgn: sgn, approach: approach, rnd: rnd, rndi: rndi,
    pick: pick, chance: chance, len: len, dist: dist, EASE: EASE, segSeg: segSeg, capsHit: capsHit,
    boxOverlap: boxOverlap, smooth: smooth };

  /* ---------------- 输入 ---------------- */
  var MOT = {
    qcf:  [{ d: [2], o: 0 }, { d: [3], o: 1 }, { d: [6], o: 0 }],
    qcb:  [{ d: [2], o: 0 }, { d: [1], o: 1 }, { d: [4], o: 0 }],
    dp:   [{ d: [6], o: 0 }, { d: [2], o: 0 }, { d: [3, 6], o: 0 }],
    hcb:  [{ d: [6], o: 0 }, { d: [3], o: 1 }, { d: [2], o: 0 }, { d: [1], o: 1 }, { d: [4], o: 0 }],
    dqcf: [{ d: [2], o: 0 }, { d: [6], o: 0 }, { d: [2], o: 0 }, { d: [3], o: 1 }, { d: [6], o: 0 }],
    dqcb: [{ d: [2], o: 0 }, { d: [4], o: 0 }, { d: [2], o: 0 }, { d: [1], o: 1 }, { d: [4], o: 0 }]
  };
  var MIRROR = { 1: 3, 2: 2, 3: 1, 4: 6, 5: 5, 6: 4, 7: 9, 8: 8, 9: 7 };
  var DEFAULT_MAPS = [
    { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
      A: ['KeyJ'], B: ['KeyK'], C: ['KeyU'], D: ['KeyI'], start: ['Enter'] },
    { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
      A: ['Numpad1', 'Comma'], B: ['Numpad2', 'Period'], C: ['Numpad4', 'Semicolon'], D: ['Numpad5', 'Quote'],
      start: ['NumpadEnter'] }
  ];

  function Pad(index) {
    this.index = index; this.map = DEFAULT_MAPS[index];
    this.dir = 5; this.pdir = 5; this.f = 0;
    this.held = { A: 0, B: 0, C: 0, D: 0, start: 0 };
    this.prev = { A: 0, B: 0, C: 0, D: 0, start: 0 };
    this.hist = []; this.btnHist = []; this.gamepad = -1; this.enabled = true;
  }
  Pad.prototype.read = function (raw, gp) {
    this.f++;
    var m = this.map, u = key(raw, m.up), d = key(raw, m.down), l = key(raw, m.left), r = key(raw, m.right);
    if (gp) {
      var ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, b = gp.buttons;
      if (ax < -.4 || bt(b, 14)) l = 1; if (ax > .4 || bt(b, 15)) r = 1;
      if (ay < -.4 || bt(b, 12)) u = 1; if (ay > .4 || bt(b, 13)) d = 1;
    }
    var h = 5;
    if (l && !r) h -= 1; if (r && !l) h += 1;
    if (u && !d) h += 3; if (d && !u) h -= 3;
    this.pdir = this.dir; this.dir = h;
    if (h !== this.pdir) { this.hist.push({ dir: h, f: this.f }); if (this.hist.length > 26) this.hist.shift(); }
    var self = this;
    ['A', 'B', 'C', 'D', 'start'].forEach(function (k, i) {
      self.prev[k] = self.held[k];
      var v = key(raw, m[k]);
      if (gp && i < 4) { var order = [2, 0, 3, 1]; if (bt(gp.buttons, order[i])) v = 1; }
      if (gp && k === 'start' && bt(gp.buttons, 9)) v = 1;
      self.held[k] = v;
      if (v && !self.prev[k]) { self.btnHist.push({ b: k, f: self.f }); if (self.btnHist.length > 14) self.btnHist.shift(); }
    });
    function key(raw, list) { if (!list) return 0; for (var i = 0; i < list.length; i++) if (raw[list[i]]) return 1; return 0; }
    function bt(b, i) { return b && b[i] && b[i].pressed; }
  };
  Pad.prototype.down = function (b) { return !!this.held[b]; };
  Pad.prototype.hit = function (b) { return !!this.held[b] && !this.prev[b]; };
  /* 同时按（3 帧容错） */
  Pad.prototype.hit2 = function (b1, b2) {
    var f1 = -99, f2 = -99;
    for (var i = this.btnHist.length - 1; i >= 0; i--) {
      var e = this.btnHist[i];
      if (e.b === b1 && f1 < 0) f1 = e.f;
      if (e.b === b2 && f2 < 0) f2 = e.f;
    }
    if (f1 < 0 || f2 < 0) return false;
    return Math.abs(f1 - f2) <= 3 && Math.max(f1, f2) >= this.f - 1;
  };
  Pad.prototype.rel = function (facing) { return facing < 0 ? MIRROR[this.dir] : this.dir; };
  /* 指令输入识别：pat 为 MOT 键名 */
  Pad.prototype.motion = function (name, span, facing) {
    var pat = MOT[name]; if (!pat) return false;
    span = span || 24;
    var seq = [], i, e;
    for (i = 0; i < this.hist.length; i++) {
      e = this.hist[i];
      if (this.f - e.f <= span) seq.push({ d: facing < 0 ? MIRROR[e.dir] : e.dir, f: e.f });
    }
    seq.push({ d: this.rel(facing), f: this.f });
    var idx = 0, lastF = -1;
    for (var p = 0; p < pat.length; p++) {
      var found = -1;
      for (var j = idx; j < seq.length; j++) { if (pat[p].d.indexOf(seq[j].d) >= 0) { found = j; break; } }
      if (found < 0) { if (pat[p].o) continue; return false; }
      idx = found + 1; lastF = seq[found].f;
    }
    return this.f - lastF <= 11;
  };
  Pad.prototype.clearMotion = function () { this.hist.length = 0; };

  var raw = {}, globalEdge = {}, gpIndex = [0, 1];
  G.Input = {
    pads: [new Pad(0), new Pad(1)],
    raw: raw,
    init: function () {
      if (typeof window === 'undefined' || !window.addEventListener) return;
      window.addEventListener('keydown', function (e) {
        if (raw[e.code] !== 1) globalEdge[e.code] = 1;
        raw[e.code] = 1;
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab', 'F1', 'F2', 'F3'].indexOf(e.code) >= 0) e.preventDefault();
      });
      window.addEventListener('keyup', function (e) { raw[e.code] = 0; });
      window.addEventListener('blur', function () { for (var k in raw) raw[k] = 0; });
    },
    update: function () {
      var gps = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : [];
      for (var i = 0; i < 2; i++) this.pads[i].read(raw, gps && gps[gpIndex[i]] ? gps[gpIndex[i]] : null);
    },
    endFrame: function () { globalEdge = {}; G.Input.edge = globalEdge; },
    /* 全局键沿（菜单/调试用） */
    tap: function (code) { return !!globalEdge[code]; },
    setRaw: function (code, v) { if (v) { if (raw[code] !== 1) globalEdge[code] = 1; raw[code] = 1; } else raw[code] = 0; },
    rumble: function (playerIdx, strong, dur) {
      try {
        var gps = navigator.getGamepads ? navigator.getGamepads() : [];
        var gp = gps[gpIndex[playerIdx]];
        if (gp && gp.vibrationActuator) gp.vibrationActuator.playEffect('dual-rumble',
          { duration: dur || 90, strongMagnitude: strong, weakMagnitude: strong * .6 });
      } catch (e) { }
    }
  };
  G.Input.edge = globalEdge;
})(window.G);
