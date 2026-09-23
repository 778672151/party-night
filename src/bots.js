/* ===== 机器人对手（房主侧的虚拟玩家）=====
 *
 * 目的：让一个人也能开局（7 款原本 minPlayers:2 的游戏），而不是被一句「人数不够」挡住。
 *
 * 为什么做成「房主侧虚拟玩家」而不是「单机版」：
 *   房主是权威，所有游戏都用 participants()/onlinePlayers() 决定谁在局里。
 *   只要机器人是 state.players 里一个普通玩家 id，11 款游戏**一行都不用改**就能容纳它 ——
 *   轮次判定、计分、终局名单、悔棋同意……全都照原样工作。
 *
 * 两个必须处理的危险点（否则机器人会被自己的房间踢出去）：
 *   ① syncOnline() 按 room.roster() 判断在线，而机器人**不在花名册里**
 *      → 会被判离线 → markOffline 排 25s 收尾 → onLeave 把机器人踢出对局。
 *   ② goLobby() 用 !!room.peers[id] 复原在线状态，机器人同样会被判离线。
 *   所以这三处都要显式跳过 p.bot（见 host.js 的 p.bot 判断）。
 *
 * 机器人怎么动：游戏自己实现 game.botTurn(host) → { pid, action } | null（纯函数，无副作用，
 * 所以能在 node 里直接单元测试）。本模块只负责「排一个拟人延迟，然后以它的身份 dispatch」。
 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  var BOT_MIN_MS = 700, BOT_MAX_MS = 1600;   // 拟人思考延迟：太快不像人，太慢像卡了
  var NAMES = ['小机灵', '阿飞', '点点', '老白', '皮蛋'];
  var EMOJIS = ['🤖', '👾', '🛸', '🐧', '🦊'];
  var TICK = '__bot';                        // 定时器名字（登记进 host.timers，会被 clearAll 清掉）

  function isBotId(id) { return typeof id === 'string' && id.indexOf('bot:') === 0; }

  /** 机器人玩家在 state.players 里的形状 —— 多一个 bot:true 供各处免疫判断。
   *  分数/连胜字段和真人完全一样，这样计分板、终局名单不用特殊照顾。 */
  function makePlayer(n) {
    return {
      id: 'bot:' + n,
      name: NAMES[(n - 1) % NAMES.length],
      emoji: EMOJIS[(n - 1) % EMOJIS.length],
      score: 0, streak: 0, wins: 0, online: true, host: false, bot: true
    };
  }

  function botsIn(host) {
    return (host.state.players || []).filter(function (p) { return p.bot; });
  }
  function humansIn(host) {
    return (host.state.players || []).filter(function (p) { return !p.bot && p.online; });
  }

  /** 把机器人补到游戏的最低人数。只补「差多少」，不多塞一个。
   *  返回是否真的改动过 state（调用方据此决定要不要广播）。 */
  function fill(host, game) {
    if (!game || !game.botTurn) return false;          // 该游戏还没写大脑：不硬塞，维持原提示
    var need = (game.minPlayers || 2) - humansIn(host).length;
    if (need <= 0) return false;
    // ⚠️ 判据必须是**具体的 id 有没有**，不能是「已有几个机器人」。
    // 用数量推算会漏：只要机器人的增删不是严格按 1,2,3 顺序发生（真人掉线又回来、
    // 换房主 adopt、中途有人进出），数量就会和 id 对不上，于是重复加出 bot:2、bot:3…
    // （实测：连开 4 局，机器人从 1 个涨到 2 个、名单 3 人。）
    // 按 id 幂等就没有这个问题：要几个就保证 bot:1..bot:need 都在，一个不多一个不少。
    var changed = false;
    for (var n = 1; n <= need; n++) {
      var exists = false;
      for (var i = 0; i < host.state.players.length; i++) {
        if (host.state.players[i].id === 'bot:' + n) { exists = true; break; }
      }
      if (!exists) { host.state.players.push(makePlayer(n)); changed = true; }
    }
    return changed;
  }

  /** 把机器人全部撤掉（大厅专用）。两处会用到，语义都是同一件事：
   *   ① 有真人进大厅 → 让出座位（2 人局里，否则两个真人反而开不了局）；
   *   ② 回大厅 → 收走陪练（机器人是「这一局」的，不是大厅常驻成员）。
   *  对局中途**不能**撤，那会直接把牌局搞坏 —— 所以这里用 mode 守卫。 */
  function dropAll(host) {
    if (!host.state || host.state.mode !== 'lobby') return false;
    var before = host.state.players.length;
    host.state.players = host.state.players.filter(function (p) { return !p.bot; });
    return host.state.players.length !== before;
  }

  /** 每次 state 变化后调用：轮到机器人就把它的动作排进定时器。
   *  用 timers[TICK] 是否存在来判断「已经排过一个还没跑」，这样 clearAll 一旦清掉定时器，
   *  状态自动归零，不会出现「标志位还立着、机器人永远不动了」的死锁。 */
  function onState(host) {
    if (!host || !host.state) return;
    var mode = host.state.mode;
    if (!mode || mode === 'lobby') return;
    var game = PN.games[mode];
    if (!game || typeof game.botTurn !== 'function') return;
    if (host.timers[TICK]) return;                     // 已经排了，别重复排
    var t;
    try { t = game.botTurn(host); } catch (e) { return; }
    if (!t || !t.pid || !t.action) return;
    var delay = BOT_MIN_MS + Math.floor(Math.random() * (BOT_MAX_MS - BOT_MIN_MS));
    // 用 host.after 登记：换局/回大厅时 clearAll 会清掉，绝不会跨局打一枪
    host.after(TICK, delay, function () {
      if (host.state.mode !== mode) return;            // 期间换游戏了：这一手作废
      var t2;
      try { t2 = game.botTurn(host); } catch (e) { return; }
      if (!t2 || !t2.pid || !t2.action) { onState(host); return; }
      host.dispatch(t2.action, t2.pid);
    });
  }

  PN.bots = {
    isBotId: isBotId,
    botsIn: botsIn,
    humansIn: humansIn,
    fill: fill,
    dropAll: dropAll,
    onState: onState,
    BOT_MIN_MS: BOT_MIN_MS,
    BOT_MAX_MS: BOT_MAX_MS
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
