/* ===== 鲸鱼推箱子 屏幕 =====
 * CSS grid 排格子；墙用厚实的糖果块、地板奶油色、目标点是粉色小花、箱子是贝壳/木箱。
 * 操作：方向键 / WASD / 屏幕上的十字键；轮流走一步。 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};
  var esc = PN.esc;
  var local = { down: false };

  function boardHtml(g, me) {
    var out = '';
    var next1 = g.last ? g.last.i : -1;
    for (var i = 0; i < g.rows * g.cols; i++) {
      var cls = 'sk-cell', inner = '';
      if (g.walls[i]) { cls += ' sk-wall'; }
      else {
        cls += ' sk-floor';
        if (g.goals[i]) cls += ' sk-goal';
        if (g.boxes[i]) { cls += g.goals[i] ? ' sk-box ok' : ' sk-box'; inner = g.goals[i] ? '🐚' : '📦'; }
        if (g.whale === i) { cls += ' sk-whale'; inner = '🐳'; }
      }
      if (i === next1) cls += ' sk-last';
      out += '<div class="' + cls + '" data-i="' + i + '">' + inner + '</div>';
    }
    return out;
  }

  PN.screens = PN.screens || {};
  PN.screens.soko = {
    name: 'soko',
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
      wrap.appendChild(ui.h(GC.gameHeader(ui, state, '🐳 鲸鱼推箱子（合作）',
        g.phase === 'over' ? '本局结束' : (myTurn ? '轮到你' : '等对方'),
        '<span class="pill">第 ' + ((g.li || 0) + 1) + '/' + (g.levels || 5) + ' 关</span>')));

      var body = ui.el('div');
      if (g.phase === 'over') {
        var title = g.win ? '一起通关啦！🎉' : '这局先到这儿～';
        body.appendChild(ui.h('<div class="card center sk-hero"><div class="sk-result">' + esc(title) + '</div>' +
          '<div class="muted mt8">一起通了 ' + (g.cleared || 0) + ' 关 · 双方各 +' + ((g.cleared || 0) * 2) + ' 分</div></div>'));
        body.appendChild(ui.h(GC.scoreboard(state, undefined, '🏆 总积分')));
        var btns = ui.h(GC.overButtons(ui, 'soko'));
        body.appendChild(btns);
        PN.wireOver(btns, ui);
      } else {
        var turn = ui.el('div', 'sk-turn' + (myTurn ? ' mine' : ''));
        turn.innerHTML = myTurn
          ? '<b>🙋 轮到你推一步</b><span>' + esc(g.levelName || '') + ' · 把箱子都推到花点上</span>'
          : '<b>👀 等 ' + esc(oppP ? oppP.name : '对方') + ' 推</b><span>他走的那格会闪一下</span>';
        body.appendChild(turn);

        var hud = ui.el('div', 'sk-hud');
        hud.innerHTML =
          '<span class="sk-stat"><i>🧭</i>' + (g.moves || 0) + ' 步</span>' +
          '<span class="sk-stat"><i>🫸</i>' + (g.pushes || 0) + ' 推</span>' +
          '<span class="sk-stat"><i>🎯</i>' + (g.levels || 0) + ' 关</span>' +
          '<span class="sk-stat"><i>✅</i>' + (g.cleared || 0) + '</span>';
        body.appendChild(hud);

        var board = ui.el('div', 'sk-board');
        board.style.setProperty('--cols', g.cols);
        board.style.setProperty('--rows', g.rows);
        board.innerHTML = boardHtml(g, me);
        body.appendChild(board);

        var pad = ui.el('div', 'sk-pad');
        var mk = function (dir, label, cls2) {
          var b = ui.el('button', 'btn ' + (cls2 || 'ghost') + ' sk-key', label);
          b.setAttribute('data-dir', dir);
          b.disabled = !myTurn;
          b.addEventListener('click', function () { ui.send({ t: 'move', dir: dir }); });
          return b;
        };
        pad.appendChild(mk('up', '⬆️', 'primary'));
        var row3 = ui.el('div', 'sk-pad-row');
        row3.appendChild(mk('left', '⬅️'));
        var rs = ui.el('button', 'btn ghost sk-key', '🔄');
        rs.setAttribute('data-reset', '1');
        rs.title = '重来本关';
        rs.addEventListener('click', function () { ui.send({ t: 'reset' }); });
        row3.appendChild(rs);
        row3.appendChild(mk('right', '➡️'));
        pad.appendChild(row3);
        pad.appendChild(mk('down', '⬇️', 'primary'));
        body.appendChild(pad);
        body.appendChild(ui.h('<div class="muted center mt8">也可以用键盘方向键 / WASD · 走不动不算一步</div>'));

        // 键盘：方向键 / WASD
        if (!ui.__sokoKey) {
          ui.__sokoKey = true;
          document.addEventListener('keydown', function (e) {
            var map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
            var dir = map[e.key];
            if (!dir) return;
            if (document.activeElement && /input|textarea/i.test(document.activeElement.tagName || '')) return;
            e.preventDefault();
            var st = PN.app && PN.app.state;
            if (!st || !st.g || st.mode !== 'soko' || st.g.phase !== 'play') return;
            if (st.g.players[st.g.turnIdx] !== PN.app.pid()) return;
            PN.app.send({ t: 'move', dir: dir });
          });
        }
      }
      wrap.appendChild(body);
      if (state.phase !== 'over') wrap.appendChild(ui.renderGameFooter());
      return wrap;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
