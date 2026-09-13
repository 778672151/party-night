/* ===== 扫雷 屏幕 =====
 * 用 CSS grid 排格子（不用 canvas：手机上更清晰、点击更准、也方便做长按插旗）。
 * 画风沿用 style.css 的 :root 马卡龙色板；每格的状态用类名区分（.mn-hid/.mn-open/.mn-flag/.mn-boom）。 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};
  var esc = PN.esc;

  /* 数字 1~8 的糖果色（与 --acc/--acc2/--purple 等同族） */
  var NUM_COLORS = ['', '#ff8fb8', '#5fb0d6', '#5fd6a8', '#c9a7ff', '#ffb066', '#8ad7ff', '#d1578f', '#6b5588'];
  var local = { mode: 'open' };

  function cellHtml(g, i, me) {
    var cls = 'mn-cell', inner = '';
    var isFlag = g.flagged[i], isOpen = g.revealed[i];
    var boom = (g.hit || []).indexOf(i) >= 0;
    if (isOpen) {
      cls += ' mn-open';
      if (g.board && g.board[i] === -1) { cls += ' mn-boom'; inner = '💥'; }
      else if (g.board && g.board[i] > 0) {
        inner = String(g.board[i]);
        cls += ' mn-n' + g.board[i];
      } else inner = '';
    } else if (isFlag) { cls += ' mn-flag'; inner = '🚩'; }
    else cls += ' mn-hid';
    if (g.last && g.last.i === i) cls += ' mn-last';
    if (boom) cls += ' mn-boom';
    var style = '';
    if (isOpen && !boom && g.board && g.board[i] > 0) style = ' style="color:' + NUM_COLORS[g.board[i]] + '"';
    return '<button class="' + cls + '" data-i="' + i + '"' + style + '>' + inner + '</button>';
  }

  PN.screens = PN.screens || {};
  PN.screens.mine = {
    name: 'mine',
    render: function (state, secret) {
      var ui = this;
      var GC = PN.gameCommon;
      var g = state.g || {};
      var me = ui.pid();
      var myTurn = g.phase === 'play' && g.players && g.players[g.turnIdx] === me;
      var opp = (g.players || []).filter(function (id) { return id !== me; })[0];
      var oppP = opp ? ui.p(opp) : null;
      var wrap = ui.el('div');
      ui.renderTopbar(wrap);

      var opened = 0, flags = 0;
      for (var i = 0; i < (g.revealed || []).length; i++) {
        if (g.revealed[i]) opened++;
        if (g.flagged[i]) flags++;
      }
      var safe = (g.rows || 9) * (g.cols || 9) - (g.mines || 0);
      wrap.appendChild(ui.h(GC.gameHeader(ui, state, '💣 扫雷（合作）',
        g.phase === 'over' ? '本局结束' : (myTurn ? '轮到你' : '等对方'),
        '<span class="pill">' + opened + '/' + safe + '</span>')));

      var body = ui.el('div');
      if (g.phase === 'over') {
        var title = g.win ? '一起扫干净啦！🎉' : '没扫完…再来一局？';
        body.appendChild(ui.h('<div class="card center mn-hero"><div class="mn-result">' + esc(title) + '</div>' +
          '<div class="muted mt8">翻开 ' + opened + '/' + safe + ' 格 · 剩 ' + Math.max(0, g.lives) + ' 条命</div></div>'));
        body.appendChild(ui.h(GC.scoreboard(state, undefined, '🏆 总积分')));
        var btns = ui.h(GC.overButtons(ui, 'mine'));
        body.appendChild(btns);
        PN.wireOver(btns, ui);
      } else {
        var turn = ui.el('div', 'mn-turn' + (myTurn ? ' mine' : ''));
        turn.innerHTML = myTurn
          ? '<b>🙋 轮到你点一格</b><span>共享雷图 · 商量着来，踩到雷扣一条命</span>'
          : '<b>👀 等 ' + esc(oppP ? oppP.name : '对方') + ' 落格</b><span>他点过的那格会闪一下</span>';
        body.appendChild(turn);

        var hud = ui.el('div', 'mn-hud');
        hud.innerHTML =
          '<span class="mn-stat"><i>❤️</i>' + Math.max(0, g.lives) + '</span>' +
          '<span class="mn-stat"><i>🧹</i>' + opened + '/' + safe + '</span>' +
          '<span class="mn-stat"><i>🚩</i>' + flags + '</span>' +
          '<span class="mn-stat"><i>💣</i>' + (g.mines || 0) + '</span>';
        body.appendChild(hud);

        var modeRow = ui.el('div', 'mn-modes');
        var mkB = ui.el('button', 'btn sm' + (local.mode === 'open' ? ' primary' : ' ghost'), '⛏️ 翻开');
        var fgB = ui.el('button', 'btn sm' + (local.mode === 'flag' ? ' primary' : ' ghost'), '🚩 插旗');
        mkB.setAttribute('data-mode-open', '1');
        fgB.setAttribute('data-mode-flag', '1');
        mkB.addEventListener('click', function () { local.mode = 'open'; ui.render(); });
        fgB.addEventListener('click', function () { local.mode = 'flag'; ui.render(); });
        var afB = ui.el('button', 'btn sm ghost', '✨ 自动插旗');
        afB.setAttribute('data-autoflag', '1');
        afB.disabled = !myTurn;
        afB.addEventListener('click', function () { ui.send({ t: 'autoflag' }); });
        modeRow.appendChild(mkB); modeRow.appendChild(fgB); modeRow.appendChild(afB);
        body.appendChild(modeRow);

        var board = ui.el('div', 'mn-board');
        board.style.setProperty('--cols', g.cols);
        var html = '';
        for (var k = 0; k < g.rows * g.cols; k++) html += cellHtml(g, k, me);
        board.innerHTML = html;
        body.appendChild(board);
        body.appendChild(ui.h('<div class="muted center mt8">手机端：长按格子也能插旗（当前模式：' + (local.mode === 'open' ? '翻开' : '插旗') + '）</div>'));

        // 点格子 → 按当前模式发对应动作；长按 → 插旗
        var longTimer = 0, longFired = false;
        board.querySelectorAll('.mn-cell').forEach(function (btn) {
          var idx = Number(btn.dataset.i);
          var send = function (kind) {
            if (!myTurn) return;
            if (kind === 'flag') ui.send({ t: 'flag', i: idx });
            else ui.send({ t: 'open', i: idx });
          };
          btn.addEventListener('pointerdown', function () {
            longFired = false;
            clearTimeout(longTimer);
            longTimer = setTimeout(function () { longFired = true; send('flag'); }, 450);
          });
          btn.addEventListener('pointerup', function () { clearTimeout(longTimer); });
          btn.addEventListener('pointercancel', function () { clearTimeout(longTimer); });
          btn.addEventListener('pointerleave', function () { clearTimeout(longTimer); });
          btn.addEventListener('click', function (e) {
            e.preventDefault();
            if (longFired) { longFired = false; return; }
            send(local.mode);
          });
        });
      }
      wrap.appendChild(body);
      if (state.phase !== 'over') wrap.appendChild(ui.renderGameFooter());
      return wrap;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
