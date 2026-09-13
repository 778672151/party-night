/* ===== 五子棋：双人回合制 =====
 *
 * 规则与判定移植自 deepdemos.top 作品《实时胜率五子棋》的引擎（见 README 的「来源与致谢」）：
 *   checkWin / wouldFive 的判定逻辑与它一致 —— 四方向数连子，>=5 即胜（自由五子棋，无禁手）。
 *
 * 与来源作品的差异（有意为之）：
 *  - 来源是本地人机/双人 + AI 胜率分析；这里是**双人在线对战**，所以不需要 AI：
 *    棋盘、轮到谁、胜负、悔棋全部由房主判定并广播，客户端只画。
 *  - 悔棋改成**需要对方同意**：单机可以随便撤，联机得商量（这也是双人互动的一部分）。
 *  - 棋盘尺寸可配（15/13/9），9×9 更适合两个人快速来一局。 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  var ID = 'gomoku';
  var NAME = '五子棋';
  var EMOJI = '⚫';
  var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  var EMPTY = 0, BLACK = 1, WHITE = 2;

  function participants(host) { return (host.g().players || []).filter(function (id) { return !!host.player(id); }); }
  function onlineParticipants(host) {
    return participants(host).filter(function (id) { var p = host.player(id); return p && p.online; });
  }
  function inB(n, x, y) { return x >= 0 && x < n && y >= 0 && y < n; }

  /** 以 (x,y) 落点为中心，四个方向数同色连子；返回连成的那串坐标（>=5）或 null */
  function checkWin(board, n, x, y) {
    var p = board[y * n + x];
    if (!p) return null;
    for (var d = 0; d < 4; d++) {
      var dx = DIRS[d][0], dy = DIRS[d][1], cells = [[x, y]], s, nx, ny;
      for (s = 1; s < n; s++) {
        nx = x + dx * s; ny = y + dy * s;
        if (!inB(n, nx, ny) || board[ny * n + nx] !== p) break;
        cells.push([nx, ny]);
      }
      for (s = 1; s < n; s++) {
        nx = x - dx * s; ny = y - dy * s;
        if (!inB(n, nx, ny) || board[ny * n + nx] !== p) break;
        cells.unshift([nx, ny]);
      }
      if (cells.length >= 5) return cells;
    }
    return null;
  }
  function boardFull(board) {
    for (var i = 0; i < board.length; i++) if (!board[i]) return false;
    return true;
  }
  function colorOf(g, pid) {
    return (g.players && g.players[0] === pid) ? BLACK : WHITE;
  }
  function nameOf(host, pid) {
    var p = host.player(pid);
    return p ? p.name : '?';
  }

  function finish(host, winner, winCells) {
    var g = host.g();
    g.phase = 'over';
    g.winner = winner;                 // 0=平局, 1/2=颜色
    g.winCells = winCells || [];
    g.pending = null;
    if (winner) {
      var pid = (g.players[0] && colorOf(g, g.players[0]) === winner) ? g.players[0] : g.players[1];
      if (pid) host.addScore(pid, 2);
      host.toast('🎉 ' + nameOf(host, pid) + ' 连成五子了！', 'good');
    } else {
      participants(host).forEach(function (id) { host.addScore(id, 1); });
      host.toast('棋盘满了，平局～', 'info');
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

  /** 悔棋：撤销最后一步（双方商量好之后调用） */
  function doUndo(host) {
    var g = host.g();
    if (!g.moves.length) return false;
    var m = g.moves.pop();
    g.board[m.i] = EMPTY;
    g.turn = m.color;
    g.winner = 0; g.winCells = [];
    g.last = g.moves.length ? { x: g.moves[g.moves.length - 1].x, y: g.moves[g.moves.length - 1].y } : null;
    g.pending = null;
    host.toast('悔棋成功，轮到 ' + nameOf(host, g.players[g.turn - 1]) + ' 重下', 'info');
    host.emit();
    return true;
  }

  var game = {
    id: ID,
    name: NAME,
    emoji: EMOJI,
    blurb: '黑先白后，先连成五子的人赢 ⚫⚪',
    meta: { group: 'online', tags: ['棋类', '对弈'], origin: { site: 'deepdemos.top', slug: 'demo-ce927755' } },
    minPlayers: 2,
    maxPlayers: 2,

    init: function (host) {
      var s = host.state;
      var settings = s.settings.gomoku || (s.settings.gomoku = { size: 15 });
      s.phase = 'round';
      var ps = host.onlinePlayers().slice(0, 2);
      if (ps.length < 2) { host.toast('五子棋要两个人才能下哦', 'info'); host.goLobby(); return; }

      var n = Number(settings.size) || 15;
      if ([9, 13, 15].indexOf(n) < 0) n = 15;
      var order = ps.map(function (p) { return p.id; });
      // 随机决定谁执黑（先手）—— 每次都换运气，免得总是一个人先走
      if (Math.random() < 0.5) order.reverse();

      s.g = {
        n: n,
        board: new Array(n * n).fill(EMPTY),
        turn: BLACK,
        winner: 0,
        winCells: [],
        last: null,
        moves: [],
        pending: null,            // { by: pid } 正在等对方同意的悔棋请求
        players: order,           // players[0] 执黑
        phase: 'play',
        startedAt: host.now()
      };
      host.toast('⚫ ' + nameOf(host, order[0]) + ' 执黑先走，五子连珠即胜', 'good');
      host.emit();
      return true;
    },

    action: function (host, action, from) {
      var g = host.g();
      if (!g) return;
      if (action.t === 'lobby') { if (host.amHost(from)) host.goLobby(); return; }
      if (action.t === 'again') { if (host.amHost(from)) this.init(host); return; }

      if (action.t === 'place') {
        if (g.phase !== 'play' || g.pending) return;          // 等悔棋结果的时候先别走
        if (participants(host).indexOf(from) < 0) return;      // 旁观者不能下
        var color = colorOf(g, from);
        if (color !== g.turn) return;                          // 不是你的回合
        var x = Number(action.x), y = Number(action.y);
        if (isNaN(x) || isNaN(y) || !inB(g.n, x, y)) return;
        var i = y * g.n + x;
        if (g.board[i] !== EMPTY) return;                      // 已经有子
        g.board[i] = color;
        g.moves.push({ x: x, y: y, i: i, color: color });
        g.last = { x: x, y: y };
        var win = checkWin(g.board, g.n, x, y);
        if (win) { finish(host, color, win); return; }
        if (boardFull(g.board)) { finish(host, 0, []); return; }
        g.turn = (color === BLACK) ? WHITE : BLACK;
        host.emit();
        return;
      }

      // 悔棋：发起方请求 → 对方同意才撤
      if (action.t === 'undo-req') {
        if (g.phase !== 'play' || g.pending) return;
        if (participants(host).indexOf(from) < 0) return;
        if (!g.moves.length) { host.toast('还没落子呢', 'info'); return; }
        g.pending = { by: from };
        host.toast('🙋 ' + nameOf(host, from) + ' 想悔一步棋', 'info');
        host.emit();
        return;
      }
      if (action.t === 'undo-answer') {
        if (!g.pending) return;
        if (g.pending.by === from) return;                     // 自己不能同意自己
        if (participants(host).indexOf(from) < 0) return;
        var by = g.pending.by;
        g.pending = null;
        if (action.ok) doUndo(host);
        else { host.toast('对方不同意悔棋，继续～', 'info'); host.emit(); }
        return;
      }

      // 新人/重连：棋盘在 state 里，自己就同步了（这里是留个口子做兜底日志）
      if (action.t === '_joined' || action.t === 'hi') return;
    },

    /** 换主：状态全在 g 里，重挂即可 —— 只有 pending（悔棋请求）要清掉，免得卡住 */
    resume: function (host) {
      var g = host.g();
      if (!g) return;
      if (g.phase === 'play' && g.pending) {
        g.pending = null;
        host.toast('换房主了，刚才的悔棋请求作废，继续下～', 'info');
      }
      host.emit();
    },

    onLeave: function (host, id) {
      var g = host.g();
      if (!g || g.phase === 'over') return;
      if ((g.players || []).indexOf(id) < 0) return;
      if (onlineParticipants(host).length < 2) {
        host.toast('对方离开了，这盘先到这儿～', 'info');
        finish(host, 0, []);
      }
    },

    /** 给测试和界面用：暴露纯函数判定（不改状态） */
    _rules: { checkWin: checkWin, boardFull: boardFull, BLACK: BLACK, WHITE: WHITE, EMPTY: EMPTY }
  };

  PN.games[ID] = game;
})(typeof globalThis !== 'undefined' ? globalThis : this);
