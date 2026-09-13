/* =====================================================================
 *  demo.js —— 悬浮示意动画（单色工业线条极简风 · 时间可控）
 *  · 悬停任何带 data-demo 的元素即切换场景，移开保持不变（防抖）
 *  · 所有场景以归一化时间 t∈[0,1] 绘制，可暂停 / 变速 / 拖动进度
 * ===================================================================== */
(function () {
  "use strict";
  var cv = document.getElementById("demoCanvas");
  if (!cv || typeof cv.getContext !== "function") { window.Demo = { show: function () {} }; return; }
  var ctx = cv.getContext("2d");
  var W = 320, H = 168, DPR = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = W * DPR; cv.height = H * DPR; ctx.scale(DPR, DPR);

  var INK = "159,179,209";                       // 单色油墨，仅用透明度分层
  var t = 0, playing = true, speed = 1, cur = "succ", dragging = false;

  /* ---------------- 绘图原语 ---------------- */
  function a(v) { ctx.strokeStyle = "rgba(" + INK + "," + v + ")"; ctx.fillStyle = "rgba(" + INK + "," + v + ")"; }
  function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  function rect(x, y, w, h) { ctx.strokeRect(x + .5, y + .5, w, h); }
  function txt(s, x, y, sz, al) { ctx.font = (sz || 10) + 'px "JetBrains Mono",monospace'; ctx.textAlign = al || "left"; ctx.fillText(s, x, y); }
  function hatch(x, y, w, h, gap) {
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    for (var i = -h; i < w; i += (gap || 5)) line(x + i, y + h, x + i + h, y);
    ctx.restore();
  }
  function arrowUp(x, y, len) { line(x, y, x, y - len); line(x, y - len, x - 3, y - len + 4); line(x, y - len, x + 3, y - len + 4); }
  function frame() {                              // 蓝图角标
    a(.22); var m = 6, L = 9;
    [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(function (c) {
      line(c[0], c[1], c[0] + L * c[2], c[1]); line(c[0], c[1], c[0], c[1] + L * c[3]);
    });
  }
  function ease(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function stepN(t, n) { return Math.min(n, Math.floor(t * (n + .999))); }

  /* ---------------- 场景 ---------------- */
  var SC = {
    succ: { title: "后继：数出下一个", sym: "S(n) = n+1", dur: 6,
      cap: "一切的起点。每一次只前进一格——这是最慢、也是唯一不需要解释的运算。",
      draw: function (t) {
        var n = stepN(t, 12), x0 = 26, dx = 21, y = 104;
        a(.3); line(x0 - 10, y, W - 16, y);
        for (var i = 0; i <= 12; i++) {
          var on = i <= n;
          a(on ? .95 : .15); line(x0 + i * dx, y, x0 + i * dx, y - (i % 5 === 0 ? 12 : 7));
          if (i % 5 === 0) { a(on ? .7 : .15); txt(String(i), x0 + i * dx, y + 13, 9, "center"); }
        }
        a(1); rect(x0 + n * dx - 5, y - 26, 10, 10);
        a(.8); txt("n = " + n, x0 + n * dx, y - 32, 11, "center");
        a(.45); txt("n → n+1 → n+2 → …", 16, 30, 10);
      } },

    add: { title: "加法：把重复的「+1」打包", sym: "a + b", dur: 6,
      cap: "数一千次太慢了，于是我们把「数很多次」压缩成一次操作。",
      draw: function (t) {
        var u = 20, A = 5, B = 3, y = 72, p = ease((t - .35) / .4);
        var bx = 30 + A * u + (1 - p) * 62, by = y + (1 - p) * 36;
        a(.9); for (var i = 0; i < A; i++) rect(30 + i * u, y, u, 20);
        a(.6); for (var j = 0; j < B; j++) rect(bx + j * u, by, u, 20);
        a(.4); txt("a = 5", 30, y - 7, 10); txt("b = 3", bx, by - 7, 10);
        if (p > .98) {
          a(.3); line(30, y + 28, 30 + (A + B) * u, y + 28);
          line(30, y + 24, 30, y + 32); line(30 + (A + B) * u, y + 24, 30 + (A + B) * u, y + 32);
          a(.95); txt("5 + 3 = 8", W / 2, 142, 13, "center");
        }
        a(.45); txt("加法 = 长度的拼接", 16, 30, 10);
      } },

    mul: { title: "乘法：把加法折成面积", sym: "a × b", dur: 7,
      cap: "6+6+6+6 太长了。把它折成一块 6×4 的矩形，答案就是面积 24。",
      draw: function (t) {
        var c = 6, r = 4, cw = 30, ch = 21, x0 = 40, y0 = 46, n = stepN(t, c * r);
        for (var i = 0; i < c * r; i++) {
          var cx = x0 + (i % c) * cw, cy = y0 + Math.floor(i / c) * ch;
          if (i < n) { a(.85); rect(cx, cy, cw, ch); a(.3); hatch(cx + 2, cy + 2, cw - 4, ch - 4, 6); }
          else { a(.14); rect(cx, cy, cw, ch); }
        }
        a(.5); line(x0, y0 - 8, x0 + c * cw, y0 - 8); txt("a = 6", x0 + c * cw / 2, y0 - 12, 10, "center");
        line(x0 - 9, y0, x0 - 9, y0 + r * ch); txt("b=4", x0 - 12, y0 + r * ch / 2, 10, "right");
        a(.95); txt("6 × 4 = " + n, W / 2, 158, 12, "center");
      } },

    pow: { title: "幂：把乘法再折一次", sym: "a ^ b", dur: 8,
      cap: "3 个 3 相乘是 27。指数只是把「重复相乘」的次数写到了右上角。",
      draw: function (t) {
        var st = Math.min(2, Math.floor(t * 3)), g, r, c;
        a(.85);
        if (st === 0) { for (g = 0; g < 3; g++) rect(72 + g * 58, 62, 44, 44); }
        else if (st === 1) {
          for (g = 0; g < 3; g++) {
            a(.35); rect(56 + g * 72, 52, 62, 64);
            a(.85); for (r = 0; r < 3; r++) rect(62 + g * 72, 58 + r * 20, 50, 16);
          }
        } else {
          for (g = 0; g < 3; g++) {
            a(.3); rect(38 + g * 82, 42, 76, 88);
            a(.8); for (r = 0; r < 3; r++) for (c = 0; c < 3; c++) rect(44 + g * 82 + c * 22, 48 + r * 28, 18, 24);
          }
        }
        a(.95); txt("3^" + (st + 1) + " = " + [3, 9, 27][st], W / 2, 152, 13, "center");
        a(.4); txt("每一步：把上一步整块复制 3 份", 16, 30, 10);
      } },

    tet: { title: "迭代幂次：搭一座幂塔", sym: "a ↑↑ b", dur: 8,
      cap: "10↑↑4 = 10^10^10^10。塔每长高一层，数值就要重新数一遍位数。",
      draw: function (t) {
        var n = stepN(t, 4), x = 74, y = 128, sz = 20;
        for (var i = 0; i <= n && i < 5; i++) {
          a(i === n ? 1 : .8);
          txt(i === 0 ? "10" : "10", x, y, sz, "left");
          if (i < 4) { x += sz * 1.15; y -= sz * .62; sz *= .78; a(.5); txt("^", x - 4, y + sz * .5, sz * .9, "left"); x += sz * .55; }
        }
        a(.35); line(52, 132, 52, 132 - n * 22); line(48, 132, 56, 132); line(48, 132 - n * 22, 56, 132 - n * 22);
        a(.7); txt("h = " + n, 44, 132 - n * 11, 10, "right");
        a(.95); txt("10↑↑" + n, W - 18, 156, 13, "right");
        a(.4); txt("塔高 h 就是这个游戏后期的真正货币", 16, 26, 10);
      } },

    arrow: { title: "箭头记号：让「重复」自己重复", sym: "a ↑ⁿ b", dur: 9,
      cap: "每多一个箭头，上一行的结果就变成下一行的层数。3↑↑↑↑3 = g₁ 已经无法书写。",
      draw: function (t) {
        var rows = [["3↑3", "= 27"], ["3↑↑3", "= 7.6×10¹²"], ["3↑↑↑3", "= 高 7.6×10¹² 的塔"], ["3↑↑↑↑3", "= g₁"]];
        var n = stepN(t, 3);
        for (var i = 0; i <= n; i++) {
          var y = 46 + i * 27;
          a(i === n ? 1 : .55);
          txt(rows[i][0], 26, y, 13, "left"); txt(rows[i][1], 130, y, 11, "left");
          for (var k = 0; k <= i; k++) { a(i === n ? .8 : .3); arrowUp(W - 30 - k * 9, y + 2, 12); }
          if (i > 0) { a(.25); ctx.setLineDash([2, 3]); line(104, y - 22, 118, y - 6); ctx.setLineDash([]); }
        }
        a(.4); txt("箭头数量 ← 上一行的「值」", 16, 156, 10);
      } },

    fgh: { title: "序数：给增长速度编号", sym: "f_α(n)", dur: 9,
      cap: "当数本身写不下时，改比「增长有多快」。ω、ε₀、Γ₀、SVO —— 每一级都吞掉下面的全部。",
      draw: function (t) {
        var names = ["ω", "ω²", "ω^ω", "ε₀", "Γ₀", "SVO"], n = stepN(t, 5);
        for (var i = 0; i <= n; i++) {
          var y = 40 + i * 20, dens = 3 + i * 5;
          a(i === n ? .95 : .45); txt(names[i], 24, y + 4, 12, "left");
          a(i === n ? .7 : .22);
          for (var k = 0; k < dens; k++) {
            var x = 70 + (W - 110) * Math.pow(k / dens, 1.6);
            line(x, y - 6, x, y + 6);
          }
          a(i === n ? .9 : .3); line(W - 34, y - 9, W - 34, y + 9);
        }
        a(.35); txt("每一列竖线 = 一次「重新开始的无穷」", 16, 158, 10);
      } },

    hyper: { title: "超运算阶梯", sym: "H_n(a, b)", dur: 10,
      cap: "H₁ 加、H₂ 乘、H₃ 幂、H₄ 迭代幂次、H₅ 五级运算…… 每一级都是上一级的重复。",
      draw: function (t) {
        var ops = [["H₁", "a+b", "拼接"], ["H₂", "a×b", "面积"], ["H₃", "a^b", "体积"], ["H₄", "a↑↑b", "塔"], ["H₅", "a↑↑↑b", "塔的塔"]];
        var n = stepN(t, 4);
        for (var i = 0; i < 5; i++) {
          var y = 40 + i * 24, on = i <= n;
          a(on ? (i === n ? 1 : .6) : .13);
          txt(ops[i][0], 26, y, 12); txt(ops[i][1], 66, y, 12); txt(ops[i][2], 140, y, 10);
          line(180, y - 4, 180 + Math.pow(2.1, i) * 8, y - 4);
          if (i === n) { a(.35); rect(20, y - 14, W - 40, 19); }
        }
      } },

    googol: { title: "古戈尔：10 的 100 次方", sym: "10^100", dur: 9,
      cap: "一个 1 后面 100 个 0。可观测宇宙的原子数约 10^80——古戈尔比它还多二十个数量级。",
      draw: function (t) {
        var n = stepN(t, 100);
        a(.9); txt("1", 24, 44, 12);
        for (var i = 0; i < 100; i++) {
          var x = 36 + (i % 20) * 13, y = 44 + Math.floor(i / 20) * 15;
          a(i < n ? .8 : .12); txt("0", x, y, 11);
        }
        var bw = W - 60;
        a(.3); line(30, 148, 30 + bw, 148);
        a(.55); line(30, 143, 30, 153); txt("10^0", 30, 162, 9, "center");
        a(.75); line(30 + bw * .8, 141, 30 + bw * .8, 155); txt("原子 10^80", 30 + bw * .8, 138, 9, "center");
        a(1); line(30 + bw, 139, 30 + bw, 157); txt("古戈尔", 30 + bw, 162, 9, "center");
      } },

    googolplex: { title: "古戈尔普勒克斯", sym: "10^(10^100)", dur: 9,
      cap: "它的零的个数就是一个古戈尔。把宇宙里每个原子当一页纸，也印不完这串零。",
      draw: function (t) {
        ctx.save(); ctx.beginPath(); ctx.rect(20, 32, W - 40, 96); ctx.clip();
        var off = (t * 240) % 16;
        for (var r = 0; r < 8; r++) {
          var y = 44 + r * 16 - off;
          a(.5 - Math.abs(r - 3.5) * .05);
          txt("000000000000000000000000000000000000", 24, y, 11);
        }
        ctx.restore();
        a(.25); rect(20, 32, W - 40, 96);
        a(.9); txt("已写 " + Math.floor(t * 1e6).toLocaleString() + " 个 0", 24, 146, 10);
        a(.55); txt("/ 共 10^100 个", W - 24, 146, 10, "right");
        a(.3); ctx.setLineDash([4, 4]); line(20, 128, W - 20, 128); ctx.setLineDash([]);
      } },

    graham: { title: "葛立恒数", sym: "g₆₄", dur: 10,
      cap: "g₁ = 3↑↑↑↑3；此后每一层的箭头数量，等于上一层的整个值。重复 64 次。",
      draw: function (t) {
        var n = stepN(t, 5);
        var rows = ["g₁ = 3↑↑↑↑3", "g₂ = 3↑…(g₁ 个箭头)…↑3", "g₃ = 3↑…(g₂ 个箭头)…↑3", "⋮", "g₆₄ = 葛立恒数"];
        for (var i = 0; i <= Math.min(n, 4); i++) {
          var y = 46 + i * 24;
          a(i === Math.min(n, 4) ? 1 : .5); txt(rows[i], 26, y, i === 4 ? 13 : 11, "left");
          if (i > 0 && i < 4) { a(.25); ctx.setLineDash([2, 3]); line(20, y - 20, 20, y - 4); line(20, y - 4, 26, y - 4); ctx.setLineDash([]); }
        }
        if (n >= 4) { a(.35); rect(20, 130, W - 40, 22); a(.8); txt("宇宙装不下它的十进制展开", W / 2, 145, 10, "center"); }
      } },

    tree: { title: "TREE(3)", sym: "Kruskal 树定理", dur: 10,
      cap: "要求序列里后面的树都不能嵌入前面的树。只用 3 种标签，这条序列的最大长度就是 TREE(3)。",
      draw: function (t) {
        var n = stepN(t, 3);
        function tree(x, y, k) {
          a(.85); line(x, y, x, y - 14); ctx.beginPath(); ctx.arc(x, y - 18, 3.2, 0, 7); ctx.stroke();
          for (var i = 0; i < k; i++) {
            var dx = (i - (k - 1) / 2) * 14;
            line(x, y - 18, x + dx, y - 34); ctx.beginPath(); ctx.arc(x + dx, y - 37, 3.2, 0, 7); ctx.stroke();
          }
        }
        for (var i = 0; i <= n && i < 3; i++) { a(.8); tree(56 + i * 78, 108, i + 1); a(.45); txt("T" + (i + 1), 56 + i * 78, 122, 10, "center"); }
        if (n >= 2) {
          a(.3); ctx.setLineDash([3, 3]); line(70, 74, 128, 74); ctx.setLineDash([]);
          a(.75); line(92, 66, 106, 82); line(106, 66, 92, 82);
          txt("不可嵌入", 99, 60, 9, "center");
        }
        a(.4); txt("TREE(1)=1  TREE(2)=3  TREE(3)= 大到 …", 20, 152, 10);
      } },

    bb: { title: "忙碌海狸", sym: "BB(n)", dur: 9,
      cap: "n 个状态的图灵机停机前最多能写多少个 1。BB(5)=47,176,870，BB(6) 至今无人知晓。",
      draw: function (t) {
        var cells = 13, cw = 20, x0 = 30, y = 70;
        var head = Math.floor(t * 26) % cells, wrote = stepN(t, cells);
        for (var i = 0; i < cells; i++) {
          a(.6); rect(x0 + i * cw, y, cw, 22);
          if (i < wrote) { a(.9); txt("1", x0 + i * cw + cw / 2, y + 16, 12, "center"); }
        }
        a(1); line(x0 + head * cw + cw / 2, y - 6, x0 + head * cw + cw / 2 - 5, y - 15);
        line(x0 + head * cw + cw / 2, y - 6, x0 + head * cw + cw / 2 + 5, y - 15);
        a(.5); txt("读写头", x0 + head * cw + cw / 2, y - 20, 9, "center");
        a(t > .9 ? 1 : .2); rect(W / 2 - 34, 108, 68, 20); txt("HALT", W / 2, 122, 12, "center");
        a(.45); txt("停机前写下的 1 的个数 = Σ(n)", 20, 152, 10);
      } },

    rayo: { title: "Rayo 数", sym: "不可定义的边界", dur: 9,
      cap: "「用一古戈尔个符号，在一阶集合论里能定义出的最大数」再加一。它不靠计算，靠语言的极限。",
      draw: function (t) {
        var syms = "∀∃∈¬∧∨=xyz{}⊂".split(""), n = stepN(t, 60);
        a(.3); rect(22, 34, W - 44, 82);
        for (var i = 0; i < n; i++) {
          a(.75); txt(syms[i % syms.length], 30 + (i % 20) * 13, 48 + Math.floor(i / 20) * 20, 11);
        }
        a(.55); txt("符号数 ≤ 10^100", 26, 128, 10);
        if (t > .75) {
          a(1); ctx.setLineDash([5, 4]); line(22, 138, W - 22, 138); ctx.setLineDash([]);
          txt("↑ 一切可定义之数", 26, 152, 10);
          txt("Rayo 数在此之上", W - 26, 152, 10, "right");
        }
      } }
  };

  var CODEX_SCENE = {
    million: "mul", googolPre_avogadro: "mul", deck52: "mul", chess_shannon: "googol",
    atoms: "googol", googol: "googol", planck: "googol", skewes: "tet", googolplex: "googolplex",
    tetration: "tet", tritri: "arrow", mega_moser: "arrow", graham: "graham", tree3: "tree",
    sscg3: "tree", loader: "fgh", bb5: "bb", bb6: "bb", bb745: "bb", rayo: "rayo", fish: "rayo",
    bigfoot: "rayo", foundation_omega: "fgh", epsilon0: "fgh", gamma0: "fgh", svo: "fgh", churchKleene: "bb"
  };
  var GEN_SCENE = ["succ", "add", "mul", "pow", "tet", "arrow", "fgh", "hyper"];

  function resolve(key) {
    if (!key) return null;
    if (SC[key]) return key;
    if (key.indexOf("codex:") === 0) return CODEX_SCENE[key.slice(6)] || "mul";
    if (key.indexOf("gen") === 0) return GEN_SCENE[Number(key.slice(3))] || "succ";
    return null;
  }

  /* ---------------- 渲染循环 ---------------- */
  var last = performance.now();
  function frameLoop(now) {
    var dt = Math.min((now - last) / 1000, .25); last = now;
    var s = SC[cur];
    if (playing && !dragging) { t += dt * speed / s.dur; if (t > 1) t -= 1; }
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1; ctx.lineJoin = "round";
    frame();
    ctx.save(); s.draw(t); ctx.restore();
    var bar = document.getElementById("demoBar");
    if (bar && bar.firstChild) bar.firstChild.style.width = (t * 100).toFixed(1) + "%";
    requestAnimationFrame(frameLoop);
  }

  function apply() {
    var s = SC[cur];
    document.getElementById("demoTitle").textContent = s.title;
    document.getElementById("demoSym").textContent = s.sym;
    document.getElementById("demoCap").textContent = s.cap;
  }
  function show(key) {
    var k = resolve(key);
    if (!k || k === cur) return;
    cur = k; t = 0; apply();
  }

  /* ---- 自动隐藏：只有指针停在可演示的元素上时才浮出来，不挡路 ---- */
  var panel = document.getElementById("demo"), hideTimer = null, pinned = false;
  function reveal() { panel.classList.remove("off"); if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } }
  function scheduleHide(ms) {
    if (pinned) return;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { panel.classList.add("off"); hideTimer = null; }, ms || 4000);
  }
  document.addEventListener("mouseover", function (ev) {
    var tg = ev.target, el = tg && tg.closest ? tg.closest("[data-demo]") : null;
    if (el) { show(el.getAttribute("data-demo")); reveal(); return; }
    if (tg && tg.closest && tg.closest("#demo")) { reveal(); return; }
    scheduleHide();
  });
  scheduleHide(9000);                       // 开局先自我介绍 9 秒
  document.addEventListener("click", function (ev) {
    var el = ev.target.closest ? ev.target.closest("[data-dact]") : null;
    if (!el) return;
    var act = el.getAttribute("data-dact");
    if (act === "play") { playing = !playing; el.textContent = playing ? "❙❙" : "▶"; }
    else if (act === "speed") {
      speed = speed === 1 ? 2 : speed === 2 ? 4 : speed === 4 ? .25 : speed === .25 ? .5 : 1;
      el.textContent = speed + "×";
    } else if (act === "fold") {
      var p = document.getElementById("demo");
      p.classList.toggle("folded");
      el.textContent = p.classList.contains("folded") ? "▲" : "▼";
    } else if (act === "step") { t = (t + .1) % 1; }
    else if (act === "pin") {
      pinned = !pinned; el.textContent = pinned ? "📌" : "📍";
      el.className = "dbtn" + (pinned ? " on" : "");
      if (pinned) reveal(); else scheduleHide();
    }
  });
  var barEl = document.getElementById("demoBar");
  function seek(ev) {
    var r = barEl.getBoundingClientRect();
    t = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
  }
  if (barEl) {
    barEl.addEventListener("mousedown", function (e) { dragging = true; seek(e); });
    window.addEventListener("mousemove", function (e) { if (dragging) seek(e); });
    window.addEventListener("mouseup", function () { dragging = false; });
  }

  apply();
  requestAnimationFrame(frameLoop);
  window.Demo = { show: show, scenes: SC };
})();
