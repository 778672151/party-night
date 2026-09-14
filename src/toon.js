/* ===== PN.Toon：三渲二渲染层（flat-isometric cel）=====
 *
 * 目标：用**零依赖 canvas 2D** 画出"三渲二"的立体可爱风 —— 平面等距投影 + 三段色阶
 * （顶面最亮 / 右面中间 / 左面最暗）+ 深色描边 + 柔和投影 + 视差远景 + 弹性动画。
 * 参考的是《纪念碑谷》那一类"平涂等距 + 柔光"的观感，而不是 WebGL：
 *   - 不用 Three.js / 不联网，单文件离线可用（本项目核心约束）
 *   - 手机上省电、不依赖 GPU 特性
 * 所有画法都是"解析式"的（自己算多边形），所以纯数学部分可以在 node 里单测。
 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  /* ---------- 颜色：与 src/style.css 的 :root 对齐 ---------- */
  var PAL = {
    bg: '#fff4f9', bg2: '#ffe9f3', bg3: '#ffdfee',
    ground: '#e7f7ee', ground2: '#d3f0e0', edge: '#bfe6d0',
    water: '#cfeaff', water2: '#a9d8ff',
    ink: '#4b3a63', ink2: '#a08cb8', line: '#ffd7e8', stroke: '#6b5588',
    acc: '#ff8fb8', acc2: '#8ad7ff', good: '#5fd6a8', bad: '#ff8fa3',
    yellow: '#ffd86b', purple: '#c9a7ff', blue: '#8ad7ff'
  };

  function hex2rgb(h) {
    var s = String(h).replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
  function rgb2hex(r, g, b) {
    return '#' + [r, g, b].map(function (v) { return ('0' + clamp255(v).toString(16)).slice(-2); }).join('');
  }
  /** 线性混色：k=0 取 a，k=1 取 b */
  function mix(a, b, k) {
    var A = hex2rgb(a), B = hex2rgb(b), t = k < 0 ? 0 : k > 1 ? 1 : k;
    return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }
  var SHADOW = '#241d38';          // 冷调深影
  function lighten(c, k) { return mix(c, '#ffffff', k); }
  /* 压暗必须**单调**，否则三段色阶会糊成一档（踩过两次）：
     ① 朝固定的 PAL.ink 混 → 基色本身就偏深紫时"压不动"
     ② 只朝固定的 SHADOW 混 → 基色等于 SHADOW 时压不动
     所以：先按比例整体压暗（一定更暗），再往冷影里混一点（保住全站色调统一）。 */
  function darken(c, k) {
    var A = hex2rgb(c);
    var f = 1 - Math.min(0.94, k * 0.8);
    var scaled = rgb2hex(A[0] * f, A[1] * f, A[2] * f);
    return mix(scaled, SHADOW, Math.min(0.5, k * 0.35));
  }

  /** 一个基色的三段色阶 + 描边色（三渲二的核心） */
  function tone(base) {
    return {
      base: base,
      top: lighten(base, 0.30),      // 顶面：受光
      left: darken(base, 0.30),      // 左面：背光
      right: darken(base, 0.12),     // 右面：侧光
      rim: lighten(base, 0.62),      // 顶边高光
      line: darken(base, 0.62)       // 描边（偏 ink）
    };
  }

  function alpha(c, a) { return c; }   // 颜色统一走 globalAlpha，这里留个语义化入口

  /* ---------- 缓动 / 弹簧 ---------- */
  function easeOutCubic(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return 1 - Math.pow(1 - t, 3); }
  function easeInOutSine(t) { return -(Math.cos(Math.PI * (t < 0 ? 0 : t > 1 ? 1 : t)) - 1) / 2; }
  function easeOutBack(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
  /** 临界阻尼弹簧的一步积分（用于挤压/回弹） */
  function spring(cur, target, vel, dt, k, d) {
    k = k || 220; d = d || 22;
    var a = (target - cur) * k - vel * d;
    var v2 = vel + a * dt;
    return { v: cur + v2 * dt, vel: v2 };
  }

  /* ---------- 等距投影 ---------- */
  /** 世界(x,z 地面格，y 高度) → 屏幕。a/b 决定等距倾角，zoom 整体缩放 */
  function project(x, y, z, cam) {
    var c = cam || { ox: 0, oy: 0, zoom: 1, a: 0.866, b: 0.5, unit: 26 };
    var u = c.unit * c.zoom;
    return {
      x: c.ox + (x - z) * c.a * u,
      y: c.oy + (x + z) * c.b * u - (y || 0) * u
    };
  }
  /** 等距深度（越大越靠近观察者，用于排序） */
  function depth(x, z) { return x + z; }
  function sortByDepth(list, get) {
    var g = get || function (o) { return o; };
    return list.slice().sort(function (p, q) { return depth(g(p).x, g(p).z) - depth(g(q).x, g(q).z); });
  }

  /* ---------- 绘图原语：三渲二 ---------- */
  function poly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }
  function fillStroke(ctx, fill, line, lw) {
    ctx.fillStyle = fill; ctx.fill();
    if (lw) { ctx.lineWidth = lw; ctx.strokeStyle = line; ctx.stroke(); }
  }
  /** 地面柔和投影（椭圆渐变，不要硬边） */
  function shadow(ctx, p, rx, ry, a) {
    var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(rx, ry));
    g.addColorStop(0, 'rgba(75,58,99,' + (a == null ? 0.26 : a) + ')');
    g.addColorStop(1, 'rgba(75,58,99,0)');
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(1, Math.max(0.2, ry / Math.max(1, rx))); ctx.translate(-p.x, -p.y);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(rx, ry), 0, 6.2832); ctx.fill(); ctx.restore();
  }
  /** 等距板（方块）：top 面 + 右侧 + 左侧，三段色阶 + 描边 */
  function plate(ctx, cam, x, z, w, d, h, base, opt) {
    opt = opt || {};
    var t = tone(base);
    var x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
    var y1 = h || 0, y0 = opt.base || 0;
    // 顶面四角（逆时针：近左 → 近右 → 远右 → 远左）
    var tA = project(x0, y1, z1, cam), tB = project(x1, y1, z1, cam);
    var tC = project(x1, y1, z0, cam), tD = project(x0, y1, z0, cam);
    // 底面（用于侧面）
    var bA = project(x0, y0, z1, cam), bB = project(x1, y0, z1, cam), bC = project(x1, y0, z0, cam);
    var lw = opt.lw == null ? 2.4 : opt.lw;
    if (y1 > y0) {
      // 左面（+z 侧，背光）
      poly(ctx, [bA, bB, tB, tA]); fillStroke(ctx, t.left, t.line, lw);
      // 右面（+x 侧，侧光）
      poly(ctx, [bB, bC, tC, tB]); fillStroke(ctx, t.right, t.line, lw);
    }
    poly(ctx, [tA, tB, tC, tD]); fillStroke(ctx, t.top, t.line, lw);
    // 顶边高光（三渲二的"亮边"）
    if (opt.rim !== false) {
      ctx.save(); ctx.globalAlpha = 0.75; ctx.strokeStyle = t.rim; ctx.lineWidth = Math.max(1.2, lw * 0.6);
      ctx.beginPath(); ctx.moveTo(tD.x, tD.y); ctx.lineTo(tA.x, tA.y); ctx.lineTo(tB.x, tB.y); ctx.stroke(); ctx.restore();
    }
    return { top: [tA, tB, tC, tD], center: project(x, y1, z, cam) };
  }
  /** 平铺在地面的色块（草地/水面/目标点） */
  function tile(ctx, cam, x, z, w, d, base, opt) {
    opt = opt || {};
    var t = tone(base);
    var A = project(x - w / 2, opt.y || 0, z + d / 2, cam), B = project(x + w / 2, opt.y || 0, z + d / 2, cam);
    var C = project(x + w / 2, opt.y || 0, z - d / 2, cam), D = project(x - w / 2, opt.y || 0, z - d / 2, cam);
    poly(ctx, [A, B, C, D]);
    fillStroke(ctx, opt.color || t.top, t.line, opt.lw == null ? 1.6 : opt.lw);
    return { pts: [A, B, C, D], center: project(x, opt.y || 0, z, cam) };
  }
  /** 圆润的"生物"身体：三段色阶的椭圆 + 高光 + 描边（鲸鱼、丸子怪都靠它） */
  function blob(ctx, p, rx, ry, base, opt) {
    opt = opt || {};
    var t = tone(base);
    shadow(ctx, { x: p.x, y: p.y }, rx * 0.9, ry * 0.34, opt.shadow == null ? 0.22 : opt.shadow);
    var g = ctx.createLinearGradient(p.x, p.y - ry, p.x, p.y + ry);
    g.addColorStop(0, t.top); g.addColorStop(0.55, t.base); g.addColorStop(1, t.left);
    ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, opt.rot || 0, 0, 6.2832);
    fillStroke(ctx, g, t.line, opt.lw == null ? 2.4 : opt.lw);
    if (opt.hi !== false) {   // 左上高光
      ctx.save(); ctx.globalAlpha = 0.75; ctx.fillStyle = t.rim;
      ctx.beginPath(); ctx.ellipse(p.x - rx * 0.32, p.y - ry * 0.42, rx * 0.26, ry * 0.2, -0.5, 0, 6.2832); ctx.fill(); ctx.restore();
    }
    return t;
  }
  /** 地面光环（目标点脉冲、落地涟漪） */
  function ring(ctx, p, r, color, a, lw) {
    ctx.save(); ctx.globalAlpha = a == null ? 0.8 : a; ctx.strokeStyle = color; ctx.lineWidth = lw || 3;
    ctx.beginPath(); ctx.save(); ctx.translate(p.x, p.y); ctx.scale(1, 0.5);
    ctx.arc(0, 0, r, 0, 6.2832); ctx.restore(); ctx.stroke(); ctx.restore();
  }
  /** 星尘/水花粒子（自己管生命周期，调用方只给位置与数量） */
  function burst(list, p, n, color, opt) {
    opt = opt || {};
    for (var i = 0; i < n; i++) {
      var ang = (opt.dir == null ? Math.random() * 6.2832 : opt.dir + (Math.random() - 0.5) * 1.4);
      var sp = (opt.speed || 60) * (0.5 + Math.random());
      list.push({
        x: p.x, y: p.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - (opt.lift || 40),
        life: 0, max: (opt.life || 700) * (0.7 + Math.random() * 0.6),
        r: (opt.r || 3) * (0.6 + Math.random() * 0.8), color: color, grav: opt.grav == null ? 180 : opt.grav
      });
    }
    return list;
  }
  function stepParticles(list, dt, floorY) {
    for (var i = list.length - 1; i >= 0; i--) {
      var p = list[i];
      p.life += dt * 1000;
      if (p.life >= p.max) { list.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (floorY != null && p.y > floorY) { p.y = floorY; p.vy *= -0.35; p.vx *= 0.7; }
    }
    return list;
  }
  function drawParticles(ctx, list) {
    for (var i = 0; i < list.length; i++) {
      var p = list[i], k = 1 - p.life / p.max;
      ctx.save(); ctx.globalAlpha = Math.max(0, k);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.5 + k * 0.8), 0, 6.2832); ctx.fill(); ctx.restore();
    }
  }
  /** 漂浮文字（+2、完美、过关） */
  function floatText(ctx, x, y, text, color, k, size) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - k);
    ctx.font = '900 ' + (size || 20) + 'px -apple-system,system-ui,"PingFang SC",sans-serif';
    ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(75,58,99,.55)';
    ctx.strokeText(text, x, y - k * 40);
    ctx.fillStyle = color || '#fff'; ctx.fillText(text, x, y - k * 40);
    ctx.restore();
  }

  /* ---------- 动画循环 ---------- */
  /** 统一的 rAF 驱动：自动处理 DPR 上限、尺寸变化、canvas 被移除时自动停 */
  function animate(canvas, draw, opt) {
    opt = opt || {};
    var raf = root.requestAnimationFrame;
    if (typeof raf !== 'function') return function () {};
    var alive = true, last = 0, frames = 0;
    function tick(ts) {
      if (!alive) return;
      if (!canvas || !canvas.isConnected || !canvas.getContext) { alive = false; return; }
      var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
      last = ts; frames++;
      var r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 320 };
      if (r.width > 20) {
        var dpr = Math.min(root.devicePixelRatio || 1, 2);
        var W = Math.floor(r.width), H = Math.floor(r.width * (opt.ratio || 0.72));
        if (canvas.width !== Math.floor(W * dpr) || canvas.height !== Math.floor(H * dpr)) {
          canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
        }
        if (canvas.style && opt.ratio) canvas.style.height = H + 'px';
        var ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw(ctx, W, H, dt, ts);
      }
      raf(tick);
    }
    raf(tick);
    return function stop() { alive = false; };
  }

  PN.Toon = {
    PAL: PAL, tone: tone, mix: mix, lighten: lighten, darken: darken, alpha: alpha,
    easeOutCubic: easeOutCubic, easeInOutSine: easeInOutSine, easeOutBack: easeOutBack, spring: spring,
    project: project, depth: depth, sortByDepth: sortByDepth,
    plate: plate, tile: tile, blob: blob, shadow: shadow, ring: ring,
    burst: burst, stepParticles: stepParticles, drawParticles: drawParticles, floatText: floatText,
    poly: poly, fillStroke: fillStroke, animate: animate
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
