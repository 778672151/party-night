/* ai.js — CPU 对手：距离决策 + 反应延迟 + 反制/对空/连段 */
(function (G) {
  'use strict';
  var M = G.M;
  function AI(f, level) {
    this.f = f; this.level = level === undefined ? 2 : level; // 0..3
    this.t = 0; this.plan = null; this.planT = 0; this.react = 0;
    this.dir = 5; this.btns = []; this.mot = null; this.holdT = 0;
    this.lastState = '';
  }
  var PARAM = [
    { block: .30, react: 14, aggr: .30, aa: .30, sp: .18, sup: .25, thr: .06 },
    { block: .55, react: 10, aggr: .48, aa: .55, sp: .34, sup: .45, thr: .12 },
    { block: .76, react: 7, aggr: .62, aa: .78, sp: .5, sup: .7, thr: .2 },
    { block: .92, react: 4, aggr: .78, aa: .93, sp: .68, sup: .9, thr: .3 }
  ];
  AI.prototype.p = function () { return PARAM[M.clamp(this.level, 0, 3)]; };

  AI.prototype.update = function () {
    var f = this.f, o = f.opp(), pad = f.pad, p = this.p();
    this.t++;
    var dx = o.x - f.x, adx = Math.abs(dx), toward = dx > 0 ? 1 : -1;
    var rel = toward === f.facing ? 6 : 4, relBack = toward === f.facing ? 4 : 6;
    var dir = 5, btns = [], mot = null;

    if (!f.actionable() && f.state !== 'attack') { pad.set(5, [], null); return; }
    if (this.planT > 0) this.planT--;

    /* 反应：对手出招 -> 防御 or 反击 */
    var oppAtk = o.state === 'attack' && o.move;
    var incoming = oppAtk && o.move.hits && o.move.hits.length && o.mf <= o.move.hits[0].act[1];
    var oppAir = !o.grounded;

    if (this.planT <= 0) {
      this.plan = this.decide(adx, incoming, oppAir, p, o);
      this.planT = this.plan.dur || 12;
      this.planStep = 0;
    }
    var pl = this.plan;
    switch (pl.k) {
      case 'block': dir = relBack; if (pl.low) dir = relBack === 4 ? 1 : 3; break;
      case 'approach': dir = rel; if (adx < 150 && Math.random() < .04) dir = rel + 3; break;
      case 'retreat': dir = relBack; break;
      case 'crouch': dir = 2; break;
      case 'wait': dir = 5; break;
      case 'jumpin': dir = rel + 3; if (this.planT < pl.dur - 8 && adx < 190) btns = ['D']; break;
      case 'attack':
        if (this.planT === pl.dur - 1) { btns = [pl.btn]; if (pl.low) dir = 2; }
        else if (pl.chain && this.planT === pl.dur - 8) { btns = [pl.btn2 || 'C']; if (pl.low) dir = 2; }
        break;
      case 'special':
        if (this.planT === pl.dur - 1) { btns = [pl.btn]; mot = pl.mot; dir = pl.endDir === undefined ? 6 : pl.endDir; }
        break;
      case 'throw':
        if (this.planT === pl.dur - 1) { btns = ['C']; dir = rel; }
        else dir = rel;
        break;
      case 'roll': if (this.planT === pl.dur - 1) btns = ['A', 'B']; break;
    }
    pad.set(dir, btns, mot);
  };

  AI.prototype.decide = function (adx, incoming, oppAir, p, o) {
    var f = this.f, r = Math.random();
    /* 被压制：防御 */
    if (incoming && adx < 210) {
      if (r < p.block) return { k: 'block', dur: 12 + M.rndi(0, 10), low: Math.random() < .5 };
      if (r < p.block + .12 && f.stock >= 1 && Math.random() < p.sup) return this.superPlan();
      if (r < p.block + .2) return { k: 'roll', dur: 30 };
    }
    /* 对空 */
    if (oppAir && adx < 150 && Math.random() < p.aa) {
      if (f.stock >= 1 && Math.random() < p.sup * .3) return this.superPlan();
      var dpMove = this.findSpecial(['dp']);
      if (dpMove && Math.random() < p.sp + .3) return { k: 'special', dur: 20, btn: dpMove.btn === 'K' ? 'D' : 'C', mot: dpMove.motion, endDir: 3 };
      return { k: 'attack', dur: 26, btn: 'C', low: true };
    }
    /* 近距离 */
    if (adx < 96) {
      if (Math.random() < p.thr) return { k: 'throw', dur: 16 };
      if (Math.random() < .2) return { k: 'retreat', dur: 14 };
      if (f.stock >= 1 && Math.random() < p.sup * .5) return this.superPlan();
      if (Math.random() < p.aggr) {
        var lows = Math.random() < .4;
        if (Math.random() < p.sp) {
          var sp = this.findSpecial(['rush', 'cmd', 'dp', 'any']);
          if (sp) return { k: 'special', dur: 24, btn: sp.btn === 'K' ? 'D' : 'C', mot: sp.motion, endDir: 6 };
        }
        return { k: 'attack', dur: 24, btn: Math.random() < .5 ? 'A' : 'C', chain: Math.random() < .6, btn2: 'C', low: lows };
      }
      return { k: 'block', dur: 14, low: Math.random() < .5 };
    }
    /* 中距离 */
    if (adx < 220) {
      if (Math.random() < p.aggr * .8) {
        if (Math.random() < p.sp) {
          var sp2 = this.findSpecial(['rush', 'slide', 'any']);
          if (sp2) return { k: 'special', dur: 26, btn: sp2.btn === 'K' ? 'D' : 'C', mot: sp2.motion, endDir: 6 };
        }
        return { k: 'approach', dur: 12 + M.rndi(0, 10) };
      }
      if (Math.random() < .25) return { k: 'jumpin', dur: 34 };
      if (Math.random() < .3) return { k: 'block', dur: 16 };
      return { k: 'approach', dur: 14 };
    }
    /* 远距离 */
    if (Math.random() < p.sp * .8) {
      var pj = this.findSpecial(['proj']);
      if (pj) return { k: 'special', dur: 34, btn: 'C', mot: pj.motion, endDir: 6 };
    }
    if (Math.random() < .5) return { k: 'approach', dur: 18 + M.rndi(0, 14) };
    if (Math.random() < .3) return { k: 'jumpin', dur: 36 };
    return { k: 'wait', dur: 10 };
  };
  AI.prototype.superPlan = function () {
    var m = this.f.moves['super'];
    return { k: 'special', dur: 30, btn: m.btn === 'K' ? 'D' : 'C', mot: m.motion, endDir: 6 };
  };
  AI.prototype.findSpecial = function (kinds) {
    var sps = this.f.ch.specials, out = [];
    for (var i = 0; i < sps.length; i++) {
      var s = sps[i], tag = s.spawn ? 'proj' : s.grab ? 'cmd' : s.motion === 'dp' ? 'dp' : (s.crouch ? 'slide' : 'rush');
      if (kinds.indexOf(tag) >= 0 || kinds.indexOf('any') >= 0) out.push(s);
    }
    return out.length ? M.pick(out) : null;
  };
  G.AI = AI;
})(window.G);
