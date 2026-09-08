/* ===== 应用入口 ===== */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  function boot() {
    var ui = new PN.UI();
    PN.app = ui;
    ui.renderLand();
    var wrapErr = function (e) {
      console.error(e);
      document.getElementById('pn-root').innerHTML =
        '<div class="land"><div class="biglogo">🛠️</div><h1>启动失败</h1>' +
        '<div class="sub">' + (e && e.message ? e.message : '未知错误') + '（刷新重试）</div></div>';
    };
    window.addEventListener('error', function (e) {
      // 只在致命阶段兜底，不打扰游戏内小错
      if (!PN.app || !PN.app.room) wrapErr(e.error || e);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
