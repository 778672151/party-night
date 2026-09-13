/* rig.js — 骨骼/姿势系统。判定框由骨骼派生，保证「效果范围 == 画面表现」 */
(function (G) {
  'use strict';
  var M = G.M, lerp = M.lerp, clamp = M.clamp;
  var KEYS = ['p', 'c', 'h', 'eF', 'hF', 'eB', 'hB', 'kF', 'fF', 'kB', 'fB'];

  /* 基础站架（面朝 +x，原点在双脚中点，y 向上） */
  var BASE = {
    p: [0, 90], c: [-3, 132], h: [4, 169],
    eB: [-16, 119], hB: [-1, 113],
    eF: [13, 115], hF: [26, 111],
    kB: [-14, 49], fB: [-25, 3],
    kF: [16, 47], fF: [25, 2]
  };
  function P(o) {
    var r = {};
    for (var i = 0; i < KEYS.length; i++) { var k = KEYS[i]; r[k] = o[k] ? [o[k][0], o[k][1]] : [BASE[k][0], BASE[k][1]]; }
    return r;
  }
  function blend(a, b, t) {
    var r = {};
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i];
      r[k] = [lerp(a[k][0], b[k][0], t), lerp(a[k][1], b[k][1], t)];
    }
    return r;
  }
  /* 关键帧序列求值： frames=[{t,pose,ease}] */
  function evalKeys(frames, f) {
    if (frames.length === 1) return frames[0].pose;
    var i = 0;
    for (i = frames.length - 1; i > 0; i--) if (f >= frames[i].t) break;
    if (i >= frames.length - 1) return frames[frames.length - 1].pose;
    var a = frames[i], b = frames[i + 1];
    var span = Math.max(1, b.t - a.t);
    var t = clamp((f - a.t) / span, 0, 1);
    var ez = M.EASE[b.ease || 'io'] || M.EASE.io;
    return blend(a.pose, b.pose, ez(t));
  }
  function loop(frames, f, total) { return evalKeys(frames, ((f % total) + total) % total); }

  /* ---- 共用姿势库 ---- */
  var P_ = {
    idle: [
      { t: 0, pose: P(BASE) },
      { t: 16, pose: P({ p: [0, 87], c: [-3, 129], h: [4, 166], eF: [12, 112], hF: [25, 108], eB: [-16, 116], hB: [-2, 110], kF: [16, 45], kB: [-14, 47] }) },
      { t: 32, pose: P(BASE) },
      { t: 48, pose: P({ p: [0, 92], c: [-3, 134], h: [4, 171], hF: [27, 113], hB: [0, 116] }) },
      { t: 64, pose: P(BASE) }
    ],
    walkF: [
      { t: 0, pose: P({}) },
      { t: 8, pose: P({ p: [0, 88], c: [-1, 130], fF: [40, 18], kF: [26, 53], fB: [-22, 3], kB: [-12, 48], hF: [24, 108], hB: [-3, 110] }) },
      { t: 16, pose: P({ p: [0, 91], fF: [36, 2], kF: [22, 48], fB: [-20, 3], kB: [-11, 48] }) },
      { t: 24, pose: P({ p: [0, 88], c: [-4, 130], fF: [28, 2], kF: [17, 47], fB: [-32, 16], kB: [-19, 51], hF: [27, 113], hB: [0, 115] }) },
      { t: 32, pose: P({}) }
    ],
    walkB: [
      { t: 0, pose: P({}) },
      { t: 8, pose: P({ p: [0, 88], c: [-4, 130], fB: [-40, 18], kB: [-24, 53], fF: [22, 2], kF: [14, 46], hF: [24, 114] }) },
      { t: 16, pose: P({ p: [0, 91], fB: [-36, 3], kB: [-20, 49] }) },
      { t: 24, pose: P({ p: [0, 88], fF: [30, 14], kF: [20, 52], fB: [-27, 3], kB: [-15, 49] }) },
      { t: 32, pose: P({}) }
    ],
    crouch: P({ p: [0, 52], c: [-4, 94], h: [3, 130], eB: [-16, 84], hB: [-2, 80], eF: [12, 80], hF: [24, 76], kB: [-22, 30], fB: [-28, 2], kF: [26, 32], fF: [30, 2] }),
    jumpUp: P({ p: [0, 96], c: [-3, 138], h: [4, 174], kF: [22, 64], fF: [26, 34], kB: [-16, 58], fB: [-22, 26], eF: [14, 120], hF: [24, 126], eB: [-18, 124], hB: [-6, 128] }),
    jumpFall: P({ p: [0, 94], c: [-3, 136], h: [4, 172], kF: [20, 56], fF: [31, 22], kB: [-14, 52], fB: [-27, 16], eF: [14, 118], hF: [23, 130], eB: [-18, 122], hB: [-8, 130] }),
    land: P({ p: [0, 68], c: [-3, 110], h: [4, 147], kF: [24, 38], fF: [27, 2], kB: [-20, 36], fB: [-27, 2], eF: [14, 96], hF: [24, 88], eB: [-18, 98], hB: [-4, 90] }),
    dashF: P({ p: [2, 84], c: [6, 126], h: [14, 162], eF: [18, 108], hF: [30, 100], eB: [-14, 112], hB: [-24, 100], kF: [26, 44], fF: [40, 8], kB: [-14, 46], fB: [-30, 6] }),
    dashB: P({ p: [-2, 86], c: [-12, 128], h: [-6, 165], eF: [4, 112], hF: [16, 118], eB: [-24, 116], hB: [-16, 122], kF: [20, 46], fF: [34, 10], kB: [-18, 46], fB: [-32, 4] }),
    blockS: P({ p: [0, 88], c: [-7, 130], h: [0, 166], eF: [4, 110], hF: [18, 130], eB: [-8, 110], hB: [10, 122], kF: [14, 46], fF: [22, 2], kB: [-18, 48], fB: [-28, 3] }),
    blockC: P({ p: [0, 52], c: [-7, 94], h: [-1, 129], eF: [2, 76], hF: [16, 96], eB: [-8, 74], hB: [8, 88], kF: [24, 30], fF: [28, 2], kB: [-22, 28], fB: [-28, 2] }),
    hurtHi: P({ p: [-4, 88], c: [-13, 130], h: [-18, 163], eB: [-27, 115], hB: [-26, 99], eF: [1, 112], hF: [6, 95], kF: [12, 46], fF: [22, 2], kB: [-18, 48], fB: [-29, 3] }),
    hurtMid: P({ p: [-5, 84], c: [-15, 122], h: [-10, 155], eF: [-1, 104], hF: [3, 89], eB: [-25, 107], hB: [-17, 93], kF: [14, 44], fF: [24, 2], kB: [-17, 46], fB: [-27, 4] }),
    hurtLow: P({ p: [-4, 56], c: [-14, 96], h: [-14, 130], eF: [-2, 78], hF: [2, 64], eB: [-24, 80], hB: [-18, 68], kF: [20, 32], fF: [28, 2], kB: [-24, 30], fB: [-30, 2] }),
    hurtAir: P({ p: [0, 90], c: [-9, 128], h: [-12, 161], eF: [-2, 141], hF: [7, 157], eB: [-21, 139], hB: [-15, 156], kF: [14, 58], fF: [31, 50], kB: [-16, 54], fB: [-31, 44] }),
    down: P({ p: [-10, 26], c: [-40, 32], h: [-59, 40], eF: [-30, 15], hF: [-14, 9], eB: [-46, 18], hB: [-62, 15], kF: [18, 26], fF: [40, 13], kB: [10, 20], fB: [32, 7] }),
    wake: P({ p: [-4, 56], c: [-14, 98], h: [-8, 134], eF: [4, 80], hF: [16, 74], eB: [-22, 82], hB: [-26, 66], kF: [22, 32], fF: [26, 2], kB: [-24, 30], fB: [-30, 2] }),
    dizzy: [
      { t: 0, pose: P({ p: [-4, 88], c: [-2, 130], h: [10, 166], eF: [16, 110], hF: [22, 88], eB: [-18, 110], hB: [-24, 88], kF: [18, 46], fF: [26, 2], kB: [-16, 46], fB: [-26, 3] }) },
      { t: 20, pose: P({ p: [4, 86], c: [4, 128], h: [-4, 164], eF: [14, 108], hF: [16, 86], eB: [-20, 108], hB: [-28, 86], kF: [14, 44], fF: [22, 2], kB: [-20, 44], fB: [-30, 3] }) },
      { t: 40, pose: P({ p: [-4, 88], c: [-2, 130], h: [10, 166], eF: [16, 110], hF: [22, 88], eB: [-18, 110], hB: [-24, 88], kF: [18, 46], fF: [26, 2], kB: [-16, 46], fB: [-26, 3] }) }
    ],
    win: [
      { t: 0, pose: P({ p: [0, 90], c: [0, 134], h: [4, 172], eF: [14, 148], hF: [17, 177], eB: [-14, 116], hB: [-6, 104] }) },
      { t: 24, pose: P({ p: [0, 93], c: [0, 137], h: [4, 175], eF: [15, 152], hF: [19, 182], eB: [-14, 119], hB: [-5, 107] }) },
      { t: 48, pose: P({ p: [0, 90], c: [0, 134], h: [4, 172], eF: [14, 148], hF: [17, 177], eB: [-14, 116], hB: [-6, 104] }) }
    ],
    intro: [
      { t: 0, pose: P({ p: [0, 90], c: [-6, 132], h: [0, 169], eF: [8, 116], hF: [18, 104], eB: [-18, 118], hB: [-10, 106] }) },
      { t: 20, pose: P({ p: [0, 86], c: [2, 128], h: [8, 165], eF: [18, 112], hF: [34, 122], eB: [-14, 114], hB: [-2, 116], kF: [18, 44], fF: [28, 2] }) },
      { t: 40, pose: P({ p: [0, 90], c: [-3, 132], h: [4, 169], eF: [13, 115], hF: [26, 111], eB: [-16, 119], hB: [-1, 113] }) }
    ],
    throwHold: P({ p: [2, 88], c: [4, 130], h: [10, 167], eF: [18, 118], hF: [36, 126], eB: [6, 118], hB: [30, 112], kF: [18, 46], fF: [28, 2], kB: [-18, 48], fB: [-28, 3] }),
    thrown: P({ p: [0, 60], c: [-20, 70], h: [-38, 82], eF: [-12, 52], hF: [4, 44], eB: [-30, 56], hB: [-46, 50], kF: [18, 54], fF: [36, 40], kB: [8, 44], fB: [28, 26] })
  };

  /* 局部姿势 -> 世界关节（含派生关节） */
  function world(pose, x, y, facing, sc) {
    sc = sc || 1;
    var J = {};
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i], v = pose[k];
      J[k] = { x: x + v[0] * facing * sc, y: y + v[1] * sc };
    }
    var dx = (J.c.x - J.p.x), dy = (J.c.y - J.p.y), l = M.len(dx, dy) || 1;
    var nx = -dy / l * facing, ny = dx / l * facing; // 躯干法向（朝前）
    J.sF = { x: J.c.x + nx * 9 * sc, y: J.c.y + ny * 9 * sc + 3 * sc };
    J.sB = { x: J.c.x - nx * 9 * sc, y: J.c.y - ny * 9 * sc + 3 * sc };
    J.neck = { x: lerp(J.c.x, J.h.x, .55), y: lerp(J.c.y, J.h.y, .5) };
    J.hipF = { x: J.p.x + nx * 10 * sc, y: J.p.y + ny * 10 * sc };
    J.hipB = { x: J.p.x - nx * 10 * sc, y: J.p.y - ny * 10 * sc };
    J._facing = facing; J._sc = sc; J._x = x; J._y = y;
    return J;
  }

  /* 由骨骼派生受击判定（胶囊体，世界坐标） */
  function hurtboxes(J, opt) {
    opt = opt || {};
    var sc = J._sc || 1, out = [];
    function cap(tag, a, b, r) { out.push({ tag: tag, x1: a.x, y1: a.y, x2: b.x, y2: b.y, r: r * sc }); }
    cap('head', J.h, J.h, 19);
    cap('body', J.p, J.c, 21);
    cap('body', J.c, J.neck, 17);
    if (opt.skip !== 'armF') { cap('armF', J.sF, J.eF, 9); cap('armF', J.eF, J.hF, 8); }
    if (opt.skip !== 'armB') { cap('armB', J.sB, J.eB, 9); cap('armB', J.eB, J.hB, 8); }
    if (opt.skip !== 'legF') { cap('legF', J.hipF, J.kF, 12); cap('legF', J.kF, J.fF, 9); }
    if (opt.skip !== 'legB') { cap('legB', J.hipB, J.kB, 12); cap('legB', J.kB, J.fB, 9); }
    return out;
  }
  /* 由骨骼派生攻击判定：{from,to,r,ext} 或 {at,r} */
  function hitCapsule(J, d) {
    var sc = J._sc || 1, a, b;
    if (d.at) { a = J[d.at]; b = a; }
    else { a = J[d.from]; b = J[d.to]; }
    var x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y;
    if (d.ext) {
      var dx = x2 - x1, dy = y2 - y1, l = M.len(dx, dy);
      if (l < .001) { dx = J._facing; dy = 0; l = 1; }
      x2 += dx / l * d.ext * sc; y2 += dy / l * d.ext * sc;
    }
    if (d.ox || d.oy) { var f = J._facing; x1 += (d.ox || 0) * f * sc; x2 += (d.ox || 0) * f * sc; y1 += (d.oy || 0) * sc; y2 += (d.oy || 0) * sc; }
    return { x1: x1, y1: y1, x2: x2, y2: y2, r: (d.r || 14) * sc };
  }

  /* ---------------- 绘制 ---------------- */
  function shade(col, amt) {
    var c = hex2rgb(col);
    if (amt >= 0) return 'rgb(' + [c[0] + (255 - c[0]) * amt | 0, c[1] + (255 - c[1]) * amt | 0, c[2] + (255 - c[2]) * amt | 0] + ')';
    var k = 1 + amt;
    return 'rgb(' + [c[0] * k | 0, c[1] * k | 0, c[2] * k | 0] + ')';
  }
  var hexCache = {};
  function hex2rgb(h) {
    if (hexCache[h]) return hexCache[h];
    if (h.charAt(0) !== '#') {
      var mm = /rgba?\(([^)]+)\)/.exec(h);
      if (mm) { var pp = mm[1].split(','); var rr = [parseInt(pp[0], 10) || 0, parseInt(pp[1], 10) || 0, parseInt(pp[2], 10) || 0]; hexCache[h] = rr; return rr; }
      hexCache[h] = [255, 255, 255]; return hexCache[h];
    }
    var v = h.replace('#', ''); if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
    var n = parseInt(v, 16), r = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    hexCache[h] = r; return r;
  }
  G.shade = shade;

  function draw(ctx, J, pal, o, V) {
    o = o || {};
    var z = V.z, S = {}, k;
    for (k in J) { if (k[0] === '_') continue; S[k] = { x: V.tx(J[k].x), y: V.ty(J[k].y) }; }
    var white = o.white || 0, alpha = o.alpha === undefined ? 1 : o.alpha;
    var OL = Math.max(1.2, 3.2 * z);
    var outline = white > .5 ? '#ffffff' : (o.silhouette ? o.silhouette : '#12121c');
    function C(c) {
      if (white > .5) return '#ffffff';
      if (o.silhouette) return o.silhouette;
      if (o.tint) return mix(c, o.tint, o.tintA || .5);
      return c;
    }
    function mix(a, b, t) {
      var x = hex2rgb(a), y = hex2rgb(b);
      return 'rgb(' + [lerp(x[0], y[0], t) | 0, lerp(x[1], y[1], t) | 0, lerp(x[2], y[2], t) | 0] + ')';
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    function seg(a, b, w, col) {
      ctx.strokeStyle = outline; ctx.lineWidth = w * z + OL;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, w * z);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    function limb(a, b, c, w1, w2, col1, col2) {
      ctx.strokeStyle = outline; ctx.lineWidth = Math.max(w1, w2) * z + OL;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.stroke();
      ctx.strokeStyle = col1; ctx.lineWidth = Math.max(1, w1 * z);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = col2; ctx.lineWidth = Math.max(1, w2 * z);
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    }
    function ball(a, r, col) {
      ctx.fillStyle = outline; ctx.beginPath(); ctx.arc(a.x, a.y, r * z + OL * .8, 0, M.TAU); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(a.x, a.y, Math.max(1, r * z), 0, M.TAU); ctx.fill();
    }
    var pantsB = C(shade(pal.pants, -.32)), pantsF = C(pal.pants);
    var skinB = C(shade(pal.skin, -.28)), skinF = C(pal.skin);
    var topB = C(shade(pal.top, -.34)), topF = C(pal.top);
    var gl = C(pal.glove), bt = C(pal.boot);

    /* 后侧肢体 */
    limb(S.hipB, S.kB, S.fB, 15, 11, pantsB, C(shade(pal.pants, -.42)));
    ball(S.fB, 8, C(shade(pal.boot, -.3)));
    limb(S.sB, S.eB, S.hB, 11, 9, C(shade(pal.top, -.4)), skinB);
    ball(S.hB, 8, C(shade(pal.glove, -.3)));

    /* 躯干 */
    var tw = 30;
    ctx.strokeStyle = outline; ctx.lineWidth = tw * z + OL;
    ctx.beginPath(); ctx.moveTo(S.p.x, S.p.y); ctx.lineTo(S.c.x, S.c.y); ctx.lineTo(S.neck.x, S.neck.y); ctx.stroke();
    ctx.strokeStyle = topF; ctx.lineWidth = tw * z;
    ctx.beginPath(); ctx.moveTo(S.p.x, S.p.y); ctx.lineTo(S.c.x, S.c.y); ctx.lineTo(S.neck.x, S.neck.y); ctx.stroke();
    // 胸肌/衣纹高光
    ctx.strokeStyle = C(shade(pal.top, .18)); ctx.lineWidth = tw * .42 * z;
    ctx.beginPath(); ctx.moveTo(lerp(S.p.x, S.c.x, .3), lerp(S.p.y, S.c.y, .3));
    ctx.lineTo(lerp(S.c.x, S.sF.x, .7), lerp(S.c.y, S.sF.y, .7)); ctx.stroke();
    // 腰带
    seg({ x: S.p.x - 14 * z * J._facing, y: S.p.y - 2 * z }, { x: S.p.x + 14 * z * J._facing, y: S.p.y + 2 * z }, 9, C(pal.belt || '#2b2f45'));

    /* 前侧腿 */
    limb(S.hipF, S.kF, S.fF, 16, 12, pantsF, C(shade(pal.pants, -.16)));
    ball(S.fF, 9, bt);
    /* 头 */
    seg(S.neck, S.h, 11, skinF);
    ball(S.h, 19, skinF);
    // 头发
    ctx.fillStyle = C(pal.hair);
    var f = J._facing, hx = S.h.x, hy = S.h.y, R = 19 * z;
    ctx.beginPath();
    ctx.arc(hx, hy - R * .18, R * 1.02, Math.PI * 1.05, Math.PI * 2.05);
    if (pal.hairStyle === 'spike') {
      ctx.lineTo(hx - f * R * 1.5, hy - R * 1.5);
      ctx.lineTo(hx - f * R * .3, hy - R * .7);
      ctx.lineTo(hx - f * R * 1.1, hy - R * 2.0);
      ctx.lineTo(hx + f * R * .2, hy - R * .9);
      ctx.lineTo(hx + f * R * .6, hy - R * 1.7);
    } else if (pal.hairStyle === 'pony') {
      ctx.lineTo(hx - f * R * 1.3, hy + R * .3);
      ctx.lineTo(hx - f * R * 2.4, hy + R * (o.tailUp ? .1 : -.9));
      ctx.lineTo(hx - f * R * 1.2, hy - R * .5);
    } else if (pal.hairStyle === 'cap') {
      ctx.lineTo(hx - f * R * 1.35, hy + R * .35);
      ctx.lineTo(hx + f * R * 1.45, hy + R * .45);
      ctx.lineTo(hx + f * R * 1.2, hy - R * .1);
    }
    ctx.closePath();
    ctx.strokeStyle = outline; ctx.lineWidth = OL; ctx.stroke(); ctx.fill();
    // 脸
    if (!o.silhouette && white < .5) {
      ctx.fillStyle = '#1b1b28';
      var ex = hx + f * R * .42, ey = hy + R * .02;
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(f > 0 ? -.35 : .35);
      ctx.fillRect(-R * .22, -R * .07, R * .44, R * .17); ctx.restore();
      ctx.save(); ctx.translate(hx - f * R * .05, ey + R * .03); ctx.rotate(f > 0 ? -.35 : .35);
      ctx.fillRect(-R * .18, -R * .06, R * .36, R * .15); ctx.restore();
      if (o.mouth) {
        ctx.fillStyle = '#3a1418';
        ctx.beginPath(); ctx.ellipse(hx + f * R * .34, hy - R * .5, R * .26, R * .2 * (o.mouth), 0, 0, M.TAU); ctx.fill();
      }
    }
    /* 前侧手臂（最上层） */
    limb(S.sF, S.eF, S.hF, 12, 10, topF, skinF);
    ball(S.hF, 9, gl);
    ctx.restore();
    return S;
  }

  G.Rig = {
    KEYS: KEYS, BASE: BASE, P: P, POSE: P_, blend: blend, evalKeys: evalKeys, loop: loop,
    world: world, hurtboxes: hurtboxes, hitCapsule: hitCapsule, draw: draw
  };
})(window.G);
