/* ===== 鲸鱼推箱子（双人合作）=====
 *
 * 玩法是经典 Sokoban（推箱子）：把箱子全部推到目标点上，推得动就推、不能拉、不能一次推两个。
 * 规则实现与关卡数据来自 deepdemos.top 作品《鲸鱼推箱子（审美 Plus 版）》（slug plus-2265f7c6，作者 HWDyzzZ）：
 *   - 关卡采用 XSB 文本格式（# 墙 / 空格 地板 / . 目标 / $ 箱子 / * 箱子在目标 / @ 玩家 / + 玩家在目标）
 *   - 那 10 关是**该作品的原创设计**（其源码里明确声明不是抄 Microban 等公开合集），par 步数由它的校验脚本得出
 *   - 原作还有"保证可解"的校验脚本；我们直接沿用它的关卡（已校验过），不重写求解器
 *
 * 双人改编（原作是单机 3D 渲染）：
 *   - **轮流走一步**：你推一下、我推一下，一起把箱子送到目标点（合作，不是对战）
 *   - 走一步 = 一次出手；走不动（撞墙/推不动）不算出手，免得白白送掉回合
 *   - 卡住了随时可以"重来本关"（谁都可以点，合作模式没有使坏动机）
 *   - 每通一关双方各 +2 分；打完全部关卡结束 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  var ID = 'soko';
  var NAME = '鲸鱼推箱子';
  var EMOJI = '🐳';

  /* 关卡（XSB 文本格式），来自 deepdemos.top 作品 plus-2265f7c6 的原创关卡设计 */
  var LEVELS = [
    { id: 'grove-01', par: 2, name: '第一道沟', grid: ['#######', '#     #', '#@$ . #', '#     #', '#######'] },
    { id: 'grove-02', par: 4, name: '角落的花坛', grid: ['#######', '#.    #', '# ##  #', '#  $  #', '#  @  #', '#######'] },
    { id: 'grove-03', par: 6, name: '绕过树桩', grid: ['#######', '# .   #', '# ##  #', '#@$   #', '#     #', '#######'] },
    { id: 'grove-04', par: 8, name: '两张床', grid: ['#########', '#.      #', '# @   $ #', '#   #   #', '# $     #', '#      .#', '#########'] },
    { id: 'grove-05', par: 10, name: '两道门', grid: ['#########', '#@  #   #', '#  $#   #', '#      .#', '#   #   #', '#  $#   #', '#      .#', '#########'] },
    { id: 'grove-06', par: 12, name: '绕远路', grid: ['#########', '#@      #', '# $     #', '# ####  #', '# ####  #', '#  .. $ #', '#########'] },
    { id: 'grove-07', par: 14, name: '先送远的', grid: ['########', '#   #  #', '# $ #. #', '#   #  #', '# $ #. #', '#      #', '#  @   #', '########'] },
    { id: 'grove-08', par: 16, name: '堆肥间', grid: ['#########', '#@      #', '# $ $   #', '#    # ##', '#####   #', '#####   #', '#####. .#', '#########'] },
    { id: 'grove-09', par: 21, name: '三个一排', grid: ['#########', '#   #   #', '# $ #   #', '# $ #   #', '# $ #...#', '#       #', '#   @   #', '#########'] },
    { id: 'grove-10', par: 26, name: '整片园子', grid: ['#########', '#   ....#', '# ####  #', '# $ $   #', '# $ $   #', '#   @   #', '#########'] }
  ];

  /** 把 XSB 文本解析成扁平数组（墙/目标/箱子/玩家） */
  function parse(grid) {
    var cols = 0;
    for (var i = 0; i < grid.length; i++) cols = Math.max(cols, grid[i].length);
    var rows = grid.length, walls = [], goals = [], boxes = [], whale = -1;
    for (var r = 0; r < rows; r++) {
      var line = grid[r];
      for (var c = 0; c < cols; c++) {
        var ch = line[c] || ' ';
        var idx = r * cols + c;
        walls[idx] = ch === '#';
        goals[idx] = ch === '.' || ch === '*' || ch === '+';
        boxes[idx] = ch === '$' || ch === '*';
        if (ch === '@' || ch === '+') whale = idx;
      }
    }
    return { rows: rows, cols: cols, walls: walls, goals: goals, boxes: boxes, whale: whale === -1 ? 0 : whale };
  }
  var PARSED = LEVELS.map(function (l) {
    var p = parse(l.grid);
    p.id = l.id; p.par = l.par; p.name = l.name;
    return p;
  });
  function levelAt(i) { return PARSED[Math.max(0, Math.min(PARSED.length - 1, i))]; }

  function inB(L, r, c) { return r >= 0 && r < L.rows && c >= 0 && c < L.cols; }
  function boxList(st) {
    var out = [];
    for (var i = 0; i < st.boxes.length; i++) if (st.boxes[i]) out.push(i);
    return out;
  }
  function allOnGoal(L, st) {
    var bs = boxList(st);
    if (!bs.length) return false;
    for (var i = 0; i < bs.length; i++) if (!L.goals[bs[i]]) return false;
    return true;
  }
  function goalTotal(L) {
    var n = 0;
    for (var i = 0; i < L.goals.length; i++) if (L.goals[i]) n++;
    return n;
  }

  /** 走一步：返回 {moved, pushed}；推不动/撞墙都算没走成 */
  function step(L, st, dr, dc) {
    var r = Math.floor(st.whale / L.cols), c = st.whale % L.cols;
    var nr = r + dr, nc = c + dc;
    if (!inB(L, nr, nc)) return { moved: false };
    var ni = nr * L.cols + nc;
    if (L.walls[ni]) return { moved: false };
    if (st.boxes[ni]) {
      var br = nr + dr, bc = nc + dc;
      if (!inB(L, br, bc)) return { moved: false };
      var bi = br * L.cols + bc;
      if (L.walls[bi] || st.boxes[bi]) return { moved: false };   // 推不动：墙或另一个箱子
      return { moved: true, pushed: true, from: ni, to: bi, whale: ni };
    }
    return { moved: true, pushed: false, whale: ni };
  }

  function participants(host) {
    var g = host.g();
    return ((g && g.players) || []).filter(function (id) { return !!host.player(id); });
  }
  function nameOf(host, pid) { var p = host.player(pid); return p ? p.name : '?'; }
  function gridState(L) {
    return {
      boxes: L.boxes.slice(), whale: L.whale
    };
  }

  function startLevel(host, li, keepScore) {
    var g = host.g();
    var L = levelAt(li);
    var init = gridState(L);
    g.li = li;
    g.levelId = L.id;
    g.levelName = L.name;
    g.par = L.par;
    g.rows = L.rows; g.cols = L.cols;
    g.walls = L.walls; g.goals = L.goals;
    g.boxes = init.boxes;
    g.whale = init.whale;
    g.moves = 0; g.pushes = 0;
    g.phase = 'play';
    host.toast('🐳 第 ' + (li + 1) + '/' + g.levels + ' 关 · ' + L.name + '（参考步数 ' + L.par + '）', 'info');
  }

  var game = {
    id: ID,
    name: NAME,
    emoji: EMOJI,
    blurb: '两个人轮流推一步，把箱子都送到花点上 🐳',
    minPlayers: 2,
    maxPlayers: 2,
    meta: { group: 'online', tags: ['合作', '解谜'], origin: { site: 'deepdemos.top', slug: 'plus-2265f7c6', author: 'HWDyzzZ' } },

    init: function (host) {
      var s = host.state;
      var settings = s.settings.soko || (s.settings.soko = {});
      s.phase = 'round';
      var ps = host.onlinePlayers().slice(0, 2);
      if (ps.length < 2) { host.toast('推箱子要两个人一起玩哦', 'info'); host.goLobby(); return; }
      var want = Number(settings.levels) || 5;
      var levels = Math.max(1, Math.min(PARSED.length, want === 10 ? 10 : want));
      s.g = {
        levels: levels, li: 0, turnIdx: 0,
        players: ps.map(function (p) { return p.id; }),
        cleared: 0, phase: 'play', win: false,
        rows: 0, cols: 0, walls: [], goals: [], boxes: [], whale: 0,
        moves: 0, pushes: 0, last: null
      };
      startLevel(host, 0, false);
      host.toast('🐳 ' + nameOf(host, s.g.players[0]) + ' 先走 · 轮流推一步', 'good');
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

      if (action.t === 'reset') {                            // 卡住了重来本关：谁都可以点（合作）
        var li = g.li;
        startLevel(host, li, true);
        g.last = { i: -1, kind: 'reset' };
        g.turnIdx = 1 - g.turnIdx;                           // 重来也算让一步，保持轮流公平
        host.toast('🔄 ' + nameOf(host, from) + ' 把这一关重置了', 'info');
        host.emit();
        return;
      }

      if (action.t !== 'move') return;
      if (from !== g.players[g.turnIdx]) return;             // 不是你的回合
      var dirs = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
      var d = dirs[action.dir];
      if (!d) return;
      var L = { rows: g.rows, cols: g.cols, walls: g.walls, goals: g.goals };
      var st = { boxes: g.boxes, whale: g.whale };
      var res = step(L, st, d[0], d[1]);
      if (!res.moved) { host.toast('走不动（墙或被箱子挡住）——换一边试试', 'info'); host.emit(); return; }
      if (res.pushed) {
        g.boxes[res.from] = false;
        g.boxes[res.to] = true;
        g.pushes++;
      }
      g.whale = res.whale;
      g.moves++;
      g.last = { i: res.whale, kind: res.pushed ? 'push' : 'move' };
      if (allOnGoal(L, st)) {                                // 箱子全到位 → 过一关
        var pidA = g.players[0], pidB = g.players[1];
        host.addScore(pidA, 2); host.addScore(pidB, 2);
        g.cleared++;
        host.toast('🎉 第 ' + (g.li + 1) + ' 关通过！双方各 +2（用了 ' + g.moves + ' 步 / ' + g.pushes + ' 次推动）', 'good');
        if (g.li + 1 >= g.levels) {
          g.phase = 'over'; g.win = true;
          host.event({
            t: 'gameover',
            players: participants(host).map(function (id) {
              var p = host.player(id);
              return { id: id, name: p ? p.name : '?', score: p ? p.score : 0 };
            })
          });
          host.emit();
          return;
        }
        startLevel(host, g.li + 1, true);
        g.last = null;
        host.emit();
        return;
      }
      g.turnIdx = 1 - g.turnIdx;
      host.emit();
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
        g.phase = 'over';
        g.win = false;
        host.event({ t: 'gameover', players: participants(host).map(function (pid) { var p = host.player(pid); return { id: pid, name: p ? p.name : '?', score: p ? p.score : 0 }; }) });
        host.emit();
      }
    },

    /** 给测试与界面用：纯函数 + 关卡表 */
    _rules: {
      LEVELS: LEVELS, PARSED: PARSED, parse: parse, step: step, allOnGoal: allOnGoal,
      goalTotal: goalTotal, levelAt: levelAt, boxList: boxList
    }
  };

  PN.games[ID] = game;
})(typeof globalThis !== 'undefined' ? globalThis : this);
