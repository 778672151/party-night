/* ===== 房主权威状态机：公共 reducer + 计时器 + 私密下发 =====
 * state 结构：
 * {
 *   v: 3, mode: 'lobby'|'undercover'|'wavelength'|'mostlikely'|'drawgame',
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
      this.upsertPlayer(from);
      this.emit();
      return;
    }
    if (action.t === '_left') {
      this.removePlayer(from);
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
      this.state.mode = mode;
      game.init(this);
      this.emit();
      return;
    }
    if (action.t === 'lobby') { this.goLobby(); return; }
    if (action.t === 'settings') {
      for (var k in action.values) if (Object.prototype.hasOwnProperty.call(action.values, k)) {
        this.state.settings[k] = this.coerce(this.state.settings[k], action.values[k]);
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
        undercover: { numUnder: 1, blank: false, textMode: true, roundSec: 180 },
        wavelength: { rounds: 6 },
        mostlikely: { rounds: 8, eachSec: 30 },
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
    found.online = true;
    return found;
  };

  Host.prototype.removePlayer = function (id) {
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
    setTimeout(function () { self.emit(); }, ms || 30);
  };

  Host.prototype.addScore = function (id, delta) {
    var p = this.player(id);
    if (p) { p.score = (p.score || 0) + delta; }
  };

  Host.prototype.toast = function (text, kind) {
    this.state.log.push({ t: this.now(), kind: kind || 'info', text: text });
    if (this.state.log.length > 40) this.state.log.shift();
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
