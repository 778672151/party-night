/* ===== 骨牌顶牛（双人各带两家，复用原作）=====
 *
 * 不用自己写牌局：画面/牌谱/规则/动画/UI 全部跑原作 mini/demo-c046ab75
 *（game.js 1979 行 + ui.js 3007 行 + PWA，成熟项目），它的规则 API 很干净：
 *   game.playTile(seat, tileId, end, side) → { success, msg }
 *   game.passTurn(seat, tileId)            （扣牌）
 *   game.players[4] / game.chain / game.currentPlayer / game.scores[4] / game.phase
 *
 * 原作是 **4 人**顶牛（可同屏传递设备，也自带 WebSocket 联机）。双人改编取"两人各带两家"：
 *   座位 0、2 归 A，座位 1、3 归 B —— 出牌顺序天然 0→1→2→3，于是天然轮流出手。
 *
 * 本文件只做"双人兼容"的那一层：
 *   ① 座位归属与**轮次门禁**（不是你的座位就不能动）
 *   ② **动作日志**（谁、用哪张牌、接哪头；两端按同一顺序重放 → 局面必然一致）
 *   ③ 每局结算加分、打满局数收尾；掉线收尾
 * 一行牌局规则都没有 —— 全在原作里。 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  var ID = 'domino';
  var NAME = '骨牌顶牛';
  var EMOJI = '🀄';
  var KINDS = { play: 1, pass: 1, nextRound: 1 };

  function participants(host) {
    var g = host.g();
    return ((g && g.players) || []).filter(function (id) { return !!host.player(id); });
  }
  function nameOf(host, pid) { var p = host.player(pid); return p ? p.name : '?'; }
  /** 座位归属：0/2 归先加入的，1/3 归另一位 */
  function ownerOf(g, seat) { return g.players[seat % 2]; }
  function seatName(g, seat) { return (seat % 2 === 0 ? 'A' : 'B') + '家 ' + (seat + 1); }

  function settle(host, win, scores) {
    var g = host.g();
    g.phase = 'over';
    g.win = !!win;
    var a = g.players[0], b = g.players[1];
    var sa = (scores && scores[a] != null) ? scores[a] : 0;
    var sb = (scores && scores[b] != null) ? scores[b] : 0;
    if (sa > sb) { host.addScore(a, 3); host.toast('🀄 ' + nameOf(host, a) + ' 三家用牌总分更高，赢了！', 'good'); }
    else if (sb > sa) { host.addScore(b, 3); host.toast('🀄 ' + nameOf(host, b) + ' 三家用牌总分更高，赢了！', 'good'); }
    else { host.addScore(a, 1); host.addScore(b, 1); host.toast('🀄 总分打平，各得一分', 'info'); }
    host.event({
      t: 'gameover',
      players: participants(host).map(function (id) {
        var p = host.player(id);
        return { id: id, name: p ? p.name : '?', score: p ? p.score : 0, hand: sa && id === a ? sa : sb };
      })
    });
    host.emit();
  }

  var game = {
    id: ID,
    name: NAME,
    emoji: EMOJI,
    blurb: '原作整包复用（4 人顶牛），两个人各带两家轮流接牌 🀄',
    minPlayers: 2,
    maxPlayers: 2,
    meta: { group: 'online', tags: ['棋牌', '轮流出牌'], origin: { site: 'deepdemos.top', slug: 'demo-c046ab75', reuse: 'whole-game' } },

    init: function (host) {
      var s = host.state;
      var settings = s.settings.domino || (s.settings.domino = {});
      s.phase = 'round';
      var ps = host.onlinePlayers().slice(0, 2);
      if (ps.length < 2) { host.toast('顶牛要两个人一起玩哦', 'info'); host.goLobby(); return; }
      var rounds = Number(settings.rounds) || 3;
      if ([1, 3, 5].indexOf(rounds) < 0) rounds = 3;
      s.g = {
        // 固定种子：原作摇色子/洗牌用 Math.random，桥接会用它覆盖 iframe 里的 Math.random，
        // 两端同种子才可能局面一致（这也是这套复用能成立的关键）
        seed: (Math.random() * 0x7fffffff) | 0,
        seats: 4, rounds: rounds, played: 0,
        players: ps.map(function (p) { return p.id; }),
        owners: {},                     // 座位 → 玩家 id
        log: [],                        // 权威动作日志（两端按序重放）
        seat: 0,                        // 当前该谁（原作报了座位号）
        scores: {},                     // 每家总分（由原作上报，房主只负责加总）
        phase: 'play', win: false, levelName: '第 1 局'
      };
      s.g.owners[0] = ps[0].id; s.g.owners[2] = ps[0].id;
      s.g.owners[1] = ps[1].id; s.g.owners[3] = ps[1].id;
      s.g.scores[ps[0].id] = 0; s.g.scores[ps[1].id] = 0;
      host.toast('🀄 ' + nameOf(host, ps[0].id) + ' 带 1、3 家，' + nameOf(host, ps[1].id) + ' 带 2、4 家', 'good');
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

      // 谁在动哪一家：seat 必须属于这位玩家，且必须是当前该动的那家
      if (action.t === 'act') {
        var seat = Number(action.seat);
        if (!KINDS[action.kind]) return;
        if (g.owners[seat] !== from) return;             // 不是你的座位（每人两家）
        if (seat !== g.seat) return;                     // 还没轮到这一家
        g.log = g.log.concat([{ seat: seat, kind: action.kind, tileId: action.tileId, end: action.end, side: action.side }]);
        g.played = g.log.length;
        host.emit();
        return;
      }
      // 原作自己报的场面：当前座位、每家总分、是否一局结束
      if (action.t === 'sync') {
        var changed = false;
        if (typeof action.seat === 'number' && action.seat !== g.seat) { g.seat = action.seat; changed = true; }
        if (action.scores && typeof action.scores === 'object') {
          var same = true;
          Object.keys(action.scores).forEach(function (k) { if (g.scores[k] !== action.scores[k]) same = false; });
          if (!same) { g.scores = action.scores; changed = true; }
        }
        if (changed) host.emit();
        return;
      }
      // 一局打完：由两家里解开的那位上报名次分（房主只记局数与总分）
      if (action.t === 'roundover') {
        if (action.scores && typeof action.scores === 'object') g.scores = action.scores;
        g.played = (g.played || 0) + 1;
        var pa = g.players[0], pb = g.players[1];
        var winner = null;
        if ((g.scores[pa] || 0) > (g.scores[pb] || 0)) winner = pa;
        else if ((g.scores[pb] || 0) > (g.scores[pa] || 0)) winner = pb;
        if (winner) { host.addScore(winner, 2); host.toast('🎉 第 ' + g.played + ' 局 ' + nameOf(host, winner) + ' 领先，+2', 'good'); }
        else { host.addScore(pa, 1); host.addScore(pb, 1); host.toast('🎉 第 ' + g.played + ' 局打平，各 +1', 'info'); }
        if (g.played >= g.rounds) { settle(host, true, g.scores); return; }
        g.log = [];                                     // 新一局：清空日志，两端各自重开
        g.round = (g.round || 0) + 1;
        host.emit();
        return;
      }
      if (action.t === 'reset') {                       // 卡住了：重开这一局
        g.log = [];
        host.toast('🔄 ' + nameOf(host, from) + ' 重开了这一局', 'info');
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
      if (still.length < 2) settle(host, false, g.scores);
    },

    _rules: { ownerOf: ownerOf, seatName: seatName, KINDS: KINDS }
  };

  PN.games[ID] = game;
})(typeof globalThis !== 'undefined' ? globalThis : this);
