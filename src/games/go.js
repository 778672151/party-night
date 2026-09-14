/* ===== 围棋（双人对局，复用原作）=====
 *
 * 整包复用原作 mini/demo-29b78d69（单文件 585 行、自带引擎与棋谱）：
 *   C.createGame() / C.move(game, p) / C.current(game) / C.coord(p, n) / C.area(...)
 *   p 为棋盘序号；**p === -1 表示停一手**；连续两次停一手即终局；C.current(game).captures 是吃子数
 * 原作自带 AI（playMove(p, fromAI) + cancelAI）——双人版把 AI 关掉，两人轮流下。
 *
 * 本文件只有双人兼容层：轮流、日志、停一手、认输、按吃子数结算。围棋规则一行都不在这里。 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  var ID = 'go';
  var NAME = '围棋';
  var EMOJI = '⚫';

  function participants(host) {
    var g = host.g();
    return ((g && g.players) || []).filter(function (id) { return !!host.player(id); });
  }
  function nameOf(host, pid) { var p = host.player(pid); return p ? p.name : '?'; }

  function settle(host, caps, reason) {
    var g = host.g();
    g.phase = 'over';
    var a = g.players[0], b = g.players[1];
    var ca = (caps && caps[0]) || 0, cb = (caps && caps[1]) || 0;   // 黑在 0、白在 1（引擎 captures 数组）
    if (reason === 'resign') {
      // 认输：由 resignBy 决定谁赢
      var loser = g.resignBy;
      var winner = (loser === a) ? b : a;
      g.win = true;
      host.addScore(winner, 3);
      host.toast('⚫ ' + nameOf(host, loser) + ' 认输，' + nameOf(host, winner) + ' 赢下这盘 +3', 'good');
    } else if (ca > cb) { g.win = true; host.addScore(a, 3); host.toast('⚫ ' + nameOf(host, a) + ' 吃子更多（' + ca + ':' + cb + '），赢下这盘 +3', 'good'); }
    else if (cb > ca) { g.win = true; host.addScore(b, 3); host.toast('⚪ ' + nameOf(host, b) + ' 吃子更多（' + cb + ':' + ca + '），赢下这盘 +3', 'good'); }
    else { host.addScore(a, 1); host.addScore(b, 1); host.toast('⚫ 吃子数相同（' + ca + ':' + cb + '），各得 1 分', 'info'); }
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
    blurb: '原作整包复用（自带引擎与棋谱、关掉 AI），两人轮流落子下围棋 ⚫',
    minPlayers: 2,
    maxPlayers: 2,
    meta: { group: 'online', tags: ['棋类', '对局'], origin: { site: 'deepdemos.top', slug: 'demo-29b78d69', reuse: 'whole-game' } },

    init: function (host) {
      var s = host.state;
      var settings = s.settings.go || (s.settings.go = {});
      s.phase = 'round';
      var ps = host.onlinePlayers().slice(0, 2);
      if (ps.length < 2) { host.toast('围棋要两个人对局哦', 'info'); host.goLobby(); return; }
      var size = 9;   // 与原件默认一致（改棋盘要先驱动它的新局表单，暂不开放，免得设置与实际不符）
      s.g = {
        size: size, players: ps.map(function (q) { return q.id; }),   // 必须是 id 字符串：门禁要拿它跟 from 比
        log: [], turnIdx: 0,
        passes: 0, caps: [0, 0], phase: 'play', win: false, resigned: false, resignBy: null, series: 0
      };
      host.toast('⚫ ' + nameOf(host, ps[0]) + ' 执黑先行 · 棋盘 ' + size + ' 路 · 连续两次停一手即终局', 'good');
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
      if (from !== g.players[g.turnIdx]) return;               // 不是你的回合

      if (action.t === 'move') {
        var p = Number(action.p);
        var n = g.size * g.size;
        if (p !== -1 && (!isFinite(p) || p < 0 || p >= n)) return;
        g.log = g.log.concat([{ p: p, c: g.turnIdx + 1 }]);
        g.turnIdx = 1 - g.turnIdx;
        g.passes = (p === -1) ? (g.passes + 1) : 0;
        host.emit();
        return;
      }
      if (action.t === 'resign') {
        g.resigned = true; g.resignBy = from;
        settle(host, g.caps, 'resign');
        return;
      }
      if (action.t === 'caps') {                               // 客户端上报吃子数
        var c = action.caps;
        if (Array.isArray(c) && c.length >= 2) {
          if (c[0] !== g.caps[0] || c[1] !== g.caps[1]) { g.caps = [Number(c[0]) || 0, Number(c[1]) || 0]; host.emit(); }
        }
        return;
      }
      if (action.t === 'over') {                                // 两次停一手 → 终局
        if (action.caps && Array.isArray(action.caps)) g.caps = [Number(action.caps[0]) || 0, Number(action.caps[1]) || 0];
        settle(host, g.caps, 'pass');
        return;
      }
      if (action.t === 'reset') {
        g.log = []; g.turnIdx = 0; g.passes = 0;
        host.toast('🔄 ' + nameOf(host, from) + ' 重开了这盘', 'info');
        host.emit();
        return;
      }
    },

    resume: function (host) { if (host.g()) host.emit(); },

    onLeave: function (host, id) {
      var g = host.g();
      if (!g || g.phase === 'over') return;
      if ((g.players || []).indexOf(id) < 0) return;
      var still = (g.players || []).filter(function (pid) { var p = host.player(pid); return p && p.online; });
      if (still.length < 2) { g.phase = 'over'; g.win = false; host.emit(); }
    }
  };

  PN.games[ID] = game;
})(typeof globalThis !== 'undefined' ? globalThis : this);
