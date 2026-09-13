/* ===== 应用入口 ===== */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  /* ===== 迭代机制（阶段四）：版本对账 + 更新提示 =====
   * build 会把版本号写进产物（PN.VERSION / meta）并在根目录与 dist 生成 version.json。
   * 打开页面、以及切回前台时对一下：线上版本更新了就提示刷新（GitHub Pages 有缓存，
   * 不刷新拿不到新产物）。拿不到 version.json（比如离线、或只开 dist 里的文件）就静默跳过。 */
  var lastCheck = 0;
  function checkVersion(force) {
    if (typeof fetch !== 'function' || !PN.VERSION) return;
    var now = Date.now();
    if (!force && now - lastCheck < 60000) return;   // 一分钟最多查一次
    lastCheck = now;
    fetch('version.json?t=' + now, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.version || j.version === PN.VERSION) return;
        if (document.getElementById('pn-update')) return;
        var el = document.createElement('div');
        el.id = 'pn-update';
        el.className = 'update-tip';
        el.innerHTML = '<span>🎁 有新版本 <b>' + j.version + '</b>（你在用 ' + PN.VERSION + '）' +
          (j.builtAt ? ' · ' + String(j.builtAt).slice(5, 16).replace('T', ' ') : '') + '</span>' +
          '<button class="btn sm primary" id="pn-update-go">刷新看看</button>';
        document.body.appendChild(el);
        document.getElementById('pn-update-go').addEventListener('click', function () { location.reload(); });
      })
      .catch(function () {});                        // 静默失败：更新提示不该影响正常玩
  }
  PN.checkVersion = checkVersion;

  function boot() {
    var ui = new PN.UI();
    PN.app = ui;
    ui.renderLand();
    checkVersion(true);
    if (typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) checkVersion(false);   // 切回前台时顺手看一眼
      });
    }
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
