/* ===== 心有灵犀·波长 屏幕 ===== */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};
  var esc = PN.esc;

  function phaseText(g) {
    if (g.curPhase === 'clue') return '通灵者想线索';
    if (g.curPhase === 'guess') return '大家猜位置';
    if (g.curPhase === 'reveal') return '开奖';
    return '本局结束';
  }

  function spectrum(ui, g, opts) {
    var wrap = ui.el('div', 'card');
    var value = opts.value;
    var onSet = opts.onSet;
    var bar = ui.el('div', 'wave-bar');
    var track = ui.el('div', 'wave-track');
    bar.appendChild(track);
    if (opts.marker !== undefined) {
      var mk = ui.el('div', 'marker');
      mk.style.left = opts.marker + '%';
      bar.appendChild(mk);
    }
    var knob = ui.el('div', 'wave-knob', value == null ? '?' : String(value));
    if (value != null) knob.style.left = value + '%';
    track.appendChild(knob);
    if (onSet) {
      var setFrom = function (e) {
        var rect = bar.getBoundingClientRect();
        var x = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX) - rect.left;
        var v = Math.max(0, Math.min(100, Math.round(x / rect.width * 100)));
        knob.style.left = v + '%';
        knob.textContent = String(v);
        onSet(v);
      };
      var dragging = false;
      track.addEventListener('pointerdown', function (e) { dragging = true; track.setPointerCapture && track.setPointerCapture(e.pointerId); setFrom(e); });
      track.addEventListener('pointermove', function (e) { if (dragging) setFrom(e); });
      track.addEventListener('pointerup', function (e) { dragging = false; setFrom(e); });
      track.addEventListener('touchstart', function (e) { e.preventDefault(); setFrom(e); }, { passive: false });
    }
    wrap.appendChild(bar);
    var labels = ui.el('div', 'wave-labels');
    labels.appendChild(ui.el('span', '', null));
    labels.innerHTML = '<span><b>' + esc(g.left || '') + '</b> ←</span><span>→ <b>' + esc(g.right || '') + '</b></span>';
    wrap.appendChild(labels);
    return wrap;
  }

  PN.screens = PN.screens || {};
  PN.screens.wavelength = {
    name: 'wavelength',
    render: function (state, secret) {
      var ui = this;
      var C = PN.gameCommon;
      var g = state.g || {};
      var wrap = ui.el('div');
      ui.renderTopbar(wrap);
      wrap.appendChild(ui.h(C.gameHeader(ui, state, '🌊 心有灵犀·波长', phaseText(g),
        g.deadline ? C.deadlineChip(g.deadline) : '<span class="pill">' + (g.round || 0) + '/' + (g.rounds || 6) + '</span>')));
      var psychic = g.cur;
      var iAmPsychic = psychic === ui.pid();
      var pName = '';
      if (state.players) for (var i = 0; i < state.players.length; i++) if (state.players[i].id === psychic) pName = state.players[i].name;

      if (state.phase === 'over') {
        wrap.appendChild(ui.h(C.scoreboard(state, g.winner, '🏆 波段对决结束')));
        wrap.appendChild(ui.h(C.overButtons(ui, 'wavelength')));
        wrap.appendChild(ui.renderGameFooter());
        wrap.querySelectorAll('[data-over]').forEach(function (b) {
          b.addEventListener('click', function () { ui.send({ t: b.getAttribute('data-over') }); });
        });
        return wrap;
      }

      if (g.curPhase === 'clue') {
        if (iAmPsychic && secret && typeof secret.target === 'number') {
          wrap.appendChild(ui.h('<div class="card center"><div class="pill">你是通灵者 🔮</div>' +
            '<div class="muted mt8">靶心位置：</div><div class="bigword">' + secret.target + '</div>' +
            '<div class="muted">想一个线索词/短语，让别人尽量猜中它，但别说数字！</div></div>'));
          wrap.appendChild(spectrum(ui, g, { value: secret.target, marker: secret.target }));
          wrap.appendChild(inputBarClue(ui, function (v) { ui.send({ t: 'clue', text: v }); }));
        } else {
          wrap.appendChild(ui.h('<div class="card center"><div class="bigword">🔮</div>' +
            '<div class="muted">通灵者 <b>' + esc(pName) + '</b> 正在想线索…</div></div>'));
          wrap.appendChild(spectrum(ui, g, {}));
        }
      } else if (g.curPhase === 'guess') {
        if (iAmPsychic) {
          wrap.appendChild(ui.h('<div class="card center"><div class="pill">你是通灵者</div>' +
            '<div class="muted mt8">你给出的线索：</div><div style="font-size:24px;font-weight:900">「' + esc(g.clue || '') + '」</div>' +
            '<div class="muted mt8">看大家能不能猜中你心里的位置 🍿</div></div>'));
        } else {
          var mine = g.guesses && g.guesses[ui.pid()];
          wrap.appendChild(ui.h('<div class="card center"><div class="pill">线索</div>' +
            '<div style="font-size:24px;font-weight:900;margin-top:6px">「' + esc(g.clue || '') + '」</div>' +
            '<div class="muted mt8">' + (mine !== undefined ? '已提交：' + mine + '（等大家）' : '拖动滑块，猜通灵者想的位置') + '</div></div>'));
          var submitted = mine !== undefined;
          var val = mine !== undefined ? mine : 50;
          var sbar = spectrum(ui, g, {
            value: submitted ? mine : val,
            onSet: function (v) { val = v; if (!submitted) { submitted = false; } }
          });
          var bar = ui.el('div');
          bar.appendChild(sbar);
          var btn = ui.el('button', 'btn primary block', submitted ? '已提交 ' + mine + ' 分位' : '提交我的位置');
          btn.disabled = submitted;
          btn.addEventListener('click', function () { ui.send({ t: 'guess', v: val }); });
          bar.appendChild(btn);
          wrap.appendChild(bar);
        }
      } else if (g.curPhase === 'reveal') {
        var r = g.reveal || {};
        var target = r.target != null ? r.target : (secret && secret.target);
        var guessList = r.guesses || [];
        var lines = guessList.map(function (x) {
          var name = '';
          if (state.players) for (var j = 0; j < state.players.length; j++) if (state.players[j].id === x.id) name = state.players[j].name;
          return '<div class="listitem"><div class="who">' + esc(name) + (x.id === r.bestId ? ' 👑 波段大师' : '') + '</div>' +
            '<div class="what">' + x.v + ' 分位 · 偏差 ' + x.distance + '</div></div>';
        }).join('');
        wrap.appendChild(ui.h('<div class="card center"><div class="pill">答案揭晓</div>' +
          '<div class="muted mt8">线索「' + esc(g.clue || '') + '」</div>' +
          '<div class="bigword">' + target + '</div></div>'));
        wrap.appendChild(spectrum(ui, g, { marker: target }));
        if (lines) wrap.appendChild(ui.h('<div class="card"><div class="list">' + lines + '</div></div>'));
        wrap.appendChild(ui.h('<div class="muted center mt8">下一回合马上开始…</div>'));
      }
      wrap.appendChild(ui.renderGameFooter()); // 给线索/猜的时候也要能回大厅
      return wrap;
    }
  };

  function inputBarClue(ui, send) {
    var bar = ui.el('div', 'inputbar');
    var input = ui.el('input');
    input.placeholder = '给个线索（别直接说数字）…';
    input.maxLength = 50;
    var btn = ui.el('button', 'btn primary', '🔮 给线索');
    var go = function () { var v = input.value.trim(); if (!v) return; send(v); input.value = ''; };
    btn.addEventListener('click', go);
    input.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return; // 输入法回车=确认候选词
    go();
  });
    bar.appendChild(input); bar.appendChild(btn);
    return bar;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
