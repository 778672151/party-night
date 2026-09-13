/* =====================================================================
 *  data.js —— 全部内容与数值配置
 *  （纯数据 + 少量纯函数，不依赖 DOM）
 * ===================================================================== */
(function (g) {
  "use strict";

  /* ---------------------------------------------------------------
   *  可调参数：所有平衡数值集中在此，便于模拟跑分后统一微调
   * --------------------------------------------------------------- */
  var TUNING = {
    genFirstMult: 0.1,        // 高层算子生产低层算子的系数
    boostBaseReq: 20,         // 首次跃迁所需最高层算子数
    boostReqStep: 15,         // 八层全开后每次跃迁的额外需求
    boostMult: 2.2,           // 每次跃迁的全局乘数
    gpExponent: 2.0,          // GP = (log10(数值)/100)^gpExponent
    gpThreshold: 100,         // 首次归零门槛 log10 = 100（古戈尔）
    gpPassivePow: 0.5,        // 全局 ×(1+GP)^0.5
    towerRateBase: 0.01,      // 塔高基础增速（每秒）
    towerGpPow: 0.05,
    towerTpPow: 0.06,
    towerNumLog: 3,           // 塔速率 ×(1 + log10(1+log10 数值)/towerNumLog)
    towerExpCoef: 2.0,        // 全局乘数 ×10^(towerExpCoef * h^towerExpPow)
    towerExpPow: 0.6,
    collapseMinH: 3,          // 坍缩门槛：塔高 ≥ 3（数值 ≥ 10^10^10）
    tpGainPow: 2,             // TP = (h - 2)^2 × 加成
    thetaRateMult: 1.75,       // 每个超限阶的塔速率乘数
    thetaGlobalExp: 6,        // 每个超限阶的全局乘数 ×10^6
    offlineCapHours: 12,      // 离线结算上限
    offlineRate: 0.85,        // 离线效率
  };

  /* ---------------------------------------------------------------
   *  一、八层算子（主生产链）
   * --------------------------------------------------------------- */
  var GENS = [
    { id: 1, name: "后继子",  sym: "S(n) = n+1",      base: "10",   growth: "2"  ,  desc: "皮亚诺公理里最原始的动作：数出下一个数。" },
    { id: 2, name: "加法子",  sym: "a + b",           base: "1e2",  growth: "2.5",  desc: "把「数很多次」压缩成一次运算。" },
    { id: 3, name: "乘法子",  sym: "a × b",           base: "1e4",  growth: "3.2",  desc: "重复的加法。人类用了几千年才习惯它。" },
    { id: 4, name: "幂次子",  sym: "a ^ b",           base: "1e6",  growth: "4"  ,  desc: "重复的乘法。古戈尔就诞生在这一层。" },
    { id: 5, name: "迭代子",  sym: "a ↑↑ b",          base: "1e9",  growth: "6.3",  desc: "重复的幂次，即迭代幂次（tetration）。" },
    { id: 6, name: "箭头子",  sym: "a ↑ⁿ b",          base: "1e13", growth: "10" , desc: "高德纳向上箭头：把「重复」本身再重复一次。" },
    { id: 7, name: "递归子",  sym: "f_α(n)",          base: "1e18", growth: "16" , desc: "快速增长层级：用序数给增长速度编号。" },
    { id: 8, name: "超算子",  sym: "H_n(a, b)",       base: "1e24", growth: "32" , desc: "超运算的统一形式，n 越大，世界崩塌得越快。" }
  ];

  /* ---------------------------------------------------------------
   *  二、基础研究（用「数值」购买，一次性，归零不重置，坍缩重置）
   * --------------------------------------------------------------- */
  var UPGRADES = [
    { id: "u1",  name: "后继公理",     cost: "1e3",   eff: { kind: "genMult", tiers: [1, 2], value: 3 },     desc: "后继子 / 加法子 ×3" },
    { id: "u2",  name: "结合律",       cost: "1e5",   eff: { kind: "allMult", value: 2 },                    desc: "全部算子 ×2" },
    { id: "u3",  name: "分配律",       cost: "1e8",   eff: { kind: "genMult", tiers: [3, 4], value: 5 },     desc: "乘法子 / 幂次子 ×5" },
    { id: "u4",  name: "二项式定理",   cost: "1e12",  eff: { kind: "allMult", value: 3 },                    desc: "全部算子 ×3" },
    { id: "u5",  name: "对数表",       cost: "1e16",  eff: { kind: "costPow", value: 0.98 },                 desc: "算子成本增长指数 ^0.98" },
    { id: "u6",  name: "素数定理",     cost: "1e22",  eff: { kind: "dyn", id: "primeDensity" },              desc: "全部算子 ×(1 + 跃迁次数)^1.5" },
    { id: "u7",  name: "欧拉恒等式",   cost: "1e30",  eff: { kind: "allMult", value: 10 },                   desc: "全部算子 ×10" },
    { id: "u8",  name: "对角线论证",   cost: "1e42",  eff: { kind: "boostPower", value: 0.4 },               desc: "跃迁乘数 +0.4（2.2 → 2.6）" },
    { id: "u9",  name: "选择公理",     cost: "1e60",  eff: { kind: "genMult", tiers: [5, 6, 7, 8], value: 20 }, desc: "高四层算子 ×20" },
    { id: "u10", name: "不完备性",     cost: "1e85",  eff: { kind: "dyn", id: "incompleteness" },            desc: "全部算子 ×(已购研究数)^2" },
    { id: "u11", name: "连续统假设",   cost: "1e130", eff: { kind: "allMult", value: 1e4 },                  desc: "全部算子 ×10,000" },
    { id: "u12", name: "大基数公理",   cost: "1e200", eff: { kind: "dyn", id: "largeCardinal" },             desc: "全部算子 ×10^√塔高" },
    { id: "u13", name: "力迫法",       cost: "1e320", eff: { kind: "costPow", value: 0.96 },                 desc: "算子成本增长指数 ^0.96" },
    { id: "u14", name: "内模型",       cost: "1e500", eff: { kind: "allMult", value: 1e12 },                 desc: "全部算子 ×10^12" }
  ];

  /* ---------------------------------------------------------------
   *  三、古戈尔点（GP）商店 —— 第一层转生「归零」的货币
   * --------------------------------------------------------------- */
  var GP_UPGRADES = [
    { id: "g1",  name: "古戈尔透镜",   cost: "1",    eff: { kind: "allMult", value: 5 },        desc: "全部算子 ×5" },
    { id: "g2",  name: "指数记忆",     cost: "3",    eff: { kind: "boostReq", value: 0.7 },     desc: "跃迁需求 ×0.7" },
    { id: "g3",  name: "自动计数",     cost: "8",    eff: { kind: "unlock", flag: "autoGen" },  desc: "解锁：自动购买算子" },
    { id: "g6",  name: "幂塔萌芽",     cost: "25",   eff: { kind: "unlock", flag: "tower" },    desc: "解锁：幂塔系统（迭代幂次纪元）" },
    { id: "g4",  name: "自动跃迁",     cost: "70",   eff: { kind: "unlock", flag: "autoBoost" },desc: "解锁：自动跃迁" },
    { id: "g5",  name: "对数压缩",     cost: "200",  eff: { kind: "costPow", value: 0.95 },     desc: "算子成本增长指数 ^0.95" },
    { id: "g7",  name: "古戈尔共振",   cost: "800",  eff: { kind: "dyn", id: "gpResonance" },   desc: "全部算子 ×(1+GP)^0.35（额外）" },
    { id: "g8",  name: "自动归零",     cost: "3e3",  eff: { kind: "unlock", flag: "autoRebirth" }, desc: "解锁：自动归零" },
    { id: "g9",  name: "双重古戈尔",   cost: "2e4",  eff: { kind: "gpGain", value: 3 },         desc: "归零收益 ×3" },
    { id: "g10", name: "超越种子",     cost: "1.5e5",eff: { kind: "towerRate", value: 2.5 },    desc: "塔高增速 ×2.5" },
    { id: "g11", name: "归零共鸣",     cost: "2e6",  eff: { kind: "allMult", value: 1e15 },     desc: "全部算子 ×10^15" },
    { id: "g12", name: "无穷回归",     cost: "5e7",  eff: { kind: "gpPow", value: 1.1 },        desc: "归零收益 ^1.1" }
  ];

  // 可重复购买的 GP 阶梯（无限沉淀池）
  var GP_LADDER = { id: "ladder", name: "古戈尔阶梯", baseCost: "20", costMult: 8, effect: 5, desc: "每级：全部算子 ×5" };
  // 可重复购买的 TP 阶梯
  var TP_LADDER = { id: "tladder", name: "超越阶梯", baseCost: "40", costMult: 30, effect: 1.35, desc: "每级：塔高增速 ×1.35" };

  /* ---------------------------------------------------------------
   *  四、技能树（技能点 SP）
   * --------------------------------------------------------------- */
  var SKILLS = [
    // 算术分支
    { id: "a1", branch: "arith", name: "计数直觉", cost: 1, req: [],           eff: { kind: "genMult", tiers: [1,2,3,4], value: 8 },  desc: "低四层算子 ×8" },
    { id: "a2", branch: "arith", name: "心算",     cost: 2, req: ["a1"],       eff: { kind: "allMult", value: 20 },                   desc: "全部算子 ×20" },
    { id: "a3", branch: "arith", name: "批量购买", cost: 2, req: ["a1"],       eff: { kind: "unlock", flag: "buyMax" },               desc: "自动购买升级为「买最大」，并解锁一键全买" },
    { id: "a4", branch: "arith", name: "乘法表",   cost: 3, req: ["a2"],       eff: { kind: "dyn", id: "multTable" },                 desc: "全部算子 ×(1 + 算子总购买数/40)" },
    { id: "a5", branch: "arith", name: "幂次直觉", cost: 5, req: ["a3"],       eff: { kind: "genMult", tiers: [5,6,7,8], value: 50 }, desc: "高四层算子 ×50" },
    { id: "a6", branch: "arith", name: "算术极限", cost: 8, req: ["a4","a5"],  eff: { kind: "allMult", value: 1e8 },                  desc: "全部算子 ×10^8" },
    // 代数分支
    { id: "b1", branch: "algebra", name: "多项式",   cost: 1, req: [],          eff: { kind: "upgCost", value: 0.1 },   desc: "基础研究成本 ÷10" },
    { id: "b2", branch: "algebra", name: "群论",     cost: 2, req: ["b1"],      eff: { kind: "boostPower", value: 0.5 },desc: "跃迁乘数 +0.5" },
    { id: "b3", branch: "algebra", name: "域扩张",   cost: 3, req: ["b1"],      eff: { kind: "costPow", value: 0.97 },  desc: "算子成本增长指数 ^0.97" },
    { id: "b4", branch: "algebra", name: "同调代数", cost: 4, req: ["b2"],      eff: { kind: "dyn", id: "homology" },   desc: "全部算子 ×(1+跃迁次数)^2" },
    { id: "b5", branch: "algebra", name: "范畴论",   cost: 6, req: ["b3","b4"], eff: { kind: "gpGain", value: 4 },      desc: "归零收益 ×4" },
    { id: "b6", branch: "algebra", name: "代数极限", cost: 9, req: ["b5"],      eff: { kind: "allMult", value: 1e15 },  desc: "全部算子 ×10^15" },
    // 超越分支
    { id: "c1", branch: "trans", name: "超限归纳",   cost: 2, req: [],          eff: { kind: "towerRate", value: 2 },   desc: "塔高增速 ×2" },
    { id: "c2", branch: "trans", name: "对角线法",   cost: 3, req: ["c1"],      eff: { kind: "tpGain", value: 3 },      desc: "坍缩收益 ×3" },
    { id: "c3", branch: "trans", name: "不动点",     cost: 4, req: ["c1"],      eff: { kind: "dyn", id: "fixedPoint" }, desc: "塔高增速 ×(1+超越点)^0.03" },
    { id: "c4", branch: "trans", name: "基数塔",     cost: 6, req: ["c2"],      eff: { kind: "dyn", id: "cardinalTower" }, desc: "全部算子 ×10^(塔高^0.6)（塔指数加成翻倍）" },
    { id: "c5", branch: "trans", name: "序数崩塌",   cost: 8, req: ["c3","c4"], eff: { kind: "towerRate", value: 3 },   desc: "塔高增速 ×3" },
    { id: "c6", branch: "trans", name: "超越极限",   cost: 12, req: ["c5"],     eff: { kind: "towerRatePow", value: 1.04 }, desc: "塔高增速 ^1.04" },
    // 元数学分支
    { id: "d1", branch: "meta", name: "形式系统",   cost: 2, req: [],           eff: { kind: "stageTarget", value: 0.9 }, desc: "关卡目标指数 ×0.9" },
    { id: "d2", branch: "meta", name: "可判定性",   cost: 3, req: ["d1"],       eff: { kind: "stageReward", value: 1.5 }, desc: "关卡奖励指数 ×1.5" },
    { id: "d3", branch: "meta", name: "自动机",     cost: 4, req: ["d1"],       eff: { kind: "unlock", flag: "autoStage" }, desc: "解锁：关卡自动重开" },
    { id: "d4", branch: "meta", name: "哥德尔编码", cost: 6, req: ["d2"],       eff: { kind: "codexPower", value: 2.4 }, desc: "百科条目加成 ×1.6 → ×2.4" },
    { id: "d5", branch: "meta", name: "元递归",     cost: 8, req: ["d3","d4"],  eff: { kind: "thetaReq", value: 0.8 },   desc: "超限阶塔高需求 ×0.8" },
    { id: "d6", branch: "meta", name: "元数学极限", cost: 12, req: ["d5"],      eff: { kind: "allMult", value: 1e25 },   desc: "全部算子 ×10^25" }
  ];

  var SKILL_BRANCHES = [
    { id: "arith",   name: "算术",   color: "#66d9ff", desc: "把最朴素的运算推到极致。" },
    { id: "algebra", name: "代数",   color: "#c792ea", desc: "用结构与对称性折叠成本。" },
    { id: "trans",   name: "超越",   color: "#ffcb6b", desc: "迭代幂次与序数，通往塔的高处。" },
    { id: "meta",    name: "元数学", color: "#a3e635", desc: "研究「研究本身」，改写规则。" }
  ];

  /* ---------------------------------------------------------------
   *  五、关卡（难度系数 diff 决定目标增长与奖励强度）
   *  第 L 级目标： 数值 ≥ 10^(baseExp × diff^(L-1))
   *  第 L 级奖励： 全部算子 ×10^(diff × L × 关卡奖励加成)
   * --------------------------------------------------------------- */
  var STAGES = [
    { id: "s1",  name: "素数筛",     diff: 1.2, baseExp: 35,  rule: "oddOnly",
      ruleDesc: "只有奇数层算子（1/3/5/7）可以运转。", flavor: "埃拉托色尼的筛子漏掉了一半的世界。" },
    { id: "s2",  name: "归零场",     diff: 1.5, baseExp: 55,  rule: "sqrtProd",
      ruleDesc: "数值产出开平方（^0.5）。", flavor: "在这里，每一次增长都要先被开方一次。" },
    { id: "s3",  name: "对数囚笼",   diff: 1.8, baseExp: 80,  rule: "hardCost",
      ruleDesc: "算子成本增长指数 ^1.6。", flavor: "价格表用的是对数纸，可惜你只有线性的钱。" },
    { id: "s4",  name: "无穷递降",   diff: 2.2, baseExp: 110, rule: "decay",
      ruleDesc: "所有算子每秒衰减 3%。", flavor: "费马的无穷递降法：没有最小的自然数解。" },
    { id: "s5",  name: "不可数",     diff: 2.6, baseExp: 145, rule: "noUpgrades",
      ruleDesc: "无法购买基础研究。", flavor: "实数太多，多到没有一个清单能列完它们。" },
    { id: "s6",  name: "哥德尔句",   diff: 3.2, baseExp: 190, rule: "noBoost",
      ruleDesc: "跃迁不再提供任何乘数（仍可解锁层级）。", flavor: "「本命题不可证明。」于是它是真的。" },
    { id: "s7",  name: "康托尔尘",   diff: 4.0, baseExp: 250, rule: "quarterProd",
      ruleDesc: "数值产出 ^0.25。", flavor: "测度为零，维数却是 0.6309…" },
    { id: "s8",  name: "图灵停机",   diff: 5.0, baseExp: 330, rule: "halting",
      ruleDesc: "每 12 秒停机 4 秒，期间毫无产出。", flavor: "你无法预先知道它什么时候停。" },
    { id: "s9",  name: "海狸巢",     diff: 6.5, baseExp: 430, rule: "capped",
      ruleDesc: "每层算子最多 25 个。", flavor: "五个状态的图灵机，跑了四千七百万步才停。" },
    { id: "s10", name: "罗素悖论",   diff: 12,  baseExp: 600, rule: "all",
      ruleDesc: "产出 ^0.4，无研究，跃迁无乘数，每层上限 60。", flavor: "所有不包含自身的集合构成的集合……" }
  ];

  /* ---------------------------------------------------------------
   *  六、超限阶（序数阶梯）—— 终局
   * --------------------------------------------------------------- */
  var THETA = [
    { ord: "ω",        big: "3↑↑↑3 / Moser 数",  reqH: 10,     cost: "40",     note: "第一个超限序数。从此「箭头」可以任意堆叠。" },
    { ord: "ω+1",      big: "葛立恒数 G₆₄",       reqH: 40,     cost: "640",    note: "f_{ω+1}(64) 的量级，正是葛立恒数所在的高度。" },
    { ord: "ω·2",      big: "Conway 链箭号",      reqH: 160,    cost: "1e4",    note: "3→3→64→2 已经远远越过了葛立恒数。" },
    { ord: "ω²",       big: "扩展链箭号",         reqH: 640,    cost: "1.6e5",  note: "链的长度本身开始参与递归。" },
    { ord: "ω^ω",      big: "多重递归",           reqH: 2560,   cost: "2.6e6",  note: "Ackermann 函数的老家，原始递归的天花板。" },
    { ord: "ω^ω^ω",    big: "超幂递归",           reqH: 1e4,    cost: "4e7",    note: "序数自己也开始搭幂塔了。" },
    { ord: "ε₀",       big: "Goodstein 序列",     reqH: 4e4,    cost: "6.4e8",  note: "ε₀ = ω^ω^ω^…，皮亚诺算术的证明论序数。" },
    { ord: "ζ₀",       big: "Veblen 层级",        reqH: 1.6e5,  cost: "1e10",   note: "φ(1,0,0)：第一个 ε 不动点的不动点。" },
    { ord: "Γ₀",       big: "Feferman–Schütte",   reqH: 6.5e5,  cost: "1.7e11", note: "谓词分析的极限，Γ₀ 之后需要非谓词的定义。" },
    { ord: "SVO",      big: "TREE(3)",            reqH: 2.6e6,  cost: "2.7e12", note: "小 Veblen 序数：TREE 函数的增长率就在这附近。" },
    { ord: "LVO",      big: "SSCG(3) / SCG(13)",  reqH: 1.5e7,  cost: "9e13",   note: "大 Veblen 序数。次三次图序列比 TREE 还要凶悍。" },
    { ord: "BHO",      big: "Loader 数 D(5)",     reqH: 8e7,    cost: "2.5e15", note: "Bachmann–Howard 序数，可计算函数的一处高墙。" },
    { ord: "ω₁^CK",    big: "忙碌海狸 BB(n)",     reqH: 4e8,    cost: "6.5e16", note: "Church–Kleene 序数：一切可计算增长的尽头。" },
    { ord: "Rayo",     big: "Rayo 数",            reqH: 2e9,    cost: "1.6e18", note: "用一个古戈尔个符号在集合论里能定义的一切之上。" },
    { ord: "?",        big: "不可名状",           reqH: 1e10,   cost: "4e19",   note: "命名到此为止。再往上，语言本身失效了。" }
  ];

  /* ---------------------------------------------------------------
   *  七、大数百科解锁条件（文案在 codex-content.js）
   *  kind: num（总数值） / h（塔高） / theta（超限阶数）
   * --------------------------------------------------------------- */
  var CODEX = [
    { id: "million",            req: { kind: "num",   value: "1e6" } },
    { id: "bb5",                req: { kind: "num",   value: "4.7176870e7" } },
    { id: "googolPre_avogadro", req: { kind: "num",   value: "6.022e23" } },
    { id: "deck52",             req: { kind: "num",   value: "8.0658e67" } },
    { id: "atoms",              req: { kind: "num",   value: "1e80" } },
    { id: "googol",             req: { kind: "num",   value: "1e100" } },
    { id: "chess_shannon",      req: { kind: "num",   value: "1e120" } },
    { id: "planck",             req: { kind: "num",   value: "1e185" } },
    { id: "skewes",             req: { kind: "num",   value: "1|3|34" } },
    { id: "googolplex",         req: { kind: "num",   value: "1|1|1e100" } },
    { id: "tetration",          req: { kind: "h",     value: 5 } },
    { id: "bb6",                req: { kind: "theta", value: 1 } },
    { id: "foundation_omega",   req: { kind: "theta", value: 1 } },
    { id: "tritri",             req: { kind: "theta", value: 1 } },
    { id: "mega_moser",         req: { kind: "theta", value: 1 } },
    { id: "graham",             req: { kind: "theta", value: 2 } },
    { id: "epsilon0",           req: { kind: "theta", value: 7 } },
    { id: "gamma0",             req: { kind: "theta", value: 9 } },
    { id: "svo",                req: { kind: "theta", value: 10 } },
    { id: "tree3",              req: { kind: "theta", value: 10 } },
    { id: "sscg3",              req: { kind: "theta", value: 11 } },
    { id: "loader",             req: { kind: "theta", value: 12 } },
    { id: "churchKleene",       req: { kind: "theta", value: 13 } },
    { id: "bb745",              req: { kind: "theta", value: 13 } },
    { id: "rayo",               req: { kind: "theta", value: 14 } },
    { id: "fish",               req: { kind: "theta", value: 15 } },
    { id: "bigfoot",            req: { kind: "theta", value: 15 } }
  ];

  /* ---------------------------------------------------------------
   *  纪元（用于顶栏提示玩家「你现在在哪一段历史里」）
   * --------------------------------------------------------------- */
  var ERAS = [
    { name: "计数纪元",   cond: { kind: "num", value: "0" },        tip: "从 1 开始，先把数变大。" },
    { name: "指数纪元",   cond: { kind: "num", value: "1e12" },     tip: "解锁更高层算子，向古戈尔进发。" },
    { name: "古戈尔纪元", cond: { kind: "num", value: "1e100" },    tip: "10^100。可以进行第一次「归零」了。" },
    { name: "超指数纪元", cond: { kind: "num", value: "1e1000" },   tip: "指数已经不够用，指数的指数开始生长。" },
    { name: "幂塔纪元",   cond: { kind: "h",   value: 3 },          tip: "10^10^10 起步，用塔高衡量一切。" },
    { name: "箭头纪元",   cond: { kind: "theta", value: 1 },        tip: "↑↑↑ 与葛立恒数的领域。" },
    { name: "森林纪元",   cond: { kind: "theta", value: 10 },       tip: "TREE(3) 与图论怪物。" },
    { name: "海狸纪元",   cond: { kind: "theta", value: 13 },       tip: "不可计算的增长。" },
    { name: "不可名状",   cond: { kind: "theta", value: 15 },       tip: "语言的尽头。" }
  ];

  g.DATA = {
    TUNING: TUNING, GENS: GENS, UPGRADES: UPGRADES, GP_UPGRADES: GP_UPGRADES,
    GP_LADDER: GP_LADDER, TP_LADDER: TP_LADDER, SKILLS: SKILLS, SKILL_BRANCHES: SKILL_BRANCHES,
    STAGES: STAGES, THETA: THETA, CODEX: CODEX, ERAS: ERAS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = g.DATA;
})(typeof globalThis !== "undefined" ? globalThis : this);
