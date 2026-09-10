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
    ro: null, hintTimer: 0, lastFlush: 0, painting: false, rect: null,
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
  /** 缓存画布矩形：每个 pointermove 都 getBoundingClientRect 会强制整页重排（聊天区变长时明显卡顿） */
  function measureRect(cv) {
    var r = cv.getBoundingClientRect();
    local.rect = (r && r.width && r.height) ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
    return local.rect;
  }
  function toNorm(cv, e) {
    var r = local.rect || measureRect(cv);
    if (!r) return [0, 0];
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
    var round = (g && g.round) || 0;
    // 换轮必须清空！startedAt 只在开局写一次，只靠它判断会漏掉每一次换轮：
    // 画布带着上一轮的画继续用，另一端回放/新画的笔画又对不上，看起来就是「没清 + 显示错」。
    if (stamp !== local.startedAt || round !== local.round) {
      local.startedAt = stamp;
      local.round = round;
      local.strokes = [];
      local.byId = {};
      local.curId = null;
      local.myWord = '';
      local.canvas = null;
      local.ctx = null;
      local.w = local.h = 0;
      local.rect = null;
      local.painting = false;
      local.sent = 0;
      local.seq = 0;
    }
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
    local.rect = { left: r.left, top: r.top, width: r.width, height: r.height }; // 顺手刷新矩形缓存
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    var W = Math.max(1, Math.round(r.width * dpr));
    var H = Math.max(1, Math.round(r.height * dpr));
    if (cv.width === W && cv.height === H && local.dpr === dpr && local.w === r.width && local.h === r.height) return;
    local.dpr = dpr;
    local.w = r.width; local.h = r.height;
    if (cv.width !== W || cv.height !== H) { // 赋 width/height 会清空画布并重置变换，所以只在真的变了时动
      cv.width = W; cv.height = H;
      local.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    redrawAll();
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
  /** 能画的只有「从 0 开始连续」的那一段。
   *  接收端是按 i0 落位的，缺号时 pts 中间会有洞 —— 拿洞里的 undefined 去画会抛异常，
   *  整笔就断在那里（这就是「补发了却还是画不全」的原因）。 */
  function denseLen(st) {
    var have = (st.have === undefined) ? st.pts.length : st.have;
    return Math.max(0, Math.min(have, st.pts.length));
  }
  /** 整条笔画重绘（中点二次贝塞尔平滑） */
  function paintStroke(st) {
    var c = local.ctx, pts = st.pts, n = denseLen(st);
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
    var c = local.ctx, pts = st.pts, n = denseLen(st);
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
  function addStroke(id, color, w, r) {
    var st = { id: id, color: color, w: w, r: r === undefined ? local.round : r, pts: [] };
    local.byId[id] = st;
    local.strokes.push(st);
    return st;
  }
  /** 兜底：任何一条墨迹到达时顺手检查别的笔是否还带着洞（例如「最后一块」正好丢了），
   *  有就再要一次补发。每笔最多要 6 次、400ms 冷却，不会打风暴。 */
  function sweepHoles(ui) {
    var now = Date.now();
    for (var id in local.byId) {
      if (!Object.prototype.hasOwnProperty.call(local.byId, id)) continue;
      var s = local.byId[id];
      if (!s || !s.pts || !s.owner) continue;
      var hole = -1;
      for (var q = (s.have || 0); q < s.pts.length; q++) if (s.pts[q] === undefined) { hole = q; break; }
      if (hole < 0) continue;
      if ((s.askTries || 0) >= 12) continue; // 补发本身也会丢，多要几次；上限防止打风暴
      if (s.askAt && now - s.askAt < 400) continue;
      s.askAt = now;
      s.askTries = (s.askTries || 0) + 1;
      if (ui.room && ui.room.askInk) ui.room.askInk(s.owner, id, s.have || 0);
    }
  }

  function dropStroke(id) {
    delete local.byId[id];
    local.strokes = local.strokes.filter(function (s) { return s.id !== id; });
    redrawAll();
  }

  /* ---------------- 画笔交互 ---------------- */
  /* 周期性自愈：公共 broker 是 QoS0，补发包本身也可能丢。
     只要还有笔带着洞，就隔一会儿再要一次补发 —— 否则「最后一块」丢了以后没人再触发，洞会永远留着。 */
  if (typeof setInterval === 'function') {
    setInterval(function () {
      if (!local.ui || !local.byId) return;
      for (var id in local.byId) {
        if (!Object.prototype.hasOwnProperty.call(local.byId, id)) continue;
        var s = local.byId[id];
        if (!s || !s.pts || !s.owner || !s.pts.length) continue;
        for (var q = (s.have || 0); q < s.pts.length; q++) {
          if (s.pts[q] === undefined) { sweepHoles(local.ui); return; }
        }
      }
    }, 1200);
  }

  function bindPaint(ui) {
    local.ui = ui;
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
      var i0 = local.sent; // 本块第一个点在整笔中的下标：对端据此落位、发现缺号
      var chunk = st.pts.slice(i0);
      local.sent = st.pts.length;
      ui.sendInk({ t: 'stroke', id: st.id, r: st.r, color: st.color, w: st.w, i0: i0, s: chunk });
    }

    function down(e) {
      if (!local.painter) return;
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return; // 只认左键
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      measureRect(cv); // 每笔开头量一次就够，中途不再触发布局
      local.painting = true; // 落笔期间冻结 DOM 重建：否则画布被拆 → 指针捕获丢失 → 断笔
      var p = toNorm(cv, e);
      var st = addStroke('k' + (++local.seq) + 'r' + local.round, local.style.color, local.style.w, local.round);
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
      local.painting = false;
      if (e && e.preventDefault) e.preventDefault();
      var st = local.byId[local.curId];
      if (st) {
        var r = local.rect || measureRect(cv);
        if (st.pts.length === 1 && r) {
          // 单击点：补一个极近的点，避免只有一个孤点
          st.pts.push([st.pts[0][0], st.pts[0][1]]);
          paintStroke(st);
        }
        flush(true);
      }
      local.curId = null;
      // 落笔期间被 deferRender 跳过的状态更新，现在补上（挪出事件回调，别在派发中途改 DOM）
      if (ui._renderPending) setTimeout(function () { ui.flushRender(); }, 0);
    }
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    // 拖到画布外：只要还持有指针捕获就继续画（越界坐标会被 clamp 在画布内），别把笔画截断
    cv.addEventListener('pointerleave', function (e) {
      if (!drawing) return;
      var held = typeof cv.hasPointerCapture === 'function' && cv.hasPointerCapture(e.pointerId);
      if (!held) up(e);
    });
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

    /** 落笔期间冻结 DOM 重建（见 ui.js deferRender 注释）：保住画布的指针捕获，笔画才不会中途断 */
    deferRender: function () { return !!local.painting; },

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
      // 曾经这里把 data-hint 属性（转义过的 <span> 源码）塞回 textContent，
      // 猜词者屏幕上就会显示 '<span class="u">＿</span>' 这种源码，而且每揭一个字跟着变一次。
      // innerHTML 已经渲染好了，不需要再补一刀。
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
        PN.wireOver(wrap, ui);
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
      // 这里只量尺寸就够了：画布节点是复用的，位图还在，无需每次状态消息都整幅重绘
      // （笔画最多 900 段，聊天每来一条就全量重绘会明显卡）。真需要重绘时 sizeCanvas() 会自己做。
      sizeCanvas();

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
          ui.sendInk({ t: 'undo', id: last.id, r: local.round });
        });
        var clr = ui.el('button', 'btn warn sm', '🧽 清空');
        clr.addEventListener('click', function () {
          local.strokes = []; local.byId = {}; local.curId = null;
          redrawAll();
          ui.sendInk({ t: 'clear', r: local.round });
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
      input.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (e.isComposing || e.keyCode === 229) return; // 输入法回车=确认候选词，不能当提交
    e.preventDefault(); go();
  });
      bar.appendChild(input);
      bar.appendChild(btn);
      side.appendChild(bar);
      dg.appendChild(side);

      wrap.appendChild(dg);
      wrap.appendChild(ui.renderGameFooter());
      return wrap;
    },

    /* ---------- 别人画的笔画 ---------- */
    onPeer: function (msg, from) {
      var ui = this; // ui.js 用 .call(ui) 调进来，和 onPrivate/onRecover 一样
      if (!msg) return;
      // 上一轮的残尾（落笔正好跨过换轮时 flush 出来的）不能画到新画布上
      if (msg.r && local.round && msg.r !== local.round) return;
      if (msg.t === 'clear') {
        local.strokes = []; local.byId = {}; local.curId = null;
        redrawAll();
        return;
      }
      if (msg.t === 'undo') { dropStroke(msg.id); return; }
      if (msg.t !== 'stroke' || !msg.s || !msg.s.length) return;

      var st = local.byId[msg.id];
      if (!st) { st = addStroke(msg.id, msg.color, msg.w, msg.r); st.pts = []; st.have = 0; st.owner = from; }
      var prevHave = st.have || 0;
      // 按 i0 落位：缺哪几个点一目了然；补发的块晚到、乱序到也不会把笔画写歪
      var res = PN.Wire.place(st.pts, prevHave, msg);
      st.have = res.have;
      if (res.have > prevHave) st.askTries = 0; // 补上了，计数归零
      sweepHoles(ui);
      if (res.gap) {
        // 中间断了：先向发送者要补发，别把断开的那段画出来
        var now = Date.now();
        if (!st.askAt || now - st.askAt > 400) {
          st.askAt = now;
          st.askTries = (st.askTries || 0) + 1;
          if (ui.room && ui.room.askInk) ui.room.askInk(from, msg.id, res.gap[0]);
        }
        return;
      }
      if (!local.w) return;
      if (res.have === prevHave && msg.i0 + msg.s.length <= prevHave) return; // 重复/迟到的补发，不必重画
      if (st.pts.length === 1) paintStroke(st);                       // 只有一个点：画成圆点
      else if (msg.i0 === prevHave && !msg.re) paintTail(st, msg.i0); // 正好接上：只画新增的一小段
      else paintStroke(st);                                          // 补齐了空洞：整笔重画，保证连续
    },

    /* ---------- 房主迁移：新房主问我要词，把手里那份报回去 ---------- */
    onRecover: function () {
      var ui = this;
      var s = (ui.secrets.drawgame && ui.secrets.drawgame.mine) || {};
      var answer = s.answer || local.myWord || null;
      if (answer || (s.words && s.words.length)) {
        ui.send({ t: 'repaint', answer: answer, words: s.words || null });
      }
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
          if (!st) { st = addStroke(ch.id, ch.color, ch.w, ch.r); st.pts = []; }
          // 按 i0 落位：房主存的块可能是补发补进去的、顺序不保证，按位合并才稳
          for (var k = 0; k < ch.s.length; k++) st.pts[(ch.i0 || 0) + k] = ch.s[k];
        }
        for (var j = 0; j < local.strokes.length; j++) {
          var s2 = local.strokes[j];
          var dense = [];                      // 稀疏数组要压紧，画布只认连续点
          for (var q = 0; q < s2.pts.length; q++) if (s2.pts[q] !== undefined) dense.push(s2.pts[q]);
          s2.pts = dense;
        }
        redrawAll();
      }
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
