/* main.js — 启动 */
(function (G) {
  'use strict';
  function boot() {
    var cv = document.getElementById('game');
    G.Game.init(cv);
    var kick = function () { G.Audio.init(); G.Audio.resume(); window.removeEventListener('pointerdown', kick); };
    window.addEventListener('pointerdown', kick);
    requestAnimationFrame(function (n) { G.Game.loop(n); });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
  G.boot = boot;
})(window.G);
