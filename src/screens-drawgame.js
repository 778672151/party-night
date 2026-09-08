/* ===== 你画我猜 屏幕：画布 + 聊天记录（流程参考 skribbl.io / gartic.io） ===== */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};
  var esc = PN.esc;

  var COLORS = ['#222222', '#8e9aaf', '#ffffff', '#ff4d4d', '#ff9f43', '#ffd93d', '#2fbf71', '#3f8cff', '#9b59ff', '#b5651d', '#ff7bbd'];
  var WIDTHS = [4, 9, 18];
  var HUES = ['#6ea8ff', '#ff8fb1', '#7ee0a1', '#ffc266', '#c39bff', '#5fd3e0', '#ff9f43', '#9ee37d'];
  var MASK = '＿';

  var local = {
    startedAt: 0, mode: '', strokes: [], byId: {}, curId: null, sent: 0, seq: 0,
    style: { color: COLORS[0], w: WIDTHS[1] },
    canvas: null, ctx: null, w: 0, h: 0, dpr: 1,
    ro: null, hintTimer: 0, lastFlush: 0,
    draft: '', hadFocus: false, logAtBottom: true, myWord: ''
  };

  /* ---------------- 小工具 ---------------- */
  function hueOf(id) {
    var n = 0, s = String(id || '');
    for (var i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
    return HUES[n % HUES.length];
  }
  function clampPt(x, y) {
    return [Math.max(0, Math.min(1000, Math.round(x))), Math.max(0, Math.min(1000, Math.round(y)))];
  }
  function toNorm(cv, e) {
    var r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return [0, 0];
    return clampPt((e.clientX - r.left) / r.width * 1000, (e.clientY - r.top) / r.height * 1000);
  }
  function maskHtml(g, cur) {
    var len = cur.wordLen || 0;
    var hint = cur.hint || {};
    var out = [];
    for (var i = 0; i < len; i++) {
      out.push(hint[i] ? '<span class="w">' + esc(hint[i]) + '</span>' : '<span class="u">' + MASK + '</span>');
    }
    return out.join(' ');
  }

  /* ---------------- 画布 ---------------- */
  function resetIfNewGame(g) {
    var stamp = (g && g.startedAt) || 0;
    if (stamp !== local.startedAt || (g && g.round) < local.round) {
      local.startedAt = stamp;
      local.strokes = [];
      local.byId = {};
      local.curId = null;
      local.myWord = '';
      local.canvas = null;
      local.ctx = null;
      local.w = local.h = 0;
    }
    local.round = (g && g.round) || 0;
  }
  function ensureCanvas(ui) {
    if (local.canvas) return local.canvas;
    var c = ui.el('canvas');
    local.canvas = c;
    local.ctx = c.getContext('2d');
    return c;
  }
  /** 关键修复：只在画布已经进入文档、量得到真实尺寸时才设置后备缓冲区 */
  function sizeCanvas() {
    var cv = local.canvas;
    if (!cv || !local.ctx) return;
    var r = cv.getBoundingClientRect();
    if (!r.width || !r.height || r.width < 20) return; // 没挂载/不可见 → 保持原样，别写坏
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    var W = Math.max(1, Math.round(r.width * dpr));
    var H = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== W || cv.height !== H || local.dpr !== dpr) {
      local.dpr = dpr;
      cv.width = W; cv.height = H;
      local.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      local.w = r.width; local.h = r.height;
      redrawAll();
    }
  }
  function clearCanvas() {
    if (local.ctx && local.w) local.ctx.clearRect(0, 0, local.w, local.h);
  }
  function styleCtx(c, st) {
    c.strokeStyle = st.color;
    c.fillStyle = st.color;
    c.lineWidth = st.w;
    c.lineCap = 'round';
    c.lineJoin = 'round';
  }
  /** 整条笔画重绘（中点二次贝塞尔平滑） */
  function paintStroke(st) {
    var c = local.ctx, pts = st.pts, n = pts.length;
    if (!c || !n || !local.w) return;
    var W = local.w, H = local.h;
    styleCtx(c, st);
    if (n === 1) {
      c.beginPath();
      c.arc(pts[0][0] / 1000 * W, pts[0][1] / 1000 * H, Math.max(1, st.w / 2), 0, 6.2832);
      c.fill();
      return;
    }
    c.beginPath();
    c.moveTo(pts[0][0] / 1000 * W, pts[0][1] / 1000 * H);
    for (var i = 1; i < n - 1; i++) {
      var ax = pts[i][0] / 1000 * W, ay = pts[i][1] / 1000 * H;
      var bx = pts[i + 1][0] / 1000 * W, by = pts[i + 1][1] / 1000 * H;
      c.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
    }
    c.lineTo(pts[n - 1][0] / 1000 * W, pts[n - 1][1] / 1000 * H);
    c.stroke();
  }
  /** 只画新增的一小段（实时跟手，不必整条重绘） */
  function paintTail(st, from) {
    var c = local.ctx, pts = st.pts, n = pts.length;
    if (!c || n < 2 || !local.w) return;
    var W = local.w, H = local.h;
    styleCtx(c, st);
    var start = Math.max(0, from - 1);
    c.beginPath();
    c.moveTo(pts[start][0] / 1000 * W, pts[start][1] / 1000 * H);
    for (var i = start + 1; i < n; i++) c.lineTo(pts[i][0] / 1000 * W, pts[i][1] / 1000 * H);
    c.stroke();
  }
  function redrawAll() {
    clearCanvas();
    for (var i = 0; i < local.strokes.length; i++) paintStroke(local.strokes[i]);
  }
  function addStroke(id, color, w) {
    var st = { id: id, color: color, w: w, pts: [] };
    local.byId[id] = st;
    local.strokes.push(st);
    return st;
  }
  function dropStroke(id) {
    delete local.byId[id];
    local.strokes = local.strokes.filter(function (s) { return s.id !== id; });
    redrawAll();
  }

  /* ---------------- 画笔交互 ---------------- */
  function bindPaint(ui) {
    var cv = local.canvas;
    if (!cv || cv.dataset.paint) return;
    cv.dataset.paint = '1';
    var drawing = false, lastPt = null;

    function flush(force) {
      var st = local.byId[local.curId];
      if (!st) return;
      var now = Date.now();
      if (!force && now - local.lastFlush < 55) return;
      if (local.sent >= st.pts.length) return;
      local.lastFlush = now;
      var chunk = st.pts.slice(local.sent);
      local.sent = st.pts.length;
      ui.send({ t: 'peer', msg: { t: 'stroke', id: st.id, color: st.color, w: st.w, s: chunk } });
    }

    function down(e) {
      if (!local.painter) return;
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return; // 只认左键
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      var p = toNorm(cv, e);
      var st = addStroke('k' + (++local.seq) + 'r' + local.round, local.style.color, local.style.w);
      st.pts.push(p);
      local.curId = st.id;
      local.sent = 0;
      local.lastFlush = Date.now();
      drawing = true;
      lastPt = p;
      paintStroke(st); // 单点先点出来
    }
    function move(e) {
      if (!drawing || !local.painter) return;
      e.preventDefault();
      var evts = null;
      try { if (e.getCoalescedEvents) evts = e.getCoalescedEvents(); } catch (err) {}
      if (!evts || !evts.length) evts = [e]; // 规范允许返回空列表；空 = 丢点，必须回退
      var st = local.byId[local.curId];
      if (!st) return;
      for (var i = 0; i < evts.length; i++) {
        var p = toNorm(cv, evts[i]);
        if (lastPt && p[0] === lastPt[0] && p[1] === lastPt[1]) continue;
        st.pts.push(p);
        lastPt = p;
      }
      paintTail(st, st.pts.length - evts.length);
      flush(false);
    }
    function up(e) {
      if (!drawing) return;
      drawing = false;
      e.preventDefault();
      var st = local.byId[local.curId];
      if (st) {
        var r = cv.getBoundingClientRect();
        if (st.pts.length === 1 && r.width) {
          // 单击点：补一个极近的点，避免只有一个孤点
          st.pts.push([st.pts[0][0], st.pts[0][1]]);
          paintStroke(st);
        }
        flush(true);
      }
      local.curId = null;
    }
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', function (e) { if (drawing) up(e); });
    cv.addEventListener('contextmenu', function (e) { if (local.painter) e.preventDefault(); });
  }

  /* ---------------- 聊天记录 ---------------- */
  function chatHtml(g) {
    var list = (g && g.chat) || [];
    var out = '';
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.k === 'sys') out += '<div class="dg-msg sys">' + esc(m.text) + '</div>';
      else out += '<div class="dg-msg ' + esc(m.k || 'msg') + '"><span class="who" style="color:' + hueOf(m.id) + '">' + esc(m.name || '') + '</span>' + esc(m.text || '') + '</div>';
    }
    return out;
  }

  /* ---------------- 屏幕 ---------------- */
  PN.screens = PN.screens || {};
  PN.screens.drawgame = {
    name: 'drawgame',
    wide: true,

    /** 重绘前抢救输入草稿 + 滚动位置（否则每来一条消息就丢焦点） */
    beforeRender: function () {
      var inp = document.querySelector('.dg-input input');
      if (inp) {
        local.draft = inp.value;
        local.hadFocus = document.activeElement === inp;
      }
      var log = document.querySelector('.dg-log');
      if (log) local.logAtBottom = (log.scrollTop + log.clientHeight) >= (log.scrollHeight - 24);
    },

    /** 挂载后：此时才有真实尺寸 → 定缓冲区、绑画笔、恢复输入框 */
    mounted: function () {
      sizeCanvas();
      bindPaint(this);
      var cv = local.canvas;
      if (cv && root.ResizeObserver) {
        if (local.ro) local.ro.disconnect();
        local.ro = new root.ResizeObserver(function () { sizeCanvas(); });
        local.ro.observe(cv.parentNode || cv);
      }
      var log = document.querySelector('.dg-log');
      if (log && local.logAtBottom) log.scrollTop = log.scrollHeight;
      var inp = document.querySelector('.dg-input input');
      if (inp && !inp.disabled) {
        if (local.draft) inp.value = local.draft;
        if (local.hadFocus) {
          inp.focus();
          try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) {}
        }
      }
      var hintEl = document.querySelector('[data-hint]');
      if (hintEl) hintEl.textContent = hintEl.getAttribute('data-hint');
    },

    render: function (state, secret) {
      var ui = this;
      var C = PN.gameCommon;
      var g = state.g || {};
      var cur = g.cur || {};
      var me = ui.pid();
      var wrap = ui.el('div');
      ui.renderTopbar(wrap);
      resetIfNewGame(g);

      var phase = cur.phase;
      var label = phase === 'pick' ? '画家选词' : (phase === 'draw' ? '画画时间' : (phase === 'reveal' ? '答案揭晓' : '本局结束'));
      wrap.appendChild(ui.h(C.gameHeader(ui, state, '🎨 你画我猜', label,
        cur.deadline ? C.deadlineChip(cur.deadline) : '<span class="pill">第 ' + (g.round || 0) + '/' + ((state.settings.drawgame || {}).rounds || 6) + ' 回合</span>')));

      if (g.done || !phase) {
        wrap.appendChild(ui.h(C.scoreboard(state, g.winner, '🏆 灵魂画手大赛结束')));
        wrap.appendChild(ui.h(C.overButtons(ui, 'drawgame')));
        wrap.appendChild(ui.renderGameFooter());
        wrap.querySelectorAll('[data-over]').forEach(function (b) {
          b.addEventListener('click', function () { ui.send({ t: b.getAttribute('data-over') }); });
        });
        return wrap;
      }

      var painter = cur.painter;
      var iAmPainter = painter === me;
      var pName = '';
      if (state.players) for (var i = 0; i < state.players.length; i++) if (state.players[i].id === painter) pName = state.players[i].name;

      /* ---------- 选词阶段 ---------- */
      if (phase === 'pick') {
        if (iAmPainter && secret && secret.words) {
          var cards = secret.words.map(function (w, idx) {
            return '<button class="btn primary" data-word="' + idx + '" style="font-size:22px;padding:16px">' + esc(w) + '</button>';
          }).join('');
          wrap.appendChild(ui.h('<div class="card center"><div class="pill">你是画家 🎨</div>' +
            '<div class="muted mt8">选一个你要画的词（' + (secret.drawSec || 90) + ' 秒）：</div>' +
            '<div class="grid2 mt16">' + cards + '</div></div>'));
          wrap.querySelectorAll('[data-word]').forEach(function (b) {
            b.addEventListener('click', function () {
              local.myWord = b.textContent;
              ui.send({ t: 'pick', i: Number(b.getAttribute('data-word')) });
            });
          });
        } else {
          wrap.appendChild(ui.h('<div class="card center"><div class="bigword">🎨</div><div class="muted">画家 <b>' + esc(pName) + '</b> 正在选词…</div></div>'));
        }
        wrap.appendChild(ui.renderGameFooter());
        return wrap;
      }

      /* ---------- 画布 + 聊天 双栏 ---------- */
      var dg = ui.el('div', 'dg');
      var main = ui.el('div', 'dg-main');

      var hintRow = ui.el('div', 'dg-hint');
      if (phase === 'reveal') {
        hintRow.innerHTML = '<span class="tag">答案</span><span class="w">' + esc(cur.reveal || local.myWord || '??') + '</span>';
      } else if (iAmPainter) {
        var w = local.myWord || (secret && secret.answer) || '??';
        hintRow.innerHTML = '<span class="tag">你要画</span><span class="w">' + esc(w) + '</span>';
      } else {
        hintRow.innerHTML = '<span class="tag">' + (cur.wordLen || 0) + ' 个字</span><span data-hint="' + esc(maskHtml(g, cur)) + '">' + maskHtml(g, cur) + '</span>';
      }
      main.appendChild(hintRow);

      var stage = ui.el('div', 'dg-stage' + (iAmPainter && phase === 'draw' ? '' : ' locked'));
      var c = ensureCanvas(ui);
      stage.appendChild(c);
      main.appendChild(stage);
      sizeCanvas();
      redrawAll();

      /* ---------- 画家工具条 ---------- */
      if (iAmPainter && phase === 'draw') {
        local.painter = true;
        var tools = ui.el('div', 'dg-tools');
        COLORS.forEach(function (col, idx) {
          var s = ui.el('button', 'swatch' + (idx === 2 ? ' eraser' : '') + (local.style.color === col ? ' sel' : ''));
          if (idx !== 2) s.style.background = col;
          s.title = idx === 2 ? '橡皮' : col;
          s.addEventListener('click', function () {
            local.style.color = col;
            tools.querySelectorAll('.swatch').forEach(function (x) { x.classList.remove('sel'); });
            s.classList.add('sel');
          });
          tools.appendChild(s);
        });
        tools.appendChild(ui.el('span', 'sep'));
        WIDTHS.forEach(function (wd) {
          var b = ui.el('button', 'btn ghost sizew' + (local.style.w === wd ? ' primary' : ''));
          var dot = ui.el('i');
          dot.style.width = dot.style.height = Math.max(4, wd) + 'px';
          b.appendChild(dot);
          b.addEventListener('click', function () {
            local.style.w = wd;
            tools.querySelectorAll('.sizew').forEach(function (x) { x.classList.remove('primary'); });
            b.classList.add('primary');
          });
          tools.appendChild(b);
        });
        tools.appendChild(ui.el('span', 'sep'));
        var undo = ui.el('button', 'btn ghost sm', '↩️ 撤销');
        undo.addEventListener('click', function () {
          var last = local.strokes[local.strokes.length - 1];
          if (!last) return;
          dropStroke(last.id);
          ui.send({ t: 'peer', msg: { t: 'undo', id: last.id } });
        });
        var clr = ui.el('button', 'btn warn sm', '🧽 清空');
        clr.addEventListener('click', function () {
          local.strokes = []; local.byId = {}; local.curId = null;
          redrawAll();
          ui.send({ t: 'peer', msg: { t: 'clear' } });
        });
        tools.appendChild(undo);
        tools.appendChild(clr);
        main.appendChild(tools);
      } else {
        local.painter = false;
      }
      dg.appendChild(main);

      /* ---------- 右侧聊天 ---------- */
      var side = ui.el('div', 'dg-side');
      var log = ui.el('div', 'dg-log');
      log.innerHTML = chatHtml(g);
      side.appendChild(log);

      var bar = ui.el('div', 'dg-input');
      var input = ui.el('input');
      var guessed = !!(cur.guessed && cur.guessed[me]);
      var canGuess = phase === 'draw' && !iAmPainter && !guessed;
      input.type = 'text';
      input.maxLength = 30;
      input.autocomplete = 'off';
      input.setAttribute('enterkeyhint', 'send');
      input.placeholder = iAmPainter ? '你在画画，不能猜词' : (guessed ? '你已猜中 🎉 等下一轮' : (phase === 'draw' ? '输入你的答案…' : '本轮已结束'));
      input.disabled = !canGuess;
      var btn = ui.el('button', 'btn primary', '发送');
      btn.disabled = !canGuess;
      var go = function () {
        var v = input.value.trim();
        if (!v) return;
        ui.send({ t: 'guess', text: v });
        input.value = '';
        local.draft = '';
      };
      btn.addEventListener('click', go);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      bar.appendChild(input);
      bar.appendChild(btn);
      side.appendChild(bar);
      dg.appendChild(side);

      wrap.appendChild(dg);
      wrap.appendChild(ui.renderGameFooter());
      return wrap;
    },

    /* ---------- 别人画的笔画 ---------- */
    onPeer: function (msg) {
      if (!msg) return;
      if (msg.t === 'clear') {
        local.strokes = []; local.byId = {}; local.curId = null;
        redrawAll();
        return;
      }
      if (msg.t === 'undo') { dropStroke(msg.id); return; }
      if (msg.t !== 'stroke' || !msg.s || !msg.s.length) return;
      var st = local.byId[msg.id];
      var isNew = !st;
      if (isNew) st = addStroke(msg.id, msg.color, msg.w);
      var from = st.pts.length;
      st.pts = st.pts.concat(msg.s);
      if (local.w) { if (isNew) paintStroke(st); else paintTail(st, from + 1); }
    },

    /* ---------- 私密消息：自己的词 / 回放 ---------- */
    onPrivate: function (obj) {
      if (!obj) return;
      if (obj.answer) local.myWord = obj.answer;
      if (obj.replay && obj.replay.length) {
        local.strokes = []; local.byId = {}; local.curId = null;
        for (var i = 0; i < obj.replay.length; i++) {
          var ch = obj.replay[i];
          if (!ch || !ch.s) continue;
          var st = local.byId[ch.id];
          if (!st) st = addStroke(ch.id, ch.color, ch.w);
          st.pts = st.pts.concat(ch.s);
        }
        redrawAll();
      }
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
