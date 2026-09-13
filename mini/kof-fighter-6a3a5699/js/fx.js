/* fx.js — 打击感核心：火花/冲击波/挥击轨迹/残影/顿帧/震屏/慢镜/伤害数字 */
(function (G) {
  'use strict';
  var M = G.M, TAU = M.TAU;
  var parts = [], trails = [], ghosts = [], texts = [];
  var shakeX = 0, shakeY = 0, shakeT = 0, shakeMag = 0, shakeDX = 1, shakeDY = 0, shakeDur = 1;
  var flashA = 0, flashCol = '#fff', zoomK = 0, zoomT = 0, zoomDur = 1, slowT = 0, slowScale = 1;
  var radial = [];

  function reset() { parts.length = 0; trails.length = 0; ghosts.length = 0; texts.length = 0; radial.length = 0; flashA = 0; shakeT = 0; zoomT = 0; slowT = 0; }

  function part(o) {
    o.life = o.life || 20; o.age = 0;
    o.vx = o.vx || 0; o.vy = o.vy || 0; o.g = o.g === undefined ? 0 : o.g;
    o.r = o.r || 4; o.drag = o.drag === undefined ? .92 : o.drag;
    o.rot = o.rot || 0; o.spin = o.spin || 0;
    parts.push(o); return o;
  }

  /* 命中火花：位置 = 判定框实际交点；大小 = 判定半径 */
  function spark(x, y, opt) {
    opt = opt || {};
    var pw = opt.power === undefined ? 1 : opt.power;      // 1 轻 / 2 中 / 3 重
    var rr = opt.radius || 16;
    var dir = opt.dir === undefined ? 1 : opt.dir;
    var col = opt.color || '#fff4c8', col2 = opt.color2 || '#ff9a2e';
    // 中心闪光
    part({ type: 'flare', x: x, y: y, r: rr * (.9 + pw * .5), life: 5 + pw * 2, col: col, col2: col2, spin: M.rnd(-.3, .3), rot: M.rnd(TAU) });
    // 十字星
    part({ type: 'cross', x: x, y: y, r: rr * (1.3 + pw * .9), life: 7 + pw * 3, col: col, rot: M.rnd(TAU), spin: M.rnd(-.08, .08) });
    // 冲击环
    if (pw >= 2) part({ type: 'ring', x: x, y: y, r: rr * .7, r2: rr * (2.4 + pw), life: 10 + pw * 3, col: col2, lw: 2 + pw });
    // 碎片
    var n = 5 + pw * 5;
    for (var i = 0; i < n; i++) {
      var a = M.rnd(TAU), sp = M.rnd(2, 4 + pw * 3.2);
      part({ type: 'shard', x: x, y: y, vx: Math.cos(a) * sp + dir * pw, vy: Math.sin(a) * sp, g: -.12,
        r: M.rnd(1.6, 3.2 + pw * .7), life: M.rnd(9, 16 + pw * 4), col: i % 3 === 0 ? col2 : col, drag: .9 });
    }
    // 速度线
    if (pw >= 2) for (var j = 0; j < 3 + pw * 2; j++) {
      var aa = M.rnd(-.5, .5) + (dir > 0 ? 0 : Math.PI);
      part({ type: 'streak', x: x, y: y, vx: Math.cos(aa) * M.rnd(9, 18), vy: Math.sin(aa) * M.rnd(9, 18) * .6,
        r: M.rnd(10, 26), life: M.rnd(5, 9), col: col, drag: .84 });
    }
  }
  function guardSpark(x, y, dir, r) {
    part({ type: 'shield', x: x, y: y, r: (r || 18) * 1.4, life: 12, col: '#8fd2ff', dir: dir });
    for (var i = 0; i < 7; i++) {
      var a = M.rnd(-.9, .9) + (dir > 0 ? Math.PI : 0);
      part({ type: 'shard', x: x, y: y, vx: Math.cos(a) * M.rnd(2, 7), vy: Math.sin(a) * M.rnd(2, 7) - 1, g: -.14,
        r: M.rnd(1.4, 2.6), life: M.rnd(8, 14), col: '#cdeaff', drag: .9 });
    }
    part({ type: 'ring', x: x, y: y, r: (r || 18) * .5, r2: (r || 18) * 1.9, life: 9, col: '#9ad8ff', lw: 2 });
  }
  function dust(x, y, dir, n, col) {
    n = n || 6;
    for (var i = 0; i < n; i++) {
      part({ type: 'smoke', x: x + M.rnd(-6, 6), y: y, vx: dir * M.rnd(.4, 2.6) + M.rnd(-.6, .6), vy: M.rnd(.4, 2.2),
        g: -.06, r: M.rnd(5, 12), life: M.rnd(14, 26), col: col || '#c8bda8', drag: .9, grow: M.rnd(.3, .8) });
    }
  }
  function ember(x, y, col) {
    part({ type: 'shard', x: x, y: y, vx: M.rnd(-1, 1), vy: M.rnd(.6, 2.4), g: -.02, r: M.rnd(1.2, 2.8),
      life: M.rnd(30, 60), col: col || '#ffb545', drag: .98 });
  }
  function ring(x, y, r0, r1, col, life, lw) { part({ type: 'ring', x: x, y: y, r: r0, r2: r1, life: life || 14, col: col || '#fff', lw: lw || 3 }); }
  function shockwave(x, y, r, col) { part({ type: 'wave', x: x, y: y, r: r * .3, r2: r, life: 18, col: col || '#ffffff' }); }
  function flame(x, y, dir, col) {
    part({ type: 'flame', x: x, y: y, vx: dir * M.rnd(.5, 3), vy: M.rnd(1, 3.4), g: -.04, r: M.rnd(8, 18),
      life: M.rnd(12, 22), col: col || '#ff7a1a', drag: .93, grow: .5 });
  }
  /* 攻击判定的实际扫过区域（轨迹），既好看又直观展示范围 */
  function trail(cap, col, life) {
    trails.push({ x1: cap.x1, y1: cap.y1, x2: cap.x2, y2: cap.y2, r: cap.r, col: col || 'rgba(255,255,255,.5)', age: 0, life: life || 10 });
    if (trails.length > 80) trails.shift();
  }
  function ghost(J, pal, alpha, tint) { ghosts.push({ J: J, pal: pal, a: alpha === undefined ? .35 : alpha, tint: tint, age: 0, life: 12 }); if (ghosts.length > 40) ghosts.shift(); }
  function text(x, y, str, opt) {
    opt = opt || {};
    texts.push({ x: x, y: y, s: str, age: 0, life: opt.life || 40, col: opt.col || '#fff',
      size: opt.size || 26, vy: opt.vy === undefined ? 1.6 : opt.vy, vx: opt.vx || 0, sub: opt.sub, scale: opt.scale || 1 });
  }
  function shake(mag, dx, dy, dur) {
    if (mag < shakeMag * .6 && shakeT > 0) return;
    shakeMag = mag; shakeDur = dur || 14; shakeT = shakeDur;
    var l = M.len(dx || 1, dy || 0) || 1; shakeDX = (dx || 1) / l; shakeDY = (dy || 0) / l;
  }
  function flash(a, col) { flashA = Math.max(flashA, a); flashCol = col || '#fff'; }
  function zoomPunch(k, dur) { zoomK = k; zoomT = zoomDur = dur || 14; }
  function slow(frames, scale) { slowT = Math.max(slowT, frames); slowScale = scale || .28; }
  function radialBurst(x, y, col, n) {
    radial.push({ x: x, y: y, col: col || '#ffffff', age: 0, life: 16, n: n || 18 });
  }

  function update() {
    var i, p;
    for (i = parts.length - 1; i >= 0; i--) {
      p = parts[i]; p.age++;
      if (p.age >= p.life) { parts.splice(i, 1); continue; }
      p.x += p.vx; p.y += p.vy; p.vy -= p.g; p.vx *= p.drag; p.vy *= p.drag;
      p.rot += p.spin;
      if (p.grow) p.r += p.grow;
    }
    for (i = trails.length - 1; i >= 0; i--) { trails[i].age++; if (trails[i].age >= trails[i].life) trails.splice(i, 1); }
    for (i = ghosts.length - 1; i >= 0; i--) { ghosts[i].age++; if (ghosts[i].age >= ghosts[i].life) ghosts.splice(i, 1); }
    for (i = texts.length - 1; i >= 0; i--) { var t = texts[i]; t.age++; t.x += t.vx; t.y += t.vy; t.vy *= .92; if (t.age >= t.life) texts.splice(i, 1); }
    for (i = radial.length - 1; i >= 0; i--) { radial[i].age++; if (radial[i].age >= radial[i].life) radial.splice(i, 1); }
    if (shakeT > 0) {
      shakeT--;
      var k = shakeT / shakeDur, amp = shakeMag * k * k;
      var ph = shakeT * 2.3;
      shakeX = Math.sin(ph) * amp * shakeDX + Math.sin(ph * 1.7) * amp * .3;
      shakeY = Math.sin(ph * .9) * amp * shakeDY + Math.cos(ph * 1.3) * amp * .28;
    } else { shakeX = 0; shakeY = 0; shakeMag = 0; }
    if (zoomT > 0) zoomT--;
    if (flashA > 0) flashA = Math.max(0, flashA - .08);
  }
  /* 慢镜由主循环按真实帧节拍消耗 */
  function slowTick() { var s = slowT > 0 ? slowScale : 1; if (slowT > 0) slowT--; return s; }
  function zoomOffset() { if (zoomT <= 0) return 0; var k = zoomT / zoomDur; return zoomK * k * k; }
  function timeScale() { return slowT > 0 ? slowScale : 1; }

  /* --- 绘制：世界层（人物之后、HUD 之前） --- */
  function drawTrails(ctx, V) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < trails.length; i++) {
      var t = trails[i], a = 1 - t.age / t.life;
      ctx.strokeStyle = t.col; ctx.globalAlpha = a * .55;
      ctx.lineCap = 'round'; ctx.lineWidth = t.r * 2 * V.z * (.5 + a * .5);
      ctx.beginPath(); ctx.moveTo(V.tx(t.x1), V.ty(t.y1)); ctx.lineTo(V.tx(t.x2), V.ty(t.y2)); ctx.stroke();
    }
    ctx.restore();
  }
  function drawParts(ctx, V) {
    ctx.save();
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i], k = p.age / p.life, a = 1 - k, x = V.tx(p.x), y = V.ty(p.y), z = V.z;
      switch (p.type) {
        case 'flare':
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
          var r = p.r * z * (1 + k * 1.4);
          var g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, '#ffffff'); g.addColorStop(.35, p.col); g.addColorStop(.75, p.col2); g.addColorStop(1, 'rgba(255,120,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
          break;
        case 'cross':
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * .95;
          var R = p.r * z * (1 + k * 2.2), w = Math.max(1.4, R * .1 * (1 - k));
          ctx.strokeStyle = p.col; ctx.lineWidth = w; ctx.lineCap = 'round';
          ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot);
          ctx.beginPath(); ctx.moveTo(-R, 0); ctx.lineTo(R, 0); ctx.moveTo(0, -R * .55); ctx.lineTo(0, R * .55); ctx.stroke();
          ctx.rotate(Math.PI / 4);
          ctx.lineWidth = w * .55; ctx.beginPath(); ctx.moveTo(-R * .55, 0); ctx.lineTo(R * .55, 0); ctx.moveTo(0, -R * .4); ctx.lineTo(0, R * .4); ctx.stroke();
          ctx.restore();
          break;
        case 'ring': case 'wave':
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * (p.type === 'wave' ? .5 : .85);
          var rr = M.lerp(p.r, p.r2, M.EASE.oc(k)) * z;
          ctx.strokeStyle = p.col; ctx.lineWidth = Math.max(1, (p.lw || 3) * z * a);
          ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
          break;
        case 'shard':
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
          ctx.fillStyle = p.col;
          ctx.beginPath(); ctx.arc(x, y, Math.max(.6, p.r * z * a), 0, TAU); ctx.fill();
          break;
        case 'streak':
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * .8;
          ctx.strokeStyle = p.col; ctx.lineWidth = Math.max(1, 2.4 * z * a); ctx.lineCap = 'round';
          var l = M.len(p.vx, p.vy) || 1;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - p.vx / l * p.r * z, y - p.vy / l * p.r * z); ctx.stroke();
          break;
        case 'smoke':
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = a * .42;
          ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(x, y, p.r * z * (.6 + k), 0, TAU); ctx.fill();
          break;
        case 'flame':
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * .8;
          var fg = ctx.createRadialGradient(x, y, 0, x, y, p.r * z);
          fg.addColorStop(0, '#fff3c0'); fg.addColorStop(.4, p.col); fg.addColorStop(1, 'rgba(120,20,0,0)');
          ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(x, y, p.r * z, 0, TAU); ctx.fill();
          break;
        case 'shield':
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * .9;
          ctx.strokeStyle = p.col; ctx.lineWidth = Math.max(1.5, 4 * z * a);
          ctx.beginPath();
          var base = p.dir > 0 ? 0 : Math.PI;
          ctx.arc(x, y, p.r * z * (1 + k * .5), base - 1.1, base + 1.1); ctx.stroke();
          break;
      }
    }
    ctx.restore();
  }
  function drawRadial(ctx, V) {
    for (var i = 0; i < radial.length; i++) {
      var r = radial[i], k = r.age / r.life, a = 1 - k;
      var x = V.tx(r.x), y = V.ty(r.y);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * .7;
      ctx.strokeStyle = r.col; ctx.translate(x, y);
      for (var j = 0; j < r.n; j++) {
        var ang = j / r.n * TAU + k * .4, r0 = (40 + k * 260) * V.z, r1 = r0 + (60 + a * 160) * V.z;
        ctx.lineWidth = Math.max(1, 6 * V.z * a);
        ctx.beginPath(); ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0 * .8);
        ctx.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1 * .8); ctx.stroke();
      }
      ctx.restore();
    }
  }
  function drawGhosts(ctx, V) {
    for (var i = 0; i < ghosts.length; i++) {
      var g = ghosts[i], a = (1 - g.age / g.life) * g.a;
      G.Rig.draw(ctx, g.J, g.pal, { alpha: a, silhouette: g.tint || '#7fd0ff' }, V);
    }
  }
  function drawTexts(ctx, V) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var i = 0; i < texts.length; i++) {
      var t = texts[i], k = t.age / t.life, a = k > .7 ? (1 - k) / .3 : 1;
      var pop = t.age < 4 ? 1 + (4 - t.age) * .18 : 1;
      var x = V.tx(t.x), y = V.ty(t.y), s = t.size * V.z * t.scale * pop;
      ctx.globalAlpha = a;
      ctx.font = '900 ' + s.toFixed(1) + 'px "Arial Black",Impact,sans-serif';
      ctx.lineWidth = Math.max(2, s * .16); ctx.strokeStyle = '#15101a';
      ctx.strokeText(t.s, x, y); ctx.fillStyle = t.col; ctx.fillText(t.s, x, y);
      if (t.sub) {
        ctx.font = '900 ' + (s * .5).toFixed(1) + 'px "Arial Black",Impact,sans-serif';
        ctx.strokeText(t.sub, x, y + s * .75); ctx.fillStyle = '#ffe9a8'; ctx.fillText(t.sub, x, y + s * .75);
      }
    }
    ctx.restore();
  }
  function drawFlash(ctx, w, h) {
    if (flashA <= 0.001) return;
    ctx.save(); ctx.globalAlpha = Math.min(1, flashA); ctx.fillStyle = flashCol;
    ctx.fillRect(0, 0, w, h); ctx.restore();
  }

  G.FX = {
    reset: reset, part: part, spark: spark, guardSpark: guardSpark, dust: dust, ember: ember, ring: ring,
    shockwave: shockwave, flame: flame, trail: trail, ghost: ghost, text: text, shake: shake, flash: flash,
    zoomPunch: zoomPunch, slow: slow, radialBurst: radialBurst, update: update,
    drawTrails: drawTrails, drawParts: drawParts, drawGhosts: drawGhosts, drawTexts: drawTexts,
    drawFlash: drawFlash, drawRadial: drawRadial,
    zoomOffset: zoomOffset, timeScale: timeScale, slowTick: slowTick,
    get shakeX() { return shakeX; }, get shakeY() { return shakeY; },
    get count() { return parts.length; }
  };
})(window.G);
