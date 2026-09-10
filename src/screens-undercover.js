/* ===== 谁是卧底 屏幕 ===== */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  function phaseText(g) {
    if (g.phase === 'setup') return '房主选词中';
    if (g.phase === 'describe') return '描述阶段';
    if (g.phase === 'vote') return '投票淘汰';
    if (g.phase === 'revote') return '平票重投';
    if (g.phase === 'blankGuess') return '白板猜词';
    return '本局结束';
  }
  function wordCard(ui, secret, g) {
    if (!secret || !secret.role) {
      // 拿不到词有两种情况：刚刷新、房主马上会补发；或者本局开始后才进来（只能旁观）。
      // 以前这里返回空串 → ui.h('') 得到 null → appendChild 抛异常 → 整个屏幕变成「界面出错了」。
      var inGame = !!(g && g.alive && g.alive.indexOf(ui.pid()) !== -1);
      return '<div class="card center"><div class="bigword">' + (inGame ? '⏳' : '👀') + '</div>' +
        '<div class="muted">' + (inGame ? '正在取回你的词…（稍等一下）' : '本局已经开始了，你在旁观，等下一局吧～') + '</div></div>';
    }
    var roleName = { under: '卧底 🕵️', civil: '平民 😇', blank: '白板 🃏' }[secret.role] || '';
    var word = secret.role === 'blank' ? '你没有词，听别人描述后浑水摸鱼！' : secret.word;
    var hint = secret.role === 'under' ? '你的词和别人不一样，混过去！' : (secret.role === 'civil' ? '找出和你描述不一样的人' : '别露馅，被投出去时还有一次猜词机会');
    return '<div class="card center"><div class="pill">' + roleName + ' · 第 ' + (g.round || secret.round || 1) + ' 轮</div>' +
      '<div class="bigword">' + esc(word) + '</div><div class="muted">' + esc(hint) + '</div>' +
      (g.numUnder > 0 ? '<div class="muted mt8">卧底人数：' + g.numUnder + (g.blank ? ' · 有白板' : '') + '</div>' : '') + '</div>';
  }
  function inputBar(ui, placeholder, send) {
    var bar = ui.el('div', 'inputbar');
    var input = ui.el('input');
    input.placeholder = placeholder;
    input.maxLength = 200;
    var btn = ui.el('button', 'btn primary', '发送');
    var go = function () {
      var v = input.value.trim();
      if (!v) return;
      send(v);
      input.value = '';
    };
    btn.addEventListener('click', go);
    input.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return; // 输入法回车=确认候选词
    go();
  });
    bar.appendChild(input); bar.appendChild(btn);
    return bar;
  }
  function deadSet(g) {
    var d = {};
    for (var i = 0; i < (g.dead || []).length; i++) d[g.dead[i]] = true;
    return d;
  }
  function pickGrid(ui, state, g, pool, votes) {
    var C = PN.gameCommon;
    var sel = {};
    if (votes && votes[ui.pid()]) sel[votes[ui.pid()]] = true;
    var wrap = ui.el('div');
    var iAmAlive = (g.alive || []).indexOf(ui.pid()) !== -1; // 出局/旁观的人不能投票，别给可点的假按钮
    wrap.appendChild(ui.h(C.playerGrid(ui, state, { dead: deadSet(g), sel: sel, pool: pool, disabled: !iAmAlive })));
    wrap.querySelectorAll('[data-pick]').forEach(function (b) {
      if (b.hasAttribute('disabled')) return;
      if (pool && pool.indexOf(b.getAttribute('data-pick')) === -1) { b.setAttribute('disabled', ''); return; }
      b.addEventListener('click', function () { ui.send({ t: 'vote', id: b.getAttribute('data-pick') }); });
    });
    return wrap;
  }
  function nameOf(s, id) { var p = null; if (s && s.players) for (var i = 0; i < s.players.length; i++) if (s.players[i].id === id) { p = s.players[i]; break; } return p ? p.name : '??'; }

  PN.screens = PN.screens || {};
  PN.screens.undercover = {
    name: 'undercover',
    render: function (state, secret) {
      var ui = this;
      var C = PN.gameCommon;
      var g = state.g || {};
      var wrap = ui.el('div');
      ui.renderTopbar(wrap);
      wrap.appendChild(ui.h(C.gameHeader(ui, state, '🕵️ 谁是卧底', phaseText(g),
        g.deadline ? C.deadlineChip(g.deadline) : '<span class="pill">第 ' + (g.round || 0) + ' 轮</span>')));

      if (g.phase === 'setup') {
        if (ui.isHost()) {
          var side = g.side || 'random';
          var mk = function (v, label) { return '<button class="btn sm ' + (side === v ? 'primary' : 'ghost') + '" data-side="' + v + '">' + label + '</button>'; };
          wrap.appendChild(ui.h('<div class="card center"><div class="muted" style="margin-bottom:10px">卧底词选哪一边？（两边词只有你能看到）</div>' +
            '<div class="row" style="justify-content:center">' + mk('a', 'A 面') + mk('b', 'B 面') + mk('random', '随机') + '</div>' +
            '<button class="btn primary block mt16" data-go>🎬 发词开局</button>' +
            '<div class="muted mt8">' + (state.players.filter(function (p) { return p.online; }).length) + ' 人在线 · 卧底 ' + g.numUnder + ' 个' + (g.blank ? ' + 白板' : '') + '</div></div>'));
          wrap.querySelectorAll('[data-side]').forEach(function (b) {
            b.addEventListener('click', function () { ui.send({ t: 'pickSide', side: b.getAttribute('data-side') }); });
          });
          wrap.querySelector('[data-go]').addEventListener('click', function () { ui.send({ t: 'start' }); });
        } else {
          wrap.appendChild(ui.h('<div class="card center"><div class="bigword">⏳</div><div class="muted">等房主发词…</div></div>'));
        }
        wrap.appendChild(ui.renderGameFooter());
        return wrap;
      }

      if (g.phase === 'over') {
        wrap.appendChild(ui.h(C.scoreboard(state, Array.isArray(g.winner) ? g.winner[0] : null,
          '🏁 ' + (g.winner === 'under' ? '卧底获胜！' : (Array.isArray(g.winner) ? '白板猜词获胜！' : '平民获胜！')))));
        wrap.appendChild(ui.h(C.overButtons(ui, 'undercover')));
        wrap.appendChild(ui.renderGameFooter());
        PN.wireOver(wrap, ui);
        return wrap;
      }

      wrap.appendChild(ui.h(wordCard(ui, secret, g)));
      var body = ui.el('div');
      if (g.phase === 'describe') {
        var mine = g.desc && g.desc.filter(function (d) { return d.id === ui.pid(); }).length;
        body.appendChild(ui.h('<div class="card"><div class="muted" style="margin-bottom:8px">描述进度：' + (g.descCount || 0) + '/' + (g.alive || []).length + '（收齐自动开始投票' + (g.textMode ? '' : '，本轮口头描述') + '）</div>' +
          '<div class="row" style="flex-wrap:wrap">' + (g.alive || []).map(function (id) {
            return '<span class="pill">' + esc(nameOf(state, id)) + '</span>';
          }).join('') + '</div></div>'));
        if (g.textMode && (g.alive || []).indexOf(ui.pid()) !== -1 && !mine) {
          wrap.appendChild(inputBar(ui, '用一句话描述你的词（别暴露）…', function (v) { ui.send({ t: 'desc', text: v }); }));
        }
      } else if (g.phase === 'vote' || g.phase === 'revote') {
        var descHtml = (g.desc || []).map(function (d) {
          return '<div class="listitem"><div class="who">' + esc(d.name) + '</div><div class="what">' + esc(d.text) + '</div></div>';
        }).join('');
        if (descHtml) body.appendChild(ui.h('<div class="card"><div class="muted" style="margin-bottom:8px">大家的描述</div><div class="list">' + descHtml + '</div></div>'));
        body.appendChild(ui.h('<div class="card"><div class="muted" style="margin-bottom:10px">' + (g.phase === 'revote' ? '平票！只能投这些人：' : '投票淘汰一个人（不能投自己）') + '</div></div>'));
        body.appendChild(pickGrid(ui, state, g, g.phase === 'revote' ? g.revotePool : null, g.votes));
        body.appendChild(ui.h('<div class="muted center mt8">已投 ' + Object.keys(g.votes || {}).length + '/' + (g.alive || []).length + '</div>'));
      } else if (g.phase === 'blankGuess') {
        // 白板身份只在私密通道里（state.g 绝不能带 blankId，那等于公开谁是白板）
        if (secret && secret.guess === true) {
          wrap.appendChild(inputBar(ui, '你只有一次机会：猜平民词是？', function (v) { ui.send({ t: 'blankGuess', word: v }); }));
        } else {
          body.appendChild(ui.h('<div class="card center"><div class="bigword">🃏</div><div class="muted">白板正在猜词…</div></div>'));
        }
      }
      wrap.appendChild(body);
      wrap.appendChild(ui.renderGameFooter());
      return wrap;
    },
    onRecover: function (obj) {
      var ui = this;
      var s = ui.secrets.undercover && ui.secrets.undercover.mine;
      if (s && s.role) ui.send({ t: 'recover', word: s.word, role: s.role });
    },
    onReveal: function (obj) {
      var ui = this;
      if (obj && obj.words) {
        ui.toast('🎭 两个词是「' + obj.words[0] + '」vs「' + obj.words[1] + '」，卧底词：「' + obj.underWord + '」', 'good');
      }
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
