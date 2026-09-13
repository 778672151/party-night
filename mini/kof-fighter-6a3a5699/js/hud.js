/* hud.js — KOF 风格界面：血条/气槽/连击/回合/菜单/调试面板 */
(function (G) {
  'use strict';
  var M = G.M;
  function bold(s) { return '900 ' + s + 'px "Arial Black",Impact,"Microsoft YaHei",sans-serif'; }
  function cn(s, w) { return (w || 800) + ' ' + s + 'px "Microsoft YaHei","PingFang SC",sans-serif'; }
  function txt(ctx, s, x, y, size, col, ol, align, font) {
    ctx.font = font || bold(size); ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    if (ol !== null) { ctx.lineWidth = Math.max(2, size * .16); ctx.strokeStyle = ol || '#120d18'; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
    ctx.fillStyle = col; ctx.fillText(s, x, y);
  }
  function skewBar(ctx, x, y, w, h, sk) {
    ctx.beginPath();
    ctx.moveTo(x + sk, y); ctx.lineTo(x + w + sk, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath();
  }

  var HUD = {
    ghost: [1, 1], flashT: [0, 0],
    announce: null, annT: 0, annDur: 0,

    say: function (main, sub, dur, col) { this.announce = { main: main, sub: sub, col: col || '#fff' }; this.annT = 0; this.annDur = dur || 90; },

    update: function (fs) {
      for (var i = 0; i < 2; i++) {
        var f = fs[i], hp = f.hp / f.hpMax;
        if (this.ghost[i] > hp) this.ghost[i] = Math.max(hp, this.ghost[i] - .012);
        else this.ghost[i] = hp;
      }
      if (this.announce) { this.annT++; if (this.annT > this.annDur) this.announce = null; }
    },
    resetBars: function () { this.ghost = [1, 1]; },

    drawFight: function (ctx, W, H, G_) {
      var fs = G_.fighters, i;
      /* 血条 */
      for (i = 0; i < 2; i++) {
        var f = fs[i], right = i === 1;
        var bw = 500, bh = 24, by = 40;
        var bx = right ? W - 46 - bw : 46;
        var sk = right ? -12 : 12;
        ctx.save();
        // 外框
        ctx.globalAlpha = 1;
        skewBar(ctx, bx - 4, by - 4, bw + 8, bh + 8, sk); ctx.fillStyle = 'rgba(10,10,18,.85)'; ctx.fill();
        ctx.strokeStyle = '#8b93ad'; ctx.lineWidth = 2; ctx.stroke();
        // 底槽
        skewBar(ctx, bx, by, bw, bh, sk); ctx.fillStyle = '#2a1a20'; ctx.fill();
        // 残影（受伤延迟）
        var gh = this.ghost[i], hp = f.hp / f.hpMax;
        drawFill(gh, '#ff5a4a');
        // 当前血量
        var gd = ctx.createLinearGradient(bx, by, bx, by + bh);
        gd.addColorStop(0, hp > .3 ? '#ffe27a' : '#ff9a6a'); gd.addColorStop(.5, hp > .3 ? '#f5c033' : '#ff6a3a');
        gd.addColorStop(1, hp > .3 ? '#c98a12' : '#c02a1a');
        drawFill(hp, gd);
        // 高光
        ctx.save(); skewBar(ctx, bx, by, bw, bh * .38, sk); ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fill(); ctx.restore();
        ctx.restore();
        function drawFill(k, col) {
          var w = bw * M.clamp(k, 0, 1);
          ctx.save();
          skewBar(ctx, right ? bx + bw - w : bx, by, w, bh, sk);
          ctx.fillStyle = col; ctx.fill(); ctx.restore();
        }
        /* 姓名 + 回合标记 */
        var nx = right ? W - 52 : 52;
        txt(ctx, f.ch.name + ' · ' + f.ch.title, nx, by + bh + 18, 15, '#e8eefc', '#0c0a12', right ? 'right' : 'left', cn(15, 700));
        for (var r = 0; r < G_.roundsToWin; r++) {
          var mx = right ? W - 52 - r * 22 : 52 + r * 22, my = by + bh + 38;
          ctx.beginPath(); ctx.arc(mx, my, 7, 0, M.TAU);
          ctx.fillStyle = r < f.roundsWon ? '#ffd15c' : 'rgba(255,255,255,.18)'; ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1.5; ctx.stroke();
        }
        /* 气槽 */
        var pw = 300, ph = 15, py = H - 40, px = right ? W - 46 - pw : 46;
        for (var s = 0; s < f.stockMax; s++) {
          var sw = pw / f.stockMax - 6, sx = px + s * (sw + 6);
          if (right) sx = px + pw - (s + 1) * (sw + 6) + 6;
          skewBar(ctx, sx, py, sw, ph, right ? -7 : 7);
          ctx.fillStyle = 'rgba(8,8,14,.8)'; ctx.fill();
          ctx.strokeStyle = 'rgba(180,190,215,.6)'; ctx.lineWidth = 1.5; ctx.stroke();
          var fill = s < f.stock ? 1 : (s === f.stock ? f.meter / f.meterMax : 0);
          if (fill > 0) {
            var fw = (sw - 2) * fill;
            ctx.save();
            skewBar(ctx, right ? sx + (sw - 2) - fw + 1 : sx + 1, py + 1, fw, ph - 2, right ? -7 : 7);
            var pg = ctx.createLinearGradient(0, py, 0, py + ph);
            if (s < f.stock) { pg.addColorStop(0, '#fff2a0'); pg.addColorStop(.5, '#ffc23a'); pg.addColorStop(1, '#e07a10'); }
            else { pg.addColorStop(0, '#9adfff'); pg.addColorStop(1, '#2a7ad0'); }
            ctx.fillStyle = pg; ctx.fill(); ctx.restore();
          }
        }
        txt(ctx, 'POWER', right ? W - 46 - pw - 10 : 46 + pw + 10, py + ph / 2 + 1, 12, f.stock > 0 ? '#ffd15c' : '#8b93ad', '#0c0a12', right ? 'right' : 'left');
        /* 防御槽 */
        var gwid = pw * .7, gyy = py - 12, gxx = right ? W - 46 - gwid : 46;
        ctx.fillStyle = 'rgba(8,8,14,.7)'; ctx.fillRect(gxx, gyy, gwid, 5);
        ctx.fillStyle = f.guard > 35 ? '#6ad0ff' : '#ff7a4a';
        var gw2 = gwid * (f.guard / f.guardMax);
        ctx.fillRect(right ? gxx + gwid - gw2 : gxx, gyy, gw2, 5);
        /* 连击显示 */
        if (f.combo >= 2) {
          var cx = right ? W - 150 : 150, cy = 150;
          var pop = Math.max(0, 1 - (70 - f.comboT) / 8);
          ctx.save(); ctx.translate(cx, cy); ctx.rotate(right ? .06 : -.06); ctx.scale(1 + pop * .3, 1 + pop * .3);
          txt(ctx, f.combo + '', 0, 0, 54, '#fff', '#c02a10');
          txt(ctx, 'HITS', 52, 8, 20, '#ffd15c', '#3a1a08', 'left');
          txt(ctx, Math.round(f.comboDmg) + ' DMG', 0, 36, 18, '#ffe9a8', '#3a1a08');
          ctx.restore();
        }
      }
      /* 计时器 */
      var t = Math.ceil(G_.timer);
      var tc = t <= 10 ? (G_.frame % 20 < 10 ? '#ff4a3a' : '#ffb0a0') : '#ffffff';
      ctx.save();
      skewBar(ctx, W / 2 - 56, 30, 112, 52, 0); ctx.fillStyle = 'rgba(10,10,18,.8)'; ctx.fill();
      ctx.strokeStyle = '#8b93ad'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      txt(ctx, (t < 10 ? '0' : '') + t, W / 2, 57, 42, tc, '#120d18');
      txt(ctx, G_.stage.theme.name + '  ·  ROUND ' + G_.round, W / 2, 96, 13, 'rgba(230,238,255,.75)', '#0c0a12', 'center', cn(13, 700));

      /* 公告 */
      if (this.announce) {
        var a = this.announce, k = this.annT / this.annDur;
        var sc = k < .12 ? M.EASE.oc(k / .12) * 1.15 : (k > .82 ? 1 - (k - .82) / .18 * .25 : 1);
        var al = k > .82 ? 1 - (k - .82) / .18 : 1;
        ctx.save(); ctx.globalAlpha = M.clamp(al, 0, 1);
        ctx.translate(W / 2, H * .34); ctx.scale(sc, sc);
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        var ag = ctx.createRadialGradient(0, 0, 0, 0, 0, 320);
        ag.addColorStop(0, 'rgba(0,0,0,.0)'); ag.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = ag; ctx.restore();
        txt(ctx, a.main, 0, 0, 74, a.col, '#1a0d10');
        if (a.sub) txt(ctx, a.sub, 0, 56, 26, '#ffe9a8', '#1a0d10', 'center', cn(26, 800));
        ctx.restore();
      }
    },

    drawDebug: function (ctx, W, H, G_, V) {
      var fs = G_.fighters, i, j;
      ctx.save();
      for (i = 0; i < 2; i++) {
        var f = fs[i];
        /* pushbox */
        var pb = f.pushbox();
        ctx.strokeStyle = 'rgba(80,255,120,.85)'; ctx.lineWidth = 1.5;
        ctx.strokeRect(V.tx(pb.x0), V.ty(pb.y1), (pb.x1 - pb.x0) * V.z, (pb.y1 - pb.y0) * V.z);
        /* hurtbox */
        var hb = f.hurtboxes();
        for (j = 0; j < hb.length; j++) capsule(hb[j], 'rgba(70,150,255,.20)', 'rgba(120,190,255,.9)');
        /* hitbox */
        var ah = f.activeHits();
        for (j = 0; j < ah.length; j++) capsule(ah[j].cap, 'rgba(255,60,60,.26)', 'rgba(255,120,90,1)');
        /* 原点 */
        ctx.strokeStyle = 'rgba(255,255,255,.6)';
        ctx.beginPath(); ctx.moveTo(V.tx(f.x) - 7, V.ty(0)); ctx.lineTo(V.tx(f.x) + 7, V.ty(0));
        ctx.moveTo(V.tx(f.x), V.ty(0) - 7); ctx.lineTo(V.tx(f.x), V.ty(0) + 7); ctx.stroke();
      }
      /* 投射物 */
      for (i = 0; i < G_.projectiles.length; i++) {
        var p = G_.projectiles[i];
        capsule({ x1: p.x, y1: p.y, x2: p.x, y2: p.y, r: p.r }, 'rgba(255,60,60,.26)', 'rgba(255,140,90,1)');
      }
      /* 最近命中点 */
      for (i = 0; i < G_.contactMarks.length; i++) {
        var c = G_.contactMarks[i], a = 1 - c.age / c.life;
        ctx.globalAlpha = a; ctx.strokeStyle = '#ffe600'; ctx.lineWidth = 2;
        var cx = V.tx(c.x), cy = V.ty(c.y), s = 10 * V.z;
        ctx.beginPath(); ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy); ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy + s); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, 4 * V.z, 0, M.TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      /* 距离标尺 */
      var a0 = fs[0], a1 = fs[1];
      var gap = Math.abs(a1.x - a0.x);
      var lx0 = V.tx(Math.min(a0.x, a1.x)), lx1 = V.tx(Math.max(a0.x, a1.x)), ly = V.ty(0) + 16;
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(lx0, ly); ctx.lineTo(lx1, ly); ctx.stroke();
      txt(ctx, gap.toFixed(0) + 'px', (lx0 + lx1) / 2, ly + 12, 12, '#ffffff', '#000');
      ctx.restore();

      function capsule(c, fill, stroke) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = fill; ctx.lineWidth = c.r * 2 * V.z;
        ctx.beginPath(); ctx.moveTo(V.tx(c.x1), V.ty(c.y1)); ctx.lineTo(V.tx(c.x2), V.ty(c.y2)); ctx.stroke();
        ctx.strokeStyle = stroke; ctx.lineWidth = 1.4;
        // 轮廓
        var x1 = V.tx(c.x1), y1 = V.ty(c.y1), x2 = V.tx(c.x2), y2 = V.ty(c.y2), r = c.r * V.z;
        var dx = x2 - x1, dy = y2 - y1, l = M.len(dx, dy) || 1, nx = -dy / l * r, ny = dx / l * r;
        var ang = Math.atan2(dy, dx);
        ctx.beginPath();
        ctx.moveTo(x1 + nx, y1 + ny); ctx.lineTo(x2 + nx, y2 + ny);
        ctx.arc(x2, y2, r, ang - Math.PI / 2, ang + Math.PI / 2);
        ctx.lineTo(x1 - nx, y1 - ny);
        ctx.arc(x1, y1, r, ang + Math.PI / 2, ang + Math.PI * 1.5);
        ctx.stroke();
        ctx.restore();
      }
    },

    drawFrameData: function (ctx, W, H, G_) {
      var fs = G_.fighters, lines = [], i;
      for (i = 0; i < 2; i++) {
        var f = fs[i], s = 'P' + (i + 1) + ' ' + f.ch.name + '  [' + f.state + ']';
        if (f.state === 'attack' && f.move) {
          var fd = G.Moves.frameData(f.move);
          s += '  ' + f.move.name + '  F' + (f.mf + 1) + '/' + f.move.total +
            '  发生' + fd.startup + ' 持续' + fd.active + ' 收招' + fd.recovery;
        }
        s += '  顿帧' + f.hitstop + '  无敌' + f.invulT + '  浮空' + f.juggle + '  连' + f.chainHits;
        lines.push(s);
      }
      lines.push('距离 ' + Math.abs(fs[1].x - fs[0].x).toFixed(0) + 'px   粒子 ' + G.FX.count +
        '   镜头 z=' + G_.cam.z.toFixed(2) + '   帧 ' + G_.frame);
      ctx.save();
      ctx.fillStyle = 'rgba(6,8,16,.72)'; ctx.fillRect(W / 2 - 330, H - 92, 660, 66);
      ctx.strokeStyle = 'rgba(140,160,200,.4)'; ctx.lineWidth = 1; ctx.strokeRect(W / 2 - 330, H - 92, 660, 66);
      for (i = 0; i < lines.length; i++)
        txt(ctx, lines[i], W / 2 - 318, H - 76 + i * 20, 13, i === 2 ? '#9fd0ff' : '#ffe9a8', null, 'left', cn(13, 600));
      ctx.restore();
    },

    drawTitle: function (ctx, W, H, t) {
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#0a0716'); g.addColorStop(.55, '#1b1030'); g.addColorStop(1, '#3a1420');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < 8; i++) {
        var a = t * .006 + i, rx = W / 2 + Math.cos(a) * 420, ry = H * .5 + Math.sin(a * .7) * 200;
        var rg = ctx.createRadialGradient(rx, ry, 0, rx, ry, 260);
        rg.addColorStop(0, 'rgba(255,120,40,.10)'); rg.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
      var sc = 1 + Math.sin(t * .05) * .012;
      ctx.save(); ctx.translate(W / 2, H * .33); ctx.scale(sc, sc);
      txt(ctx, '烈焰对决', 0, 0, 96, '#ffd15c', '#3a0d08', 'center', cn(96, 900));
      txt(ctx, 'THE KING OF FIGHTERS STYLE', 0, 66, 26, '#ffffff', '#3a0d08');
      ctx.restore();
      if (Math.floor(t / 26) % 2 === 0)
        txt(ctx, 'PRESS  ENTER', W / 2, H * .66, 34, '#fff', '#2a0a10');
      txt(ctx, 'P1: WASD + J / K / U / I      P2: 方向键 + Num1 / 2 / 4 / 5', W / 2, H * .78, 16, 'rgba(255,255,255,.7)', '#000', 'center', cn(16, 600));
      txt(ctx, 'F1 判定框   F2 帧数据   M 音乐   P 暂停', W / 2, H * .83, 15, 'rgba(255,255,255,.5)', '#000', 'center', cn(15, 600));
    },

    drawMenu: function (ctx, W, H, items, sel, title, sub) {
      ctx.fillStyle = 'rgba(6,4,12,.86)'; ctx.fillRect(0, 0, W, H);
      txt(ctx, title, W / 2, H * .18, 48, '#ffd15c', '#3a0d08', 'center', cn(48, 900));
      if (sub) txt(ctx, sub, W / 2, H * .18 + 44, 17, 'rgba(255,255,255,.7)', '#000', 'center', cn(17, 600));
      for (var i = 0; i < items.length; i++) {
        var y = H * .38 + i * 62, on = i === sel;
        if (on) {
          ctx.save(); skewBar(ctx, W / 2 - 250, y - 24, 500, 48, 16);
          ctx.fillStyle = 'rgba(255,180,60,.22)'; ctx.fill();
          ctx.strokeStyle = '#ffd15c'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        }
        txt(ctx, items[i], W / 2, y, on ? 30 : 26, on ? '#fff' : 'rgba(255,255,255,.55)', '#1a0d10', 'center', cn(on ? 30 : 26, 800));
      }
      txt(ctx, '↑↓ 选择   Enter 确定   Esc 返回', W / 2, H * .88, 16, 'rgba(255,255,255,.6)', '#000', 'center', cn(16, 600));
    },

    drawSelect: function (ctx, W, H, sel, locked, t, mode) {
      ctx.fillStyle = 'rgba(6,4,12,.9)'; ctx.fillRect(0, 0, W, H);
      txt(ctx, '选择角色', W / 2, 60, 40, '#ffd15c', '#3a0d08', 'center', cn(40, 900));
      var list = G.Chars.LIST, n = list.length, cw = 210, gap = 24;
      var total = n * cw + (n - 1) * gap, x0 = W / 2 - total / 2;
      for (var i = 0; i < n; i++) {
        var ch = list[i], cx = x0 + i * (cw + gap), cy = 130, chh = 330;
        var p1 = sel[0] === i, p2 = sel[1] === i;
        ctx.save();
        ctx.fillStyle = p1 || p2 ? 'rgba(255,190,80,.16)' : 'rgba(255,255,255,.05)';
        ctx.fillRect(cx, cy, cw, chh);
        ctx.strokeStyle = p1 && p2 ? '#ff8ad0' : p1 ? '#ffd15c' : p2 ? '#7fd0ff' : 'rgba(255,255,255,.2)';
        ctx.lineWidth = p1 || p2 ? 3 : 1.5; ctx.strokeRect(cx, cy, cw, chh);
        ctx.restore();
        /* 立绘 */
        var pv = { z: .92, tx: function (wx) { return cx + cw / 2 + wx * .92; }, ty: function (wy) { return cy + chh - 48 - wy * .92; } };
        var pose = G.Rig.loop(G.Rig.POSE.idle, t + i * 17, 64);
        var J = G.Rig.world(pose, 0, 0, 1, 1);
        ctx.save(); ctx.globalAlpha = (p1 || p2) ? 1 : .78;
        G.Rig.draw(ctx, J, ch.pal, {}, pv); ctx.restore();
        txt(ctx, ch.name, cx + cw / 2, cy + chh - 26, 26, '#fff', '#1a0d10', 'center', cn(26, 900));
        txt(ctx, ch.title, cx + cw / 2, cy + chh - 4, 14, '#ffd15c', '#1a0d10', 'center', cn(14, 700));
        if (p1) txt(ctx, '1P', cx + 22, cy + 20, 20, '#ffd15c', '#1a0d10');
        if (p2) txt(ctx, mode === 'cpu' ? 'CPU' : '2P', cx + cw - 26, cy + 20, 20, '#7fd0ff', '#1a0d10');
      }
      /* 招式表 */
      var ch1 = G.Chars.LIST[sel[0]];
      var mv = ['必杀技：'], k;
      for (k = 0; k < ch1.specials.length; k++) {
        var s = ch1.specials[k], mo = { qcf: '↓↘→', qcb: '↓↙←', dp: '→↓↘', hcb: '→↓↙←', dqcf: '↓↘→↓↘→' }[s.motion];
        mv.push(s.name + '  ' + mo + ' + ' + (s.btn === 'P' ? '拳' : '脚'));
      }
      mv.push('超必杀：' + ch1.superSpec.name + '  ↓↘→↓↘→ + 拳（需 1 气）');
      for (k = 0; k < mv.length; k++)
        txt(ctx, mv[k], W / 2, H - 130 + k * 22, 15, k === 0 ? '#ffd15c' : '#e8eefc', '#000', 'center', cn(15, 600));
      txt(ctx, '1P: A/D 选择, J 确定   ' + (mode === 'cpu' ? 'CPU 自动选择' : '2P: ←/→ 选择, Num1 确定'),
        W / 2, H - 26, 16, 'rgba(255,255,255,.65)', '#000', 'center', cn(16, 600));
    },

    drawPause: function (ctx, W, H) {
      ctx.fillStyle = 'rgba(4,4,10,.7)'; ctx.fillRect(0, 0, W, H);
      txt(ctx, 'PAUSE', W / 2, H / 2 - 20, 62, '#ffd15c', '#3a0d08');
      txt(ctx, 'P 继续    R 重新开始    Esc 回到标题', W / 2, H / 2 + 40, 20, '#fff', '#000', 'center', cn(20, 700));
    },
    drawTraining: function (ctx, W, H, G_) {
      txt(ctx, '训练模式：血量/气自动恢复   F1 判定框   F2 帧数据   Esc 退出',
        W / 2, H - 108, 15, '#9fd0ff', '#000', 'center', cn(15, 700));
    },
    txt: txt, bold: bold, cn: cn
  };
  G.HUD = HUD;
})(window.G);
