/* ===== 游戏屏通用组件（头部/玩家宫格/积分榜/结束按钮） ===== */
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

  /* ===== 统一游戏卡片 + 游戏目录（入口系统升级） =====
   * 以前大厅有"联机游戏卡片"和"小游戏厅卡片"两套渲染代码，加一款游戏要改两处。
   * 现在两款卡片共用同一个函数与同一套视觉，入口只依赖 catalog()：新增游戏只写数据。
   * 兼容：卡片同时保留旧类名（modecard / mini-card），旧的查询与测试不受影响。 */
  function gameCard(o) {
    o = o || {};
    var cls = 'gcard ' + (o.kind === 'mini' ? 'mini-card' : 'modecard');
    var attrs = '';
    if (o.kind === 'mini') attrs = ' data-mini="' + esc(o.id) + '"';
    else attrs = ' data-mode="' + esc(o.id) + '"';
    var tags = (o.tags || []).filter(Boolean).map(function (t) {
      return '<span class="gc-tag">' + esc(t) + '</span>';
    }).join('');
    var meta = [];
    if (o.kind === 'mini') meta.push('单机/同屏');
    else if (o.players) meta.push(o.players + ' 人');
    return '<div class="' + cls + '"' + attrs + '>' +
      '<div class="gc-ico">' + (o.emoji || '🎮') + '</div>' +
      '<div class="gc-nm">' + esc(o.title || '') + '</div>' +
      '<div class="gc-desc">' + esc(o.desc || '') + '</div>' +
      '<div class="gc-meta">' + (tags ? '<span class="gc-tags">' + tags + '</span>' : '') +
      (meta.length ? '<span class="gc-num">' + esc(meta.join(' · ')) + '</span>' : '') + '</div>' +
      (o.actions || '') +
      '</div>';
  }

  /** 游戏目录：联机游戏（PN.games）+ 小游戏厅（data/mini.json）合成一份视图 */
  function catalog() {
    var list = [];
    for (var k in PN.games) if (Object.prototype.hasOwnProperty.call(PN.games, k)) {
      var g = PN.games[k], m = g.meta || {};
      list.push({
        kind: 'online', id: k, emoji: g.emoji, title: g.name, desc: g.blurb,
        group: m.group || 'online', tags: m.tags || [], origin: m.origin || null,
        players: g.maxPlayers && g.maxPlayers > (g.minPlayers || 2)
          ? (g.minPlayers || 2) + '–' + g.maxPlayers : ((g.minPlayers || 2) + '')
      });
    }
    var minis = (PN.Banks && PN.Banks.mini) ? PN.Banks.mini() : [];
    for (var i = 0; i < minis.length; i++) {
      var mm = minis[i];
      list.push({
        kind: 'mini', id: mm.id, emoji: mm.emoji, title: mm.title, desc: mm.desc,
        group: 'mini', tags: [mm.cat], dir: mm.dir,
        origin: { site: 'deepdemos.top', slug: mm.id }
      });
    }
    return list;
  }

  /** 目录分区：固定顺序 = 联机双人 → 小游戏厅 → 其它（同组内保持原顺序） */
  var GROUP_ORDER = ['online', 'mini', 'solo'];
  function sections(list) {
    var by = {}, out = [];
    (list || []).forEach(function (it) { (by[it.group] = by[it.group] || []).push(it); });
    GROUP_ORDER.forEach(function (g) { if (by[g] && by[g].length) { out.push({ group: g, items: by[g] }); delete by[g]; } });
    Object.keys(by).forEach(function (g) { out.push({ group: g, items: by[g] }); });
    return out;
  }

  var GROUP_TITLE = {
    online: '👫 两个人一起玩（联机）',
    mini: '🎮 小游戏厅',
    solo: '🧸 一个人玩'
  };
  var GROUP_SUB = {
    online: '两个人各拿一台设备，房间号对上就能一起玩',
    mini: '单机 / 同屏双人 · 点开就能玩，不用等对方',
    solo: '自己玩的小游戏'
  };

  PN.gameCommon = {
    gameHeader: gameHeader, deadlineChip: deadlineChip, fmtLeft: fmtLeft,
    playerGrid: playerGrid, scoreboard: scoreboard, overButtons: overButtons,
    // 入口系统（阶段三新增）
    gameCard: gameCard, catalog: catalog, sections: sections,
    groupTitle: GROUP_TITLE, groupSub: GROUP_SUB
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

  PN.screens = PN.screens || {};

  function wireOver(btns, ui) {
    btns.querySelectorAll('[data-over]').forEach(function (b) {
      b.addEventListener('click', function () { ui.send({ t: b.getAttribute('data-over') }); });
    });
  }
  PN.wireOver = wireOver;
})(typeof globalThis !== 'undefined' ? globalThis : this);
