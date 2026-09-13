/* =========================================================================
   街头快打 · Street Brawl — 单人 2D 横版 beat 'em up
   Inspired by Double Dragon / 闪客快打.
   A single self-contained canvas engine (no external assets).
   ========================================================================= */
(function () {
  'use strict';

  // ---------------------------------------------------------------------
  //  Config / constants
  // ---------------------------------------------------------------------
  const W = 960, H = 540;
  const TOP = 128;          // min "feet" screen y (far back)
  const BOT = H - 40;       // max "feet" screen y (near front)
  const WORLD_W = 2200;     // arena width in world px
  const VIEW_W = W;

  const FPS = 60;
  const GRAV = 2200;        // jump gravity (px/s^2)

  // depth -> visual scale
  function depthScale(cy) {
    const t = (cy - TOP) / (BOT - TOP);
    return 0.86 + 0.34 * clamp(t, 0, 1);
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function irnd(a, b) { return Math.floor(rnd(a, b + 1)); }

  // ---------------------------------------------------------------------
  //  Input
  // ---------------------------------------------------------------------
  const keys = { left: false, right: false, up: false, down: false, jump: false,
                 punch: false, kick: false };
  const keyMap = {
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
    KeyW: 'up', ArrowUp: 'up',
    KeyS: 'down', ArrowDown: 'down',
    Space: 'jump',
    KeyJ: 'punch', KeyZ: 'punch',
    KeyK: 'kick', KeyX: 'kick',
  };

  // ---------------------------------------------------------------------
  //  Audio (procedural SFX, no assets)
  // ---------------------------------------------------------------------
  const SFX = {
    ctx: null, muted: false,
    ensure() {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { /* ignore */ }
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    beep(freq, dur, type, vol, slide) {
      if (this.muted || !this.ctx) return;
      try {
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type || 'square';
        o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t + dur);
        g.gain.setValueAtTime(vol || 0.2, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(this.ctx.destination);
        o.start(t); o.stop(t + dur + 0.02);
      } catch (e) { /* ignore */ }
    },
    punch() { this.beep(200, 0.06, 'square', 0.20, 110); },
    kick()  { this.beep(120, 0.12, 'square', 0.30, 70); },
    hit()   { this.beep(240, 0.08, 'sawtooth', 0.22, 90); },
    heavy() { this.beep(90, 0.20, 'sawtooth', 0.30, 45); },
    hurt()  { this.beep(170, 0.13, 'triangle', 0.20, 110); },
    ko()    { this.beep(140, 0.30, 'square', 0.25, 45); },
    pickup(){ this.beep(660, 0.08, 'sine', 0.18, 990); },
    combo(n){ this.beep(440 + n * 60, 0.05, 'square', 0.12, 640 + n * 60); },
    wave()  { this.beep(330, 0.16, 'square', 0.14, 440); },
    boss()  { this.beep(70, 0.4, 'sawtooth', 0.25, 40); },
    win()   { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.beep(f, 0.16, 'triangle', 0.22, f * 1.2), i * 120)); },
    lose()  { [330, 262, 196].forEach((f, i) => setTimeout(() => this.beep(f, 0.22, 'triangle', 0.20, f * 0.6), i * 140)); },
  };

  // ---------------------------------------------------------------------
  //  Fighter base
  // ---------------------------------------------------------------------
  class Fighter {
    constructor(x, cy) {
      this.x = x;            // world x (feet center)
      this.cy = cy;          // depth (feet screen y)
      this.vx = 0;
      this.vy = 0;           // knockback on depth axis
      this.jumpVy = 0;       // vertical jump
      this.jumpOfs = 0;      // current lift (px)
      this.facing = 1;
      this.hp = 100; this.maxHp = 100;
      this.state = 'idle';   // idle | walk | attack | hurt | dead
      this.stateT = 0;
      this.attack = null;    // {type, t, didHit, chain, heavy}
      this.hurtT = 0;
      this.invulnT = 0;
      this.walkPhase = 0;
      this.moving = false;
      this.scale = 1;
      this.onGround = true;
      this.flash = 0;        // white flash on hit
      this.deadT = 0;
      this.rm = false;       // mark for removal
      this.sx = x; this.sy = cy; // last screen pos
      this.attackCd = 0;
      this.hitFlash = 0;
    }

    get hpRatio() { return clamp(this.hp / this.maxHp, 0, 1); }
    get airborne() { return !this.onGround; }

    screenPos(camX) { return { x: this.x - camX, y: this.cy - this.jumpOfs }; }
  }

  // ---------------------------------------------------------------------
  //  Player
  // ---------------------------------------------------------------------
  class Player extends Fighter {
    constructor(x, cy) {
      super(x, cy);
      this.maxHp = 100; this.hp = 100;
      this.lives = 3;
      this.score = 0;
      this.combo = 0;
      this.comboT = 0;
      this.punchChain = 0;
      this.punchChainT = 0;
      this.power = 1;
      this.invulnT = 0;
      this.speed = 250;
      this.color = { shirt: '#e8514a', pants: '#2b4a7d', skin: '#f0c090', hair: '#23262b', band: '#ffd23d' };
    }

    update(dt) {
      this.hurtT -= dt; this.invulnT -= dt; this.attackCd -= dt;
      if (this.flash > 0) this.flash -= dt;

      // movement
      let mx = 0, my = 0;
      if (keys.left) mx -= 1;
      if (keys.right) mx += 1;
      if (keys.up) my -= 1;
      if (keys.down) my += 1;
      if (mx !== 0) this.facing = mx > 0 ? 1 : -1;

      // can't move while hurt (brief) or dead
      const canAct = this.hurtT <= 0 && this.state !== 'dead';

      // attacks
      if (canAct && keys.punch) this.tryStartAttack('punch');
      else if (canAct && keys.kick) this.tryStartAttack('kick');

      if (this.state === 'attack') {
        this.advanceAttack(dt);
        if (this.attack) {
          // a modest step forward while swinging
          this.vx = (this.attack.heavy ? 46 : 70) * this.facing;
        }
      } else if (canAct) {
        const len = Math.hypot(mx, my);
        if (len > 0) {
          const sp = this.speed * (this.onGround ? 1 : 0.8);
          this.vx = (mx / len) * sp;
          this.vy = (my / len) * sp * 0.9;
          this.state = 'walk';
          this.moving = true;
          this.walkPhase += dt * 11;
        } else {
          this.vx = 0; this.vy = 0;
          this.state = 'idle'; this.moving = false;
        }
      } else {
        this.vx *= 0.8; this.vy *= 0.8;
      }

      // jump
      if (keys.jump && this.onGround && this.state !== 'attack' && canAct) {
        this.jumpVy = 780; this.onGround = false;
        keys.jump = false; // consume
        SFX.punch();
      }

      // integrate
      this.x += this.vx * dt;
      this.cy += this.vy * dt;
      this.applyPhysics(dt);

      // combo timer
      if (this.comboT > 0) this.comboT -= dt;
      if (this.comboT <= 0 && this.combo > 0) { this.combo = 0; this.comboT = 0; }
      if (this.punchChainT > 0) this.punchChainT -= dt;
      if (this.punchChainT <= 0) this.punchChain = 0;

      this.clampWorld();
    }

    applyPhysics(dt) {
      // jump physics
      if (!this.onGround) {
        this.jumpVy -= GRAV * dt;
        this.jumpOfs += this.jumpVy * dt;
        if (this.jumpOfs <= 0) { this.jumpOfs = 0; this.jumpVy = 0; this.onGround = true; }
      }
      // knockback decay on depth axis
      this.vx *= Math.pow(0.002, dt); // strong friction on knockback too (vx overridden most frames)
    }

    clampWorld() {
      this.x = clamp(this.x, 40, WORLD_W - 40);
      this.cy = clamp(this.cy, TOP, BOT);
      // re-derive screen pos
      this.scale = depthScale(this.cy);
      const p = this.screenPos(cam.x);
      this.sx = p.x; this.sy = p.y;
    }

    tryStartAttack(type) {
      if (this.state === 'attack') return;
      this.state = 'attack';
      this.onGround = this.onGround; // attacks allowed during jump (cosmetic)
      if (type === 'punch') {
        let chain = this.punchChain + 1;
        if (chain > 3) chain = 1;
        this.punchChain = chain; this.punchChainT = 1.0;
        const cfg = [ { d: 9, r: 62, win: [0.05, 0.13] },
                      { d: 9, r: 64, win: [0.05, 0.13] },
                      { d: 14, r: 66, win: [0.07, 0.15] } ];
        const c = cfg[chain - 1];
        this.attack = {
          type: 'punch', t: 0, chain, heavy: chain === 3, hitSet: new Set(),
          dur: chain === 3 ? 0.34 : 0.24,
          dmg: c.d, range: c.r, winS: c.win[0], winE: c.win[1]
        };
        SFX.punch();
      } else {
        this.punchChain = 0; this.punchChainT = 0;
        this.attack = {
          type: 'kick', t: 0, heavy: true, hitSet: new Set(),
          dur: 0.42, dmg: 17, range: 74, winS: 0.16, winE: 0.26
        };
        SFX.kick();
      }
    }

    advanceAttack(dt) {
      const a = this.attack;
      a.t += dt;
      // resolve hits during the active window (per-target, once per swing)
      if (a.t >= a.winS && a.t <= a.winE) this.tryHit(a);
      if (a.t >= a.dur) { this.state = 'idle'; this.attack = null; }
    }

    tryHit(a) {
      let hitSomething = false;
      for (const e of enemies) {
        if (e.rm || e.state === 'dead' || a.hitSet.has(e) || e.invulnT > 0) continue;
        const dx = e.x - this.x;
        const dy = e.cy - this.cy;
        if (Math.abs(dy) > 46) continue;              // depth band
        if (dx * this.facing < -18) continue;          // must be in front
        if (Math.abs(dx) > a.range) continue;
        e.takeHit(a.dmg * this.power, this.facing, a.heavy, this);
        a.hitSet.add(e);
        hitSomething = true;
      }
      if (hitSomething) {
        this.combo++;
        this.comboT = 2.2;
        SFX.combo(this.combo);
        updateHUD();
      }
    }

    takeHit(dmg, dir, heavy) {
      if (this.invulnT > 0 || this.state === 'dead') return;
      this.hp -= dmg;
      this.flash = 0.12;
      this.state = 'hurt'; this.hurtT = heavy ? 0.42 : 0.30;
      this.invulnT = heavy ? 0.5 : 0.34;   // brief i-frames so one group can't stun-lock
      this.vx = dir * (heavy ? 260 : 180);
      this.vy = dir * 40;
      this.attack = null;
      SFX.hurt();
      cam.shake = Math.max(cam.shake, heavy ? 0.18 : 0.08);
      if (this.combo > 0) { this.combo = 0; this.comboT = 0; }
      updateHUD();
      if (this.hp <= 0) this.die();
    }

    die() {
      this.state = 'dead'; this.deadT = 0;
      this.lives--;
      SFX.lose();
      cam.shake = 0.2;
    }
  }

  // ---------------------------------------------------------------------
  //  Enemy
  // ---------------------------------------------------------------------
  class Enemy extends Fighter {
    constructor(x, cy, kind) {
      super(x, cy);
      this.kind = kind || 'thug';
      this.state = 'idle';
      this.isEnemy = true;
      const presets = {
        thug:   { hp: 34, speed: 120, dmg: 7,  color: { shirt: '#6b7a3a', pants: '#3a3f4a', skin: '#d9b28a', hair: '#2b2b2b', band: '#9a9a52' }, score: 150 },
        brute:  { hp: 80, speed: 92,  dmg: 13, color: { shirt: '#7a2f2f', pants: '#2b2b2b', skin: '#c99b6f', hair: '#1e1e1e', band: '#c33333' }, score: 400 },
        runner: { hp: 24, speed: 165, dmg: 5,  color: { shirt: '#3f6b6b', pants: '#243232', skin: '#e0b98f', hair: '#111', band: '#3aa' }, score: 100 },
        boss:   { hp: 260, speed: 104, dmg: 16, color: { shirt: '#8a1526', pants: '#16161c', skin: '#c99163', hair: '#000', band: '#ffcf3d' }, score: 2000 },
      };
      const p = presets[this.kind];
      this.hp = p.hp; this.maxHp = p.hp;
      this.speed = p.speed;
      this.dmg = p.dmg;
      this.color = p.color;
      this.score = p.score;
      this.think = rnd(0, 0.4);
      this.attackCd = rnd(0.3, 0.9);
      this.isBoss = this.kind === 'boss';
    }

    update(dt, player) {
      this.stateT += dt;
      this.hurtT -= dt; this.invulnT -= dt; this.attackCd -= dt;
      if (this.flash > 0) this.flash -= dt;

      if (this.state === 'dead') { this.deadT += dt; this.updateDead(dt); return; }

      // facing toward player
      this.facing = player.x > this.x ? 1 : -1;
      this.speed = this.kind === 'brute' ? 92 : this.kind === 'runner' ? 168 : 122;

      if (this.hurtT > 0) {
        // knocked back
        this.applyKnockback(dt);
      } else if (this.invulnT > 0) {
        this.vx *= 0.9; this.vy *= 0.9;
      } else {
        this.ai(player, dt);
      }

      this.x += this.vx * dt;
      this.cy += this.vy * dt;
      this.vx *= Math.pow(0.01, dt);
      this.vy *= Math.pow(0.01, dt);

      this.x = clamp(this.x, 30, WORLD_W - 30);
      this.cy = clamp(this.cy, TOP + 6, BOT);
      this.scale = depthScale(this.cy);
      if (this.state !== 'dead') {
        const p = this.screenPos(cam.x);
        this.sx = p.x; this.sy = p.y;
        this.moving = this.vx !== 0 || this.vy !== 0;
      }
    }

    applyKnockback(dt) {
      // during hurt we still decay velocity
    }

    ai(player, dt) {
      const dx = player.x - this.x;
      const dy = player.cy - this.cy;
      const adx = Math.abs(dx);

      // attack ranges scale a bit by kind
      const strike = this.kind === 'brute' ? 70 : 58;

      // separate from other enemies to avoid stacking
      let sepX = 0, sepY = 0;
      for (const o of enemies) {
        if (o === this || o.rm || o.state === 'dead') continue;
        const ox = this.x - o.x, oy = this.cy - o.cy;
        if (Math.abs(ox) < 30 && Math.abs(oy) < 24) {
          sepX += (ox >= 0 ? 1 : -1);
          sepY += (oy >= 0 ? 1 : -1);
        }
      }

      const inDepth = Math.abs(dy) < 40;

      if (this.attack) {
        this.advanceAttack(dt, player);
        return;
      }

      // attack decision
      if (inDepth && adx < strike + 6 && Math.abs(dx) > 10 && this.attackCd <= 0) {
        this.attackCd = this.kind === 'runner' ? rnd(0.5, 1.1) : rnd(0.6, 1.4);
        const heavyChance = this.kind === 'brute' ? 0.6 : this.kind === 'runner' ? 0.1 : 0.35;
        const heavy = Math.random() < heavyChance;
        this.state = 'attack';
        this.attack = heavy
          ? { type: 'kick', t: 0, didHit: false, heavy: true, dur: 0.42, dmg: this.dmg, range: strike + 8, winS: 0.16, winE: 0.28 }
          : { type: 'punch', t: 0, didHit: false, heavy: false, dur: 0.26, dmg: this.dmg * 0.7, range: strike, winS: 0.06, winE: 0.14 };
        return;
      }

      // chase toward player
      let mx = Math.sign(dx) * (this.isBoss ? 0.6 : 1);
      if (adx < 26) mx *= 0.2;
      // prefer aligning depth if far apart
      let my = 0;
      if (Math.abs(dy) > 22) my = Math.sign(dy) * (adx < 60 ? 1 : 0.4);
      // separation
      mx += sepX * 0.6; my += sepY * 0.5;

      // boss occasionally retreats
      if (this.isBoss && Math.random() < 0.002) { mx = -mx; }

      const sp = this.speed * (adx < 14 ? 0.25 : 1);
      this.vx = mx * sp;
      this.vy = my * sp * 0.8;
      if (Math.abs(mx) + Math.abs(my) > 0.05) { this.state = 'walk'; this.walkPhase += dt * 10; }
      else this.state = 'idle';
      this.moving = Math.abs(mx) > 0.05;
    }

    advanceAttack(dt, player) {
      const a = this.attack;
      a.t += dt;
      if (!a.didHit && a.t >= a.winS && a.t <= a.winE) {
        const dx = player.x - this.x;
        const dy = player.cy - this.cy;
        if (Math.abs(dy) < 46 && dx * this.facing > -16 && Math.abs(dx) < a.range) {
          a.didHit = true;
          player.takeHit(a.dmg, this.facing, a.heavy);
        }
      }
      if (a.t >= a.dur) { this.state = 'idle'; this.attack = null; }
    }

    takeHit(dmg, dir, heavy, source) {
      if (this.state === 'dead') return;
      this.hp -= dmg;
      this.flash = 0.12;
      this.state = 'hurt'; this.hurtT = heavy ? 0.36 : 0.26;
      this.vx = dir * (heavy ? 230 : 140);
      this.vy = dir * (heavy ? 60 : 30);
      this.attack = null;
      SFX[heavy ? 'heavy' : 'hit']();
      cam.shake = Math.max(cam.shake, heavy ? 0.12 : 0.05);
      spawnHitFx(this.sx, this.sy - 60 * this.scale, dir, heavy);
      if (this.hp <= 0) this.die();
    }

    die() {
      if (this.wasKilled) return;
      this.wasKilled = true;
      totalKills++;
      addScore(this.score, this.sx, this.sy - 80 * this.scale);
      this.state = 'dead'; this.deadT = 0;
      this.vx = this.facing * rnd(60, 160);
      this.vy = -rnd(60, 120);
      this.jumpOfs = 0; this.jumpVy = -300; this.onGround = false;
      SFX.ko();
      cam.shake = Math.max(cam.shake, 0.14);
    }

    updateDead(dt) {
      // fall to ground
      if (!this.onGround) {
        this.jumpVy -= GRAV * dt;
        this.jumpOfs += this.jumpVy * dt;
        if (this.jumpOfs <= 0) { this.jumpOfs = 0; this.jumpVy = 0; this.onGround = true; }
      }
      this.x += this.vx * dt;
      this.vx *= 0.96;
      const p = this.screenPos(cam.x);
      this.sx = p.x; this.sy = p.y;
      if (this.deadT > 1.6) this.rm = true;
    }
  }

  // ---------------------------------------------------------------------
  //  Effects
  // ---------------------------------------------------------------------
  const particles = [];
  const floatTexts = [];

  function spawnHitFx(x, y, dir, heavy) {
    const n = heavy ? 12 : 7;
    for (let i = 0; i < n; i++) {
      particles.push({
        x, y,
        vx: rnd(-90, 90) + dir * rnd(20, 120),
        vy: rnd(-160, 20),
        life: rnd(0.25, 0.55), max: 0.55,
        size: rnd(2, heavy ? 5 : 3.5),
        color: heavy ? '#ffd23d' : '#ffe9b0'
      });
    }
    for (let i = 0; i < (heavy ? 5 : 3); i++) {
      particles.push({
        x: x + dir * 10, y,
        vx: dir * rnd(30, 90), vy: rnd(-60, 10),
        life: rnd(0.3, 0.6), max: 0.6, size: rnd(3, 6),
        color: '#ff5b4d'
      });
    }
  }

  function addScore(v, x, y) {
    if (player) player.score += v;
    floatTexts.push({ x, y, vy: -40, life: 0.9, max: 0.9, text: '+' + v, color: '#ffd23d' });
    updateHUD();
  }

  function updateFx(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 600 * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = floatTexts.length - 1; i >= 0; i--) {
      const t = floatTexts[i];
      t.life -= dt; t.y += t.vy * dt; t.vy *= 0.94;
      if (t.life <= 0) floatTexts.splice(i, 1);
    }
  }

  function drawFx(ctx) {
    ctx.save();
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    for (const t of floatTexts) {
      ctx.globalAlpha = clamp(t.life / t.max, 0, 1);
      ctx.fillStyle = t.color;
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3;
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------
  //  Camera
  // ---------------------------------------------------------------------
  const cam = { x: 0, shake: 0 };

  function updateCamera(dt) {
    const target = clamp(player.x - VIEW_W * 0.42, 0, WORLD_W - VIEW_W);
    cam.x += (target - cam.x) * Math.min(1, dt * 6);
    if (cam.shake > 0) cam.shake = Math.max(0, cam.shake - dt * 1.6);
  }

  // ---------------------------------------------------------------------
  //  Wave / spawn management
  // ---------------------------------------------------------------------
  let enemies = [];
  let waveState = 'idle'; // idle | active | cleared | boss
  let waveNum = 1;
  let spawnQueue = [];      // remaining enemies to spawn this wave
  let spawnTimer = 0;
  let waveDelay = 0;
  let totalToSpawn = 0;
  let spawnedThisWave = 0;
  let waveBannerReset = 0;
  let gameOver = false;
  let victory = false;
  let totalKills = 0;

  function buildWave(n) {
    let list = [];
    if (n === 1)      list = ['thug', 'thug', 'thug'];
    else if (n === 2) list = ['thug', 'thug', 'runner', 'thug'];
    else if (n === 3) list = ['brute', 'thug', 'runner', 'thug', 'runner'];
    else if (n === 4) list = ['brute', 'brute', 'thug', 'runner', 'runner', 'thug'];
    else if (n === 5) list = ['brute', 'runner', 'brute', 'thug', 'runner', 'runner', 'thug'];
    return list;
  }

  function startWave(n) {
    SFX.wave();
    const list = buildWave(n);
    spawnQueue = list.slice();
    totalToSpawn = list.length;
    spawnedThisWave = 0;
    spawnTimer = 0.2;
    waveState = 'active';
    waveDelay = 0;
    waveNum = n;
    updateHUD();
    const el = document.getElementById('wave-banner');
    el.textContent = '第 ' + n + ' 波敌人';
    el.classList.remove('hidden');
    el.style.opacity = 1;
    waveBannerReset = performance.now() + 2000;
  }

  function spawnEnemy(kind) {
    // spawn just off the right view edge, at random depth
    const sx = clamp(player.x + VIEW_W * 0.62, 60, WORLD_W - 30);
    const cy = rnd(TOP + 20, BOT - 10);
    const e = new Enemy(sx, cy, kind);
    // boss faces left, spawn slightly further
    e.scale = depthScale(cy);
    e.sx = e.x - cam.x; e.sy = e.cy;
    enemies.push(e);
    spawnedThisWave++;
  }

  function updateWaves(dt) {
    if (gameOver || victory) return;

    if (waveState === 'idle') {
      // start first wave shortly after game start
      if (player.lives > 0) { startWave(1); }
      return;
    }

    if (waveState === 'active') {
      if (spawnQueue.length > 0) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
          const kind = spawnQueue.shift();
          spawnEnemy(kind);
          spawnTimer = 0.9;
        }
      }
      // everyone dead & spawned? then cleared
      const alive = enemies.filter(e => !e.rm && e.state !== 'dead').length;
      if (spawnQueue.length === 0 && alive === 0) {
        waveState = 'cleared';
        waveDelay = 1.6;
        if (waveNum >= 5) {
          spawnBoss();
          waveState = 'boss';
        }
      }
    } else if (waveState === 'cleared') {
      waveDelay -= dt;
      if (waveDelay <= 0) {
        const nextN = waveNum + 1;
        // clear leftover dead
        enemies = enemies.filter(e => !e.rm);
        startWave(nextN);
      }
    } else if (waveState === 'boss') {
      const aliveBoss = enemies.filter(e => !e.rm && e.state !== 'dead').length;
      if (aliveBoss === 0) onVictory();
    }
  }

  function spawnBoss() {
    SFX.boss();
    const e = new Enemy(clamp(player.x + VIEW_W * 0.5, 300, WORLD_W - 60), (TOP + BOT) / 2, 'boss');
    e.scale = depthScale(e.cy);
    e.sx = e.x - cam.x; e.sy = e.cy;
    enemies.push(e);
    const el = document.getElementById('wave-banner');
    el.textContent = '⚠ 头目登场 ⚠';
    el.style.opacity = 1;
    waveBannerReset = performance.now() + 2600;
  }

  // ---------------------------------------------------------------------
  //  Drawing helpers
  // ---------------------------------------------------------------------
  function drawLimb(ctx, x1, y1, x2, y2, w, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  // Draw a humanoid fighter. Local origin = feet center. +x is facing dir.
  function drawFighter(ctx, f) {
    const s = f.scale;
    const flip = f.facing;
    const cx = f.sx, cy = f.sy;

    // shadow
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx, f.sy + 4, 26 * s, 6 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(flip * s, s);

    const C = f.color;
    const P = f.state;
    const t = f.attack ? f.attack.t : 0;
    const skin = C.skin;

    // white flash on hit
    if (f.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(f.flash / 0.12, 0, 1);
    }

    // ---- pose parameters ----
    let hipY = -46, shoulderY = -84, headY = -99, headR = 12;
    let torsoW = 13, lean = 0;          // lean >0 means forward
    let armF = { x: 4, y: -78 };        // forward arm shoulder
    let armB = { x: -4, y: -78 };       // back arm shoulder
    let hipFL = { x: -6, y: hipY };     // forward-ish leg hip
    let hipBL = { x: 6, y: hipY };      // back leg hip
    let walk = f.walkPhase;

    // state adjustments
    if (P === 'walk') {
      const ph = walk;
      const swing = Math.sin(ph);
      // forward leg
      const footF = { x: 13 * swing + 6, y: -Math.max(0, Math.sin(ph)) * 9 };
      const footB = { x: -13 * swing + 4, y: -Math.max(0, Math.sin(ph + Math.PI)) * 9 };
      applyLegs(ctx, hipFL, footF, skin, C.pants);
      applyLegs(ctx, hipBL, footB, skin, C.pants);
      // arms opposite
      drawLimb(ctx, armF.x, armF.y, armF.x + 14, armF.y + 8, 9, C.shirt);
      drawLimb(ctx, armF.x + 14, armF.y + 8, armF.x + 16, armF.y + 26, 7, skin);
      drawLimb(ctx, armB.x, armB.y, armB.x - 14, armB.y + 8, 9, C.shirt);
      drawLimb(ctx, armB.x - 14, armB.y + 8, armB.x - 16, armB.y + 26, 7, skin);
      drawTorso(ctx, hipY, shoulderY, torsoW, C.shirt, C.pants, lean);
      drawHead(ctx, headY, headR, C);
      // hide overlapping leg drawing since we already drew legs above
      ctx.restore();
      return;
    }

    if (P === 'attack' && f.attack) {
      const a = f.attack;
      const heavy = a.heavy;
      const prog = clamp(t / a.dur, 0, 1);
      const ext = strikeExtent(prog, a.winS, a.winE); // 0..1 extension
      if (a.type === 'punch') {
        drawLegsIdle(ctx, hipFL, hipBL, skin, C.pants);
        drawTorso(ctx, hipY, shoulderY, torsoW, C.shirt, C.pants, 0.1 + ext * 0.2);
        // forward arm: extend toward facing
        const sh = armF;
        const elbow = { x: sh.x + 8 + ext * 14, y: sh.y + 2 };
        const hand = { x: sh.x + 16 + ext * 40, y: sh.y };
        drawLimb(ctx, sh.x, sh.y, elbow.x, elbow.y, 9, C.shirt);
        drawLimb(ctx, elbow.x, elbow.y, hand.x, hand.y, 7, skin);
        // fist
        ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(hand.x, hand.y, 5, 0, Math.PI * 2); ctx.fill();
        // back arm guard
        drawLimb(ctx, armB.x, armB.y, armB.x + 2, armB.y + 18, 9, C.shirt);
        drawLimb(ctx, armB.x + 2, armB.y + 18, armB.x + 6, armB.y + 30, 7, skin);
        drawHead(ctx, headY, headR, C);
      } else { // kick
        const sh = hipFL; // front leg kicks
        const footTarget = { x: 14 + ext * 54, y: -20 - ext * 22 };
        // support (back) leg stays planted
        drawLimb(ctx, hipBL.x + 2, hipBL.y, hipBL.x + 6, hipBL.y + 24, 10, C.pants);
        drawLimb(ctx, hipBL.x + 6, hipBL.y + 24, hipBL.x + 8, 2, 9, skin);
        // front leg extended
        const knee = { x: (sh.x + footTarget.x) * 0.5 + 4, y: (sh.y + footTarget.y) * 0.5 - 6 };
        drawLimb(ctx, sh.x, sh.y, knee.x, knee.y, 10, C.pants);
        drawLimb(ctx, knee.x, knee.y, footTarget.x, footTarget.y, 9, skin);
        drawTorso(ctx, hipY, shoulderY, torsoW, C.shirt, C.pants, 0.14 + ext * 0.12);
        // arms for balance
        drawLimb(ctx, armF.x, armF.y, armF.x + 6, armF.y + 16, 9, C.shirt);
        drawLimb(ctx, armF.x + 6, armF.y + 16, armF.x - 4, armF.y + 28, 7, skin);
        drawLimb(ctx, armB.x, armB.y, armB.x - 8, armB.y + 4, 9, C.shirt);
        drawLimb(ctx, armB.x - 8, armB.y + 4, armB.x + 2, armB.y + 18, 7, skin);
        drawHead(ctx, headY, headR, C);
      }
      ctx.restore();
      return;
    }

    if (P === 'hurt') {
      drawLegsIdle(ctx, hipFL, hipBL, skin, C.pants);
      drawTorso(ctx, hipY, shoulderY, torsoW, C.shirt, C.pants, -0.18);
      // arms flung back
      drawLimb(ctx, armF.x, armF.y, armF.x - 10, armF.y + 8, 9, C.shirt);
      drawLimb(ctx, armF.x - 10, armF.y + 8, armF.x - 14, armF.y + 22, 7, skin);
      drawLimb(ctx, armB.x, armB.y, armB.x - 12, armB.y + 6, 9, C.shirt);
      drawLimb(ctx, armB.x - 12, armB.y + 6, armB.x - 16, armB.y + 20, 7, skin);
      drawHead(ctx, headY, headR, C, -0.15);
      ctx.restore();
      return;
    }

    if (P === 'dead') {
      // lying on ground: draw rotated figure
      const lie = clamp(f.deadT / 0.3, 0, 1);
      ctx.rotate(-0.4 * flip * lie);
      drawLegsIdle(ctx, hipFL, hipBL, skin, C.pants);
      drawTorso(ctx, hipY + 20, shoulderY + 20, torsoW, C.shirt, C.pants, -0.3);
      drawLimb(ctx, armF.x, armF.y + 20, armF.x - 14, armF.y + 34, 9, C.shirt);
      drawLimb(ctx, armF.x - 14, armF.y + 34, armF.x - 20, armF.y + 44, 7, skin);
      drawLimb(ctx, armB.x, armB.y + 20, armB.x - 12, armB.y + 32, 9, C.shirt);
      drawLimb(ctx, armB.x - 12, armB.y + 32, armB.x - 16, armB.y + 42, 7, skin);
      drawHead(ctx, headY + 22, headR, C, -0.2);
      ctx.restore();
      return;
    }

    // idle (default)
    if (f.moving && P !== 'attack') { /* handled above for walk */ }
    drawLegsIdle(ctx, hipFL, hipBL, skin, C.pants);
    drawTorso(ctx, hipY, shoulderY, torsoW, C.shirt, C.pants, 0);
    // idle arms slightly raised
    drawLimb(ctx, armF.x, armF.y, armF.x + 10, armF.y + 12, 9, C.shirt);
    drawLimb(ctx, armF.x + 10, armF.y + 12, armF.x + 12, armF.y + 28, 7, skin);
    drawLimb(ctx, armB.x, armB.y, armB.x - 10, armB.y + 12, 9, C.shirt);
    drawLimb(ctx, armB.x - 10, armB.y + 12, armB.x - 12, armB.y + 28, 7, skin);
    drawHead(ctx, headY, headR, C);
    ctx.restore();
  }

  function strikeExtent(prog, winS, winE) {
    // ramp 0->1 during windup to active, hold near 1, then recover
    if (prog < winS) return prog / Math.max(0.01, winS) * 0.7;
    if (prog < winE) return 0.7 + (prog - winS) / Math.max(0.01, winE - winS) * 0.3;
    return 1 - (prog - winE) / Math.max(0.01, 1 - winE) * 0.8;
  }

  function drawLegsIdle(ctx, hipFL, hipBL, skin, pants, skipBack) {
    // standing apart
    drawLimb(ctx, hipFL.x - 2, hipFL.y, hipFL.x - 6, hipFL.y + 24, 10, pants);
    drawLimb(ctx, hipFL.x - 6, hipFL.y + 24, hipFL.x - 6, 2, 9, skin);
    if (skipBack !== true) {
      drawLimb(ctx, hipBL.x + 2, hipBL.y, hipBL.x + 6, hipBL.y + 24, 10, pants);
      drawLimb(ctx, hipBL.x + 6, hipBL.y + 24, hipBL.x + 8, 2, 9, skin);
    }
  }
  function applyLegs(ctx, hip, foot, skin, pants) {
    const knee = { x: (hip.x + foot.x) * 0.5 + 4, y: (hip.y + foot.y) * 0.5 - 6 };
    drawLimb(ctx, hip.x, hip.y, knee.x, knee.y, 10, pants);
    drawLimb(ctx, knee.x, knee.y, foot.x, foot.y, 9, skin);
  }
  function drawTorso(ctx, hipY, shoulderY, torsoW, shirt, pants, lean) {
    // pelvis
    ctx.fillStyle = pants;
    ctx.fillRect(-torsoW, hipY - 6, torsoW * 2, 12);
    // chest (slight lean)
    ctx.fillStyle = shirt;
    ctx.save();
    ctx.translate(0, hipY); ctx.rotate(lean * 0.25);
    ctx.fillRect(-torsoW, 0, torsoW * 2, hipY - shoulderY + 4);
    ctx.restore();
  }
  function drawHead(ctx, headY, headR, C, tilt) {
    ctx.fillStyle = C.skin;
    ctx.save();
    ctx.translate(tilt ? tilt * 40 : 0, headY);
    ctx.rotate(tilt ? -tilt * 0.6 : 0);
    ctx.beginPath(); ctx.arc(0, 0, headR, 0, Math.PI * 2); ctx.fill();
    // hair
    ctx.fillStyle = C.hair;
    ctx.beginPath(); ctx.arc(0, -3, headR + 1, Math.PI, Math.PI * 2); ctx.fill();
    // band
    ctx.fillStyle = C.band;
    ctx.fillRect(-headR, -4, headR * 2, 3);
    // eye
    ctx.fillStyle = '#fff';
    ctx.fillRect(headR * 0.25, -1, 4, 3);
    ctx.fillStyle = '#111';
    ctx.fillRect(headR * 0.25 + 2, -1, 2, 3);
    ctx.restore();
  }

  // ---------------------------------------------------------------------
  //  Background rendering (parallax street)
  // ---------------------------------------------------------------------
  function drawBackground(ctx) {
    // sky gradient
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2a3550');
    g.addColorStop(0.55, '#4a3b52');
    g.addColorStop(1, '#161a24');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // moon + clouds (parallax 0.1)
    ctx.save();
    const mx = 560 - cam.x * 0.05;
    ctx.fillStyle = 'rgba(255,240,210,.9)';
    ctx.beginPath(); ctx.arc(mx, 96, 34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,240,210,.25)';
    ctx.beginPath(); ctx.arc(mx, 96, 54, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // far skyline (parallax 0.15)
    ctx.save();
    ctx.fillStyle = '#20283a';
    for (let i = 0; i < 26; i++) {
      const bw = 70, bx = i * bw - (cam.x * 0.15 % bw);
      const bh = 120 + ((i * 37) % 120);
      ctx.fillRect(bx, H - 180 - bh, bw, bh + 180 + 60);
    }
    ctx.restore();

    // building windows (parallax 0.3)
    ctx.save();
    ctx.fillStyle = 'rgba(255,204,102,.16)';
    for (let i = 0; i < 40; i++) {
      const bx = (i * 90 - cam.x * 0.3) % (W + 200);
      for (let r = 0; r < 4; r++)
        ctx.fillRect(bx + ((i * 13) % 50), 140 + r * 70, 8, 9);
    }
    ctx.restore();

    // ground
    const groundY = H - 60;
    ctx.fillStyle = '#23262d';
    ctx.fillRect(0, groundY, W, H - groundY);
    // road top highlight
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    ctx.fillRect(0, groundY, W, 4);

    // sidewalk / road lines scrolling (parallax 1 — the play surface)
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    const lines = Math.ceil(W / 60) + 2;
    const off = -(cam.x % 60);
    for (let i = 0; i < lines; i++) {
      const x = off + i * 60;
      ctx.fillRect(x, groundY, 26, 2);
    }
    // depth band separators (arcs toward horizon)
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.lineWidth = 2;
    for (let d = 0; d < 5; d++) {
      const yy = TOP + d * (BOT - TOP) / 4;
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
    }
    ctx.restore();

    // foreground curb
    ctx.fillStyle = '#2e323b';
    ctx.fillRect(0, BOT + 14, W, H - BOT - 14);
  }

  // ---------------------------------------------------------------------
  //  HUD / DOM helpers
  // ---------------------------------------------------------------------
  const elScore = document.getElementById('score');
  const elHi = document.getElementById('hi-score');
  const elCombo = document.getElementById('combo');
  const elHp = document.getElementById('hp-fill');
  const elLives = document.getElementById('lives');
  let hiScore = +(localStorage.getItem('sb_hiscore') || 0);

  function updateHUD() {
    if (!player) return;
    elScore.textContent = 'SCORE ' + String(player.score).padStart(6, '0');
    if (player.score > hiScore) { hiScore = player.score; }
    elHi.textContent = 'HI ' + String(hiScore).padStart(6, '0');
    elHp.style.width = (player.hpRatio * 100) + '%';
    let hearts = '';
    for (let i = 0; i < 3; i++) hearts += i < player.lives ? '❤' : '🖤';
    elLives.textContent = hearts;
  }

  let lastComboShown = -1;
  function updateCombo() {
    if (player.combo >= 2) {
      elCombo.textContent = 'COMBO x' + player.combo;
      elCombo.classList.remove('hidden');
      elCombo.classList.toggle('big', player.combo >= 8);
      if (player.combo !== lastComboShown) {
        lastComboShown = player.combo;
        // re-trigger pop only when the count grows
        elCombo.style.animation = 'none'; void elCombo.offsetWidth; elCombo.style.animation = '';
      }
    } else {
      lastComboShown = -1;
      elCombo.classList.add('hidden');
    }
  }

  // ---------------------------------------------------------------------
  //  Game state / loop
  // ---------------------------------------------------------------------
  let state = 'menu'; // menu | playing | over | victory
  let player;
  let lastTime = 0;
  const uiHudTop = document.getElementById('hud-top');
  const uiHudBottom = document.getElementById('hud-bottom');
  const screenMenu = document.getElementById('screen-menu');
  const screenOver = document.getElementById('screen-over');
  const overTitle = document.getElementById('over-title');
  const overStat = document.getElementById('over-stat');

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;

  function startGame() {
    player = new Player(180, BOT - 70);
    player.scale = depthScale(player.cy);
    enemies = [];
    particles.length = 0; floatTexts.length = 0;
    waveNum = 1; waveState = 'idle';
    spawnQueue = []; spawnedThisWave = 0; totalToSpawn = 0; waveDelay = 0;
    gameOver = false; victory = false;
    cam.x = clamp(player.x - VIEW_W * 0.42, 0, WORLD_W - VIEW_W);
    state = 'playing';
    SFX.ensure();
    screenMenu.classList.add('hidden');
    screenOver.classList.add('hidden');
    uiHudTop.classList.remove('hidden');
    uiHudBottom.classList.remove('hidden');
    updateHUD();
  }

  function endGame(win) {
    state = win ? 'victory' : 'over';
    if (win) SFX.win(); else SFX.lose();
    if (player.score > hiScore) { hiScore = player.score; localStorage.setItem('sb_hiscore', hiScore); }
    overTitle.textContent = win ? '胜利！' : '游戏结束';
    overStat.textContent = (win ? '你打败了街头霸主！' : '你被击倒了…') +
      '\n最终得分 ' + player.score + ' · 击败 ' + totalKills + ' 人';
    screenOver.classList.remove('hidden');
  }

  function onVictory() { if (!victory) { victory = true; endGame(true); } }

  function update(dt) {
    if (gameOver || victory || state !== 'playing') return;
    player.update(dt);
    for (const e of enemies) e.update(dt, player);
    // remove dead enemies whose death animation has finished (kills counted in die())
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (enemies[i].rm) enemies.splice(i, 1);
    }
    updateWaves(dt);
    updateCamera(dt);
    updateFx(dt);
    updateCombo();

    // player death handled
    if (player.state === 'dead' && player.deadT > 1.2) {
      // respawn or game over
      if (player.lives > 0) {
        player.hp = player.maxHp;
        player.state = 'idle';
        player.invulnT = 1.5;
        player.x = clamp(player.x, 40, WORLD_W - 40);
        player.cy = BOT - 70;
        player.jumpOfs = 0; player.onGround = true;
      } else {
        gameOver = true;
        endGame(false);
      }
    }

    // softly hide wave banner
    if (waveBannerReset && performance.now() > waveBannerReset) {
      const el = document.getElementById('wave-banner');
      el.style.opacity = Math.max(0, (+el.style.opacity || 1) - dt * 1.2);
      if (el.style.opacity <= 0.01) el.classList.add('hidden');
    }
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawBackground(ctx);

    // apply camera shake
    ctx.save();
    if (cam.shake > 0) {
      ctx.translate(rnd(-1, 1) * cam.shake * 22, rnd(-1, 1) * cam.shake * 16);
    }

    // draw enemies and player sorted by cy (depth) so nearer ones draw on top
    const actors = [];
    for (const e of enemies) if (!e.rm) actors.push(e);
    if (player && player.state !== 'dead') actors.push(player);
    actors.sort((a, b) => (a.sy || a.cy) - (b.sy || b.cy));
    for (const a of actors) drawFighter(ctx, a);
    // dead player on top
    if (player && player.state === 'dead') drawFighter(ctx, player);

    drawFx(ctx);
    ctx.restore();

    // vignette
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.7);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,.45)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000 || 0.016);
    lastTime = now;
    if (state === 'playing') update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------------
  //  Events
  // ---------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    const k = keyMap[e.code];
    if (k) { keys[k] = true; e.preventDefault(); SFX.ensure(); }
    if (e.code === 'Enter' && state === 'menu') startGame();
    if (e.code === 'KeyH') SFX.muted = !SFX.muted;
  });
  window.addEventListener('keyup', (e) => {
    const k = keyMap[e.code];
    if (k) keys[k] = false;
  });

  document.getElementById('start-btn').addEventListener('click', () => { SFX.ensure(); startGame(); });
  document.getElementById('retry-btn').addEventListener('click', startGame);
  document.getElementById('mute-btn').addEventListener('click', () => {
    SFX.muted = !SFX.muted;
    document.getElementById('mute-btn').textContent = SFX.muted ? '🔇' : '🔊';
  });

  // start on first click anywhere too (for audio unlock)
  window.addEventListener('pointerdown', () => SFX.ensure());

  // initial render of menu behind overlay
  player = new Player(180, BOT - 70);
  player.scale = depthScale(player.cy);
  lastTime = performance.now();
  updateHUD();
  requestAnimationFrame(loop);

  // ---- optional debug / self-test hook (safe to leave in) ----
  window.__SB = {
    start: startGame,
    step: (n, dt) => { for (let i = 0; i < n; i++) { if (state === 'playing') update(dt || 1 / 60); render(); } },
    spawn: (k) => spawnEnemy(k || 'thug'),
    keys,
    player: () => player,
    enemies: () => enemies,
    cam: () => cam,
    setPlayerX: (x) => { player.x = x; },
    state: () => state,
    wave: () => waveState
  };
})();
