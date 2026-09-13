/* ===== 五子棋 屏幕 =====
 * 画布渲染移植自 deepdemos.top《实时胜率五子棋》的 ui 脚本（fit/px/draw/stone/cellFromEvent 的思路），
 * 但配色与质感换成本项目的 Q 弹可爱风：奶油底、糖果色描边、圆角、落点带粉色提示环、连五处高亮。
 * 状态全部来自房主广播的 state，客户端只负责画和把手势换算成 (x,y)。 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};
  var esc = PN.esc;

  var CB = '#6b5588';        // 黑子（用我们的描边紫，比纯黑柔和）
  var CW = '#ffffff';        // 白子
  var local = { cv: null, hover: null, ui: null };

  function starPoints(n) {
    if (n === 9) return [[2, 2], [6, 2], [2, 6], [6, 6], [4, 4]];
    if (n === 13) return [[3, 3], [9, 3], [3, 9], [9, 9], [6, 6]];
    return [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]];
  }

  /** 按元素真实尺寸设置后备缓冲区（和 canvas-ink 同一套 DPR 处理） */
  function ensureSize(cv) {
    var r = cv.getBoundingClientRect();
    if (!r.width || r.width < 20) return null;
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    var L = Math.floor(r.width);
    var W = Math.floor(L * dpr);
    if (cv.width !== W || cv.height !== W) { cv.width = W; cv.height = W; }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, L: L, pad: Math.round(L * 0.055), step: (L - Math.round(L * 0.055) * 2) / (cv.dataset.n - 1) };
  }

  function draw(cv, g, myColor) {
    var m = ensureSize(cv);
    if (!m) return;
    var ctx = m.ctx, L = m.L, pad = m.pad, step = m.step, n = Number(cv.dataset.n);
    var px = function (i) { return pad + i * step; };

    // 棋盘底：奶油渐变 + 圆角
    var rad = Math.min(22, L * 0.06);
    ctx.clearRect(0, 0, L, L);
    var bg = ctx.createLinearGradient(0, 0, L, L);
    bg.addColorStop(0, '#fffaf2'); bg.addColorStop(0.5, '#fff3e3'); bg.addColorStop(1, '#ffe9d6');
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, L, L, rad); else ctx.rect(0, 0, L, L);
    ctx.fillStyle = bg; ctx.fill();

    // 网格
    ctx.strokeStyle = 'rgba(107,85,136,.42)';
    ctx.lineWidth = Math.max(1, step * 0.028);
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      ctx.moveTo(px(0), px(i)); ctx.lineTo(px(n - 1), px(i));
      ctx.moveTo(px(i), px(0)); ctx.lineTo(px(i), px(n - 1));
    }
    ctx.stroke();
    ctx.lineWidth = Math.max(1.5, step * 0.05);
    ctx.strokeRect(px(0), px(0), step * (n - 1), step * (n - 1));

    // 星位
    ctx.fillStyle = 'rgba(107,85,136,.62)';
    starPoints(n).forEach(function (s) {
      ctx.beginPath(); ctx.arc(px(s[0]), px(s[1]), Math.max(1.8, step * 0.075), 0, 6.2832); ctx.fill();
    });

    // 悬停提示（鼠标端）
    if (local.hover !== null && local.hover >= 0 && g.phase === 'play' && !g.board[local.hover]) {
      var hx = local.hover % n, hy = Math.floor(local.hover / n);
      ctx.beginPath(); ctx.arc(px(hx), px(hy), step * 0.4, 0, 6.2832);
      ctx.fillStyle = 'rgba(255,143,184,.25)'; ctx.fill();
    }

    // 棋子
    var R = step * 0.42;
    for (var k = 0; k < g.board.length; k++) {
      var v = g.board[k];
      if (!v) continue;
      var cx = px(k % n), cy = px(Math.floor(k / n));
      var gr = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.15, cx, cy, R);
      if (v === 1) { gr.addColorStop(0, '#8d7bab'); gr.addColorStop(1, CB); }
      else { gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#e9e3f2'); }
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832);
      ctx.fillStyle = gr; ctx.fill();
      ctx.lineWidth = Math.max(1, step * 0.03);
      ctx.strokeStyle = v === 1 ? 'rgba(60,40,80,.55)' : 'rgba(107,85,136,.35)';
      ctx.stroke();
    }

    // 最后一手：粉色提示环
    if (g.last && g.phase === 'play') {
      ctx.beginPath(); ctx.arc(px(g.last.x), px(g.last.y), R * 1.22, 0, 6.2832);
      ctx.lineWidth = Math.max(2, step * 0.055); ctx.strokeStyle = '#ff8fb8'; ctx.stroke();
    }

    // 连五：把获胜的那串连起来
    if (g.winCells && g.winCells.length >= 5) {
      var a = g.winCells[0], b = g.winCells[g.winCells.length - 1];
      ctx.beginPath();
      ctx.moveTo(px(a[0]), px(a[1])); ctx.lineTo(px(b[0]), px(b[1]));
      ctx.lineWidth = Math.max(4, step * 0.14);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,143,184,.85)';
      ctx.stroke();
    }
  }

  function cellFrom(cv, g, clientX, clientY) {
    var r = cv.getBoundingClientRect();
    if (!r.width) return -1;
    var pad = Math.round(r.width * 0.055);
    var step = (r.width - pad * 2) / (g.n - 1);
    var x = Math.round((clientX - r.left - pad) / step);
    var y = Math.round((clientY - r.top - pad) / step);
    if (x < 0 || y < 0 || x >= g.n || y >= g.n) return -1;
    return y * g.n + x;
  }

  function bind(cv, ui, g, myTurn) {
    local.ui = ui; local.cv = cv;
    cv.addEventListener('pointermove', function (e) {
      var i = cellFrom(cv, g, e.clientX, e.clientY);
      if (i !== local.hover) { local.hover = i; draw(cv, ui.state.g, null); }
    });
    cv.addEventListener('pointerleave', function () { local.hover = null; draw(cv, ui.state.g, null); });
    cv.addEventListener('click', function (e) {
      var st = ui.state;
      if (!st || st.g.phase !== 'play' || st.g.pending) return;
      if (!myTurn()) return;
      var i = cellFrom(cv, st.g, e.clientX, e.clientY);
      if (i < 0 || st.g.board[i]) return;
      ui.send({ t: 'place', x: i % st.g.n, y: Math.floor(i / st.g.n) });
    });
  }

  PN.screens = PN.screens || {};
  PN.screens.gomoku = {
    name: 'gomoku',
    render: function (state, secret) {
      var ui = this;
      var C = PN.gameCommon;
      var g = state.g || {};
      var me = ui.pid();
      var myColor = (g.players && g.players[0] === me) ? 1 : 2;
      var myTurn = function () { return g.phase === 'play' && !g.pending && g.turn === myColor; };
      var wrap = ui.el('div');
      ui.renderTopbar(wrap);

      var opp = (g.players || []).filter(function (id) { return id !== me; })[0];
      var oppP = opp ? ui.p(opp) : null;
      var phaseText = g.phase === 'over' ? '本局结束' : (myTurn() ? '轮到你' : '等对方');
      wrap.appendChild(ui.h(C.gameHeader(ui, state, '⚫ 五子棋',
        (myColor === 1 ? '你执黑先手' : '你执白后手') + ' · ' + phaseText,
        '<span class="pill">第 ' + ((g.moves || []).length + 1) + ' 手</span>')));

      var body = ui.el('div');

      if (g.phase === 'over') {
        var winName = '';
        if (g.winner) {
          var winPid = (g.players[0] && ((g.players[0] === me) === (g.winner === myColor))) ? me : opp;
          winName = winPid === me ? '你赢了！🎉' : ((oppP ? oppP.name : '对方') + ' 赢了');
        } else winName = '平局～';
        body.appendChild(ui.h('<div class="card center gm-hero"><div class="gm-result">' + esc(winName) + '</div>' +
          '<div class="muted mt8">一共 ' + ((g.moves || []).length) + ' 手' + (g.winner === myColor ? ' · 漂亮！' : '') + '</div></div>'));
        body.appendChild(ui.h(C.scoreboard(state, undefined, '🏆 战况')));
        var btns = ui.h(C.overButtons(ui, 'gomoku'));
        body.appendChild(btns);
        PN.wireOver(btns, ui);
      } else {
        var turn = ui.el('div', 'gm-turn' + (myTurn() ? ' mine' : ''));
        turn.innerHTML = myTurn()
          ? '<b>🙋 轮到你落子</b><span>你执' + (myColor === 1 ? '黑' : '白') + '，连成五子就赢</span>'
          : '<b>⏳ 等对方落子…</b><span>' + esc(oppP ? oppP.name : '对方') + ' 正在想</span>';
        body.appendChild(turn);

        var stage = ui.el('div', 'gm-stage');
        var cv = ui.el('canvas', 'gm-cv');
        cv.dataset.n = g.n;
        stage.appendChild(cv);
        body.appendChild(stage);

        var row = ui.el('div', 'gm-ops');
        var undoBtn = ui.el('button', 'btn ghost sm', (g.moves || []).length ? '↩️ 请求悔棋' : '↩️ 悔棋');
        undoBtn.setAttribute('data-undo', '1');
        if (!(g.moves || []).length || g.pending) undoBtn.disabled = true;
        undoBtn.addEventListener('click', function () { ui.send({ t: 'undo-req' }); });
        row.appendChild(undoBtn);
        body.appendChild(row);

        if (g.pending) {
          if (g.pending.by === me) {
            body.appendChild(ui.h('<div class="gm-pending">已请求悔棋，等对方同意…</div>'));
          } else {
            var ask = ui.el('div', 'gm-ask');
            ask.appendChild(ui.h('<div class="gm-ask-txt">🙋 ' + esc(oppP ? oppP.name : '对方') + ' 想悔一步棋</div>'));
            var okB = ui.el('button', 'btn primary sm', '同意');
            var noB = ui.el('button', 'btn ghost sm', '不同意');
            okB.setAttribute('data-undo-ok', '1'); noB.setAttribute('data-undo-no', '1');
            okB.addEventListener('click', function () { ui.send({ t: 'undo-answer', ok: true }); });
            noB.addEventListener('click', function () { ui.send({ t: 'undo-answer', ok: false }); });
            ask.appendChild(okB); ask.appendChild(noB);
            body.appendChild(ask);
          }
        }

        // 等挂进文档、量得到尺寸后再画
        setTimeout(function () {
          draw(cv, ui.state.g, myColor);
          bind(cv, ui, ui.state.g, function () {
            var s = ui.state;
            if (!s || !s.g || s.g.phase !== 'play' || s.g.pending) return false;
            var mc = (s.g.players && s.g.players[0] === ui.pid()) ? 1 : 2;
            return s.g.turn === mc;
          });
        }, 0);
      }

      wrap.appendChild(body);
      if (state.phase !== 'over') wrap.appendChild(ui.renderGameFooter());
      return wrap;
    }
  };

  /* 窗口尺寸变了要重画（手机横竖屏切换最容易踩：画布还在，但后备缓冲区要重设） */
  if (typeof setInterval === 'function') {
    setInterval(function () {
      var ui = local.ui;
      if (!ui || !local.cv || !ui.state || !ui.state.g) return;
      if (!document.body.contains(local.cv)) return;
      draw(local.cv, ui.state.g, null);
    }, 1000);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
