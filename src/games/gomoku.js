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

  /* ===== 档位参数（**都是量出来的**，不是拍脑袋）=====
   * 目标是"跟朋友玩有意思"，而不是"机器人越强越好"：
   *   · 默认档要让休闲玩家**真的有机会赢**（实测目标 40~55%）；
   *   · 简单档更松（目标 65~80%），困难档才认真下（目标 <=25%）。
   * 三个旋钮：
   *   def        —— 防守权重：最终分 = 我的成形 − def × 对方成形。
   *                 调低 = 只顾自己进攻、不爱堵人 → 玩家容易赢（这是主要的"示弱"手段）
   *   blockFive  —— 对方**下一步就连五**时，去堵的概率（漏掉这一下很致命，所以只在简单档调低）
   *   topN       —— 从评分最高的前 N 个点里随机挑（>1 就有"人味"，不会每盘一模一样）
   *   lookahead  —— 困难档专属：再算一层对方最狠的回手
   * 这些数字是用 test/bots-balance.mjs 反复量出来调定的，改之前请先跑那个脚本。 */
  /* atk = 机器人**自己进攻**的权重。这是最有效、也最不"露怯"的示弱旋钮：
   * 调低它，机器人就不主动做棋（但该堵还是堵），玩家自然有空间；
   * 比"漏堵四连"体面得多 —— 后者会让玩家觉得对面坏了，前者只是"它下得温和"。 */
  /* blunder = **完全不打战术**、随手走一个附近空点的概率。
   * 这是"示弱"里最可靠的一个旋钮：前面几个（atk/def/blockThree）实测调下来只能把
   * 休闲玩家胜率从 ~13% 抬到 ~40%，而且方向不单调（把 atk 调低反而更难赢 ——
   * 因为机器人变成"纯防守"，什么都堵，玩家反而没机会）。
   * 偶尔走一手闲棋，玩家才有真正能抓住的机会。 */
  var LEVELS = {
    easy:   { blunder: 0.70, atk: 0.80, def: 0.85, blockFive: 0.97, blockThree: 0.85, topN: 6, lookahead: false },
    normal: { blunder: 0.52, atk: 0.80, def: 0.85, blockFive: 0.97, blockThree: 0.85, topN: 4, lookahead: false },
    hard:   { blunder: 0.00, atk: 1.00, def: 1.05, blockFive: 1.00, blockThree: 1.00, topN: 1, lookahead: true }
  };
  function levelOf(name) { return LEVELS[name] || LEVELS.normal; }

  /** 选落点。difficulty：'easy' | 'normal' | 'hard'
   *  ① 我能连五就直接赢（三档都会赢，机器人不能"故意不赢"那太假）
   *  ② 对方能连五就必须堵（简单档有概率漏堵，这是它可被击败的原因之一）
   *  ③ 否则按「自己成形 − def×对方成形」挑，并从分最高的 topN 个里随机取一个；
   *     困难档再补一层：把对方下一手能拿到的分也算进代价里，避免被反杀。 */
  function bestMove(g, me, difficulty) {
    var n = g.n, board = g.board, opp = me === BLACK ? WHITE : BLACK;
    var LV = levelOf(difficulty);
    // 空盘就下天元。判据用**棋盘**而不是 g.moves：moves 只是记账数组，
    // 只要有一方是从中间接手的局面（换房主 / 测试构造），两者就可能不一致。
    var any = false;
    for (var q = 0; q < board.length; q++) if (board[q] !== EMPTY) { any = true; break; }
    if (!any) return [Math.floor(n / 2), Math.floor(n / 2)];
    var cands = candidates(board, n), x, y, i;
    if (!cands.length) return null;   // 满盘（或全被堵死）：没有可下的点，交给调用方处理
    // ① 自己能赢：**三档都直接赢**。这一步必须排在"示弱"前面 ——
    //    实测把它放到 blunder 之后，easy/normal 会有 38~52% 的概率**看不见自己的五连**，
    //    那看起来不是"让着你"，而是"这游戏坏了"。示弱应该表现为"漏堵/不主动做棋"，
    //    而不是"送到嘴边的胜利都不吃"。
    for (i = 0; i < cands.length; i++) {
      x = cands[i][0]; y = cands[i][1];
      board[y * n + x] = me;
      var win = checkWin(board, n, x, y);
      board[y * n + x] = EMPTY;
      if (win) return [x, y];
    }
    // ② 随手走一手（示弱）。放在"我能赢"之后：可以漏堵、可以不做棋，但不能错过自己的胜着。
    //    只从候选（已有子附近）里挑，否则会跑到空角落下棋，看起来像坏了。
    if (LV.blunder && Math.random() < LV.blunder) {
      var b = cands[Math.floor(Math.random() * cands.length)];
      return [b[0], b[1]];
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
    if (blocks.length && Math.random() < LV.blockFive) return blocks[0];
    // 对方有"活三"（再下一手就成活四，基本等于赢）时是否去堵 ——
    // 这是人类赢棋最主要的路径，所以它也是**最有效的示弱旋钮**。
    if (LV.blockThree < 1 && Math.random() >= LV.blockThree) {
      // 故意不堵活三：直接走第 ③ 步的成形分（仍可能顺手挡到，但不再专门防）
    } else {
      var threes = [];
      for (i = 0; i < cands.length; i++) {
        x = cands[i][0]; y = cands[i][1];
        board[y * n + x] = opp;
        // 堵在这里之后，对方在这一点的四方向里还有没有"三连且两端至少一端空"
        var stillLive = 0;
        for (var d2 = 0; d2 < 4; d2++) {
          var dx2 = DIRS[d2][0], dy2 = DIRS[d2][1], s2 = '';
          for (var k2 = -4; k2 <= 4; k2++) {
            var nx2 = x + dx2 * k2, ny2 = y + dy2 * k2;
            if (k2 === 0) { s2 += '1'; continue; }
            if (!inB(n, nx2, ny2)) { s2 += '3'; continue; }
            var v2 = board[ny2 * n + nx2];
            s2 += v2 === EMPTY ? '0' : (v2 === opp ? '1' : '2');
          }
          if (/0111(0|1)|(0|1)1110|1011|1101/.test(s2)) stillLive++;
        }
        board[y * n + x] = EMPTY;
        if (stillLive >= 2) { threes.push([x, y]); break; }   // 同时还在两条线上成三 = 双三，最该堵
        if (stillLive === 1) threes.push([x, y]);
      }
      if (threes.length) return threes[0];
    }
    // ③ 成形分：我的成形 − def × 对方的成形。def 越小越"只顾自己下"，玩家越容易赢。
    var scored = [];
    for (i = 0; i < cands.length; i++) {
      x = cands[i][0]; y = cands[i][1];
      scored.push({ p: [x, y], s: LV.atk * scoreAt(board, n, x, y, me) - LV.def * scoreAt(board, n, x, y, opp) });
    }
    scored.sort(function (a, b) { return b.s - a.s; });
    if (LV.lookahead) {
      // 困难档：给前几名各算一次「对方最狠的回手」，把反杀代价扣进评分。
      // 只算前几名是为了控成本（15×15 全算会明显卡顿 —— 实测单步 max 13ms，够用）。
      var probe = scored.slice(0, Math.min(8, scored.length));
      var hBest = probe[0].p, hScore = -Infinity;
      for (i = 0; i < probe.length; i++) {
        x = probe[i].p[0]; y = probe[i].p[1];
        board[y * n + x] = me;
        var reply = oppBestReply(board, n, me);
        board[y * n + x] = EMPTY;
        // 对方能直接连五 → 这一手等于送输，重罚；否则按威胁程度打折
        var val = probe[i].s - (reply >= WIN_SCORE ? 2000000 : reply * 1.1);
        if (val > hScore) { hScore = val; hBest = probe[i].p; }
      }
      return hBest;
    }
    // topN > 1 时在前几名里随机挑：不会每盘都走一模一样的棋，玩家也更容易找到机会
    var top = scored.slice(0, Math.min(LV.topN, scored.length));
    return top[Math.floor(Math.random() * top.length)].p;
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
    // LEVELS 暴露出来是**给测试调参用的**：test/bots-balance.mjs 直接改这张表来扫参数，
    // 否则每试一组数字都要改源码、跑一遍、再改回去（实测扫描几十组，手改不现实）。
    _rules: { checkWin: checkWin, boardFull: boardFull, BLACK: BLACK, WHITE: WHITE, EMPTY: EMPTY, LEVELS: LEVELS }
  };

  PN.games[ID] = game;
})(typeof globalThis !== 'undefined' ? globalThis : this);
