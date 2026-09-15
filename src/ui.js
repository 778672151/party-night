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
  /** 墨迹直达通道（不走动作通道、不绕房主转发）：丢包能自愈，见 src/wire.js */
  UI.prototype.sendInk = function (msg) {
    if (this.room) this.room.sendInk(msg);
  };
  UI.prototype.renderGameFooter = function () {
    var self = this;
    var row = this.el('div', 'row mt16');
    row.style.justifyContent = 'center';
    var host = this.isHost();
    // 非房主不能替全房切回大厅（大厅是房主的状态），所以对他来说是「退出房间」。
    // 以前这里对非房主直接 room.leave() 却不刷新：MQTT 连接被关掉了，屏幕却还停在游戏页，
    // 之后收不到任何状态，看起来就是「点了回大厅没反应」。
    var back = this.el('button', 'btn ghost sm', host ? '🏠 回大厅' : '🚪 退出房间');
    back.addEventListener('click', function () {
      if (self.isHost()) { self.send({ t: 'lobby' }); return; }
      if (confirm('退出房间？这一局就少你一个人了')) { self.room.leave(false); self.exitToLand(); }
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

  /* 整树重建前抢救输入框：每收到一条状态消息都会 clear()，别人一提交，
     你正在打的半截描述/线索就被清空了（中文输入法更是整段丢字）。
     屏幕如果自己实现了 beforeRender（你画我猜），就归屏幕管，这里不插手。 */
  UI.prototype.snapshotInput = function () {
    this._draft = null;
    var ae = document.activeElement;
    if (!ae || (ae.tagName !== 'INPUT' && ae.tagName !== 'TEXTAREA') || ae.disabled || ae.readOnly) return;
    var all = document.querySelectorAll('input,textarea'), idx = -1, i;
    for (i = 0; i < all.length; i++) if (all[i] === ae) { idx = i; break; }
    var s = null, e = null;
    try { s = ae.selectionStart; e = ae.selectionEnd; } catch (err) {}
    this._draft = { tag: ae.tagName, ph: ae.placeholder || '', idx: idx, value: ae.value, s: s, e: e };
  };
  UI.prototype.restoreInput = function () {
    var d = this._draft;
    if (!d) return;
    this._draft = null;
    var all = document.querySelectorAll('input,textarea'), el = null, i;
    for (i = 0; i < all.length; i++) {
      if (all[i].tagName === d.tag && (all[i].placeholder || '') === d.ph) { el = all[i]; break; }
    }
    if (!el && d.idx >= 0 && all[d.idx] && all[d.idx].tagName === d.tag) el = all[d.idx];
    if (!el || el.disabled) return;
    el.value = d.value;
    try { el.focus(); if (d.s !== null) el.setSelectionRange(d.s, d.e); } catch (err) {}
  };

  /* 输入法组合（拼音还没上屏）期间，绝不能重建 DOM —— clear() 会把输入框拆掉，
     未上屏的拼音和候选词会整段丢失（中文群友打字几乎必踩）。这里做全局检测，所有屏幕共享。 */
  var imeComposing = false, lastUI = null;
  function imeFreeze() {
    if (!imeComposing) return false;
    var ae = document.activeElement;
    if (!ae || (ae.tagName !== 'INPUT' && ae.tagName !== 'TEXTAREA')) { imeComposing = false; return false; } // 自愈：输入框已不在焦点上
    return true;
  }
  document.addEventListener('compositionstart', function () { imeComposing = true; }, true);
  document.addEventListener('compositionend', function () {
    imeComposing = false;
    if (lastUI && lastUI._renderPending) setTimeout(function () { lastUI.flushRender(); }, 0);
  }, true);
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
      var ownsDraft = !!this.screen.beforeRender;
      if (this.screen.beforeRender) { try { this.screen.beforeRender.call(this); } catch (e) {} } // 清空 DOM 前抢救输入草稿/滚动位置
      if (!ownsDraft) this.snapshotInput(); // 其他屏幕用通用抢救：重建后草稿和光标都还在
      // 拖拽/作画进行中绝不重建 DOM：clear() 会拆掉画布元素，浏览器随即释放指针捕获并抛 pointercancel，
      // 笔画当场断掉（jsdom 没有指针捕获语义，所以单测测不出来）。屏幕用 deferRender 声明，落笔后自己 flushRender 补一次。
      if (this.screen.deferRender) {
        var defer = false;
        try { defer = !!this.screen.deferRender.call(this); } catch (e) {}
        if (defer) { this._renderPending = true; return; }
      }
      // 屏幕可以用 patch 声明"这次状态变化不值得重建 DOM"（例如只变了蓄力进度）。
      // 跳一跳卡顿的根因就是这个：蓄力时每秒广播 8 次进度 → 8 次整屏重建 → 画布每秒被拆掉重建 8 次，
      // rAF 的目标节点不断失效（玩家看到的就是一顿一顿）。返回真表示屏幕已自行处理。
      if (this.screen.patch) {
        var patched = false;
        try { patched = !!this.screen.patch.call(this, this.state); } catch (e) {}
        if (patched) { this._renderPending = true; return; }
      }
      if (imeFreeze()) { this._renderPending = true; return; } // 拼音上屏中：先别动 DOM
      lastUI = this;
      this.clear();
      try {
        var sec = this.secrets[this.state.mode];
        var node = self.screen.render.call(self, this.state, (sec && sec.mine) || null); // 屏幕要的是秘密本身，不是 {mine} 包装
        if (node && node.nodeType === 1) this.root.appendChild(node); // 屏幕只负责返回节点，由这里挂载
        if (!ownsDraft) this.restoreInput();
        this.root.classList.toggle('wide', !!(this.screen && this.screen.wide)); // 画猜用宽屏双栏
        if (this.screen.mounted) this.screen.mounted.call(self, node); // 挂载后钩子：此时才量得到真实尺寸
      } catch (e) { console.error('render error', e); this.clear(); this.root.appendChild(this.h('<div class="card center muted">界面出错了，请刷新（' + (e && e.message) + '）</div>')); }
    }
  };
  /** 配合 screen.deferRender：拖拽结束后把被跳过的那次渲染补上 */
  UI.prototype.flushRender = function () {
    if (!this._renderPending) return;
    this._renderPending = false;
    this.render();
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
    var title = '两个人的游戏厅';
    var bar = this.h(
      '<div class="topbar">' +
      '<span class="logo">🧸</span><span class="title">' + title + '</span>' +
      '<span class="spacer"></span>' +
      '<span class="chip"><span class="dot ' + dot + '"></span>' + (this.conn === 'connected' ? '在线' : '重连中…') + '</span>' +
      // 房号同时带 roomcode/code 语义：顶栏这一处就是唯一的房号展示位（点它复制链接）
      (code ? '<button class="chip roomcode" id="pn-copycode" title="点一下复制邀请链接"><span class="code">' + code + '</span></button>' : '') +
      '</div>'
    );
    into.appendChild(bar);
    var cbtn = $('#pn-copycode');
    if (cbtn) cbtn.addEventListener('click', function () { self.copyLink(); });
  };
  /** 主动离开：先抹掉地址栏里的房号，再刷新回落地页（不然刷新会立刻自动进回刚退出的房间） */
  UI.prototype.exitToLand = function () {
    try { history.replaceState(null, '', location.pathname + (location.search || '')); } catch (e) { try { location.hash = ''; } catch (e2) {} }
    location.reload();
  };
  UI.prototype.link = function () {
    return location.origin + location.pathname + (location.search || '') + '#' + (this.room ? this.room.code : '');
  };
  UI.prototype.copyLink = function () {
    var link = this.link(), self = this;
    var done = function () { self.toast('链接已复制，发给对方吧～', 'good'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done).catch(function () { prompt('复制链接（长按复制）', link); });
    } else prompt('复制链接', link);
  };
  UI.prototype.share = function () {
    var link = this.link();
    if (navigator.share) navigator.share({ title: '两个人的游戏厅', text: '点进来一起玩：房号 ' + (this.room ? this.room.code : ''), url: link }).catch(function () {});
    else this.copyLink();
  };

  /* ===== 过渡页：建房/进房时先给个反馈，别让人对着落地页干等 ===== */
  /** 联机游戏 → 现成单机版（第3块切换版用；只列确实存在对应单机版的四款） */
  var SOLO_FALLBACK = {
    cube: 'rubik-anime-lab-0b0c6984',
    soko: 'plus-2265f7c6',
    domino: 'demo-c046ab75',
    go: 'demo-29b78d69'
  };

  UI.prototype.renderWaiting = function (text) {
    this.clear();
    this.root.appendChild(this.h(
      '<div class="land"><div class="biglogo">🧸</div><h1>两个人的游戏厅</h1>' +
      '<div class="sub">' + PN.esc(text) + '</div></div>'
    ));
  };

  /* ===== 落地页 ===== */
  UI.prototype.renderLand = function () {
    var self = this;
    // 阶段二A：记住身份后一步直达。带 #房号 的链接进来则零点击直接进场；
    // 没有房号时只留一次点击（开房/加入），首访用户仍走完整表单。
    var saved = this.local('name');
    var savedEmo = this.local('emoji') || '😎';
    var hashCode = (location.hash || '').replace('#', '').toUpperCase();
    if (saved) {
      if (hashCode) { this.begin(saved, savedEmo, true); return; }
      this.clear();
      this.root.appendChild(this.h(
        '<div class="land">' +
        '<div class="biglogo">🧸</div>' +
        '<h1>两个人的游戏厅</h1>' +
        '<div class="sub">' + PN.esc(saved) + ' ' + PN.esc(savedEmo) + ' · 一步进场</div>' +
        '<div class="grid2" style="max-width:340px;margin:0 auto">' +
        '<button class="btn primary block" id="pn-create">➕ 开个房</button>' +
        '<button class="btn block" id="pn-join">🚪 加入房间</button>' +
        '</div>' +
        '<button class="btn ghost sm" id="pn-edit-land" style="margin-top:14px">✏️ 改昵称/换头像</button>' +
        '</div>'
      ));
      var code = hashCode;
      var go = function (join) { self.begin(saved, savedEmo, join || !!code); };
      $('#pn-create').addEventListener('click', function () { go(false); });
      $('#pn-join').addEventListener('click', function () { go(true); });
      $('#pn-edit-land').addEventListener('click', function () {
        var v = prompt('你的昵称', saved);
        if (v !== null && v.trim()) { self.local('name', v.trim()); self.local('emoji', '😎'); }
        self.renderLandFull();
      });
      return;
    }
    this.renderLandFull();
  };

  UI.prototype.renderLandFull = function () {
    var self = this;
    this.clear();
    this.root.appendChild(this.h(
      '<div class="land">' +
      '<div class="biglogo">🧸</div>' +
      '<h1>两个人的游戏厅</h1>' +
      '<div class="sub">双人联机 · 零服务器 · 打开链接就能一起玩 · 你画我猜</div>' +
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
      var name = nameInput.value.trim() || '神秘朋友';
      self.local('name', name);
      self.local('emoji', curEmoji);
      self.begin(name, curEmoji, join);
    };
    $('#pn-create').addEventListener('click', function () { enter(false); });
    $('#pn-join').addEventListener('click', function () { enter(true); });
    nameInput.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return; // 输入法回车=确认候选词
      enter(true);
    });
  };

  UI.prototype.begin = function (name, emoji, join) {
    // 记录是不是「从别人的链接进来」的，用于大厅里的分服提示（自己开房不提示）
    try { sessionStorage.setItem('pn_via_link', (join || !!location.hash) ? '1' : ''); } catch (e) {}
    var self = this;
    var id = this.local('id');
    if (!id) { id = 'p' + Math.random().toString(36).slice(2, 10); this.local('id', id); }
    var code = (location.hash || '').replace('#', '').toUpperCase();
    var wantJoin = join || !!code;
    var brokerIndex = Number(this.local('broker')) || 0;
    var build = function (c) {
      // 房号写回地址栏：这样「开房的人」刷新页面也能回到同一局（以前只有点链接进来的人有 #房号，
      // 开房的人一刷新就掉回落地页，还得手动再输房号），顺便让随时复制的链接都带着房号。
      try { history.replaceState(null, '', '#' + c); } catch (e) { try { location.hash = c; } catch (e2) {} }
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
          if (self.room && self.room.isHost && self.host) {
            // 大厅：刷新名单；对局中：只刷新在线状态（否则掉线的人会让全桌干等人）
            self.host.dispatch({ t: self.state && self.state.mode === 'lobby' ? 'hi' : '_syncOnline' }, self.pid());
          }
        },
        onHost: function (isHost) {
          if (isHost) {
            if (!self.host) self.host = new PN.Host(self.room, function (state) { self.state = state; self.render(); });
            // 把房主的 toast 同步浮现到本机（否则只进 state.log，界面上永远看不到）
            if (!self.host.onLocalToast) self.host.onLocalToast = function (text, kind) { self.toast(text, kind); };
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
        onPeer: function (msg, from) { if (self.screen && self.screen.onPeer) self.screen.onPeer.call(self, msg, from); },
        onInk: function (msg, from) {
          // 房主旁听墨迹：留一份给中途加入的人回放（自己的笔迹也会走这里，见 room.sendInk）
          if (!self.room.isHost || !self.host || !self.state) return;
          var g = PN.games[self.state.mode];
          if (g && g.onInk) g.onInk(self.host, msg, from);
        },
        onPrivate: function (obj, from) {
          if (obj.kind === 'secret') {
            self.secrets[obj.mode] = self.secrets[obj.mode] || {};
            // 同一个 mode 下会收到多种私密消息（发词 / 白板猜词 / 请求上报），必须合并而不是覆盖：
            // 覆盖会当场抹掉玩家自己的词和身份 —— 白板词卡变空白、房主迁移时 onRecover 读不到角色而无法上报。
            var prevSec = self.secrets[obj.mode].mine || {};
            var nextSec = obj.obj || {};
            var mergedSec = {}, mk;
            for (mk in prevSec) if (Object.prototype.hasOwnProperty.call(prevSec, mk)) mergedSec[mk] = prevSec[mk];
            for (mk in nextSec) if (Object.prototype.hasOwnProperty.call(nextSec, mk)) mergedSec[mk] = nextSec[mk];
            self.secrets[obj.mode].mine = mergedSec;
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
      // 房号本身就是房间标识，探不到也照样能进——你要是第一个到的，你自动就是房主。
      // 这里以前拿 3 秒 probe 的结果决定要不要 confirm 问「没找到房间，要自己开一个吗？」，
      // 但公共 broker 的冷连接实测要 6~7 秒，3 秒必然超时 —— 结果每个点链接进来的人
      // 都被这句吓一跳，点「取消」还会被踢回落地页。改成直接进场，只给一句过渡提示。
      self.renderWaiting('正在进入房间 ' + c + '…');
      build(c);
    } else {
      var gen = function (n) { for (var i = 0; i < n; i++) { var c = PN.randCode(4); if (c !== location.hash.slice(1).toUpperCase()) return c; } return PN.randCode(4); };
      var c = gen(8);
      // 阶段二：去掉建房的阻塞式 probe。实测点击→room 对象要 2581/2816ms，几乎就是这句 2500ms；
      // 而 probe 自己另开一条冷连接，公共 broker 冷连接 6~7 秒，2500ms 上限会在订阅建成前到期，
      // 既防不住撞号也白等（join 路径早已因此改为直接进场）。4 位码撞号概率极低，且真撞上也只是同房。
      self.renderWaiting('正在建房…');
      build(c);
    }
  };

  UI.prototype.onEvent = function (ev) {
    // 换主后新房主手里的回放记录是空的：让它自己的屏幕把笔迹重报一遍（见 drawgame.resume）
    if (ev.t === 'recover_ink') {
      if (this.screen && this.screen.onRecover) this.screen.onRecover.call(this, { ink: true, round: ev.round });
      return;
    }
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
      if (ctx.state === 'suspended') ctx.resume();
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      var t0 = ctx.currentTime;
      // 可爱的音色：三角波/正弦 + 指数包络（「啵」的弹性来自快速上滑 + 干脆收尾）
      if (kind === 'win') {
        o.type = 'triangle';
        [523.25, 659.25, 783.99].forEach(function (f, i) { o.frequency.setValueAtTime(f, t0 + i * 0.09); });
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
        o.start(t0); o.stop(t0 + 0.36);
      } else {
        o.type = 'sine';
        o.frequency.setValueAtTime(420, t0);
        o.frequency.exponentialRampToValueAtTime(900, t0 + 0.07);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.13, t0 + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
        o.start(t0); o.stop(t0 + 0.18);
      }
    } catch (e) {}
  };

  /* ===== 大厅 ===== */
  PN.screens = PN.screens || {};
  PN.screens.lobby = {
    name: 'lobby',
    render: function (state, secret) { return UI.prototype.renderLobby.call(this, state); }
  };
  // 注：屏幕的 render 由 UI.render 用 .call(ui, ...) 调用，所以这里 this 就是 UI 实例

  /**
   * 小游戏目录在哪：线上是 /<repo>/mini/、本地从仓库根打开也是 /mini/，
   * 但如果只开了 dist/party-night.html，就在上一层的 ../mini/。
   * 用一次 HEAD 探测定下来并缓存，两种打开方式都能玩。
   */
  UI.prototype.miniBase = function (cb) {
    var self = this;
    if (this._miniBase) { cb(this._miniBase); return; }
    if (this._miniBase === '') { cb(''); return; }   // 探过了、都没有
    var first = (PN.Banks && PN.Banks.mini ? PN.Banks.mini() : [])[0];
    if (!first) { cb(''); return; }
    var cands = ['mini/', '../mini/'], i = 0;
    var next = function () {
      if (i >= cands.length) { self._miniBase = ''; cb(''); return; }
      var c = cands[i++];
      fetch(c + first.dir + '/index.html', { method: 'HEAD' }).then(function (r) {
        if (r.ok) { self._miniBase = c; cb(c); } else next();
      }).catch(next);
    };
    next();
  };

  /** 浮层里跑小游戏：不跳走、不丢房间（关掉就回到大厅） */
  UI.prototype.openMini = function (m) {
    var self = this;
    this.closeMini();
    var ov = document.createElement('div');
    ov.className = 'mini-ov';
    ov.innerHTML = '<div class="mini-bar"><span class="mini-title">' + m.emoji + ' ' + m.title + '</span>' +
      '<span class="muted mini-tip">' + (m.desc || '') + '</span>' +
      '<button class="btn sm" id="mini-close">← 返回大厅</button></div>' +
      '<iframe class="mini-frame" allow="fullscreen; autoplay; gamepad" referrerpolicy="no-referrer"></iframe>';
    document.body.appendChild(ov);
    this._miniOv = ov;
    var frame = ov.querySelector('.mini-frame');
    this.miniBase(function (base) {
      if (!base) { self.toast('小游戏文件没找到（要从仓库根目录打开，见 README 的运行说明）', 'info'); return; }
      frame.src = base + m.dir + '/index.html';
    });
    ov.querySelector('#mini-close').addEventListener('click', function () { self.closeMini(); });
  };
  UI.prototype.closeMini = function () {
    if (this._miniOv && this._miniOv.parentNode) this._miniOv.parentNode.removeChild(this._miniOv);
    this._miniOv = null;
  };

  UI.prototype.renderLobby = function (state) {
    var self = this;
    this.clear();
    var wrap = this.el('div');
    this.root.appendChild(wrap); // 先挂载：下面用 $('#...') 全局查元素
    this.renderTopbar(wrap);
    var s = state;
    var sorted = (s.players || []).slice().sort(function (a, b) { return b.score - a.score; });
    // 点链接进来却一个人都没有、自己还成了房主：多半是网络把这位群友分到了另一台公共服务器
    // （客户端连不上主 broker 会自动换备用，而备用和主用的是两套话题空间）。给一句人话提示。
    // 只在「点别人的链接进来」且房里只有自己时才提示（自己开房不该看到这句）
    var cameByLink = !!sessionStorage.getItem('pn_via_link') && !!location.hash;
    var lonely = cameByLink && (s.players || []).length <= 1;
    var playersHtml = sorted.map(function (p) {
      return '<div class="player ' + (p.id === self.pid() ? 'me' : '') + (p.id === s.hostId ? ' host' : '') + (p.online ? '' : ' off') + '">' +
        '<span class="em">' + (p.emoji || '🙂') + '</span>' +
        '<span class="nm">' + p.name + '</span>' +
        '<span class="sc">' + (p.score || 0) + ' 分</span>' +
        '</div>';
    }).join('');
    /* ===== 入口系统（阶段三升级）：一份目录驱动全部卡片 =====
     * 以前"联机游戏卡片"和"小游戏厅卡片"是两段各自渲染的代码，加游戏要改两处。
     * 现在统一走 PN.gameCommon.catalog() + gameCard() + sections()：
     * 以后新增游戏只写数据（PN.games 的 meta 或 data/mini.json），入口一行都不用动。 */
    var GC = PN.gameCommon;
    var cfgOpen = this._cfgOpen || (this._cfgOpen = {}); // 展开状态记在实例上，重建后还能保持
    var sectionsHtml = GC.sections(GC.catalog()).map(function (sec) {
      var isMini = sec.group === 'mini';
      var cards = sec.items.map(function (it) {
        if (isMini) {
          return GC.gameCard({ kind: 'mini', id: it.id, emoji: it.emoji, title: it.title, desc: it.desc, tags: it.tags });
        }
        return GC.gameCard({
          kind: 'online', id: it.id, emoji: it.emoji, title: it.title, desc: it.desc,
          tags: it.tags, players: it.players,
          actions: '<div class="row mt8"><button class="btn sm ghost" data-act="cfg">⚙️</button>' +
            '<button class="btn primary sm go" data-act="start" ' + (self.isHost() ? '' : 'disabled') + '>' +
            (self.isHost() ? '开始' : '等房主开') + '</button></div>' +
            '<div class="settings' + (cfgOpen[it.id] ? ' open' : '') + '" id="cfg-' + it.id + '">' + self.settingsHtml(it.id, s) + '</div>'
        });
      }).join('');
      if (!cards) return '';
      return '<div class="' + (isMini ? 'mini-sec' : 'game-sec') + '">' +
        '<div class="' + (isMini ? 'mini-head' : 'game-head') + '">' +
        '<b>' + GC.groupTitle[sec.group] + '</b>' +
        '<span class="muted">' + GC.groupSub[sec.group] + '</span></div>' +
        '<div class="' + (isMini ? 'mini-grid' : 'modegrid') + '">' + cards + '</div></div>';
    }).join('');
    wrap.appendChild(this.h(
      '<div>' + // 必须包一层：h() 只保留第一个顶层元素
      // 房号只在上方顶栏显示一次（点它即复制），这里不再重复一条通栏；
      // 名册与「复制链接」并成一行，避免两条通栏横向全是空白。
      '<div class="card roster">' +
      '<div class="players">' + (playersHtml || '<span class="muted">还差一个人，把对方叫进来吧～</span>') + '</div>' +
      '<span class="spacer"></span>' +
      '<button class="btn sm" id="pn-copy">📋 复制链接</button>' +
      '<button class="btn sm" id="pn-share">📤</button>' +
      '</div>' +
      (lonely ? '<div class="card center"><div class="muted">进房了却一个人都没有？公共服务器偶尔会因为网络限制把你分到另一台，<b>刷新一下</b>一般就能看到对方了。</div></div>' : '') +
      sectionsHtml +
      '<div class="row mt16" style="justify-content:center;gap:8px">' +
      '<button class="btn ghost sm" id="pn-edit">✏️ 改昵称</button>' +
      (self.isHost() ? '<button class="btn warn sm" id="pn-reset">清零积分</button><button class="btn warn sm" id="pn-disband">解散房间</button>' : '<button class="btn warn sm" id="pn-leave">离开</button>') +
      '</div>' +
      '</div>'
    ));
    // 大厅重构 第2块：小游戏区默认折叠成一行（点分区标题展开/收起），把首屏让给联机开局
    var miniSec = wrap.querySelector('.mini-sec');
    if (miniSec) {
      if (!self._miniOpen) miniSec.classList.add('collapsed');
      var mh = miniSec.querySelector('.mini-head');
      if (mh) mh.addEventListener('click', function () {
        self._miniOpen = !self._miniOpen;
        miniSec.classList.toggle('collapsed', !self._miniOpen);
      });
    }
    $('#pn-copy').addEventListener('click', function () { self.copyLink(); });
    $('#pn-share').addEventListener('click', function () { self.share(); });
    $('#pn-edit').addEventListener('click', function () { self.editProfile(); });
    var reset = $('#pn-reset'); if (reset) reset.addEventListener('click', function () { if (confirm('清零所有人积分？')) self.send({ t: 'resetScores' }); });
    var dis = $('#pn-disband'); if (dis) dis.addEventListener('click', function () { if (confirm('解散房间？所有人都要重进')) { self.room.leave(true); self.exitToLand(); } });
    var lv = $('#pn-leave'); if (lv) lv.addEventListener('click', function () { self.room.leave(false); self.exitToLand(); });
    wrap.querySelectorAll('.mini-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var m = (PN.Banks.mini() || []).filter(function (x) { return x.id === card.dataset.mini; })[0];
        if (m) self.openMini(m);
      });
    });
    var cards = wrap.querySelectorAll('.modecard');
    cards.forEach(function (card) {
      var mode = card.dataset.mode;
      card.querySelector('[data-act="cfg"]').addEventListener('click', function () {
        var cfg = $('#cfg-' + mode);
        self._cfgOpen[mode] = !self._cfgOpen[mode];
        if (cfg) cfg.classList.toggle('open', self._cfgOpen[mode]);
      });
      card.querySelector('[data-act="start"]').addEventListener('click', function () {
        // 切换版（第3块）：房里只有自己一个人时，有对应单机版的游戏直接开单机版（浮层），
        // 而不是抛一句“人数不够”把人挡住。没有对应单机版的仍走原来的提示。
        var online = (self.state && self.state.players ? self.state.players : []).filter(function (p) { return p.online; }).length;
        var soloId = online < 2 ? SOLO_FALLBACK[mode] : null;
        if (soloId) {
          var hit = (PN.Banks.mini() || []).filter(function (x) { return x.id === soloId; })[0];
          if (hit) {
            self.toast('一个人也能玩：给你开了单机版「' + hit.title + '」', 'good');
            self.openMini(hit);
            return;
          }
        }
        self.send({ t: 'start', mode: mode });
      });
      card.querySelectorAll('.cfg').forEach(function (ctl) {
        ctl.addEventListener('click', function () {
          var raw = ctl.dataset.val;
          var v;
          if (raw === 'true') v = true; else if (raw === 'false') v = false; else if (!isNaN(Number(raw))) v = Number(raw); else v = raw;
          var values = {};
          values[ctl.dataset.key] = v;
          self.send({ t: 'settings', mode: mode, values: values }); // 必须带上模式：设置存在 settings[模式] 下
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
    if (mode === 'cube') {
      rows.push(seg('局数', 'rounds', [[1, '1 个'], [2, '2 个'], [3, '3 个']]));
    } else     if (mode === 'tile2048') {
      rows.push(seg('局数', 'rounds', [[1, '1 局'], [2, '2 局'], [3, '3 局']]));
    } else if (mode === 'domino') {
      rows.push(seg('局数', 'rounds', [[1, '1 局'], [3, '3 局'], [5, '5 局']]));
    } else if (mode === 'soko') {
      rows.push(seg('关卡数', 'levels', [[3, '3 关'], [5, '5 关'], [10, '10 关全通']]));
    } else if (mode === 'mine') {
      rows.push(seg('难度', 'level', [[1, '9×9 · 10 雷'], [2, '12×12 · 24 雷'], [3, '15×15 · 40 雷']]));
      rows.push(seg('团队命数', 'lives', [[1, '1 条'], [3, '3 条'], [5, '5 条']]));
    } else if (mode === 'hop') {
      rows.push(seg('轮数', 'rounds', [[1, '1 轮'], [2, '2 轮'], [3, '3 轮'], [5, '5 轮']]));
      rows.push(seg('每人命数', 'lives', [[1, '1 条命'], [3, '3 条命'], [5, '5 条命']]));
    } else if (mode === 'gomoku') {
      rows.push(seg('棋盘', 'size', [[9, '9×9 快棋'], [13, '13×13'], [15, '15×15 标准']]));
    } else if (mode === 'codraw') {
      rows.push(seg('题数', 'rounds', [[2, '2 题'], [3, '3 题'], [4, '4 题']]));
      rows.push(seg('每题作画', 'sec', [[45, '45 秒'], [60, '60 秒'], [90, '90 秒']]));
    } else if (mode === 'memory') {
      rows.push(seg('对数', 'pairs', [[4, '4 对'], [6, '6 对'], [8, '8 对']]));
    } else if (mode === 'tacit') {
      rows.push(seg('题目数量', 'rounds', [[6, '6'], [8, '8'], [10, '10'], [12, '12']]));
    } else if (mode === 'drawgame') {
      rows.push(seg('总回合', 'rounds', [[3, '3'], [6, '6'], [9, '9']]));
      rows.push(seg('画画时长', 'drawSec', [[60, '60s'], [90, '90s'], [120, '120s']]));
    }
    return rows.join('');
  };

  UI.prototype.editProfile = function () {
    var self = this;
    // 必须挂在 #pn-root 外面：render() 会 root.innerHTML='' ，挂里面的话
    // 任何人进房/改设置都会把弹窗连同你正在输入的昵称一起抹掉。
    document.body.appendChild(this.h(
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
