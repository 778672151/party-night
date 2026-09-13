/* fighter.js — 角色状态机：移动/攻击/防御/受身/连段/浮空/投技 */
(function (G) {
  'use strict';
  var M = G.M, R = G.Rig, PO = R.POSE, FX = G.FX, A = G.Audio;
  var GRAV = .86, HP_MAX = 1000, STOCK_MAX = 3, GUARD_MAX = 100;
  var LIGHT = ['5A', '5B', '2A', '2B', 'jA'], HEAVY = ['5C', '5D', '2C', '2D', 'jC', 'jD'];

  function VPad() { this.dir = 5; this.pdir = 5; this.held = {}; this.prev = {}; this.f = 0; this._mot = null; this.virtual = true; }
  VPad.prototype.begin = function () { this.f++; for (var k in this.held) this.prev[k] = this.held[k]; this._mot = null; };
  VPad.prototype.set = function (dir, btns, mot) {
    this.pdir = this.dir; this.dir = dir;
    this.held = { A: 0, B: 0, C: 0, D: 0 };
    if (btns) for (var i = 0; i < btns.length; i++) this.held[btns[i]] = 1;
    this._mot = mot || null;
  };
  VPad.prototype.down = function (b) { return !!this.held[b]; };
  VPad.prototype.hit = function (b) { return !!this.held[b] && !this.prev[b]; };
  VPad.prototype.hit2 = function (a, b) { return this.hit(a) && this.hit(b); };
  VPad.prototype.rel = function () { return this.dir; };
  VPad.prototype.motion = function (n) { return this._mot === n; };
  VPad.prototype.clearMotion = function () { this._mot = null; };

  function Fighter(o) {
    this.idx = o.idx; this.ch = o.ch; this.moves = G.Chars.buildMoves(o.ch);
    this.pal = this.ch.pal; this.pad = o.pad; this.cpu = !!o.cpu;
    this.name = this.ch.name;
    this.x = o.x || 0; this.y = 0; this.vx = 0; this.vy = 0; this.facing = o.facing || 1;
    this.hpMax = HP_MAX; this.hp = HP_MAX;
    this.stock = 0; this.meter = 0; this.meterMax = 1000; this.stockMax = STOCK_MAX;
    this.guard = GUARD_MAX; this.guardMax = GUARD_MAX;
    this.state = 'intro'; this.st = 0; this.animT = 0;
    this.move = null; this.mf = 0; this.hitReg = {}; this.moveHit = false; this.chainUsed = {};
    this.hitstop = 0; this.hitFlash = 0; this.wobble = 0; this.wobbleT = 0;
    this.grounded = true; this.crouching = false; this.blocking = false;
    this.invulT = 0; this.invulType = null;
    this.chainHits = 0; this.combo = 0; this.comboDmg = 0; this.comboT = 0; this.maxCombo = 0;
    this.juggle = 0; this.roundsWon = 0; this.pushW = 23 * (o.ch.weight > 1.2 ? 1.15 : 1);
    this.tapF = 0; this.tapB = 0; this.prejump = 0; this.hopHeld = 0;
    this.throwVictim = null; this.thrownBy = null;
    this.blendPose = null; this.blendT = 0; this.blendDur = 5;
    this.pose = R.P({}); this.J = null;
    this.superflash = 0; this.frozen = 0; this.lastHitAt = null;
    this.stats = { hits: 0, blocked: 0, taken: 0, dmgDealt: 0 };
    this.buf = { A: 0, B: 0, C: 0, D: 0 };
    this.trainingLock = false;
    this.updatePose();
  }
  Fighter.VPad = VPad;

  Fighter.prototype.opp = function () { return G.Game.other(this); };
  Fighter.prototype.isAttack = function () { return this.state === 'attack'; };
  Fighter.prototype.actionable = function () {
    return ['idle', 'walkF', 'walkB', 'crouch', 'blockS', 'blockC', 'dashF', 'dashB', 'air', 'landing'].indexOf(this.state) >= 0;
  };
  Fighter.prototype.hurtable = function () {
    return ['ko', 'thrown', 'win', 'intro', 'down'].indexOf(this.state) < 0 && this.invulT <= 0;
  };
  Fighter.prototype.busy = function () { return ['hitstun', 'hitAir', 'down', 'wakeup', 'dizzy', 'thrown', 'ko', 'blockstun'].indexOf(this.state) >= 0; };

  /* ---------- 姿势 ---------- */
  Fighter.prototype.rawPose = function () {
    var s = this.state, PP = PO;
    switch (s) {
      case 'idle': return R.loop(PP.idle, this.animT, 64);
      case 'walkF': return R.loop(PP.walkF, this.animT, 32);
      case 'walkB': return R.loop(PP.walkB, this.animT, 32);
      case 'crouch': return PP.crouch;
      case 'blockS': case 'blockstunS': return PP.blockS;
      case 'blockC': case 'blockstunC': return PP.blockC;
      case 'dashF': return PP.dashF;
      case 'dashB': return PP.dashB;
      case 'prejump': return PP.land;
      case 'landing': return PP.land;
      case 'air': return this.vy > 1 ? PP.jumpUp : PP.jumpFall;
      case 'hitstun': return this.hurtKind === 'low' ? PP.hurtLow : (this.hurtKind === 'hi' ? PP.hurtHi : PP.hurtMid);
      case 'hitAir': return PP.hurtAir;
      case 'down': return PP.down;
      case 'wakeup': return PP.wake;
      case 'dizzy': return R.loop(PP.dizzy, this.animT, 40);
      case 'thrown': return PP.thrown;
      case 'ko': return this.grounded && this.st > 6 ? PP.down : PP.hurtAir;
      case 'win': return R.loop(PP.win, this.animT, 48);
      case 'intro': return R.evalKeys(PP.intro, Math.min(this.st, 40));
      case 'blockstun': return this.crouching ? PP.blockC : PP.blockS;
      case 'attack': return R.evalKeys(this.move.keys, this.mf);
    }
    return R.P({});
  };
  Fighter.prototype.updatePose = function () {
    var raw = this.rawPose();
    if (this.blendT > 0) {
      var t = 1 - this.blendT / this.blendDur;
      this.pose = R.blend(this.blendPose, raw, M.smooth(t));
      this.blendT--;
    } else this.pose = raw;
    var wob = 0;
    if (this.wobbleT > 0) { wob = Math.sin(this.wobbleT * 1.9) * this.wobble; }
    this.J = R.world(this.pose, this.x + wob, this.y, this.facing, 1);
  };
  Fighter.prototype.setState = function (s, keepBlend) {
    if (this.state === s) return;
    if (!keepBlend) { this.blendPose = this.pose; this.blendT = this.blendDur; }
    this.state = s; this.st = 0;
    if (s !== 'attack') { this.move = null; }
  };

  /* ---------- 判定 ---------- */
  Fighter.prototype.activeHits = function () {
    var out = [];
    if (this.state !== 'attack' || !this.move || !this.move.hits) return out;
    for (var i = 0; i < this.move.hits.length; i++) {
      var h = this.move.hits[i];
      if (this.mf >= h.act[0] && this.mf <= h.act[1] && !this.hitReg[i])
        out.push({ i: i, h: h, cap: R.hitCapsule(this.J, h.box) });
    }
    return out;
  };
  Fighter.prototype.skipLimb = function () {
    if (this.state !== 'attack' || !this.move || !this.move.hits) return null;
    for (var i = 0; i < this.move.hits.length; i++) {
      var h = this.move.hits[i];
      if (this.mf >= h.act[0] - 1 && this.mf <= h.act[1] + 1 && h.skip) return h.skip;
    }
    return null;
  };
  Fighter.prototype.hurtboxes = function () {
    if (!this.hurtable() && this.state !== 'thrown') return [];
    return R.hurtboxes(this.J, { skip: this.skipLimb() });
  };
  Fighter.prototype.pushbox = function () {
    var top = this.state === 'crouch' || this.crouching ? 110 : 178;
    if (this.state === 'down' || this.state === 'ko' && this.grounded) top = 60;
    var w = this.pushW;
    return { x0: this.x - w, x1: this.x + w, y0: this.y, y1: this.y + top };
  };

  /* ---------- 主更新 ---------- */
  Fighter.prototype.update = function () {
    this.animT++;
    if (this.comboT > 0) { this.comboT--; if (this.comboT === 0) { this.combo = 0; this.comboDmg = 0; } }
    if (this.hitFlash > 0) this.hitFlash--;
    if (this.wobbleT > 0) this.wobbleT--;
    /* 输入缓冲：顿帧中也记录按键，取消/连段手感更好 */
    var pad = this.pad;
    if (pad) ['A', 'B', 'C', 'D'].forEach(function (k) { if (pad.hit(k)) this.buf[k] = 6; }, this);
    if (this.frozen > 0) { this.frozen--; this.updatePose(); return; }
    if (this.hitstop > 0) { this.hitstop--; this.updatePose(); return; }
    if (this.invulT > 0) this.invulT--;
    for (var b in this.buf) if (this.buf[b] > 0) this.buf[b]--;
    if (this.tapF > 0) this.tapF--; if (this.tapB > 0) this.tapB--;
    this.st++;

    switch (this.state) {
      case 'intro': if (this.st > 46) this.setState('idle'); break;
      case 'attack':
        if (!G.Game.locked && this.superflash <= 0 && this.cancelWindowOpen() && this.tryAttacks(true)) break;
        this.updateAttack(); break;
      case 'hitstun': case 'blockstun':
        this.applyFriction(.82);
        if (this.st >= this.stunT) { this.chainHits = 0; this.setState(this.crouchHeld() ? 'crouch' : 'idle'); }
        break;
      case 'hitAir':
        if (this.grounded) {
          if (this.hardKD) { this.setState('down'); this.st = 0; this.onLandHard(); }
          else { this.setState('down'); this.onLandHard(); }
        }
        break;
      case 'down':
        this.applyFriction(.7);
        if (this.st >= 26) { this.setState('wakeup'); this.invulT = 8; }
        break;
      case 'wakeup': if (this.st >= 12) { this.chainHits = 0; this.juggle = 0; this.setState('idle'); } break;
      case 'dizzy': this.applyFriction(.8); if (this.st >= 90) { this.guard = GUARD_MAX; this.setState('idle'); } break;
      case 'thrown': this.updateThrown(); break;
      case 'ko': this.applyFriction(this.grounded ? .82 : 1); break;
      case 'win': this.applyFriction(.8); break;
      case 'prejump':
        if (this.st >= 3) this.doJump();
        break;
      case 'dashF':
        this.vx = this.facing * this.ch.dashSpd;
        if (this.st % 5 === 0) FX.dust(this.x - this.facing * 12, 2, -this.facing, 2);
        if (this.st >= 18) { this.setState('idle'); }
        this.handleInput(true);
        break;
      case 'dashB':
        if (this.st >= 20) this.setState('idle');
        break;
      case 'landing': if (this.st >= (this.landT || 4)) { this.chainUsed = {}; this.setState('idle'); } break;
      default: this.handleInput(false); break;
    }
    this.physics();
    this.updatePose();
  };

  Fighter.prototype.crouchHeld = function () {
    if (!this.pad || this.cpuNoCrouch) return false;
    var d = this.pad.rel(this.facing);
    return d === 1 || d === 2 || d === 3;
  };
  Fighter.prototype.applyFriction = function (k) { this.vx *= k; if (Math.abs(this.vx) < .05) this.vx = 0; };

  Fighter.prototype.physics = function () {
    this.x += this.vx;
    if (!this.grounded) {
      this.vy -= GRAV; this.y += this.vy;
      if (this.y <= 0) {
        this.y = 0; this.grounded = true;
        var hard = this.state === 'hitAir' || this.state === 'ko';
        var mvL = this.move;
        if (this.state === 'attack' && mvL && (mvL.air || mvL.autoLand)) {
          this.setState('landing'); this.landT = mvL.landCancel ? 4 : 8; this.chainUsed = {};
          FX.dust(this.x, 2, this.facing, 5); A.play('land', .7);
        } else if (this.state === 'air') {
          this.setState('landing'); this.landT = 3; this.chainUsed = {};
          FX.dust(this.x, 2, this.facing, 5); A.play('land', .6);
        } else if (this.state === 'dashB') { this.setState('landing'); this.landT = 3; }
        if (!hard) this.vy = 0;
        else { this.vy = 0; FX.dust(this.x, 2, this.facing, 8); }
      }
    }
  };
  Fighter.prototype.onLandHard = function () {
    FX.dust(this.x, 2, -this.facing, 10, '#b8ac95');
    FX.shake(6, 0, 1, 12); A.play('land');
    FX.ring(this.x, 6, 8, 60, 'rgba(255,255,255,.5)', 14, 3);
  };

  /* ---------- 输入 ---------- */
  Fighter.prototype.handleInput = function (dashing) {
    var pad = this.pad; if (!pad) return;
    if (G.Game && G.Game.locked) {
      this.vx = 0; this.blocking = false;
      if (this.state !== 'idle' && this.state !== 'intro') this.setState('idle');
      return;
    }
    var d = pad.rel(this.facing), fwd = (d === 6 || d === 9 || d === 3), back = (d === 4 || d === 7 || d === 1);
    var down = (d === 1 || d === 2 || d === 3), up = (d === 7 || d === 8 || d === 9);
    var opp = this.opp();

    if (this.tryAttacks(false)) return;
    if (!this.grounded) return;

    /* 跳跃 */
    if (up && this.state !== 'prejump') { this.setState('prejump'); this.jumpDir = fwd ? 1 : back ? -1 : 0; return; }
    /* 冲刺（双击） */
    var dirNow = d;
    if (dirNow !== this.lastDir) {
      if (dirNow === 6) { if (this.tapF > 0 && this.state !== 'dashF') { this.startDash(1); this.lastDir = dirNow; return; } this.tapF = 13; }
      if (dirNow === 4) { if (this.tapB > 0) { this.startDash(-1); this.lastDir = dirNow; return; } this.tapB = 13; }
      this.lastDir = dirNow;
    }
    if (dashing) return;
    /* 防御/移动 */
    var oppAttacking = opp && opp.state === 'attack';
    if (back) {
      this.blocking = true; this.crouching = down;
      if (down) { this.setState('blockC'); } else { this.setState('blockS'); }
      this.vx = this.facing * -this.ch.back * (oppAttacking ? .35 : 1);
      if (!oppAttacking) { this.setState(down ? 'crouch' : 'walkB'); this.blocking = true; this.crouching = down; }
      return;
    }
    this.blocking = false;
    if (down) { this.crouching = true; this.setState('crouch'); this.vx = 0; return; }
    this.crouching = false;
    if (fwd) { this.setState('walkF'); this.vx = this.facing * this.ch.walk; return; }
    this.setState('idle'); this.vx = 0;
  };

  /* 出招（cancel=true 时用于连段取消，只允许普通/必杀/超必杀） */
  Fighter.prototype.tryAttacks = function (cancel) {
    var pad = this.pad, opp = this.opp();
    var d = pad.rel(this.facing), fwd = (d === 6 || d === 9 || d === 3), back = (d === 4 || d === 7 || d === 1);
    var down = (d === 1 || d === 2 || d === 3);
    /* 必杀技/超必杀（优先级最高） */
    if (this.tryCommandMoves()) return true;
    if (!cancel && this.grounded) {
      /* 系统技 */
      if (pad.hit2('C', 'D') && this.buf.C && this.buf.D) { this.buf.C = this.buf.D = 0; if (this.startMove('CD')) return true; }
      if (pad.hit2('A', 'B') && this.buf.A && this.buf.B) { this.buf.A = this.buf.B = 0; if (this.startMove('roll')) { A.play('roll'); return true; } }
      /* 投技：近身 + 前/后 + 重拳 */
      if (this.buf.C && (fwd || back) && opp && Math.abs(opp.x - this.x) < this.moves['throw'].range
        && opp.grounded && !opp.busy() && opp.state !== 'attack') {
        this.buf.C = 0; if (this.startThrow()) return true;
      }
    }
    /* 普通技 */
    var nm = null;
    if (!this.grounded) { nm = this.buf.C ? 'jC' : this.buf.D ? 'jD' : (this.buf.A || this.buf.B) ? 'jA' : null; }
    else if (down) { nm = this.buf.A ? '2A' : this.buf.B ? '2B' : this.buf.C ? '2C' : this.buf.D ? '2D' : null; }
    else { nm = this.buf.A ? '5A' : this.buf.B ? '5B' : this.buf.C ? '5C' : this.buf.D ? '5D' : null; }
    if (nm) {
      var key = nm.charAt(nm.length - 1);
      if (this.startMove(nm)) { this.buf[key] = 0; return true; }
    }
    return false;
  };
  Fighter.prototype.tryCommandMoves = function () {
    var pad = this.pad, i, m, sp;
    var P = this.buf.A || this.buf.C, KK = this.buf.B || this.buf.D;
    if (!P && !KK) return false;
    /* 超必杀 */
    m = this.moves['super'];
    if (m && this.stock >= (m.meterCost || 1) && ((m.btn === 'P' && P) || (m.btn === 'K' && KK)) && pad.motion(m.motion, 34, this.facing)) {
      if (this.startMove('super')) { pad.clearMotion(); this.clearBuf(); return true; }
    }
    for (i = 0; i < this.ch.specials.length; i++) {
      sp = this.ch.specials[i]; m = this.moves[sp.id];
      if (!m) continue;
      var okBtn = (m.btn === 'P' && P) || (m.btn === 'K' && KK);
      if (!okBtn) continue;
      if (m.air && !this.grounded && !m.autoLand) continue;
      if (!this.grounded) continue;
      if (pad.motion(m.motion, 26, this.facing)) {
        if (this.startMove(sp.id)) { pad.clearMotion(); this.clearBuf(); return true; }
      }
    }
    return false;
  };
  Fighter.prototype.clearBuf = function () { this.buf.A = this.buf.B = this.buf.C = this.buf.D = 0; };

  Fighter.prototype.startDash = function (dir) {
    if (dir > 0) { this.setState('dashF'); this.vx = this.facing * this.ch.dashSpd; A.play('dash', .8); FX.dust(this.x, 2, -this.facing, 5); }
    else {
      this.setState('dashB'); this.vx = -this.facing * this.ch.dashSpd * .95; this.vy = 7.5; this.grounded = false;
      this.invulT = 7; this.invulType = 'all'; A.play('dash', .7); FX.dust(this.x, 2, this.facing, 5);
    }
  };
  Fighter.prototype.doJump = function () {
    var held = this.pad ? (this.pad.rel(this.facing) >= 7) : false;
    var jv = this.ch.jump * (held ? 1 : .74);
    this.vy = jv; this.grounded = false; this.setState('air');
    this.vx = this.facing * (this.jumpDir || 0) * (this.ch.walk * 1.32);
    A.play('jump', .8); FX.dust(this.x, 2, -this.facing * (this.jumpDir || 1), 4);
    this.chainUsed = {};
  };

  /* ---------- 招式 ---------- */
  Fighter.prototype.cancelWindowOpen = function () {
    var mv = this.move; if (!mv) return false;
    if (mv.kind === 'super') return false;
    if (mv.cancelSuper && this.moveHit && this.stock >= 1) return true;
    var c = mv.cancel;
    if (!c || !c.into.length) return false;
    if (this.mf < c.win[0] || this.mf > c.win[1]) return false;
    if (c.on === 'hit' && !this.moveHit) return false;
    return true;
  };
  Fighter.prototype.canCancelInto = function (id) {
    if (this.state !== 'attack' || !this.move) return true;
    var mv = this.move, tgt = this.moves[id], c = mv.cancel;
    if (mv.kind === 'super') return false;
    var grp = id === 'super' ? 'super' : (LIGHT.indexOf(id) >= 0 ? 'light' :
      HEAVY.indexOf(id) >= 0 ? 'heavy' : (tgt && tgt.kind === 'special') ? 'special' : 'none');
    if (grp === 'none') return false;
    if (grp === 'super' && mv.cancelSuper && this.moveHit) return true;
    if (!c) return false;
    if (this.mf < c.win[0] || this.mf > c.win[1]) return false;
    if (c.on === 'hit' && !this.moveHit) return false;
    if (c.into.indexOf(grp) < 0) return false;
    if (grp === 'light' || grp === 'heavy') { if (this.chainUsed[id]) return false; }
    return true;
  };
  Fighter.prototype.startMove = function (id) {
    var mv = this.moves[id]; if (!mv) return false;
    if (this.state === 'attack' && !this.canCancelInto(id)) return false;
    if (mv.air && !mv.autoLand && this.grounded && ['jA', 'jC', 'jD'].indexOf(id) >= 0) return false;
    if (!mv.air && ['jA', 'jC', 'jD'].indexOf(id) < 0 && !this.grounded && mv.kind !== 'special') return false;
    if (mv.meterCost) { if (this.stock < mv.meterCost) return false; this.stock -= mv.meterCost; }
    if (this.state !== 'attack') { this.blendPose = this.pose; this.blendT = 3; }
    else { this.blendPose = this.pose; this.blendT = 2; }
    this.state = 'attack'; this.st = 0; this.move = mv; this.mf = 0;
    this.hitReg = {}; this.moveHit = false; this.whiffed = {};
    this.chainUsed[id] = true;
    this.crouching = !!mv.crouch;
    if (mv.kind === 'special' || mv.kind === 'super') {
      A.play(this.ch.voice, .9);
      if (mv.kind === 'super') {
        this.superflash = mv.superflash.dur;
        G.Game.startSuperFlash(this, mv.superflash);
      }
    }
    if (mv.kind === 'throw') A.play('whiffL', .8);
    return true;
  };

  Fighter.prototype.updateAttack = function () {
    var mv = this.move, i;
    if (this.superflash > 0) { this.superflash--; this.updatePose(); return; }
    /* 位移关键帧 */
    if (mv.vel) for (i = 0; i < mv.vel.length; i++) {
      var v = mv.vel[i];
      if (v.t === this.mf) {
        if (v.vx !== undefined && v.vx !== null) this.vx = this.facing * v.vx;
        if (v.vy !== undefined && v.vy !== null) { this.vy = v.vy; if (v.vy > 0) this.grounded = false; }
      }
    }
    if (mv.slide && this.grounded) this.vx *= mv.slide;
    if (!mv.vel && this.grounded && mv.kind !== 'special') this.vx *= .8;
    /* 无敌帧 */
    if (mv.invul && this.mf >= mv.invul.win[0] && this.mf <= mv.invul.win[1]) { this.invulT = 2; this.invulType = mv.invul.type; }
    /* 蓄力/气焰特效 */
    if (mv.charge && this.mf >= mv.charge.t && this.mf < (mv.spawn ? mv.spawn.t : mv.total)) {
      var j = this.J[mv.charge.at];
      FX.flame(j.x, j.y, this.facing, mv.charge.col);
      if (this.mf === mv.charge.t) A.play('fire', .7);
    }
    if (mv.aura && this.mf >= mv.aura.win[0] && this.mf <= mv.aura.win[1] && this.mf % 2 === 0) {
      var ja = this.J[mv.aura.at];
      FX.flame(ja.x + M.rnd(-10, 10), ja.y + M.rnd(-14, 14), this.facing, mv.aura.col);
      if (mv.aura.big) FX.ember(this.x + M.rnd(-30, 30), M.rnd(0, 60), mv.aura.col2);
    }
    /* 残影 */
    if ((mv.kind === 'super' || (mv.vel && Math.abs(this.vx) > 5)) && this.mf % 2 === 0)
      FX.ghost(this.J, this.pal, .3, this.ch.auraCol);
    /* 发射道具 */
    if (mv.spawn && this.mf === mv.spawn.t) {
      var jj = this.J[mv.spawn.at];
      G.Game.spawnProjectile(this, mv.spawn, jj.x, jj.y);
      A.play('fire'); FX.ring(jj.x, jj.y, 8, 46, mv.spawn.col2, 12, 3); FX.flash(.10, mv.spawn.col2);
    }
    /* 投技判定 */
    if (mv.kind === 'throw' && this.mf === 3) this.resolveThrow(mv.throwDmg, mv.range, false);
    if (mv.grab && this.mf === mv.grab.act[0]) this.resolveThrow(mv.grab.dmg, mv.grab.r, true);
    if (mv.kind === 'throw' && this.throwVictim && this.mf === 12) this.releaseThrow();
    if (mv.grab && this.throwVictim && this.mf === mv.grab.act[0] + 14) this.releaseThrow();
    /* 挥空音 + 判定轨迹 */
    if (mv.hits) for (i = 0; i < mv.hits.length; i++) {
      var h = mv.hits[i];
      if (this.mf === h.act[0]) { if (mv.whiff) A.play(mv.whiff, .85); }
      if (this.mf >= h.act[0] && this.mf <= h.act[1] && !this.hitReg[i]) {
        FX.trail(R.hitCapsule(this.J, h.box), mv.trailCol || 'rgba(255,255,255,.4)', 9);
      }
    }
    this.mf++;
    if (this.mf >= mv.total) {
      this.chainUsed = {};
      if (!this.grounded) this.setState('air');
      else this.setState(this.crouchHeld() ? 'crouch' : 'idle');
      this.crouching = this.crouchHeld();
    }
  };

  /* ---------- 投技 ---------- */
  Fighter.prototype.startThrow = function () { return this.startMove('throw'); };
  Fighter.prototype.resolveThrow = function (dmg, range, cmd) {
    var o = this.opp();
    if (!o || !o.grounded || o.busy() || !o.hurtable()) { return; }
    if (Math.abs(o.x - this.x) > (range || 74)) return;
    this.throwVictim = o; this.throwDmg = dmg; this.throwCmd = cmd;
    o.setState('thrown'); o.thrownBy = this; o.vx = 0; o.vy = 0; o.grounded = true;
    o.hitstop = 0; o.chainHits = 0;
    A.play('hitM'); FX.shake(5, this.facing, 0, 10);
    FX.text(o.x, 150, cmd ? '掴んだ!' : 'GRAB', { col: '#ffd15c', size: 20, life: 26 });
  };
  Fighter.prototype.releaseThrow = function () {
    var o = this.throwVictim; if (!o) return;
    var dmg = this.throwDmg * (1 / o.ch.def);
    o.hp = Math.max(0, o.hp - dmg);
    o.vx = -this.facing * (this.throwCmd ? 6.5 : 8.2); o.vy = this.throwCmd ? 6 : 11; o.grounded = false;
    o.setState('hitAir'); o.hardKD = true; o.hitstop = 12; o.hitFlash = 8; o.wobble = 4; o.wobbleT = 12;
    this.hitstop = 12;
    var cx = o.x, cy = 70;
    FX.spark(cx, cy, { power: 3, radius: 26, dir: this.facing, color: '#fff3c0', color2: '#ff8a2e' });
    FX.shockwave(cx, cy, 120, '#ffffff'); FX.shake(16, this.facing, .5, 20); FX.flash(.22);
    FX.zoomPunch(.1, 16); FX.slow(8, .3);
    FX.text(cx, cy + 40, Math.round(dmg) + '', { col: '#ffe9a8', size: 32, life: 40 });
    A.play('hitH'); A.play('voiceHit', .9);
    G.Input.rumble(o.idx, .9, 160);
    this.registerCombo(dmg, o);
    this.throwVictim = null;
    o.thrownBy = null;
    this.addMeter(dmg * .4); o.addMeter(dmg * .3);
    if (o.hp <= 0) o.die();
  };
  Fighter.prototype.updateThrown = function () {
    var by = this.thrownBy;
    if (by) {
      var hold = by.J ? by.J.hF : null;
      if (hold) { this.x = M.lerp(this.x, by.x + by.facing * 52, .5); }
      this.facing = -by.facing;
    }
    if (this.st > 40) { this.setState('idle'); this.thrownBy = null; }
  };

  /* ---------- 受击 ---------- */
  Fighter.prototype.canBlockHit = function (h) {
    if (!this.blocking) return false;
    if (!this.grounded) return false;
    if (h.guard === 'un') return false;
    if (h.guard === 'low' && !this.crouching) return false;
    if (h.guard === 'high' && this.crouching) return false;
    return true;
  };
  Fighter.prototype.comboScale = function () {
    var n = this.chainHits;
    if (n <= 0) return 1;
    return Math.max(.30, 1 - n * .085);
  };
  Fighter.prototype.takeHit = function (atk, h, cp, capR) {
    var i;
    if (!this.hurtable()) return false;
    if (this.invulT > 0) return false;
    var blocked = this.canBlockHit(h);
    var dirX = atk.facing;
    var lvl = h.level || 1;
    var radius = Math.max(12, (capR || 16));

    if (blocked) {
      var chip = h.chip ? h.chip * .5 : 0;
      if (chip) this.hp = Math.max(1, this.hp - chip);
      this.guard -= 6 + lvl * 5;
      this.stunT = h.blockstun; this.setState('blockstun'); this.st = 0;
      this.vx = dirX * (h.push[0] * .55); this.hitstop = Math.max(3, h.hitstop - 2);
      atk.hitstop = Math.max(3, h.hitstop - 2);
      this.wobble = 2.2; this.wobbleT = this.hitstop + 3;
      FX.guardSpark(cp.x, cp.y, -dirX, radius);
      FX.shake(3 + lvl, dirX, 0, 8); A.play('guard', .9);
      FX.text(cp.x, cp.y + 26, 'GUARD', { col: '#9ad8ff', size: 15, life: 22, vy: .8 });
      this.addMeter(h.dmg * .18); atk.addMeter(h.dmg * .16);
      atk.stats.blocked++;
      G.Input.rumble(this.idx, .25, 60);
      if (this.guard <= 0) this.guardCrush();
      return 'block';
    }
    /* counter hit：对手在出招前段被打 */
    var counter = (this.state === 'attack' && this.move && this.move.hits && this.move.hits.length &&
      this.mf < this.move.hits[0].act[0]);
    var scale = h.noScale ? Math.max(.55, 1 - this.chainHits * .03) : this.comboScale();
    var dmg = h.dmg * scale * (1 / this.ch.def) * (counter ? 1.25 : 1);
    dmg = Math.max(1, Math.round(dmg));
    this.hp = Math.max(0, this.hp - dmg);
    this.chainHits++;
    var hs = h.hitstop + (counter ? 5 : 0) + (lvl >= 3 ? 2 : 0);
    this.hitstop = hs; atk.hitstop = hs;
    this.hitFlash = Math.min(8, 3 + lvl);
    this.wobble = 1.6 + lvl * 1.1; this.wobbleT = hs + 4;
    this.invulT = 0;
    this.hurtKind = cp.y > this.y + 130 ? 'hi' : (cp.y < this.y + 70 ? 'low' : 'mid');
    /* 击退与浮空 */
    var air = !this.grounded || h.launch > 0 || h.kd;
    if (h.stick) { this.vx = dirX * h.push[0]; if (!this.grounded) this.vy = Math.max(this.vy, 1.2); this.stunT = h.hitstun; this.setState(this.grounded ? 'hitstun' : 'hitAir'); this.st = 0; }
    else if (h.launch > 0) {
      this.juggle++;
      var lv = h.launch * Math.max(.55, 1 - (this.juggle - 1) * .16);
      this.vy = lv; this.vx = dirX * h.push[0] * .8; this.grounded = false;
      this.setState('hitAir'); this.st = 0; this.hardKD = !!h.kd || !!h.wallSlam;
    } else if (!this.grounded) {
      this.vy = Math.max(-2, this.vy * .3 + 3.2); this.vx = dirX * h.push[0] * 1.05;
      this.setState('hitAir'); this.st = 0; this.hardKD = true;
    } else if (h.kd) {
      this.vx = dirX * h.push[0] * 1.1; this.vy = 6.4; this.grounded = false;
      this.setState('hitAir'); this.st = 0; this.hardKD = true;
    } else {
      this.vx = dirX * h.push[0]; this.stunT = Math.round(h.hitstun * (h.noScale ? 1 : Math.max(.6, scale)));
      this.setState('hitstun'); this.st = 0;
    }
    if (h.wallSlam) this.wallSlam = 1;
    /* ------- 打击感 ------- */
    var sparkCol = { light: ['#ffffff', '#8fd0ff'], mid: ['#fff4c8', '#ff9a2e'], heavy: ['#fff9d8', '#ff7a1a'],
      fire: ['#fff0b0', '#ff5a10'], elec: ['#eaffff', '#4fa8ff'], super: ['#ffffff', '#ffcf3a'] }[h.spark || 'mid'];
    FX.spark(cp.x, cp.y, { power: Math.min(3, lvl), radius: radius, dir: dirX, color: sparkCol[0], color2: sparkCol[1] });
    if (lvl >= 3) { FX.shockwave(cp.x, cp.y, 60 + lvl * 34, sparkCol[1]); FX.flash(.10 + lvl * .03, sparkCol[0]); }
    if (h.finisher) { FX.radialBurst(cp.x, cp.y, sparkCol[1], 22); FX.flash(.5, '#fff'); FX.slow(20, .2); FX.zoomPunch(.16, 30); }
    FX.shake((h.shake || (3 + lvl * 2)) * (counter ? 1.3 : 1), dirX, lvl >= 3 ? .35 : .1, 10 + lvl * 3);
    if (lvl >= 3) FX.slow(h.finisher ? 18 : 6, .3);
    if (lvl >= 2) FX.zoomPunch(.02 + lvl * .014, 12);
    A.play(h.sfx || 'hitM');
    if (lvl >= 3) A.play('voiceHit', .8);
    G.Input.rumble(this.idx, Math.min(1, .3 + lvl * .22), 60 + lvl * 40);
    /* 数字与文本 */
    atk.registerCombo(dmg, this);
    FX.text(cp.x + M.rnd(-8, 8), cp.y + 18, '' + dmg, { col: counter ? '#ff6a6a' : (lvl >= 3 ? '#ffe9a8' : '#ffffff'),
      size: 16 + lvl * 5, life: 34, vx: dirX * .5, vy: 1.5 });
    if (counter) FX.text(cp.x, cp.y + 54, 'COUNTER', { col: '#ff5a5a', size: 20, life: 34 });
    this.addMeter(dmg * .38); atk.addMeter(dmg * .5);
    atk.stats.hits++; atk.stats.dmgDealt += dmg; this.stats.taken++;
    if (this.hp <= 0) this.die();
    return 'hit';
  };
  Fighter.prototype.guardCrush = function () {
    this.guard = 0; this.setState('dizzy'); this.st = 0;
    this.vx = -this.facing * 3; this.hitstop = 8;
    FX.text(this.x, 190, 'GUARD CRUSH', { col: '#ff8a3a', size: 26, life: 60 });
    FX.shockwave(this.x, 110, 140, '#ffd15c'); FX.shake(14, 1, .6, 22); FX.flash(.24, '#ffd15c');
    A.play('guardCrush');
  };
  Fighter.prototype.registerCombo = function (dmg, victim) {
    this.combo++; this.comboDmg += dmg; this.comboT = 70;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    G.Game.onCombo(this, victim);
  };
  Fighter.prototype.addMeter = function (v) {
    if (this.stock >= this.stockMax) { this.meter = this.meterMax; return; }
    this.meter += v;
    while (this.meter >= this.meterMax && this.stock < this.stockMax) {
      this.meter -= this.meterMax; this.stock++; A.play('meter');
      FX.text(this.x, 200, 'POWER MAX', { col: '#ffd15c', size: 16, life: 30 });
    }
    if (this.stock >= this.stockMax) this.meter = this.meterMax;
  };
  Fighter.prototype.die = function () {
    this.hp = 0;
    this.setState('ko'); this.st = 0;
    this.vx = -this.facing * 6.5; this.vy = 9; this.grounded = false;
    this.hitstop = 16; this.hitFlash = 10;
    G.Game.onKO(this);
  };
  Fighter.prototype.regen = function () {
    if (['blockS', 'blockC', 'blockstun'].indexOf(this.state) < 0 && this.guard < this.guardMax)
      this.guard = Math.min(this.guardMax, this.guard + .32);
  };
  Fighter.prototype.reset = function (x, facing, full) {
    this.x = x; this.y = 0; this.vx = 0; this.vy = 0; this.facing = facing;
    this.state = 'intro'; this.st = 0; this.move = null; this.mf = 0;
    this.grounded = true; this.crouching = false; this.blocking = false;
    this.hitstop = 0; this.invulT = 0; this.chainHits = 0; this.combo = 0; this.comboDmg = 0;
    this.juggle = 0; this.guard = this.guardMax; this.hardKD = false; this.throwVictim = null; this.thrownBy = null;
    this.chainUsed = {}; this.hitReg = {}; this.blendT = 0; this.superflash = 0; this.frozen = 0;
    if (full) { this.hp = this.hpMax; this.stock = 0; this.meter = 0; this.roundsWon = 0; }
    else this.hp = this.hpMax;
    this.updatePose();
  };

  /* ---------- 绘制 ---------- */
  Fighter.prototype.draw = function (ctx, V) {
    var o = {};
    if (this.hitFlash > 0) o.white = this.hitFlash > 2 ? 1 : 0;
    if (this.invulT > 0 && this.state !== 'attack') o.alpha = .55 + Math.sin(this.animT) * .2;
    if (this.state === 'hitstun' || this.state === 'hitAir' || this.state === 'ko') o.mouth = 1;
    if (this.state === 'attack' && this.move && this.move.kind !== 'system') o.mouth = .6;
    if (this.hp <= 0) o.tint = '#553344', o.tintA = .3;
    /* 蓄气/超杀光环 */
    if (this.state === 'attack' && this.move && this.move.kind === 'super' && this.superflash > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      var g = ctx.createRadialGradient(V.tx(this.x), V.ty(90), 0, V.tx(this.x), V.ty(90), 220 * V.z);
      g.addColorStop(0, 'rgba(255,220,120,.55)'); g.addColorStop(1, 'rgba(255,120,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(V.tx(this.x), V.ty(90), 220 * V.z, 0, M.TAU); ctx.fill(); ctx.restore();
    }
    R.draw(ctx, this.J, this.pal, o, V);
  };
  Fighter.prototype.drawShadow = function (ctx, V) {
    var k = M.clamp(1 - this.y / 240, .25, 1);
    ctx.save(); ctx.globalAlpha = .34 * k; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(V.tx(this.x), V.ty(1), 34 * V.z * k, 9 * V.z * k, 0, 0, M.TAU); ctx.fill(); ctx.restore();
  };

  G.Fighter = Fighter;
})(window.G);
