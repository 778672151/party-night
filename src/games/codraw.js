/* ===== 心有灵犀：同一个题目，两个人各自画一张，看看想到的是不是一回事 =====
 *
 * 和「你画我猜」的区别：
 *  - 两个人**同时**画，一人一块画布；揭晓前谁都不显示对方的（这才叫灵犀）；
 *  - 笔迹按「作者」分开记录（board = 发送者 id），房主存两份，用于刷新/中途加入回放；
 *  - 揭晓时两人都能看到两张画，并且互相表态（像 / 不太像）—— 这一下是"互相回应"的关键。
 *
 * 笔迹本身走的是广播的墨迹通道（和画猜同一条）：协议上没做私密，
 * 但界面在揭晓前不显示对方的画。这是刻意取舍：为一次"不看"新开一条私密墨迹通道不划算。 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  var ID = 'codraw';
  var NAME = '心有灵犀';
  var EMOJI = '🎐';
  var DEF_SEC = 60;      // 每题作画时间
  var REVEAL_MS = 9000;  // 都表态后停留多久进下一题
  var RATE_SEC = 30;     // 没人表态的兜底时间

  // ----- 闭包：笔迹和候选题目都不进 state（state 里放不下，也不该放）-----
  var _pv = { boards: {}, used: [] };

  function bank() { return (PN.BANKS.codraw && PN.BANKS.codraw.prompts) || []; }

  function pickPrompt() {
    var all = bank();
    if (!all.length) return { p: '我们的样子', h: '随便画点什么' };
    var pool = all.filter(function (x) { return _pv.used.indexOf(x.p) < 0; });
    if (!pool.length) { _pv.used = []; pool = all.slice(); }
    var x = pool[Math.floor(Math.random() * pool.length)];
    _pv.used.push(x.p);
    return x;
  }

  function participants(host) { return (host.g().players || []).filter(function (id) { return !!host.player(id); }); }
  function onlineParticipants(host) {
    return participants(host).filter(function (id) { var p = host.player(id); return p && p.online; });
  }

  /** 给某人拼一份回放：一般只给自己的画布，揭晓阶段两张都给（要并排展示） */
  function replayFor(host, pid, both) {
    var g = host.g();
    var out = { round: g.round };
    var boards = {};
    (g.players || []).forEach(function (id) {
      if (!both && id !== pid) return;
      var b = _pv.boards[id];
      if (b && b.length) boards[id] = b;
    });
    if (Object.keys(boards).length) out.boards = boards;
    return out;
  }

  function armDrawTimer(host, ms) {
    host.clearTimer('codraw_draw');
    host.after('codraw_draw', ms, function () {
      if (host.g().phase === 'draw') toReveal(host);
    });
  }

  function startRound(host) {
    var g = host.g();
    var q = pickPrompt();
    _pv.boards = {};
    g.phase = 'draw';
    g.prompt = q.p;
    g.hint = q.h || '不用画得像，画出你想到的第一个画面就行';
    g.ready = {};
    g.rated = {};
    g.reveal = null;
    g.deadline = host.now() + (g.sec || DEF_SEC) * 1000;
    armDrawTimer(host, (g.sec || DEF_SEC) * 1000 + 400);
    host.toast('🎐 第 ' + g.round + ' 题：' + q.p + '（两个人同时画，先别偷看对方）', 'good');
    host.emit();
  }

  function toReveal(host) {
    var g = host.g();
    host.clearTimer('codraw_draw');
    host.clearTimer('codraw_reveal');
    g.phase = 'reveal';
    g.deadline = host.now() + RATE_SEC * 1000;
    g.reveal = { match: false, list: [] };
    g.rated = {};
    // 谁没画完也照常揭晓：本来就不是比赛
    host.event({ t: 'codraw_reveal' });
    host.emit();
    host.after('codraw_reveal', RATE_SEC * 1000, function () {
      var g2 = host.g();
      if (g2.phase === 'reveal') settleRound(host, true);
    });
  }

  /** 一轮结束：公布两人的表态，然后按停留时间进下一题 */
  function settleRound(host, timedOut) {
    var g = host.g();
    host.clearTimer('codraw_reveal');
    var ps = participants(host);
    var list = ps.map(function (id) {
      var p = host.player(id);
      var v = g.rated[id];
      return { id: id, name: p ? p.name : '?', emoji: p ? p.emoji : '🙂', v: (v === 1 || v === -1) ? v : 0 };
    });
    var both = list.length >= 2 && list.every(function (x) { return x.v === 1; });
    g.reveal = { match: both, list: list, timedOut: !!timedOut };
    if (both) {
      g.matched = (g.matched || 0) + 1;
      ps.forEach(function (id) { host.addScore(id, 2); });
      host.toast('心有灵犀！你们想到一块去了 💞', 'good');
      host.event({ t: 'codraw_match' });
    } else {
      host.event({ t: 'codraw_diff' });
    }
    host.emit();
    host.after('codraw_next', REVEAL_MS, function () {
      var g2 = host.g();
      if (g2.phase !== 'reveal') return;
      if (g2.round >= g2.total) finish(host);
      else { g2.round++; startRound(host); }
    });
  }

  function finish(host) {
    var g = host.g();
    host.clearTimer('codraw_draw');
    host.clearTimer('codraw_reveal');
    host.clearTimer('codraw_next');
    var total = g.total || 3;
    var matched = g.matched || 0;
    g.phase = 'over';
    g.deadline = 0;
    g.summary = { matched: matched, total: total, percent: Math.round(matched / total * 100) };
    if (matched >= total) host.toast('每一题都想到一块去了，这还得了 ✨', 'good');
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
    blurb: '同一个题目各自画一张，揭晓才知道想到的是不是一回事 🎐',
    meta: { group: 'online', tags: ['画画', '默契'] },
    minPlayers: 2,
    maxPlayers: 2,

    init: function (host) {
      var s = host.state;
      var settings = s.settings.codraw || (s.settings.codraw = { rounds: 3, sec: DEF_SEC });
      s.phase = 'round';
      var ps = host.onlinePlayers().slice(0, 2);
      if (ps.length < 2) { host.toast('心有灵犀要两个人才能玩哦', 'info'); host.goLobby(); return; }

      _pv = { boards: {}, used: [] };
      s.g = {
        round: 1,
        total: Math.max(2, Math.min(5, Number(settings.rounds) || 3)),
        sec: Math.max(30, Math.min(120, Number(settings.sec) || DEF_SEC)),
        matched: 0,
        players: ps.map(function (p) { return p.id; }),
        phase: 'draw',
        prompt: '',
        hint: '',
        deadline: 0,
        ready: {},
        rated: {},
        reveal: null,
        summary: null,
        startedAt: host.now()
      };
      host.emit();
      startRound(host);
    },

    action: function (host, action, from) {
      var g = host.g();
      if (!g) return;
      if (action.t === 'lobby') { if (host.amHost(from)) host.goLobby(); return; }
      if (action.t === 'again') { if (host.amHost(from)) this.init(host); return; }

      // 画好了（提前交卷）：两个人都点了就立刻揭晓，不用干等倒计时
      if (action.t === 'ready') {
        if (g.phase !== 'draw' || participants(host).indexOf(from) < 0) return;
        g.ready[from] = true;
        host.emit();
        var on = onlineParticipants(host);
        if (on.length >= 2 && on.every(function (id) { return g.ready[id]; })) toReveal(host);
        return;
      }

      // 表态：像 / 不太像
      if (action.t === 'rate') {
        if (g.phase !== 'reveal' || participants(host).indexOf(from) < 0) return;
        if (g.rated[from] !== undefined) return;
        var v = Number(action.v);
        if (v !== 1 && v !== -1) return;
        g.rated[from] = v;
        host.emit();
        var on2 = onlineParticipants(host);
        if (on2.length >= 2 && on2.every(function (id) { return g.rated[id] !== undefined; })) settleRound(host, false);
        return;
      }

      // 中转/刷新：把自己的画布补回去（揭晓阶段两张都要）
      if (action.t === '_joined' || action.t === 'hi' || action.t === 'need_replay') {
        if (!from || participants(host).indexOf(from) < 0) return;
        var pay = replayFor(host, from, g.phase === 'reveal' || g.phase === 'over');
        if (pay.boards) host.sendSecret(from, pay);
        return;
      }
    },

    /** 房主旁听墨迹：按作者分开留一份回放 */
    onInk: function (host, msg, from) {
      var g = host.g();
      if (!g || g.phase !== 'draw' || !from) return;
      if ((g.players || []).indexOf(from) < 0) return;
      if (msg.t === 'clear') { _pv.boards[from] = []; return; }
      if (msg.t !== 'stroke' || !msg.s || !msg.s.length) return;
      var b = _pv.boards[from] || (_pv.boards[from] = []);
      b.push({ id: msg.id, i0: msg.i0 || 0, r: msg.r, color: msg.color, w: msg.w, s: msg.s });
      while (b.length > 900) b.shift();
    },

    /** 揭晓阶段也要能收到迟到的笔迹（有人手慢，最后一块揭晓后才到）*/
    resume: function (host) {
      var g = host.g();
      if (!g) return;
      var left = Math.max(0, (g.deadline || 0) - host.now());
      if (g.phase === 'draw') armDrawTimer(host, left + 400);
      else if (g.phase === 'reveal') {
        // 新房主的 recorded 笔迹是空的：向两位玩家各要一次回放
        host.event({ t: 'recover_ink', round: g.round });
        participants(host).forEach(function (id) { if (id !== host.state.hostId) host.requestSecret(id, { recover: true, round: g.round }); });
        host.after('codraw_reveal', Math.max(1500, left), function () {
          var g2 = host.g();
          if (g2.phase === 'reveal') settleRound(host, true);
        });
      }
      host.emit();
    },

    onLeave: function (host, id) {
      var g = host.g();
      if (!g || g.phase === 'over') return;
      if ((g.players || []).indexOf(id) < 0) return;
      if (onlineParticipants(host).length < 2) {
        host.toast('对方离开了，这一局先到这儿～', 'info');
        finish(host);
      }
    }
  };

  PN.games[ID] = game;
})(typeof globalThis !== 'undefined' ? globalThis : this);
