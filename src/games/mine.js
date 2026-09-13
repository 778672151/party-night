/* ===== 扫雷（双人合作）=====
 *
 * 规则移植自 deepdemos.top 作品《扫雷》（slug demo-b9f6349a，见 README 来源与致谢）：
 *   8 邻居计数、0 格自动泛洪展开（跳过插旗格）、首点保证安全 —— 判定逻辑与其一致。
 * 有意不实现：那套"生成可解题面"的约束求解器（几千行），我们用经典的随机布雷 + 首点安全，
 *   合作模式下两个人一起推理，比保证可解更重要。
 *
 * 双人改编（原作是单机）：
 *   - **共享一张雷图**，两个人**轮流**点一格（合作，不是各打各的）
 *   - 踩到雷不再一局结束，而是**扣一条命**（默认 3 条），扣完才算输
 *   - 把所有非雷格翻开 → 一起赢（双方 +2）；命扣完 → 这局输（不加分）
 *   - 插旗只是做笔记，不计分也不限次数（合作时方便商量） */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  var ID = 'mine';
  var NAME = '扫雷';
  var EMOJI = '💣';

  function participants(host) {
    var g = host.g();
    return ((g && g.players) || []).filter(function (id) { return !!host.player(id); });
  }
  function nameOf(host, pid) { var p = host.player(pid); return p ? p.name : '?'; }
  function inB(rows, cols, r, c) { return r >= 0 && r < rows && c >= 0 && c < cols; }

  /** 8 邻居的下标（移植自原作的 neighbors） */
  function neighbors(rows, cols, i) {
    var r = Math.floor(i / cols), c = i % cols, out = [];
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        if (inB(rows, cols, r + dr, c + dc)) out.push((r + dr) * cols + (c + dc));
      }
    }
    return out;
  }

  /** 首点之后才布雷：首点及其 8 邻居都不放雷（保证开局点下去一定安全、且能展开一片） */
  function genBoard(rows, cols, mines, safeIdx) {
    var n = rows * cols;
    var banned = {};
    banned[safeIdx] = 1;
    neighbors(rows, cols, safeIdx).forEach(function (i) { banned[i] = 1; });
    var pool = [];
    for (var i = 0; i < n; i++) if (!banned[i]) pool.push(i);
    // 洗牌后取前 mines 个（池子不够就放宽到只排除首点）
    if (pool.length < mines) {
      pool = [];
      for (var j = 0; j < n; j++) if (j !== safeIdx) pool.push(j);
    }
    for (var k = pool.length - 1; k > 0; k--) {
      var s = Math.floor(Math.random() * (k + 1)), t = pool[k];
      pool[k] = pool[s]; pool[s] = t;
    }
    var board = new Array(n);
    for (var a = 0; a < n; a++) board[a] = 0;
    for (var m = 0; m < mines && m < pool.length; m++) board[pool[m]] = -1;
    for (var b = 0; b < n; b++) {
      if (board[b] === -1) continue;
      var cnt = 0;
      neighbors(rows, cols, b).forEach(function (nb) { if (board[nb] === -1) cnt++; });
      board[b] = cnt;
    }
    return board;
  }

  /** 翻开一格；0 格自动泛洪（跳过已翻/已插旗）。返回本次新翻开的数量 */
  function floodReveal(g, startIdx) {
    var stack = [startIdx], seen = {}, opened = 0;
    while (stack.length) {
      var i = stack.pop();
      if (seen[i] || g.revealed[i] || g.flagged[i]) continue;
      seen[i] = 1;
      g.revealed[i] = true;
      opened++;
      if (g.board[i] === 0) {
        neighbors(g.rows, g.cols, i).forEach(function (nb) {
          if (!g.flagged[nb] && !g.revealed[nb]) stack.push(nb);
        });
      }
    }
    return opened;
  }
  function openedCount(g) {
    var n = 0;
    for (var i = 0; i < g.revealed.length; i++) if (g.revealed[i]) n++;
    return n;
  }
  function safeTotal(g) { return g.rows * g.cols - g.mines; }

  function settle(host, win) {
    var g = host.g();
    g.phase = 'over';
    g.win = !!win;
    if (win) {
      participants(host).forEach(function (id) { host.addScore(id, 2); });
      host.toast('🧹 一起扫干净了！双方各 +2 分', 'good');
    } else {
      host.toast('💥 命用完了…这局没扫完，下次一起再来', 'info');
    }
    host.event({
      t: 'gameover',
      players: participants(host).map(function (id) {
        var p = host.player(id);
        return { id: id, name: p ? p.name : '?', score: p ? p.score : 0 };
      })
    });
    host.emit();
  }
  function nextTurn(host) {
    var g = host.g();
    g.turnIdx = 1 - g.turnIdx;
    host.emit();
  }

  var game = {
    id: ID,
    name: NAME,
    emoji: EMOJI,
    blurb: '两个人轮流点，共享一张雷图，一起扫干净 🧹',
    minPlayers: 2,
    maxPlayers: 2,
    meta: { group: 'online', tags: ['合作', '推理'], origin: { site: 'deepdemos.top', slug: 'demo-b9f6349a' } },

    init: function (host) {
      var s = host.state;
      var settings = s.settings.mine || (s.settings.mine = {});
      s.phase = 'round';
      var ps = host.onlinePlayers().slice(0, 2);
      if (ps.length < 2) { host.toast('扫雷要两个人一起排哦', 'info'); host.goLobby(); return; }
      var level = Number(settings.level) || 1;
      var cfgs = { 1: [9, 9, 10], 2: [12, 12, 24], 3: [15, 15, 40] };
      var cfg = cfgs[level] || cfgs[1];
      var lives = Number(settings.lives) || 3;
      if ([1, 3, 5].indexOf(lives) < 0) lives = 3;

      s.g = {
        rows: cfg[0], cols: cfg[1], mines: cfg[2], lives: lives,
        board: null,                       // 首点之后才生成（首点安全）
        revealed: new Array(cfg[0] * cfg[1]).fill(false),
        flagged: new Array(cfg[0] * cfg[1]).fill(false),
        hit: [], last: null, turnIdx: 0,
        players: ps.map(function (p) { return p.id; }),
        phase: 'play', win: false
      };
      host.toast('🧹 ' + nameOf(host, s.g.players[0]) + ' 先手 · 共享雷图，轮流点一格', 'good');
      host.emit();
      return true;
    },

    action: function (host, action, from) {
      var g = host.g();
      if (!g) return;
      if (action.t === 'lobby') { if (host.amHost(from)) host.goLobby(); return; }
      if (action.t === 'again') { if (host.amHost(from)) this.init(host); return; }
      if (g.phase !== 'play') return;
      if (participants(host).indexOf(from) < 0) return;
      if (from !== g.players[g.turnIdx]) return;             // 不是你的回合

      // 注意：autoflag 没有格子参数，所以 i 的校验只能放在需要格子的分支里，
      // 之前放在最前面会把 autoflag 直接挡掉（按钮点了没反应）。
      var i = Number(action.i);
      var hasCell = !isNaN(i) && i >= 0 && i < g.rows * g.cols;

      if (action.t === 'flag') {
        if (!hasCell) return;                              // 插旗/取消：做笔记，不计分
        if (g.revealed[i]) return;
        g.flagged[i] = !g.flagged[i];
        g.last = { i: i, by: from, kind: g.flagged[i] ? 'flag' : 'unflag' };
        nextTurn(host);
        return;
      }

      if (action.t === 'open') {
        if (!hasCell) return;
        if (g.revealed[i] || g.flagged[i]) return;
        if (!g.board) {                                       // 首点：现在才布雷（首点安全）
          g.board = genBoard(g.rows, g.cols, g.mines, i);
          host.toast('🧩 雷布好了，开始排！', 'info');
        }
        if (g.board[i] === -1) {                              // 踩雷：扣命，不是一局结束
          g.revealed[i] = true;
          g.hit.push(i);
          g.lives--;
          g.last = { i: i, by: from, kind: 'boom' };
          host.toast('💥 ' + nameOf(host, from) + ' 踩到雷了！还剩 ' + Math.max(0, g.lives) + ' 条命', 'info');
          if (g.lives <= 0) { settle(host, false); return; }
          nextTurn(host);
          return;
        }
        var opened = floodReveal(g, i);
        g.last = { i: i, by: from, kind: opened > 1 ? 'flood' : 'open' };
        if (openedCount(g) >= safeTotal(g)) { settle(host, true); return; }
        nextTurn(host);
        return;
      }

      if (action.t === 'autoflag') {                          // 把一眼能确定的雷全插上（按已翻数字推）
        var added = 0;
        for (var k = 0; k < g.board.length; k++) {
          if (!g.revealed[k] || g.board[k] <= 0) continue;
          var nbs = neighbors(g.rows, g.cols, k);
          var hidden = nbs.filter(function (nb) { return !g.revealed[nb] && !g.flagged[nb]; });
          var flags = nbs.filter(function (nb) { return g.flagged[nb]; }).length;
          if (g.board[k] - flags === hidden.length && hidden.length > 0) {
            hidden.forEach(function (nb) { g.flagged[nb] = true; added++; });
          }
        }
        if (!added) { host.toast('暂时没有能确定的雷～', 'info'); host.emit(); return; }
        g.last = { i: -1, by: from, kind: 'autoflag' };
        host.toast('🚩 自动插上 ' + added + ' 面旗', 'good');
        nextTurn(host);
        return;
      }
    },

    resume: function (host) {
      var g = host.g();
      if (!g) return;
      host.emit();
    },

    onLeave: function (host, id) {
      var g = host.g();
      if (!g || g.phase === 'over') return;
      if ((g.players || []).indexOf(id) < 0) return;
      var still = (g.players || []).filter(function (pid) { var p = host.player(pid); return p && p.online; });
      if (still.length < 2) {
        host.toast('对方离开了，这局先到这儿～', 'info');
        settle(host, false);
      }
    },

    /** 给测试与界面用：纯函数 */
    _rules: { neighbors: neighbors, genBoard: genBoard, floodReveal: floodReveal, safeTotal: safeTotal, openedCount: openedCount }
  };

  PN.games[ID] = game;
})(typeof globalThis !== 'undefined' ? globalThis : this);
