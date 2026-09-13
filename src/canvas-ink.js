/* ===== 可复用画布：一块画布上的「画 / 发 / 收 / 补洞 / 重绘」 =====
 *
 * 这是从你画我猜屏幕里抽出来的通用部分：坐标归一化(0..1000)、按 55ms 分块发送并带 i0、
 * 接收按位落位、缺号向发送者要补发、只画「从 0 开始连续」的那一段。
 *
 * 为什么单独抽出来：新游戏《心有灵犀》要**两块画布同时画**（一人一块、揭晓前互不显示），
 * 而 drawgame 那条路里塞满了线上修出来的细节，不适合为它改造。
 * 于是这里做一份干净、带测试的通用实现给新游戏用；drawgame 保持原样不动。
 *
 * 关键约定（和 drawgame 一致，别改）：
 *  - 坐标一律 /1000 归一化后存取，画的时候再乘回画布尺寸 —— 两端尺寸不同也不会画歪；
 *  - 收到的点按 i0 写进稀疏数组，pts 中间可能有洞，画之前只取连续前缀（denseLen）；
 *  - 笔迹按「作者」分块存（board = 发送者 id），所以一个人一块画布互不串。 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  function clampPt(x, y) {
    if (x < 0) x = 0; else if (x > 1000) x = 1000;
    if (y < 0) y = 0; else if (y > 1000) y = 1000;
    return [x, y];
  }
  function measureRect(cv) {
    var r = cv.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  /** 只有「从 0 开始连续」的那一段能画：稀疏数组里的 undefined 会让 path 抛异常/断笔 */
  function denseLen(st) {
    var have = (st.have === undefined) ? st.pts.length : st.have;
    return Math.max(0, Math.min(have, st.pts.length));
  }

  function create(opts) {
    opts = opts || {};
    var ui = opts.ui;
    var stores = {};        // board -> { strokes: [], byId: {} }
    var views = [];         // { cv, ctx, board, dpr, w, h, rect }
    var style = { color: opts.color || '#6b5588', w: opts.w || 4 };
    var writable = opts.writable !== false;
    var seq = 0;
    var lastAsk = 0;

    function store(board) {
      var s = stores[board];
      if (!s) s = stores[board] = { strokes: [], byId: {} };
      return s;
    }
    function curRound() { return typeof opts.round === 'function' ? opts.round() : (opts.round || 0); }
    function myId() { return (ui && ui.pid) ? ui.pid() : null; }

    /* ---------------- 绘制 ---------------- */
    function styleCtx(c, st) {
      c.strokeStyle = st.color; c.fillStyle = st.color; c.lineWidth = st.w;
      c.lineCap = 'round'; c.lineJoin = 'round';
    }
    function ensureSize(v) {
      var r = v.cv.getBoundingClientRect();
      if (!r.width || !r.height || r.width < 20) return false;   // 还没挂载/不可见 → 别写坏
      v.rect = { left: r.left, top: r.top, width: r.width, height: r.height };
      var dpr = Math.min(root.devicePixelRatio || 1, 2);
      var W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
      if (v.cv.width !== W || v.cv.height !== H) {   // 赋 width/height 会清空画布，只在真变了时动
        v.cv.width = W; v.cv.height = H;
        v.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      v.dpr = dpr; v.w = r.width; v.h = r.height;
      return true;
    }
    function paintInto(v, st) {
      var pts = st.pts, n = denseLen(st);
      if (!n || !v.w) return;
      var W = v.w, H = v.h, c = v.ctx;
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
    function paintTailInto(v, st, from) {
      var pts = st.pts, n = denseLen(st);
      if (n < 2 || !v.w) return;
      var W = v.w, H = v.h, c = v.ctx;
      styleCtx(c, st);
      var start = Math.max(0, (from || 0) - 1);
      c.beginPath();
      c.moveTo(pts[start][0] / 1000 * W, pts[start][1] / 1000 * H);
      for (var i = start + 1; i < n; i++) c.lineTo(pts[i][0] / 1000 * W, pts[i][1] / 1000 * H);
      c.stroke();
    }
    function redrawView(v) {
      if (!ensureSize(v)) return;
      v.ctx.clearRect(0, 0, v.w, v.h);
      var list = store(v.board).strokes;
      for (var i = 0; i < list.length; i++) paintInto(v, list[i]);
    }
    function redraw() { for (var i = 0; i < views.length; i++) redrawView(views[i]); }

    /* ---------------- 接收 ---------------- */
    function placeInto(board, msg, from) {
      var s = store(board);
      var st = s.byId[msg.id];
      if (!st) {
        st = { id: msg.id, color: msg.color, w: msg.w, r: msg.r, pts: [], have: 0, owner: from };
        s.byId[msg.id] = st; s.strokes.push(st);
      }
      var res = PN.Wire.place(st.pts, st.have || 0, msg);
      st.have = res.have;
      return { st: st, res: res };
    }
    /** 收到一笔（对端或自己）。自己的笔迹由本地绘制负责，这里只入库，避免重复画。 */
    function onInk(msg, from) {
      if (!msg || msg.t !== 'stroke' || !msg.s || !msg.s.length) return null;
      var mine = (from === myId());
      if (!mine) {
        // 上一轮的残尾（换轮瞬间 flush 出来的）不要画到这一轮
        if (msg.r && curRound() && msg.r !== curRound()) return null;
      }
      var rec = placeInto(from, msg, from);
      for (var i = 0; i < views.length; i++) {
        var v = views[i];
        if (v.board !== from) continue;
        if (!ensureSize(v)) continue;
        if (mine) paintTailInto(v, rec.st, rec.res.first);   // 一般走不到：本地已画
        else redrawView(v);                                   // 对端：只在显示了这块画布时才画
      }
      return rec;
    }
    /** 缺号自愈：发现某笔里有洞就向作者要一次补发（每笔最多 12 次，400ms 冷却） */
    function sweep() {
      if (!ui || !ui.room || !ui.room.askInk) return 0;
      var now = Date.now(), asked = 0;
      if (now - lastAsk < 400) return 0;
      for (var board in stores) {
        if (!Object.prototype.hasOwnProperty.call(stores, board)) continue;
        var list = stores[board].strokes;
        for (var i = 0; i < list.length; i++) {
          var s = list[i];
          if (!s || !s.pts || !s.pts.length) continue;
          var hole = -1;
          for (var q = (s.have || 0); q < s.pts.length; q++) if (s.pts[q] === undefined) { hole = q; break; }
          if (hole < 0) continue;
          if ((s.askTries || 0) >= 12) continue;
          s.askTries = (s.askTries || 0) + 1;
          lastAsk = now;
          ui.room.askInk(board, s.id, s.have || 0);
          asked++;
          break;   // 一次只要一笔，下一轮再要别的
        }
        if (asked) break;
      }
      return asked;
    }

    /* ---------------- 发送 ---------------- */
    function bindSend(cv, board) {
      var drawing = false, curId = null, sent = 0, lastFlush = 0, rect = null, lastPt = null;
      function flush(force) {
        var st = store(board).byId[curId];
        if (!st) return;
        var now = Date.now();
        if (!force && now - lastFlush < 55) return;
        if (sent >= st.pts.length) return;
        lastFlush = now;
        var i0 = sent;
        var chunk = st.pts.slice(i0);
        sent = st.pts.length;
        // 打包/补发缓冲都在 room.sendInk 里做（它记得最近 4 笔），这里只构造语义消息
        if (ui && ui.sendInk) ui.sendInk({ t: 'stroke', id: st.id, r: st.r, color: st.color, w: st.w, i0: i0, s: chunk });
      }
      function down(e) {
        if (!writable) return;
        if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;   // 只认左键
        e.preventDefault();
        try { cv.setPointerCapture(e.pointerId); } catch (err) {}
        rect = measureRect(cv);
        drawing = true;
        var p = clampPt((e.clientX - rect.left) / rect.width * 1000, (e.clientY - rect.top) / rect.height * 1000);
        var id = 'c' + (++seq) + 'r' + curRound();
        var s = store(board);
        var st = { id: id, color: style.color, w: style.w, r: curRound(), pts: [p], have: 1, owner: myId() };
        s.byId[id] = st; s.strokes.push(st);
        curId = id; sent = 0; lastFlush = Date.now(); lastPt = p;
        for (var i = 0; i < views.length; i++) if (views[i].board === board) { ensureSize(views[i]); paintInto(views[i], st); }
      }
      function move(e) {
        if (!drawing || !writable) return;
        e.preventDefault();
        var evts = null;
        try { if (e.getCoalescedEvents) evts = e.getCoalescedEvents(); } catch (err) {}
        if (!evts || !evts.length) evts = [e];   // 规范允许返回空列表；空 = 丢点，必须回退
        var st = store(board).byId[curId];
        if (!st) return;
        for (var i = 0; i < evts.length; i++) {
          var p = clampPt((evts[i].clientX - rect.left) / rect.width * 1000, (evts[i].clientY - rect.top) / rect.height * 1000);
          if (lastPt && p[0] === lastPt[0] && p[1] === lastPt[1]) continue;
          st.pts.push(p); lastPt = p;
        }
        st.have = st.pts.length;
        for (var j = 0; j < views.length; j++) if (views[j].board === board) paintTailInto(views[j], st, st.pts.length - evts.length);
        flush(false);
      }
      function up(e) {
        if (!drawing) return;
        drawing = false;
        if (e && e.preventDefault) e.preventDefault();
        var st = store(board).byId[curId];
        if (st) {
          if (st.pts.length === 1 && rect) {         // 单击点：补一个极近的点，别只留一个孤点
            st.pts.push([st.pts[0][0], st.pts[0][1]]);
            st.have = st.pts.length;
            for (var i = 0; i < views.length; i++) if (views[i].board === board) paintInto(views[i], st);
          }
          flush(true);
        }
        curId = null;
      }
      cv.addEventListener('pointerdown', down);
      cv.addEventListener('pointermove', move);
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', up);
      cv.addEventListener('pointerleave', function (e) {
        if (!drawing) return;
        var held = typeof cv.hasPointerCapture === 'function' && cv.hasPointerCapture(e.pointerId);
        if (!held) up(e);   // 拖到画布外：只要还持有捕获就继续画，别把笔画截断
      });
      cv.addEventListener('contextmenu', function (e) { if (writable) e.preventDefault(); });
      return { flush: function () { flush(true); } };
    }

    /* ---------------- 对外接口 ---------------- */
    return {
      bindSend: bindSend,
      addView: function (cv, board) {
        var v = { cv: cv, ctx: cv.getContext('2d'), board: board };
        views.push(v);
        redrawView(v);
        return v;
      },
      removeView: function (cv) {
        for (var i = views.length - 1; i >= 0; i--) if (views[i].cv === cv) views.splice(i, 1);
      },
      clearViews: function () { views = []; },
      onInk: onInk,
      sweep: sweep,
      redraw: redraw,
      /** 用回放替换某块画布（刷新/中途加入）。segments: [{id,i0,r,color,w,s}] */
      replay: function (board, segments) {
        var s = store(board);
        s.strokes = []; s.byId = {};
        if (!segments || !segments.length) { redraw(); return false; }
        for (var i = 0; i < segments.length; i++) {
          var ch = segments[i];
          if (!ch || !ch.s) continue;
          var st = s.byId[ch.id];
          if (!st) { st = { id: ch.id, color: ch.color, w: ch.w, r: ch.r, pts: [], have: 0, owner: board }; s.byId[ch.id] = st; s.strokes.push(st); }
          for (var k = 0; k < ch.s.length; k++) st.pts[(ch.i0 || 0) + k] = ch.s[k];
        }
        // 稀疏数组压紧：画布只认连续点（补发补进来的块顺序不保证）
        for (var j = 0; j < s.strokes.length; j++) {
          var t = s.strokes[j], dense = [];
          for (var q = 0; q < t.pts.length; q++) if (t.pts[q] !== undefined) dense.push(t.pts[q]);
          t.pts = dense; t.have = dense.length;
        }
        redraw();
        return true;
      },
      strokes: function (board) { return store(board).strokes; },
      hasInk: function (board) {
        var l = store(board).strokes;
        for (var i = 0; i < l.length; i++) if (l[i].pts && l[i].pts.length) return true;
        return false;
      },
      count: function (board) { return store(board).strokes.length; },
      reset: function () { stores = {}; views.forEach(function (v) { if (ensureSize(v)) v.ctx.clearRect(0, 0, v.w, v.h); }); },
      setWritable: function (b) { writable = !!b; },
      isWritable: function () { return writable; },
      setStyle: function (c, w) { if (c) style.color = c; if (w) style.w = w; }
    };
  }

  PN.Ink = { create: create, denseLen: denseLen };
})(typeof globalThis !== 'undefined' ? globalThis : this);
