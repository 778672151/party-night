/* chars.js — 角色数据：配色/数值/必杀技组合 */
(function (G) {
  'use strict';
  var SP = G.Moves.SP;

  var LIST = [
    {
      id: 'kai', name: '凯', title: '烈焰拳士', hairStyle: 'spike',
      pal: { skin: '#f3c39a', hair: '#2b2b3c', top: '#e9edf4', pants: '#2f3550', glove: '#c9302c', boot: '#1f2436', belt: '#181c2c', hairStyle: 'spike' },
      auraCol: '#ff8a1e', auraCol2: '#ffe08a',
      atk: 1, def: 1, walk: 3.5, back: 2.9, jump: 16.2, weight: 1, dashSpd: 8.6,
      voice: 'voiceH', cry: '燃烧吧！',
      specials: [
        SP.rush({ id: 'sp1', name: '暗拂・突进拳', motion: 'qcf', btn: 'P', dmg: 86, speed: 10.4, col: '#ff8a1e', col2: '#ffe08a', spark: 'fire' }),
        SP.dp({ id: 'sp2', name: '荒咬・升焰', motion: 'dp', btn: 'P', dmg: 94, col: '#ff8a1e', col2: '#fff0b0', spark: 'fire', vy: 16 }),
        SP.spin({ id: 'sp3', name: '九十九式', motion: 'qcb', btn: 'K', dmg: 36, col: '#ff8a1e', col2: '#ffd478', spark: 'fire', invul: 1 })
      ],
      superSpec: { name: '无式・炎之乱舞', col: '#ff6a10', col2: '#fff3b0', hitDmg: 48, finDmg: 180 }
    },
    {
      id: 'rex', name: '雷克斯', title: '狼牙拳王', hairStyle: 'cap',
      pal: { skin: '#e8b184', hair: '#f0c44a', top: '#c8342c', pants: '#2b3d6b', glove: '#f0e6d2', boot: '#3a2a1e', belt: '#241a12', hairStyle: 'cap' },
      auraCol: '#3aa0ff', auraCol2: '#d6f0ff',
      atk: 1.06, def: 1.02, walk: 3.2, back: 2.6, jump: 15.6, weight: 1.08, dashSpd: 8.0,
      voice: 'voiceH', cry: '力量波动！',
      specials: [
        SP.projectile({ id: 'sp1', name: '能量波动', motion: 'qcf', btn: 'P', dmg: 80, speed: 8.6, r: 24, col: '#2f8fff', col2: '#d8f2ff', style: 'wave' }),
        SP.dp({ id: 'sp2', name: '升龙铁拳', motion: 'dp', btn: 'P', dmg: 98, col: '#2f8fff', col2: '#e6f6ff', spark: 'elec', vy: 15.6 }),
        SP.rush({ id: 'sp3', name: '燃烧铁拳', motion: 'qcb', btn: 'P', dmg: 90, speed: 9.4, col: '#ff7a2a', col2: '#ffe4a0', spark: 'fire' })
      ],
      superSpec: { name: '猛虎硬派・波动拳', col: '#2f8fff', col2: '#eaffff', hitDmg: 46, finDmg: 190 }
    },
    {
      id: 'lin', name: '琳', title: '疾影舞姬', hairStyle: 'pony',
      pal: { skin: '#f6cfae', hair: '#7d2b3c', top: '#e0455f', pants: '#f0d8dd', glove: '#f6cfae', boot: '#b02a44', belt: '#8a1f34', hairStyle: 'pony' },
      auraCol: '#ff4d7e', auraCol2: '#ffd6e2',
      atk: .93, def: .94, walk: 4.2, back: 3.6, jump: 17.0, weight: .88, dashSpd: 10.2,
      voice: 'voiceL', cry: '花蝶扇舞！',
      specials: [
        SP.projectile({ id: 'sp1', name: '花蝶扇', motion: 'qcf', btn: 'P', dmg: 68, speed: 10.4, r: 20, life: 120, col: '#ff4d7e', col2: '#fff0f5', style: 'fan' }),
        SP.spin({ id: 'sp2', name: '龙炎舞', motion: 'dp', btn: 'K', dmg: 34, col: '#ff4d7e', col2: '#ffd0dd', spark: 'light', invul: 1, vy: 14.4, speed: 3.2 }),
        SP.slide({ id: 'sp3', name: '飞鼠疾走', motion: 'qcf', btn: 'K', dmg: 70, speed: 12.4, col: '#ff4d7e', col2: '#ffe2ea' })
      ],
      superSpec: { name: '超必杀・忍蜂乱舞', col: '#ff3d72', col2: '#fff2f6', hitDmg: 42, finDmg: 168, speed: 8.6 }
    },
    {
      id: 'gan', name: '刚', title: '铁山巨拳', hairStyle: 'cap',
      pal: { skin: '#d8a273', hair: '#20242e', top: '#3d4a63', pants: '#5a3f2c', glove: '#8c6a3f', boot: '#2c2118', belt: '#1a1410', hairStyle: 'cap' },
      auraCol: '#9a6bff', auraCol2: '#e2d4ff',
      atk: 1.16, def: 1.12, walk: 2.7, back: 2.2, jump: 14.6, weight: 1.3, dashSpd: 7.2,
      voice: 'voiceH', cry: '碎裂吧！',
      specials: [
        SP.cmdThrow({ id: 'sp1', name: '地狱落', motion: 'hcb', btn: 'P', dmg: 168, range: 96, col: '#9a6bff', col2: '#e6dcff' }),
        SP.rush({ id: 'sp2', name: '铁山冲', motion: 'qcf', btn: 'P', dmg: 96, speed: 9.2, col: '#9a6bff', col2: '#efe6ff', spark: 'heavy' }),
        SP.dp({ id: 'sp3', name: '巨岩升踢', motion: 'dp', btn: 'K', dmg: 100, col: '#9a6bff', col2: '#f0e8ff', spark: 'heavy', vy: 14.2, vx: 2.4 })
      ],
      superSpec: { name: '究极・铁山乱舞', col: '#8a52ff', col2: '#f2ecff', hitDmg: 52, finDmg: 200, speed: 6.4 }
    }
  ];

  /* 为角色构造完整招式表 */
  function buildMoves(ch) {
    var m = G.Moves.baseMoves(), i, k;
    for (k in m) if (m[k].hits) for (i = 0; i < m[k].hits.length; i++) m[k].hits[i].dmg *= ch.atk;
    for (i = 0; i < ch.specials.length; i++) {
      var s = JSON.parse(JSON.stringify(ch.specials[i]));
      s.keys = ch.specials[i].keys; s.hits = ch.specials[i].hits.map(function (h) { var c = {}; for (var q in h) c[q] = h[q]; c.dmg *= ch.atk; return c; });
      m[s.id] = s;
    }
    var sup = G.Moves.SP.super(ch.superSpec);
    for (i = 0; i < sup.hits.length; i++) sup.hits[i].dmg *= ch.atk;
    m['super'] = sup;
    return m;
  }
  function byId(id) { for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i]; return LIST[0]; }

  G.Chars = { LIST: LIST, buildMoves: buildMoves, byId: byId };
})(window.G);
