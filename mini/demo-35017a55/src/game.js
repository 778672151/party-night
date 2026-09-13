/* =====================================================================
 *  game.js —— 核心逻辑（不依赖 DOM，可在 node 中直接模拟）
 * ===================================================================== */
(function (g) {
  "use strict";

  var BN = g.BN || (typeof require !== "undefined" ? require("./bignum.js") : null);
  var DATA = g.DATA || (typeof require !== "undefined" ? require("./data.js") : null);
  var D = BN.D, LN = BN.LN, fmt = BN.format;
  var T = DATA.TUNING, GENS = DATA.GENS, UPGRADES = DATA.UPGRADES, GP_UPGRADES = DATA.GP_UPGRADES;
  var SKILLS = DATA.SKILLS, STAGES = DATA.STAGES, THETA = DATA.THETA, CODEX = DATA.CODEX, ERAS = DATA.ERAS;

  var byId = {};
  [UPGRADES, GP_UPGRADES, SKILLS, STAGES].forEach(function (arr) {
    arr.forEach(function (o) { byId[o.id] = o; });
  });

  var STAGE_LEVEL_CAP = 10;

  /* ---------------- 初始状态 ---------------- */
  function newState() {
    return {
      ver: 3,
      num: D(10),
      numBest: D(10),
      totalBest: D(10),
      gens: GENS.map(function (x, i) { return { amount: D(i === 0 ? 1 : 0), bought: 0 }; }),
      tiers: 4,
      boosts: 0,
      upgrades: [],
      gp: D(0), gpTotal: D(0), rebirths: 0, ladder: 0, gpUpgrades: [],
      tp: D(0), tpTotal: D(0), collapses: 0, tladder: 0,
      h: 0, hBest: 0, theta: 0,
      sp: 0, skills: [],
      stages: {}, stage: null, stageT: 0,
      codex: [],
      auto: { gen: true, boost: true, rebirth: false, stage: false },
      stats: { started: Date.now(), played: 0, lastSave: Date.now() },
      opts: { autosave: true },
      log: []
    };
  }

  var S = newState();
  var E = null;              // 当前效果缓存
  var notifications = [];

  function notify(text, kind) {
    notifications.push({ text: text, kind: kind || "info", t: Date.now() });
    if (notifications.length > 40) notifications.shift();
  }

  /* ---------------- 小工具 ---------------- */
  function has(arr, id) { return arr.indexOf(id) >= 0; }
  function floorLN(x) {
    x = D(x);
    if (x.layer === 0) return D(Math.floor(x.sign * x.mag));
    return x;
  }
  function logNum(x) {          // log10 -> JS number（0 视作 -300，超界返回 1e308）
    x = D(x);
    if (x.sign <= 0) return -300;
    var v = x.absLog10().toNumber();
    if (v === -Infinity) return -300;
    return isFinite(v) ? v : 1e308;
  }

  /* ---------------- 关卡规则 ---------------- */
  function stageRules() {
    var r = { oddOnly: false, prodPow: 1, costPow: 1, decay: 0, noUpgrades: false, noBoostMult: false, cap: 0, halting: false };
    if (!S.stage) return r;
    var st = byId[S.stage.id];
    switch (st.rule) {
      case "oddOnly": r.oddOnly = true; break;
      case "sqrtProd": r.prodPow = 0.5; break;
      case "hardCost": r.costPow = 1.6; break;
      case "decay": r.decay = 0.03; break;
      case "noUpgrades": r.noUpgrades = true; break;
      case "noBoost": r.noBoostMult = true; break;
      case "quarterProd": r.prodPow = 0.25; break;
      case "halting": r.halting = true; break;
      case "capped": r.cap = 25; break;
      case "all": r.prodPow = 0.4; r.noUpgrades = true; r.noBoostMult = true; r.cap = 60; break;
    }
    return r;
  }

  function stageTargetExp(id, level) {
    var st = byId[id];
    var growth = 1.5 + 0.05 * st.diff;
    return st.baseExp * Math.pow(growth, level - 1) * (E ? E.stageTargetMult : 1);
  }
  function stageTarget(id, level) { return BN.pow10(stageTargetExp(id, level)); }
  function stageLevel(id) { return S.stages[id] || 0; }

  /* ---------------- 效果汇总 ---------------- */
  function computeEffects() {
    var rules = stageRules();
    var e = {
      allMult: D(1),
      tierMult: [D(1), D(1), D(1), D(1), D(1), D(1), D(1), D(1)],
      costPow: 1 * rules.costPow,
      boostPower: T.boostMult,
      boostReqMult: 1,
      gpGain: D(1), gpPow: 1,
      tpGain: D(1),
      towerRate: D(1), towerRatePow: 1, towerExpCoef: T.towerExpCoef,
      upgCostMult: 1,
      stageTargetMult: 1, stageRewardMult: 1,
      codexPower: 1.6,
      thetaReqMult: 1,
      flags: {},
      rules: rules,
      parts: []                                  // 乘数明细（推导预览用）
    };
    function pushPart(label, expr, v) {
      v = D(v);
      if (v.eq(1) || v.sign === 0) return;
      e.parts.push({ label: label, expr: expr, value: v });
    }
    function group(label, expr, fn) {            // 记录一组效果对全局乘数的净贡献
      var before = e.allMult;
      fn();
      pushPart(label, expr, e.allMult.div(before));
    }

    function applyEff(ef, ownerId) {
      if (!ef) return;
      switch (ef.kind) {
        case "allMult": e.allMult = e.allMult.mul(ef.value); break;
        case "genMult": ef.tiers.forEach(function (t) { e.tierMult[t - 1] = e.tierMult[t - 1].mul(ef.value); }); break;
        case "costPow": e.costPow *= ef.value; break;
        case "boostPower": e.boostPower += ef.value; break;
        case "boostReq": e.boostReqMult *= ef.value; break;
        case "gpGain": e.gpGain = e.gpGain.mul(ef.value); break;
        case "gpPow": e.gpPow *= ef.value; break;
        case "tpGain": e.tpGain = e.tpGain.mul(ef.value); break;
        case "towerRate": e.towerRate = e.towerRate.mul(ef.value); break;
        case "towerRatePow": e.towerRatePow *= ef.value; break;
        case "upgCost": e.upgCostMult *= ef.value; break;
        case "stageTarget": e.stageTargetMult *= ef.value; break;
        case "stageReward": e.stageRewardMult *= ef.value; break;
        case "codexPower": e.codexPower = ef.value; break;
        case "thetaReq": e.thetaReqMult *= ef.value; break;
        case "unlock": e.flags[ef.flag] = true; break;
        case "dyn": applyDyn(ef.id, e); break;
      }
    }

    // 基础研究（关卡内可能被禁用）
    group("基础研究", S.upgrades.length + " 项定理", function () {
      if (!rules.noUpgrades) S.upgrades.forEach(function (id) { applyEff(byId[id].eff, id); });
    });
    // 古戈尔点升级 & 技能：永远生效
    group("古戈尔升级", S.gpUpgrades.length + " 项", function () {
      S.gpUpgrades.forEach(function (id) { applyEff(byId[id].eff, id); });
    });
    group("技能树", S.skills.length + " 个节点", function () {
      S.skills.forEach(function (id) { applyEff(byId[id].eff, id); });
    });

    // 古戈尔点被动
    var gpPassive = D(1).add(S.gp).pow(T.gpPassivePow);
    e.allMult = e.allMult.mul(gpPassive);
    pushPart("古戈尔点被动", "(1+GP)^" + T.gpPassivePow, gpPassive);
    // 阶梯
    var lad = D(DATA.GP_LADDER.effect).pow(S.ladder);
    e.allMult = e.allMult.mul(lad);
    pushPart("古戈尔阶梯", DATA.GP_LADDER.effect + "^" + S.ladder, lad);
    e.towerRate = e.towerRate.mul(D(DATA.TP_LADDER.effect).pow(S.tladder));
    // 跃迁
    if (!rules.noBoostMult) {
      var bm = D(e.boostPower).pow(S.boosts);
      e.allMult = e.allMult.mul(bm);
      pushPart("跃迁", e.boostPower.toFixed(2) + "^" + S.boosts, bm);
    }
    // 百科
    var cm = D(e.codexPower).pow(S.codex.length);
    e.allMult = e.allMult.mul(cm);
    pushPart("大数百科", e.codexPower + "^" + S.codex.length, cm);
    // 超限阶
    if (S.theta > 0) {
      var tm = BN.pow10(T.thetaGlobalExp * S.theta);
      e.allMult = e.allMult.mul(tm);
      pushPart("超限阶", "10^(" + T.thetaGlobalExp + "×" + S.theta + ")", tm);
      e.towerRate = e.towerRate.mul(D(T.thetaRateMult).pow(S.theta));
    }
    // 幂塔对算子的指数加成
    if (S.h > 0) {
      var hm = BN.pow10(e.towerExpCoef * Math.pow(S.h, T.towerExpPow));
      e.allMult = e.allMult.mul(hm);
      pushPart("幂塔指数加成", "10^(" + e.towerExpCoef + "·h^" + T.towerExpPow + ")", hm);
    }
    // 关卡奖励
    var srx = 0;
    for (var k in S.stages) {
      if (!S.stages[k]) continue;
      srx += byId[k].diff * Math.pow(S.stages[k], 1.2) * e.stageRewardMult;
    }
    if (srx > 0) {
      var sm = BN.pow10(srx);
      e.allMult = e.allMult.mul(sm);
      pushPart("关卡奖励", "10^(Σ 难度×等级^1.2)", sm);
    }
    // 超越点被动
    e.towerRate = e.towerRate.mul(D(1).add(S.gpTotal).pow(T.towerGpPow))
                             .mul(D(1).add(S.tpTotal).pow(T.towerTpPow));
    return e;
  }

  function applyDyn(id, e) {
    switch (id) {
      case "primeDensity":  e.allMult = e.allMult.mul(D(1 + S.boosts).pow(1.5)); break;
      case "incompleteness":e.allMult = e.allMult.mul(D(Math.max(1, S.upgrades.length)).pow(2)); break;
      case "largeCardinal": e.allMult = e.allMult.mul(BN.pow10(Math.sqrt(Math.max(0, S.h)))); break;
      case "gpResonance":   e.allMult = e.allMult.mul(D(1).add(S.gp).pow(0.35)); break;
      case "multTable":     e.allMult = e.allMult.mul(D(1 + totalBought() / 40)); break;
      case "homology":      e.allMult = e.allMult.mul(D(1 + S.boosts).pow(2)); break;
      case "fixedPoint":    e.towerRate = e.towerRate.mul(D(1).add(S.tpTotal).pow(0.03)); break;
      case "cardinalTower": e.towerExpCoef *= 2; break;
    }
  }

  function numRate() {                          // 每秒「数值」产出
    if (!tierActive(0)) return D(0);
    var r = S.gens[0].amount.mul(genMult(0));
    if (E.rules.prodPow !== 1) r = r.pow(E.rules.prodPow);
    return r;
  }
  function totalBought() {
    var n = 0;
    for (var i = 0; i < 8; i++) n += S.gens[i].bought;
    return n;
  }

  /* ---------------- 算子 ---------------- */
  function tierActive(i) {                       // i: 0-based
    if (i >= S.tiers) return false;
    if (E.rules.oddOnly && (i % 2 === 1)) return false;
    return true;
  }
  function genMult(i) {
    if (!tierActive(i)) return D(0);
    return D(2).pow(S.gens[i].bought / 10).mul(E.tierMult[i]).mul(E.allMult);
  }
  function genGrowth(i) { return D(GENS[i].growth).pow(E.costPow); }
  function genCost(i, bought) {
    if (bought === undefined) bought = S.gens[i].bought;
    return D(GENS[i].base).mul(genGrowth(i).pow(bought));
  }
  function genCapReached(i) {
    return E.rules.cap > 0 && S.gens[i].bought >= E.rules.cap;
  }

  function buyGen(i, mode) {
    if (!tierActive(i)) return false;
    var bought = 0;
    if (mode === "max") {
      var g0 = D(GENS[i].growth).toNumber();
      var gr = genGrowth(i);
      var grn = Math.pow(g0, E.costPow);          // 实际每次购买的涨价倍率
      var lg = Math.log10(g0) * E.costPow;
      var b0 = S.gens[i].bought;
      var maxB = Math.floor((logNum(S.num) - logNum(D(GENS[i].base))) / lg);
      if (E.rules.cap > 0) maxB = Math.min(maxB, E.rules.cap - 1);
      maxB = Math.min(maxB, b0 + 1e12, 1e15);
      // 等比求和后逐步回退，保证真的买得起
      for (var it = 0; it < 6 && maxB >= b0; it++, maxB--) {
        var k = maxB - b0 + 1;
        var sum = D(GENS[i].base).mul(gr.pow(b0)).mul(gr.pow(k).sub(1)).div(grn - 1);
        if (sum.lte(S.num)) {
          S.num = S.num.sub(sum);
          S.gens[i].bought = maxB + 1;
          S.gens[i].amount = S.gens[i].amount.add(k);
          return true;
        }
      }
      return false;
    }
    var times = mode === "10" ? 10 : 1;
    for (var t = 0; t < times; t++) {
      if (genCapReached(i)) break;
      var c = genCost(i);
      if (c.gt(S.num)) break;
      S.num = S.num.sub(c);
      S.gens[i].bought += 1;
      S.gens[i].amount = S.gens[i].amount.add(1);
      bought++;
    }
    return bought > 0;
  }

  /* ---------------- 跃迁 ---------------- */
  function boostReq() {
    var base = T.boostBaseReq + T.boostReqStep * Math.max(0, S.boosts - 3);
    return Math.ceil(base * E.boostReqMult);
  }
  function topTier() {                       // 最高的「当前可运转」层（关卡里可能跳过偶数层）
    for (var i = S.tiers - 1; i >= 0; i--) if (tierActive(i)) return i;
    return 0;
  }
  function canBoost() { return S.gens[topTier()].amount.gte(boostReq()); }
  function doBoost() {
    if (!canBoost()) return false;
    S.boosts += 1;
    if (S.tiers < 8) S.tiers += 1;
    resetGenLayer();
    return true;
  }

  function resetGenLayer() {                 // 重置后白送一个后继子，避免每次都从「手动点第一下」开始
    S.num = D(10);
    S.gens.forEach(function (gn) { gn.amount = D(0); gn.bought = 0; });
    S.gens[0].amount = D(1);
  }
  function resetToBoostStart() {
    resetGenLayer();
    S.boosts = 0;
    S.tiers = 4;
  }

  /* ---------------- 归零（第一层转生） ---------------- */
  function gpGain() {
    var L = S.num.absLog10();
    if (L.lt(T.gpThreshold)) return D(0);
    var base = L.div(T.gpThreshold).pow(T.gpExponent * E.gpPow).mul(E.gpGain);
    return floorLN(base.max(1));
  }
  function canRebirth() { return !S.stage && S.num.absLog10().gte(T.gpThreshold); }
  function doRebirth(silent) {
    if (!canRebirth()) return false;
    var gain = gpGain();
    S.gp = S.gp.add(gain);
    S.gpTotal = S.gpTotal.add(gain);
    S.rebirths += 1;
    resetToBoostStart();
    if (!silent) notify("归零完成，获得 " + fmt(gain) + " 古戈尔点", "gp");
    return true;
  }

  /* ---------------- 幂塔 ---------------- */
  function towerUnlocked() { return !!E.flags.tower; }
  function towerRate() {
    if (!towerUnlocked()) return D(0);
    var L = logNum(S.num);
    var numTerm = 1 + Math.log10(1 + Math.max(0, L)) / T.towerNumLog;
    var r = D(T.towerRateBase).mul(E.towerRate).mul(numTerm);
    if (E.towerRatePow !== 1) r = r.pow(E.towerRatePow);
    return r;
  }
  function towerValue() { return S.h >= 1 ? BN.tetrateTen(S.h) : D(1); }
  function numTotal() { return S.num.mul(towerValue()); }

  /* ---------------- 坍缩（第二层转生） ---------------- */
  function tpGain() {
    if (S.h < T.collapseMinH) return D(0);
    return floorLN(D(Math.pow(S.h - 2, T.tpGainPow)).mul(E.tpGain).max(1));
  }
  function canCollapse() { return !S.stage && S.h >= T.collapseMinH; }
  function doCollapse(silent) {
    if (!canCollapse()) return false;
    var gain = tpGain();
    S.tp = S.tp.add(gain);
    S.tpTotal = S.tpTotal.add(gain);
    S.collapses += 1;
    if (S.collapses <= 30) addSP(1, "坍缩");
    S.h = 0;
    S.gp = D(0);
    S.ladder = 0;
    resetToBoostStart();
    if (!silent) notify("坍缩完成，获得 " + fmt(gain) + " 超越点", "tp");
    return true;
  }

  /* ---------------- 超限阶 ---------------- */
  function thetaNext() { return S.theta < THETA.length ? THETA[S.theta] : null; }
  function thetaReqH() { var n = thetaNext(); return n ? n.reqH * E.thetaReqMult : Infinity; }
  function canBuyTheta() {
    var n = thetaNext();
    if (!n) return false;
    return S.hBest >= thetaReqH() && S.tp.gte(D(n.cost));
  }
  function buyTheta() {
    if (!canBuyTheta()) return false;
    var n = thetaNext();
    S.tp = S.tp.sub(D(n.cost));
    S.theta += 1;
    addSP(2, "超限阶");
    notify("抵达超限阶 " + n.ord + "（" + n.big + "）", "theta");
    return true;
  }

  /* ---------------- 购买：研究 / GP / 技能 / 阶梯 ---------------- */
  function upgCost(u) { return D(u.cost).mul(E.upgCostMult); }
  function buyUpgrade(id) {
    var u = byId[id];
    if (!u || has(S.upgrades, id) || E.rules.noUpgrades) return false;
    var c = upgCost(u);
    if (S.num.lt(c)) return false;
    S.num = S.num.sub(c);
    S.upgrades.push(id);
    return true;
  }
  function buyGpUpgrade(id) {
    var u = byId[id];
    if (!u || has(S.gpUpgrades, id)) return false;
    if (S.gp.lt(D(u.cost))) return false;
    S.gp = S.gp.sub(D(u.cost));
    S.gpUpgrades.push(id);
    if (u.eff.kind === "unlock") notify("解锁：" + u.name, "unlock");
    return true;
  }
  function ladderCost() { return D(DATA.GP_LADDER.baseCost).mul(D(DATA.GP_LADDER.costMult).pow(S.ladder)); }
  function buyLadder() {
    var c = ladderCost();
    if (S.gp.lt(c)) return false;
    S.gp = S.gp.sub(c); S.ladder += 1; return true;
  }
  function tladderCost() { return D(DATA.TP_LADDER.baseCost).mul(D(DATA.TP_LADDER.costMult).pow(S.tladder)); }
  function buyTLadder() {
    var c = tladderCost();
    if (S.tp.lt(c)) return false;
    S.tp = S.tp.sub(c); S.tladder += 1; return true;
  }
  function skillAvailable(id) {
    var s = byId[id];
    if (!s || has(S.skills, id)) return false;
    for (var i = 0; i < s.req.length; i++) if (!has(S.skills, s.req[i])) return false;
    return true;
  }
  function buySkill(id) {
    if (!skillAvailable(id)) return false;
    var s = byId[id];
    if (S.sp < s.cost) return false;
    S.sp -= s.cost;
    S.skills.push(id);
    notify("学会技能：" + s.name, "skill");
    return true;
  }
  function addSP(n, why) {
    S.sp += n;
    if (why) notify("+" + n + " 技能点（" + why + "）", "sp");
  }

  /* ---------------- 关卡 ---------------- */
  function enterStage(id) {
    if (S.stage) return false;
    if (stageLevel(id) >= STAGE_LEVEL_CAP) return false;
    S.stage = { id: id };
    S.stageT = 0;
    resetToBoostStart();
    E = computeEffects();
    return true;
  }
  function exitStage() {
    if (!S.stage) return false;
    S.stage = null;
    resetToBoostStart();
    E = computeEffects();
    return true;
  }
  function stageComplete() {
    if (!S.stage) return false;
    return S.num.gte(stageTarget(S.stage.id, stageLevel(S.stage.id) + 1));
  }
  function claimStage() {
    if (!stageComplete()) return false;
    var id = S.stage.id;
    var lvl = stageLevel(id) + 1;
    S.stages[id] = lvl;
    var st = byId[id];
    if (lvl === 1) addSP(2, "首次通关 " + st.name);
    else if (lvl === 3 || lvl === 5 || lvl === 7 || lvl === 10) addSP(1, st.name + " 第 " + lvl + " 级");
    notify("通关「" + st.name + "」第 " + lvl + " 级（难度系数 " + st.diff + "）", "stage");
    var auto = E.flags.autoStage && S.auto.stage && lvl < STAGE_LEVEL_CAP;
    S.stage = null;
    resetToBoostStart();
    E = computeEffects();
    if (auto) enterStage(id);
    return true;
  }

  /* ---------------- 百科 ---------------- */
  function codexMet(req) {
    if (req.kind === "num") return numTotal().gte(D(req.value));
    if (req.kind === "h") return S.h >= req.value;
    if (req.kind === "theta") return S.theta >= req.value;
    return false;
  }
  function checkCodex() {
    for (var i = 0; i < CODEX.length; i++) {
      var c = CODEX[i];
      if (has(S.codex, c.id)) continue;
      if (codexMet(c.req)) {
        S.codex.push(c.id);
        addSP(1, "大数百科");
        var t = (g.CODEX_TEXT || {})[c.id];
        notify("大数百科解锁：" + (t ? t.name : c.id), "codex");
      }
    }
  }

  function era() {
    var cur = ERAS[0];
    for (var i = 0; i < ERAS.length; i++) {
      var c = ERAS[i].cond, ok = false;
      if (c.kind === "num") ok = numTotal().gte(D(c.value));
      else if (c.kind === "h") ok = S.h >= c.value;
      else if (c.kind === "theta") ok = S.theta >= c.value;
      if (ok) cur = ERAS[i];
    }
    return cur;
  }

  /* ---------------- 主循环 ---------------- */
  function tick(dt) {
    if (!(dt > 0)) return;
    if (dt > 3600) dt = 3600;
    E = computeEffects();
    S.stats.played += dt;
    if (S.stage) S.stageT += dt;

    var halted = E.rules.halting && (S.stageT % 12) >= 8;

    // 自动化
    if (S.auto.gen && E.flags.autoGen) {
      for (var i = 7; i >= 0; i--) if (tierActive(i) && !genCapReached(i)) buyGen(i, E.flags.buyMax ? "max" : "1");
    }
    if (S.auto.boost && E.flags.autoBoost && canBoost()) { doBoost(); E = computeEffects(); }

    if (!halted) {
      // 高层 -> 低层
      for (var k = 7; k >= 1; k--) {
        if (!tierActive(k)) continue;
        var prod = S.gens[k].amount.mul(genMult(k)).mul(T.genFirstMult * dt);
        S.gens[k - 1].amount = S.gens[k - 1].amount.add(prod);
      }
      // 第一层 -> 数值
      if (tierActive(0)) {
        var rate = S.gens[0].amount.mul(genMult(0));
        if (E.rules.prodPow !== 1) rate = rate.pow(E.rules.prodPow);
        S.num = S.num.add(rate.mul(dt));
      }
    }
    // 衰减
    if (E.rules.decay > 0) {
      var keep = Math.pow(1 - E.rules.decay, dt);
      for (var d2 = 0; d2 < 8; d2++) S.gens[d2].amount = S.gens[d2].amount.mul(keep);
    }
    // 幂塔（关卡中以 30% 速率继续生长）
    if (towerUnlocked()) {
      var tr = towerRate().toNumber() * (S.stage ? 0.3 : 1);
      if (isFinite(tr)) S.h += tr * dt;
      if (S.h > S.hBest) S.hBest = S.h;
    }

    // 自动转生
    if (S.auto.rebirth && E.flags.autoRebirth && !S.stage && canRebirth() && gpGain().gte(S.gp.mul(0.15))) doRebirth(true);
    // 关卡自动领取
    if (S.stage && stageComplete()) claimStage();

    if (S.num.gt(S.numBest)) S.numBest = S.num;
    var tot = numTotal();
    if (tot.gt(S.totalBest)) S.totalBest = tot;
    checkCodex();
  }

  /* ---------------- 存档 ---------------- */
  function serialize() {
    function n(x) { return D(x).toJSONString(); }
    return JSON.stringify({
      ver: S.ver, num: n(S.num), numBest: n(S.numBest), totalBest: n(S.totalBest),
      gens: S.gens.map(function (x) { return [n(x.amount), x.bought]; }),
      tiers: S.tiers, boosts: S.boosts, upgrades: S.upgrades,
      gp: n(S.gp), gpTotal: n(S.gpTotal), rebirths: S.rebirths, ladder: S.ladder, gpUpgrades: S.gpUpgrades,
      tp: n(S.tp), tpTotal: n(S.tpTotal), collapses: S.collapses, tladder: S.tladder,
      h: S.h, hBest: S.hBest, theta: S.theta,
      sp: S.sp, skills: S.skills, stages: S.stages, stage: S.stage, stageT: S.stageT,
      codex: S.codex, auto: S.auto, stats: S.stats, opts: S.opts
    });
  }
  function deserialize(str) {
    var o = JSON.parse(str);
    var ns = newState();
    ns.ver = o.ver;
    ns.num = D(o.num); ns.numBest = D(o.numBest); ns.totalBest = D(o.totalBest || o.numBest);
    ns.gens = o.gens.map(function (x) { return { amount: D(x[0]), bought: x[1] }; });
    ns.tiers = o.tiers; ns.boosts = o.boosts; ns.upgrades = o.upgrades || [];
    ns.gp = D(o.gp); ns.gpTotal = D(o.gpTotal); ns.rebirths = o.rebirths || 0;
    ns.ladder = o.ladder || 0; ns.gpUpgrades = o.gpUpgrades || [];
    ns.tp = D(o.tp); ns.tpTotal = D(o.tpTotal); ns.collapses = o.collapses || 0; ns.tladder = o.tladder || 0;
    ns.h = o.h || 0; ns.hBest = o.hBest || 0; ns.theta = o.theta || 0;
    ns.sp = o.sp || 0; ns.skills = o.skills || []; ns.stages = o.stages || {};
    ns.stage = o.stage || null; ns.stageT = o.stageT || 0;
    ns.codex = o.codex || []; ns.auto = o.auto || ns.auto; ns.stats = o.stats || ns.stats;
    ns.opts = o.opts || ns.opts;
    S = ns;
    E = computeEffects();
    return true;
  }

  var SAVE_KEY = "googol_idle_save_v3";
  function save() {
    S.stats.lastSave = Date.now();
    try { if (typeof localStorage !== "undefined") localStorage.setItem(SAVE_KEY, btoa(unescape(encodeURIComponent(serialize())))); } catch (err) {}
  }
  function load() {
    try {
      if (typeof localStorage === "undefined") return false;
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      var json = decodeURIComponent(escape(atob(raw)));
      deserialize(json);
      var away = (Date.now() - (S.stats.lastSave || Date.now())) / 1000;
      if (away > 60) offline(away);
      return true;
    } catch (err) { console.warn("读档失败", err); return false; }
  }
  // 追赶：把一大段时间切成小步积分，避免大 dt 让链式产出失真
  function catchUp(sec, announce) {
    var capped = Math.min(sec, T.offlineCapHours * 3600);
    var steps = Math.max(8, Math.min(300, Math.ceil(capped / 2)));
    var dt = capped / steps * T.offlineRate;
    for (var i = 0; i < steps; i++) tick(dt);
    if (announce) notify("离开了 " + BN.formatTime(sec) + "，结算了 " + BN.formatTime(capped * T.offlineRate) + " 的产出", "offline");
  }
  function offline(sec) { catchUp(sec, true); }
  function hardReset() { S = newState(); E = computeEffects(); save(); }

  E = computeEffects();

  g.Game = {
    get state() { return S; },
    set state(v) { S = v; },
    get eff() { return E; },
    newState: newState, notifications: notifications, notify: notify,
    tick: tick, recompute: function () { E = computeEffects(); return E; },
    GENS: GENS, byId: byId, STAGE_LEVEL_CAP: STAGE_LEVEL_CAP,
    genMult: genMult, genCost: genCost, buyGen: buyGen, tierActive: tierActive, genCapReached: genCapReached,
    boostReq: boostReq, canBoost: canBoost, doBoost: doBoost, topTier: topTier,
    gpGain: gpGain, canRebirth: canRebirth, doRebirth: doRebirth,
    tpGain: tpGain, canCollapse: canCollapse, doCollapse: doCollapse,
    towerRate: towerRate, towerUnlocked: towerUnlocked, towerValue: towerValue, numTotal: numTotal,
    thetaNext: thetaNext, thetaReqH: thetaReqH, canBuyTheta: canBuyTheta, buyTheta: buyTheta,
    upgCost: upgCost, buyUpgrade: buyUpgrade, buyGpUpgrade: buyGpUpgrade,
    ladderCost: ladderCost, buyLadder: buyLadder, tladderCost: tladderCost, buyTLadder: buyTLadder,
    skillAvailable: skillAvailable, buySkill: buySkill, addSP: addSP,
    enterStage: enterStage, exitStage: exitStage, claimStage: claimStage, stageComplete: stageComplete,
    stageTarget: stageTarget, stageTargetExp: stageTargetExp, stageLevel: stageLevel,
    checkCodex: checkCodex, era: era, totalBought: totalBought, logNum: logNum, numRate: numRate,
    save: save, load: load, catchUp: catchUp, serialize: serialize, deserialize: deserialize, hardReset: hardReset, offline: offline,
    SAVE_KEY: SAVE_KEY
  };
  if (typeof module !== "undefined" && module.exports) module.exports = g.Game;
})(typeof globalThis !== "undefined" ? globalThis : this);
