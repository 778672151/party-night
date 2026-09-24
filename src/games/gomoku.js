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

  /* ===== 机器人棋力（纯函数，见 src/bots.js）=====
   * 窗口评估法：把「我正在考虑落的那颗子」当中心，四个方向各取 9 格，
   * 编成一行 我=1 / 对方=2 / 空=0 / 墙=3 的字，再用棋型表打分。
   * 这是五子棋评估最省事又够准的写法。够陪人玩，不追求最强。 */
  var PATTERNS = [
    [/11111/g, 500000],                                              // 连五
    [/011110/g, 50000],                                              // 活四
    [/11110|01111|11011|10111|11101/g, 8000],                        // 冲四
    [/01110|010110|011010/g, 7000],                                  // 活三
    [/11100|00111|11010|01011|10110|01101|10011|11001|10101/g, 900], // 眠三
    [/00110|01100|01010/g, 300],                                     // 活二
    [/11000|00011|10100|00101|10010|01001/g, 60]                     // 眠二
  ];

  /** 把 (x,y) 当成「me 的子」放上去，四方向窗口打分求和 */
  function scoreAt(board, n, x, y, me) {
    var total = 0;
    for (var d = 0; d < 4; d++) {
      var s = '';
      for (var k = -4; k <= 4; k++) {
        if (k === 0) { s += '1'; continue; }
        var nx = x + DIRS[d][0] * k, ny = y + DIRS[d][1] * k;
        if (!inB(n, nx, ny)) { s += '3'; continue; }   // 棋盘外算「堵」，边上的四不算活四
        var v = board[ny * n + nx];
        s += v === EMPTY ? '0' : (v === me ? '1' : '2');
      }
      for (var p = 0; p < PATTERNS.length; p++) {
        var m = s.match(PATTERNS[p][0]);
        if (m) total += m.length * PATTERNS[p][1];
      }
    }
    return total;
  }

  /** 候选落点：已有子附近 2 格内的空点（又快，也不会跑到空旷角落自己玩） */
  function candidates(board, n) {
    var cands = [], x, y;
    for (y = 0; y < n; y++) for (x = 0; x < n; x++) {
      if (board[y * n + x] !== EMPTY) continue;
      var near = false;
      for (var dy = -2; dy <= 2 && !near; dy++) for (var dx = -2; dx <= 2; dx++) {
        var ny = y + dy, nx = x + dx;
        if (inB(n, nx, ny) && board[ny * n + nx] !== EMPTY) { near = true; break; }
      }
      if (near) cands.push([x, y]);
    }
    return cands;
  }

  /** 这一步下完之后，对方最狠的一手能拿到多少分（只用来给"困难"做一层保险） */
  function oppBestReply(board, n, me) {
    var opp = me === BLACK ? WHITE : BLACK;
    var list = candidates(board, n), best = 0;
    for (var i = 0; i < list.length; i++) {
      var s = scoreAt(board, n, list[i][0], list[i][1], opp);
      if (s > best) best = s;
    }
    return best;
  }

  var WIN_SCORE = 500000;   // 与 PATTERNS 里"连五"同档，用来判"这手直接赢"

  /** 选落点。difficulty：'easy' | 'normal' | 'hard'
   *  ① 我能连五就直接赢（三档都会赢，机器人不能"故意不赢"那太假）
   *  ② 对方能连五就必须堵（**简单档会漏堵**，这正是它可被击败的原因）
   *  ③ 否则按「自己成形 − 0.85×对方成形」挑；
   *     困难档再加一层：把对方下一手能拿到的分也算进代价里，避免走出"自己成型但被对方反杀"的棋。 */
  function bestMove(g, me, difficulty) {
    var n = g.n, board = g.board, opp = me === BLACK ? WHITE : BLACK;
    var level = difficulty || 'normal';
    // 空盘就下天元。判据用**棋盘**而不是 g.moves：moves 只是记账数组，
    // 只要有一方是从中间接手的局面（换房主 / 测试构造），两者就可能不一致。
    var any = false;
    for (var q = 0; q < board.length; q++) if (board[q] !== EMPTY) { any = true; break; }
    if (!any) return [Math.floor(n / 2), Math.floor(n / 2)];
    var cands = candidates(board, n), x, y, i;
    if (!cands.length) return null;   // 满盘（或全被堵死）：没有可下的点，交给调用方处理
    // ① 自己能赢：三档都直接赢（"故意不赢"会显得很假，反而破坏体验）
    for (i = 0; i < cands.length; i++) {
      x = cands[i][0]; y = cands[i][1];
      board[y * n + x] = me;
      var win = checkWin(board, n, x, y);
      board[y * n + x] = EMPTY;
      if (win) return [x, y];
    }
    // ② 对方下一步能赢 → 堵。简单档有一半概率看不见（这就是新手能赢它的原因）
    var blocks = [];
    for (i = 0; i < cands.length; i++) {
      x = cands[i][0]; y = cands[i][1];
      board[y * n + x] = opp;
      var lose = checkWin(board, n, x, y);
      board[y * n + x] = EMPTY;
      if (lose) blocks.push([x, y]);
    }
    if (blocks.length) {
      if (level === 'easy' && Math.random() < 0.5) {
        // 假装没看见：改去下自己最有把握的点（但仍可能顺手挡住）
      } else {
        return blocks[0];
      }
    }
    // ③ 成形分：自己进攻略高于替对方防守
    var scored = [];
    for (i = 0; i < cands.length; i++) {
      x = cands[i][0]; y = cands[i][1];
      var sc = scoreAt(board, n, x, y, me) - 0.85 * scoreAt(board, n, x, y, opp);
      scored.push({ p: [x, y], s: sc });
    }
    scored.sort(function (a, b) { return b.s - a.s; });
    if (level === 'easy') {
      // 简单档：从前几名里**随机**挑一个（不再永远走最优解），新手才有来有回
      var top = scored.slice(0, Math.min(5, scored.length));
      return top[Math.floor(Math.random() * top.length)].p;
    }
    if (level === 'hard') {
      // 困难档：给前几名各算一次「对方最狠的回手」，把自己的分减去对方的反杀威胁。
      // 只算前几名是为了控成本（15×15 全算会明显卡顿）。
      var probe = scored.slice(0, Math.min(8, scored.length));
      var hardBest = probe[0].p, hardScore = -Infinity;
      for (i = 0; i < probe.length; i++) {
        x = probe[i].p[0]; y = probe[i].p[1];
        board[y * n + x] = me;
        var reply = oppBestReply(board, n, me);       // 我下这里之后，对方最狠的一手
        board[y * n + x] = EMPTY;
        // 对方能直接连五 → 这一手等于送输，重罚；否则按对方威胁程度打折
        var val = probe[i].s - (reply >= WIN_SCORE ? 2000000 : reply * 1.1);
        if (val > hardScore) { hardScore = val; hardBest = probe[i].p; }
      }
      return hardBest;
    }
    return scored[0].p;
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

    /* ===== 机器人对手：纯函数，只读 g，不改任何状态 ===== */
    botTurn: function (host) {
      var g = host.g();
      if (!g || g.phase !== 'play') return null;
      var me = null, i;
      for (i = 0; i < 2; i++) if (PN.bots && PN.bots.isBotId(g.players[i])) { me = g.players[i]; break; }
      if (!me) return null;
      // 对方请求悔棋：机器人一律同意（这是陪人玩，不是较劲）
      if (g.pending && g.pending.by !== me) return { pid: me, action: { t: 'undo-answer', ok: true } };
      if (g.pending) return null;                       // 自己提的悔棋，等对方答
      if (colorOf(g, me) !== g.turn) return null;       // 没轮到机器人
      var diff = ((host.state.settings || {}).gomoku || {}).difficulty || 'normal';
      var mv = bestMove(g, colorOf(g, me), diff);
      if (!mv) return null;
      return { pid: me, action: { t: 'place', x: mv[0], y: mv[1] } };
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
