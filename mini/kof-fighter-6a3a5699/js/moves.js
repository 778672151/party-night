/* moves.js — 招式帧数据。判定框全部挂在骨骼关节上，视觉与判定天然一致 */
(function (G) {
  'use strict';
  var P = G.Rig.P, PO = G.Rig.POSE;
  function K(t, o, ease) { return { t: t, pose: P(o), ease: ease }; }
  function KP(t, pose, ease) { return { t: t, pose: pose, ease: ease }; }

  /* 通用受身/系统姿势 */
  var CR = { p: [0, 52], c: [-4, 94], h: [3, 130], eB: [-16, 84], hB: [-2, 80], eF: [12, 80], hF: [24, 76], kB: [-22, 30], fB: [-28, 2], kF: [26, 32], fF: [30, 2] };
  var AIR = { p: [0, 94], c: [-3, 136], h: [4, 172], kF: [20, 56], fF: [31, 22], kB: [-14, 52], fB: [-27, 16], eF: [14, 118], hF: [23, 130], eB: [-18, 122], hB: [-8, 130] };

  /* ---------- 普通技 ---------- */
  function baseMoves() {
    var m = {};

    m['5A'] = { id: '5A', name: '轻拳', kind: 'normal', total: 14, whiff: 'whiffL', trailCol: 'rgba(255,255,255,.42)',
      keys: [K(0, { eF: [6, 116], hF: [14, 114] }), K(4, { eF: [34, 124], hF: [62, 124], c: [0, 131], h: [6, 168], p: [2, 90] }, 'oc'),
        K(8, { eF: [30, 122], hF: [54, 122] }), K(14, {})],
      hits: [{ act: [4, 6], box: { from: 'eF', to: 'hF', r: 15, ext: 4 }, dmg: 24, level: 1, guard: 'mid',
        hitstun: 13, blockstun: 8, hitstop: 5, push: [2.4, 0], spark: 'light', sfx: 'hitL', skip: 'armF' }],
      cancel: { into: ['light', 'heavy', 'special', 'super'], on: 'always', win: [4, 14] } };

    m['5B'] = { id: '5B', name: '轻脚', kind: 'normal', total: 16, whiff: 'whiffL', trailCol: 'rgba(200,235,255,.45)',
      keys: [K(0, {}), K(3, { kF: [24, 60], fF: [26, 40], p: [-1, 88] }, 'oc'),
        K(6, { kF: [36, 56], fF: [70, 60], p: [-2, 86], c: [-8, 128], eB: [-22, 118], hB: [-12, 122] }, 'oc'),
        K(10, { kF: [24, 58], fF: [30, 38] }), K(16, {})],
      hits: [{ act: [5, 8], box: { from: 'kF', to: 'fF', r: 15, ext: 4 }, dmg: 28, level: 1, guard: 'mid',
        hitstun: 14, blockstun: 9, hitstop: 5, push: [2.8, 0], spark: 'light', sfx: 'hitL', skip: 'legF' }],
      cancel: { into: ['light', 'heavy', 'special', 'super'], on: 'always', win: [5, 16] } };

    m['5C'] = { id: '5C', name: '重拳', kind: 'normal', total: 26, whiff: 'whiffH', trailCol: 'rgba(255,214,140,.55)',
      keys: [K(0, { eF: [-4, 120], hF: [-20, 124], c: [-10, 132], h: [-2, 168], p: [-4, 90] }),
        K(5, { eF: [-8, 122], hF: [-30, 128], c: [-12, 132], p: [-6, 90] }, 'io'),
        K(9, { eF: [38, 130], hF: [80, 128], c: [4, 132], h: [10, 170], p: [4, 90], fF: [34, 2], kF: [22, 46], eB: [-24, 118], hB: [-18, 106] }, 'oc'),
        K(14, { eF: [34, 128], hF: [74, 126], c: [2, 132], p: [3, 90] }), K(26, {})],
      hits: [{ act: [9, 12], box: { from: 'eF', to: 'hF', r: 17, ext: 6 }, dmg: 72, level: 3, guard: 'mid',
        hitstun: 22, blockstun: 13, hitstop: 10, push: [4.6, 0], spark: 'heavy', sfx: 'hitH', skip: 'armF', shake: 9 }],
      cancel: { into: ['special', 'super'], on: 'hit', win: [9, 20] } };

    m['5D'] = { id: '5D', name: '重脚', kind: 'normal', total: 30, whiff: 'whiffH', trailCol: 'rgba(255,190,120,.55)',
      keys: [K(0, { p: [-4, 88], c: [-10, 130], h: [-6, 166], fF: [20, 2] }),
        K(5, { kF: [26, 70], fF: [20, 50], p: [-2, 84], c: [-8, 126], h: [-4, 162] }, 'io'),
        K(11, { kF: [40, 86], fF: [86, 116], p: [-6, 84], c: [-16, 124], h: [-14, 157], hB: [-28, 116], eB: [-26, 124], hF: [-4, 118], eF: [-12, 126] }, 'oc'),
        K(17, { kF: [38, 80], fF: [80, 106], p: [-6, 84], c: [-14, 124] }), K(30, {})],
      hits: [{ act: [11, 15], box: { from: 'kF', to: 'fF', r: 16, ext: 5 }, dmg: 78, level: 3, guard: 'mid',
        hitstun: 24, blockstun: 14, hitstop: 11, push: [5.4, 0], spark: 'heavy', sfx: 'hitH', skip: 'legF', shake: 10 }],
      cancel: { into: ['special', 'super'], on: 'hit', win: [11, 24] } };

    m['2A'] = { id: '2A', name: '下轻拳', kind: 'normal', crouch: 1, total: 13, whiff: 'whiffL', trailCol: 'rgba(255,255,255,.4)',
      keys: [KP(0, P(CR)), K(4, { p: [0, 52], c: [-2, 94], h: [5, 130], eF: [28, 82], hF: [52, 84], kB: [-22, 30], fB: [-28, 2], kF: [26, 32], fF: [30, 2], eB: [-16, 84], hB: [-2, 80] }, 'oc'),
        K(7, { p: [0, 52], c: [-3, 94], h: [4, 130], eF: [26, 82], hF: [46, 82], kB: [-22, 30], fB: [-28, 2], kF: [26, 32], fF: [30, 2], eB: [-16, 84], hB: [-2, 80] }), KP(13, P(CR))],
      hits: [{ act: [4, 6], box: { from: 'eF', to: 'hF', r: 14, ext: 3 }, dmg: 22, level: 1, guard: 'mid',
        hitstun: 12, blockstun: 8, hitstop: 5, push: [2, 0], spark: 'light', sfx: 'hitL', skip: 'armF' }],
      cancel: { into: ['light', 'heavy', 'special', 'super'], on: 'always', win: [4, 13] } };

    m['2B'] = { id: '2B', name: '下段腿', kind: 'normal', crouch: 1, total: 15, whiff: 'whiffL', trailCol: 'rgba(200,235,255,.45)',
      keys: [KP(0, P(CR)), K(5, { p: [0, 50], c: [-6, 92], h: [1, 128], kF: [34, 26], fF: [62, 16], eF: [10, 78], hF: [20, 72], eB: [-18, 82], hB: [-6, 76], kB: [-22, 30], fB: [-28, 2] }, 'oc'),
        K(8, { p: [0, 50], c: [-6, 92], h: [1, 128], kF: [32, 26], fF: [56, 14], eF: [10, 78], hF: [20, 72], eB: [-18, 82], hB: [-6, 76], kB: [-22, 30], fB: [-28, 2] }), KP(15, P(CR))],
      hits: [{ act: [5, 7], box: { from: 'kF', to: 'fF', r: 13, ext: 4 }, dmg: 26, level: 1, guard: 'low',
        hitstun: 13, blockstun: 9, hitstop: 5, push: [2.2, 0], spark: 'light', sfx: 'hitL', skip: 'legF' }],
      cancel: { into: ['light', 'heavy', 'special', 'super'], on: 'always', win: [5, 15] } };

    m['2C'] = { id: '2C', name: '对空升拳', kind: 'normal', crouch: 1, total: 30, whiff: 'whiffH', trailCol: 'rgba(180,220,255,.6)',
      keys: [K(0, { p: [0, 64], c: [-6, 104], h: [0, 140], eF: [6, 88], hF: [14, 74], kF: [24, 38], fF: [28, 2], kB: [-22, 36], fB: [-28, 2], eB: [-16, 96], hB: [-6, 84] }),
        K(7, { p: [0, 96], c: [0, 138], h: [4, 176], eF: [24, 148], hF: [42, 190], kF: [18, 50], fF: [26, 4], kB: [-16, 50], fB: [-26, 4], eB: [-18, 120], hB: [-10, 106] }, 'oc'),
        K(12, { p: [0, 94], c: [0, 136], h: [4, 174], eF: [26, 150], hF: [44, 194], kF: [18, 50], fF: [26, 4], kB: [-16, 50], fB: [-26, 4], eB: [-18, 120], hB: [-10, 106] }),
        K(20, { p: [0, 76], c: [-4, 116], h: [2, 152], eF: [12, 110], hF: [20, 120] }), K(30, {})],
      hits: [{ act: [7, 12], box: { from: 'eF', to: 'hF', r: 19, ext: 5 }, dmg: 68, level: 3, guard: 'mid',
        hitstun: 26, blockstun: 13, hitstop: 9, push: [1.6, 0], launch: 11.5, juggle: 1, spark: 'heavy', sfx: 'hitH', skip: 'armF', shake: 8 }],
      cancel: { into: ['super'], on: 'hit', win: [7, 22] } };

    m['2D'] = { id: '2D', name: '扫腿', kind: 'normal', crouch: 1, total: 32, whiff: 'whiffH', trailCol: 'rgba(255,205,130,.55)',
      keys: [KP(0, P(CR)), K(5, { p: [0, 50], c: [-8, 90], h: [-4, 126], kF: [18, 26], fF: [16, 10], kB: [-22, 28], fB: [-28, 2], eF: [4, 74], hF: [12, 62], eB: [-18, 78], hB: [-8, 66] }, 'io'),
        K(10, { p: [-6, 44], c: [-18, 84], h: [-14, 118], kF: [40, 20], fF: [84, 10], kB: [-20, 24], fB: [-26, 2], hF: [-8, 52], eF: [-14, 66], hB: [-30, 44], eB: [-24, 60] }, 'oc'),
        K(16, { p: [-6, 44], c: [-18, 84], h: [-14, 118], kF: [38, 20], fF: [76, 10], kB: [-20, 24], fB: [-26, 2], hF: [-8, 52], eF: [-14, 66], hB: [-30, 44], eB: [-24, 60] }),
        K(24, { p: [0, 52], c: [-6, 94], h: [0, 130], kF: [24, 30], fF: [28, 2] }), K(32, {})],
      hits: [{ act: [10, 14], box: { from: 'kF', to: 'fF', r: 14, ext: 4 }, dmg: 70, level: 3, guard: 'low',
        hitstun: 26, blockstun: 14, hitstop: 10, push: [4, 0], kd: 1, spark: 'heavy', sfx: 'hitH', skip: 'legF', shake: 9 }],
      cancel: { into: ['super'], on: 'hit', win: [10, 22] } };

    /* 空中技 */
    m['jA'] = { id: 'jA', name: '空中轻拳', kind: 'normal', air: 1, total: 20, whiff: 'whiffL', trailCol: 'rgba(255,255,255,.4)',
      keys: [KP(0, P(AIR)), K(4, { p: [0, 94], c: [-3, 136], h: [4, 172], eF: [30, 124], hF: [56, 124], kF: [20, 56], fF: [31, 22], kB: [-14, 52], fB: [-27, 16], eB: [-18, 122], hB: [-8, 130] }, 'oc'),
        K(18, { p: [0, 94], c: [-3, 136], h: [4, 172], eF: [28, 124], hF: [50, 124], kF: [20, 56], fF: [31, 22], kB: [-14, 52], fB: [-27, 16], eB: [-18, 122], hB: [-8, 130] })],
      hits: [{ act: [4, 16], box: { from: 'eF', to: 'hF', r: 15, ext: 4 }, dmg: 26, level: 1, guard: 'high',
        hitstun: 14, blockstun: 9, hitstop: 5, push: [2.4, 0], spark: 'light', sfx: 'hitL', skip: 'armF' }],
      cancel: { into: [], on: 'hit', win: [0, 0] }, landCancel: 1 };

    m['jC'] = { id: 'jC', name: '空中重拳', kind: 'normal', air: 1, total: 26, whiff: 'whiffH', trailCol: 'rgba(255,214,140,.55)',
      keys: [K(0, { p: [0, 94], c: [-3, 136], h: [4, 172], eF: [6, 142], hF: [10, 162], kF: [20, 56], fF: [31, 22], kB: [-14, 52], fB: [-27, 16], eB: [-18, 122], hB: [-8, 130] }),
        K(7, { p: [0, 92], c: [0, 134], h: [8, 170], eF: [34, 118], hF: [64, 90], kF: [22, 54], fF: [33, 20], kB: [-14, 52], fB: [-27, 16], eB: [-20, 120], hB: [-14, 128] }, 'oc'),
        K(24, { p: [0, 92], c: [0, 134], h: [8, 170], eF: [32, 118], hF: [58, 92], kF: [22, 54], fF: [33, 20], kB: [-14, 52], fB: [-27, 16], eB: [-20, 120], hB: [-14, 128] })],
      hits: [{ act: [7, 18], box: { from: 'eF', to: 'hF', r: 17, ext: 5 }, dmg: 70, level: 3, guard: 'high',
        hitstun: 22, blockstun: 13, hitstop: 10, push: [3.6, 0], spark: 'heavy', sfx: 'hitH', skip: 'armF', shake: 8 }],
      cancel: { into: [], on: 'hit', win: [0, 0] }, landCancel: 1 };

    m['jD'] = { id: 'jD', name: '空中重脚', kind: 'normal', air: 1, total: 26, whiff: 'whiffH', trailCol: 'rgba(255,190,120,.55)',
      keys: [KP(0, P(AIR)), K(8, { p: [0, 92], c: [-6, 132], h: [2, 168], kF: [34, 66], fF: [84, 40], kB: [-18, 60], fB: [-30, 50], eF: [8, 118], hF: [16, 108], eB: [-20, 122], hB: [-14, 132] }, 'oc'),
        K(24, { p: [0, 92], c: [-6, 132], h: [2, 168], kF: [32, 64], fF: [78, 40], kB: [-18, 60], fB: [-30, 50], eF: [8, 118], hF: [16, 108], eB: [-20, 122], hB: [-14, 132] })],
      hits: [{ act: [8, 20], box: { from: 'kF', to: 'fF', r: 16, ext: 5 }, dmg: 74, level: 3, guard: 'high',
        hitstun: 23, blockstun: 13, hitstop: 10, push: [4.2, 0], spark: 'heavy', sfx: 'hitH', skip: 'legF', shake: 9 }],
      cancel: { into: [], on: 'hit', win: [0, 0] }, landCancel: 1 };

    /* 系统技：翻滚 / 吹飞攻击 / 投技 */
    m['roll'] = { id: 'roll', name: '紧急回避', kind: 'system', total: 30, whiff: 'roll',
      keys: [K(0, {}), K(6, { p: [6, 44], c: [16, 64], h: [26, 84], eF: [24, 52], hF: [34, 36], eB: [8, 58], hB: [18, 40], kF: [24, 26], fF: [16, 6], kB: [-6, 30], fB: [-16, 10] }, 'oc'),
        K(14, { p: [10, 40], c: [24, 52], h: [36, 60], eF: [34, 44], hF: [46, 24], eB: [16, 48], hB: [28, 28], kF: [28, 20], fF: [22, 4], kB: [0, 24], fB: [-10, 8] }),
        K(22, { p: [4, 54], c: [-2, 96], h: [6, 132], eF: [14, 82], hF: [26, 78], kF: [24, 32], fF: [28, 2], kB: [-20, 30], fB: [-26, 2] }, 'oc'), K(30, {})],
      hits: [], vel: [{ t: 0, vx: 7.4 }, { t: 16, vx: 0 }], invul: { win: [3, 20], type: 'all' },
      cancel: { into: [], on: 'hit', win: [0, 0] } };

    m['CD'] = { id: 'CD', name: '吹飞攻击', kind: 'system', total: 34, whiff: 'whiffH', trailCol: 'rgba(255,236,160,.7)',
      keys: [K(0, { p: [-6, 88], c: [-16, 130], h: [-10, 166], eF: [-8, 118], hF: [-26, 110], eB: [-22, 116], hB: [-14, 100] }),
        K(8, { p: [-8, 86], c: [-20, 128], h: [-14, 164], eF: [-12, 118], hF: [-34, 112], eB: [-24, 116], hB: [-18, 100] }, 'io'),
        K(12, { p: [8, 90], c: [16, 132], h: [22, 168], eF: [40, 132], hF: [92, 140], fF: [36, 2], kF: [24, 46], eB: [-14, 118], hB: [-4, 108] }, 'oc'),
        K(18, { p: [6, 90], c: [12, 132], h: [18, 168], eF: [36, 130], hF: [84, 136], fF: [34, 2], kF: [22, 46] }), K(34, {})],
      hits: [{ act: [12, 16], box: { from: 'eF', to: 'hF', r: 19, ext: 3 }, dmg: 92, level: 4, guard: 'mid',
        hitstun: 30, blockstun: 18, hitstop: 13, push: [9.5, 0], launch: 6.5, wallSlam: 1, spark: 'heavy', sfx: 'hitH', skip: 'armF', shake: 14 }],
      cancel: { into: [], on: 'hit', win: [0, 0] } };

    m['throw'] = { id: 'throw', name: '投技', kind: 'throw', total: 22, range: 74,
      keys: [K(0, { eF: [16, 120], hF: [30, 124], eB: [4, 118], hB: [22, 116] }),
        K(4, { p: [2, 88], c: [4, 130], h: [10, 167], eF: [18, 118], hF: [36, 126], eB: [6, 118], hB: [30, 112], kF: [18, 46], fF: [28, 2] }, 'oc'),
        K(12, { p: [-4, 88], c: [-14, 128], h: [-10, 164], eF: [-6, 130], hF: [-20, 140], eB: [-24, 124], hB: [-34, 130], kF: [14, 46], fF: [24, 2] }, 'oc'),
        K(22, {})],
      hits: [], throwDmg: 108 };

    return m;
  }

  /* ---------- 必杀技原型 ---------- */
  var SP = {
    /* 飞行道具 */
    projectile: function (o) {
      return { id: o.id, name: o.name, kind: 'special', total: o.total || 36, motion: o.motion || 'qcf', btn: o.btn || 'P',
        whiff: 'fire', trailCol: o.col2,
        keys: [K(0, { eF: [-6, 116], hF: [-18, 108], eB: [-18, 112], hB: [-26, 104], p: [-4, 88], c: [-12, 130], h: [-6, 166] }),
          K(9, { eF: [-10, 114], hF: [-24, 104], eB: [-20, 110], hB: [-30, 100], p: [-6, 86], c: [-16, 128], h: [-10, 164], kF: [14, 44], fF: [22, 2] }, 'io'),
          K(14, { eF: [30, 124], hF: [66, 120], eB: [16, 120], hB: [52, 116], p: [4, 90], c: [6, 132], h: [12, 168], kF: [22, 46], fF: [32, 2] }, 'oc'),
          K(22, { eF: [26, 122], hF: [58, 118], eB: [14, 118], hB: [46, 114], p: [2, 90], c: [4, 132], h: [10, 168] }), K(o.total || 36, {})],
        hits: [], charge: { t: 6, at: 'hB', col: o.col, col2: o.col2 },
        spawn: { t: 14, at: 'hF', kind: 'projectile', r: o.r || 22, vx: o.speed || 8.4, dmg: o.dmg || 76,
          hitstun: 24, blockstun: 14, hitstop: 10, push: [4.5, 0], life: o.life || 150, col: o.col, col2: o.col2,
          style: o.style || 'fire', kd: o.kd ? 1 : 0, launch: o.launch || 0, chip: 4, spark: o.spark || 'fire', sfx: 'burn' },
        meterGain: 12, cancelSuper: 1 };
    },
    /* 升龙型（无敌上升） */
    dp: function (o) {
      var n = o.total || 44;
      return { id: o.id, name: o.name, kind: 'special', total: n, motion: 'dp', btn: o.btn || 'P', air: 1, autoLand: 1,
        whiff: 'whiffH', trailCol: o.col2,
        keys: [K(0, { p: [0, 62], c: [-6, 102], h: [0, 138], eF: [4, 86], hF: [12, 70], kF: [24, 36], fF: [28, 2], kB: [-22, 34], fB: [-28, 2], eB: [-16, 94], hB: [-6, 82] }),
          K(5, { p: [2, 98], c: [4, 140], h: [10, 178], eF: [20, 152], hF: [30, 196], kF: [16, 52], fF: [26, 8], kB: [-14, 50], fB: [-24, 6], eB: [-16, 122], hB: [-8, 108] }, 'oc'),
          K(14, { p: [2, 96], c: [6, 138], h: [14, 176], eF: [24, 150], hF: [38, 192], kF: [18, 50], fF: [30, 10], kB: [-12, 48], fB: [-22, 8], eB: [-14, 120], hB: [-4, 106] }),
          K(26, { p: [0, 92], c: [-2, 134], h: [4, 170], eF: [14, 130], hF: [24, 140], kF: [18, 54], fF: [28, 20], kB: [-14, 50], fB: [-26, 14] }, 'io'),
          K(n, {})],
        hits: [{ act: [5, 9], box: { from: 'eF', to: 'hF', r: 20, ext: 4 }, dmg: o.dmg || 92, level: 3, guard: 'mid',
          hitstun: 30, blockstun: 15, hitstop: 12, push: [3, 0], launch: 13, juggle: 1, spark: o.spark || 'fire',
          sfx: 'hitH', skip: 'armF', shake: 12, chip: 6 },
        { act: [10, 16], box: { from: 'eF', to: 'hF', r: 18, ext: 4 }, dmg: (o.dmg || 92) * .5, level: 2, guard: 'mid',
          hitstun: 22, blockstun: 12, hitstop: 8, push: [2, 0], launch: 9, juggle: 1, spark: o.spark || 'fire', sfx: 'hitM', skip: 'armF' }],
        vel: [{ t: 4, vx: o.vx === undefined ? 3.2 : o.vx, vy: o.vy || 15.5 }, { t: 5, vy: null }],
        invul: { win: [1, 8], type: 'all' }, aura: { win: [4, 16], at: 'hF', col: o.col, col2: o.col2 },
        meterGain: 14, cancelSuper: 1 };
    },
    /* 突进型 */
    rush: function (o) {
      var n = o.total || 38;
      return { id: o.id, name: o.name, kind: 'special', total: n, motion: o.motion || 'qcb', btn: o.btn || 'P',
        whiff: 'whiffH', trailCol: o.col2,
        keys: [K(0, { p: [-6, 88], c: [-16, 130], h: [-10, 166], eF: [-6, 118], hF: [-24, 112], eB: [-20, 116], hB: [-12, 102] }),
          K(6, { p: [0, 84], c: [0, 126], h: [8, 162], eF: [16, 120], hF: [30, 116], kF: [20, 44], fF: [34, 6], kB: [-16, 44], fB: [-30, 4] }, 'io'),
          K(10, { p: [4, 82], c: [10, 124], h: [18, 160], eF: [34, 126], hF: [78, 124], kF: [26, 42], fF: [44, 10], kB: [-14, 44], fB: [-32, 6], eB: [-18, 114], hB: [-10, 104] }, 'oc'),
          K(18, { p: [4, 84], c: [8, 126], h: [16, 162], eF: [32, 124], hF: [72, 122], kF: [24, 44], fF: [40, 4] }),
          K(26, { p: [0, 88], c: [-4, 130], h: [4, 166], eF: [14, 116], hF: [26, 112] }, 'io'), K(n, {})],
        hits: [{ act: [10, 18], box: { from: 'eF', to: 'hF', r: 19, ext: 4 }, dmg: o.dmg || 84, level: 3, guard: 'mid',
          hitstun: 28, blockstun: 16, hitstop: 12, push: [7, 0], launch: o.launch || 5, kd: 1, spark: o.spark || 'fire',
          sfx: 'hitH', skip: 'armF', shake: 12, chip: 6 }],
        vel: [{ t: 6, vx: o.speed || 10 }, { t: 20, vx: 0 }], slide: .86,
        aura: { win: [8, 18], at: 'hF', col: o.col, col2: o.col2 },
        meterGain: 14, cancelSuper: 1 };
    },
    /* 旋风腿（多段上升） */
    spin: function (o) {
      var n = o.total || 46;
      return { id: o.id, name: o.name, kind: 'special', total: n, motion: o.motion || 'qcb', btn: o.btn || 'K', air: 1, autoLand: 1,
        whiff: 'whiffH', trailCol: o.col2,
        keys: [K(0, { p: [0, 66], c: [-6, 106], h: [0, 142], kF: [24, 40], fF: [28, 4], kB: [-22, 38], fB: [-28, 2] }),
          K(6, { p: [0, 100], c: [0, 142], h: [4, 178], kF: [30, 96], fF: [60, 140], kB: [-18, 60], fB: [-34, 40], eF: [10, 130], hF: [18, 148], eB: [-20, 128], hB: [-14, 146] }, 'oc'),
          K(14, { p: [0, 104], c: [0, 146], h: [4, 182], kF: [34, 110], fF: [66, 160], kB: [-20, 66], fB: [-38, 46], eF: [8, 134], hF: [14, 154] }),
          K(22, { p: [0, 100], c: [0, 142], h: [4, 178], kF: [30, 96], fF: [60, 140], kB: [-18, 60], fB: [-34, 40] }),
          K(32, { p: [0, 92], c: [-3, 134], h: [4, 170], kF: [20, 56], fF: [30, 22], kB: [-14, 52], fB: [-27, 16] }, 'io'), K(n, {})],
        hits: [
          { act: [6, 9], box: { from: 'kF', to: 'fF', r: 18, ext: 6 }, dmg: (o.dmg || 34), level: 2, guard: 'mid',
            hitstun: 18, blockstun: 12, hitstop: 7, push: [1.6, 0], launch: 8, juggle: 1, spark: o.spark || 'light', sfx: 'hitM', skip: 'legF', chip: 3 },
          { act: [12, 15], box: { from: 'kF', to: 'fF', r: 18, ext: 6 }, dmg: (o.dmg || 34), level: 2, guard: 'mid',
            hitstun: 18, blockstun: 12, hitstop: 7, push: [1.6, 0], launch: 7, juggle: 1, spark: o.spark || 'light', sfx: 'hitM', skip: 'legF', chip: 3 },
          { act: [18, 22], box: { from: 'kF', to: 'fF', r: 18, ext: 6 }, dmg: (o.dmg || 34) * 1.4, level: 3, guard: 'mid',
            hitstun: 26, blockstun: 14, hitstop: 11, push: [5, 0], launch: 10, kd: 1, spark: o.spark || 'heavy', sfx: 'hitH', skip: 'legF', shake: 10, chip: 4 }],
        vel: [{ t: 5, vx: o.speed || 4.6, vy: o.vy || 13 }, { t: 6, vy: null }],
        invul: o.invul ? { win: [1, 6], type: 'air' } : null,
        meterGain: 14, cancelSuper: 1 };
    },
    /* 滑铲（下段突进） */
    slide: function (o) {
      var n = o.total || 40;
      return { id: o.id, name: o.name, kind: 'special', total: n, motion: o.motion || 'qcf', btn: o.btn || 'K',
        whiff: 'whiffH', trailCol: o.col2, crouch: 1,
        keys: [K(0, { p: [0, 66], c: [-8, 106], h: [-2, 142], kF: [24, 40], fF: [28, 4], kB: [-22, 38], fB: [-28, 2] }),
          K(6, { p: [-2, 30], c: [-24, 44], h: [-30, 62], kF: [30, 22], fF: [72, 14], kB: [-14, 26], fB: [-30, 12], eF: [-14, 34], hF: [0, 22], eB: [-32, 34], hB: [-44, 24] }, 'oc'),
          K(18, { p: [-2, 28], c: [-26, 42], h: [-34, 58], kF: [30, 20], fF: [76, 12], kB: [-14, 24], fB: [-30, 10], eF: [-14, 32], hF: [2, 20], eB: [-34, 32], hB: [-46, 22] }),
          K(30, { p: [0, 56], c: [-10, 96], h: [-4, 132], kF: [26, 32], fF: [30, 2], kB: [-22, 30], fB: [-28, 2] }, 'io'), K(n, {})],
        hits: [{ act: [6, 18], box: { from: 'kF', to: 'fF', r: 16, ext: 6 }, dmg: o.dmg || 72, level: 3, guard: 'low',
          hitstun: 26, blockstun: 15, hitstop: 11, push: [5.5, 0], kd: 1, spark: o.spark || 'light', sfx: 'hitH', skip: 'legF', shake: 9, chip: 5 }],
        vel: [{ t: 5, vx: o.speed || 11.5 }, { t: 20, vx: 0 }], slide: .9,
        meterGain: 13, cancelSuper: 1 };
    },
    /* 命令投 */
    cmdThrow: function (o) {
      var n = o.total || 44;
      return { id: o.id, name: o.name, kind: 'special', total: n, motion: o.motion || 'hcb', btn: o.btn || 'P',
        whiff: 'whiffH', trailCol: o.col2, isCmdThrow: 1, range: o.range || 92,
        keys: [K(0, { p: [-4, 88], c: [-12, 130], h: [-6, 166], eF: [-4, 120], hF: [-18, 124], eB: [-20, 118], hB: [-14, 106] }),
          K(4, { p: [4, 88], c: [8, 130], h: [16, 166], eF: [24, 128], hF: [56, 136], eB: [12, 124], hB: [44, 130], kF: [22, 46], fF: [34, 2] }, 'oc'),
          K(12, { p: [2, 92], c: [4, 134], h: [12, 170], eF: [20, 136], hF: [46, 152], eB: [10, 130], hB: [38, 146] }),
          K(24, { p: [-6, 86], c: [-18, 126], h: [-14, 162], eF: [-10, 128], hF: [-28, 136], eB: [-26, 122], hB: [-40, 128] }, 'oc'), K(n, {})],
        hits: [], grab: { act: [4, 8], dmg: o.dmg || 150, r: o.range || 92 },
        meterGain: 16 };
    },
    /* 超必杀：乱舞 */
    super: function (o) {
      var n = 104, hits = [], t = 14, i;
      var seq = [
        { j: ['eF', 'hF'], r: 19 }, { j: ['eB', 'hB'], r: 19 }, { j: ['eF', 'hF'], r: 19 },
        { j: ['kF', 'fF'], r: 18 }, { j: ['eB', 'hB'], r: 19 }, { j: ['kF', 'fF'], r: 18 }
      ];
      for (i = 0; i < seq.length; i++) {
        hits.push({ act: [t, t + 2], box: { from: seq[i].j[0], to: seq[i].j[1], r: seq[i].r, ext: 7 },
          dmg: (o.hitDmg || 46), level: 2, guard: 'mid', hitstun: 16, blockstun: 10, hitstop: 6,
          push: [1.2, 0], stick: 1, spark: 'light', sfx: 'hitM', shake: 5, chip: 3, noScale: 1 });
        t += 6;
      }
      hits.push({ act: [t + 8, t + 13], box: { from: 'eF', to: 'hF', r: 24, ext: 6 }, dmg: o.finDmg || 170, level: 4,
        guard: 'mid', hitstun: 40, blockstun: 20, hitstop: 24, push: [11, 0], launch: 13, kd: 1, wallSlam: 1,
        spark: 'super', sfx: 'explode', shake: 22, chip: 8, noScale: 1, finisher: 1 });
      var K2 = [];
      K2.push(K(0, { p: [-4, 86], c: [-14, 128], h: [-8, 164], eF: [-6, 116], hF: [-22, 110], eB: [-22, 114], hB: [-16, 100] }));
      K2.push(K(10, { p: [2, 88], c: [4, 130], h: [12, 167], eF: [14, 120], hF: [24, 118], eB: [-16, 118], hB: [-6, 112] }, 'oc'));
      var tt = 14;
      for (i = 0; i < seq.length; i++) {
        var front = seq[i].j[0] === 'eF', leg = seq[i].j[0] === 'kF';
        if (leg) K2.push(K(tt, { p: [0, 88], c: [-2, 130], h: [6, 166], kF: [36, 74], fF: [82, 96], kB: [-16, 46], fB: [-28, 3], eF: [10, 118], hF: [18, 112], eB: [-18, 118], hB: [-8, 112] }, 'oc'));
        else if (front) K2.push(K(tt, { p: [2, 88], c: [6, 130], h: [14, 167], eF: [38, 128], hF: [80, 126], eB: [-16, 116], hB: [-4, 108] }, 'oc'));
        else K2.push(K(tt, { p: [2, 88], c: [6, 130], h: [14, 167], eB: [34, 126], hB: [76, 122], eF: [10, 118], hF: [20, 110] }, 'oc'));
        K2.push(K(tt + 3, { p: [0, 88], c: [0, 130], h: [8, 166], eF: [12, 118], hF: [22, 112], eB: [-16, 118], hB: [-6, 110], kF: [18, 46], fF: [28, 2] }, 'io'));
        tt += 6;
      }
      K2.push(K(tt + 4, { p: [-6, 84], c: [-18, 124], h: [-12, 160], eF: [-10, 112], hF: [-30, 118], eB: [-26, 112], hB: [-22, 100], kF: [14, 44], fF: [22, 2] }, 'io'));
      K2.push(K(tt + 8, { p: [4, 96], c: [8, 138], h: [16, 176], eF: [30, 152], hF: [56, 196], kF: [22, 50], fF: [34, 6], eB: [-14, 120], hB: [-2, 110] }, 'oc'));
      K2.push(K(tt + 16, { p: [2, 94], c: [4, 136], h: [12, 174], eF: [28, 150], hF: [52, 192] }));
      K2.push(K(n, {}));
      return { id: 'super', name: o.name || '超必杀', kind: 'super', total: n, motion: o.motion || 'dqcf', btn: o.btn || 'P',
        whiff: 'whiffH', trailCol: o.col2, superflash: { t: 2, dur: 34, col: o.col, col2: o.col2 },
        keys: K2, hits: hits, vel: [{ t: 10, vx: o.speed || 7.5 }, { t: 22, vx: 2.2 }, { t: tt + 2, vx: 0 }],
        invul: { win: [1, 12], type: 'all' }, aura: { win: [1, n], at: 'c', col: o.col, col2: o.col2, big: 1 },
        meterCost: 1, meterGain: 0 };
    }
  };

  /* 帧数据统计（调试面板用） */
  function frameData(mv) {
    if (!mv.hits || !mv.hits.length) return { startup: '-', active: '-', recovery: mv.total };
    var s = 1e9, e = -1;
    for (var i = 0; i < mv.hits.length; i++) { s = Math.min(s, mv.hits[i].act[0]); e = Math.max(e, mv.hits[i].act[1]); }
    return { startup: s + 1, active: e - s + 1, recovery: mv.total - e - 1, total: mv.total };
  }

  G.Moves = { baseMoves: baseMoves, SP: SP, frameData: frameData, K: K };
})(window.G);
