/* ===== 游戏屏通用组件 + 谁最有可能屏幕 ===== */
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

  /* ================= 谁最有可能 ================= */
  PN.screens = PN.screens || {};
  PN.screens.mostlikely = {
    name: 'mostlikely',
    render: function (state, secret) {
      var ui = this;
      var C = PN.gameCommon;
      var g = state.g || {};
      var wrap = ui.el('div');
      ui.renderTopbar(wrap);
      var total = (g.settings && g.settings.rounds) || 8;
      wrap.appendChild(ui.h(C.gameHeader(ui, state, '🎯 谁最有可能', state.phase === 'vote' ? '投票中' : (state.phase === 'reveal' ? '答案揭晓' : '本局结束'),
        g.cur && g.cur.deadline ? C.deadlineChip(g.cur.deadline) : '<span class="pill">' + (g.round || 0) + '/' + total + '</span>')));

      var body = ui.el('div');
      if (state.phase === 'vote' && g.cur) {
        body.appendChild(ui.h(
          '<div class="card center"><div class="muted" style="margin-bottom:6px">谁最有可能——</div>' +
          '<div style="font-size:21px;font-weight:800;line-height:1.4">' + esc(g.cur.q) + '</div>' +
          '<div class="muted mt8">点人头投票 · 可改票 · 可投自己 · 截止自动开奖</div></div>'
        ));
        var votes = g.cur.votes || {};
        var myVote = votes[ui.pid()];
        var sel = {}; if (myVote) sel[myVote] = true;
        var counts = {};
        for (var vk in votes) if (Object.prototype.hasOwnProperty.call(votes, vk)) counts[votes[vk]] = (counts[votes[vk]] || 0) + 1;
        body.appendChild(ui.h('<div class="card"><div class="muted" style="margin-bottom:10px">已投 ' + Object.keys(votes).length + ' 人（共 ' + state.players.filter(function (p) { return p.online; }).length + ' 在线）</div>' +
          C.playerGrid(ui, state, { sel: sel, showVotes: counts }) + '</div>'));
        body.querySelectorAll('[data-pick]').forEach(function (b) {
          b.addEventListener('click', function () {
            ui.send({ t: 'vote', id: b.getAttribute('data-pick') });
            b.classList.add('sel');
          });
        });
      } else if (state.phase === 'reveal' && g.last) {
        var winners = {};
        (g.last.winners || []).forEach(function (w) { winners[w] = true; });
        var maxV = g.last.maxVotes || 0;
        body.appendChild(ui.h(
          '<div class="card center"><div class="muted">公布答案</div>' +
          '<div style="font-size:18px;font-weight:800;margin:8px 0">' + esc(g.last.q || '') + '</div>' +
          (maxV > 0 ? '<div style="font-size:15px">最高 ' + maxV + ' 票 🎉</div>' : '<div class="muted">没人被投中，各自安好</div>') +
          '</div>'
        ));
        body.appendChild(ui.h('<div class="card">' + C.playerGrid(ui, state, { sel: winners, showVotes: g.last.counts }) + '</div>'));
        body.appendChild(ui.h('<div class="muted center mt8">3 秒后自动下一题…</div>'));
      } else {
        body.appendChild(ui.h(C.scoreboard(state, g.winner)));
        var btns = ui.h(C.overButtons(ui, 'mostlikely'));
        body.appendChild(btns);
        wireOver(btns, ui);
      }
      if (state.phase !== 'over') wrap.appendChild(ui.renderGameFooter()); // 进行中也能回大厅
      wrap.appendChild(body);
      return wrap;
    }
  };

  function wireOver(btns, ui) {
    btns.querySelectorAll('[data-over]').forEach(function (b) {
      b.addEventListener('click', function () { ui.send({ t: b.getAttribute('data-over') }); });
    });
  }
  PN.wireOver = wireOver;
})(typeof globalThis !== 'undefined' ? globalThis : this);
