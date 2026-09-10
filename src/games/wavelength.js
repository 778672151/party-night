/* ===== 心有灵犀·波长 🌊 =====
 * 通灵者看到靶心（8-92），给出线索，其他人猜位置
 * 越近分越高，波段大师额外奖金
 * 秘密：target 只通过 host.sendSecret 下发，不进 state.g
 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  /* ---- fallback 光谱词库 ---- */
  var FALLBACK = [
    { left: '简单', right: '复杂', tag: '默认' },
    { left: '冷', right: '热', tag: '默认' },
    { left: '轻', right: '重', tag: '默认' },
    { left: '快', right: '慢', tag: '默认' },
    { left: '软', right: '硬', tag: '默认' },
    { left: '安静', right: '热闹', tag: '默认' },
    { left: '保守', right: '冒险', tag: '默认' },
    { left: '早睡', right: '熬夜', tag: '默认' },
    { left: '清淡', right: '重口', tag: '默认' },
    { left: '便宜', right: '昂贵', tag: '默认' },
    { left: '实用', right: '颜值', tag: '默认' },
    { left: '节约', right: '浪费', tag: '默认' },
    { left: '规律', right: '随性', tag: '默认' },
    { left: '独处', right: '群居', tag: '默认' },
    { left: '干', right: '湿', tag: '默认' },
    { left: '浓', right: '淡', tag: '默认' },
    { left: '简', right: '繁', tag: '默认' },
    { left: '脏', right: '干净', tag: '默认' },
    { left: '难', right: '易', tag: '默认' },
    { left: '甜', right: '咸', tag: '默认' },
    { left: '快', right: '慢', tag: '默认' },
    { left: '热', right: '冰', tag: '默认' },
    { left: '脆', right: '软', tag: '默认' },
    { left: '深', right: '浅', tag: '默认' },
    { left: '宽', right: '窄', tag: '默认' },
    { left: '高', right: '低', tag: '默认' },
    { left: '大', right: '小', tag: '默认' },
    { left: '甜', right: '辣', tag: '默认' },
    { left: '酸', right: '甜', tag: '默认' },
    { left: '苦', right: '甜', tag: '默认' }
  ];

  var ID = 'wavelength';
  var NAME = '心有灵犀·波长';
  var EMOJI = '\uD83C\uDF0A';
  var MIN = 3;
  var MAX = 12;
  var CLUE_MS = 60000;
  var GUESS_MS = 45000;
  var REVEAL_MS = 4000;

  function rnd(n) { return Math.floor(Math.random() * n); }

  function pickSpectrum(used) {
    var pool = null;
    try {
      var raw = PN.pick.spectrum(used);
      if (raw && raw.left && raw.right) pool = raw;
    } catch (e) {}
    if (!pool) {
      var fpool = FALLBACK.slice();
      if (used && used.length) {
        var seen = {};
        for (var i = 0; i < used.length; i++) seen[used[i]] = true;
        fpool = fpool.filter(function (s) { return !seen[s.left + '|' + s.right]; });
      }
      if (!fpool.length) fpool = FALLBACK;
      pool = fpool[rnd(fpool.length)];
    }
    var key = pool.left + '|' + pool.right;
    if (!used) used = [];
    used.push(key);
    return pool;
  }

  function fallbackClue() {
    var clues = ['靠近中间', '偏左一点', '偏右一点', '差不多这儿', '再往右点', '靠左不少', '你品品', '懂的都懂'];
    return clues[rnd(clues.length)];
  }

  function guessers(host) {
    var g = host.g();
    var online = host.onlinePlayers();
    var list = [];
    for (var i = 0; i < online.length; i++) {
      if (online[i].id !== g.cur) list.push(online[i].id);
    }
    return list;
  }

  function allGuessed(host) {
    var g = host.g();
    var list = guessers(host);
    for (var i = 0; i < list.length; i++) {
      if (g.guesses[list[i]] === undefined) return false;
    }
    return true;
  }

  function init(host) {
    var s = host.state;
    s.phase = 'round';
    var g = s.g = {};
    var settings = s.settings.wavelength || {};
    g.rounds = settings.rounds || 6;
    g.round = 0;
    g.used = [];

    var online = host.onlinePlayers();
    online.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    g.order = online.map(function (p) { return p.id; });

    host.toast('🌊 心有灵犀·波长 开始！共 ' + g.rounds + ' 局', 'good');
    host.event({ t: 'toast', text: '🔮 通灵者就位，第一回合开始！' });
    nextRound(host);
  }

  function nextRound(host) {
    var g = host.g();
    g.round++;
    if (g.round > g.rounds) { gameOver(host); return; }

    var sp = pickSpectrum(g.used);
    g.left = sp.left;
    g.right = sp.right;

    g.cur = g.order[(g.round - 1) % g.order.length];

    var target = 8 + rnd(85);

    host.sendSecret(g.cur, {
      target: target,
      left: g.left,
      right: g.right,
      round: g.round
    });

    g.curPhase = 'clue';
    g.clue = null;
    g.guesses = {};
    g.done = false;
    g.reveal = null;
    g.deadline = host.now() + CLUE_MS;

    host.toast('🎯 第 ' + g.round + '/' + g.rounds + ' 回合 — 通灵者请给出线索', 'info');
    host.event({ t: 'newRound', round: g.round, left: g.left, right: g.right, psychic: g.cur });

    host.after('clue', CLUE_MS, function () {
      var g2 = host.g();
      if (g2.curPhase !== 'clue') return;
      g2.clue = fallbackClue();
      host.toast('⏰ 通灵者超时，系统自动补了个线索', 'bad');
      host.event({ t: 'autoClue', text: g2.clue, psychic: g2.cur });
      enterGuess(host);
    });
    host.emit();
  }

  function enterGuess(host) {
    var g = host.g();
    g.curPhase = 'guess';
    g.guesses = {};
    g.deadline = host.now() + GUESS_MS;

    host.toast('🔮 通灵者说：「' + g.clue + '」大家快猜位置！', 'info');
    host.event({ t: 'enterGuess', clue: g.clue });

    host.after('guess', GUESS_MS, function () {
      var g2 = host.g();
      if (g2.curPhase !== 'guess') return;
      enterReveal(host);
    });
    host.emit();
  }

  function enterReveal(host) {
    var g = host.g();
    g.curPhase = 'reveal';

    var psychicId = g.cur;
    var secret = host.secretCache ? host.secretCache[psychicId] : null;
    var target = (secret && typeof secret.target === 'number') ? secret.target : 50;

    var guessList = [];
    var totalDist = 0;
    var guessCount = 0;
    var bestDist = Infinity;
    var bestId = null;

    for (var pid in g.guesses) {
      if (!g.guesses.hasOwnProperty(pid)) continue;
      var v = g.guesses[pid];
      var dist = Math.abs(v - target);
      guessList.push({ id: pid, v: v, distance: dist });
      totalDist += dist;
      guessCount++;
      if (dist < bestDist) { bestDist = dist; bestId = pid; }
    }

    for (var i = 0; i < guessList.length; i++) {
      var gl = guessList[i];
      var score = gl.distance <= 8
        ? 1000
        : Math.min(500, Math.round(1000 / (10 + gl.distance)));
      host.addScore(gl.id, score);
    }

    if (bestId && guessList.length > 0) {
      host.addScore(bestId, 300);
      var bestName = host.player(bestId);
      host.toast('🏆 ' + (bestName ? bestName.name : '某人') + ' 波段大师 +300', 'good');
    }

    if (guessCount > 0) {
      var avgDist = totalDist / guessCount;
      var psychicScore = Math.max(0, Math.round((100 - avgDist) * 10));
      host.addScore(psychicId, psychicScore);
      var psychicName = host.player(psychicId);
      host.toast('🔮 通灵者' + (psychicName ? psychicName.name : '') + ' +' + psychicScore + ' 分', 'info');
    }

    g.reveal = {
      target: target,
      guesses: guessList,
      bestId: bestId
    };
    g.done = true;

    host.event({
      t: 'reveal',
      target: target,
      clue: g.clue,
      left: g.left,
      right: g.right,
      round: g.round,
      guesses: guessList,
      bestId: bestId
    });

    host.revealAll({
      target: target,
      clue: g.clue,
      left: g.left,
      right: g.right,
      guesses: guessList
    });

    host.toast('🎯 目标值 ' + target + ' / 100，' + (g.round < g.rounds ? '下一回合马上开始' : '比赛结束！'), 'info');

    host.after('reveal', REVEAL_MS, function () {
      nextRound(host);
    });
    host.emit();
  }

  function gameOver(host) {
    var s = host.state;
    s.phase = 'over';
    var g = host.g();
    g.curPhase = 'over';

    var players = s.players.slice().sort(function (a, b) {
      return (b.score || 0) - (a.score || 0);
    });
    g.winner = players[0] ? players[0].id : null;

    host.event({
      t: 'gameover',
      players: players.map(function (p) {
        return { id: p.id, name: p.name, score: p.score || 0 };
      })
    });

    host.toast('🏆 比赛结束！' + (players[0] ? players[0].name : '') + ' 获得胜利！', 'good');
    host.emit();
  }

  function action(host, act, from) {
    var s = host.state;
    var g = host.g();
    if (s.phase !== 'round' && s.phase !== 'over') return;

    if (host.amHost(from)) {
      if (act.t === 'again' && s.phase === 'over') {
        init(host);
        host.emit();
        return;
      }
      if (act.t === 'lobby' && s.phase === 'over') {
        host.goLobby();
        return;
      }
      if (act.t === 'skip') {
        if (g.curPhase === 'clue') { host.clearTimer('clue'); enterGuess(host); }
        else if (g.curPhase === 'guess') { host.clearTimer('guess'); enterReveal(host); }
        return;
      }
    }

    if (act.t === 'clue' && g.curPhase === 'clue' && from === g.cur) {
      var text = String(act.text || '').trim();
      if (!text) { host.toast('线索不能为空', 'bad'); return; }
      if (text.length > 50) { text = text.slice(0, 50); }
      g.clue = text;
      host.clearTimer('clue');
      host.toast('🔮 通灵者已给出线索，大家开猜！', 'info');
      enterGuess(host);
      return;
    }

    if (act.t === 'guess' && g.curPhase === 'guess') {
      if (from === g.cur) { host.toast('通灵者不用猜哦', 'info'); return; }
      if (g.guesses[from] !== undefined) { host.toast('你已经猜过了', 'info'); return; }
      var p = host.player(from);
      if (!p || !p.online) return;

      var v = Number(act.v);
      if (isNaN(v) || v < 0 || v > 100) { host.toast('请输入 0-100 之间的整数', 'bad'); return; }
      v = Math.round(v);

      g.guesses[from] = v;

      if (allGuessed(host)) {
        host.clearTimer('guess');
        enterReveal(host);
      } else {
        host.emit();
      }
      return;
    }

    // 通灵者回报靶心：clue/guess 阶段迁过来时要先接住，开奖阶段则直接开奖
    if (act.t === 'reportTarget' && from === g.cur && g.curPhase !== 'over') {
      var rt = Number(act.target);
      if (isNaN(rt) || rt < 0 || rt > 100) return;
      if (host.secretCache && !host.secretCache[g.cur]) {
        host.secretCache[g.cur] = { target: rt };
        if (g.curPhase === 'reveal' && !g.done) { host.clearTimer('revealWait'); enterReveal(host); }
        else host.emit();
      }
      return;
    }
  }

  /** 房主迁移后靶心只掌握在通灵者手里：问他要回来，绝不能重新随机。
   *  重新随机会让已经给出的线索、已经投出的猜测全部对不上号。 */
  function askTarget(host) {
    var g = host.g();
    if (!g.cur) return;
    host.requestSecret(g.cur, { recover: true, round: g.round, left: g.left, right: g.right });
  }

  function resume(host) {
    var g = host.g();
    if (!g || !g.curPhase) return;

    if (g.curPhase === 'clue') {
      askTarget(host);
      var remaining = g.deadline - host.now();
      if (remaining > 5000) {
        host.after('clue', remaining, function () {
          var g2 = host.g();
          if (g2.curPhase !== 'clue') return;
          g2.clue = fallbackClue();
          host.toast('⏰ 通灵者超时，系统自动补了线索', 'bad');
          host.event({ t: 'autoClue', text: g2.clue, psychic: g2.cur });
          enterGuess(host);
        });
      } else {
        g.clue = fallbackClue();
        host.toast('🔄 宿主切换，系统自动补了线索', 'bad');
        enterGuess(host);
      }
      host.emit();

    } else if (g.curPhase === 'guess') {
      askTarget(host);
      var remaining2 = g.deadline - host.now();
      if (remaining2 > 5000) {
        host.after('guess', remaining2, function () {
          var g2 = host.g();
          if (g2.curPhase !== 'guess') return;
          enterReveal(host);
        });
      } else {
        enterReveal(host);
      }
      host.emit();

    } else if (g.curPhase === 'reveal' && !g.done) {
      // 等通灵者把靶心报回来再开奖；5 秒还不报就按兜底值开，别把大家卡死
      askTarget(host);
      host.after('revealWait', 5000, function () {
        var g2 = host.g();
        if (g2 && g2.curPhase === 'reveal' && !g2.done) enterReveal(host);
      });
      host.emit();

    } else if (g.curPhase === 'reveal' && g.done && g.round <= g.rounds) {
      host.after('reveal', REVEAL_MS, function () {
        nextRound(host);
      });

    } else if (g.curPhase === 'over' || g.round > g.rounds) {
      /* 游戏结束，等房主操作 */
    }
  }

  function onLeave(host, id) {
    var g = host.g();
    if (!g || !g.curPhase) return;

    if (id === g.cur) {
      var online = host.onlinePlayers();
      var candidates = online.filter(function (p) { return p.id !== id; });
      if (candidates.length === 0) return;

      var curIdx = g.order.indexOf(id);
      var nextIdx = (curIdx + 1) % g.order.length;
      var tries = 0;
      while (tries < g.order.length) {
        var candidate = g.order[nextIdx];
        var found = false;
        for (var i = 0; i < candidates.length; i++) {
          if (candidates[i].id === candidate) { found = true; break; }
        }
        if (found) break;
        nextIdx = (nextIdx + 1) % g.order.length;
        tries++;
      }
      if (tries < g.order.length) {
        var newCur = g.order[nextIdx];
        g.cur = newCur;
        var secret = host.secretCache ? host.secretCache[id] : null;
        if (secret && typeof secret.target === 'number') {
          host.sendSecret(newCur, {
            target: secret.target,
            left: g.left,
            right: g.right,
            round: g.round
          });
        } else {
          var newTarget = 8 + rnd(85);
          host.sendSecret(newCur, {
            target: newTarget,
            left: g.left,
            right: g.right,
            round: g.round
          });
        }
        host.toast('🔄 通灵者掉线，已换人', 'bad');
        host.emit();
      }
      return;
    }

    if (g.curPhase === 'guess' && allGuessed(host)) {
      host.clearTimer('guess');
      enterReveal(host);
    }
  }

  PN.games[ID] = {
    id: ID,
    name: NAME,
    emoji: EMOJI,
    blurb: '通灵者看到靶心（8-92），给出线索，其他人猜位置——越近分越高！',
    minPlayers: MIN,
    maxPlayers: MAX,
    init: init,
    action: action,
    resume: resume,
    onLeave: onLeave
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);