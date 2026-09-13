/* ===== 合作翻牌 屏幕 =====
 * 4×4 牌桌 + 3D 翻牌动画。整树重建的渲染模型下，CSS 过渡会失效，
 * 所以「刚翻开」的牌用一个 @keyframes 动画（动画在新元素上也会播），
 * 并记住上一次哪些牌是正面，避免重复播动画。 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};
  var esc = PN.esc;
  var local = { seen: {} };   // i -> true：上一次渲染时这张牌是正面

  function starText(n) { return '⭐'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n)); }

  PN.screens = PN.screens || {};
  PN.screens.memory = {
    name: 'memory',
    render: function (state, secret) {
      var ui = this;
      var C = PN.gameCommon;
      var g = state.g || {};
      var wrap = ui.el('div');
      ui.renderTopbar(wrap);

      var myTurn = g.phase === 'play' && g.turn === ui.pid();
      var phaseText = g.phase === 'over' ? '本局结束' : (myTurn ? '轮到你' : '等对方');
      wrap.appendChild(ui.h(C.gameHeader(ui, state, '🍀 合作翻牌', phaseText,
        '<span class="pill">配对 ' + (g.matched || 0) + '/' + (g.total || 8) + '</span>' +
        '<span class="pill">步数 ' + (g.turns || 0) + '</span>' +
        ((g.combo || 0) >= 2 ? '<span class="pill mem-cb">连击 x' + g.combo + '</span>' : ''))));

      var body = ui.el('div');

      /* ---------- 结算 ---------- */
      if (g.phase === 'over' || !g.slots) {
        var o = g.over || { turns: g.turns || 0, pairs: g.total || 8, stars: 1, bestCombo: 0 };
        body.appendChild(ui.h(
          '<div class="card center mem-hero">' +
          '<div class="mem-stars">' + starText(o.stars) + '</div>' +
          '<div class="mem-turns">' + o.turns + ' 步配完 ' + o.pairs + ' 对</div>' +
          '<div class="muted mt8">' + (o.stars === 3 ? '记性好得像开了挂！✨' : o.stars === 2 ? '配合得不错～ 🌷' : '慢慢来，下次一定更快 🌱') + '</div>' +
          (o.bestCombo >= 2 ? '<div class="mem-combo">最高连击 x' + o.bestCombo + '</div>' : '') +
          '</div>'));
        body.appendChild(ui.h(C.scoreboard(state)));
        var btns = ui.h(C.overButtons(ui, 'memory'));
        body.appendChild(btns);
        PN.wireOver(btns, ui);
      /* ---------- 牌桌 ---------- */
      } else {
        body.appendChild(ui.h(
          '<div class="mem-turn' + (myTurn ? ' mine' : '') + '">' +
          (myTurn ? '<b>🙋 轮到你翻牌</b><span>翻两张，配成一对</span>'
                  : '<b>⏳ 等对方翻牌…</b><span>记住牌的位置，帮 ta 一起配</span>') +
          '</div>'));

        var done = {};
        (g.done || []).forEach(function (i) { done[i] = true; });
        var board = ui.el('div', 'mem-board' + (g.total === 4 ? ' small' : ''));
        (g.slots || []).forEach(function (e, i) {
          var up = !!e;
          var just = up && !local.seen[i];
          var c = ui.el('button', 'mem-card' + (up ? ' on' : '') + (just ? ' just' : '') + (done[i] ? ' done' : ''));
          c.setAttribute('data-i', i);
          c.innerHTML = '<span class="inner">' +
            '<span class="face back">🌸</span>' +
            '<span class="face front">' + esc(e || '') + '</span>' +
            '</span>';
          var clickable = g.phase === 'play' && myTurn && !up && (g.flipped || []).length < 2 && !done[i];
          if (clickable) {
            c.addEventListener('click', function () {
              // 不做乐观翻牌：房主状态回来会整树重建，正在播的动画会被销毁、看起来闪一下。
              // 交给状态驱动的重建来加 .just，动画正好完整播一次。
              ui.send({ t: 'flip', i: i });
            });
          } else {
            c.disabled = true;
          }
          board.appendChild(c);
        });
        body.appendChild(board);

        local.seen = {};
        (g.slots || []).forEach(function (e, i) { if (e) local.seen[i] = true; });

        body.appendChild(ui.h('<div class="muted center mt8">' +
          ((g.combo || 0) >= 2 ? '连击 x' + g.combo + '，继续！' : '配对成功两个人都加分 · 是一起完成，不是比赛') + '</div>'));
      }

      wrap.appendChild(body);
      if (state.phase !== 'over') wrap.appendChild(ui.renderGameFooter());
      return wrap;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
