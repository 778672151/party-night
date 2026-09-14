/* ===== 鲸鱼推箱子 屏幕（三渲二 / flat-isometric cel）=====
 *
 * 用 PN.Toon 画：等距立体草地 + 三段色阶的积木（花丛墙）、木箱/贝壳、会呼吸眨眼的鲸鱼。
 * 动画：走位补间 + 落地下压回弹 + 推动水花 + 目标点脉冲 + 过关礼花 + 镜头跟随/开场拉近。
 * 动画状态全部是**本地推导**的（对比 state 变化），所以 wire 上不多传一个字节。
 * DOM 部分（HUD/十字键/回合横幅）仍是 CSS 马卡龙风，canvas 只负责场景。 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};
  var T = PN.Toon;
  var esc = PN.esc;

  /* 场景的本地动画状态（每局一份，跟随 state.g 的重置而重置） */
  var S = {
    ready: false, t: 0,
    whale: { x: 0, z: 0, tx: 0, tz: 0, t0: 0, from: null, dur: 0.17, hop: 0, squash: 0, vel: 0, blink: 0, nextBlink: 2.4 },
    pushAt: 0, pushCell: -1, pop: {},
    fx: [], texts: [], clearAt: 0, intro: 0, camX: 0, camZ: 0, shake: 0,
    prev: null, stats: { walls: 0, floors: 0, goals: 0, crates: 0, onGoal: 0, whale: 0 },
    clouds: null, sawClear: -1
  };

  function cellOf(g, i) { return { x: i % g.cols, z: Math.floor(i / g.cols) }; }
  function idxOf(g, x, z) { return z * g.cols + x; }
  function seedClouds() {
    var out = [];
    for (var i = 0; i < 6; i++) out.push({ x: Math.random(), y: 0.08 + Math.random() * 0.3, s: 0.6 + Math.random() * 0.9, v: 0.004 + Math.random() * 0.008 });
    return out;
  }

  /* 把 state 的变化翻译成动画（不做多余的网络消息） */
  function syncAnim(g, dt) {
    if (!S.prev || S.prev.gid !== g.levelId) {          // 换关：重置场景 + 开场拉近
      S.prev = { gid: g.levelId, whale: g.whale, boxes: g.boxes.slice(), last: g.last };
      var w = cellOf(g, g.whale);
      S.whale.x = w.x; S.whale.z = w.z; S.whale.tx = w.x; S.whale.tz = w.z; S.whale.from = null;
      S.intro = 1; S.pop = {}; S.fx.length = 0; S.texts.length = 0;
      S.camX = w.x; S.camZ = w.z;
      return;
    }
    var p = S.prev;
    if (p.whale !== g.whale) {                          // 走位：补间 + 弹一下
      var a = cellOf(g, p.whale), b = cellOf(g, g.whale);
      S.whale.from = { x: a.x, z: a.z };
      S.whale.tx = b.x; S.whale.tz = b.z; S.whale.t0 = S.t; S.whale.hop = 1;
      var c = T.project(b.x, 0, b.z, camOf(g));
      if (g.last && g.last.kind === 'push') {
        S.shake = 0.5;
        T.burst(S.fx, c, 10, T.PAL.water2 || '#a9d8ff', { speed: 70, lift: 60, r: 3.2, life: 620 });
        T.ring(c, 10, '#9fd4ff', 0.9, 3);
      } else {
        T.burst(S.fx, c, 4, '#ffffff', { speed: 42, lift: 30, r: 2.4, life: 420, grav: 120 });
      }
    }
    for (var i = 0; i < g.boxes.length; i++) {          // 箱子被推动 / 归位
      if (p.boxes[i] !== g.boxes[i] && g.boxes[i]) S.pop[i] = S.t;
    }
    if (g.last && g.last.kind === 'push' && g.last.i >= 0 && p.last !== g.last) {
      var ci = g.last.i;
      S.pop[ci] = S.t;
      var cc = T.project(ci % g.cols, 0.5, Math.floor(ci / g.cols), camOf(g));
      T.burst(S.fx, cc, 8, '#ffe6a8', { speed: 60, lift: 70, r: 2.6, life: 520 });
    }
    if (g.cleared !== p.cleared && g.cleared > p.cleared) {   // 过关庆祝
      S.clearAt = S.t;
      for (var k = 0; k < 3; k++) {
        T.burst(S.fx, { x: 0, y: 0 }, 0, '#fff');            // 占位，真正的礼花在 draw 里按屏幕坐标放
      }
      S.texts.push({ x: 0.5, y: 0.5, text: '+2', color: T.PAL.good, t: S.t, size: 30 });
    }
    if (g.li !== p.li) S.sawClear = S.t;
    S.prev = { gid: g.levelId, whale: g.whale, boxes: g.boxes.slice(), last: g.last, cleared: g.cleared, li: g.li };
  }

  function camOf(g, W, H) {
    var a = 0.866, b = 0.5;
    var unit = 30;
    if (W && H) {
      var ux = W / ((g.cols + g.rows) * a + 1.6);
      var uy = H / ((g.cols + g.rows) * b + 2.6);
      unit = Math.max(14, Math.min(38, Math.min(ux, uy)));
    }
    return { ox: 0, oy: 0, zoom: 1, a: a, b: b, unit: unit };
  }

  /* ---------- 场景绘制 ---------- */
  function draw(ctx, W, H, dt, ts) {
    var ui = S.ui, g = S.g;
    if (!ui || !g || !g.rows) return;
    S.t += dt;
    if (!S.ready) { S.ready = true; S.clouds = seedClouds(); S.prev = null; }
    syncAnim(g, dt);

    var cam = camOf(g, W, H);
    var a = cam.a, unit = cam.unit;
    // 镜头：跟随鲸鱼 + 开场拉近 + 推动抖动
    S.camX += (S.whale.tx - S.camX) * Math.min(1, dt * 6);
    S.camZ += (S.whale.tz - S.camZ) * Math.min(1, dt * 6);
    var followX = (S.camX - (g.cols - 1) / 2) * 0.55, followZ = (S.camZ - (g.rows - 1) / 2) * 0.55;
    var zoom = 1;
    if (S.intro > 0) { S.intro = Math.max(0, S.intro - dt * 0.9); zoom *= 0.72 + 0.28 * (1 - S.intro); }
    if (S.clearAt && S.t - S.clearAt < 0.9) zoom *= 1 + 0.06 * Math.sin((S.t - S.clearAt) * 12) * (1 - (S.t - S.clearAt) / 0.9);
    S.shake = Math.max(0, S.shake - dt * 3.2);
    var shx = S.shake ? Math.sin(S.t * 70) * 3 * S.shake : 0;
    var shy = S.shake ? Math.cos(S.t * 61) * 2.4 * S.shake : 0;
    cam.unit = unit * zoom;
    cam.ox = W / 2 - followX * a * cam.unit + shx;
    cam.oy = H * 0.42 - followZ * cam.b * cam.unit + shy;

    // 天空 + 太阳 + 云（视差）
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, T.PAL.bg); sky.addColorStop(0.6, T.PAL.bg2); sky.addColorStop(1, T.PAL.bg3);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    var sunX = W * 0.78, sunY = H * 0.16;
    var sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, W * 0.34);
    sg.addColorStop(0, 'rgba(255,236,180,.85)'); sg.addColorStop(1, 'rgba(255,236,180,0)');
    ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);
    S.clouds.forEach(function (c) {
      c.x += c.v * dt;
      if (c.x > 1.2) c.x = -0.2;
      var cx = (c.x - followX * 0.06) * W, cy = c.y * H, s = c.s * (unit / 26);
      ctx.save(); ctx.globalAlpha = 0.75; ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(cx, cy, 30 * s, 15 * s, 0, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - 18 * s, cy + 4 * s, 18 * s, 10 * s, 0, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 20 * s, cy + 3 * s, 20 * s, 11 * s, 0, 0, 6.2832); ctx.fill();
      ctx.restore();
    });

    // 草地底板（比棋盘大一圈，边缘厚度做出"浮空岛"）
    var cx0 = (g.cols - 1) / 2, cz0 = (g.rows - 1) / 2;
    T.plate(ctx, cam, cx0, cz0, g.cols + 0.9, g.rows + 0.9, 0.55, T.PAL.ground2, { y: 0, base: -0.55, lw: 2.6 });
    // 棋盘格草地
    for (var z = 0; z < g.rows; z++) {
      for (var x = 0; x < g.cols; x++) {
        if (g.walls[idxOf(g, x, z)]) continue;
        var dark = (x + z) % 2 === 0;
        T.tile(ctx, cam, x, 0, 0.98, 0.98, dark ? T.PAL.ground : '#eefaf3', { y: 0.001, color: dark ? T.PAL.ground : '#eefaf3', lw: 0 });
      }
    }
    // 目标点：荷叶 + 脉冲光环
    S.stats = { walls: 0, floors: 0, goals: 0, crates: 0, onGoal: 0, whale: 0 };
    for (var gi = 0; gi < g.goals.length; gi++) {
      if (!g.goals[gi]) continue;
      S.stats.goals++;
      var gc = cellOf(g, gi), gp = T.project(gc.x, 0, gc.z, cam);
      var pulse = 0.5 + 0.5 * Math.sin(S.t * 2.2 + gi);
      T.ring(ctx, gp, 9 + pulse * 4, T.PAL.acc, 0.35 + pulse * 0.35, 2.4);
      T.tile(ctx, cam, gc.x, 0, 0.62, 0.62, '#ffd9e9', { y: 0.004, color: '#ffd9e9', lw: 1.2 });
      T.ring(ctx, gp, 5.5, '#ffffff', 0.9, 2);
    }

    // 墙体 / 箱子 / 鲸鱼 一起做深度排序（等距必须按 x+z 从远到近画）
    var ents = [];
    for (var i = 0; i < g.walls.length; i++) {
      if (g.walls[i]) ents.push({ k: 'wall', i: i, x: i % g.cols, z: Math.floor(i / g.cols) });
    }
    for (var bi = 0; bi < g.boxes.length; bi++) {
      if (g.boxes[bi]) ents.push({ k: 'crate', i: bi, x: bi % g.cols, z: Math.floor(bi / g.cols) });
    }
    ents.push({ k: 'whale', i: g.whale, x: S.whale.x, z: S.whale.z });
    ents = T.sortByDepth(ents, function (o) { return o; });

    ents.forEach(function (e) {
      if (e.k === 'wall') drawWall(ctx, cam, e.x, e.z, e.i);
      else if (e.k === 'crate') drawCrate(ctx, cam, e.x, e.z, e.i, g);
      else drawWhale(ctx, cam, dt, g);
    });

    // 粒子 / 漂浮文字
    T.stepParticles(S.fx, dt, null);
    T.drawParticles(ctx, S.fx);
    for (var ti = S.texts.length - 1; ti >= 0; ti--) {
      var tx = S.texts[ti], k = (S.t - tx.t) / 1.1;
      if (k >= 1) { S.texts.splice(ti, 1); continue; }
      T.floatText(ctx, tx.x * W, tx.y * H, tx.text, tx.color, k, tx.size);
    }
    // 过关礼花（屏幕坐标，斜着撒）
    if (S.clearAt && S.t - S.clearAt < 0.6 && Math.random() < 0.5) {
      T.burst(S.fx, { x: Math.random() * W, y: -10 }, 2, [T.PAL.acc, T.PAL.yellow, T.PAL.acc2, T.PAL.good][(Math.random() * 4) | 0],
        { speed: 30, lift: -20, r: 3.4, life: 1500, grav: 60 });
    }
    // 暗角，收一点焦点
    var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
    vg.addColorStop(0, 'rgba(75,58,99,0)'); vg.addColorStop(1, 'rgba(75,58,99,.14)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }

  function drawWall(ctx, cam, x, z, i) {
    S.stats.walls++;
    var base = ['#a8e6c8', '#93dcb8', '#b6ecce'][i % 3];
    var top = T.plate(ctx, cam, x, z, 0.94, 0.94, 0.62, base, { lw: 2.2 });
    // 顶上几朵小花，做出"花丛墙"的可爱感
    ctx.save();
    [0.3, 0.62].forEach(function (f, k) {
      var p = T.project(x - 0.22 + f * 0.5, 0.64, z - 0.2 + (k % 2) * 0.34, cam);
      ctx.fillStyle = k ? T.PAL.acc : '#ffe9a8';
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.3, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.beginPath(); ctx.arc(p.x - 0.6, p.y - 0.6, 0.9, 0, 6.2832); ctx.fill();
    });
    ctx.restore();
    return top;
  }
  function drawCrate(ctx, cam, x, z, i, g) {
    var onGoal = !!g.goals[i];
    S.stats.crates++; if (onGoal) S.stats.onGoal++;
    var pop = S.pop[i] != null ? Math.max(0, 1 - (S.t - S.pop[i]) / 0.32) : 0;
    var h = 0.5 + pop * 0.14;
    var base = onGoal ? '#ffd0e2' : '#f2c98b';
    var p0 = T.project(x, 0, z, cam);
    T.shadow(ctx, { x: p0.x, y: p0.y + 3 }, 15, 6, 0.2);
    T.plate(ctx, cam, x, z, 0.74 * (1 + pop * 0.08), 0.74 * (1 + pop * 0.08), h, base, { lw: 2.4 });
    var p = T.project(x, h, z, cam);
    if (onGoal) {                                   // 归位：变成会闪的贝壳
      ctx.save();
      ctx.fillStyle = '#fff2fa';
      ctx.beginPath(); ctx.ellipse(p.x, p.y - 2, 10, 7, 0, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = '#e5a3c4'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y - 2, 3.2, 0, 6.2832); ctx.fillStyle = '#ffd0e2'; ctx.fill();
      ctx.restore();
      T.ring(ctx, { x: p0.x, y: p0.y }, 12 + pop * 8, T.PAL.acc, 0.5 + pop * 0.4, 2.6);
    } else {                                        // 木箱：盖板 + 高光
      ctx.save();
      ctx.globalAlpha = 0.9; ctx.strokeStyle = 'rgba(120,86,40,.5)'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      var A = T.project(x - 0.22, h + 0.002, z + 0.22, cam), B = T.project(x + 0.22, h + 0.002, z - 0.22, cam);
      ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      ctx.restore();
    }
  }
  function drawWhale(ctx, cam, dt, g) {
    S.stats.whale++;
    var w = S.whale;
    if (w.from) {                                   // 补间 + 小跳
      var k = Math.min(1, (S.t - w.t0) / w.dur);
      var e = T.easeOutCubic(k);
      w.x = w.from.x + (w.tx - w.from.x) * e;
      w.z = w.from.z + (w.tz - w.from.z) * e;
      w.hop = Math.sin(Math.PI * k) * 0.26;
      if (k >= 1) { w.from = null; w.hop = 0; var st = T.spring(w.squash, 1, w.vel, dt); w.squash = st.v; w.vel = st.vel; }
    } else {
      var st2 = T.spring(w.squash, 1, w.vel, dt, 260, 20);
      w.squash = st2.v; w.vel = st2.vel;
      w.hop = 0;
    }
    var breathing = 1 + Math.sin(S.t * 1.9) * 0.022;
    var sq = w.squash;
    var p = T.project(w.x, 0.34 + w.hop, w.z, cam);
    var onGoal = !!g.goals[g.whale];
    var base = T.PAL.acc2;
    T.shadow(ctx, { x: p.x, y: p.y + 16 }, 16, 6.5, 0.22);
    // 尾鳍（在身后先画）
    ctx.save();
    ctx.translate(p.x - 15, p.y + 4);
    ctx.rotate(-0.5 + Math.sin(S.t * 2.4) * 0.18);
    ctx.fillStyle = T.tone(base).right;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-9, -7); ctx.lineTo(-6, 3); ctx.closePath();
    ctx.fill(); ctx.strokeStyle = T.tone(base).line; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.restore();
    // 身体（三段色阶 + 高光 + 描边）
    T.blob(ctx, p, 17 * breathing, 14 * (2 - sq) * breathing, base, { lw: 2.6, shadow: 0, hi: true });
    // 肚子浅色
    ctx.save();
    ctx.globalAlpha = 0.9; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(p.x + 1, p.y + 4, 9 * breathing, 6 * breathing, 0.1, 0, 6.2832); ctx.fill();
    ctx.restore();
    // 眼睛（会眨）+ 腮红 + 微笑
    var bl = w.blink;
    var eyeH = bl > 0 ? 0.7 : 3.1;
    ctx.fillStyle = T.PAL.ink;
    ctx.beginPath(); ctx.ellipse(p.x + 5, p.y - 3, 2.1, eyeH, 0, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.ellipse(p.x - 4, p.y - 3, 1.7, eyeH * 0.9, 0, 0, 6.2832); ctx.fill();
    ctx.save(); ctx.fillStyle = 'rgba(255,143,184,.5)';
    ctx.beginPath(); ctx.arc(p.x + 10, p.y + 1, 2.6, 0, 6.2832); ctx.fill(); ctx.restore();
    if (onGoal) {
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(p.x + 1, p.y + 2, 3.4, 0.2, Math.PI - 0.2); ctx.stroke(); ctx.restore();
    }
    // 眨眼计时 + 出水花
    w.blink -= dt;
    if (w.blink < -0.12) { w.blink = 2.2 + Math.random() * 2.6; }
    if (Math.sin(S.t * 1.3 + 1) > 0.998) {
      T.burst(S.fx, { x: p.x, y: p.y - 16 }, 3, '#cdeaff', { speed: 26, lift: 60, r: 2.2, life: 620 });
    }
  }

  /* ---------- 屏幕 ---------- */
  PN.screens = PN.screens || {};
  PN.screens.soko = {
    name: 'soko',
    debug: function () { return { stats: S.stats, t: S.t }; },
    /** 只有"走位/推箱/换关/换人/结算"才值得重建 DOM；其余（比如互换动画帧）跳过 */
    patch: function (state) {
      var g = state.g || {};
      var sig = JSON.stringify([state.mode, state.phase, g.li, g.levels, g.turnIdx, g.cleared,
        g.phase, g.win, g.moves, g.pushes, g.whale, g.boxes, g.last && g.last.i, g.last && g.last.kind]);
      if (this.__sokoSig === sig) return true;
      this.__sokoSig = sig;
      return false;
    },
    render: function (state, secret) {
      var ui = this;
      var GC = PN.gameCommon;
      var g = state.g || {};
      var me = ui.pid();
      var myTurn = g.phase === 'play' && g.players && g.players[g.turnIdx] === me;
      var opp = (g.players || []).filter(function (id) { return id !== me; })[0];
      var oppP = opp ? ui.p(opp) : null;
      var wrap = ui.el('div');
      ui.renderTopbar(wrap);
      wrap.appendChild(ui.h(GC.gameHeader(ui, state, '🐳 鲸鱼推箱子（合作）',
        g.phase === 'over' ? '本局结束' : (myTurn ? '轮到你' : '等对方'),
        '<span class="pill">第 ' + ((g.li || 0) + 1) + '/' + (g.levels || 5) + ' 关</span>')));

      var body = ui.el('div');
      if (g.phase === 'over') {
        var title = g.win ? '一起通关啦！🎉' : '这局先到这儿～';
        body.appendChild(ui.h('<div class="card center sk-hero"><div class="sk-result">' + esc(title) + '</div>' +
          '<div class="muted mt8">一起通了 ' + (g.cleared || 0) + ' 关 · 双方各 +' + ((g.cleared || 0) * 2) + ' 分</div></div>'));
        body.appendChild(ui.h(GC.scoreboard(state, undefined, '🏆 总积分')));
        var btns = ui.h(GC.overButtons(ui, 'soko'));
        body.appendChild(btns);
        PN.wireOver(btns, ui);
      } else {
        var turn = ui.el('div', 'sk-turn' + (myTurn ? ' mine' : ''));
        turn.innerHTML = myTurn
          ? '<b>🙋 轮到你推一步</b><span>' + esc(g.levelName || '') + ' · 把箱子都推到花点上</span>'
          : '<b>👀 等 ' + esc(oppP ? oppP.name : '对方') + ' 推</b><span>他推的箱子会晃一下</span>';
        body.appendChild(turn);

        var hud = ui.el('div', 'sk-hud');
        hud.innerHTML =
          '<span class="sk-stat"><i>🧭</i>' + (g.moves || 0) + ' 步</span>' +
          '<span class="sk-stat"><i>🫸</i>' + (g.pushes || 0) + ' 推</span>' +
          '<span class="sk-stat"><i>🎯</i>参考 ' + (g.par || 0) + ' 步</span>' +
          '<span class="sk-stat"><i>✅</i>' + (g.cleared || 0) + '/' + (g.levels || 0) + '</span>';
        body.appendChild(hud);

        var board = ui.el('div', 'sk-board');
        // 复用同一个 canvas 节点（理由同跳一跳：整屏重建时别把 rAF 的目标拆了）
        var cv = S.cv || (S.cv = ui.el('canvas', 'sk-cv'));
        board.appendChild(cv);
        body.appendChild(board);
        body.appendChild(ui.h('<div class="muted center mt8">方向键 / WASD / 下面十字键 · 走不动不算一步</div>'));

        var pad = ui.el('div', 'sk-pad');
        var mk = function (dir, label, cls2) {
          var b = ui.el('button', 'btn ' + (cls2 || 'ghost') + ' sk-key', label);
          b.setAttribute('data-dir', dir);
          b.disabled = !myTurn;
          b.addEventListener('click', function () { ui.send({ t: 'move', dir: dir }); });
          return b;
        };
        pad.appendChild(mk('up', '⬆️', 'primary'));
        var row3 = ui.el('div', 'sk-pad-row');
        row3.appendChild(mk('left', '⬅️'));
        var rs = ui.el('button', 'btn ghost sk-key', '🔄');
        rs.setAttribute('data-reset', '1');
        rs.title = '重来本关';
        rs.addEventListener('click', function () { ui.send({ t: 'reset' }); });
        row3.appendChild(rs);
        row3.appendChild(mk('right', '➡️'));
        pad.appendChild(row3);
        pad.appendChild(mk('down', '⬇️', 'primary'));
        body.appendChild(pad);

        // 动画状态与这次渲染的 state 绑好，rAF 自己驱动（canvas 被移除就自动停）
        S.ui = ui; S.g = g; S.ready = false;
        // 一个画布只挂一个动画循环（不然每次重建都会多注册一个 rAF，越玩越卡）
        if (!cv.__toonLoop) cv.__toonLoop = T.animate(cv, draw, { ratio: 0.72 });

        if (!ui.__sokoKey) {
          ui.__sokoKey = true;
          document.addEventListener('keydown', function (e) {
            var map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
            var dir = map[e.key];
            if (!dir) return;
            if (document.activeElement && /input|textarea/i.test(document.activeElement.tagName || '')) return;
            e.preventDefault();
            var st = PN.app && PN.app.state;
            if (!st || !st.g || st.mode !== 'soko' || st.g.phase !== 'play') return;
            if (st.g.players[st.g.turnIdx] !== PN.app.pid()) return;
            PN.app.send({ t: 'move', dir: dir });
          });
        }
      }
      wrap.appendChild(body);
      if (state.phase !== 'over') wrap.appendChild(ui.renderGameFooter());
      return wrap;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
