/* ===== 默契大考验：同一道题各自秘密作答，看看你们有多懂对方 =====
 *
 * 双人合作：答案一致就两人同时加分，最后给出「默契度」。
 * 关键设计：揭晓前每个人的答案只存在房主的闭包里（绝不进 state），
 * 否则任何人都能从广播状态里偷看对方选了什么，这个游戏就废了。 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  var ID = 'tacit';
  var NAME = '默契大考验';
  var EMOJI = '💞';
  var ANSWER_SEC = 30;   // 每题作答时间
  var REVEAL_MS = 4500;  // 揭晓停留时间
  var DEF_TOTAL = 8;     // 默认题目数

  // ----- 闭包：绝不进入 state -----
  var _pv = { answers: {}, used: [], qid: null };

  function bank() { return (PN.BANKS.tacit && PN.BANKS.tacit.questions) || []; }

  /** 随机取一道没出过的题（出完一轮就重新洗） */
  function pickOne() {
    var all = bank();
    if (!all.length) return null;
    var pool = all.filter(function (q) { return _pv.used.indexOf(q.q) < 0; });
    if (!pool.length) { _pv.used = []; pool = all.slice(); }
    var q = pool[Math.floor(Math.random() * pool.length)];
    _pv.used.push(q.q);
    return q;
  }

  /** 选项：who → 两位参与者的名字（顺序同 g.players）；pick → 题目自带 */
  function optionsFor(host, q) {
    var g = host.g();
    if (q.type === 'pick') return (q.options || []).slice(0, 4);
    return (g.players || []).map(function (id) {
      var p = host.player(id);
      return p ? p.name : '?';
    });
  }

  function participants(host) { return (host.g().players || []).filter(function (id) { return !!host.player(id); }); }
  function onlineParticipants(host) {
    return participants(host).filter(function (id) { var p = host.player(id); return p && p.online; });
  }

  /** 出题 → 进入作答阶段 */
  function startQuestion(host) {
    var g = host.g();
    var q = pickOne();
    if (!q) { finish(host); return; }
    _pv.answers = {};
    _pv.qid = q.q;
    g.cur = {
      q: q.q,
      qtype: q.type,
      options: optionsFor(host, q),
      deadline: host.now() + ANSWER_SEC * 1000,
      phase: 'answer',
      answered: {},   // 谁知道「谁答了」是公开信息（不含内容），用来显示「已提交，等对方…」
      reveal: null
    };
    host.clearTimer('tacit_answer');
    host.after('tacit_answer', ANSWER_SEC * 1000 + 300, function () {
      var g2 = host.g();
      if (g2.cur && g2.cur.phase === 'answer') doReveal(host);
    });
    host.emit();
  }

  /** 两人都答完（或超时）→ 同时揭晓比对 */
  function doReveal(host) {
    var g = host.g();
    if (!g || !g.cur || g.cur.phase !== 'answer') return;
    host.clearTimer('tacit_answer');

    var ps = participants(host);
    var picks = [], miss = [], vals = [];
    ps.forEach(function (id) {
      var p = host.player(id);
      var i = _pv.answers[id];
      var ok = (i !== undefined && i !== null && g.cur.options[i] !== undefined);
      if (!ok) { miss.push(id); vals.push(null); }
      else vals.push(i);
      picks.push({
        id: id,
        name: p ? p.name : '?',
        emoji: p ? p.emoji : '🙂',
        i: ok ? i : -1,
        label: ok ? g.cur.options[i] : '没作答'
      });
    });
    var first = vals[0];
    var match = miss.length === 0 && ps.length >= 2 && vals.every(function (v) { return v === first; });

    g.cur.phase = 'reveal';
    g.cur.deadline = host.now() + REVEAL_MS;
    g.cur.reveal = { picks: picks, match: match, miss: miss };

    if (match) {
      g.matched = (g.matched || 0) + 1;
      ps.forEach(function (id) { host.addScore(id, 1); });
      host.toast('心有灵犀！💞 两个人都选了「' + g.cur.options[first] + '」', 'good');
      host.event({ t: 'tacit_match' });
    } else {
      host.event({ t: 'tacit_miss' });
    }
    host.emit();

    host.clearTimer('tacit_next');
    host.after('tacit_next', REVEAL_MS, function () {
      var g2 = host.g();
      if (!g2.cur || g2.cur.phase !== 'reveal') return;
      if (g2.round >= g2.total) finish(host);
      else { g2.round++; startQuestion(host); }
    });
  }

  /* ===== 机器人对手（纯函数，只读 g / _pv，不改状态）=====
   * 默契题问的是「你们俩谁更可能…」，机器人也只能**猜** —— 它不知道真人会选哪个，
   * 所以随机挑一个选项，和真人一样赌默契。这不是放水，是这类题唯一诚实的玩法。 */
  function botPick(host) {
    var g = host.g();
    if (!g || !g.cur || g.cur.phase !== 'answer') return null;
    if (!PN.bots) return null;
    var me = null, i;
    for (i = 0; i < (g.players || []).length; i++) if (PN.bots.isBotId(g.players[i])) { me = g.players[i]; break; }
    if (!me) return null;
    if (_pv.answers[me] !== undefined) return null;              // 这题已经答过了，不能改
    var n = (g.cur.options || []).length;
    if (!n) return null;
    return { pid: me, action: { t: 'answer', i: Math.floor(Math.random() * n) } };
  }

  /** 结算 */
  function finish(host) {
    var g = host.g();
    host.clearTimer('tacit_answer');
    host.clearTimer('tacit_next');
    var total = g.total || DEF_TOTAL;
    var matched = g.matched || 0;
    g.phase = 'over';
    g.cur = null;
    g.summary = { matched: matched, total: total, percent: Math.round(matched / total * 100) };
    if (matched >= total) host.toast('满分默契！你们是一个人吧？✨', 'good');
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
    blurb: '同一道题各自悄悄选，看看你们有多懂对方 💞',
    meta: { group: 'online', tags: ['问答', '默契'] },
    minPlayers: 2,
    maxPlayers: 2,

    botTurn: function (host) { return botPick(host); },

    init: function (host) {
      var s = host.state;
      var settings = s.settings.tacit || (s.settings.tacit = { rounds: DEF_TOTAL });
      s.phase = 'round';

      var ps = host.onlinePlayers().slice(0, 2);
      if (ps.length < 2) { host.toast('默契大考验要两个人才能玩哦', 'info'); host.goLobby(); return; }

      _pv = { answers: {}, used: [], qid: null };
      s.g = {
        round: 1,
        total: Math.max(3, Math.min(16, Number(settings.rounds) || DEF_TOTAL)),
        matched: 0,
        players: ps.map(function (p) { return p.id; }),
        cur: null,
        summary: null,
        startedAt: host.now()
      };
      host.toast('💞 默契大考验开始！同一道题各自选，不许偷看', 'good');
      startQuestion(host);
    },

    action: function (host, action, from) {
      var g = host.g();
      if (!g) return;

      if (action.t === 'lobby') { if (host.amHost(from)) host.goLobby(); return; }
      if (action.t === 'again') { if (host.amHost(from)) this.init(host); return; }

      if (action.t === 'answer') {
        if (!g.cur || g.cur.phase !== 'answer') return;
        if (participants(host).indexOf(from) < 0) return;          // 旁观者不能作答
        if (_pv.answers[from] !== undefined) return;               // 一题只能答一次，不能改
        var i = Number(action.i);
        if (isNaN(i) || g.cur.options[i] === undefined) return;
        _pv.answers[from] = i;
        g.cur.answered[from] = true;
        host.emit();                                               // 让对方看到「ta 已提交」
        var on = onlineParticipants(host);
        if (on.length >= 2 && on.every(function (id) { return _pv.answers[id] !== undefined; })) doReveal(host);
        return;
      }
      // 新人进来时状态是 retained 的，自己就同步了；作答内容本来就不该给旁观者
    },

    /** 换主：答案存在闭包里，换主就没了 —— 清空重答（揭晓前谁都没看到过，公平） */
    resume: function (host) {
      var g = host.g();
      if (!g || !g.cur) return;
      var left = Math.max(0, g.cur.deadline - host.now());
      if (g.cur.phase === 'answer') {
        _pv.answers = {};
        g.cur.answered = {};
        host.after('tacit_answer', left + 300, function () {
          var g2 = host.g();
          if (g2.cur && g2.cur.phase === 'answer') doReveal(host);
        });
      } else if (g.cur.phase === 'reveal') {
        host.after('tacit_next', Math.max(1200, left), function () {
          var g2 = host.g();
          if (!g2.cur || g2.cur.phase !== 'reveal') return;
          if (g2.round >= g2.total) finish(host);
          else { g2.round++; startQuestion(host); }
        });
      }
      host.emit();
    },

    /** 双人游戏少一个人就玩不下去：温和收尾（掉线有宽限期，这里是真离开） */
    onLeave: function (host, id) {
      var g = host.g();
      if (!g || !g.cur) return;
      if ((g.players || []).indexOf(id) < 0) return;
      if (onlineParticipants(host).length < 2) {
        host.toast('对方离开了，这一局先到这儿～', 'info');
        finish(host);
      }
    }
  };

  PN.games[ID] = game;
})(typeof globalThis !== 'undefined' ? globalThis : this);
