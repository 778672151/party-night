/* =====================================================================
 *  ui.js —— 界面渲染与交互（事件委托 + 定时重绘）
 * ===================================================================== */
(function () {
  "use strict";
  var G = window.Game, BN = window.BN, DATA = window.DATA, D = BN.D, fmt = BN.format;
  var CT = window.CODEX_TEXT || {};
  var S = function () { return G.state; };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[<>&]/g, function (c) { return ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]; }); };

  /* ---------------- DOM morph：只改变化的部分，保住节点身份 ----------------
   * 之前整块 innerHTML 重建，指针下的节点每 100ms 被换掉，
   * 于是 :hover 闪烁、mousedown/mouseup 落在不同节点导致点击丢失。 */
  var CAN_MORPH = (function () {
    try { var d = document.createElement("div"); d.innerHTML = "<i>x</i>"; return !!d.firstChild; }
    catch (e) { return false; }
  })();
  function syncAttrs(f, t) {
    var i, a, ta = t.attributes, fa = f.attributes;
    for (i = 0; i < ta.length; i++) {
      a = ta[i];
      if (f.getAttribute(a.name) !== a.value) f.setAttribute(a.name, a.value);
    }
    for (i = fa.length - 1; i >= 0; i--) {
      a = fa[i];
      if (!t.hasAttribute(a.name)) f.removeAttribute(a.name);
    }
    if ("disabled" in f) f.disabled = t.hasAttribute("disabled");
  }
  function morph(from, to) {
    var f = from.firstChild, t = to.firstChild;
    while (t) {
      var nt = t.nextSibling;
      if (!f) { from.appendChild(t); t = nt; continue; }
      var nf = f.nextSibling;
      if (f.nodeType !== t.nodeType || f.nodeName !== t.nodeName) {
        from.replaceChild(t, f);
      } else if (f.nodeType === 3 || f.nodeType === 8) {
        if (f.nodeValue !== t.nodeValue) f.nodeValue = t.nodeValue;
      } else {
        syncAttrs(f, t);
        if (f.nodeName !== "TEXTAREA") morph(f, t);
      }
      f = nf; t = nt;
    }
    while (f) { var n = f.nextSibling; from.removeChild(f); f = n; }
  }
  var scratch = null;
  function paint(el, html) {
    if (!CAN_MORPH) { el.innerHTML = html; return; }
    if (!scratch) scratch = document.createElement("div");
    scratch.innerHTML = html;
    morph(el, scratch);
  }

  var TABS = [
    { id: "ops",      name: "算子",   show: function () { return true; } },
    { id: "research", name: "研究",   show: function () { return true; } },
    { id: "rebirth",  name: "转生",   show: function () { return S().rebirths > 0 || S().gpTotal.gt(0) || S().numBest.absLog10().gte(40); } },
    { id: "tower",    name: "幂塔",   show: function () { return G.towerUnlocked(); } },
    { id: "stages",   name: "关卡",   show: function () { return S().rebirths > 0 || Object.keys(S().stages).length > 0; } },
    { id: "skills",   name: "技能树", show: function () { return S().sp > 0 || S().skills.length > 0; } },
    { id: "theta",    name: "超限",   show: function () { return S().collapses > 0 || S().theta > 0; } },
    { id: "codex",    name: "百科",   show: function () { return S().codex.length > 0; } },
    { id: "setting",  name: "设置",   show: function () { return true; } }
  ];
  var tab = "ops";
  var showDeriv = false;

  /* ---------------- 小组件 ---------------- */
  function btn(act, label, dis, cls) {
    return '<button class="btn ' + (cls || "") + '" data-act="' + act + '"' + (dis ? " disabled" : "") + ">" + label + "</button>";
  }
  function kv(k, v) { return '<div class="kv"><span>' + k + "</span><span>" + v + "</span></div>"; }
  function bar(p) { return '<div class="bar"><i style="width:' + Math.max(0, Math.min(100, p * 100)).toFixed(1) + '%"></i></div>'; }

  /* ---------------- 顶栏 ---------------- */
  function renderTop() {
    var st = S(), e = G.eff;
    var total = G.numTotal();
    $("era").textContent = G.era().name + " · " + G.era().tip;
    $("numTotal").textContent = fmt(total, 3);
    var slog = total.slog();
    var sub = "算子数值 " + fmt(st.num, 3);
    if (st.h >= 1) sub += "　×　10↑↑" + fmt(D(st.h), 3);
    if (slog >= 3) sub += "　·　超对数 slog₁₀ = " + slog.toFixed(3);
    $("numSub").textContent = sub;

    var rate = st.gens[0].amount.mul(G.genMult(0));
    if (e.rules.prodPow !== 1) rate = rate.pow(e.rules.prodPow);
    var rows = [
      ["每秒产出", fmt(rate, 2)],
      ["跃迁", st.boosts + " 次 / " + st.tiers + " 层"],
      ["古戈尔点", fmt(st.gp, 2)],
      ["超越点", fmt(st.tp, 2)]
    ];
    if (G.towerUnlocked()) rows.push(["塔高 h", fmt(D(st.h), 3) + "  (+" + fmt(G.towerRate(), 2) + "/s)"]);
    if (st.theta > 0) rows.push(["超限阶", DATA.THETA[st.theta - 1].ord + "  (" + st.theta + "/" + DATA.THETA.length + ")"]);
    if (st.sp > 0 || st.skills.length) rows.push(["技能点", st.sp + " 点可用"]);
    rows.push(["大数百科", st.codex.length + " / " + DATA.CODEX.length]);
    $("topStats").innerHTML = rows.map(function (r) { return "<div><span>" + r[0] + "</span><span class='mono'>" + r[1] + "</span></div>"; }).join("");

    $("footLeft").textContent = "游戏时间 " + BN.formatTime(st.stats.played) + "　·　归零 " + st.rebirths + "　·　坍缩 " + st.collapses;
    $("footRight").textContent = "历史最大 " + fmt(st.totalBest, 3);
  }

  function renderTabs() {
    paint($("tabs"), TABS.filter(function (t) { return t.show(); }).map(function (t) {
      var dot = "";
      if (t.id === "skills" && S().sp > 0) dot = '<i class="dot"></i>';
      if (t.id === "theta" && G.canBuyTheta()) dot = '<i class="dot"></i>';
      return '<button class="tab ' + (tab === t.id ? "on" : "") + '" data-act="tab:' + t.id + '">' + t.name + dot + "</button>";
    }).join(""));
  }

  /* ---------------- 推导预览：把当前数值是怎么算出来的摊开 ---------------- */
  function derivParts() {
    var e = G.eff, out = [];
    e.parts.forEach(function (p) { out.push(p); });
    return out.sort(function (a, b) { return b.value.cmp(a.value); });
  }
  function renderFormula() {
    var st = S(), e = G.eff, el = $("formula");
    if (!el) return;
    var b = st.gens[0].bought;
    var sym = "产出 = A₁ · 2^(b₁/10) · T₁ · G";
    var num = fmt(st.gens[0].amount, 2) + " · " + fmt(D(2).pow(b / 10), 2) + " · " +
      fmt(e.tierMult[0], 2) + " · " + fmt(e.allMult, 2);
    var line = '<b class="cyan">' + sym + "</b> = " + num + "　⇒　<b>" + fmt(G.numRate(), 2) + "</b> /秒";
    if (e.rules.prodPow !== 1) line += " <span class='red'>（关卡：整体 ^" + e.rules.prodPow + "）</span>";
    if (st.h >= 1) {
      line += '<span class="fsep">│</span><b class="violet">N总 = N × 10↑↑h</b> = ' + fmt(st.num, 2) +
        " × 10↑↑" + fmt(D(st.h), 3) + " = " + fmt(G.numTotal(), 3);
    }
    paint(el, line);
  }

  /* ---------------- 算子 ---------------- */
  function renderOps() {
    var st = S(), e = G.eff, h = "";
    if (st.stage) {
      var sd = G.byId[st.stage.id], lvl = G.stageLevel(st.stage.id) + 1;
      var tgt = G.stageTarget(st.stage.id, lvl);
      var prog = Math.max(0, Math.min(1, G.logNum(st.num) / G.stageTargetExp(st.stage.id, lvl)));
      h += '<div class="card" style="border-color:var(--gold);margin-bottom:12px">' +
        '<h3 class="gold">关卡进行中：' + sd.name + ' <span class="diff">难度系数 ×' + sd.diff + "</span></h3>" +
        '<div class="hint">' + sd.ruleDesc + "</div>" +
        kv("目标（算子数值）", "<span class='mono'>" + fmt(tgt, 2) + "</span>") +
        kv("当前", "<span class='mono'>" + fmt(st.num, 2) + "</span>") + bar(prog) +
        '<div class="row" style="margin-top:8px">' + btn("stage:exit", "放弃并退出", false, "warn") + "</div></div>";
    }
    h += '<div class="card deriv" style="margin-bottom:12px" data-demo="hyper"><div class="row" style="justify-content:space-between">' +
      "<h3>乘数推导　<span class='hint'>全局乘数 G 由这些项连乘而成</span></h3>" +
      btn("toggle:deriv", showDeriv ? "收起" : "展开", false, "sm") + "</div>" +
      '<div class="fline mono">G = ' + (e.parts.length ? e.parts.map(function (p) { return p.expr; }).join(" · ") : "1") +
      " = <b class='cyan'>" + fmt(e.allMult, 3) + "</b></div>" +
      (showDeriv ? '<div class="sep"></div>' + derivParts().map(function (p) {
        return '<div class="kv"><span>' + p.label + " <span class='mono hint'>" + p.expr + "</span></span>" +
          "<span class='mono cyan'>×" + fmt(p.value, 3) + "</span></div>";
      }).join("") + '<div class="hint" style="margin-top:6px">第 k 层实际乘数 = 2^(该层已购/10) × 该层专属加成 × G。' +
        "「跃迁」重置算子换更高的 G，「归零」把 G 换成古戈尔点，「坍缩」把塔换成超越点。</div>" : "") +
      "</div>";

    h += '<div class="card" style="margin-bottom:12px"><div class="row" style="justify-content:space-between">' +
      "<div><b>跃迁</b> <span class='hint'>重置算子与数值，解锁下一层 / 获得全局 ×" + e.boostPower.toFixed(2) + "</span></div>" +
      "<div class='row'>" +
      "<span class='mono hint'>需要 " + G.boostReq() + " 个" + DATA.GENS[G.topTier()].name + "（现有 " + fmt(st.gens[G.topTier()].amount, 0) + "）</span>" +
      btn("boost", st.tiers < 8 ? "跃迁 · 解锁第 " + (st.tiers + 1) + " 层" : "跃迁 · 全局 ×" + e.boostPower.toFixed(2), !G.canBoost(), "pri") +
      "</div></div>" + bar(st.gens[G.topTier()].amount.div(G.boostReq()).toNumber()) + "</div>";

    for (var i = 0; i < 8; i++) {
      var gd = DATA.GENS[i], gs = st.gens[i];
      var unlocked = i < st.tiers;
      var active = G.tierActive(i);
      if (!unlocked && i > st.tiers) continue;
      var cost = G.genCost(i);
      var can = st.num.gte(cost) && active && !G.genCapReached(i);
      h += '<div class="gen ' + (active ? "" : "off") + '" data-demo="gen' + i + '">' +
        '<div><div class="nm">' + (i + 1) + "　" + gd.name + '</div><div class="sym mono">' + esc(gd.sym) + "</div></div>";
      if (!unlocked) {
        h += '<div class="meta">尚未解锁 —— 通过「跃迁」开启</div><div></div>';
      } else {
        h += '<div><div class="amt mono">' + fmt(gs.amount, 2) + '</div><div class="meta">已购 ' + gs.bought +
          "　乘数 ×" + fmt(G.genMult(i), 2) + (active ? "" : "　<span class='red'>（本关卡禁用）</span>") + "</div></div>" +
          '<div class="buy"><div><div class="meta mono" style="text-align:right;margin-bottom:3px">' + fmt(cost, 2) + "</div>" +
          '<div class="row">' + btn("gen:" + i + ":1", "买 1", !can) + btn("gen:" + i + ":10", "买 10", !can) +
          btn("gen:" + i + ":max", "最大", !can, "pri") + "</div></div></div>";
      }
      h += "</div>";
    }
    if (G.eff.flags.buyMax) h += '<div class="row" style="margin-top:8px">' + btn("genall", "一键全买（从高层到低层）", false, "pri") + "</div>";
    h += '<div class="hint" style="margin-top:12px">第 1 层算子直接产出「数值」，第 k 层算子产出第 k−1 层算子（系数 0.1）。' +
      "每购买 10 个，该层乘数翻倍。</div>";
    return h;
  }

  /* ---------------- 研究 ---------------- */
  function renderResearch() {
    var st = S(), h = '<div class="hint" style="margin-bottom:10px">基础研究是一次性的数学定理：<b>归零不会遗忘</b>，只有「坍缩」会重置。</div><div class="grid g2">';
    DATA.UPGRADES.forEach(function (u) {
      var own = st.upgrades.indexOf(u.id) >= 0;
      var cost = G.upgCost(u);
      var can = !own && st.num.gte(cost) && !G.eff.rules.noUpgrades;
      h += '<div class="card"><h3>' + (own ? "<span class='green'>✔</span> " : "") + u.name +
        (own ? "" : " <span class='cost'>" + fmt(cost, 2) + "</span>") + "</h3>" +
        '<div class="desc">' + u.desc + "</div>" +
        (own ? "" : btn("upg:" + u.id, "购买", !can, "full pri")) + "</div>";
    });
    return h + "</div>";
  }

  /* ---------------- 转生 ---------------- */
  function renderRebirth() {
    var st = S(), h = "";
    var gain = G.gpGain();
    h += '<div class="card"><h3 class="gold">归零 · 第一层转生</h3><div class="desc">' +
      "把算子与数值全部清零，换取<b class='gold'>古戈尔点 GP</b>。基础研究与技能会保留。<br>" +
      "收益公式： GP = ( log₁₀(数值) / 100 )<sup>2</sup> ×加成 —— 也就是说，数量级每翻一倍，收益翻四倍。</div><div class='sep'></div>" +
      kv("当前数量级", "10^" + fmt(st.num.absLog10(), 2)) +
      kv("归零门槛", "10^100（古戈尔）") +
      kv("本次可得", "<b class='gold mono'>" + fmt(gain, 2) + " GP</b>") +
      kv("已有 / 累计", fmt(st.gp, 2) + " / " + fmt(st.gpTotal, 2)) +
      kv("被动加成", "全部算子 ×(1+GP)^0.5 = ×" + fmt(D(1).add(st.gp).pow(0.5), 2)) +
      btn("rebirth", st.stage ? "关卡进行中，无法归零" : (G.canRebirth() ? "归零 · 获得 " + fmt(gain, 2) + " GP" : "需要数值达到 10^100（古戈尔）"), !G.canRebirth(), "full gold") + "</div>";

    h += '<div class="grid g2" style="margin-top:12px">';
    DATA.GP_UPGRADES.forEach(function (u) {
      var own = st.gpUpgrades.indexOf(u.id) >= 0;
      var can = !own && st.gp.gte(D(u.cost));
      h += '<div class="card"><h3>' + (own ? "<span class='green'>✔</span> " : "") + u.name +
        (own ? "" : " <span class='cost'>" + fmt(D(u.cost), 2) + " GP</span>") + "</h3>" +
        '<div class="desc">' + u.desc + "</div>" + (own ? "" : btn("gpupg:" + u.id, "购买", !can, "full gold")) + "</div>";
    });
    h += "</div>";

    var lc = G.ladderCost();
    h += '<div class="card" style="margin-top:12px"><h3>' + DATA.GP_LADDER.name + " <span class='lv'>Lv." + st.ladder + "</span></h3>" +
      '<div class="desc">' + DATA.GP_LADDER.desc + "　当前效果：全部算子 ×" + fmt(D(DATA.GP_LADDER.effect).pow(st.ladder), 2) + "</div>" +
      kv("下一级花费", fmt(lc, 2) + " GP") +
      btn("ladder", "购买一级", !st.gp.gte(lc), "full gold") + "</div>";
    return h;
  }

  /* ---------------- 幂塔 ---------------- */
  function renderTower() {
    var st = S(), h = "";
    var tp = G.tpGain();
    h += '<div class="card" data-demo="tet"><h3 class="cyan">幂塔 · 迭代幂次</h3><div class="desc">' +
      "指数已经不够用了。现在你的数值是 <span class='mono'>10↑↑h</span>——一座高度为 h 的十次幂塔：" +
      "<span class='mono'>10^10^10^…^10</span>（共 h 个 10）。<br>" +
      "塔高 h 随时间自动生长，速度取决于：算子数量级、古戈尔点、超越点、超限阶与技能。</div><div class='sep'></div>" +
      kv("塔高 h", "<b class='big mono'>" + fmt(D(st.h), 4) + "</b>") +
      kv("生长速度", "<span class='mono'>+" + fmt(G.towerRate(), 3) + " / 秒</span>") +
      kv("等效数值", "<span class='mono'>" + fmt(G.towerValue(), 3) + "</span>") +
      kv("历史最高 h", "<span class='mono'>" + fmt(D(st.hBest), 4) + "</span>") +
      '<div class="hint" style="margin-top:8px">' + BN.describeTower(st.h) + "</div></div>";

    h += '<div class="card" style="margin-top:12px"><h3 class="violet">坍缩 · 第二层转生</h3><div class="desc">' +
      "把整座塔推倒（h 归零），连同算子、跃迁、古戈尔点与古戈尔阶梯一起重置，换取<b class='violet'>超越点 TP</b>。" +
      "已购买的古戈尔升级、研究、技能、关卡与百科全部保留。<br>收益公式： TP = (h − 2)<sup>2</sup> ×加成。</div><div class='sep'></div>" +
      kv("坍缩门槛", "h ≥ 3（数值 ≥ 10^10^10）") +
      kv("本次可得", "<b class='violet mono'>" + fmt(tp, 2) + " TP</b>") +
      kv("已有 / 累计", fmt(st.tp, 2) + " / " + fmt(st.tpTotal, 2)) +
      btn("collapse", st.stage ? "关卡进行中，无法坍缩" : (G.canCollapse() ? "坍缩 · 获得 " + fmt(tp, 2) + " TP" : "需要塔高 h ≥ 3"), !G.canCollapse(), "full warn") + "</div>";

    var lc = G.tladderCost();
    h += '<div class="card" style="margin-top:12px"><h3>' + DATA.TP_LADDER.name + " <span class='lv'>Lv." + st.tladder + "</span></h3>" +
      '<div class="desc">' + DATA.TP_LADDER.desc + "　当前效果：塔高增速 ×" + fmt(D(DATA.TP_LADDER.effect).pow(st.tladder), 2) + "</div>" +
      kv("下一级花费", fmt(lc, 2) + " TP") + btn("tladder", "购买一级", !st.tp.gte(lc), "full warn") + "</div>";
    return h;
  }

  /* ---------------- 技能树 ---------------- */
  function renderSkills() {
    var st = S();
    var h = '<div class="card" style="margin-bottom:12px"><div class="row" style="justify-content:space-between">' +
      "<div><b>技能点 SP</b>　<span class='big gold mono'>" + st.sp + "</span></div>" +
      "<div class='hint'>来源：每次坍缩 +1（前 30 次）· 关卡通关 +1~2 · 每个超限阶 +2 · 每条大数百科 +1</div></div></div>";
    h += '<div class="tree">';
    DATA.SKILL_BRANCHES.forEach(function (br) {
      h += '<div class="branch"><h3 style="color:' + br.color + '">' + br.name + '</h3><div class="bdesc">' + br.desc + "</div>";
      DATA.SKILLS.filter(function (s) { return s.branch === br.id; }).forEach(function (s) {
        var own = st.skills.indexOf(s.id) >= 0;
        var can = G.skillAvailable(s.id) && st.sp >= s.cost;
        var cls = own ? "own" : (G.skillAvailable(s.id) ? (can ? "can" : "") : "lock");
        h += '<div class="node ' + cls + '" data-act="skill:' + s.id + '">' +
          '<div class="nn"><span>' + s.name + "</span><span class='cost'>" + (own ? "已学" : s.cost + " SP") + "</span></div>" +
          '<div class="ne">' + s.desc + "</div></div>";
      });
      h += "</div>";
    });
    return h + "</div>";
  }

  /* ---------------- 关卡 ---------------- */
  function renderStages() {
    var st = S();
    var h = '<div class="hint" style="margin-bottom:10px">进入关卡会重置算子层（数值 / 算子 / 跃迁），并施加特殊规则。' +
      "每个关卡有<b>难度系数</b>：系数越高，目标涨得越快，奖励也越强（奖励 = 全部算子 ×10^(难度系数×等级^1.2)）。" +
      "关卡内幂塔以 30% 速度继续生长。最高 " + G.STAGE_LEVEL_CAP + " 级。</div><div class='grid g2'>";
    DATA.STAGES.forEach(function (s) {
      var lvl = G.stageLevel(s.id);
      var maxed = lvl >= G.STAGE_LEVEL_CAP;
      var tgtExp = G.stageTargetExp(s.id, Math.min(lvl + 1, G.STAGE_LEVEL_CAP));
      var active = st.stage && st.stage.id === s.id;
      var reward = Math.pow(lvl, 1.2) * s.diff * G.eff.stageRewardMult;
      h += '<div class="stage ' + (active ? "active" : (maxed ? "done" : "")) + '">' +
        '<div class="row" style="justify-content:space-between"><h3>' + s.name +
        "</h3><span class='diff'>难度 ×" + s.diff + "</span></div>" +
        '<div class="hint" style="margin:5px 0">' + s.ruleDesc + "</div>" +
        kv("等级", "<span class='lv'>" + lvl + " / " + G.STAGE_LEVEL_CAP + "</span>") +
        kv(maxed ? "已满级" : "下一级目标", maxed ? "—" : "<span class='mono'>10^" + BN.commas(Math.round(tgtExp)) + "</span>") +
        kv("已获奖励", "全部算子 ×10^" + reward.toFixed(1)) +
        '<div class="flavor">' + s.flavor + "</div>" +
        (active ? btn("stage:exit", "退出关卡", false, "full warn")
                : btn("stage:" + s.id, maxed ? "已满级" : (st.stage ? "已有进行中的关卡" : "进入关卡"), maxed || !!st.stage, "full")) +
        "</div>";
    });
    return h + "</div>";
  }

  /* ---------------- 超限阶 ---------------- */
  function renderTheta() {
    var st = S();
    var nx = G.thetaNext();
    var h = '<div class="card" style="margin-bottom:12px"><h3 class="violet">超限阶 · 序数阶梯</h3><div class="desc">' +
      "从这里开始，数值本身已经无法书写，我们改用<b>增长率</b>来度量：快速增长层级 f<sub>α</sub>(n) 中的序数 α 有多大，" +
      "你就站在多高的位置。每提升一阶：塔高增速 ×" + DATA.TUNING.thetaRateMult + "，全部算子 ×10^" + DATA.TUNING.thetaGlobalExp + "，并 +2 技能点。</div>" +
      (nx ? '<div class="sep"></div>' +
        kv("下一阶", "<b class='violet'>" + nx.ord + "</b> —— " + nx.big) +
        kv("需要历史最高塔高", "<span class='mono'>" + fmt(D(G.thetaReqH()), 3) + "</span>（现 " + fmt(D(st.hBest), 3) + "）") +
        kv("需要超越点", "<span class='mono'>" + fmt(D(nx.cost), 2) + " TP</span>（现 " + fmt(st.tp, 2) + "）") +
        bar(Math.min(st.hBest / G.thetaReqH(), 1)) +
        btn("theta", "登上 " + nx.ord, !G.canBuyTheta(), "full warn")
        : '<div class="sep"></div><div class="center gold">你已抵达命名的尽头。</div>') + "</div>";
    h += '<div class="card">';
    DATA.THETA.forEach(function (t, i) {
      var own = st.theta > i, next = st.theta === i;
      h += '<div class="theta ' + (own ? "own" : (next ? "next" : "")) + '" data-demo="fgh">' +
        '<div class="ord mono">' + t.ord + "</div><div><div class='big2'>" + t.big +
        (own ? " <span class='green'>✔</span>" : "") + "</div><div class='note'>" + t.note + "</div>" +
        "<div class='hint mono'>需要 h ≥ " + fmt(D(t.reqH), 3) + "　·　" + fmt(D(t.cost), 2) + " TP</div></div></div>";
    });
    return h + "</div>";
  }

  /* ---------------- 百科 ---------------- */
  function renderCodex() {
    var st = S();
    var h = '<div class="hint" style="margin-bottom:10px">每解锁一条，全部算子 ×' + G.eff.codexPower +
      "（可叠乘），并 +1 技能点。已收录 " + st.codex.length + " / " + DATA.CODEX.length + " 条。</div><div class='grid g2'>";
    DATA.CODEX.forEach(function (c) {
      var t = CT[c.id] || { name: c.id, en: "", tag: "", desc: "", fact: "" };
      var own = st.codex.indexOf(c.id) >= 0;
      var req = c.req.kind === "num" ? "数值达到 " + fmt(D(c.req.value), 2)
        : c.req.kind === "h" ? "塔高 h ≥ " + c.req.value : "超限阶 ≥ " + c.req.value;
      h += '<div class="codex ' + (own ? "" : "lock") + '" data-demo="codex:' + c.id + '">' +
        '<div class="row" style="justify-content:space-between"><div class="cn">' + (own ? t.name : "？？？") +
        "</div><span class='tag' style='background:var(--line);color:var(--dim)'>" + t.tag + "</span></div>" +
        '<div class="en">' + (own ? esc(t.en) : "—") + "</div>" +
        (own ? '<div class="cd">' + esc(t.desc) + '</div><div class="cf">✦ ' + esc(t.fact) + "</div>"
             : '<div class="hint">解锁条件：' + req + "</div>") + "</div>";
    });
    return h + "</div>";
  }

  /* ---------------- 设置 ---------------- */
  function sw(key, label, on, dis) {
    return '<div class="switch"><span>' + label + (dis ? " <span class='hint'>（未解锁）</span>" : "") + "</span>" +
      '<div class="sw ' + (on ? "on" : "") + '" data-act="auto:' + key + '"><i></i></div></div>';
  }
  function renderSetting() {
    var st = S(), f = G.eff.flags;
    var h = '<div class="grid g2"><div class="card"><h3>自动化</h3>' +
      sw("gen", "自动购买算子", st.auto.gen, !f.autoGen) +
      sw("boost", "自动跃迁", st.auto.boost, !f.autoBoost) +
      sw("rebirth", "自动归零（收益足够时）", st.auto.rebirth, !f.autoRebirth) +
      sw("stage", "关卡通关后自动重开", st.auto.stage, !f.autoStage) +
      '<div class="hint" style="margin-top:8px">自动化需要先在「转生」商店或技能树中解锁。</div></div>';
    h += '<div class="card"><h3>存档</h3><div class="hint">每 15 秒自动保存到浏览器本地存储。</div>' +
      '<div class="row" style="margin-top:8px">' + btn("save", "立即保存") + btn("export", "导出存档") +
      btn("import", "导入存档") + btn("reset", "重开一切", false, "warn") + "</div>" +
      '<textarea id="saveBox" placeholder="导出的存档会出现在这里；把存档粘进来后点「导入存档」。"></textarea></div>';
    h += '<div class="card"><h3>统计</h3>' + kv("游戏总时长", BN.formatTime(st.stats.played)) +
      kv("历史最大数值", fmt(st.totalBest, 3)) + kv("算子总购买数", BN.commas(G.totalBought())) +
      kv("归零 / 坍缩", st.rebirths + " / " + st.collapses) +
      kv("已学技能", st.skills.length + " / " + DATA.SKILLS.length) +
      kv("关卡总等级", Object.keys(st.stages).reduce(function (a, k) { return a + st.stages[k]; }, 0)) + "</div>";
    h += '<div class="card"><h3>关于</h3><div class="desc">' +
      "《古戈尔机》是一款以「大数」为主题的增量游戏：从 n+1 开始，经过加法、乘法、幂次、迭代幂次、箭头记号，" +
      "一路爬到葛立恒数、TREE(3)、忙碌海狸与 Rayo 数。所有大数记号与数学事实都尽量按真实数学书写，" +
      "百科条目可当作一份小型 googology 导览。<br><br>" +
      "数值内部使用「分层表示」 <span class='mono'>sign · 10↑↑layer(mag)</span>，可精确表示到 10↑↑10<sup>308</sup> 量级。</div></div>";
    return h + "</div>";
  }

  /* ---------------- 主渲染 ---------------- */
  var RENDER = { ops: renderOps, research: renderResearch, rebirth: renderRebirth, tower: renderTower,
    skills: renderSkills, stages: renderStages, theta: renderTheta, codex: renderCodex, setting: renderSetting };

  function render() {
    var t = TABS.filter(function (x) { return x.id === tab; })[0];
    if (!t || !t.show()) tab = "ops";
    renderTop(); renderTabs(); renderFormula();
    paint($("body"), RENDER[tab]());
  }

  /* ---------------- 交互 ---------------- */
  document.addEventListener("click", function (ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!el || el.disabled) return;
    var a = el.getAttribute("data-act").split(":");
    var st = S();
    switch (a[0]) {
      case "tab": tab = a[1]; break;
      case "toggle": if (a[1] === "deriv") showDeriv = !showDeriv; break;
      case "gen": G.buyGen(Number(a[1]), a[2]); break;
      case "genall": for (var i = 7; i >= 0; i--) G.buyGen(i, "max"); break;
      case "boost": G.doBoost(); break;
      case "upg": G.buyUpgrade(a[1]); break;
      case "gpupg": G.buyGpUpgrade(a[1]); break;
      case "ladder": G.buyLadder(); break;
      case "tladder": G.buyTLadder(); break;
      case "skill": G.buySkill(a[1]); break;
      case "theta": G.buyTheta(); break;
      case "rebirth": if (confirm("确认归零？算子与数值会清零，换取 " + fmt(G.gpGain(), 2) + " 古戈尔点。")) G.doRebirth(); break;
      case "collapse": if (confirm("确认坍缩？塔高、算子、古戈尔点都会重置，换取 " + fmt(G.tpGain(), 2) + " 超越点。")) G.doCollapse(); break;
      case "stage":
        if (a[1] === "exit") G.exitStage(); else G.enterStage(a[1]);
        break;
      case "auto": st.auto[a[1]] = !st.auto[a[1]]; break;
      case "save": G.save(); G.notify("已保存", "info"); break;
      case "export": $("saveBox").value = btoa(unescape(encodeURIComponent(G.serialize()))); break;
      case "import":
        try {
          G.deserialize(decodeURIComponent(escape(atob($("saveBox").value.trim()))));
          G.notify("导入成功", "info"); G.save();
        } catch (e) { alert("存档无法解析：" + e.message); }
        break;
      case "reset":
        if (confirm("这会永久删除所有进度，确定吗？") && confirm("真的确定？没有后悔药。")) { G.hardReset(); }
        break;
    }
    G.recompute();
    render();
  });

  /* ---------------- 提示条 ---------------- */
  var lastNotif = 0;
  function pumpToasts() {
    var list = G.notifications;
    while (lastNotif < list.length) {
      var n = list[lastNotif++];
      var el = document.createElement("div");
      el.className = "toast " + n.kind;
      el.textContent = n.text;
      $("toasts").appendChild(el);
      (function (node) {
        setTimeout(function () { node.style.transition = "opacity .4s"; node.style.opacity = 0;
          setTimeout(function () { node.remove(); }, 400); }, 5200);
      })(el);
    }
    if (lastNotif > list.length) lastNotif = list.length;
  }

  /* ---------------- 主循环 ---------------- */
  var last = Date.now(), acc = 0, saveAcc = 0;
  function loop() {
    var now = Date.now();
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 10) G.catchUp(dt, dt > 240);      // 切后台 / 休眠回来后补算
    else G.tick(dt);
    acc += dt; saveAcc += dt;
    if (acc >= 0.1) { acc = 0; render(); pumpToasts(); }
    if (saveAcc >= 15) { saveAcc = 0; G.save(); }
    requestAnimationFrame(loop);
  }

  G.load();
  G.recompute();
  render();
  pumpToasts();
  window.addEventListener("beforeunload", function () { G.save(); });
  requestAnimationFrame(loop);
})();
