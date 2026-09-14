/* ===== 跳一跳 屏幕 =====
 * 画风按阶段二的整合方案：不用原作那套 2.5D 立方体 + 深色主题，
 * 改成我们的马卡龙奶油色 + 圆角贴纸 + 弹性动画（颜色常量集中在 C 里，与 style.css 的 :root 对应）。
 * 飞行弧线用 fly.at 时间戳在本地插值，所以一次跳跃只发一条消息。 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};
  var esc = PN.esc;

  var C = {                     // 与 src/style.css 的 :root 一一对应（canvas 里用不了 CSS 变量）
    bg: '#fff4f9', bg2: '#ffe9f3', card: '#ffffff', card2: '#fff7fb',
    ink: '#4b3a63', ink2: '#a08cb8', line: '#ffd7e8', stroke: '#6b5588',
    acc: '#ff8fb8', acc2: '#8ad7ff', good: '#5fd6a8', bad: '#ff8fa3',
    blue: '#8ad7ff', yellow: '#ffd86b', purple: '#c9a7ff'
  };
  var BLOCK_COLORS = ['#ffd7e8', '#ffe1c6', '#d9f2e6', '#dbe9ff', '#efe0ff', '#fff0c9'];
  var local = { cv: null, ui: null, cam: 0, lastT: 0, squash: 0, puffs: [] };

  function ensure(cv) {
    var r = cv.getBoundingClientRect();
    if (!r.width || r.width < 40) return null;
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    var W = Math.floor(r.width), H = Math.floor(r.width * 0.62);   // 侧视宽高比
    if (cv.width !== Math.floor(W * dpr) || cv.height !== Math.floor(H * dpr)) {
      cv.width = Math.floor(W * dpr); cv.height = Math.floor(H * dpr);
    }
    cv.style.height = H + 'px';
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, W: W, H: H, scale: W / 4.6, groundY: H * 0.70 };
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /** 当前这一次跳跃在本地插值出的位置（用 fly.at 对时，两端算出来的弧线一致） */
  function playerPos(g, m) {
    var G = PN.games.hop._rules;
    var at = g.attempt, plat = G.makeTrack(g.seed);
    var idx = at.idx, base = plat[Math.min(idx, plat.length - 1)];
    var x = base.x, y = 0, spin = 0, flying = 0;
    var fly = at.fly;
    if (fly) {
      var prog = (Date.now() - fly.at) / 460;                 // 飞行 460ms
      if (prog >= 1) prog = 1;
      flying = prog < 1 ? 1 : 0;
      var d = G.distOf(fly.power);
      var p0 = plat[fly.from] || base;
      var fromX = p0.x, toX = fromX + d;
      x = fromX + (toX - fromX) * prog;
      var peak = 1.25 + 0.75 * fly.power;
      y = -Math.sin(Math.PI * prog) * peak;                    // 抛物线（侧视够用）
      spin = prog * Math.PI * 2 * (fly.kind === 'fall' ? 2.2 : 1);
      if (fly.kind === 'fall' && prog >= 1) y = 0.6;           // 掉下去停在下方
    }
    return { x: x, y: y, spin: spin, flying: flying, idx: idx, base: base, plat: plat };
  }

  function draw(cv, g, ui) {
    var m = ensure(cv);
    if (!m) return;
    var ctx = m.ctx, W = m.W, H = m.H, sc = m.scale, GY = m.groundY;
    var G = PN.games.hop._rules;
    var at = g.attempt;
    var plat = G.makeTrack(g.seed);
    var pos = playerPos(g, m);

    // 背景：奶油天 + 远山 + 地面带（治愈系留白，但不再是空粉色）
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, C.bg); bg.addColorStop(0.62, C.bg2); bg.addColorStop(1, '#ffdfee');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath(); ctx.ellipse(W * 0.72, H * 0.24, 36, 21, 0, 0, 6.29); ctx.fill();
    ctx.beginPath(); ctx.ellipse(W * 0.30, H * 0.16, 23, 13, 0, 0, 6.29); ctx.fill();
    ctx.beginPath(); ctx.ellipse(W * 0.86, H * 0.38, 18, 10, 0, 0, 6.29); ctx.fill();
    // 远处的小山丘（跟着镜头慢慢移，制造纵深）
    var far = -local.cam * sc * 0.25;
    ctx.fillStyle = 'rgba(201,167,255,.28)';
    ctx.beginPath(); ctx.moveTo(far - 80, GY + 26);
    ctx.quadraticCurveTo(far + 60, GY - 46, far + 200, GY + 26); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(138,215,255,.30)';
    ctx.beginPath(); ctx.moveTo(far + 150, GY + 26);
    ctx.quadraticCurveTo(far + 280, GY - 70, far + 430, GY + 26); ctx.closePath(); ctx.fill();
    // 地面带
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.fillRect(0, GY + 26, W, H - GY - 26);

    // 镜头：让当前方块稳定在偏左位置（平滑跟）
    var want = pos.base.x - 0.9;
    local.cam += (want - local.cam) * 0.14;
    var sx = function (wx) { return (wx - local.cam) * sc; };

    // 方块
    for (var i = 0; i < plat.length; i++) {
      var b = plat[i];
      var bx = sx(b.x), bw = b.w * sc;
      if (bx + bw < -60 || bx - bw > W + 60) continue;
      var top = GY + Math.sin(i * 1.7) * 3;                    // 轻微高低差
      var col = BLOCK_COLORS[i % BLOCK_COLORS.length];
      var bh = 24;                                             // 块加高一点，像小台子而不是薄片
      // 影子
      ctx.fillStyle = 'rgba(107,85,136,.12)';
      roundRect(ctx, bx - bw / 2 + 3, top + 6, bw, bh, 8); ctx.fill();
      // 块体
      ctx.fillStyle = col;
      roundRect(ctx, bx - bw / 2, top, bw, bh, 8); ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(107,85,136,.38)'; ctx.stroke();
      // 上表面亮一点，做出"台阶"的厚度感
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      roundRect(ctx, bx - bw / 2 + 3, top + 3, bw - 6, 6, 3); ctx.fill();
      // 完美落点提示（小小的靶心点，帮你瞄准）
      ctx.beginPath(); ctx.arc(bx, top + 7, 2.4, 0, 6.29);
      ctx.fillStyle = 'rgba(107,85,136,.35)'; ctx.fill();
    }

    // 玩家：圆角小方块 + 表情（Q 弹靠挤压/拉伸），脚正好踩在当前块顶面上
    var curTop = GY + Math.sin(pos.idx * 1.7) * 3;
    var px = sx(pos.x), py = curTop - 30 + pos.y * sc * 0.42;
    var sq = local.squash;
    var flying = pos.flying;
    var w0 = 30, h0 = 30;
    var wS = w0 * (1 + sq * 0.22) * (flying ? 0.9 : 1);
    var hS = h0 * (1 - sq * 0.26) * (flying ? 1.12 : 1);
    ctx.save();
    ctx.translate(px, py + h0);
    ctx.rotate(pos.spin * 0.5);
    ctx.fillStyle = 'rgba(107,85,136,.14)';
    ctx.beginPath(); ctx.ellipse(0, 2, wS * 0.5, 4, 0, 0, 6.29); ctx.fill();
    var gr = ctx.createLinearGradient(0, -hS, 0, 0);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, C.acc);
    ctx.fillStyle = gr;
    roundRect(ctx, -wS / 2, -hS, wS, hS, wS * 0.34); ctx.fill();
    ctx.lineWidth = 2.6; ctx.strokeStyle = C.stroke; ctx.stroke();
    // 眼睛 + 腮红
    ctx.fillStyle = C.ink;
    ctx.beginPath(); ctx.arc(-wS * 0.17, -hS * 0.62, 2.1, 0, 6.29); ctx.fill();
    ctx.beginPath(); ctx.arc(wS * 0.17, -hS * 0.62, 2.1, 0, 6.29); ctx.fill();
    ctx.fillStyle = 'rgba(255,143,184,.5)';
    ctx.beginPath(); ctx.arc(-wS * 0.32, -hS * 0.45, 2.6, 0, 6.29); ctx.fill();
    ctx.beginPath(); ctx.arc(wS * 0.32, -hS * 0.45, 2.6, 0, 6.29); ctx.fill();
    ctx.restore();

    // 完美落点的星星
    local.puffs = local.puffs.filter(function (p) { return Date.now() - p.t < 700; });
    local.puffs.forEach(function (p) {
      var k = (Date.now() - p.t) / 700;
      ctx.beginPath(); ctx.arc(sx(p.x), GY - 20 - k * 40, 3 + k * 10, 0, 6.29);
      ctx.strokeStyle = 'rgba(255,143,184,' + (0.8 * (1 - k)) + ')';
      ctx.lineWidth = 2.5; ctx.stroke();
    });

    // 蓄力条（屏幕左下）：本地按住时立刻动，对手按住时也能看到
    var charging = at.charging, power = 0;
    if (charging) {
      if (isMine(ui)) power = myPower(g);
      else power = Math.max(0, Math.min(1, Number(g.power) || 0));
    }
    var bw2 = Math.min(W * 0.62, 260), bh = 14, bx2 = (W - bw2) / 2, by2 = H - 26;
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    roundRect(ctx, bx2, by2, bw2, bh, bh / 2); ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = C.stroke; ctx.stroke();
    if (power > 0 || charging) {
      var fill = ctx.createLinearGradient(bx2, 0, bx2 + bw2, 0);
      fill.addColorStop(0, C.acc2); fill.addColorStop(0.6, C.yellow); fill.addColorStop(1, C.acc);
      ctx.fillStyle = fill;
      roundRect(ctx, bx2 + 2, by2 + 2, Math.max(6, (bw2 - 4) * power), bh - 4, (bh - 4) / 2); ctx.fill();
    }
    ctx.fillStyle = C.ink2; ctx.font = '700 11px -apple-system,system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(charging ? '松手起跳！' : '按住蓄力', W / 2, by2 - 7);
    ctx.textAlign = 'left';
  }

  function isMine(ui) {
    var s = ui.state;
    if (!s || !s.g || !s.g.attempt) return false;
    return s.g.attempt.pid === ui.pid();
  }
  function myPower(g) {
    if (!g.attempt || !g.attempt.charging) return 0;
    var hold = Date.now() - chargeStartAt;
    return Math.max(0, Math.min(1, hold / PN.games.hop._rules.MAX_HOLD));
  }
  var chargeStartAt = 0, powerTimer = 0, sentAt = 0;

  function doCharge(ui) {
    if (!isMine(ui)) return;
    var g = ui.state.g;
    if (g.attempt.fly || g.attempt.ended || g.attempt.lives <= 0) return;
    chargeStartAt = Date.now();
    ui.send({ t: 'charge' });
    clearInterval(powerTimer);
    powerTimer = setInterval(function () {                 // 8Hz 上报蓄力进度（只给对手看）
      if (!isMine(ui) || !ui.state.g.attempt.charging) { clearInterval(powerTimer); return; }
      var p = myPower(ui.state.g);
      var now = Date.now();
      if (now - sentAt < 120) return;
      sentAt = now;
      ui.send({ t: 'power', p: Math.round(p * 100) / 100 });
    }, 120);
  }
  function doRelease(ui) {
    clearInterval(powerTimer);
    if (chargeStartAt && isMine(ui)) {
      var hold = Date.now() - chargeStartAt;
      chargeStartAt = 0;
      ui.send({ t: 'release', hold: hold });
    }
  }

  function bind(ui, cv) {
    local.ui = ui; local.cv = cv;
    if (cv.__hopBound) return;
    cv.__hopBound = true;
    var down = function (e) { if (e && e.cancelable) e.preventDefault(); doCharge(ui); };
    var up = function () { doRelease(ui); };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', up);
    var key = function (e) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (document.activeElement && /input|textarea/i.test(document.activeElement.tagName || '')) return;
      e.preventDefault();
      if (e.type === 'keydown') { if (!e.repeat) doCharge(ui); } else doRelease(ui);
    };
    document.addEventListener('keydown', key);
    document.addEventListener('keyup', key);
  }

  /* 一个全局动画循环：负责挤压回弹、飞行插值、镜头平滑（都不重建 DOM） */
  function loop() {
    var ui = local.ui, cv = local.cv;
    if (ui && cv && document.body.contains(cv) && ui.state && ui.state.g && ui.state.g.attempt) {
      var g = ui.state.g;
      var p = 0;
      if (g.attempt.charging) p = (g.attempt.pid === ui.pid()) ? myPower(g) : (Number(g.power) || 0);
      local.squash += (Math.min(p, 1) - local.squash) * 0.25;
      draw(cv, g, ui);
      if (g.attempt.last === 'perfect' && g.attempt.fly && Date.now() - g.attempt.fly.at < 60) {
        if (!local.puffs.some(function (x) { return x.at === g.attempt.fly.at; })) {
          local.puffs.push({ at: g.attempt.fly.at, t: Date.now(), x: playerPos(g).x });
        }
      }
    }
    root.requestAnimationFrame(loop);
  }
  if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(loop);

  /** DOM 真正关心的字段签名：蓄力进度/飞行状态不进签名（那些由画布自己每帧画） */
  function domSig(state) {
    var g = state.g || {}, a = g.attempt || {};
    return JSON.stringify([state.mode, state.phase, g.round, g.rounds, g.phase, g.turnIdx, g.totals,
      a.pid, a.lives, a.score, a.combo, a.idx, a.ended]);
  }

  PN.screens = PN.screens || {};
  PN.screens.hop = {
    name: 'hop',
    /** 只变了蓄力进度 → 不重建 DOM（画布每帧自己重绘），彻底消掉蓄力时的整屏重建 */
    patch: function (state) {
      var sig = domSig(state);
      if (this.__hopSig === sig) return true;
      this.__hopSig = sig;
      return false;
    },
    render: function (state, secret) {
      var ui = this;
      var GC = PN.gameCommon;
      var g = state.g || {};
      var me = ui.pid();
      var at = g.attempt || {};
      var mine = at.pid === me;
      var opp = (g.players || []).filter(function (id) { return id !== me; })[0];
      var oppP = opp ? ui.p(opp) : null;
      var wrap = ui.el('div');
      ui.renderTopbar(wrap);
      wrap.appendChild(ui.h(GC.gameHeader(ui, state, '🐰 跳一跳',
        '第 ' + g.round + '/' + g.rounds + ' 轮',
        '<span class="pill">' + (mine ? '轮到你' : '等对方') + '</span>')));

      var body = ui.el('div');
      if (g.phase === 'over') {
        var mineTotal = (g.totals && g.totals[me]) || 0;
        var oppTotal = opp ? ((g.totals && g.totals[opp]) || 0) : 0;
        var title = '平局～';
        if (mineTotal > oppTotal) title = '你赢了！🎉';
        else if (oppTotal > mineTotal) title = (oppP ? oppP.name : '对方') + ' 赢了';
        body.appendChild(ui.h('<div class="card center hop-hero"><div class="hop-result">' + esc(title) + '</div>' +
          '<div class="muted mt8">我 ' + mineTotal + ' 分 · ' + (oppP ? oppP.name : '对方') + ' ' + oppTotal + ' 分</div></div>'));
        body.appendChild(ui.h(GC.scoreboard(state, undefined, '🏆 总积分')));
        var btns = ui.h(GC.overButtons(ui, 'hop'));
        body.appendChild(btns);
        PN.wireOver(btns, ui);
      } else {
        var turn = ui.el('div', 'hop-turn' + (mine ? ' mine' : ''));
        turn.innerHTML = mine
          ? '<b>🙋 轮到你了</b><span>按住屏幕（或空格）蓄力，松手起跳</span>'
          : '<b>👀 ' + esc(oppP ? oppP.name : '对方') + ' 的回合</b><span>看着点儿，马上到你</span>';
        body.appendChild(turn);

        var hud = ui.el('div', 'hop-hud');
        hud.innerHTML =
          '<span class="hop-stat"><i>❤️</i>' + (at.lives || 0) + '</span>' +
          '<span class="hop-stat"><i>⭐</i>' + (at.score || 0) + '</span>' +
          '<span class="hop-stat' + ((at.combo || 0) >= 2 ? ' hot' : '') + '"><i>🔥</i>' + (at.combo || 0) + ' 连</span>' +
          '<span class="hop-stat"><i>📊</i>我 ' + ((g.totals && g.totals[me]) || 0) +
          ' · ' + (oppP ? esc(oppP.name) : '对方') + ' ' + (opp ? ((g.totals && g.totals[opp]) || 0) : 0) + '</span>';
        body.appendChild(hud);

        var stage = ui.el('div', 'hop-stage');
        // 复用同一个 canvas 节点：整屏重建时把它挪过来，rAF 循环不会丢目标（配合 ui 的 patch 钩子）
        var cv = local.cv || (local.cv = ui.el('canvas', 'hop-cv'));
        stage.appendChild(cv);
        body.appendChild(stage);
        body.appendChild(ui.h('<div class="muted center mt8">完美落在方块中心会连击：+2 → +4 → +6 → +8 → +10</div>'));

        if (mine) {
          var ops = ui.el('div', 'hop-ops');
          var hold = ui.el('button', 'btn primary', '🙌 按住蓄力 / 松手起跳');
          hold.setAttribute('data-hold', '1');
          var gv = ui.el('button', 'btn ghost sm', '🙈 提前收工');
          gv.setAttribute('data-giveup', '1');
          gv.addEventListener('click', function () { ui.send({ t: 'giveup' }); });
          ops.appendChild(hold); ops.appendChild(gv);
          body.appendChild(ops);
          // 大按钮按住也能跳（手机上更顺手）
          var hp = function (e) { if (e.cancelable) e.preventDefault(); doCharge(ui); };
          hold.addEventListener('pointerdown', hp);
          hold.addEventListener('pointerup', function () { doRelease(ui); });
          hold.addEventListener('pointercancel', function () { doRelease(ui); });
          hold.addEventListener('click', function (e) { e.preventDefault(); });
        }

        setTimeout(function () {
          var cur = ui.state && ui.state.g;
          if (!cur) return;
          local.cam = (playerPos(cur).base.x) - 0.9;   // 首帧别从 0 滑过去
          draw(cv, cur, ui);
          bind(ui, cv);
        }, 0);
      }
      wrap.appendChild(body);
      if (state.phase !== 'over') wrap.appendChild(ui.renderGameFooter());
      return wrap;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
