/* ===== 你画我猜 屏幕 ===== */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};
  var esc = PN.esc;
  var local = { round: -1, segments: [], style: { color: '#222222', w: 6 }, canvas: null, ctx: null, raf: 0, painter: false };

  var COLORS = ['#222222', '#ff4d4d', '#ff9f43', '#2fbf71', '#3f8cff', '#9b59ff'];
  var WIDTHS = [4, 8, 16];

  function ensureCanvas(ui, painter) {
    if (local.canvas) return local.canvas;
    var c = ui.el('canvas');
    local.canvas = c;
    local.ctx = c.getContext('2d');
    local.painter = painter;
    return c;
  }
  function sizeCanvas(ui) {
    if (!local.canvas) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = local.canvas.getBoundingClientRect();
    if (rect.width < 10) rect = { width: 340, height: 340 };
    local.canvas.width = Math.round(rect.width * dpr);
    local.canvas.height = Math.round(rect.height * dpr);
    local.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function white() {
    var c = local.ctx, cv = local.canvas;
    if (!c) return;
    var rect = cv.getBoundingClientRect();
    c.clearRect(0, 0, rect.width || 340, rect.height || 340);
  }
  function drawSeg(seg) {
    var c = local.ctx, cv = local.canvas;
    if (!c || !cv) return;
    var rect = cv.getBoundingClientRect();
    var W = rect.width || 340, H = rect.height || 340;
    var pts = seg.s || [];
    if (!pts.length) return;
    c.strokeStyle = seg.color || '#222222';
    c.lineWidth = seg.w || 6;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var x = pts[i][0] / 1000 * W, y = pts[i][1] / 1000 * H;
      if (pts[i][2] === 0 || i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  }
  function redrawAll() {
    white();
    for (var i = 0; i < local.segments.length; i++) drawSeg(local.segments[i]);
  }
  function resetRound(round) {
    if (local.round !== round) {
      local.round = round;
      local.segments = [];
      local.painter = false;
      local.canvas = null;
      local.ctx = null;
    }
  }

  PN.screens = PN.screens || {};
  PN.screens.drawgame = {
    name: 'drawgame',
    render: function (state, secret) {
      var ui = this;
      var C = PN.gameCommon;
      var g = state.g || {};
      var cur = g.cur || {};
      var wrap = ui.el('div');
      ui.renderTopbar(wrap);
      wrap.appendChild(ui.h(C.gameHeader(ui, state, '🎨 你画我猜', cur.phase === 'pick' ? '画家选词' : (cur.phase === 'draw' ? '画画时间' : (cur.phase === 'reveal' ? '答案揭晓' : '本局结束')),
        cur.deadline ? C.deadlineChip(cur.deadline) : '<span class="pill">' + (g.round || 0) + '/' + (g.settings_rounds || 6) + '</span>')));

      if (g.done || !cur.phase) {
        wrap.appendChild(ui.h(C.scoreboard(state, g.winner, '🏆 灵魂画手大赛结束')));
        wrap.appendChild(ui.h(C.overButtons(ui, 'drawgame')));
        wrap.appendChild(ui.renderGameFooter());
        wrap.querySelectorAll('[data-over]').forEach(function (b) {
          b.addEventListener('click', function () { ui.send({ t: b.getAttribute('data-over') }); });
        });
        return wrap;
      }

      var painter = cur.painter;
      var iAmPainter = painter === ui.pid();
      var pName = '';
      if (state.players) for (var i = 0; i < state.players.length; i++) if (state.players[i].id === painter) pName = state.players[i].name;
      resetRound(g.round);

      if (cur.phase === 'pick') {
        if (iAmPainter && secret && secret.words) {
          var cards = secret.words.map(function (w, idx) {
            return '<button class="btn primary" data-word="' + idx + '" style="font-size:22px;padding:16px">' + esc(w) + '</button>';
          }).join('');
          wrap.appendChild(ui.h('<div class="card center"><div class="pill">你是画家 🎨</div>' +
            '<div class="muted mt8">选一个你要画的词（' + (secret.drawSec || 90) + ' 秒）：</div>' +
            '<div class="grid2 mt16">' + cards + '</div></div>'));
          wrap.querySelectorAll('[data-word]').forEach(function (b) {
            b.addEventListener('click', function () { ui.send({ t: 'pick', i: Number(b.getAttribute('data-word')) }); });
          });
        } else {
          wrap.appendChild(ui.h('<div class="card center"><div class="bigword">🎨</div><div class="muted">画家 <b>' + esc(pName) + '</b> 正在选词…</div></div>'));
        }
        wrap.appendChild(ui.renderGameFooter());
        return wrap;
      }

      var drawArea = ui.el('div', 'drawwrap');
      var c = ensureCanvas(ui, iAmPainter);
      drawArea.appendChild(c);
      sizeCanvas(ui);
      redrawAll();
      wrap.appendChild(drawArea);

      if (iAmPainter && cur.phase === 'draw') {
        var tray = ui.el('div', 'dtray');
        COLORS.forEach(function (col) {
          var s = ui.el('button', 'swatch' + (local.style.color === col ? ' sel' : ''));
          s.style.background = col;
          s.addEventListener('click', function () {
            local.style.color = col;
            ui.send({ t: 'style', color: col, w: local.style.w });
            tray.querySelectorAll('.swatch').forEach(function (x) { x.classList.remove('sel'); });
            s.classList.add('sel');
          });
          tray.appendChild(s);
        });
        var clearBtn = ui.el('button', 'btn warn sm', '🧽 清空');
        clearBtn.addEventListener('click', function () {
          local.segments = [];
          redrawAll();
          ui.send({ t: 'clear' });
        });
        var widthRow = ui.el('div', 'row');
        WIDTHS.forEach(function (w) {
          var b = ui.el('button', 'btn sm ' + (local.style.w === w ? 'primary' : 'ghost'), '●');
          b.style.fontSize = (w / 2 + 8) + 'px';
          b.addEventListener('click', function () {
            local.style.w = w;
            ui.send({ t: 'style', color: local.style.color, w: w });
          });
          widthRow.appendChild(b);
        });
        wrap.appendChild(ui.el('div', 'row mt8'));
        tray.appendChild(clearBtn);
        tray.appendChild(widthRow);
        wrap.appendChild(tray);
        bindPaint(ui);
      } else if (cur.phase === 'draw') {
        wrap.appendChild(ui.h('<div class="card center"><div class="muted">画家 <b>' + esc(pName) + '</b> 正在作画… 在下面输入你的答案！</div></div>'));
        var bar = ui.el('div', 'inputbar');
        var input = ui.el('input');
        input.placeholder = '我猜是……';
        input.maxLength = 30;
        var btn = ui.el('button', 'btn primary', '猜！');
        var go = function () {
          var v = input.value.trim();
          if (!v) return;
          ui.send({ t: 'guess', text: v });
          input.value = '';
          ui.toast('已提交：' + v);
        };
        btn.addEventListener('click', go);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
        bar.appendChild(input); bar.appendChild(btn);
        wrap.appendChild(bar);
      }

      if (cur.phase === 'reveal') {
        wrap.appendChild(ui.h('<div class="muted center mt8">答案公布，马上进入下一回合…</div>'));
      }
      wrap.appendChild(ui.renderGameFooter());
      return wrap;
    },
    onPrivate: function (obj) {
      var ui = this;
      if (obj && obj.obj && obj.obj.replay && obj.obj.replay.length) {
        resetRound(obj.obj.round);
        local.segments = obj.obj.replay.slice();
        if (local.canvas && local.ctx) redrawAll();
      }
    },
    onPeer: function (msg, from) {
      var ui = this;
      if (!msg) return;
      if (msg.t === 'clear') { local.segments = []; redrawAll(); return; }
      if (msg.t === 'style') { local.style.color = msg.color || local.style.color; local.style.w = msg.w || local.style.w; return; }
      if (msg.t === 'stroke') {
        var seg = { color: msg.color || local.style.color, w: msg.w || local.style.w, s: msg.s };
        local.segments.push(seg);
        if (local.ctx) drawSeg(seg);
      }
    }
  };

  var pending = [];
  var lastSent = 0;
  function bindPaint(ui) {
    var c = local.canvas;
    if (!c || c.dataset.paint) return;
    c.dataset.paint = '1';
    var toNorm = function (e) {
      var rect = c.getBoundingClientRect();
      var x = Math.max(0, Math.min(1000, Math.round((e.clientX - rect.left) / rect.width * 1000)));
      var y = Math.max(0, Math.min(1000, Math.round((e.clientY - rect.top) / rect.height * 1000)));
      return [x, y];
    };
    var flush = function () {
      if (!pending.length) return;
      var pts = pending;
      pending = [];
      var seg = { color: local.style.color, w: local.style.w, s: pts };
      local.segments.push(seg);
      ui.send({ t: 'peer', msg: { t: 'stroke', color: seg.color, w: seg.w, s: pts } });
    };
    var down = function (e) {
      c.setPointerCapture && c.setPointerCapture(e.pointerId);
      pending = [toNorm(e).concat([0])];
      lastSent = Date.now();
    };
    var move = function (e) {
      if (!pending.length) return;
      pending.push(toNorm(e).concat([1]));
      if (pending.length > 80 || Date.now() - lastSent > 70) {
        var pts = pending; pending = [];
        var seg = { color: local.style.color, w: local.style.w, s: pts };
        local.segments.push(seg);
        if (local.ctx) drawSeg(seg);
        ui.send({ t: 'peer', msg: { t: 'stroke', color: seg.color, w: seg.w, s: pts } });
        lastSent = Date.now();
      }
    };
    var up = function () {
      if (pending.length) { pending.push(pending[pending.length - 1].slice(0, 2).concat([2])); flush(); }
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
