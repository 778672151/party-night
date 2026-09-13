/* ===== 词库（构建时由 build.mjs 注入，测试可替换） ===== */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};
  PN.BANKS = PN.BANKS || {};
  // 构建时注入（单文件内联）；无注入时留空
  var injected = (typeof window !== 'undefined' && window.__PN_BANKS__) || (root.__PN_BANKS__);
  if (injected && injected.draw) PN.BANKS.draw = injected.draw;
  if (injected && injected.tacit) PN.BANKS.tacit = injected.tacit;
  if (injected && injected.memory) PN.BANKS.memory = injected.memory;
  if (injected && injected.codraw) PN.BANKS.codraw = injected.codraw;
  PN.Banks = {
    words: function () { return (PN.BANKS.draw && PN.BANKS.draw.words) || []; },
    questions: function () { return (PN.BANKS.tacit && PN.BANKS.tacit.questions) || []; }
  };
  function rnd(n) { return Math.floor(Math.random() * n); }
  function sample(arr, n, exclude) {
    var pool = arr.slice();
    if (exclude && exclude.length) {
      var seen = {};
      for (var i = 0; i < exclude.length; i++) seen[exclude[i]] = true;
      pool = pool.filter(function (x) { return !seen[x]; });
    }
    var out = [], idx;
    if (n >= pool.length) return pool.slice();
    while (out.length < n && pool.length) {
      idx = rnd(pool.length);
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }
  PN.pick = {
    rnd: rnd,
    sample: sample,
    /** 随机抽 n 个词（排除已用过的） */
    drawWords: function (used, n) {
      var pool = PN.Banks.words();
      if (used && used.length) {
        var seen = {};
        for (var i = 0; i < used.length; i++) seen[used[i]] = true;
        pool = pool.filter(function (w) { return !seen[w.w]; });
      }
      return sample(pool, n || 3).map(function (w) { return w.w; });
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
