/* ===== 房主权威状态机：公共 reducer + 计时器 + 私密下发 =====
 * state 结构：
 * {
 *   v: 3, mode: 'lobby'|'drawgame',
 *   phase: 'lobby'|'wait'|'setup'|'round'|'over'|...（游戏自定义）,
 *   players: [{id,name,emoji,score,streak,host,online}],
 *   settings: { maxPlayers, language, ...mode 配置 },
 *   log: [{t, kind, text}],
 *   g: {}   —— 游戏自定义（注意：绝不能包含任何玩家秘密）
 *   hostId, ts
 * }
 * 秘密（词、角色）只通过 host.sendSecret(id, obj) 私密下发，不进 state。
 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  PN.games = {};

  var DROP_GRACE_MS = 25000; // 掉线宽限期：刷新/切后台回来的人还在对局里

  function Host(room, onStateChange) {
    this.room = room;
    this.onStateChange = onStateChange || function () {};
    this.state = null;
    this.timers = {};        // name -> timeoutId
    this.secrets = {};       // pid -> { ...游戏私密数据 }
    this.secretCache = {};   // pid -> 已下发的最简缓存（重发用）
  }

  Host.prototype.stateForUI = function () {
    return this.state ? JSON.parse(JSON.stringify(this.state)) : null;
  };
  Host.prototype.g = function () { return this.state ? this.state.g : {}; };

  Host.prototype.now = function () { return Date.now(); };

  Host.prototype.dispatch = function (action, from) {
    if (!this.state) return;
    // 「回大厅」是全局导航：游戏只在 over 阶段自己处理，进行中直接由大厅层接管
    if (action.t === 'lobby') return this._lobbyAction(action, from);
    var game = this.state.mode && this.state.mode !== 'lobby' ? PN.games[this.state.mode] : null;
    if (game && game.action) {
      var r = game.action(this, action, from);
      if (r !== undefined) this.emit();
    }
    // 游戏进行中也要跑全局入座/离座：否则中途加入的人不进名单（没法计分）、退出的还挂在榜上
    this._lobbyAction(action, from);
  };

  Host.prototype._lobbyAction = function (action, from) {
    var s = this.state;
    if (!from) return;
    if (action.t === '_joined' || action.t === 'hi') {
      var before = this.state.players.length;
      var prevP = this.player(from);
      var wasOffline = !prevP || !prevP.online; // 掉线的人回来了，也要广播一次
      this.upsertPlayer(from);
      // 只有名单或在线状态真的变了才广播：以前每收到一次心跳就 emit 一次，
      // 四个人在大厅里等于每 1 秒把整棵树重建一次 —— 改昵称弹窗、设置面板全被冲掉。
      if (this.syncOnline() || wasOffline || this.state.players.length !== before) this.emit();
      return;
    }
    if (action.t === '_syncOnline') {
      // 对局中刷新在线状态：掉线的人不能一直算在「等人描述 / 等人投票」里
      if (this.syncOnline()) this.emit();
      return;
    }
    if (action.t === '_left') {
      // 掉线只标离线（积分保住，人回来接着玩）；主动退出才真的移出房间
      if (action.dropped) this.markOffline(from);
      else this.removePlayer(from);
      this.emit();
      return;
    }
    if (action.t === 'setName') {
      this.upsertPlayer(from, { name: String(action.name || '').slice(0, 16), emoji: String(action.emoji || '🙂').slice(0, 4) });
      this.emit();
      return;
    }
    if (action.t === 'setProfile' && this.state.phase === 'lobby') {
      this.upsertPlayer(from, { name: String(action.name || '').slice(0, 16), emoji: String(action.emoji || '🙂').slice(0, 4) });
      this.emit();
      return;
    }
    if (!this.amHost(from)) return;
    if (action.t === 'start') {
      var mode = action.mode;
      var game = PN.games[mode];
      if (!game) return;
      var players = this.state.players.filter(function (p) { return p.online; });
      if (players.length < (game.minPlayers || 2)) { this.toast('人数不够：' + game.name + ' 至少 ' + game.minPlayers + ' 人'); return; }
      // 双人游戏的人数上限要拦住，否则第三个人进来看不到自己的位置、规则也不成立
      if (game.maxPlayers && players.length > game.maxPlayers) {
        this.toast('人数超了：' + game.name + ' 最多 ' + game.maxPlayers + ' 人');
        return;
      }
      this.state.mode = mode;
      game.init(this);
      this.emit();
      return;
    }
    if (action.t === 'lobby') { this.goLobby(); return; }
    if (action.t === 'settings') {
      // 设置是分模式存的（settings.drawgame.drawSec 这种）。这里以前直接写成 settings[k]，
      // 而游戏读的全是 settings.<模式>.<键> —— 于是大厅里所有设置项（卧底人数/白板/描述方式/
      // 每轮时长、波长局数、谁最可能题数/时长、画猜回合数/时长）统统不生效。
      var smode = action.mode || (this.state.mode !== 'lobby' ? this.state.mode : null);
      var bag = smode ? this.state.settings[smode] : null;
      if (bag) {
        for (var k in action.values) if (Object.prototype.hasOwnProperty.call(action.values, k)) {
          bag[k] = this.coerce(bag[k], action.values[k]);
        }
      }
      this.emit();
      return;
    }
    if (action.t === 'kick') { this.removePlayer(action.id); this.emit(); return; }
    if (action.t === 'resetScores') {
      this.state.players.forEach(function (p) { p.score = 0; p.streak = 0; });
      this.emit();
      return;
    }
  };

  Host.prototype.coerce = function (cur, val) {
    if (typeof cur === 'number') { var n = Number(val); return isNaN(n) ? cur : n; }
    if (typeof cur === 'boolean') return !!val;
    return val;
  };

  Host.prototype.amHost = function (id) { return id === this.state.hostId; };
  Host.prototype.isHost = function () { return this.room.isHost; };

  Host.prototype.fresh = function (hostPid, hostName, hostEmoji) {
    this.state = {
      v: 3,
      mode: 'lobby',
      phase: 'lobby',
      players: [],
      settings: {
        roomName: '',
        drawgame: { rounds: 6, drawSec: 90, roundsPerSet: 3 }
      },
      log: [],
      g: {},
      hostId: hostPid,
      ts: this.now()
    };
    this.upsertPlayer(hostPid, { name: hostName, emoji: hostEmoji });
    this.emit();
    return this.state;
  };

  Host.prototype.upsertPlayer = function (id, patch) {
    var s = this.state, found = null;
    for (var i = 0; i < s.players.length; i++) if (s.players[i].id === id) { found = s.players[i]; break; }
    if (!found) {
      var p = this.room.peers[id];
      found = { id: id, name: (p && p.name) || '玩家', emoji: (p && p.emoji) || '🙂', score: 0, streak: 0, host: id === s.hostId, online: true, wins: 0 };
      s.players.push(found);
    }
    if (patch) {
      if (patch.name !== undefined) found.name = patch.name;
      if (patch.emoji !== undefined) found.emoji = patch.emoji;
    }
    this.clearTimer('drop_' + id); // 人回来了：取消宽限期后的移出
    found.online = true;
    return found;
  };

  /** 用花名册心跳刷新在线状态。
   *  以前 state.players[].online 一旦为 true 就再也不会变 false，
   *  于是「等人描述/等人投票」会把掉线的人一直算进去，整桌干等一分钟以上。 */
  Host.prototype.syncOnline = function () {
    if (!this.room.roster) return false;
    var list = this.room.roster(), map = {}, i, changed = false;
    for (i = 0; i < list.length; i++) map[list[i].id] = list[i].online;
    this.state.players.forEach(function (p) {
      // 不在花名册里 = 早就掉线并被清理掉了（新房主 adopt 过来的旧 state 尤其常见），
      // 这种情况必须判离线，否则他会一直算在「等人描述 / 等人投票」里，全桌干等。
      var on = Object.prototype.hasOwnProperty.call(map, p.id) ? map[p.id] : false;
      if (p.online !== on) {
        p.online = on;
        changed = true;
      }
    });
    return changed;
  };

  /** 掉线（非主动退出）：标记离线、保留积分，并给一个宽限期。
   *  不能立刻把人踢出对局 —— 刷新页面、切后台、短暂断网都会走遗嘱，
   *  几秒后就回来的人应该原样继续玩，而不是被移出名单再也投不了票。 */
  Host.prototype.markOffline = function (id) {
    var p = this.player(id);
    if (p) p.online = false;
    var self = this;
    this.clearTimer('drop_' + id);
    this.after('drop_' + id, DROP_GRACE_MS, function () {
      var g = PN.games[self.state.mode];
      if (g && g.onLeave) g.onLeave(self, id);
      self.emit();
    });
  };

  Host.prototype.removePlayer = function (id) {
    this.clearTimer('drop_' + id);
    var s = this.state;
    s.players = s.players.filter(function (p) { return p.id !== id; });
    var g = PN.games[s.mode];
    if (g && g.onLeave) g.onLeave(this, id);
  };

  Host.prototype.player = function (id) {
    if (!this.state) return null;
    for (var i = 0; i < this.state.players.length; i++) if (this.state.players[i].id === id) return this.state.players[i];
    return null;
  };
  Host.prototype.onlinePlayers = function () {
    return this.state.players.filter(function (p) { return p.online; });
  };

  Host.prototype.emit = function () {
    this.state.ts = this.now();
    this.room.publishState(this.state);
    this.onStateChange(this.stateForUI());
  };
  Host.prototype.emitSoon = function (ms) {
    var self = this;
    // 走登记过的定时器：裸 setTimeout 不归 clearAll 管，会活着跨过 goLobby/换局，
    // 之后补一次多余的整树重建（可能冲掉正在输入的草稿）。
    this.after('__emitSoon_' + (this._emitSeq = (this._emitSeq || 0) + 1), ms || 30, function () { self.emit(); });
  };

  Host.prototype.addScore = function (id, delta) {
    var p = this.player(id);
    if (p) { p.score = (p.score || 0) + delta; }
  };

  /** 房间日志 + 本机提示。
   *  以前只 push 进 state.log，而 state.log 没有任何渲染者 —— 全 11 款游戏 75 处用户反馈
   *  （连成五子、对方离开、还没落子…）从来没显示过。onLocalToast 由 ui.js 注入。 */
  Host.prototype.toast = function (text, kind) {
    this.state.log.push({ t: this.now(), kind: kind || 'info', text: text });
    if (this.state.log.length > 40) this.state.log.shift();
    if (typeof this.onLocalToast === 'function') this.onLocalToast(text, kind || 'info');
  };
  Host.prototype.event = function (ev) { this.room.sendEvent(ev); };

  Host.prototype.after = function (name, ms, fn) {
    this.clearTimer(name);
    var self = this;
    this.timers[name] = setTimeout(function () { delete self.timers[name]; fn(); }, ms);
  };
  Host.prototype.every = function (name, ms, fn) {
    this.clearTimer(name);
    var self = this;
    this.timers[name] = setInterval(function () { fn(); }, ms);
  };
  Host.prototype.clearTimer = function (name) {
    if (this.timers[name]) { clearTimeout(this.timers[name]); clearInterval(this.timers[name]); delete this.timers[name]; }
  };
  Host.prototype.clearAll = function () {
    for (var k in this.timers) if (Object.prototype.hasOwnProperty.call(this.timers, k)) { clearTimeout(this.timers[k]); clearInterval(this.timers[k]); }
    this.timers = {};
  };

  Host.prototype.sendSecret = function (pid, obj) {
    this.secretCache[pid] = obj;
    this.room.sendPrivate(pid, { kind: 'secret', mode: this.state.mode, obj: obj });
  };
  /** 只发「请上报」请求，绝不写缓存。
   *  不能用 sendSecret 发请求：它会把 secretCache[pid] 覆盖成 {recover:true}，
   *  于是玩家真报回来的身份词被 if (!secretCache[from]) 挡在门外，新房主永远学不到词。 */
  Host.prototype.requestSecret = function (pid, obj) {
    this.room.sendPrivate(pid, { kind: 'secret', mode: this.state.mode, obj: obj });
  };
  Host.prototype.resendSecret = function (pid) {
    if (this.secretCache[pid]) this.room.sendPrivate(pid, { kind: 'secret', mode: this.state.mode, obj: this.secretCache[pid] });
  };
  Host.prototype.revealAll = function (obj) {
    var self = this, s = this.state;
    s.players.forEach(function (p) {
      self.room.sendPrivate(p.id, { kind: 'reveal', mode: s.mode, obj: obj });
    });
  };

  Host.prototype.goLobby = function () {
    this.clearAll();
    // 换游戏/回大厅：私密缓存必须失效，否则上一局缓存的秘密会在「秘密重发」时贴上当前 mode 标签。
    // （第27轮受控 A/B：回退该行后 codraw 仍 1 通过/2 失败且失败点逐次不同 → 与本行无因果，故恢复。）
    this.secretCache = {};
    var self = this;
    var scores = {};
    this.state.players.forEach(function (p) { scores[p.id] = p.score; });
    this.state.mode = 'lobby';
    this.state.phase = 'lobby';
    this.state.g = {};
    this.state.players.forEach(function (p) {
      p.score = scores[p.id] || 0; p.streak = 0; p.wins = 0; p.online = !!self.room.peers[p.id];
    });
    this.emit();
  };

  /** 借宿到已有 state（新当选房主继续游戏） */
  Host.prototype.adopt = function (state) {
    this.clearAll();
    this.state = JSON.parse(JSON.stringify(state));
    this.state.hostId = this.room.me.id;
    var game = PN.games[this.state.mode];
    if (game && game.resume) game.resume(this);
    this.emit();
  };
  Host.prototype.destroy = function () { this.clearAll(); };

  PN.Host = Host;
})(typeof globalThis !== 'undefined' ? globalThis : this);
