/* ===== 默契大考验 屏幕 =====
 * 三个状态：作答（各自悄悄选）→ 揭晓（并排比对）→ 结算（默契度）
 * 情感互动设计：作答后明确显示「已提交，等对方选…」；揭晓时把两人的选择并排放在一起，
 * 不一致时不说「错了」，而是提示「趁机聊聊为什么」——把差异变成话题。 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};
  var esc = PN.esc;

  function rating(p) {
    if (p >= 100) return '你们就是同一个人吧？✨';
    if (p >= 80) return '默契到有点吓人 💞';
    if (p >= 60) return '相当合拍，继续加油 🌷';
    if (p >= 40) return '一半一半，正好多聊聊天 🌱';
    return '原来是两个星球的人呀 ☁️';
  }

  PN.screens = PN.screens || {};
  PN.screens.tacit = {
    name: 'tacit',
    render: function (state, secret) {
      var ui = this;
      var C = PN.gameCommon;
      var g = state.g || {};
      var wrap = ui.el('div');
      ui.renderTopbar(wrap);

      var phaseText = g.phase === 'over' ? '本局结束'
        : (g.cur && g.cur.phase === 'reveal' ? '揭晓' : '作答中');
      var extra = g.cur && g.cur.deadline
        ? C.deadlineChip(g.cur.deadline)
        : '<span class="pill">' + ((g.summary && g.summary.matched) || g.matched || 0) + ' 题一致</span>';
      wrap.appendChild(ui.h(C.gameHeader(ui, state, '💞 默契大考验', phaseText, extra)));

      var body = ui.el('div');

      /* ---------- 结算 ---------- */
      if (g.phase === 'over' || !g.cur) {
        var s = g.summary || { matched: 0, total: 0, percent: 0 };
        body.appendChild(ui.h(
          '<div class="card center tac-hero">' +
          '<div class="tac-percent">' + s.percent + '<span>%</span></div>' +
          '<div class="tac-word">你们の默契度</div>' +
          '<div class="muted mt8">' + s.total + ' 题里，有 <b>' + s.matched + '</b> 题想到了一起</div>' +
          '<div class="tac-quote">' + rating(s.percent) + '</div>' +
          '</div>'));
        body.appendChild(ui.h(C.scoreboard(state)));
        var btns = ui.h(C.overButtons(ui, 'tacit'));
        body.appendChild(btns);
        PN.wireOver(btns, ui);
      /* ---------- 作答 ---------- */
      } else if (g.cur.phase === 'answer') {
        var mine = !!(g.cur.answered && g.cur.answered[ui.pid()]);
        body.appendChild(ui.h(
          '<div class="card center tac-q">' +
          '<div class="muted">第 ' + g.round + ' / ' + g.total + ' 题</div>' +
          '<div class="tac-qtext">' + esc(g.cur.q) + '</div>' +
          '</div>'));
        var opts = ui.el('div', 'tac-opts');
        var letters = ['A', 'B', 'C', 'D'];
        (g.cur.options || []).forEach(function (label, i) {
          var b = ui.el('button', 'tac-opt' + (mine ? ' dim' : ''));
          b.innerHTML = '<span class="k">' + (letters[i] || '') + '</span><span class="t">' + esc(label) + '</span>';
          if (!mine) {
            b.addEventListener('click', function () {
              b.classList.add('chosen');
              ui.send({ t: 'answer', i: i });
            });
          }
          opts.appendChild(b);
        });
        body.appendChild(opts);
        body.appendChild(ui.h(mine
          ? '<div class="tac-wait"><span class="dots"><i></i><i></i><i></i></span>已提交，等对方选…</div>'
          : '<div class="muted center mt8">选一个最像你们的答案 · 对方看不到你的选择</div>'));
      /* ---------- 揭晓 ---------- */
      } else {
        var r = g.cur.reveal || { picks: [], match: false };
        body.appendChild(ui.h('<div class="card center tac-q"><div class="tac-qtext">' + esc(g.cur.q) + '</div></div>'));
        var row = '<div class="tac-picks">';
        (r.picks || []).forEach(function (p) {
          row += '<div class="tac-pick' + (r.match ? ' same' : '') + '">' +
            '<div class="em">' + (p.emoji || '🙂') + '</div>' +
            '<div class="nm">' + esc(p.name) + '</div>' +
            '<div class="pick">' + esc(p.label) + '</div>' +
            '</div>';
        });
        row += '</div>';
        body.appendChild(ui.h(row));
        body.appendChild(ui.h('<div class="tac-verdict ' + (r.match ? 'ok' : 'no') + '">' +
          (r.match ? '心有灵犀 💞' : '咦，想的不一样～ 趁机聊聊为什么') + '</div>'));
      }

      wrap.appendChild(body);
      if (state.phase !== 'over') wrap.appendChild(ui.renderGameFooter());
      return wrap;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
