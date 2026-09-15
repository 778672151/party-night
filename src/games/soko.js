/* ===== 鲸鱼推箱子（双人合作，复用原作）=====
 *
 * 这一版**不再自己实现游戏**：画面、物理、动画、关卡、UI 全部跑原作
 *   mini/plus-2265f7c6/（Three.js + 自己的三渲二材质，10 关原创关卡，作者 HWDyzzZ）
 * 本文件只负责"双人兼容"的那一层：
 *   - **移动日志**：谁走了哪一步，按顺序记下来（而不是自己维护棋盘状态）
 *   - **轮流出手**：只有当前该出手的人能走
 *   - **确定性重放**：两端各自把日志重放进原作（原作是确定性的 → 局面必然一致）
 * 所以这里没有一行推箱子规则；规则全在原作者手里（sokoban.js / play.js）。
 * 移动能否成立也由原作判定：非法方向重放时是空操作，不会把局面弄坏。 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  var ID = 'soko';
  var NAME = '鲸鱼推箱子';
  var EMOJI = '🐳';

  /* 关卡名（只为界面显示；真正的关卡数据在原作里） */
  var LEVEL_NAMES = ['第一道沟', '角落的花坛', '绕过树桩', '两张床', '两道门',
    '绕远路', '先送远的', '堆肥间', '三个一排', '整片园子'];
  var DIRS = { up: 1, down: 1, left: 1, right: 1 };

  function participants(host) {
    var g = host.g();
    return ((g && g.players) || []).filter(function (id) { return !!host.player(id); });
  }
  function nameOf(host, pid) { var p = host.player(pid); return p ? p.name : '?'; }
  function settle(host, win) {
    var g = host.g();
    g.phase = 'over';
    g.win = !!win;
    if (win) {
      // 注意：每通一关已经各 +2 了（见 action 的 level 分支），结算里**不能再加一次**，
      // 否则最后一关会变成 +4（这个 bug 是单测抓出来的）。
      host.toast('🐳 一起通关啦！', 'good');
    } else {
      host.toast('这局先到这儿～', 'info');
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

  var game = {
    id: ID,
    name: NAME,
    emoji: EMOJI,
    blurb: '原作整包复用（Three.js 三渲二），两个人轮流推一步 🐳',
    minPlayers: 1,   // 单人可玩（轮流推一步，一个人时回合永远轮到自己）
    maxPlayers: 2,
    meta: { group: 'online', tags: ['合作', '解谜'], origin: { site: 'deepdemos.top', slug: 'plus-2265f7c6', author: 'HWDyzzZ', reuse: 'whole-game' } },

    init: function (host) {
      var s = host.state;
      var settings = s.settings.soko || (s.settings.soko = {});
      s.phase = 'round';
      var ps = host.onlinePlayers().slice(0, 2);
      // 单人可玩：轮流推一步，一个人时回合只是永远轮到自己
      if (!ps.length) { host.toast('还没连上房间，稍等一下再开', 'info'); host.goLobby(); return; }
      var want = Number(settings.levels) || 5;
      var levels = want === 10 ? 10 : (want === 3 ? 3 : 5);
      s.g = {
        levels: levels, li: 0, log: [], turnIdx: 0,
        players: ps.map(function (p) { return p.id; }),
        cleared: 0, phase: 'play', win: false,
        levelName: LEVEL_NAMES[0]
      };
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

      if (action.t === 'move') {                      // 只有该出手的人能走
        if (from !== g.players[g.turnIdx]) return;
        if (!DIRS[action.dir]) return;
        g.log = g.log.concat([action.dir]);           // 追加一步（两端按同一顺序重放）
        g.turnIdx = (g.turnIdx + 1) % g.players.length;   // 单人时不会指向不存在的第二名
        host.emit();
        return;
      }
      if (action.t === 'reset') {                     // 卡住了重来本关
        g.log = [];
        g.turnIdx = (g.turnIdx + 1) % g.players.length;   // 单人时不会指向不存在的第二名
        host.toast('🔄 ' + nameOf(host, from) + ' 把这一关重置了', 'info');
        host.emit();
        return;
      }
      if (action.t === 'level') {                     // 由解开这一关的那位上报
        var next = Number(action.i);
        if (next !== g.li + 1) return;
        g.cleared++;
        var pa = g.players[0], pb = g.players[1];
        host.addScore(pa, 2); host.addScore(pb, 2);
        if (next >= g.levels) { settle(host, true); return; }
        g.li = next; g.log = []; g.turnIdx = 0;
        g.levelName = LEVEL_NAMES[Math.min(next, LEVEL_NAMES.length - 1)];
        host.toast('🎉 第 ' + next + ' 关通过！双方各 +2 · 下一关：' + g.levelName, 'good');
        host.emit();
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
      if (still.length < 2) settle(host, false);
    },

    _rules: { LEVEL_NAMES: LEVEL_NAMES, DIRS: DIRS }
  };

  PN.games[ID] = game;
})(typeof globalThis !== 'undefined' ? globalThis : this);
