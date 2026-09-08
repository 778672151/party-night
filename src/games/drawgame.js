(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  var ID = 'drawgame';
  var NAME = '你画我猜';
  var EMOJI = '🎨';

  // ----- 闭包：绝不进入 state -----
  var _rounds = {}; // { roundNum: { words:[], answer: null|string, segments:[], painterBonus:bool } }

  function min(a, b) { return a < b ? a : b; }
  function max(a, b) { return a > b ? a : b; }
  function round(n) { return Math.round(n); }

  /** 归一化猜测文本 */
  function norm(s) {
    s = String(s || '');
    s = s.replace(/[\uFF01-\uFF5E]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    });
    s = s.replace(/\s+/g, '');
    s = s.replace(/[，。！？、；：""''（）【】《》\.,!?;:'"()\[\]{}<>\/\\\-_=+~`@#$%^&*|]/g, '');
    return s.toLowerCase();
  }

  function getRD(round) {
    if (!_rounds[round]) _rounds[round] = { words: [], answer: null, segments: [], painterBonus: false };
    return _rounds[round];
  }

  /** 广播 peer 消息（画布数据，不走 state） */
  function peer(host, msg) {
    if (host.room && host.room.sendPeer) host.room.sendPeer(msg);
  }

  /** 进入绘画阶段 */
  function startDraw(host, answer) {
    var g = host.g();
    var settings = host.state.settings.drawgame || {};
    var drawSec = settings.drawSec || 90;
    g.cur.phase = 'draw';
    g.cur.deadline = host.now() + drawSec * 1000;
    host.event({ t: 'word_picked', painter: g.cur.painter, wordLen: answer.length });
    host.emit();

    host.after('drawgame_draw', drawSec * 1000, function () {
      var g2 = host.g();
      if (g2.cur && g2.cur.phase === 'draw' && g2.cur.painter === g.cur.painter) {
        doReveal(host);
      }
    });
  }

  /** 揭示答案 */
  function doReveal(host) {
    var g = host.g();
    var rd = getRD(g.round);
    var answer = rd.answer || '???';
    g.cur.phase = 'reveal';
    g.cur.deadline = host.now() + 5000;
    host.event({ t: 'reveal', answer: answer, painter: g.cur.painter });
    host.emit();
    host.after('drawgame_reveal', 5000, function () { nextRound(host); });
  }

  /** 猜中处理 */
  function correct(host, who, text, secLeft) {
    var g = host.g();
    var rd = getRD(g.round);
    var settings = host.state.settings.drawgame || {};
    var drawSec = settings.drawSec || 90;
    var used = drawSec - secLeft;
    var score = min(300, round(1000 / (5 + max(0, used))));

    host.addScore(who, score);
    host.event({ t: 'correct', who: who, text: text, secLeft: secLeft, score: score });

    if (!rd.painterBonus) {
      host.addScore(g.cur.painter, 400);
      rd.painterBonus = true;
      host.event({ t: 'painter_bonus', painter: g.cur.painter, score: 400 });
    }

    var p = host.player(who);
    host.toast('🎉 ' + (p ? p.name : who) + ' 猜对了！+ ' + score, 'good');
    host.emit();
    doReveal(host);
  }

  /** 自动替画家选第一个词 */
  function autoPick(host, painter) {
    var g = host.g();
    var rd = getRD(g.round);
    var picked = (rd.words && rd.words[0]) || '???';
    rd.answer = picked;
    startDraw(host, picked);
  }

  /** 进入下一回合 / 结束 */
  function nextRound(host) {
    var g = host.g();
    var s = host.state;
    var settings = s.settings.drawgame || {};
    var rounds = settings.rounds || 6;

    if (g.round >= rounds) {
      g.cur = null;
      g.done = true;
      var players = host.state.players;
      var winner = null, maxScore = -1;
      for (var i = 0; i < players.length; i++) {
        if (players[i].score > maxScore) { maxScore = players[i].score; winner = players[i].id; }
      }
      g.winner = winner;
      host.event({ t: 'gameover', players: players.map(function (p) { return { id: p.id, name: p.name, score: p.score }; }) });
      host.toast('🎨 游戏结束！' + (winner ? host.player(winner).name : '??') + ' 画成了全场最佳！', 'good');
      host.emit();
      return;
    }

    g.round = (g.round || 0) + 1;
    g.orderIdx = (g.orderIdx || -1) + 1;
    if (g.orderIdx >= g.order.length) g.orderIdx = 0;

    var painter = g.order[g.orderIdx];
    var online = host.onlinePlayers();
    var onlineIds = {};
    for (var i = 0; i < online.length; i++) onlineIds[online[i].id] = true;

    if (!onlineIds[painter]) {
      host.after('drawgame_skip', 100, function () { nextRound(host); });
      return;
    }

    var pi = g.order.indexOf(painter);
    var left = g.order[(pi - 1 + g.order.length) % g.order.length];
    var right = g.order[(pi + 1) % g.order.length];

    var words = PN.pick.drawWords(g.used, 3);
    for (var wi = 0; wi < words.length; wi++) {
      if (g.used.indexOf(words[wi]) === -1) g.used.push(words[wi]);
    }

    var rd = getRD(g.round);
    rd.words = words;
    rd.answer = null;
    rd.segments = [];
    rd.painterBonus = false;

    g.cur = {
      painter: painter,
      left: left,
      right: right,
      phase: 'pick',
      deadline: host.now() + 30000
    };

    host.sendSecret(painter, { words: words, drawSec: (settings.drawSec || 90), round: g.round });

    host.after('drawgame_pick', 30000, function () {
      var g2 = host.g();
      if (g2.cur && g2.cur.phase === 'pick' && g2.cur.painter === painter) {
        autoPick(host, painter);
      }
    });

    host.emit();
  }

  // ===== 游戏模块 =====
  var game = {
    id: ID,
    name: NAME,
    emoji: EMOJI,
    blurb: '你画我猜，灵魂画手集合！🎨',
    minPlayers: 2,
    maxPlayers: 12,

    init: function (host) {
      var s = host.state;
      var settings = s.settings.drawgame || (s.settings.drawgame = { rounds: 6, drawSec: 90 });
      s.phase = 'round';

      var online = host.onlinePlayers();
      var order = [];
      for (var i = 0; i < online.length; i++) order.push(online[i].id);
      for (var i = order.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = order[i]; order[i] = order[j]; order[j] = tmp;
      }

      s.g = {
        round: 0,
        used: [],
        order: order,
        orderIdx: -1,
        cur: null,
        done: false,
        winner: null
      };

      _rounds = {};

      host.toast('🎨 你画我猜开始！第一位画家即将诞生...', 'good');
      host.emit();
      nextRound(host);
    },

    action: function (host, action, from) {
      var g = host.g();
      if (!g) return;

      // 房主控制
      if (action.t === 'lobby') { if (host.amHost(from)) host.goLobby(); return; }
      if (action.t === 'again') { if (host.amHost(from)) this.init(host); return; }

      // 新玩家加入 / 重连 → 发送回放（回放走私密通道）
      if (action.t === '_joined' || action.t === 'hi' || action.t === '_replay') {
        if (g.cur && g.cur.phase === 'draw' && from) {
          var rd = getRD(g.round);
          if (rd.segments && rd.segments.length) {
            host.sendSecret(from, { replay: rd.segments, round: g.round });
          }
        }
        return;
      }

      // ----- 画笔数据（peer 转发，不进 state） -----
      if (action.t === 'peer') {
        if (g.cur && g.cur.phase === 'draw' && action.msg && action.msg.s) {
          var rd = getRD(g.round);
          rd.segments = rd.segments.concat(action.msg.s);
        }
        if (action.msg) peer(host, action.msg);
        return;
      }
      if (action.t === 'clear') {
        peer(host, { t: 'clear' });
        return;
      }
      if (action.t === 'style') {
        peer(host, { t: 'style', color: action.color, w: action.w });
        return;
      }

      if (!from) return;

      // ----- 选词 -----
      if (action.t === 'pick' && g.cur && g.cur.phase === 'pick' && g.cur.painter === from) {
        var rd = getRD(g.round);
        var answer = null;
        if (typeof action.i === 'number' && rd.words && rd.words[action.i]) {
          answer = rd.words[action.i];
        } else if (action.word) {
          answer = action.word;
        } else if (rd.words && rd.words[0]) {
          answer = rd.words[0];
        }
        if (answer) {
          rd.answer = answer;
          host.clearTimer('drawgame_pick');
          startDraw(host, answer);
        }
        return;
      }

      // ----- 猜词 -----
      if (action.t === 'guess' && g.cur && g.cur.phase === 'draw' && g.cur.painter !== from) {
        var text = String(action.text || '');
        if (!text) return;
        var rd = getRD(g.round);
        if (!rd.answer) return;
        if (norm(text) === norm(rd.answer)) {
          var secLeft = g.cur.deadline ? round(max(0, g.cur.deadline - host.now()) / 1000) : 0;
          correct(host, from, text, secLeft);
        }
        return;
      }
    },

    resume: function (host) {
      var g = host.g();
      if (!g || !g.cur) return;

      var now = host.now();
      var remaining = max(0, g.cur.deadline - now);
      var phase = g.cur.phase;

      if (phase === 'pick') {
        host.after('drawgame_pick', remaining, function () {
          var g2 = host.g();
          if (g2.cur && g2.cur.phase === 'pick') autoPick(host, g2.cur.painter);
        });
      } else if (phase === 'draw') {
        host.after('drawgame_draw', remaining, function () {
          var g2 = host.g();
          if (g2.cur && g2.cur.phase === 'draw') doReveal(host);
        });
      } else if (phase === 'reveal') {
        host.after('drawgame_reveal', remaining, function () { nextRound(host); });
      }
    },

    onLeave: function (host, id) {
      var g = host.g();
      if (!g || !g.cur) return;
      if (g.cur.painter === id) {
        host.clearTimer('drawgame_pick');
        host.clearTimer('drawgame_draw');
        host.toast('🎨 画家溜了，自动换人！', 'info');
        host.emit();
        nextRound(host);
      }
    }
  };

  PN.games[ID] = game;
})(typeof globalThis !== 'undefined' ? globalThis : this);