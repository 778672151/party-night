/* ===== 跳一跳（双人回合制）=====
 *
 * 手感与规则移植自 deepdemos.top 作品《3D 极简跳一跳》（slug 3d-b830652d，见 README 来源与致谢），
 * 核心公式与原作一致：
 *   蓄力 power = clamp(按住时长 / 1.15s, 0, 1)
 *   跳跃距离 d = 0.26 + (3.62 - 0.26) * power
 *   完美落点半径 = clamp(方块宽 * 0.30, 0.12, 0.22)
 *   完美 → 连击 +1，得分 2×min(连击,5)（2/4/6/8/10 封顶）；普通落点 +1 并断连击
 *   力度太小落回原方块：不得分、断连击，但不算失败（原作行为，保留）
 *
 * 双人改编（原作是单机无限跑）：
 *   - 同一颗种子生成同一段跑道，两人先后各跳一次，比总分（公平，且看得见对方的成绩）
 *   - 原作的"掉下去就结束"改成每人 3 条命，掉一次扣一条，扣完换人
 *   - 默认 3 轮；每轮换种子；总分高者胜
 *   - 判定全部由房主用**自己的计时**算（客户端上报的蓄力只用于给对手展示，不可作弊） */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  var ID = 'hop';
  var NAME = '跳一跳';
  var EMOJI = '🐰';
  var MAX_HOLD = 1150;        // 蓄满力所需毫秒（原作 1.15 秒）
  var MIN_DIST = 0.26;
  var MAX_DIST = 3.62;
  var PLATS = 60;             // 一条跑道生成多少块

  /* 确定性随机：同一颗种子在房主和每个客户端生成**完全相同**的跑道，
     这样 state 里只要带种子和进度，几 KB 的状态广播就省下来了。 */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* 跑道几何必须满足三件事（否则跳跃判定会出现"怎么跳都不会掉"或方块互相压住）：
     ① 相邻方块之间留有可见缝隙：gap > 两者半宽之和
     ② 下一块一定跳得到：gap + 下一块半宽 <= MAX_DIST
     ③ 一定存在"跳过头"的失败可能：gap + 半宽 < MAX_DIST（留 0.25 余量） */
  function makeTrack(seed) {
    var r = rng(seed), out = [{ x: 0, w: 0.95 }], x = 0;
    for (var i = 1; i < PLATS; i++) {
      var w = 0.55 + r() * 0.4;                                   // 0.55 ~ 0.95
      var prev = out[i - 1];
      var minGap = prev.w / 2 + w / 2 + 0.4;                      // 保证看得见的缝隙
      var maxGap = MAX_DIST - w / 2 - 0.25;                       // 保证跳得到、也跳得过头
      var span = Math.max(0.15, maxGap - minGap);
      var gap = minGap + r() * span;
      x += gap;
      out.push({ x: x, w: w });
    }
    return out;
  }
  function perfectR(w) { return Math.max(0.12, Math.min(0.22, w * 0.30)); }
  function powerOf(hold) { return Math.max(0, Math.min(1, hold / MAX_HOLD)); }
  function distOf(power) { return MIN_DIST + (MAX_DIST - MIN_DIST) * power; }

  /** 一次跳跃的判定：返回 {kind:'perfect'|'ok'|'weak'|'fall', gain, combo} */
  function resolve(plat, idx, power) {
    var d = distOf(power);
    var cur = plat[idx];
    if (idx + 1 >= plat.length) return { kind: 'ok', gain: 1, combo: 0 };   // 跑到尽头（不常见）
    var next = plat[idx + 1];
    var gap = next.x - cur.x;                 // 到中心的距离
    var off = Math.abs(d - gap);              // 离目标中心多远
    if (off <= next.w / 2) {
      if (off <= perfectR(next.w)) return { kind: 'perfect', gain: 0, combo: 1 };  // gain 由连击算
      return { kind: 'ok', gain: 1, combo: 0 };
    }
    if (d <= cur.w / 2) return { kind: 'weak', gain: 0, combo: 0 };   // 落回原地：不算失败
    return { kind: 'fall', gain: 0, combo: 0 };
  }

  function participants(host) {
    var g = host.g();
    return ((g && g.players) || []).filter(function (id) { return !!host.player(id); });
  }
  function onlineOthers(host, me) {
    return host.onlinePlayers().filter(function (p) { return p.id !== me; });
  }
  function nameOf(host, pid) { var p = host.player(pid); return p ? p.name : '?'; }
  function settleRound(host) {
    var g = host.g();
    var a = g.players[0], b = g.players[1];
    var sa = g.totals[a] || 0, sb = g.totals[b] || 0;
    g.attempt = null;
    if (g.round >= g.rounds) {
      g.phase = 'over';
      if (sa > sb) g.winner = a; else if (sb > sa) g.winner = b; else g.winner = null;
      if (g.winner) host.addScore(g.winner, 2); else participants(host).forEach(function (id) { host.addScore(id, 1); });
      host.toast(g.winner ? '🎉 ' + nameOf(host, g.winner) + ' 总分更高，赢了！' : '总分打平，握个手～', g.winner ? 'good' : 'info');
      host.event({
        t: 'gameover',
        players: participants(host).map(function (id) {
          var p = host.player(id);
          return { id: id, name: p ? p.name : '?', score: p ? p.score : 0, total: g.totals[id] || 0 };
        })
      });
    } else {
      g.round++;
      g.turnIdx = 0;
      g.seed = (g.seed * 1103515245 + 12345) & 0x7fffffff;
      startAttempt(host);       // 必须开新回合，否则第 2 轮 attempt 是 null，两边都按不动
      host.toast('第 ' + g.round + ' 轮开始 · ' + nameOf(host, g.players[0]) + ' 先跳', 'good');
    }
    host.emit();
  }
  function startAttempt(host) {
    var g = host.g();
    var pid = g.players[g.turnIdx];
    g.attempt = {
      pid: pid, lives: g.lives, score: 0, combo: 0, idx: 0,
      charging: false, chargeAt: 0, power: 0,
      fly: null, last: null, ended: false
    };
    g.power = 0;
    host.toast('🐰 ' + nameOf(host, pid) + ' 的回合：按住蓄力，松手起跳', 'info');
  }
  function endAttempt(host) {
    var g = host.g();
    var at = g.attempt;
    at.ended = true;
    g.totals[at.pid] = (g.totals[at.pid] || 0) + at.score;
    host.emitSoon(10);
    var otherIdx = 1 - g.turnIdx;
    host.after('hopNext', 1400, function () {
      var gg = host.g();
      if (!gg || gg.phase !== 'play' || !gg.attempt || !gg.attempt.ended) return;
      // 记下这一轮的分数，换另一位玩家用同一颗种子
      gg.attempts = gg.attempts || {};
      gg.attempts[at.pid] = { round: gg.round, score: at.score };
      if (g.attempts[gg.players[0]] && g.attempts[gg.players[1]]) {
        gg.attempts = {};
        settleRound(host);
      } else {
        gg.turnIdx = otherIdx;
        startAttempt(host);
        host.emit();
      }
    });
  }

  var game = {
    id: ID,
    name: NAME,
    emoji: EMOJI,
    blurb: '按住蓄力、松手起跳，两个人轮流比总分 🐰',
    minPlayers: 2,
    maxPlayers: 2,
    meta: { group: 'online', tags: ['休闲', '手感'], origin: { site: 'deepdemos.top', slug: '3d-b830652d' } },

    init: function (host) {
      var s = host.state;
      var settings = s.settings.hop || (s.settings.hop = {});
      s.phase = 'round';
      var ps = host.onlinePlayers().slice(0, 2);
      if (ps.length < 2) { host.toast('跳一跳要两个人一起玩哦', 'info'); host.goLobby(); return; }
      var rounds = Number(settings.rounds) || 3;
      if ([1, 2, 3, 5].indexOf(rounds) < 0) rounds = 3;
      var lives = Number(settings.lives) || 3;
      if ([1, 2, 3, 5].indexOf(lives) < 0) lives = 3;

      s.g = {
        seed: (Math.random() * 0x7fffffff) | 0,
        round: 1, rounds: rounds, lives: lives,
        turnIdx: 0,
        players: ps.map(function (p) { return p.id; }),
        totals: {}, attempts: {},
        attempt: null, power: 0, phase: 'play', winner: null
      };
      startAttempt(host);
      host.emit();
      return true;
    },

    action: function (host, action, from) {
      var g = host.g();
      if (!g) return;
      if (action.t === 'lobby') { if (host.amHost(from)) host.goLobby(); return; }
      if (action.t === 'again') { if (host.amHost(from)) this.init(host); return; }
      if (g.phase !== 'play' || !g.attempt) return;
      var at = g.attempt;
      if (participants(host).indexOf(from) < 0) return;

      if (action.t === 'charge') {
        if (from !== at.pid || at.ended) return;                // 不是你的回合/本回合已结束
        at.fly = null;     // fly 只用于两端的落地动画；新一次蓄力直接开始，免得"跳一次之后按不动"
        at.charging = true;
        at.chargeAt = host.now();                               // 房主自己计时（判定用，防作弊）
        at.power = 0;
        host.emit();
        return;
      }
      // 蓄力进度：只有本人上报，且仅用于让对手看见进度条（判定不看它）
      if (action.t === 'power') {
        if (from !== at.pid || !at.charging || at.fly) return;
        var p0 = Number(action.p);
        if (isNaN(p0)) return;
        g.power = at.power = Math.max(0, Math.min(1, p0));
        host.emitSoon(40);
        return;
      }
      if (action.t === 'release') {
        if (from !== at.pid || at.ended) return;
        var hold = at.charging ? (host.now() - at.chargeAt) : Number(action.hold) || 0;
        var power = powerOf(hold);
        at.charging = false;
        var res = resolve(makeTrack(g.seed), at.idx, power);
        at.last = res.kind;
        if (res.kind === 'perfect') {
          at.combo++;
          res.gain = 2 * Math.min(at.combo, 5);                 // 原作公式：2/4/6/8/10 封顶
        } else if (res.kind === 'ok') {
          at.combo = 0;
        } else if (res.kind === 'weak') {
          at.combo = 0;
        }
        at.fly = { at: host.now(), from: at.idx, to: at.idx, kind: res.kind, gain: res.gain || 0, power: power };
        if (res.kind === 'perfect' || res.kind === 'ok') {
          at.idx++;
          at.fly.to = at.idx;
          at.score += res.gain;
          host.emit();
        } else if (res.kind === 'weak') {
          host.emit();                                          // 落回原地：不得分、不断命
        } else {
          at.lives--;                                           // 掉下去：扣一条命
          host.emit();
          if (at.lives <= 0) {
            host.toast('💫 ' + nameOf(host, at.pid) + ' 掉下去啦，换人', 'info');
            endAttempt(host);
          }
        }
        return;
      }
      if (action.t === 'giveup') {                              // 自己认输这一回合，别让对手干等
        if (from !== at.pid || at.ended) return;
        host.toast('🙈 ' + nameOf(host, at.pid) + ' 提前收工', 'info');
        endAttempt(host);
        return;
      }
    },

    /** 换主：把"正在蓄力/正在飞"清掉，免得新主接手后卡在半空 */
    resume: function (host) {
      var g = host.g();
      if (!g) return;
      if (g.attempt && g.phase === 'play') {
        if (g.attempt.fly) g.attempt.fly = null;
        if (g.attempt.charging) { g.attempt.charging = false; g.attempt.power = 0; g.power = 0; }
        host.toast('换房主了，蓄力状态已重置，继续跳～', 'info');
      }
      host.emit();
    },

    onLeave: function (host, id) {
      var g = host.g();
      if (!g || g.phase === 'over') return;
      if ((g.players || []).indexOf(id) < 0) return;
      // 还在线的参战者不足两人 → 收尾（以前这里判的是"除他之外还有人"，永远不成立）
      var stillOnline = (g.players || []).filter(function (pid) {
        var p = host.player(pid);
        return p && p.online;
      });
      if (stillOnline.length < 2) {
        host.toast('对方离开了，这局先到这儿～', 'info');
        g.phase = 'over';
        g.winner = null;
        participants(host).forEach(function (pid) { host.addScore(pid, 1); });
        host.event({ t: 'gameover', players: participants(host).map(function (pid) { var p = host.player(pid); return { id: pid, name: p ? p.name : '?', score: p ? p.score : 0 }; }) });
        host.emit();
      }
    },

    /** 给测试与界面用：纯函数（不改状态） */
    _rules: {
      makeTrack: makeTrack, rng: rng, powerOf: powerOf, distOf: distOf, resolve: resolve,
      perfectR: perfectR, MAX_HOLD: MAX_HOLD, MIN_DIST: MIN_DIST, MAX_DIST: MAX_DIST, PLATS: PLATS
    }
  };

  PN.games[ID] = game;
})(typeof globalThis !== 'undefined' ? globalThis : this);
