/* =====================================================================
 *  bignum.js —— 分层大数（Layered Number, 简称 LN）
 * ---------------------------------------------------------------------
 *  表示法（与 break_eternity 同源的三元组）：
 *      value = sign * exp10^layer(mag)
 *      即在 mag 上叠加 layer 次「10 的幂」。
 *      layer = 0 -> value = mag                （普通数）
 *      layer = 1 -> value = 10^mag             （最大约 10^9e15）
 *      layer = 2 -> value = 10^10^mag
 *      ...
 *  归一化不变量：
 *      layer > 0 时  mag ∈ [15.9546, 9.0072e15]
 *      layer = 0 时  mag ∈ [0, 9.0072e15]，符号单独存放
 *  可表示范围约到 10^^1e308（十的一亿亿…次塔，足够覆盖到「超限阶」之前的一切）。
 * ===================================================================== */
(function (g) {
  "use strict";

  var MAX_SAFE = 9007199254740991;            // 2^53 - 1
  var LOG10_MAX_SAFE = 15.954589770191003;    // log10(2^53-1)
  var LN10 = Math.LN10;

  function LN(sign, layer, mag) {
    this.sign = sign;
    this.layer = layer;
    this.mag = mag;
  }

  /* ---------------- 归一化 ---------------- */
  LN.prototype.normalize = function () {
    if (this.sign === 0 || (this.layer === 0 && this.mag === 0)) {
      this.sign = 0; this.layer = 0; this.mag = 0; return this;
    }
    if (!isFinite(this.mag)) {
      if (isNaN(this.mag)) { this.sign = 0; this.layer = 0; this.mag = 0; }
      return this;
    }
    if (this.layer === 0 && this.mag < 0) { this.sign = -this.sign; this.mag = -this.mag; }
    // 尽量下沉：layer>0 但 mag 太小 -> 直接算出来
    var guard = 0;
    while (this.layer > 0 && this.mag < LOG10_MAX_SAFE && guard++ < 8) {
      this.layer -= 1;
      this.mag = Math.pow(10, this.mag);
    }
    // 上浮：mag 溢出安全整数 -> 取对数进上一层
    guard = 0;
    while (isFinite(this.mag) && this.mag > MAX_SAFE && guard++ < 1e6) {
      this.layer += 1;
      this.mag = Math.log10(this.mag);
    }
    if (this.layer === 0 && this.mag === 0) { this.sign = 0; }
    return this;
  };

  /* ---------------- 构造 ---------------- */
  function fromNumber(n) {
    if (typeof n !== "number" || isNaN(n)) return new LN(0, 0, 0);
    if (n === 0) return new LN(0, 0, 0);
    if (!isFinite(n)) return new LN(n > 0 ? 1 : -1, 0, Infinity);
    return new LN(n < 0 ? -1 : 1, 0, Math.abs(n)).normalize();
  }

  function fromString(s) {
    if (typeof s !== "string") return fromNumber(Number(s));
    s = s.trim();
    if (s.indexOf("|") >= 0) {          // 存档格式 "sign|layer|mag"
      var p = s.split("|");
      return new LN(Number(p[0]), Number(p[1]), Number(p[2])).normalize();
    }
    var m = /^(-?)(\d+(?:\.\d+)?)\^\^(-?\d+(?:\.\d+)?)$/.exec(s);   // 10^^h
    if (m) return tetrateTen(Number(m[3]));
    var m2 = /^(-?)(\d*\.?\d+)[eE]([+-]?\d+(?:\.\d+)?)$/.exec(s);      // 支持 1e1000 这类超出 double 的字面量
    if (m2) {
      var mant = Number(m2[2]);
      if (mant === 0) return new LN(0, 0, 0);
      var v = pow10(fromNumber(Number(m2[3]) + Math.log10(mant)));
      if (m2[1] === "-") v.sign = -v.sign;
      return v;
    }
    return fromNumber(Number(s));
  }

  function D(x) {
    if (x instanceof LN) return x;
    if (typeof x === "number") return fromNumber(x);
    if (typeof x === "string") return fromString(x);
    if (x && typeof x === "object" && "sign" in x) return new LN(x.sign, x.layer, x.mag).normalize();
    return new LN(0, 0, 0);
  }

  LN.prototype.clone = function () { return new LN(this.sign, this.layer, this.mag); };
  LN.prototype.isZero = function () { return this.sign === 0; };
  LN.prototype.isFinite = function () { return isFinite(this.mag); };

  /* ---------------- 比较 ---------------- */
  LN.prototype.cmp = function (other) {
    var o = D(other);
    if (this.sign !== o.sign) return this.sign > o.sign ? 1 : -1;
    if (this.sign === 0) return 0;
    var r;
    var ai = !isFinite(this.mag), bi = !isFinite(o.mag);
    if (ai || bi) r = (ai && bi) ? 0 : (ai ? 1 : -1);
    else if (this.layer !== o.layer) r = this.layer > o.layer ? 1 : -1;
    else if (this.mag !== o.mag) r = this.mag > o.mag ? 1 : -1;
    else r = 0;
    return this.sign > 0 ? r : -r;
  };
  LN.prototype.lt = function (o) { return this.cmp(o) < 0; };
  LN.prototype.lte = function (o) { return this.cmp(o) <= 0; };
  LN.prototype.gt = function (o) { return this.cmp(o) > 0; };
  LN.prototype.gte = function (o) { return this.cmp(o) >= 0; };
  LN.prototype.eq = function (o) { return this.cmp(o) === 0; };
  LN.prototype.max = function (o) { o = D(o); return this.cmp(o) >= 0 ? this.clone() : o.clone(); };
  LN.prototype.min = function (o) { o = D(o); return this.cmp(o) <= 0 ? this.clone() : o.clone(); };
  LN.prototype.neg = function () { return new LN(-this.sign, this.layer, this.mag); };
  LN.prototype.abs = function () { return new LN(this.sign === 0 ? 0 : 1, this.layer, this.mag); };

  /* ---------------- 对数 / 指数 ---------------- */
  // log10(|x|)，返回 LN（可为负）
  LN.prototype.absLog10 = function () {
    if (this.sign === 0) return new LN(-1, 0, Infinity);
    if (this.layer === 0) return fromNumber(Math.log10(this.mag));
    return new LN(1, this.layer - 1, this.mag).normalize();
  };
  // log10(|x|) 的 JS 数值近似（超出 double 时返回 Infinity）
  LN.prototype.log10Number = function () {
    var l = this.absLog10();
    return l.toNumber();
  };
  LN.prototype.log10 = function () { return this.absLog10(); };
  LN.prototype.ln = function () { return this.absLog10().mul(LN10); };

  // 10^x
  function pow10(x) {
    x = D(x);
    if (x.sign === 0) return fromNumber(1);
    if (x.layer === 0) return new LN(1, 1, x.sign * x.mag).normalize();
    if (x.sign < 0) return new LN(0, 0, 0);           // 10^(-巨大) ≈ 0
    return new LN(1, x.layer + 1, x.mag).normalize();
  }

  /* ---------------- 四则运算 ---------------- */
  LN.prototype.add = function (other) {
    var o = D(other);
    if (this.sign === 0) return o.clone();
    if (o.sign === 0) return this.clone();
    if (this.sign !== o.sign) return this.sub(o.neg());

    var a = this, b = o;
    if (a.abs().lt(b.abs())) { var t = a; a = b; b = t; }
    var s = a.sign;
    if (a.layer === 0 && b.layer === 0) {
      return new LN(s, 0, a.mag + b.mag).normalize();
    }
    if (a.layer >= 2) return a.clone();               // 差异远小于 double 精度
    var la = a.layer === 0 ? Math.log10(a.mag) : a.mag;
    var lb = b.layer === 0 ? Math.log10(b.mag) : b.mag;
    if (la - lb > 17) return a.clone();
    var r = la + Math.log10(1 + Math.pow(10, lb - la));
    var res = new LN(1, 1, r).normalize();
    res.sign = s;
    return res.normalize();
  };

  LN.prototype.sub = function (other) {
    var o = D(other);
    if (o.sign === 0) return this.clone();
    if (this.sign === 0) return o.neg();
    if (this.sign !== o.sign) return this.add(o.neg());

    var c = this.abs().cmp(o.abs());
    if (c === 0) return new LN(0, 0, 0);
    var a = this, b = o, s = this.sign;
    if (c < 0) { a = o; b = this; s = -this.sign; }
    if (a.layer === 0 && b.layer === 0) return new LN(s, 0, a.mag - b.mag).normalize();
    if (a.layer >= 2) return a.sign === s ? a.clone() : a.neg();
    var la = a.layer === 0 ? Math.log10(a.mag) : a.mag;
    var lb = b.layer === 0 ? Math.log10(b.mag) : b.mag;
    if (la - lb > 17) { var k = a.clone(); k.sign = s; return k; }
    var inner = 1 - Math.pow(10, lb - la);
    if (inner <= 0) return new LN(0, 0, 0);
    var res = new LN(1, 1, la + Math.log10(inner)).normalize();
    res.sign = s;
    return res.normalize();
  };

  LN.prototype.mul = function (other) {
    var o = D(other);
    if (this.sign === 0 || o.sign === 0) return new LN(0, 0, 0);
    var s = this.sign * o.sign;
    if (this.layer === 0 && o.layer === 0) {
      var p = this.mag * o.mag;
      if (isFinite(p) && p <= MAX_SAFE) return new LN(s, 0, p).normalize();
    }
    var r = pow10(this.absLog10().add(o.absLog10()));
    r.sign = r.sign === 0 ? 0 : s;
    return r;
  };

  LN.prototype.div = function (other) {
    var o = D(other);
    if (o.sign === 0) return new LN(this.sign, 0, Infinity);
    if (this.sign === 0) return new LN(0, 0, 0);
    var s = this.sign * o.sign;
    if (this.layer === 0 && o.layer === 0) {
      var q = this.mag / o.mag;
      if (isFinite(q) && q <= MAX_SAFE && q >= 1e-300) return new LN(s, 0, q).normalize();
    }
    var r = pow10(this.absLog10().sub(o.absLog10()));
    r.sign = r.sign === 0 ? 0 : s;
    return r;
  };

  LN.prototype.recip = function () { return fromNumber(1).div(this); };

  // x^n （n 可为普通数或 LN；仅对 x>0 保证正确）
  LN.prototype.pow = function (n) {
    var e = D(n);
    if (e.sign === 0) return fromNumber(1);
    if (this.sign === 0) return new LN(0, 0, 0);
    if (this.layer === 0 && e.layer === 0 && this.mag < 1e15 && Math.abs(e.mag) < 1000) {
      var direct = Math.pow(this.mag, e.sign * e.mag);
      if (isFinite(direct) && direct <= MAX_SAFE && direct >= 1e-300) return new LN(1, 0, direct).normalize();
    }
    return pow10(this.absLog10().mul(e));
  };
  LN.prototype.root = function (n) { return this.pow(fromNumber(1).div(D(n))); };
  LN.prototype.sqrt = function () { return this.pow(0.5); };

  LN.prototype.toNumber = function () {
    if (this.sign === 0) return 0;
    if (this.layer === 0) return this.sign * this.mag;
    if (this.layer === 1) return this.sign * Math.pow(10, this.mag);
    return this.sign * Infinity;
  };

  /* ---------------- 超对数 / 迭代幂次 ---------------- */
  // slog10：满足 10^^s = x 的 s（区间 [1,10) 内用 log10 线性插值）
  LN.prototype.slog = function () {
    if (this.sign <= 0) return 0;
    var s = this.layer, m = this.mag, guard = 0;
    while (m >= 10 && guard++ < 6) { m = Math.log10(m); s += 1; }
    if (m < 1) return Math.max(0, s + m - 1);
    return s + Math.log10(m);
  };

  // 10^^h（h 可为小数、可大到 1e308）
  function tetrateTen(h) {
    if (typeof h !== "number") h = D(h).toNumber();
    if (!isFinite(h)) return new LN(1, 0, Infinity);
    if (h <= 0) return fromNumber(1);
    var layer = Math.floor(h);
    var frac = h - layer;
    return new LN(1, layer, Math.pow(10, frac)).normalize();
  }

  /* ---------------- 序列化 ---------------- */
  LN.prototype.toJSONString = function () { return this.sign + "|" + this.layer + "|" + this.mag; };

  /* =====================================================================
   *  记号格式化
   * ===================================================================== */
  var SMALL_NAMES = null;

  function commas(n) {
    var s = Math.floor(n).toString();
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function fixed(n, p) {
    var s = n.toFixed(p);
    if (p > 0) s = s.replace(/\.?0+$/, "");
    return s;
  }

  // 主格式化：notation = "sci" | "tower" | "mixed"(默认)
  function format(x, places) {
    x = D(x);
    places = places === undefined ? 2 : places;
    if (x.sign === 0) return "0";
    if (!isFinite(x.mag)) return (x.sign < 0 ? "-" : "") + "∞";
    var prefix = x.sign < 0 ? "-" : "";

    if (x.layer === 0) {
      var m = x.mag;
      if (m < 0.001) return prefix + m.toExponential(places).replace("e", "e");
      if (m < 1000) return prefix + fixed(m, m < 10 ? places : (m < 100 ? Math.max(1, places - 1) : 0));
      if (m < 1e6) return prefix + commas(m);
      return prefix + sciFromLog(Math.log10(m), places);
    }
    var slog = x.slog();
    if (slog >= 9) {                                  // 高得看不出层数了，用塔记号
      return prefix + "10^^" + format(fromNumber(slog), 3);
    }
    if (x.layer === 1) return prefix + sciFromLog(x.mag, places);
    // layer >= 2：e 叠加记号，例如 ee1234 表示 10^10^1234
    var chain = "";
    for (var i = 0; i < x.layer - 1; i++) chain += "e";
    return prefix + chain + sciFromLog(x.mag, places);
  }

  function sciFromLog(logv, places) {
    if (logv < 1e6) {
      var e = Math.floor(logv);
      var mant = Math.pow(10, logv - e);
      if (mant >= 9.9995) { mant /= 10; e += 1; }
      return mant.toFixed(places) + "e" + commas(e);
    }
    // 指数本身太大 -> 递归成 e1.23e45
    return "e" + format(fromNumber(logv), places);
  }

  // 速率显示（每秒）
  function formatRate(x, places) { return format(x, places) + "/s"; }

  // 时间显示
  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return "∞";
    if (sec < 1) return sec.toFixed(2) + " 秒";
    if (sec < 60) return sec.toFixed(1) + " 秒";
    if (sec < 3600) return Math.floor(sec / 60) + " 分 " + Math.floor(sec % 60) + " 秒";
    if (sec < 86400) return Math.floor(sec / 3600) + " 时 " + Math.floor((sec % 3600) / 60) + " 分";
    if (sec < 86400 * 365) return Math.floor(sec / 86400) + " 天 " + Math.floor((sec % 86400) / 3600) + " 时";
    var y = sec / (86400 * 365);
    if (y < 1e6) return format(fromNumber(y), 2) + " 年";
    return format(fromNumber(y), 2) + " 年";
  }

  // 把「塔高 h」翻译成人话
  function describeTower(h) {
    if (h < 1) return "尚未成塔";
    if (h < 2) return "10 的普通幂次";
    if (h < 3) return "10^10^… 二层塔";
    return "高度约 " + format(fromNumber(h), 3) + " 的十次幂塔";
  }

  LN.fromNumber = fromNumber;
  LN.fromString = fromString;
  LN.pow10 = pow10;
  LN.tetrateTen = tetrateTen;
  LN.ZERO = function () { return new LN(0, 0, 0); };
  LN.ONE = function () { return fromNumber(1); };

  g.LN = LN;
  g.D = D;
  g.BN = {
    LN: LN, D: D, pow10: pow10, tetrateTen: tetrateTen,
    format: format, formatRate: formatRate, formatTime: formatTime,
    describeTower: describeTower, commas: commas,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = g.BN;
})(typeof globalThis !== "undefined" ? globalThis : this);
