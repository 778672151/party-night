/* ===== 谁最有可能：投票选出最符合描述的玩家 =====
 * 每回合：出题 → 投票 → 结算 → 下一回合
 * 秘密：无（所有信息公开）
 * g 字段：{ round, used, cur, last, done, winner, settings }
 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  var M = {
    id: 'mostlikely',
    name: '谁最有可能',
    emoji: '🎯',
    blurb: '读题后投票，选出最符合描述的人',
    minPlayers: 3,
    maxPlayers: 12
  };

  function getSettings(host) {
    var s = host.state.settings.mostlikely || {};
    return {
      rounds: s.rounds || 8,
      eachSec: s.eachSec || 30
    };
  }

  function nextRound(host) {
    var g = host.g();
    var settings = g.settings;
    g.round++;

    if (g.round > settings.rounds) {
      endGame(host);
      return;
    }

    // 抽题（去重键就是题目本身）
    var q = PN.pick.prompt(g.used);
    g.used.push(q);

    g.cur = {
      q: q,
      votes: {},
      deadline: host.now() + settings.eachSec * 1000
    };
    g.last = null;
    host.state.phase = 'vote';

    host.event({ t: 'question', q: q, round: g.round, total: settings.rounds });
    host.emit();

    // 倒计时自动结算
    host.after('vote', settings.eachSec * 1000, function () {
      settleRound(host);
    });
  }

  function settleRound(host) {
    host.clearTimer('vote');

    var g = host.g();
    if (!g.cur) { host.emit(); return; }

    var votes = g.cur.votes || {};

    // 只统计在线玩家获得的票
    var onlinePlayers = host.onlinePlayers();
    var online = {};
    for (var i = 0; i < onlinePlayers.length; i++) {
      online[onlinePlayers[i].id] = true;
    }

    var counts = {};
    var totalVotes = 0;
    for (var voterId in votes) {
      if (Object.prototype.hasOwnProperty.call(votes, voterId)) {
        var targetId = votes[voterId];
        if (online[targetId]) {
          counts[targetId] = (counts[targetId] || 0) + 1;
          totalVotes++;
        }
      }
    }

    // 找最高票
    var maxVotes = 0;
    for (var id in counts) {
      if (Object.prototype.hasOwnProperty.call(counts, id)) {
        if (counts[id] > maxVotes) maxVotes = counts[id];
      }
    }

    var winners = [];
    if (maxVotes > 0) {
      for (var id2 in counts) {
        if (Object.prototype.hasOwnProperty.call(counts, id2)) {
          if (counts[id2] === maxVotes) {
            winners.push(id2);
            host.addScore(id2, 3 * maxVotes);
          }
        }
      }
    }

    g.last = {
      counts: JSON.parse(JSON.stringify(counts)),
      winners: winners.slice()
    };
    g.cur = null;
    host.state.phase = 'reveal';

    if (winners.length > 0) {
      host.event({ t: 'reveal', counts: counts, winners: winners, maxVotes: maxVotes });
    } else {
      host.toast('这回合没人投票，大家太羞涩了😳', 'info');
      host.event({ t: 'reveal', counts: {}, winners: [], maxVotes: 0 });
    }

    host.emit();

    // 短暂展示后自动下一回合
    host.after('next', 3000, function () {
      nextRound(host);
    });
  }

  function endGame(host) {
    host.clearTimer('next');

    var g = host.g();
    g.done = true;
    host.state.phase = 'over';

    // 计算全场最高分
    var players = host.state.players;
    var topScore = 0;
    var topPlayer = null;
    var tie = false;
    for (var i = 0; i < players.length; i++) {
      if (players[i].score > topScore) {
        topScore = players[i].score;
        topPlayer = players[i];
        tie = false;
      } else if (players[i].score === topScore && topScore > 0) {
        tie = true;
      }
    }

    if (topPlayer && !tie) {
      topPlayer.wins = (topPlayer.wins || 0) + 1;
      g.winner = topPlayer.id;
    } else {
      g.winner = null;
    }

    var playerScores = players.map(function (p) {
      return { id: p.id, name: p.name, score: p.score };
    });
    host.event({ t: 'gameover', winner: g.winner, players: playerScores });
    host.emit();
  }

  M.init = function (host) {
    var g = host.g();
    var settings = getSettings(host);
    host.state.phase = 'round';
    g.round = 0;
    g.used = [];
    g.cur = null;
    g.last = null;
    g.done = false;
    g.winner = null;
    g.settings = settings;
    host.emit();
    nextRound(host);
  };

  M.action = function (host, action, from) {
    var g = host.g();

    // 投票
    if (action.t === 'vote') {
      if (host.state.phase !== 'vote' || !g.cur) return;
      var targetId = action.id;
      var target = host.player(targetId);
      if (!target) return;

      // 记录投票（允许改票覆盖）
      g.cur.votes[from] = targetId;

      // 检查是否所有在线玩家都投了
      var online = host.onlinePlayers();
      var voted = 0;
      for (var i = 0; i < online.length; i++) {
        if (g.cur.votes[online[i].id] !== undefined) voted++;
      }
      if (voted >= online.length && online.length > 0) {
        // 全员投票，提前结算
        settleRound(host);
      } else {
        host.emitSoon(50);
      }
      return;
    }

    // 房主：再来一局
    if (action.t === 'again') {
      if (!host.isHost()) return;
      host.state.phase = 'round';
      g.round = 0;
      g.used = [];
      g.cur = null;
      g.last = null;
      g.done = false;
      g.winner = null;
      host.emit();
      nextRound(host);
      return;
    }

    // 房主：回大厅
    if (action.t === 'lobby') {
      if (!host.isHost()) return;
      host.goLobby();
      return;
    }
  };

  M.resume = function (host) {
    var g = host.g();
    if (!g.settings) {
      g.settings = getSettings(host);
    }

    // 根据当前 phase 重建计时器
    if (host.state.phase === 'vote' && g.cur && g.cur.deadline) {
      var remaining = g.cur.deadline - host.now();
      if (remaining > 0) {
        host.after('vote', remaining, function () {
          settleRound(host);
        });
      } else {
        settleRound(host);
      }
    } else if (host.state.phase === 'reveal') {
      host.after('next', 3000, function () {
        nextRound(host);
      });
    } else if (host.state.phase === 'over') {
      // 游戏结束，无需计时器
    }
  };

  M.onLeave = function (host, id) {
    var g = host.g();
    if (!g.cur) return;

    // 移除离开玩家的投票
    if (g.cur.votes && g.cur.votes[id] !== undefined) {
      delete g.cur.votes[id];
    }

    // 检查剩余在线玩家是否已全部投票
    if (host.state.phase === 'vote') {
      var online = host.onlinePlayers();
      var voted = 0;
      for (var i = 0; i < online.length; i++) {
        if (g.cur.votes[online[i].id] !== undefined) voted++;
      }
      if (voted >= online.length && online.length > 0) {
        settleRound(host);
      }
    }
  };

  PN.games['mostlikely'] = M;
})(typeof globalThis !== 'undefined' ? globalThis : this);
