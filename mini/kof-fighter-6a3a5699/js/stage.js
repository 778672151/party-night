/* stage.js — 程序化舞台（视差背景 + 地面），无外部素材 */
(function (G) {
  'use strict';
  var M = G.M;
  function srnd(s) { var x = s; return function () { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; }; }

  function Stage(id) {
    this.id = id || 0; this.t = 0;
    var r = srnd(12345 + this.id * 977);
    this.far = []; this.mid = []; this.crowd = []; this.clouds = []; this.lamps = [];
    var x, i;
    for (x = -1600; x < 1600; x += 40 + r() * 60) {
      this.far.push({ x: x, w: 34 + r() * 52, h: 90 + r() * 210, c: r() });
    }
    for (x = -1500; x < 1500; x += 120 + r() * 130) {
      var w = 90 + r() * 130, h = 130 + r() * 210, wins = [];
      for (var wy = 20; wy < h - 16; wy += 26) for (var wx = 12; wx < w - 14; wx += 22) wins.push({ x: wx, y: wy, on: r() > .45 });
      this.mid.push({ x: x, w: w, h: h, wins: wins, c: r() });
    }
    for (i = 0; i < 130; i++) this.crowd.push({ x: -1500 + r() * 3000, s: .8 + r() * .5, ph: r() * 6.28, c: r() });
    for (i = 0; i < 14; i++) this.clouds.push({ x: -1600 + r() * 3200, y: 260 + r() * 220, w: 160 + r() * 260, h: 30 + r() * 40, a: .12 + r() * .2 });
    for (i = 0; i < 26; i++) this.lamps.push({ x: -1400 + i * 110, c: r() });
    this.theme = [
      { sky: [['#1a1030', 0], ['#4a2050', .38], ['#c05a3a', .68], ['#f2a75c', .85], ['#ffd9a0', 1]], sun: '#ffd27a', ground: '#3a3348', ground2: '#221d30', accent: '#ff9a4a', name: '黄昏天台' },
      { sky: [['#050a1e', 0], ['#0d1a3c', .4], ['#1b3160', .7], ['#2f4a7a', .9], ['#43608f', 1]], sun: '#e8f0ff', ground: '#2a2c3c', ground2: '#15161f', accent: '#7fb0ff', name: '午夜擂台' },
      { sky: [['#221018', 0], ['#3f1420', .4], ['#7a2028', .7], ['#c04a2a', .9], ['#f08a3a', 1]], sun: '#ffb04a', ground: '#42302a', ground2: '#241a18', accent: '#ff6a3a', name: '炼狱工厂' }
    ][this.id % 3];
  }
  Stage.prototype.update = function () {
    this.t++;
    if (this.t % 6 === 0) G.FX.ember(M.rnd(-900, 900), M.rnd(0, 40), this.theme.accent);
  };
  Stage.prototype.draw = function (ctx, V, W, H) {
    var th = this.theme, i, j, gx, gy = V.ty(0);
    /* 天空 */
    var g = ctx.createLinearGradient(0, 0, 0, gy);
    for (i = 0; i < th.sky.length; i++) g.addColorStop(th.sky[i][1], th.sky[i][0]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    /* 太阳/月亮 */
    var sx = V.tx(-260) * .35 + W * .34, sy = gy - 260 * V.z;
    var sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 240 * V.z);
    sg.addColorStop(0, th.sun); sg.addColorStop(.12, th.sun); sg.addColorStop(.18, 'rgba(255,190,120,.5)'); sg.addColorStop(1, 'rgba(255,150,80,0)');
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(sx, sy, 240 * V.z, 0, M.TAU); ctx.fill(); ctx.restore();
    /* 云 */
    ctx.save();
    for (i = 0; i < this.clouds.length; i++) {
      var c = this.clouds[i], cx = pv(c.x + this.t * .08, .06), cy = gy - c.y * V.z;
      ctx.globalAlpha = c.a; ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(cx, cy, c.w * V.z, c.h * V.z, 0, 0, M.TAU); ctx.fill();
    }
    ctx.restore();
    /* 远景楼群 */
    ctx.fillStyle = 'rgba(20,16,34,.72)';
    for (i = 0; i < this.far.length; i++) {
      var f = this.far[i], fx = pv(f.x, .12);
      ctx.fillRect(fx, gy - (f.h + 40) * V.z, f.w * V.z, (f.h + 40) * V.z);
    }
    /* 中景楼群 + 灯窗 */
    for (i = 0; i < this.mid.length; i++) {
      var b = this.mid[i], bx = pv(b.x, .3), bw = b.w * V.z, bh = b.h * V.z, by = gy - 30 * V.z - bh;
      if (bx > W + 200 || bx + bw < -200) continue;
      ctx.fillStyle = 'rgba(14,12,26,.92)'; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = 'rgba(40,34,60,.9)'; ctx.fillRect(bx, by, bw * .12, bh);
      for (j = 0; j < b.wins.length; j++) {
        var wn = b.wins[j];
        if (!wn.on) continue;
        var flick = ((this.t * .01 + i * 3 + j) % 40) < 39 ? 1 : .3;
        ctx.fillStyle = 'rgba(255,205,120,' + (.5 * flick) + ')';
        ctx.fillRect(bx + wn.x * V.z, by + wn.y * V.z, 9 * V.z, 12 * V.z);
      }
    }
    /* 观众席 */
    var cy2 = gy - 26 * V.z;
    ctx.fillStyle = 'rgba(10,8,16,.9)';
    ctx.fillRect(0, cy2 - 6 * V.z, W, 60 * V.z);
    for (i = 0; i < this.crowd.length; i++) {
      var cr = this.crowd[i], cx2 = pv(cr.x, .55);
      if (cx2 < -40 || cx2 > W + 40) continue;
      var bob = Math.sin(this.t * .06 + cr.ph) * 3 * V.z;
      ctx.fillStyle = cr.c > .5 ? 'rgba(6,6,12,.95)' : 'rgba(16,14,24,.95)';
      var hh = 34 * cr.s * V.z;
      ctx.beginPath();
      ctx.arc(cx2, cy2 - hh + bob, 7 * cr.s * V.z, 0, M.TAU); ctx.fill();
      ctx.fillRect(cx2 - 6 * cr.s * V.z, cy2 - hh + 6 * cr.s * V.z + bob, 12 * cr.s * V.z, hh);
    }
    /* 地面 */
    var gh = H - gy + 10;
    var gg = ctx.createLinearGradient(0, gy, 0, H);
    gg.addColorStop(0, th.ground); gg.addColorStop(1, th.ground2);
    ctx.fillStyle = gg; ctx.fillRect(0, gy, W, gh);
    ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(0, gy - 2 * V.z, W, 3 * V.z);
    ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
    for (i = -1400; i <= 1400; i += 100) {
      gx = V.tx(i);
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(V.tx(i * 1.9), H); ctx.stroke();
    }
    for (i = 1; i < 7; i++) {
      var yy = gy + Math.pow(i / 7, 1.8) * gh;
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
    }
    /* 场地边界光 */
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .5;
    var eg = ctx.createLinearGradient(0, gy - 60 * V.z, 0, gy + 20 * V.z);
    eg.addColorStop(0, 'rgba(0,0,0,0)'); eg.addColorStop(1, th.accent);
    ctx.fillStyle = eg;
    ctx.fillRect(V.tx(-1100) - 8, gy - 60 * V.z, 8, 60 * V.z + 20 * V.z);
    ctx.fillRect(V.tx(1100), gy - 60 * V.z, 8, 60 * V.z + 20 * V.z);
    ctx.restore();
    /* 前景灯笼 */
    for (i = 0; i < this.lamps.length; i++) {
      var lp = this.lamps[i], lx = pv(lp.x, 1.35), ly = gy - 300 * V.z + Math.sin(this.t * .02 + i) * 6 * V.z;
      if (lx < -60 || lx > W + 60) continue;
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 2 * V.z;
      ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, ly); ctx.stroke();
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      var lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 40 * V.z);
      lg.addColorStop(0, 'rgba(255,220,150,.85)'); lg.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(lx, ly, 40 * V.z, 0, M.TAU); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#e8b45a'; ctx.beginPath(); ctx.ellipse(lx, ly, 8 * V.z, 11 * V.z, 0, 0, M.TAU); ctx.fill();
    }
    /* 暗角 */
    var vg = ctx.createRadialGradient(W / 2, H * .5, H * .25, W / 2, H * .5, H * .95);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    function pv(wx, k) { return (wx - G.Game.cam.x * k) * V.z + W / 2 + G.FX.shakeX * k; }
  };
  G.Stage = Stage;
})(window.G);
