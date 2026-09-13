/* game.js — 主循环 / 碰撞判定 / 回合流程 / 摄像机 / 场景管理 */
(function (G) {
  'use strict';
  var M = G.M, FX = G.FX, A = G.Audio, HUD = G.HUD;

  var Game = {
    W: 1280, H: 720, groundY: 566,
    scene: 'title', t: 0, frame: 0,
    fighters: [], projectiles: [], contactMarks: [],
    cam: { x: 0, y: 0, z: 1 }, bounds: { min: -1000, max: 1000 },
    phase: 'intro', phaseT: 0, locked: true, paused: false,
    timer: 99, round: 1, roundsToWin: 2,
    debugBoxes: false, debugFrames: false, training: false,
    superFlash: 0, superOwner: null, superSpec: null,
    mode: 'cpu', level: 2, menuSel: 0, selIdx: [0, 1], selLock: [false, false],
    acc: 0, slowAcc: 0, last: 0, stage: null,

    init: function (cv) {
      this.cv = cv; this.ctx = cv.getContext('2d');
      this.stage = new G.Stage(0);
      G.Input.init();
      this.scene = 'title';
      return this;
    },
    other: function (f) { return this.fighters[0] === f ? this.fighters[1] : this.fighters[0]; },

    /* ---------- 比赛流程 ---------- */
    startMatch: function () {
      var c0 = G.Chars.LIST[this.selIdx[0]], c1 = G.Chars.LIST[this.selIdx[1]];
      var F = G.Fighter;
      var p1pad = G.Input.pads[0];
      var p2pad = this.mode === 'vs' ? G.Input.pads[1] : new F.VPad();
      this.fighters = [
        new F({ idx: 0, ch: c0, x: -190, facing: 1, pad: p1pad }),
        new F({ idx: 1, ch: c1, x: 190, facing: -1, pad: p2pad, cpu: this.mode !== 'vs' })
      ];
      if (this.mode !== 'vs') this.fighters[1].ai = new G.AI(this.fighters[1], this.mode === 'training' ? 1 : this.level);
      this.stage = new G.Stage(M.rndi(0, 2));
      this.training = this.mode === 'training';
      this.round = 1; this.roundsToWin = this.training ? 99 : 2;
      this.fighters[0].roundsWon = 0; this.fighters[1].roundsWon = 0;
      this.scene = 'fight';
      this.startRound(true);
    },
    startRound: function (first) {
      this.fighters[0].reset(-190, 1, !!first);
      this.fighters[1].reset(190, -1, !!first);
      this.projectiles.length = 0; this.contactMarks.length = 0;
      FX.reset(); HUD.resetBars();
      this.timer = 99; this.phase = 'intro'; this.phaseT = 0; this.locked = true;
      this.cam.x = 0; this.cam.z = 1; this.cam.y = 0;
      this.superFlash = 0;
      HUD.say(this.training ? 'TRAINING' : 'ROUND ' + this.round, this.stage.theme.name, 66, '#ffd15c');
      A.play('bell');
    },
    onKO: function (loser) {
      if (this.phase !== 'play') return;
      if (this.training) { loser.hp = loser.hpMax; return; }
      this.phase = 'ko'; this.phaseT = 0; this.locked = true; this.koLoser = loser;
      FX.flash(.55, '#fff'); FX.slow(46, .16); FX.shake(26, loser.facing * -1, .7, 46);
      FX.zoomPunch(.22, 60); FX.radialBurst(loser.x, 110, '#ffd15c', 26);
      FX.text(loser.x, 190, 'K.O.', { col: '#ff5a3a', size: 60, life: 80, vy: .3 });
      A.play('ko'); A.play('voiceKO', 1); A.duck(.25, 2);
      HUD.say('K.O.', '', 150, '#ff5a3a');
      G.Input.rumble(loser.idx, 1, 400);
    },
    decideRound: function () {
      var lo = this.koLoser, wi = this.other(lo);
      wi.roundsWon++;
      wi.setState('win'); wi.vx = 0;
      var perfect = wi.hp >= wi.hpMax;
      if (wi.roundsWon >= this.roundsToWin) {
        this.phase = 'matchEnd'; this.phaseT = 0;
        HUD.say(wi.ch.name + ' WINS', perfect ? 'PERFECT!!' : (this.mode === 'cpu' && wi.idx === 0 ? '你赢了！' : ''), 260, '#ffd15c');
      } else {
        this.phase = 'roundEnd'; this.phaseT = 0;
        HUD.say(wi.ch.name + ' WIN', perfect ? 'PERFECT!!' : 'ROUND ' + this.round, 150, '#ffd15c');
      }
    },
    timeUp: function () {
      this.timer = 0; this.phase = 'ko'; this.phaseT = 0; this.locked = true;
      var a = this.fighters[0], b = this.fighters[1];
      this.koLoser = a.hp < b.hp ? a : (b.hp < a.hp ? b : a);
      HUD.say('TIME UP', '', 140, '#ff9a3a'); A.play('ko');
      if (a.hp === b.hp) { HUD.say('DRAW', '', 140, '#ffffff'); }
    },
    nextRound: function () { this.round++; this.startRound(false); },
    onCombo: function (atk, victim) {
      if (atk.combo === 5) { FX.text(atk.x, 210, 'NICE COMBO!', { col: '#ffd15c', size: 22, life: 40 }); A.play('meter'); }
      if (atk.combo === 10) { FX.text(atk.x, 220, 'SUPER COMBO!!', { col: '#ff8a3a', size: 26, life: 46 }); A.play('meter'); }
      if (atk.combo === 15) { FX.text(atk.x, 230, 'INCREDIBLE!!!', { col: '#ff5a5a', size: 30, life: 50 }); }
    },
    startSuperFlash: function (f, spec) {
      this.superFlash = spec.dur; this.superOwner = f; this.superSpec = spec;
      var o = this.other(f); o.frozen = spec.dur + 2;
      for (var i = 0; i < this.projectiles.length; i++) this.projectiles[i].frozen = spec.dur;
      FX.flash(.45, spec.col2); FX.radialBurst(f.x, 100, spec.col, 26);
      FX.shake(9, 1, .5, 24); FX.slow(8, .5);
      A.play('superFlash'); A.duck(.3, 1.4);
      G.Input.rumble(f.idx, .8, 300);
    },

    /* ---------- 投射物 ---------- */
    spawnProjectile: function (owner, def, x, y) {
      this.projectiles.push({
        owner: owner, x: x, y: y, vx: owner.facing * def.vx, r: def.r, age: 0, life: def.life,
        col: def.col, col2: def.col2, style: def.style, ph: 0, frozen: 0,
        hit: { dmg: def.dmg, level: 3, guard: 'mid', hitstun: def.hitstun, blockstun: def.blockstun || 14,
          hitstop: def.hitstop, push: def.push, spark: def.spark, sfx: def.sfx, chip: def.chip,
          kd: def.kd, launch: def.launch, shake: 8 }
      });
    },
    updateProjectiles: function () {
      var i, j, p, q, dead = false;
      for (i = this.projectiles.length - 1; i >= 0; i--) {
        p = this.projectiles[i];
        if (!p || p.dead) { dead = true; continue; }
        if (p.frozen > 0) { p.frozen--; continue; }
        p.age++; p.ph += .32; p.x += p.vx;
        /* 尾迹 */
        if (p.style === 'fire') { FX.flame(p.x - Math.sign(p.vx) * p.r * .6, p.y + M.rnd(-6, 6), -Math.sign(p.vx), p.col); }
        else if (p.age % 2 === 0) FX.part({ type: 'shard', x: p.x - Math.sign(p.vx) * p.r * .5, y: p.y + M.rnd(-8, 8), vx: -p.vx * .12, vy: M.rnd(-.6, .6), r: M.rnd(2, 5), life: 14, col: p.col2, drag: .95 });
        if (p.age > p.life || p.x < this.bounds.min - 60 || p.x > this.bounds.max + 60) { p.dead = 1; dead = true; continue; }
        /* 打人 */
        var d = this.other(p.owner);
        var cap = { x1: p.x, y1: p.y, x2: p.x, y2: p.y, r: p.r };
        var hbs = d.hurtboxes(), best = null;
        for (j = 0; j < hbs.length; j++) {
          var c = M.capsHit(cap, hbs[j]);
          if (c && (!best || c.depth > best.depth)) best = c;
        }
        if (best) {
          var hs0 = p.owner.hitstop;
          var res = d.takeHit(p.owner, p.hit, best, p.r);
          p.owner.hitstop = hs0;
          if (res) {
            this.mark(best.x, best.y);
            FX.shockwave(p.x, p.y, p.r * 4, p.col2);
            for (var k = 0; k < 10; k++) FX.flame(p.x, p.y + M.rnd(-14, 14), Math.sign(p.vx), p.col);
            p.dead = 1; dead = true; continue;
          }
        }
        /* 弹幕对撞 */
        for (j = this.projectiles.length - 1; j >= 0; j--) {
          if (j === i) continue;
          q = this.projectiles[j];
          if (!q || q.dead || q.owner === p.owner) continue;
          if (M.dist(p.x, p.y, q.x, q.y) < p.r + q.r) {
            var mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
            FX.spark(mx, my, { power: 3, radius: 30, dir: 1, color: '#ffffff', color2: p.col2 });
            FX.shockwave(mx, my, 150, '#ffffff'); FX.shake(10, 1, .3, 16); FX.flash(.2);
            FX.text(mx, my + 40, 'CLASH!', { col: '#ffd15c', size: 20, life: 30 });
            A.play('explode');
            p.dead = 1; q.dead = 1; dead = true;
            break;
          }
        }
      }
      if (dead) {
        var keep = [];
        for (i = 0; i < this.projectiles.length; i++) if (this.projectiles[i] && !this.projectiles[i].dead) keep.push(this.projectiles[i]);
        this.projectiles = keep;
      }
    },
    drawProjectiles: function (ctx, V) {
      for (var i = 0; i < this.projectiles.length; i++) {
        var p = this.projectiles[i], x = V.tx(p.x), y = V.ty(p.y), r = p.r * V.z;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        var g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
        g.addColorStop(0, '#ffffff'); g.addColorStop(.3, p.col2); g.addColorStop(.62, p.col); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, M.TAU); ctx.fill();
        if (p.style === 'fan') {
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5 * V.z;
          ctx.save(); ctx.translate(x, y); ctx.rotate(p.ph * 2);
          for (var k = 0; k < 3; k++) { ctx.rotate(M.TAU / 3); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 1.5, 0); ctx.stroke(); }
          ctx.restore();
        } else if (p.style === 'wave') {
          ctx.strokeStyle = p.col2; ctx.lineWidth = 3 * V.z;
          ctx.beginPath(); ctx.ellipse(x, y, r * 1.5, r * (.7 + Math.sin(p.ph) * .18), 0, 0, M.TAU); ctx.stroke();
        } else {
          ctx.strokeStyle = '#fff6c0'; ctx.lineWidth = 2 * V.z;
          ctx.beginPath();
          for (var a = 0; a < 7; a++) {
            var an = a / 7 * M.TAU + p.ph, rr = r * (.8 + .5 * Math.sin(p.ph * 3 + a));
            ctx[a === 0 ? 'moveTo' : 'lineTo'](x + Math.cos(an) * rr, y + Math.sin(an) * rr);
          }
          ctx.closePath(); ctx.stroke();
        }
        ctx.restore();
      }
    },
    mark: function (x, y) { this.contactMarks.push({ x: x, y: y, age: 0, life: 42 }); if (this.contactMarks.length > 14) this.contactMarks.shift(); },

    /* ---------- 战斗判定 ---------- */
    resolveCombat: function () {
      var evs = [], i, j, k;
      for (i = 0; i < 2; i++) {
        var a = this.fighters[i], d = this.fighters[1 - i];
        if (a.hitstop > 0 || a.frozen > 0) continue;
        var hits = a.activeHits(); if (!hits.length) continue;
        var hbs = d.hurtboxes(); if (!hbs.length) continue;
        for (k = 0; k < hits.length; k++) {
          var best = null;
          for (j = 0; j < hbs.length; j++) {
            var c = M.capsHit(hits[k].cap, hbs[j]);
            if (c && (!best || c.depth > best.depth)) best = c;
          }
          if (best) evs.push({ a: a, d: d, hit: hits[k], cp: best });
        }
      }
      for (i = 0; i < evs.length; i++) {
        var e = evs[i];
        e.a.hitReg[e.hit.i] = true;
        var res = e.d.takeHit(e.a, e.hit.h, e.cp, e.hit.cap.r);
        if (res) { e.a.moveHit = true; this.mark(e.cp.x, e.cp.y); }
      }
      if (evs.length >= 2 && evs[0].a !== evs[1].a) {
        FX.text((this.fighters[0].x + this.fighters[1].x) / 2, 200, 'TRADE!', { col: '#ffd15c', size: 22, life: 34 });
      }
    },
    separate: function () {
      var a = this.fighters[0], b = this.fighters[1];
      var topA = a.y + (a.crouching ? 110 : 178), topB = b.y + (b.crouching ? 110 : 178);
      if (a.y > topB - 40 || b.y > topA - 40) return; /* 跳过头顶时允许交错 */
      var dx = b.x - a.x, minD = a.pushW + b.pushW;
      if (Math.abs(dx) < minD) {
        var s = dx >= 0 ? 1 : -1, push = (minD - Math.abs(dx)) / 2;
        /* 处于硬直/被击中的一方承担更多位移（攻方推进感） */
        var aw = a.busy() ? .85 : .15, bw = b.busy() ? .85 : .15;
        var tot = aw + bw;
        a.x -= s * push * 2 * (aw / tot); b.x += s * push * 2 * (bw / tot);
      }
    },
    clampFighters: function () {
      for (var i = 0; i < 2; i++) {
        var f = this.fighters[i], mn = this.bounds.min + 40, mx = this.bounds.max - 40;
        if (f.x < mn) { f.x = mn; this.wallHit(f); }
        else if (f.x > mx) { f.x = mx; this.wallHit(f); }
        else f.wallHit = 0;
      }
    },
    wallHit: function (f) {
      var hard = (f.state === 'hitAir' || f.state === 'hitstun') && Math.abs(f.vx) > 5.5 && !f.wallHit;
      if (hard) {
        f.wallHit = 1;
        f.vx *= -.32; if (!f.grounded) f.vy = Math.max(f.vy, 6.5);
        f.hitstop = 8; f.hitFlash = 5; f.wobble = 4; f.wobbleT = 12;
        var wx = f.x + (f.x < 0 ? -20 : 20), wy = f.y + 90;
        FX.spark(wx, wy, { power: 2, radius: 24, dir: f.x < 0 ? -1 : 1, color: '#ffffff', color2: '#ffb04a' });
        FX.shockwave(wx, wy, 130, '#ffe0a0'); FX.dust(f.x, 4, f.x < 0 ? 1 : -1, 10, '#cfc4ae');
        FX.shake(14, f.x < 0 ? -1 : 1, .3, 20); FX.flash(.14);
        FX.text(f.x, 170, 'WALL!', { col: '#ffd15c', size: 22, life: 30 });
        A.play('hitM');
      } else if (!hard) { f.vx = f.x <= this.bounds.min + 40 ? Math.max(0, f.vx) : Math.min(0, f.vx); }
    },
    updateFacing: function () {
      for (var i = 0; i < 2; i++) {
        var f = this.fighters[i], o = this.other(f);
        if (f.state === 'attack' || f.busy() || !f.grounded) continue;
        var dx = o.x - f.x;
        if (Math.abs(dx) > 10) f.facing = dx > 0 ? 1 : -1;
      }
    },
    updateCam: function () {
      var a = this.fighters[0], b = this.fighters[1];
      var mid = (a.x + b.x) / 2, d = Math.abs(a.x - b.x);
      var z = M.clamp(1.30 - d / 1500, .76, 1.26) + FX.zoomOffset();
      if (this.phase === 'ko' || this.phase === 'matchEnd') { mid = M.lerp(mid, this.koLoser ? this.koLoser.x : mid, .5); z += .1; }
      var halfW = (this.W / 2) / z;
      var mn = this.bounds.min + halfW, mx = this.bounds.max - halfW;
      var tx = mn > mx ? 0 : M.clamp(mid, mn, mx);
      var maxY = Math.max(a.y, b.y);
      var ty = Math.max(0, (maxY - 200) * .5);
      this.cam.x = M.lerp(this.cam.x, tx, .14);
      this.cam.y = M.lerp(this.cam.y, ty, .1);
      this.cam.z = M.lerp(this.cam.z, z, .12);
    },
    view: function () {
      var c = this.cam, W = this.W, gy = this.groundY, sx = FX.shakeX, sy = FX.shakeY;
      return { z: c.z,
        tx: function (x) { return (x - c.x) * c.z + W / 2 + sx; },
        ty: function (y) { return gy - (y - c.y) * c.z + sy; } };
    },

    /* ---------- 输入（全局与菜单） ---------- */
    globalKeys: function () {
      var I = G.Input;
      if (I.tap('F1')) this.debugBoxes = !this.debugBoxes;
      if (I.tap('F2')) this.debugFrames = !this.debugFrames;
      if (I.tap('KeyM')) { A.init(); A.music(!A.musicOn); }
      if (this.scene === 'fight') {
        if (I.tap('KeyP')) { this.paused = !this.paused; A.play('menu'); }
        if (I.tap('KeyR')) { this.paused = false; this.startMatch(); }
        if (I.tap('Escape')) { this.paused = false; this.scene = 'title'; this.menuSel = 0; }
      }
    },
    menuInput: function () {
      var I = G.Input, self = this;
      function up() { return I.tap('KeyW') || I.tap('ArrowUp'); }
      function dn() { return I.tap('KeyS') || I.tap('ArrowDown'); }
      function ok() { return I.tap('Enter') || I.tap('KeyJ') || I.tap('NumpadEnter') || I.tap('Space'); }
      function back() { return I.tap('Escape'); }
      if (this.scene === 'title') {
        if (ok()) { A.init(); A.resume(); A.music(true); A.play('ok'); this.scene = 'menu'; this.menuSel = 0; }
        return;
      }
      if (this.scene === 'menu') {
        var items = 3;
        if (up()) { this.menuSel = (this.menuSel + items - 1) % items; A.play('menu'); }
        if (dn()) { this.menuSel = (this.menuSel + 1) % items; A.play('menu'); }
        if (ok()) {
          A.play('ok');
          this.mode = ['cpu', 'vs', 'training'][this.menuSel];
          if (this.mode === 'cpu') { this.scene = 'level'; this.menuSel = 1; }
          else { this.scene = 'select'; this.selLock = [false, false]; }
        }
        if (back()) this.scene = 'title';
        return;
      }
      if (this.scene === 'level') {
        if (up()) { this.menuSel = (this.menuSel + 3) % 4; A.play('menu'); }
        if (dn()) { this.menuSel = (this.menuSel + 1) % 4; A.play('menu'); }
        if (ok()) { this.level = this.menuSel; A.play('ok'); this.scene = 'select'; this.selLock = [false, false]; }
        if (back()) this.scene = 'menu';
        return;
      }
      if (this.scene === 'select') {
        var n = G.Chars.LIST.length;
        if (!this.selLock[0]) {
          if (I.tap('KeyA')) { this.selIdx[0] = (this.selIdx[0] + n - 1) % n; A.play('menu'); }
          if (I.tap('KeyD')) { this.selIdx[0] = (this.selIdx[0] + 1) % n; A.play('menu'); }
          if (I.tap('KeyJ') || I.tap('Enter')) { this.selLock[0] = true; A.play('ok'); }
        }
        if (!this.selLock[1]) {
          if (this.mode === 'vs') {
            if (I.tap('ArrowLeft')) { this.selIdx[1] = (this.selIdx[1] + n - 1) % n; A.play('menu'); }
            if (I.tap('ArrowRight')) { this.selIdx[1] = (this.selIdx[1] + 1) % n; A.play('menu'); }
            if (I.tap('Numpad1') || I.tap('Comma') || I.tap('NumpadEnter')) { this.selLock[1] = true; A.play('ok'); }
          } else if (this.selLock[0]) {
            this.selIdx[1] = M.rndi(0, n - 1); this.selLock[1] = true; A.play('ok');
          }
        }
        if (back()) { this.scene = 'menu'; this.selLock = [false, false]; }
        if (this.selLock[0] && this.selLock[1]) { this.startMatch(); }
        return;
      }
    },

    /* ---------- 单帧推进 ---------- */
    step: function () {
      this.t++;
      G.Input.update();
      this.globalKeys();
      if (this.scene !== 'fight') { this.menuInput(); G.Input.endFrame(); return; }
      if (this.paused) { G.Input.endFrame(); return; }
      this.frame++;

      /* 阶段 */
      switch (this.phase) {
        case 'intro':
          this.phaseT++;
          if (this.phaseT === 54) HUD.say('FIGHT!', '', 60, '#ff5a3a');
          if (this.phaseT === 54) A.play('bell');
          if (this.phaseT > 78) { this.phase = 'play'; this.locked = false; }
          break;
        case 'play':
          this.timer -= 1 / 60;
          if (this.timer <= 0 && !this.training) this.timeUp();
          break;
        case 'ko':
          this.phaseT++;
          if (this.phaseT === 96) this.decideRound();
          break;
        case 'roundEnd':
          this.phaseT++;
          if (this.phaseT > 150) this.nextRound();
          break;
        case 'matchEnd':
          this.phaseT++;
          if (this.phaseT > 260 || G.Input.tap('Enter')) { this.scene = 'title'; this.menuSel = 0; }
          break;
      }
      /* AI + 虚拟手柄 */
      for (var i = 0; i < 2; i++) {
        var f = this.fighters[i];
        if (f.pad && f.pad.virtual) {
          f.pad.begin();
          if (f.ai && !this.locked && f.hitstop === 0 && f.frozen === 0) f.ai.update();
          else f.pad.set(5, [], null);
        }
      }
      /* 角色 */
      for (i = 0; i < 2; i++) { this.fighters[i].update(); this.fighters[i].regen(); }
      if (this.training) {
        for (i = 0; i < 2; i++) {
          var t = this.fighters[i];
          if (t.state !== 'hitstun' && t.state !== 'hitAir' && t.state !== 'down') t.hp = Math.min(t.hpMax, t.hp + 2.4);
          t.stock = t.stockMax; t.meter = t.meterMax;
        }
      }
      this.separate();
      this.updateFacing();
      this.resolveCombat();
      this.updateProjectiles();
      this.clampFighters();
      if (this.superFlash > 0) this.superFlash--;
      this.stage.update();
      FX.update();
      HUD.update(this.fighters);
      for (i = this.contactMarks.length - 1; i >= 0; i--) {
        this.contactMarks[i].age++;
        if (this.contactMarks[i].age > this.contactMarks[i].life) this.contactMarks.splice(i, 1);
      }
      this.updateCam();
      G.Input.endFrame();
    },

    /* ---------- 绘制 ---------- */
    drawEntities: function (ctx, V) {
      var fs = this.fighters, i;
      for (i = 0; i < 2; i++) fs[i].drawShadow(ctx, V);
      FX.drawGhosts(ctx, V);
      FX.drawTrails(ctx, V);
      var order = (fs[0].state === 'attack' || fs[0].hitstop > 0) ? [1, 0] : [0, 1];
      if (fs[1].state === 'attack' && fs[0].state !== 'attack') order = [0, 1];
      for (i = 0; i < 2; i++) fs[order[i]].draw(ctx, V);
      this.drawProjectiles(ctx, V);
      FX.drawParts(ctx, V);
      FX.drawRadial(ctx, V);
    },
    render: function () {
      var ctx = this.ctx, W = this.W, H = this.H;
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (this.scene === 'title') { HUD.drawTitle(ctx, W, H, this.t); return; }
      if (this.scene === 'menu') {
        HUD.drawTitle(ctx, W, H, this.t);
        HUD.drawMenu(ctx, W, H, ['单人挑战 (VS CPU)', '双人对战 (2P VS)', '训练模式 (TRAINING)'], this.menuSel, '模式选择');
        return;
      }
      if (this.scene === 'level') {
        HUD.drawTitle(ctx, W, H, this.t);
        HUD.drawMenu(ctx, W, H, ['简单 EASY', '普通 NORMAL', '困难 HARD', '狂气 EXPERT'], this.menuSel, '难度选择');
        return;
      }
      if (this.scene === 'select') { HUD.drawSelect(ctx, W, H, this.selIdx, this.selLock, this.t, this.mode); return; }
      if (this.fighters.length < 2) return;

      var V = this.view();
      this.stage.draw(ctx, V, W, H);
      /* 超必杀演出：压暗 + 光条 */
      if (this.superFlash > 0 && this.superSpec) {
        var k = this.superFlash / this.superSpec.dur;
        ctx.save();
        ctx.fillStyle = 'rgba(4,2,10,' + (.62 * Math.min(1, k * 1.6)) + ')'; ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'lighter';
        for (var s = 0; s < 26; s++) {
          var sx = ((s * 97 + this.frame * 9) % (W + 200)) - 100;
          ctx.globalAlpha = .10 + .12 * Math.abs(Math.sin(s + this.frame * .2));
          ctx.fillStyle = this.superSpec.col2;
          ctx.fillRect(sx, 0, 3 + (s % 4) * 5, H);
        }
        ctx.restore();
      }
      this.drawEntities(ctx, V);
      FX.drawTexts(ctx, V);
      if (this.superFlash > 0 && this.superOwner) {
        var mv = this.superOwner.move;
        HUD.txt(ctx, mv ? mv.name : '', W / 2, H * .22, 46, '#fff', '#3a0d08', 'center', HUD.cn(46, 900));
        HUD.txt(ctx, this.superOwner.ch.name + ' · ' + this.superOwner.ch.cry, W / 2, H * .22 + 44, 22, this.superSpec.col2, '#3a0d08', 'center', HUD.cn(22, 800));
      }
      FX.drawFlash(ctx, W, H);
      HUD.drawFight(ctx, W, H, this);
      if (this.debugBoxes) HUD.drawDebug(ctx, W, H, this, V);
      if (this.debugFrames) HUD.drawFrameData(ctx, W, H, this);
      if (this.training) HUD.drawTraining(ctx, W, H, this);
      if (this.paused) HUD.drawPause(ctx, W, H);
    },

    /* ---------- 主循环 ---------- */
    /* 一个真实帧：慢镜时按比例跳过逻辑帧 */
    simStep: function () {
      var ts = (this.scene === 'fight' && !this.paused) ? FX.slowTick() : 1;
      this.slowAcc += ts;
      var n = 0;
      while (this.slowAcc >= 1 && n < 3) { this.slowAcc -= 1; this.step(); n++; }
      if (n === 0) { G.Input.update(); G.Input.endFrame(); }
    },
    loop: function (now) {
      var self = this;
      if (!this.last) this.last = now;
      var dt = now - this.last; this.last = now;
      if (dt > 200) dt = 200;
      this.acc += dt;
      var steps = 0;
      while (this.acc >= 1000 / 60 && steps < 4) { this.acc -= 1000 / 60; this.simStep(); steps++; }
      this.render();
      requestAnimationFrame(function (n) { self.loop(n); });
    }
  };
  G.Game = Game;
})(window.G);
