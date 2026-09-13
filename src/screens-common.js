/* ===== 游戏屏通用组件（头部/玩家宫格/积分榜/结束按钮） ===== */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  PN.esc = esc;

  function gameHeader(ui, state, title, phaseText, extra) {
    var g = state.g || {};
    var roundText = g.round ? ('第 ' + g.round + ' 回合') : '';
    return '<div class="ghead">' +
      '<div class="gh-title">' + esc(title) + '</div>' +
      '<div class="row" style="gap:6px">' +
      (roundText ? '<span class="pill">' + roundText + '</span>' : '') +
      (phaseText ? '<span class="pill">' + esc(phaseText) + '</span>' : '') +
      (extra || '') +
      '</div></div>';
  }

  function deadlineChip(deadline) {
    return '<span class="pill timer" data-deadline="' + deadline + '">' + fmtLeft(deadline - Date.now()) + '</span>';
  }
  function fmtLeft(ms) {
    if (ms < 0) ms = 0;
    var s = Math.ceil(ms / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function playerGrid(ui, state, opts) {
    opts = opts || {};
    var dead = opts.dead || {};
    var sel = opts.sel;
    var disabled = opts.disabled || false;
    var players = state.players || [];
    var out = '<div class="players-grid">';
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      var cls = 'pickable';
      if (dead[p.id]) cls += ' dead';
      if (sel && sel[p.id]) cls += ' sel';
      out += '<button class="' + cls + '" data-pick="' + p.id + '" ' + ((disabled && !opts.allowSelf) || !p.online ? 'disabled' : '') + '>' +
        '<span class="em">' + (p.emoji || '🙂') + '</span>' +
        '<span>' + esc(p.name) + '</span>' +
        (opts.showVotes ? '<span class="muted" style="font-size:11px">' + (opts.showVotes[p.id] || 0) + ' 票</span>' : '') +
        '</button>';
    }
    return out + '</div>';
  }

  function scoreboard(state, winnerId, title) {
    var players = (state.players || []).slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    var out = '<div class="card"><div class="center" style="font-weight:800;margin-bottom:10px">' + (title || '🏆 终局计分') + '</div><div class="scoreboard">';
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      out += '<div class="sbrow' + (i === 0 ? ' top' : '') + '">' +
        '<span class="rank">' + (i + 1) + '</span><span class="em">' + (p.emoji || '🙂') + '</span>' +
        '<span class="nm">' + esc(p.name) + (p.id === winnerId ? ' 👑' : '') + '</span>' +
        '<span class="pts">' + (p.score || 0) + ' 分</span></div>';
    }
    return out + '</div></div>';
  }

  function overButtons(ui, gameId) {
    if (!ui.isHost()) {
      return '<div class="muted center mt16">等房主决定再来一局还是换游戏～</div>';
    }
    return '<div class="grid2 mt16"><button class="btn primary" data-over="again">🔁 再来一局</button>' +
      '<button class="btn ghost" data-over="lobby">🏠 回大厅</button></div>';
  }

  PN.gameCommon = {
    gameHeader: gameHeader, deadlineChip: deadlineChip, fmtLeft: fmtLeft,
    playerGrid: playerGrid, scoreboard: scoreboard, overButtons: overButtons
  };

  /* 全局 1s 倒计时刷新（只动计时 chip，不整页重渲） */
  if (typeof document !== 'undefined' && typeof setInterval === 'function') {
    setInterval(function () {
      document.querySelectorAll('[data-deadline]').forEach(function (el) {
        var dl = Number(el.getAttribute('data-deadline'));
        if (isNaN(dl)) return;
        el.textContent = fmtLeft(dl - Date.now());
        if (dl - Date.now() < 10000) el.style.color = 'var(--acc2)';
      });
    }, 500);
  }

  PN.screens = PN.screens || {};

  function wireOver(btns, ui) {
    btns.querySelectorAll('[data-over]').forEach(function (b) {
      b.addEventListener('click', function () { ui.send({ t: b.getAttribute('data-over') }); });
    });
  }
  PN.wireOver = wireOver;
})(typeof globalThis !== 'undefined' ? globalThis : this);
