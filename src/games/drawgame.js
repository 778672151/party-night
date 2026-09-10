(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  var ID = 'drawgame';
  var NAME = '你画我猜';
  var EMOJI = '🎨';

  // ----- 闭包：绝不进入 state -----
  // _rounds[round] = { words:[], answer:null, segments:[{id,color,w,s}], guessed:{}, painterScore:0 }
  var _rounds = {};
  // 同理：用过的词也不能进 state.g —— 它会在下一回合前就把本回合 3 个候选词广播给所有人
  var _used = [];

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

  /** 差一点点：少一个字 / 多一个字 / 一个错字 → 给橙色提示 */
  function near(a, b) {
    if (!a || !b || a === b) return false;
    if (a.length > b.length) { var t = a; a = b; b = t; }
    if (b.length - a.length > 1) return false;
    if (a.length >= 2 && b.indexOf(a) === 0) return true;
    var i = 0, j = 0, diff = 0;
    while (i < a.length && j < b.length) {
      if (a.charAt(i) === b.charAt(j)) { i++; j++; continue; }
      if (++diff > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else { i++; j++; }
    }
    return diff + (a.length - i) + (b.length - j) <= 1;
  }

  function getRD(r) {
    if (!_rounds[r]) _rounds[r] = { words: [], answer: null, segments: [], guessed: {}, painterScore: 0 };
    if (!_rounds[r].guessed) _rounds[r].guessed = {};
    return _rounds[r];
  }

  /** 广播 peer 消息（画布数据，不走 state） */
  function peer(host, msg) {
    if (host.room && host.room.sendPeer) host.room.sendPeer(msg);
  }

  function nameOf(host, id) {
    var p = host.player(id);
    return p ? p.name : '玩家';
  }

  /** 聊天记录进 state（人人可见）；答案本身绝不入内 */
  function chat(host, k, id, name, text) {
    var g = host.g();
    if (!g) return;
    if (!g.chat) g.chat = [];
    g.chat.push({ k: k, id: id || '', name: name || '', text: String(text || ''), t: host.now() });
    if (g.chat.length > 60) g.chat.splice(0, g.chat.length - 60);
  }
  function sysChat(host, text) { chat(host, 'sys', '', '', text); }

  /** 提示用的洗牌（房主算，随 state 下发，客户端不必自己推） */
  function hintOrder(seed, len) {
    var x = (seed >>> 0) || 1, order = [], i;
    for (i = 0; i < len; i++) order.push(i);
    for (i = len - 1; i > 0; i--) {
      x ^= x << 13; x >>>= 0;
      x ^= x >> 17;
      x ^= x << 5; x >>>= 0;
      var j = x % (i + 1), tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    }
    return order;
  }

  /** 定时揭开一两个字（至少留一个字不揭） */
  function scheduleHint(host, painter) {
    host.clearTimer('drawgame_hint');
    var g = host.g();
    var rd = getRD(g.round);
    var answer = rd.answer || '';
    var len = answer.length;
    if (len < 3) return;
    var drawSec = (host.state.settings.drawgame || {}).drawSec || 90;
    var every = max(6, Math.floor(drawSec / (len + 1)));
    var order = hintOrder(g.round * 7919 + len * 131, len);
    var step = 0;
    host.every('drawgame_hint', every * 1000, function () {
      var g2 = host.g();
      if (!g2 || !g2.cur || g2.cur.phase !== 'draw' || g2.cur.painter !== painter) {
        host.clearTimer('drawgame_hint');
        return;
      }
      step++;
      if (step > len - 2) { host.clearTimer('drawgame_hint'); return; }
      var hint = {};
      for (var i = 0; i < step; i++) hint[order[i]] = answer.charAt(order[i]);
      g2.cur.hint = hint;
      host.emit();
    });
  }

  /** 进入绘画阶段 */
  function startDraw(host, answer) {
    var g = host.g();
    var settings = host.state.settings.drawgame || {};
    var drawSec = settings.drawSec || 90;
    var rd = getRD(g.round);

    g.cur.phase = 'draw';
    g.cur.deadline = host.now() + drawSec * 1000;
    g.cur.wordLen = answer.length;
    g.cur.hint = {};
    g.cur.guessed = rd.guessed;
    g.cur.reveal = null;

    // 画家必须随时能拿回自己的词（重连 / 刷新）
    host.sendSecret(g.cur.painter, { answer: answer, round: g.round, drawSec: drawSec });
    sysChat(host, '第 ' + g.round + ' 回合：' + nameOf(host, g.cur.painter) + ' 来画！');
    host.event({ t: 'word_picked', painter: g.cur.painter, wordLen: answer.length });
    host.emit();

    scheduleHint(host, g.cur.painter);

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
    if (!g || !g.cur) return;
    var rd = getRD(g.round);
    var answer = rd.answer || '???';
    host.clearTimer('drawgame_hint');
    host.clearTimer('drawgame_draw');

    g.cur.phase = 'reveal';
    g.cur.deadline = host.now() + 5000;
    g.cur.reveal = answer;
    g.cur.hint = null;

    sysChat(host, '本轮答案：「' + answer + '」');
    host.event({ t: 'reveal', answer: answer, painter: g.cur.painter });
    host.emit();
    host.after('drawgame_reveal', 5000, function () { nextRound(host); });
  }

  /** 除画家外所有在线玩家都猜中 → 1.4 秒后提前揭晓（猜对/有人退出都要重算） */
  function maybeEarlyReveal(host) {
    var g = host.g();
    if (!g || !g.cur || g.cur.phase !== 'draw') return;
    var rd = getRD(g.round);
    var guessed = rd.guessed || {};
    var left = host.onlinePlayers().filter(function (p) {
      return p.id !== g.cur.painter && !guessed[p.id];
    });
    if (left.length) return;
    host.clearTimer('drawgame_draw');
    host.after('drawgame_draw', 1400, function () {
      var g2 = host.g();
      if (g2.cur && g2.cur.phase === 'draw') doReveal(host);
    });
  }

  /** 猜中处理：分数跟剩余时间挂钩，画家按被猜中次数拿分 */
  function correct(host, who, text, secLeft) {
    var g = host.g();
    var rd = getRD(g.round);
    var settings = host.state.settings.drawgame || {};
    var drawSec = settings.drawSec || 90;
    if (!rd.guessed) rd.guessed = {};
    if (rd.guessed[who]) return;

    rd.guessed[who] = true;
    g.cur.guessed = rd.guessed;

    var nth = Object.keys(rd.guessed).length;
    var score = 50 + round(400 * max(0, secLeft) / drawSec) + (nth === 1 ? 50 : 0);
    host.addScore(who, score);
    chat(host, 'ok', who, nameOf(host, who), '猜中了！ +' + score);

    if (rd.painterScore < 400) {
      var add = min(100, 400 - rd.painterScore);
      rd.painterScore += add;
      host.addScore(g.cur.painter, add);
    }

    host.event({ t: 'correct', who: nameOf(host, who), text: '猜中了', secLeft: secLeft, score: score });
    host.emit();

    maybeEarlyReveal(host);
  }

  /** 自动替画家选第一个词 */
  function autoPick(host) {
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
    host.clearTimer('drawgame_hint');

    if (g.round >= rounds) {
      g.cur = null;
      g.done = true;
      s.phase = 'over'; // 和另外三个游戏保持一致的 phase 契约（界面本来就读 g.done）
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
    // 注意：不能写 (g.orderIdx || -1) + 1 —— orderIdx 为 0 时 0 是 falsy，会永远停在第一个画家
    g.orderIdx = (g.orderIdx >= 0 ? g.orderIdx : -1) + 1;
    if (g.orderIdx >= g.order.length) g.orderIdx = 0;

    var painter = g.order[g.orderIdx];
    var online = host.onlinePlayers();
    var onlineIds = {};
    for (var k = 0; k < online.length; k++) onlineIds[online[k].id] = true;

    if (!onlineIds[painter]) {
      host.after('drawgame_skip', 100, function () { nextRound(host); });
      return;
    }

    var pi = g.order.indexOf(painter);
    var left = g.order[(pi - 1 + g.order.length) % g.order.length];
    var right = g.order[(pi + 1) % g.order.length];

    var words = PN.pick.drawWords(_used, 3);
    for (var wi = 0; wi < words.length; wi++) {
      if (_used.indexOf(words[wi]) === -1) _used.push(words[wi]);
    }

    var rd = getRD(g.round);
    rd.words = words;
    rd.answer = null;
    rd.segments = [];
    rd.guessed = {};
    rd.painterScore = 0;

    g.cur = {
      painter: painter,
      left: left,
      right: right,
      phase: 'pick',
      deadline: host.now() + 30000,
      wordLen: 0,
      hint: {},
      guessed: {},
      reveal: null
    };

    host.sendSecret(painter, { words: words, drawSec: (settings.drawSec || 90), round: g.round });

    host.after('drawgame_pick', 30000, function () {
      var g2 = host.g();
      if (g2.cur && g2.cur.phase === 'pick' && g2.cur.painter === painter) {
        autoPick(host);
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
        order: order,
        orderIdx: -1,
        cur: null,
        done: false,
        winner: null,
        chat: [],
        startedAt: host.now()
      };

      _rounds = {};
      _used = [];

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

      // 新玩家加入 / 重连 → 回放笔迹（回放走私密通道，顺带把词补给画家）
      if (action.t === '_joined' || action.t === 'hi') {
        if (g.cur && g.cur.phase === 'draw' && from) {
          var rd0 = getRD(g.round);
          var payload = { round: g.round };
          if (rd0.segments && rd0.segments.length) payload.replay = rd0.segments;
          if (from === g.cur.painter && rd0.answer) {
            payload.answer = rd0.answer;
            payload.drawSec = (host.state.settings.drawgame || {}).drawSec || 90;
          }
          if (payload.replay || payload.answer) host.sendSecret(from, payload);
        }
        return;
      }

      // ----- 画笔数据（peer 转发，不进 state；房主留一份用于回放） -----
      if (action.t === 'peer') {
        var msg = action.msg;
        if (!msg) return;
        if (g.cur && g.cur.phase === 'draw') {
          var rd = getRD(g.round);
          if (msg.t === 'stroke' && msg.s && msg.s.length) {
            rd.segments.push({ id: msg.id, r: msg.r, color: msg.color, w: msg.w, s: msg.s });
            while (rd.segments.length > 900) rd.segments.shift();
          } else if (msg.t === 'undo') {
            rd.segments = rd.segments.filter(function (c) { return c.id !== msg.id; });
          } else if (msg.t === 'clear') {
            rd.segments = [];
          }
        }
        peer(host, msg);
        return;
      }
      if (action.t === 'clear') {
        if (g.cur && g.cur.phase === 'draw') getRD(g.round).segments = [];
        peer(host, { t: 'clear' });
        return;
      }
      if (action.t === 'style') {
        peer(host, { t: 'style', color: action.color, w: action.w });
        return;
      }

      if (!from) return;

      // ----- 房主迁移：画家回报自己手里的词 -----
      if (action.t === 'repaint' && g.cur && from === g.cur.painter) {
        var rdR = getRD(g.round);
        if (action.words && action.words.length && !rdR.words.length) rdR.words = action.words.slice(0, 3);
        if (action.answer && !rdR.answer) {
          rdR.answer = String(action.answer).slice(0, 30);
          if (g.cur.phase === 'pick') { host.clearTimer('drawgame_pick'); startDraw(host, rdR.answer); }
          else host.emit();
        }
        return;
      }

      // ----- 选词 -----
      if (action.t === 'pick' && g.cur && g.cur.phase === 'pick' && g.cur.painter === from) {
        var rd1 = getRD(g.round);
        var answer = null;
        if (typeof action.i === 'number' && rd1.words && rd1.words[action.i]) {
          answer = rd1.words[action.i];
        } else if (action.word) {
          answer = action.word;
        } else if (rd1.words && rd1.words[0]) {
          answer = rd1.words[0];
        }
        if (answer) {
          rd1.answer = answer;
          host.clearTimer('drawgame_pick');
          startDraw(host, answer);
        }
        return;
      }

      // ----- 猜词 -----
      if (action.t === 'guess' && g.cur && g.cur.phase === 'draw' && g.cur.painter !== from) {
        var text = String(action.text || '').slice(0, 30).trim();
        if (!text) return;
        var rd2 = getRD(g.round);
        if (!rd2.answer) return;
        if (rd2.guessed && rd2.guessed[from]) return;
        var nm = norm(text), na = norm(rd2.answer);
        if (nm && nm === na) {
          var secLeft = g.cur.deadline ? round(max(0, g.cur.deadline - host.now()) / 1000) : 0;
          correct(host, from, text, secLeft);
        } else {
          chat(host, near(nm, na) ? 'near' : 'msg', from, nameOf(host, from), text);
          host.emit();
        }
        return;
      }
    },

    resume: function (host) {
      var g = host.g();
      if (!g || !g.cur) return;

      // 新房主的闭包是空的（_rounds 每个页面一份），本回合的答案和候选词都丢了：
      // 向画家要回来。少了这一步，猜对也不认、选词超时会变成「???」，整回合废掉。
      if (g.cur.painter && !getRD(g.round).answer) {
        host.requestSecret(g.cur.painter, { recover: true, round: g.round });
      }

      var now = host.now();
      var remaining = max(0, g.cur.deadline - now);
      var phase = g.cur.phase;

      if (phase === 'pick') {
        host.after('drawgame_pick', remaining, function () {
          var g2 = host.g();
          if (g2.cur && g2.cur.phase === 'pick') autoPick(host);
        });
      } else if (phase === 'draw') {
        scheduleHint(host, g.cur.painter);
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
        host.clearTimer('drawgame_hint');
        host.toast('🎨 画家溜了，自动换人！', 'info');
        host.emit();
        nextRound(host);
        return;
      }
      // 走的是没猜出来的猜词者：剩下的人可能已经全猜中，别让大家干等
      if (g.cur.phase === 'draw') maybeEarlyReveal(host);
    }
  };

  PN.games[ID] = game;
})(typeof globalThis !== 'undefined' ? globalThis : this);
