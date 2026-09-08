/* ===== UI 核心：落地页 + 大厅 + 通用渲染骨架 ===== */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};
  var $ = function (sel) { return document.querySelector(sel); };
  var EMPTY = { mode: 'lobby', phase: 'lobby', players: [], settings: {}, g: {}, log: [] };
  var EMOS = ['😎','🤪','🐱','🐶','🦊','🐼','🐸','🦄','🍄','🌚','👾','🎃','🍑','🔥','💎','🍉','🐧','🦖','🤖','🥷'];

  function UI() {
    this.root = $('#pn-root');
    this.room = null;
    this.host = null;
    this.state = EMPTY;
    this.secrets = {};
    this.screen = null;
    this.screenName = 'land';
    this.conn = 'off';
    this._toastTimer = null;
  }

  UI.prototype.el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  UI.prototype.h = function (html) {
    var d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  };
  UI.prototype.me = function () { return this.room ? this.room.me : null; };
  UI.prototype.pid = function () { return this.me() ? this.me().id : null; };
  UI.prototype.isHost = function () { return this.room ? this.room.isHost : false; };
  UI.prototype.p = function (id) {
    if (!this.state) return null;
    for (var i = 0; i < this.state.players.length; i++) if (this.state.players[i].id === id) return this.state.players[i];
    return null;
  };
  UI.prototype.send = function (action) {
    if (this.room) this.room.sendAction(action);
  };
  UI.prototype.renderGameFooter = function () {
    var self = this;
    var row = this.el('div', 'row mt16');
    row.style.justifyContent = 'center';
    var back = this.el('button', 'btn ghost sm', '🏠 回大厅');
    back.addEventListener('click', function () {
      if (self.isHost()) self.send({ t: 'lobby' });
      else self.room.leave(false);
    });
    row.appendChild(back);
    return row;
  };
  UI.prototype.toast = function (text, kind) {
    var box = $('.toasts');
    if (!box) { box = this.el('div', 'toasts'); document.body.appendChild(box); }
    var t = this.el('div', 'toast' + (kind ? ' ' + kind : ''), text);
    box.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 3200);
    setTimeout(function () { t.remove(); }, 3600);
  };
  UI.prototype.clear = function () { this.root.innerHTML = ''; };
  UI.prototype.setScreen = function (name, screen) {
    this.screenName = name;
    this.screen = screen || null;
    this.render();
  };
  UI.prototype.render = function () {
    if (!this.state) return;
    var name = this.state.mode === 'lobby' ? 'lobby' : this.state.mode;
    if (name !== this.screenName && PN.screens[name]) this.setScreen(name, PN.screens[name]);
    if (this.screen && this.screen.render) {
      var self = this;
      this.clear();
      try {
        var sec = this.secrets[this.state.mode];
        var node = self.screen.render.call(self, this.state, (sec && sec.mine) || null); // 屏幕要的是秘密本身，不是 {mine} 包装
        if (node && node.nodeType === 1) this.root.appendChild(node); // 屏幕只负责返回节点，由这里挂载
      } catch (e) { console.error('render error', e); this.clear(); this.root.appendChild(this.h('<div class="card center muted">界面出错了，请刷新（' + (e && e.message) + '）</div>')); }
    }
  };
  UI.prototype.local = function (key, val) {
    try {
      if (val === undefined) return localStorage.getItem('pn_' + key);
      localStorage.setItem('pn_' + key, val);
    } catch (e) {}
    return undefined;
  };

  UI.prototype.renderTopbar = function (into) {
    var self = this;
    var code = this.room ? this.room.code : '';
    var dot = this.conn === 'connected' ? 'ok' : 'warn';
    var title = '群友派对之夜';
    var bar = this.h(
      '<div class="topbar">' +
      '<span class="logo">🎉</span><span class="title">' + title + '</span>' +
      '<span class="spacer"></span>' +
      '<span class="chip"><span class="dot ' + dot + '"></span>' + (this.conn === 'connected' ? '在线' : '重连中…') + '</span>' +
      (code ? '<button class="chip" id="pn-copycode"><b>' + code + '</b></button>' : '') +
      '</div>'
    );
    into.appendChild(bar);
    var cbtn = $('#pn-copycode');
    if (cbtn) cbtn.addEventListener('click', function () { self.copyLink(); });
  };
  UI.prototype.link = function () {
    return location.origin + location.pathname + (location.search || '') + '#' + (this.room ? this.room.code : '');
  };
  UI.prototype.copyLink = function () {
    var link = this.link(), self = this;
    var done = function () { self.toast('链接已复制，甩给群友！', 'good'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done).catch(function () { prompt('复制链接（长按复制）', link); });
    } else prompt('复制链接', link);
  };
  UI.prototype.share = function () {
    var link = this.link();
    if (navigator.share) navigator.share({ title: '群友派对之夜', text: '点进来一起玩：房号 ' + (this.room ? this.room.code : ''), url: link }).catch(function () {});
    else this.copyLink();
  };

  /* ===== 落地页 ===== */
  UI.prototype.renderLand = function () {
    var self = this;
    this.clear();
    this.root.appendChild(this.h(
      '<div class="land">' +
      '<div class="biglogo">🎉</div>' +
      '<h1>群友派对之夜</h1>' +
      '<div class="sub">零服务器 · 打开链接即联机 · 谁是卧底 / 波长 / 谁最有可能 / 你画我猜</div>' +
      '<div class="field"><label>你的昵称</label><input id="pn-name" maxlength="12" placeholder="如：奶茶三分糖"></div>' +
      '<div class="field"><label>选个头像</label><div class="emoji-row" id="pn-emojis"></div></div>' +
      '<div class="grid2" style="max-width:340px;margin:0 auto">' +
      '<button class="btn primary block" id="pn-create">➕ 开个房</button>' +
      '<button class="btn block" id="pn-join">🚪 加入房间</button>' +
      '</div>' +
      '<div class="muted mt16">已有链接？直接点开输入昵称即可进场</div>' +
      '</div>'
    ));
    var nameInput = $('#pn-name');
    nameInput.value = this.local('name') || '';
    var emoBox = $('#pn-emojis');
    var curEmoji = this.local('emoji') || '😎';
    EMOS.forEach(function (e) {
      var b = self.el('button', 'e' + (e === curEmoji ? ' sel' : ''), e);
      b.addEventListener('click', function () {
        emoBox.querySelectorAll('.e').forEach(function (x) { x.classList.remove('sel'); });
        b.classList.add('sel');
        curEmoji = e;
      });
      emoBox.appendChild(b);
    });
    var enter = function (join) {
      var name = nameInput.value.trim() || '神秘群友';
      self.local('name', name);
      self.local('emoji', curEmoji);
      self.begin(name, curEmoji, join);
    };
    $('#pn-create').addEventListener('click', function () { enter(false); });
    $('#pn-join').addEventListener('click', function () { enter(true); });
    nameInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') enter(true); });
  };

  UI.prototype.begin = function (name, emoji, join) {
    var self = this;
    var id = this.local('id');
    if (!id) { id = 'p' + Math.random().toString(36).slice(2, 10); this.local('id', id); }
    var code = (location.hash || '').replace('#', '').toUpperCase();
    var wantJoin = join || !!code;
    var brokerIndex = Number(this.local('broker')) || 0;
    var build = function (c) {
      self.room = new PN.Room({
        code: c,
        identity: { id: id, name: name, emoji: emoji },
        brokerIndex: brokerIndex,
        onStatus: function (s, d) {
          self.conn = s === 'connected' ? 'connected' : (s === 'connecting' ? 'connecting' : 'off');
          if (s === 'connected') { self.local('broker', String(self.room.brokerIndex)); if (self.state && self.state.mode !== 'lobby') self.render(); }
          if (s === 'disconnected') self.render();
        },
        onRoster: function (list, kind, peerId) {
          if (kind === 'join' && peerId && self.room && self.room.isHost && self.host) {
            self.host.dispatch({ t: '_joined', id: peerId }, peerId);
          }
          if (self.room && self.room.isHost && self.host && self.state && self.state.mode === 'lobby') {
            self.host.dispatch({ t: 'hi' }, self.pid());
          }
        },
        onHost: function (isHost) {
          if (isHost) {
            if (!self.host) self.host = new PN.Host(self.room, function (state) { self.state = state; self.render(); });
            if (self.room.lastState && self.room.lastState.players) self.host.adopt(self.room.lastState);
            else self.host.fresh(id, name, emoji);
          }
          self.render();
        },
        onState: function (state) {
          self.state = state;
          if (!self.room.isHost && state.hostId !== self.pid()) self.state = state;
          self.render();
        },
        onAction: function (action, from) { if (self.host && self.room.isHost) self.host.dispatch(action, from); },
        onEvent: function (ev) { self.onEvent(ev); },
        onPeer: function (msg, from) { if (self.screen && self.screen.onPeer) self.screen.onPeer(msg, from); },
        onPrivate: function (obj, from) {
          if (obj.kind === 'secret') {
            self.secrets[obj.mode] = self.secrets[obj.mode] || {};
            self.secrets[obj.mode].mine = obj.obj;
            if (obj.obj && obj.obj.recover && self.screen && self.screen.onRecover) {
              self.screen.onRecover.call(self, obj.obj);
            }
          }
          if (obj.kind === 'reveal' && self.screen && self.screen.onReveal) self.screen.onReveal.call(self, obj.obj);
          if (self.screen && self.screen.onPrivate) self.screen.onPrivate.call(self, obj, from);
          self.render();
        }
      });
      self.room.start().then(function () {
        self.setScreen('lobby', PN.screens.lobby);
      });
    };
    if (wantJoin) {
      var c = code || '';
      if (!c) {
        var answer = prompt('输入 4 位房号（群友发你的）', '');
        if (!answer) return;
        c = answer.toUpperCase();
      }
      PN.Room.probe(c, brokerIndex, 3000).then(function (meta) {
        if (!meta) {
          if (confirm('没找到房间 ' + c + '，要自己开一个吗？')) build(c);
          else self.renderLand();
        } else build(c);
      });
    } else {
      var gen = function (n) { for (var i = 0; i < n; i++) { var c = PN.randCode(4); if (c !== location.hash.slice(1).toUpperCase()) return c; } return PN.randCode(4); };
      var c = gen(8);
      PN.Room.probe(c, brokerIndex, 2500).then(function (meta) { if (meta) build(gen(40)); else build(c); });
    }
  };

  UI.prototype.onEvent = function (ev) {
    if (ev.t === 'descAll') { this.toast('描述揭晓，开始投票！'); return; }
    if (ev.t === 'voteResult') { this.toast('投票结果出炉'); return; }
    if (ev.t === 'gameover') {
      this.toast(ev.msg || '本局结束！', 'good');
      if (ev.sfx) this.beep(ev.sfx);
      return;
    }
    if (ev.t === 'question') { this.toast('🃏 ' + (ev.q || '')); return; }
    if (ev.t === 'correct') { this.toast('✅ ' + (ev.text || '') + '！' + (ev.who ? ' ' + ev.who + ' 答对了' : ''), 'good'); this.beep('win'); return; }
    if (ev.t === 'reveal') { this.toast('答案：' + (ev.answer || ev.target || '') + (ev.clue ? '（线索：' + ev.clue + '）' : ''), 'good'); this.beep('win'); return; }
    if (ev.t === 'round') { this.toast(ev.msg || '新回合'); return; }
    if (ev.t === 'toast') { this.toast(ev.text || '', ev.kind); return; }
  };
  UI.prototype.beep = function (kind) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = this._ac || (this._ac = new AC());
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      if (kind === 'win') { o.frequency.value = 880; g.gain.value = 0.08; o.start(); o.stop(ctx.currentTime + 0.18); }
      else { o.frequency.value = 523; g.gain.value = 0.06; o.start(); o.stop(ctx.currentTime + 0.12); }
    } catch (e) {}
  };

  /* ===== 大厅 ===== */
  PN.screens = PN.screens || {};
  PN.screens.lobby = {
    name: 'lobby',
    render: function (state, secret) { return UI.prototype.renderLobby.call(this, state); }
  };
  // 注：屏幕的 render 由 UI.render 用 .call(ui, ...) 调用，所以这里 this 就是 UI 实例

  UI.prototype.renderLobby = function (state) {
    var self = this;
    this.clear();
    var wrap = this.el('div');
    this.root.appendChild(wrap); // 先挂载：下面用 $('#...') 全局查元素
    this.renderTopbar(wrap);
    var s = state;
    var sorted = (s.players || []).slice().sort(function (a, b) { return b.score - a.score; });
    var playersHtml = sorted.map(function (p) {
      return '<div class="player ' + (p.id === self.pid() ? 'me' : '') + (p.id === s.hostId ? ' host' : '') + (p.online ? '' : ' off') + '">' +
        '<span class="em">' + (p.emoji || '🙂') + '</span>' +
        '<span class="nm">' + p.name + '</span>' +
        '<span class="sc">' + (p.score || 0) + ' 分</span>' +
        '</div>';
    }).join('');
    var modes = [];
    for (var k in PN.games) if (Object.prototype.hasOwnProperty.call(PN.games, k)) {
      var g = PN.games[k];
      modes.push(
        '<div class="modecard" data-mode="' + k + '">' +
        '<div class="ico">' + g.emoji + '</div>' +
        '<div class="nm">' + g.name + '</div>' +
        '<div class="blurb">' + g.blurb + '</div>' +
        '<div class="row mt8"><button class="btn sm ghost" data-act="cfg">⚙️</button>' +
        '<button class="btn primary sm go" data-act="start" ' + (self.isHost() ? '' : 'disabled') + '>' + (self.isHost() ? '开始' : '等房主开') + '</button></div>' +
        '<div class="settings" id="cfg-' + k + '">' + this.settingsHtml(k, s) + '</div>' +
        '</div>'
      );
    }
    wrap.appendChild(this.h(
      '<div>' + // 必须包一层：h() 只保留第一个顶层元素
      '<div class="roomcode card row">' +
      '<div><div class="muted" style="font-size:11px">房号（复制发给群友）</div><div class="code">' + this.room.code + '</div></div>' +
      '<div style="flex:1"></div>' +
      '<button class="btn sm" id="pn-copy">📋 复制链接</button>' +
      '<button class="btn sm" id="pn-share">📤</button>' +
      '</div>' +
      '<div class="card"><div class="muted" style="margin-bottom:10px">在房里的群友（' + (s.players || []).length + '）</div>' +
      '<div class="players">' + (playersHtml || '<div class="muted">还没人，快拉人！</div>') + '</div></div>' +
      '<div class="modegrid">' + modes.join('') + '</div>' +
      '<div class="row mt16" style="justify-content:center;gap:8px">' +
      '<button class="btn ghost sm" id="pn-edit">✏️ 改昵称</button>' +
      (self.isHost() ? '<button class="btn warn sm" id="pn-reset">清零积分</button><button class="btn warn sm" id="pn-disband">解散房间</button>' : '<button class="btn warn sm" id="pn-leave">离开</button>') +
      '</div>' +
      '</div>'
    ));
    $('#pn-copy').addEventListener('click', function () { self.copyLink(); });
    $('#pn-share').addEventListener('click', function () { self.share(); });
    $('#pn-edit').addEventListener('click', function () { self.editProfile(); });
    var reset = $('#pn-reset'); if (reset) reset.addEventListener('click', function () { if (confirm('清零所有人积分？')) self.send({ t: 'resetScores' }); });
    var dis = $('#pn-disband'); if (dis) dis.addEventListener('click', function () { if (confirm('解散房间？所有人都要重进')) { self.room.leave(true); location.reload(); } });
    var lv = $('#pn-leave'); if (lv) lv.addEventListener('click', function () { self.room.leave(false); location.reload(); });
    var cards = wrap.querySelectorAll('.modecard');
    cards.forEach(function (card) {
      var mode = card.dataset.mode;
      card.querySelector('[data-act="cfg"]').addEventListener('click', function () {
        var cfg = $('#cfg-' + mode);
        if (cfg) cfg.classList.toggle('open');
      });
      card.querySelector('[data-act="start"]').addEventListener('click', function () {
        self.send({ t: 'start', mode: mode });
      });
      card.querySelectorAll('.cfg').forEach(function (ctl) {
        ctl.addEventListener('click', function () {
          var raw = ctl.dataset.val;
          var v;
          if (raw === 'true') v = true; else if (raw === 'false') v = false; else if (!isNaN(Number(raw))) v = Number(raw); else v = raw;
          var values = {};
          values[ctl.dataset.key] = v;
          self.send({ t: 'settings', values: values });
          card.querySelectorAll('.cfg[data-key="' + ctl.dataset.key + '"]').forEach(function (x) { x.classList.remove('on'); });
          ctl.classList.add('on');
        });
      });
    });
    return wrap;
  };

  UI.prototype.settingsHtml = function (mode, s) {
    var st = (s.settings && s.settings[mode]) || {};
    var rows = [];
    var seg = function (label, key, opts) {
      var cur = String(st[key]);
      return '<div class="setrow"><span>' + label + '</span><div class="seg">' + opts.map(function (o) {
        return '<button class="cfg ' + (String(o[0]) === cur ? 'on' : '') + '" data-key="' + key + '" data-val="' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div></div>';
    };
    if (mode === 'undercover') {
      rows.push(seg('卧底人数', 'numUnder', [[1, '1 个'], [2, '2 个']]));
      rows.push(seg('加白板', 'blank', [[false, '关'], [true, '开']]));
      rows.push(seg('描述方式', 'textMode', [[true, '打字'], [false, '开口说']]));
      rows.push(seg('每轮时长', 'roundSec', [[90, '90s'], [180, '180s'], [300, '300s']]));
    } else if (mode === 'wavelength') {
      rows.push(seg('总局数', 'rounds', [[4, '4'], [6, '6'], [8, '8'], [10, '10']]));
    } else if (mode === 'mostlikely') {
      rows.push(seg('总题数', 'rounds', [[6, '6'], [8, '8'], [10, '10'], [12, '12']]));
      rows.push(seg('每题时长', 'eachSec', [[20, '20s'], [30, '30s'], [45, '45s']]));
    } else if (mode === 'drawgame') {
      rows.push(seg('总回合', 'rounds', [[3, '3'], [6, '6'], [9, '9']]));
      rows.push(seg('画画时长', 'drawSec', [[60, '60s'], [90, '90s'], [120, '120s']]));
    }
    return rows.join('');
  };

  UI.prototype.editProfile = function () {
    var self = this;
    this.root.appendChild(this.h(
      '<div class="overlay"><div class="modal">' +
      '<div class="center" style="font-weight:800;margin-bottom:14px">✏️ 改昵称</div>' +
      '<div class="field"><input id="pn-ename" maxlength="12" value="' + this.me().name + '"></div>' +
      '<div class="row mt16"><button class="btn ghost block" id="pn-ecancel">取消</button>' +
      '<button class="btn primary block" id="pn-esave">保存</button></div>' +
      '</div></div>'
    ));
    $('#pn-ecancel').addEventListener('click', function () { document.querySelector('.overlay').remove(); });
    $('#pn-esave').addEventListener('click', function () {
      var name = $('#pn-ename').value.trim() || '神秘群友';
      self.room.me.name = name;
      self.local('name', name);
      self.send({ t: 'setProfile', name: name, emoji: self.me().emoji });
      document.querySelector('.overlay').remove();
      self.render();
    });
  };

  PN.UI = UI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
