/* ===== 骨牌顶牛 屏幕（复用原作 + 双人兼容）=====
 *
 * 画面/牌谱/规则/动画/UI 全部是原作（mini/demo-c046ab75），我们只做：
 *   ① iframe 跑它，注入桥接（不改原作任何文件）
 *   ② 用固定种子的 PRNG 覆盖 iframe 里的 Math.random —— 原作摇色子/洗牌是随机的，
 *      两端必须同种子才可能局面一致（房主的种子通过桥接下发）
 *   ③ 包一层 game.playTile / game.passTurn：本地动作**只上报、不落地**，
 *      房主权威广播回来后才用原函数真正落地 —— 两端因此必然一致，
 *      也顺带绕开了"出牌依赖 selectedTileId/selectedEnd 这些本地选择态"的同步难题（动作里自带 tileId/end/side）
 *   ④ 游玩期间绝不重建 DOM（重排 iframe 会让原作重新加载） */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};
  var esc = PN.esc;

  var BRIDGE = [
    '(function(){',
    'if (window.__pnDomino) return; window.__pnDomino = 1;',
    'var D = document, seed = null, orig = {}, applied = 0, lastRound = -1, overSent = false, inGame = false;',
    'function post(m){ try { m.pn = "domino"; parent.postMessage(m, "*"); } catch (e) {} }',
    'function rng(s){ var a = s >>> 0; return function(){ a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }',
    'function has(){ try { return typeof game !== "undefined" && !!game && !!game.players; } catch (e) { return false; } }',
    // 进入游戏：直接进 dingniu（原作是 onclick=enterGame('dingniu')）
    'function enter(){',
    '  if (inGame) return true;',
    '  try { if (typeof localMode !== "undefined") { localMode = true; localReady = true; } } catch (e) {}',
    '  try { if (typeof enterGame === "function") { enterGame("dingniu"); inGame = true; return true; } } catch (e) {}',
    '  return false;',
    '}',
    // 原作的进入牌局流程：开始游戏 → 摇色子（定庄）→ 开始对局。种子已固定，两端结果一致
    'function advance(){',
    '  try {',
    '    if (has() && String(game.phase) === "playing") return true;',
    '    if (!window.__pnDiced) { window.__pnDiced = 1;',
    '      if (typeof showDiceRoll === "function") showDiceRoll();',
    '      setTimeout(function(){ try { if (typeof rollDice === "function") rollDice(); } catch (e) {} }, 350);',
    '      setTimeout(function(){ try { if (typeof startGameWithDealer === "function") startGameWithDealer(); } catch (e) {} }, 900);',
    '    }',
    '  } catch (e) { post({ t: "err", msg: "advance " + (e && e.message) }); }',
    '  return false;',
    '}',
    // 包 playTile / passTurn：本地调用只上报；__pnApply 才真正落地
    'function wrap(){',
    '  if (!has() || orig.play) return;',
    '  orig.play = game.playTile;',
    '  orig.pass = game.passTurn;',
    '  game.playTile = function(seat, tileId, end, side){',
    '    post({ t: "act", kind: "play", seat: seat, tileId: tileId, end: end, side: side });',
    '    return { success: true, msg: "pending" };',           // 别弹 alert：由房主权威说了算
    '  };',
    '  game.passTurn = function(seat, tileId){',
    '    post({ t: "act", kind: "pass", seat: seat, tileId: tileId });',
    '    return { success: true, msg: "pending" };',
    '  };',
    '  window.__pnApply = function(a){',
    '    try {',
    '      if (a.kind === "play") orig.play.call(game, a.seat, a.tileId, a.end, a.side);',
    '      else if (a.kind === "pass") orig.pass.call(game, a.seat, a.tileId);',
    '      if (typeof refreshAll === "function") refreshAll();',
    '    } catch (e) { post({ t: "err", msg: String(e && e.message) }); }',
    '  };',
    '}',
    // 装种子：必须在摇色子/发牌之前
    'function installSeed(s){',
    '  if (seed === s) return;',
    '  seed = s;',
    '  try { Math.random = rng(s); } catch (e) {}',              // 只影响这个 iframe 里的原作
    '}',
    'function tick(){',
    '  if (seed == null) { post({ t: "hello" }); return; }',     // 等房主下发种子
    '  if (!enter()) { post({ t: "st", ready: false }); return; }',
    // 注意顺序：advance() 必须在 has() 检查之前 —— 开局前 game 是 null，
    // 先判 has() 会直接 return，推进逻辑永远走不到（这个顺序坑踩过）。
    '  advance();',
    '  wrap();',
    '  if (!has()) { post({ t: "st", ready: false }); return; }',
    '  if (String(game.phase) !== "playing") { post({ t: "st", ready: false, phase: String(game.phase) }); return; }',
    '  for (var i = 0; i < 4; i++) seats.push((game.scores && game.scores[i]) || 0);',
    '  var over = false;',
    '  try { over = (game.phase === "SETTLING") || (game.phase === "WAITING" && game.round > 0); } catch (e) {}',
    '  var rnd = (typeof game.round === "number") ? game.round : 0;',
    '  if (over && !overSent && rnd !== lastRound) {',
    '    lastRound = rnd; overSent = true;',
    '    post({ t: "roundover", seats: seats });',
    '    setTimeout(function(){ overSent = false; }, 1500);',
    '  }',
    '  post({ t: "st", ready: true, seat: game.currentPlayer | 0, seats: seats, phase: String(game.phase), round: rnd });',
    '}',
    'setInterval(tick, 250);',
    'window.addEventListener("message", function(e){',
    '  var m = e.data || {}; if (!m || m.pn !== "domino") return;',
    '  if (m.t === "seed") installSeed(m.seed);',
    '  else if (m.t === "apply") { var f = window.__pnApply; if (f) f(m.act); }',
    '  else if (m.t === "restart") { try { if (typeof restartGame === "function") restartGame(); else location.reload(); } catch (e) { location.reload(); } }',
    '});',
    '})();'
  ].join('\n');

  var S = {
    frame: null, ready: false, applied: 0, sentAt: 0, seed: 0, seat: 0,
    seats: [0, 0, 0, 0], overSentFor: -1, ui: null, mounted: false, poller: null, lastSeat: -1
  };

  function frameWin() { try { return S.frame && S.frame.contentWindow; } catch (e) { return null; } }
  function bpost(m) { var w = frameWin(); if (!w) return; try { w.postMessage(Object.assign({ pn: 'domino' }, m), '*'); } catch (e) {} }
  function ensureBridge() {
    var w = frameWin(), d = null;
    if (!w) return;
    try { d = S.frame.contentDocument; } catch (e) { return; }
    if (!d || !d.body) return;
    if (w.__pnDomino) return;
    try {
      var sc = d.createElement('script');
      sc.textContent = BRIDGE;
      d.body.appendChild(sc);
      S.injected = (S.injected || 0) + 1;
    } catch (e) { S.injectErr = String(e && e.message); }
  }

  /** 权威日志 → 桥接：把还没落地的动作按顺序补上（幂等，靠 applied 计数） */
  function applyLog() {
    var ui = S.ui, g = ui && ui.state && ui.state.g;
    if (!ui || !g) return;
    if (g.log.length < S.applied) { S.applied = 0; bpost({ t: 'restart' }); }   // 新一局
    for (var i = S.applied; i < g.log.length; i++) bpost({ t: 'apply', act: g.log[i] });
    if (g.log.length > S.applied) S.applied = g.log.length;
  }

  /** 该出手的座位归谁（0/2 归 A，1/3 归 B） */
  function ownerSeat(g, pid) {
    for (var s = 0; s < 4; s++) if (g.owners && g.owners[s] === pid) { if (s === g.seat) return true; }
    return false;
  }

  function onBridge(m) {
    S.msg = (S.msg || 0) + 1; S.lastMsg = m && m.t;
    var ui = S.ui, g = ui && ui.state && ui.state.g;
    if (!ui || !g) return;
    if (m.t === 'hello') { bpost({ t: 'seed', seed: g.seed }); return; }
    if (m.t === 'err') { console.warn('[domino bridge]', m.msg); return; }
    if (m.t === 'act') {
      // 本地动作只上报；由房主校验座位与轮次
      ui.send({ t: 'act', kind: m.kind, seat: m.seat, tileId: m.tileId, end: m.end, side: m.side });
      return;
    }
    if (m.t === 'roundover') {
      if (S.overSentFor === g.played) return;
      S.overSentFor = g.played;
      var sc = {};
      var pa = g.players[0], pb = g.players[1];
      (m.seats || []).forEach(function (v, i) {
        var owner = g.owners[i]; if (!owner) return;
        sc[owner] = (sc[owner] || 0) + v;
      });
      ui.send({ t: 'roundover', scores: sc });
      return;
    }
    if (m.t === 'st') {
      S.ready = !!m.ready;
      if (!m.ready) return;
      S.seat = m.seat | 0; S.seats = m.seats || S.seats;
      // 把原作的"当前该哪家/每家总分"同步给房主：轮次门禁要用它
      var sc2 = {};
      (S.seats || []).forEach(function (v, i) { var o = g.owners[i]; if (o) sc2[o] = (sc2[o] || 0) + v; });
      var sig = S.seat + '|' + JSON.stringify(sc2);
      if (S.lastSig !== sig) { S.lastSig = sig; ui.send({ t: 'sync', seat: S.seat, scores: sc2 }); }
      var info = document.getElementById('dm-info');
      if (info) {
        var tot = {};
        (m.seats || []).forEach(function (v, i) { var o = g.owners[i]; if (o) tot[o] = (tot[o] || 0) + v; });
        info.textContent = '当前第 ' + ((m.seat | 0) + 1) + ' 家 · ' +
          g.players.map(function (id) { return esc(ui.p(id) ? ui.p(id).name : '?') + ' ' + (tot[id] || 0); }).join(' / ');
      }
      applyLog();
      syncTurn();
    }
  }

  /** 就地更新"轮到谁"（不重建 DOM） */
  function syncTurn() {
    var ui = S.ui, g = ui && ui.state && ui.state.g;
    if (!g) return;
    var me = ui.pid();
    var mine = ownerSeat(g, me);
    var turn = document.getElementById('dm-turn');
    if (turn) {
      turn.className = 'sk-turn' + (mine ? ' mine' : '');
      turn.innerHTML = mine
        ? '<b>🙋 轮到你（你的第 ' + ((g.seat % 2) + 1) + ' 家）</b><span>原作画面里选牌出牌；出牌会先交给房主确认，再同时落到两边</span>'
        : '<b>👀 等对方出牌</b><span>他带 2、4 家，这一手该他</span>';
    }
    var log = document.getElementById('dm-log');
    if (log) log.textContent = '已同步出手 ' + (g.log || []).length + ' 次';
  }

  PN.screens = PN.screens || {};
  PN.screens.domino = {
    name: 'domino',
    debug: function () { return { pollErr: S.pollErr || null, msg: S.msg || 0, lastMsg: S.lastMsg || null, ready: S.ready, applied: S.applied, seat: S.seat, seats: S.seats, injected: S.injected || 0, injectErr: S.injectErr || null }; },
    /** 恒真：游玩期间绝不重建 DOM（重排 iframe 会让原作重新加载，等于白玩） */
    patch: function (state) {
      if (!S.frame || !state.g || state.g.phase === 'over' || state.mode !== 'domino') return false;
      if (state.g.seed == null) return true;
      syncTurn();
      applyLog();
      return true;
    },
    render: function (state, secret) {
      var ui = this;
      var GC = PN.gameCommon;
      var g = state.g || {};
      var me = ui.pid();
      var mine = g.phase === 'play' && ownerSeat(g, me);
      var opp = (g.players || []).filter(function (id) { return id !== me; })[0];
      var oppP = opp ? ui.p(opp) : null;
      var wrap = ui.el('div');
      ui.renderTopbar(wrap);
      wrap.appendChild(ui.h(GC.gameHeader(ui, state, '🀄 骨牌顶牛（合作对局）',
        g.phase === 'over' ? '本局结束' : (mine ? '轮到你' : '等对方'),
        '<span class="pill">原作整包复用</span>')));

      var body = ui.el('div');
      if (g.phase === 'over') {
        var title = g.win ? '打完啦！🎉' : '这局先到这儿～';
        body.appendChild(ui.h('<div class="card center sk-hero"><div class="sk-result">' + esc(title) + '</div>' +
          '<div class="muted mt8">共打 ' + (g.played || 0) + ' 局 · 你带 1、3 家，' + esc(oppP ? oppP.name : '对方') + ' 带 2、4 家</div></div>'));
        body.appendChild(ui.h(GC.scoreboard(state, undefined, '🏆 总积分')));
        var btns = ui.h(GC.overButtons(ui, 'domino'));
        body.appendChild(btns);
        PN.wireOver(btns, ui);
      } else {
        body.appendChild(ui.h('<div class="sk-turn" id="dm-turn"></div>'));
        body.appendChild(ui.h('<div class="sk-hud"><span class="sk-stat" id="dm-info">同步中…</span>' +
          '<span class="sk-stat" id="dm-log">已同步出手 0 次</span></div>'));
        var stage = ui.el('div', 'sk-stage dm-stage');
        var frame = S.frame || (S.frame = ui.el('iframe', 'sk-frame dm-frame'));
        frame.setAttribute('allow', 'autoplay');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        stage.appendChild(frame);
        body.appendChild(stage);
        body.appendChild(ui.h('<div class="muted center mt8">在下面的原作画面里正常出牌；轮次由两边共同决定，出牌不会只落在你这边</div>'));
        var pad = ui.el('div', 'sk-pad');
        var rs = ui.el('button', 'btn ghost sm', '🔄 重开这一局');
        rs.setAttribute('data-reset', '1');
        rs.addEventListener('click', function () { ui.send({ t: 'reset' }); });
        pad.appendChild(rs);
        body.appendChild(pad);

        S.ui = ui; S.applied = 0; S.ready = false; S.injected = 0;
        if (!S.poller) S.poller = setInterval(function () {
          var w = frameWin();
          if (w && w !== S.win) { S.win = w; S.applied = 0; S.msg = 0; }        // iframe 重载过：重放计数归零
          ensureBridge();
          // 直接读 iframe 里的原作状态（contentWindow.eval 读得到顶层 let，实测可靠），
          // 不依赖桥接的定时上报 —— 桥接只管"上报动作"和"落地动作"两件事。
          if (w) {
            try {
              var st = JSON.parse(w.eval('(function(){ try { return JSON.stringify({ ok: (typeof game !== "undefined" && !!game && String(game.phase).toLowerCase() === "playing"), seat: game ? (game.currentPlayer|0) : -1, seats: (game && game.scores) ? game.scores.slice(0,4) : null }); } catch (e) { return JSON.stringify({ ok: false }); } })()'));
              S.ready = !!st.ok;
              if (st.seat >= 0) S.seat = st.seat;
              if (st.seats) S.seats = st.seats;
              var g2 = S.ui && S.ui.state && S.ui.state.g;
              if (g2 && S.ready) {
                var sc = {};
                S.seats.forEach(function (v, i) { var o = g2.owners[i]; if (o) sc[o] = (sc[o] || 0) + v; });
                var sig = S.seat + '|' + JSON.stringify(sc);
                if (S.lastSig !== sig) { S.lastSig = sig; S.ui.send({ t: 'sync', seat: S.seat, scores: sc }); }
              }
            } catch (e) { S.pollErr = String(e && e.message); }
          }
          applyLog();
        }, 300);
        if (!S.mounted) {
          S.mounted = true;
          root.addEventListener('message', function (e) {
            var m = e.data || {};
            if (!m || m.pn !== 'domino') return;   // 只认报文标记：iframe 重载换窗口后也要继续收
            onBridge(m);
          });
        }
        var base0 = ui.local('pn_dombase') || '';
        var mount = function (base) {
          if (!base) { ui.toast('原作文件没找到（要从仓库根目录打开，见 README）', 'info'); return; }
          if (!frame.getAttribute('src')) frame.src = base + 'demo-c046ab75/index.html';
        };
        if (base0) mount(base0);
        else if (ui.miniBase) ui.miniBase(mount);
        else mount('../mini/');
        syncTurn();
      }
      wrap.appendChild(body);
      if (state.phase !== 'over') wrap.appendChild(ui.renderGameFooter());
      return wrap;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
