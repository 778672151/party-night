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
        // 三渲二牌桌：DOM 卡片退化为「透明命中层」（测试与无障碍照旧），视觉由下面的 canvas 提供
        var cv = ui.el('canvas', 'mem-3d');
        board.appendChild(cv);
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

        /* ---------- 三渲二绘制：等距圆角牌 + 黄/粉三段色阶 + 翻牌弹跳 ---------- */
        (function paint() {
          var T = PN.Toon;
          if (!T || !T.animate || !T.tone) return;
          var back = T.tone('#ffb3d1'), face = T.tone('#ffe3a8'), done2 = T.tone('#bfe6d0');
          T.animate(cv, function (ctx, dt, t) {
            var bw = board.clientWidth || 1, bh = board.clientHeight || 1;
            ctx.clearRect(0, 0, bw, bh);
            var cells = board.querySelectorAll('.mem-card');
            if (!cells.length) return;
            for (var k = 0; k < cells.length; k++) {
              var cell = cells[k];
              var cr = cell.getBoundingClientRect(), br = board.getBoundingClientRect();
              var cx = cr.left - br.left + cr.width / 2;
              var cy = cr.top - br.top + cr.height / 2;
              var w = Math.min(cr.width, cr.height) * 0.46;
              var up = cell.classList.contains('on') || cell.classList.contains('just');
              var isDone = cell.classList.contains('done');
              var col = isDone ? done2 : (up ? face : back);
              // 翻牌弹跳：刚翻开的那张做一次缩放回弹
              var pop = 1;
              if (cell.classList.contains('just')) {
                var ph = (t % 0.9) / 0.9;
                pop = 1 + T.spring(ph) * 0.18;
              }
              var d = w * 0.13, h = w * 1.34 * pop;   // 薄侧边（卡片感，不是盒子）
              ctx.save();
              ctx.translate(cx, cy - d * 0.5);
              ctx.lineJoin = 'round';
              // 牌影
              ctx.globalAlpha = 0.18; ctx.fillStyle = '#3a2b52';
              ctx.beginPath(); ctx.ellipse(0, h / 2 + d, w * 0.92, d * 0.62, 0, 0, 6.2832); ctx.fill();
              ctx.globalAlpha = 1;
              // 卡片：整体轻轻斜过来（2.5D 手感），底下垫一层薄侧边当厚度
              ctx.transform(1, 0, -0.16, 1, 0, 0);
              var r = Math.max(4, w * 0.26);       // 圆角
              var rect = function (x, y, ww, hh, rr) {
                ctx.beginPath();
                ctx.moveTo(x + rr, y);
                ctx.arcTo(x + ww, y, x + ww, y + hh, rr);
                ctx.arcTo(x + ww, y + hh, x, y + hh, rr);
                ctx.arcTo(x, y + hh, x, y, rr);
                ctx.arcTo(x, y, x + ww, y, rr);
                ctx.closePath();
              };
              // 厚度（右下侧边）
              ctx.fillStyle = col.left;
              rect(-w + d * 0.5, -h / 2 + d, w * 2, h, r);
              ctx.fill();
              // 正面
              ctx.fillStyle = col.base;
              rect(-w, -h / 2, w * 2, h, r);
              ctx.fill();
              // 顶面受光（一条渐变感的高光块）
              ctx.fillStyle = col.top;
              rect(-w, -h / 2, w * 2, h * 0.34, r);
              ctx.fill();
              // 描边
              ctx.strokeStyle = col.line; ctx.lineWidth = Math.max(1.5, w * 0.08);
              rect(-w, -h / 2, w * 2, h, r);
              ctx.stroke();
              // 内容：翻开的画正面图案，未翻开画花
              ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              var txt = up ? String((cell.querySelector('.face.front') || {}).textContent || '') : '🌸';
              if (isDone) txt = '✓';
              ctx.font = '900 ' + Math.round(w * 0.78) + 'px -apple-system,system-ui,"PingFang SC",sans-serif';
              ctx.fillStyle = col.rim;
              ctx.fillText(txt, 0, d * 0.1);
              ctx.restore();
            }
          }, {});
        })();

        body.appendChild(ui.h('<div class="muted center mt8">' +
          ((g.combo || 0) >= 2 ? '连击 x' + g.combo + '，继续！' : '配对成功两个人都加分 · 是一起完成，不是比赛') + '</div>'));
      }

      wrap.appendChild(body);
      if (state.phase !== 'over') wrap.appendChild(ui.renderGameFooter());
      return wrap;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
