/* ===== 词库（构建时由 build.mjs 注入，测试可替换） ===== */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};
  PN.BANKS = PN.BANKS || {};
  // 构建时注入（单文件内联）；无注入时留空
  var injected = (typeof window !== 'undefined' && window.__PN_BANKS__) || (root.__PN_BANKS__);
  if (injected) { PN.BANKS.undercover = injected.undercover || PN.BANKS.undercover; PN.BANKS.wavelength = injected.wavelength || PN.BANKS.wavelength; PN.BANKS.mostlikely = injected.mostlikely || PN.BANKS.mostlikely; PN.BANKS.draw = injected.draw || PN.BANKS.draw; }
  PN.Banks = {
    undercoverPairs: function () { return (PN.BANKS.undercover && PN.BANKS.undercover.pairs) || []; },
    spectrums: function () { return (PN.BANKS.wavelength && PN.BANKS.wavelength.spectrums) || []; },
    prompts: function () { return (PN.BANKS.mostlikely && PN.BANKS.mostlikely.prompts) || []; },
    words: function () { return (PN.BANKS.draw && PN.BANKS.draw.words) || []; }
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
    undercoverPair: function (used) {
      var pool = PN.Banks.undercoverPairs();
      if (used && used.length) {
        var seen = {};
        for (var i = 0; i < used.length; i++) seen[used[i]] = true;
        pool = pool.filter(function (p) { return !seen[p.a + '|' + p.b]; });
      }
      if (!pool.length) pool = PN.Banks.undercoverPairs();
      return pool[rnd(pool.length)];
    },
    spectrum: function (used) {
      var pool = PN.Banks.spectrums();
      if (used && used.length) {
        var seen = {};
        for (var i = 0; i < used.length; i++) seen[used[i]] = true;
        pool = pool.filter(function (s) { return !seen[s.left + '|' + s.right]; });
      }
      if (!pool.length) pool = PN.Banks.spectrums();
      return pool[rnd(pool.length)];
    },
    prompt: function (used) {
      var pool = PN.Banks.prompts();
      if (used && used.length) {
        var seen = {};
        for (var i = 0; i < used.length; i++) seen[used[i]] = true;
        pool = pool.filter(function (p) { return !seen[p]; });
      }
      if (!pool.length) pool = PN.Banks.prompts();
      return pool[rnd(pool.length)];
    },
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
