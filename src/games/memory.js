/* ===== 合作翻牌：两个人轮流翻牌，一起把这副牌配完 =====
 *
 * 合作而不是对抗：配对成功两个人都加分，通关按「用了多少步」给星星。
 * 关键设计：牌堆（哪张是什么）只存在房主闭包里，广播状态里只放「已经翻开/已配对的牌」，
 * 所以任何人都不可能从状态里把没翻的牌读出来。 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  var ID = 'memory';
  var NAME = '合作翻牌';
  var EMOJI = '🍀';
  var PAIRS = 8;          // 8 对 = 16 张 = 4×4
  var BACK_MS = 1200;     // 翻错时亮多久再扣回去
  var AFK_MS = 45000;     // 挂机保护：太久不动，帮你翻一张（但不跳过你的回合）

  // ----- 闭包：绝不进入 state -----
  var _pv = { deck: [], seen: {} };

  function pool() {
    var sets = (PN.BANKS.memory && PN.BANKS.memory.sets) || {};
    var keys = Object.keys(sets);
    if (!keys.length) return [];
    return sets[keys[Math.floor(Math.random() * keys.length)]] || [];
  }

  function participants(host) { return (host.g().players || []).filter(function (id) { return !!host.player(id); }); }
  function onlineParticipants(host) {
    return participants(host).filter(function (id) { var p = host.player(id); return p && p.online; });
  }
  function faceDown(host) {
    var g = host.g(), out = [];
    for (var i = 0; i < g.slots.length; i++) if (g.slots[i] === null || g.slots[i] === undefined) out.push(i);
    return out;
  }

  /** 轮到谁：默认两人交替；配对成功的人继续（奖励感） */
  function other(host, id) {
    var ps = participants(host);
    return ps.filter(function (x) { return x !== id; })[0] || ps[0];
  }

  /** 通关星级：这是个治愈向的合作游戏，门槛给得宽松些，别让人有挫败感 */
  function stars(turns, total) {
    var best = total;                 // 完美情况：每对一步
    if (turns <= best + 3) return 3;
    if (turns <= best + 7) return 2;
    return 1;
  }

  function finish(host) {
    var g = host.g();
    host.clearTimer('memory_afk');
    host.clearTimer('memory_back');
    g.phase = 'over';
    g.flipped = [];
    g.over = { turns: g.turns, pairs: g.total, stars: stars(g.turns, g.total), bestCombo: g.bestCombo || 0 };
    host.toast('全部配对完成！用了 ' + g.turns + ' 步 🍀', 'good');
    host.event({ t: 'gameover', players: participants(host).map(function (id) {
      var p = host.player(id);
      return { id: id, name: p ? p.name : '?', score: p ? p.score : 0 };
    }) });
    host.emit();
  }

  /** 扣回翻错的两张并换人 */
  function backAndPass(host) {
    var g = host.g();
    // 注意：翻牌的状态里没有 cur（那是默契游戏的字段）——写错这个守卫会让翻错的牌永远扣不回去、回合也不换，直接死锁
    if (!g || g.phase !== 'play') return;
    var mine = g.flipped.slice();
    for (var i = 0; i < mine.length; i++) g.slots[mine[i]] = null;
    g.flipped = [];
    g.turn = other(host, g.turn);
    armAfk(host);
    host.emit();
  }

  /** 挂机保护：太久没动，替ta翻一张（不换人） */
  function armAfk(host) {
    host.clearTimer('memory_afk');
    host.after('memory_afk', AFK_MS, function () {
      var g = host.g();
      if (!g || g.phase !== 'play' || g.flipped.length >= 2) return;
      var left = faceDown(host);
      if (!left.length) return;
      var i = left[Math.floor(Math.random() * left.length)];
      host.toast('等太久啦，帮你翻一张 👀', 'info');
      flip(host, g.turn, i);
    });
  }

  function flip(host, from, i) {
    var g = host.g();
    if (!g || g.phase !== 'play') return;
    if (g.flipped.indexOf(i) >= 0) return;
    if (g.slots[i] !== null && g.slots[i] !== undefined) return;
    if (g.flipped.length >= 2) return;
    g.slots[i] = _pv.deck[i];
    g.flipped.push(i);
    host.emit();

    if (g.flipped.length < 2) { armAfk(host); return; }

    // 两张都翻开了 → 结算这一步
    host.clearTimer('memory_afk');
    g.turns = (g.turns || 0) + 1;
    var a = g.flipped[0], b = g.flipped[1];
    if (_pv.deck[a] === _pv.deck[b]) {
      g.done = (g.done || []).concat([a, b]);        // 已配对（公开信息，界面据此给"完成"质感）
      g.matched = (g.matched || 0) + 1;
      g.combo = (g.combo || 0) + 1;
      g.bestCombo = Math.max(g.bestCombo || 0, g.combo);
      g.flipped = [];
      participants(host).forEach(function (id) { host.addScore(id, 2); });   // 两人同时加分
      host.toast('配上了！🎉' + (g.combo >= 2 ? ' 连击 x' + g.combo : ''), 'good');
      host.event({ t: 'memory_match' });
      host.emit();
      if (g.matched >= g.total) { finish(host); return; }
      armAfk(host);                     // 配对成功继续翻，但也要重新计时
      return;
    }
    g.combo = 0;
    host.event({ t: 'memory_miss' });
    host.emit();
    host.clearTimer('memory_back');
    host.after('memory_back', BACK_MS, function () { backAndPass(host); });
  }

  var game = {
    id: ID,
    name: NAME,
    emoji: EMOJI,
    blurb: '两个人轮流翻牌，一起把这副牌配完 🍀',
    minPlayers: 2,
    maxPlayers: 2,

    init: function (host) {
      var s = host.state;
      var settings = s.settings.memory || (s.settings.memory = { pairs: 8 });
      s.phase = 'round';

      var ps = host.onlinePlayers().slice(0, 2);
      if (ps.length < 2) { host.toast('合作翻牌要两个人才能玩哦', 'info'); host.goLobby(); return; }

      var total = Math.max(4, Math.min(8, Number(settings.pairs) || PAIRS));
      dealN(total);
      s.g = {
        total: total,
        slots: new Array(total * 2).fill(null),
        done: [],
        flipped: [],
        matched: 0,
        combo: 0,
        bestCombo: 0,
        turns: 0,
        turn: ps[0].id,
        players: ps.map(function (p) { return p.id; }),
        phase: 'play',
        over: null
      };
      host.toast('🍀 ' + total + ' 对牌，两个人一起翻完它', 'good');
      host.emit();
      armAfk(host);
    },

    action: function (host, action, from) {
      var g = host.g();
      if (!g) return;
      if (action.t === 'lobby') { if (host.amHost(from)) host.goLobby(); return; }
      if (action.t === 'again') { if (host.amHost(from)) this.init(host); return; }
      if (action.t === 'flip') {
        if (g.phase !== 'play') return;
        if (participants(host).indexOf(from) < 0) return;   // 旁观者不能翻
        if (g.turn !== from) return;                        // 不是你的回合
        var i = Number(action.i);
        if (isNaN(i) || i < 0 || i >= g.slots.length) return;
        flip(host, from, i);
        return;
      }
    },

    /** 换主：牌堆在闭包里，换主就没了 → 重新洗一副（并说清楚），分数保留 */
    resume: function (host) {
      var g = host.g();
      if (!g) return;
      if (g.phase === 'play') {
        dealN(g.total || PAIRS);
        g.slots = new Array((g.total || PAIRS) * 2).fill(null);
        g.done = [];
        g.flipped = [];
        g.matched = 0;
        g.combo = 0;
        host.toast('换房主了，这副牌重新洗一次～', 'info');
        armAfk(host);
      }
      host.emit();
    },

    onLeave: function (host, id) {
      var g = host.g();
      if (!g || g.phase !== 'play') return;
      if ((g.players || []).indexOf(id) < 0) return;
      if (onlineParticipants(host).length < 2) {
        host.toast('对方离开了，这一局先到这儿～', 'info');
        finish(host);
      }
    }
  };

  /** 洗一副 n 对的牌（4/6/8 对可配），牌面池按主题随机挑一套 */
  function dealN(n) {
    var src = pool().slice();
    while (src.length < n) src = src.concat(src);
    for (var i = src.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = src[i]; src[i] = src[j]; src[j] = t;
    }
    var picked = src.slice(0, n);
    var deck = picked.concat(picked);
    for (var k = deck.length - 1; k > 0; k--) {
      var q = Math.floor(Math.random() * (k + 1));
      var t2 = deck[k]; deck[k] = deck[q]; deck[q] = t2;
    }
    _pv.deck = deck;
  }

  PN.games[ID] = game;
})(typeof globalThis !== 'undefined' ? globalThis : this);
