/* ===== 谁是卧底 =====
 * 词、角色只通过 host.sendSecret 下发；卧底名单存在模块闭包（绝不进 state.g）
 * 流程：setup(房主选边) → describe → vote/revote → (blankGuess) → 下一轮/over
 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  var M = {};
  M.id = 'undercover';
  M.name = '谁是卧底';
  M.emoji = '🕵️';
  M.blurb = '每人拿到一个词，找出卧底，或者骗过所有人！';
  M.minPlayers = 3;
  M.maxPlayers = 12;

  var _priv = new WeakMap(); // host -> { under:[ids], blankId, side, civilWord, underWord, pair }

  function priv(host) {
    if (!_priv.has(host)) _priv.set(host, {});
    return _priv.get(host);
  }
  function alive(host) { return host.g().alive; }

  M.init = function (host) {
    var s = host.state;
    var st = s.settings.undercover || {};
    s.g = {
      phase: 'setup',
      side: 'random',
      round: 0,
      used: [],
      alive: [],
      dead: [],
      desc: [],
      descCount: 0,
      votes: {},
      counts: {},
      revotePool: null,
      blankEliminated: false,
      blankGuess: null,
      winner: null,
      scores: {},
      textMode: st.textMode !== false,
      numUnder: st.numUnder === 2 ? 2 : 1,
      blank: !!st.blank,
      deadline: 0,
      recovering: false
    };
    _priv.set(host, {});
    host.toast('🕵️ 谁是卧底 准备就绪，房主开局！', 'info');
    host.emit();
  };

  function deal(host) {
    var g = host.g();
    var s = host.state;
    var st = s.settings.undercover || {};
    var numUnder = st.numUnder === 2 ? 2 : 1;
    var blank = !!st.blank;
    var textMode = st.textMode !== false;
    var roundSec = st.roundSec || 180;

    var players = host.onlinePlayers();
    var total = players.length;
    if (numUnder + (blank ? 1 : 0) >= total || total < 3) {
      host.toast('人数不够：至少需要 ' + (numUnder + (blank ? 1 : 0) + 1) + ' 人', 'bad');
      return;
    }

    var pair = PN.pick.undercoverPair(g.used);
    var key = pair.a + '|' + pair.b;
    if (g.used.indexOf(key) === -1) g.used.push(key);

    var side = g.side === 'a' || g.side === 'b' ? g.side : (Math.random() < 0.5 ? 'a' : 'b');
    var underWord = side === 'a' ? pair.a : pair.b;
    var civilWord = side === 'a' ? pair.b : pair.a;

    var ids = players.map(function (p) { return p.id; });
    for (var i = ids.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
    }
    var underIds = ids.slice(0, numUnder);
    var blankId = blank ? ids[numUnder] : null;
    var civilIds = blank ? ids.slice(numUnder + 1) : ids.slice(numUnder);

    priv(host).under = underIds;
    priv(host).blankId = blankId;
    priv(host).side = side;
    priv(host).underWord = underWord;
    priv(host).civilWord = civilWord;
    priv(host).pair = pair;

    g.round = 1;
    g.alive = ids.slice();
    g.dead = [];
    g.desc = [];
    g.descCount = 0;
    g.votes = {};
    g.counts = {};
    g.revotePool = null;
    g.blankEliminated = false;
    g.blankGuess = null;
    g.winner = null;
    g.scores = {};
    g.textMode = textMode;
    g.numUnder = numUnder;
    g.blank = blank;
    g.phase = 'describe';
    g.deadline = host.now() + roundSec * 1000;
    g.recovering = false;

    var base = { round: g.round, underCount: numUnder, blank: false, textMode: textMode };
    for (var c = 0; c < civilIds.length; c++) host.sendSecret(civilIds[c], { word: civilWord, role: 'civil', round: 1, underCount: numUnder, blank: false, textMode: textMode });
    for (var u = 0; u < underIds.length; u++) host.sendSecret(underIds[u], { word: underWord, role: 'under', round: 1, underCount: numUnder, blank: false, textMode: textMode });
    if (blankId) host.sendSecret(blankId, { word: null, role: 'blank', round: 1, underCount: numUnder, blank: true, textMode: textMode });

    host.after('describe', roundSec * 1000, function () { advanceVote(host); });
    host.toast('🕵️ 词已私发！卧底请藏好自己', 'info');
    host.event({ t: 'round', msg: '第 1 轮：大家来' + (textMode ? '打字' : '开口') + '描述吧' });
    host.emit();
  }

  M.action = function (host, action, from) {
    var g = host.g();
    if (!g || !g.phase) return;
    switch (action.t) {
      case 'start':
        if (host.amHost(from) && g.phase === 'setup') deal(host);
        break;
      case 'pickSide':
        if (host.amHost(from) && g.phase === 'setup') {
          g.side = action.side === 'a' || action.side === 'b' ? action.side : 'random';
          host.emit();
        }
        break;
      case 'desc':
        if (g.phase === 'describe' && g.textMode) handleDesc(host, action, from);
        break;
      case 'vote':
        if (g.phase === 'vote' || g.phase === 'revote') handleVote(host, action, from);
        break;
      case 'blankGuess':
        if (g.phase === 'blankGuess' && priv(host).blankId === from && !g.blankGuess) handleBlankGuess(host, action, from);
        break;
      case 'recover':
        recoverFrom(host, from, action);
        break;
      case 'again':
        if (host.amHost(from) && g.phase === 'over') M.init(host);
        break;
      case 'lobby':
        if (host.amHost(from)) host.goLobby();
        break;
    }
  };

  function recoverFrom(host, from, action) {
    var g = host.g();
    if (g.alive.indexOf(from) === -1) return;
    if (!host.secretCache[from]) {
      host.secretCache[from] = {
        word: action.word == null ? null : action.word,
        role: action.role || 'civil',
        round: g.round,
        underCount: g.numUnder,
        blank: action.role === 'blank',
        textMode: g.textMode
      };
    }
    if (g.recovering) {
      var done = g.alive.every(function (id) { return !!host.secretCache[id]; });
      if (done) {
        host.clearTimer('recover');
        g.recovering = false;
        host.emit();
      }
    }
  }

  M.resume = function (host) {
    var g = host.g();
    if (!g || !g.phase) return;
    if (g.phase === 'describe' && g.deadline) host.after('describe', Math.max(0, g.deadline - host.now()), function () { advanceVote(host); });
    if (g.phase === 'vote' && g.deadline) host.after('vote', Math.max(0, g.deadline - host.now()), function () { tallyVotes(host); });
    if (g.phase === 'revote' && g.deadline) host.after('revote', Math.max(0, g.deadline - host.now()), function () { tallyVotes(host); });
    if (g.phase === 'blankGuess' && g.deadline) host.after('blankGuess', Math.max(0, g.deadline - host.now()), function () { blankGuessTimeout(host); });
    // 新房主没有缓存 → 让玩家上报重建
    if (g.phase !== 'setup' && g.phase !== 'over') {
      var need = g.alive.filter(function (id) { return !host.secretCache[id]; });
      if (need.length) {
        g.recovering = true;
        for (var i = 0; i < need.length; i++) host.sendSecret(need[i], { recover: true, round: g.round });
        host.after('recover', 10000, function () { var g2 = host.g(); if (g2) { g2.recovering = false; host.emit(); } });
      }
    }
  };

  M.onLeave = function (host, id) {
    var g = host.g();
    if (!g || !g.phase) return;
    var idx = g.alive.indexOf(id);
    if (idx !== -1) g.alive.splice(idx, 1);
    if (g.phase === 'describe') {
      for (var i = g.desc.length - 1; i >= 0; i--) if (g.desc[i].id === id) { g.desc.splice(i, 1); g.descCount = Math.max(0, g.descCount - 1); }
    }
    if (g.phase === 'vote' || g.phase === 'revote') delete g.votes[id];
    if (g.phase !== 'setup' && g.phase !== 'over') checkWin(host);
  };

  function handleDesc(host, action, from) {
    var g = host.g();
    if (alive(host).indexOf(from) === -1) return;
    for (var i = 0; i < g.desc.length; i++) if (g.desc[i].id === from) return;
    var p = host.player(from);
    var text = String(action.text || '').slice(0, 200);
    if (!text) return;
    g.desc.push({ id: from, name: p ? p.name : '??', text: text });
    g.descCount++;
    if (g.descCount >= alive(host).length) {
      host.clearTimer('describe');
      advanceVote(host);
    } else host.emit();
  }

  function advanceVote(host) {
    var g = host.g();
    host.event({ t: 'descAll', descs: g.desc.map(function (d) { return { name: d.name, text: d.text }; }) });
    g.phase = 'vote';
    g.votes = {};
    g.counts = {};
    g.revotePool = null;
    g.deadline = host.now() + 60000;
    host.after('vote', 60000, function () { tallyVotes(host); });
    host.toast('🗳️ 描述完毕，开始投票！', 'info');
    host.emit();
  }

  function handleVote(host, action, from) {
    var g = host.g();
    if (alive(host).indexOf(from) === -1) return;
    if (g.votes[from] !== undefined) return;
    var target = action.id;
    if (!target || target === from) return;
    if (alive(host).indexOf(target) === -1) return;
    if (g.phase === 'revote' && g.revotePool && g.revotePool.indexOf(target) === -1) return;
    g.votes[from] = target;
    var voted = 0;
    for (var k in g.votes) if (Object.prototype.hasOwnProperty.call(g.votes, k)) voted++;
    if (voted >= alive(host).length) {
      host.clearTimer(g.phase === 'vote' ? 'vote' : 'revote');
      tallyVotes(host);
    } else host.emit();
  }

  function tallyVotes(host) {
    var g = host.g();
    var counts = {};
    for (var voter in g.votes) if (Object.prototype.hasOwnProperty.call(g.votes, voter)) {
      var t = g.votes[voter];
      counts[t] = (counts[t] || 0) + 1;
    }
    var maxCount = 0, topIds = [];
    for (var id in counts) if (Object.prototype.hasOwnProperty.call(counts, id)) {
      if (counts[id] > maxCount) { maxCount = counts[id]; topIds = [id]; }
      else if (counts[id] === maxCount) topIds.push(id);
    }
    g.counts = counts;
    host.event({ t: 'voteResult', counts: counts });
    if (topIds.length > 1 && maxCount > 0) {
      if (g.phase === 'revote') {
        host.toast('🤝 再次平票，本轮无人出局', 'info');
        startNewRound(host);
      } else {
        g.phase = 'revote';
        g.revotePool = topIds;
        g.votes = {};
        g.deadline = host.now() + 60000;
        host.after('revote', 60000, function () { tallyVotes(host); });
        host.toast('⚖️ 平票！请在平票者里重投', 'info');
        host.emit();
      }
      return;
    }
    if (topIds.length === 1) eliminatePlayer(host, topIds[0]);
    else {
      host.toast('😶 无人投票，进入下一轮', 'info');
      startNewRound(host);
    }
  }

  function eliminatePlayer(host, id) {
    var g = host.g();
    var p = priv(host);
    var idx = alive(host).indexOf(id);
    if (idx !== -1) { alive(host).splice(idx, 1); if (g.dead.indexOf(id) === -1) g.dead.push(id); }
    var pl = host.player(id);
    host.event({ t: 'eliminated', id: id, name: pl ? pl.name : '??' });
    if (p.blankId === id && !g.blankEliminated) {
      g.blankEliminated = true;
      g.phase = 'blankGuess';
      g.deadline = host.now() + 30000;
      host.sendSecret(id, { guess: true });
      host.after('blankGuess', 30000, function () { blankGuessTimeout(host); });
      host.toast('🃏 白板被投出，有一次猜词机会！', 'info');
      host.emit();
      return;
    }
    checkWin(host);
  }

  function blankGuessTimeout(host) {
    var g = host.g();
    if (g.phase !== 'blankGuess') return;
    g.blankGuess = '__timeout__';
    host.toast('⏰ 白板超时，视为猜错', 'info');
    checkWin(host);
  }

  function handleBlankGuess(host, action, from) {
    var g = host.g();
    var p = priv(host);
    if (p.blankId !== from || g.phase !== 'blankGuess') return;
    host.clearTimer('blankGuess');
    var guess = String(action.word || '').trim();
    if (!guess) return;
    g.blankGuess = guess;
    if (guess === p.civilWord) {
      g.winner = [from];
      host.toast('🎉 白板猜对了！白板个人获胜！', 'good');
      endGame(host);
    } else {
      host.toast('❌ 白板猜错了，已被淘汰', 'info');
      checkWin(host);
    }
  }

  function checkWin(host) {
    var g = host.g();
    var p = priv(host);
    if (alive(host).length <= 1) {
      g.winner = alive(host).length && p.under.indexOf(alive(host)[0]) !== -1 ? 'under' : 'civil';
      endGame(host);
      return;
    }
    var underAlive = 0;
    for (var i = 0; i < alive(host).length; i++) if (p.under.indexOf(alive(host)[i]) !== -1) underAlive++;
    var civilAlive = alive(host).length - underAlive;
    if (underAlive > 0 && civilAlive <= underAlive) { g.winner = 'under'; endGame(host); return; }
    if (underAlive === 0) { g.winner = 'civil'; endGame(host); return; }
    startNewRound(host);
  }

  function startNewRound(host) {
    var g = host.g();
    var st = host.state.settings.undercover || {};
    var roundSec = st.roundSec || 180;
    g.round++;
    g.phase = 'describe';
    g.desc = [];
    g.descCount = 0;
    g.votes = {};
    g.counts = {};
    g.revotePool = null;
    g.deadline = host.now() + roundSec * 1000;
    var p = priv(host);
    if (p.blankId && alive(host).indexOf(p.blankId) !== -1) {
      host.sendSecret(p.blankId, { word: null, role: 'blank', round: g.round, underCount: g.numUnder, blank: true, textMode: g.textMode });
    }
    host.after('describe', roundSec * 1000, function () { advanceVote(host); });
    host.toast('🔄 第 ' + g.round + ' 轮开始！', 'info');
    host.event({ t: 'round', msg: '第 ' + g.round + ' 轮：继续描述' });
    host.emit();
  }

  function endGame(host) {
    var g = host.g();
    var p = priv(host);
    g.phase = 'over';
    g.deadline = 0;
    host.clearTimer('describe'); host.clearTimer('vote'); host.clearTimer('revote'); host.clearTimer('blankGuess'); host.clearTimer('recover');
    var players = host.state.players;
    for (var i = 0; i < alive(host).length; i++) {
      var pid = alive(host)[i];
      host.addScore(pid, p.under.indexOf(pid) !== -1 ? 2 : 1);
    }
    if (g.winner === 'under') for (var u = 0; u < p.under.length; u++) host.addScore(p.under[u], 2);
    else if (g.winner === 'civil') for (var c = 0; c < players.length; c++) if (p.under.indexOf(players[c].id) === -1 && players[c].id !== p.blankId) host.addScore(players[c].id, 2);
    else if (Array.isArray(g.winner)) host.addScore(g.winner[0], 2);
    var maxScore = -1, mvpId = null;
    for (var s = 0; s < players.length; s++) if ((players[s].score || 0) > maxScore) { maxScore = players[s].score; mvpId = players[s].id; }
    if (mvpId) host.addScore(mvpId, 2);
    g.scores = {};
    for (var sc = 0; sc < players.length; sc++) g.scores[players[sc].id] = players[sc].score;
    var pair = p.pair || { a: '词A', b: '词B' };
    host.revealAll({ words: [pair.a, pair.b], underWord: p.underWord, winner: g.winner });
    host.event({ t: 'gameover', winner: g.winner, msg: g.winner === 'under' ? '卧底赢了！' : (Array.isArray(g.winner) ? '白板猜词获胜！' : '平民赢了！'), players: players.map(function (x) { return { id: x.id, name: x.name, score: x.score }; }) });
    host.toast('🏁 游戏结束！', 'info');
    host.emit();
  }

  PN.games['undercover'] = {
    id: M.id, name: M.name, emoji: M.emoji, blurb: M.blurb,
    minPlayers: M.minPlayers, maxPlayers: M.maxPlayers,
    init: M.init, action: M.action, resume: M.resume, onLeave: M.onLeave
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
