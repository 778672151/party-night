/* ===== 心有灵犀 屏幕 =====
 * 作画阶段：一块大画布（只有自己的画）；揭晓阶段：并排两块（我 / TA）+ 互相表态。
 * 画布用 src/canvas-ink.js 的通用实现，两块画布按作者分开，互不串。 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};
  var esc = PN.esc;

  var COLORS = ['#6b5588', '#ff8fb8', '#63c7e8', '#7fd6a6', '#ffb95e'];
  var WIDTHS = [4, 9];
  var local = { ink: null, round: 0, phase: '', style: { color: COLORS[0], w: 4 }, asked: {}, seen: {} };

  function inkFor(ui) {
    if (!local.ink) {
      local.ink = PN.Ink.create({
        ui: ui,
        color: local.style.color, w: local.style.w,
        round: function () { return local.round; }
      });
    }
    return local.ink;
  }
  function partnerOf(state, meId) {
    var ps = (state.g && state.g.players) || [];
    for (var i = 0; i < ps.length; i++) if (ps[i] !== meId) return ps[i];
    return null;
  }

  /* 缺号自愈 + 整段缺失自愈：作画阶段丢了一段没关系（反正只给自己看），
     但**揭晓时对方那块画布一张都没有**就得主动要一次，否则并排展示会空一半。 */
  if (typeof setInterval === 'function') {
    setInterval(function () {
      var ui = local.ui;
      if (!ui || !local.ink || !ui.state || !ui.state.g) return;
      var g = ui.state.g;
      local.ink.sweep();
      if (g.phase !== 'reveal' || !g.prompt) return;
      var me = ui.pid ? ui.pid() : null;
      var other = partnerOf(ui.state, me);
      if (!other) return;
      if (local.ink.hasInk(other)) return;                    // 对方的画在这儿了
      local.asked[g.round] = local.asked[g.round] || 0;
      if (local.asked[g.round] >= 3) return;
      if (Date.now() - (local.askedAt || 0) < 2500) return;
      local.asked[g.round]++;
      local.askedAt = Date.now();
      ui.send({ t: 'need_replay' });
    }, 1200);
  }

  PN.screens = PN.screens || {};
  PN.screens.codraw = {
    name: 'codraw',
    render: function (state, secret) {
      var ui = this;
      var C = PN.gameCommon;
      var g = state.g || {};
      var me = ui.pid();
      var other = partnerOf(state, me);
      var otherP = other ? ui.p(other) : null;
      var wrap = ui.el('div');
      ui.renderTopbar(wrap);

      // 换回合：清空两块画布，避免上一题的画串到这一题
      if (local.round !== g.round) { local.round = g.round; local.asked = {}; if (local.ink) local.ink.reset(); }

      var phaseText = g.phase === 'draw' ? (g.ready && g.ready[me] ? '你画好了' : '一起画')
        : (g.phase === 'reveal' ? '揭晓' : '本局结束');
      var extra = g.phase === 'draw' && g.deadline ? C.deadlineChip(g.deadline) : '';
      wrap.appendChild(ui.h(C.gameHeader(ui, state, '🎐 心有灵犀',
        '第 ' + (g.round || 1) + '/' + (g.total || 3) + ' 题 · ' + phaseText, extra)));

      var body = ui.el('div');
      var ink = inkFor(ui);
      ink.setWritable(g.phase === 'draw' && !(g.ready && g.ready[me]));
      ink.setStyle(local.style.color, local.style.w);
      ink.clearViews();          // DOM 每次重建，视图要重新挂

      /* ---------------- 作画 ---------------- */
      if (g.phase === 'draw') {
        body.appendChild(ui.h('<div class="card center cd-prompt"><div class="t">' + esc(g.prompt || '') + '</div>' +
          '<div class="muted mt8">' + esc(g.hint || '') + '</div></div>'));

        var stage = ui.el('div', 'cd-stage');
        var cv = ui.el('canvas', 'cd-cv');
        stage.appendChild(cv);
        body.appendChild(stage);
        local.ui = ui;
        body.appendChild(ui.h('<div class="cd-tip">🖌️ 在画布上画 · 揭晓前看不到对方的画</div>'));

        var tools = ui.el('div', 'cd-tools');
        COLORS.forEach(function (col) {
          var b = ui.el('button', 'cd-dot' + (local.style.color === col ? ' on' : ''));
          b.style.background = col;
          b.addEventListener('click', function () {
            local.style.color = col;
            if (local.ink) local.ink.setStyle(col, local.style.w);
            // 就地换高亮：不走整页重渲，免得重建 DOM 把正在画的那一笔打断
            tools.querySelectorAll('.cd-dot').forEach(function (x) { x.classList.remove('on'); });
            b.classList.add('on');
          });
          tools.appendChild(b);
        });
        WIDTHS.forEach(function (w) {
          var b = ui.el('button', 'cd-wide' + (local.style.w === w ? ' on' : ''));
          b.innerHTML = '<i style="height:' + Math.max(2, Math.round(w / 2)) + 'px"></i>';
          b.addEventListener('click', function () {
            local.style.w = w;
            if (local.ink) local.ink.setStyle(local.style.color, w);
            tools.querySelectorAll('.cd-wide').forEach(function (x) { x.classList.remove('on'); });
            b.classList.add('on');
          });
          tools.appendChild(b);
        });
        body.appendChild(tools);

        var ready = !!(g.ready && g.ready[me]);
        var otherReady = !!(other && g.ready && g.ready[other]);
        var rbtn = ui.el('button', 'btn ' + (ready ? 'ghost' : 'primary') + ' block mt8', ready ? '✅ 已经画好了' : '✏️ 我画好了');
        rbtn.setAttribute('data-ready', '1');
        if (!ready) rbtn.addEventListener('click', function () { ui.send({ t: 'ready' }); });
        rbtn.disabled = ready;
        body.appendChild(rbtn);
        body.appendChild(ui.h('<div class="muted center mt8">' +
          (ready ? (otherReady ? '两个人都画好了，马上揭晓～' : '等对方画完…（TA 随时可能点「我画好了」）')
                 : (otherReady ? '对方已经画好了，还在等你 ✨' : '两个人都在画，不许偷看哦')) + '</div>'));

        // 画布要等挂进文档、量得到尺寸之后再挂：① 绑定画笔事件 ② 挂渲染视图
        setTimeout(function () {
          ink.bindSend(cv, me);
          ink.addView(cv, me);
          ink.redraw();
        }, 0);
      /* ---------------- 揭晓 ---------------- */
      } else if (g.phase === 'reveal') {
        body.appendChild(ui.h('<div class="card center cd-prompt"><div class="t">' + esc(g.prompt || '') + '</div>' +
          '<div class="muted mt8">' + esc(g.hint || '') + '</div></div>'));

        var row = ui.el('div', 'cd-reveal');
        var pair = [[me, '我画的'], [other, otherP ? otherP.name + ' 画的' : 'TA 画的']];
        var cvs = [];
        pair.forEach(function (pr) {
          var one = ui.el('div', 'cd-one');
          var c = ui.el('canvas', 'cd-sv');
          one.appendChild(c);
          one.appendChild(ui.h('<div class="cd-lbl">' + esc(pr[1]) + '</div>'));
          row.appendChild(one);
          cvs.push([c, pr[0]]);
        });
        body.appendChild(row);
        setTimeout(function () {
          cvs.forEach(function (p) { if (p[1]) ink.addView(p[0], p[1]); });
          ink.redraw();
        }, 0);

        var rev = g.reveal || {};
        var settled = g.reveal && ((rev.list && rev.list.length >= 2) ? true : false) && g.phase === 'reveal' && g.settled !== false;
        var mine = g.rated ? g.rated[me] : undefined;
        var otherRate = other && g.rated ? g.rated[other] : undefined;
        var bothRated = mine !== undefined && otherRate !== undefined;
        if (!bothRated) {
          var rate = ui.el('div', 'cd-rate');
          var ok = ui.el('button', 'btn primary' + (mine === 1 ? ' on' : ''), '💞 想到一块去了');
          var no = ui.el('button', 'btn ghost' + (mine === -1 ? ' on' : ''), '🌈 各画各的');
          ok.setAttribute('data-rate', '1'); no.setAttribute('data-rate', '-1');
          if (mine === undefined) {
            ok.addEventListener('click', function () { ui.send({ t: 'rate', v: 1 }); });
            no.addEventListener('click', function () { ui.send({ t: 'rate', v: -1 }); });
          } else { ok.disabled = true; no.disabled = true; }
          rate.appendChild(ok); rate.appendChild(no);
          body.appendChild(rate);
          body.appendChild(ui.h('<div class="muted center mt8">' + (mine === undefined ? '看着两张画，选一个你的感觉' : '已经表态，等对方也看一眼…') + '</div>'));
        } else {
          var list = rev.list || [];
          var m = rev.match;
          // 注意：ui.h() 只取第一个根元素 —— 多个并列根会被静默丢掉，
          // 所以这里必须包一层，否则表态那几行永远渲染不出来（浏览器用例抓到的坑）。
          var html = '<div class="cd-res"><div class="cd-verdict ' + (m ? 'ok' : 'no') + '">' +
            (m ? '心有灵犀 💞 两个人都觉得像' : '各画各的也挺好 🌈 下次接着练') + '</div><div class="cd-rt">';
          list.forEach(function (x) {
            html += '<div class="cd-r"><span class="em">' + esc(x.emoji || '🙂') + '</span>' + esc(x.name) +
              '<b class="' + (x.v === 1 ? 'yes' : 'noo') + '">' + (x.v === 1 ? '想到一块了' : x.v === -1 ? '各画各的' : '没表态') + '</b></div>';
          });
          html += '</div></div>';
          body.appendChild(ui.h(html));
        }
      /* ---------------- 结算 ---------------- */
      } else {
        var s = g.summary || { matched: 0, total: 0, percent: 0 };
        body.appendChild(ui.h('<div class="card center cd-hero">' +
          '<div class="cd-percent">' + s.percent + '<span>%</span></div>' +
          '<div class="cd-word">灵犀指数</div>' +
          '<div class="muted mt8">' + s.total + ' 题里，有 <b>' + s.matched + '</b> 题你们想到了一块</div>' +
          '<div class="cd-quote">' + (s.percent >= 100 ? '这不就是同一个脑子吗 ✨' : s.percent >= 60 ? '默契得很舒服 💞' : s.percent >= 30 ? '各有各的有趣 🌷' : '两个有趣的灵魂 ☁️') + '</div>' +
          '</div>'));
        body.appendChild(ui.h(C.scoreboard(state)));
        var btns = ui.h(C.overButtons(ui, 'codraw'));
        body.appendChild(btns);
        PN.wireOver(btns, ui);
      }

      wrap.appendChild(body);
      if (state.phase !== 'over') wrap.appendChild(ui.renderGameFooter());
      return wrap;
    },

    /* 墨迹：分块到达 → 入库 + 该显示的时候显示 */
    onPeer: function (msg, from) {
      var ui = this;
      if (!local.ink) return;
      local.ink.onInk(msg, from);
    },

    /* 私密回放：换回合/刷新/换主时房主把画布补回来 */
    onPrivate: function (obj) {
      if (!local.ink || !obj || !obj.boards) return;
      Object.keys(obj.boards).forEach(function (pid) {
        local.ink.replay(pid, obj.boards[pid]);
      });
    },

    /* 整段回放的事件通知（新房主向各端要上报时） */
    onRecover: function () {
      if (!local.ink) return;
      var ui = local.ui;
      var me = ui && ui.pid ? ui.pid() : null;
      // 把自己画布上的笔迹重发一遍（走墨迹通道的自发自收，房主会记下来）
      var list = me ? local.ink.strokes(me) : [];
      for (var i = 0; i < list.length; i++) {
        var st = list[i];
        if (!st || !st.pts || !st.pts.length) continue;
        var n = (st.have === undefined) ? st.pts.length : Math.min(st.have, st.pts.length);
        if (!n) continue;
        ui.sendInk({ t: 'stroke', id: st.id, r: st.r, color: st.color, w: st.w, i0: 0, s: st.pts.slice(0, n) });
      }
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
