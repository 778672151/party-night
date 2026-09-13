/**
 * 顶牛 - 河北骨牌游戏核心引擎
 * 24张牌，4人，顺时针出牌，对眼儿规则
 * 牌型来源：https://baike.baidu.com/item/%E9%A1%B6%E7%89%9B/1961687
 */

// ============ 牌型定义 ============
// 正确的24张顶牛骨牌（13种牌型）
// 横牌：两端点数相同（6种，各2张=12张）
// 竖牌：两端点数不同（7种，其中6种各2张=12张，2种各1张=2张）

const TILE_TYPES = {
  // --- 横牌（两端相同，6种x2张=12张）---
  DATIAN:  { name: '大天', type: 'horizontal', ends: [6, 6], points: 12, count: 2, img: 'datian.jpg' },
  DASHI:   { name: '大十', type: 'horizontal', ends: [5, 5], points: 10, count: 2, img: 'dashi.jpg' },
  HONGBA:  { name: '红八', type: 'horizontal', ends: [4, 4], points: 8, count: 2, img: 'hongba.jpg' },
  CHANGAN: { name: '长三', type: 'horizontal', ends: [3, 3], points: 6, count: 2, img: 'changsan.jpg' },
  ERBAN:   { name: '二板', type: 'horizontal', ends: [2, 2], points: 4, count: 2, img: 'erban.jpg' },
  DIYAO:   { name: '地幺', type: 'horizontal', ends: [1, 1], points: 2, count: 2, img: 'diyao.jpg' },

  // --- 竖牌（两端不同，6种x2张=12张）---
  HUTOU:   { name: '虎头', type: 'vertical', ends: [5, 6], points: 11, count: 2, img: 'hutou.jpg' },
  HONGSHI: { name: '红十', type: 'vertical', ends: [4, 6], points: 10, count: 2, img: 'hongshi.jpg' },
  YILIU:   { name: '一六', type: 'vertical', ends: [1, 6], points: 7, count: 2, img: 'yiliu.jpg' },
  YIWU:    { name: '一五', type: 'vertical', ends: [1, 5], points: 6, count: 2, img: 'yiwu.jpg' },
  YISAN:   { name: '一三', type: 'vertical', ends: [1, 3], points: 4, count: 2, img: 'yisan.jpg' },

  // --- 竖牌（各1张=2张）---
  SANLIU:  { name: '三六', type: 'vertical', ends: [3, 6], points: 9, count: 1, img: 'sanliu.jpg' },
  ERLIU:   { name: '二六', type: 'vertical', ends: [2, 6], points: 8, count: 1, img: 'erliu.jpg' },
};

// 创建完整的24张牌列表
function createAllTiles() {
  const tiles = [];
  for (const [key, def] of Object.entries(TILE_TYPES)) {
    for (let i = 0; i < def.count; i++) {
      tiles.push({
        id: `${key}_${i}`,
        key,
        name: def.name,
        type: def.type,
        ends: [...def.ends],
        points: def.points,
        img: def.img,
        chosenEnd: null,
        otherEnd: null,
      });
    }
  }
  return tiles;
}

// ============ 游戏状态 ============
const PHASE = {
  WAITING: 'waiting',
  DEALING: 'dealing',
  PLAYING: 'playing',
  SETTLING: 'settling',
};

const PLAYER_ROLE = {
  HUMAN: 'human',
  AI_EASY: 'ai_easy',
  AI_MEDIUM: 'ai_medium',
  AI_HARD: 'ai_hard',
};

// ============ 游戏引擎类 ============
class DingNiuGame {
  constructor() {
    this.reset();
  }

  reset() {
    this.phase = PHASE.WAITING;
    this.dealerIndex = 0;
    this.currentPlayer = 0;
    this.round = 0;
    this.turnInRound = 0;
    this.passesInRow = 0;

    // 桌面状态
    this.chain = [];
    this.chainEnds = { left: null, right: null };

    // 4位玩家
    this.players = [
      { id: 0, name: '你', role: PLAYER_ROLE.HUMAN, hand: [], passed: false, isOut: false, outByPass: false, suanZhangOut: false, passedTiles: [] },
      { id: 1, name: '对手A', role: PLAYER_ROLE.AI_EASY, hand: [], passed: false, isOut: false, outByPass: false, suanZhangOut: false, passedTiles: [] },
      { id: 2, name: '对手B', role: PLAYER_ROLE.AI_MEDIUM, hand: [], passed: false, isOut: false, outByPass: false, suanZhangOut: false, passedTiles: [] },
      { id: 3, name: '对手C', role: PLAYER_ROLE.AI_EASY, hand: [], passed: false, isOut: false, outByPass: false, suanZhangOut: false, passedTiles: [] },
    ];

    // 结算
    this.scores = [0, 0, 0, 0];
    this.roundScores = [0, 0, 0, 0];
    this.lastRoundLog = [];
    this.log = [];

    // 算账（封局判定）
    this.suanZhangActive = false;
    this.suanZhangType = null;
    this.suanZhangStarter = null;
    this.suanZhangSuccess = null;
    this.suanZhangDeadPoints = [];

    // 砸红帐辅助：记录每次出牌前的可选牌数（用于判断死砸）
    this.lastPlayChoiceCount = 0;  // 出牌前有多少张可出的牌（不含刚出的这张）
    this.firstCleanOutPlayer = -1; // 第一个真正净手的玩家（对眼儿规则赢家）

    // 算账辅助：追踪已打出的牌（用于判断砸红帐等）
    this.playedTileKeys = [];  // 已打出的牌的 key 列表（可重复，因为同种牌可能有2张）

    // 跑红检测（出牌时判定，设flag到结算时按算账计分）
    this.paoHongActive = false;
    this.paoHongStarter = null;
    this.paoHongSuccess = null;

    // 规则配置（baseScore 用于倍数计分，enableSuanZhang/enablePaoHong 控制开关）
    // scoringMode: 'fixed' = 经典固定分（普通+6/输家1/2/3，净手+9/输家2/3/4，算账/跑红+12/输家3/4/5，包庄±12）
    //              'multiplier' = 底分+翻倍（普通×1、单人净手×2、算账/跑红×3；底分=10 时系数1）
    this.rules = {
      baseScore: 10,
      enablePaoHong: true,
      enableSuanZhang: true,
      scoringMode: 'fixed',
      enableMenWuZhang: false, // 闷五帐：部分地区玩法，默认关闭
    };

    // 首圈规则追踪
    this.leaderIndex = -1;             // 先手（第一个出牌的人）
    this.guHongPlayerIndex = -1;       // 孤红玩家（先手出红八且手牌无其他红牌）
    this.shuangHongBaDeclared = false; // 双红八声明
    this.weiSiHongLanZhangPlayer = -1; // 未死红拦帐责任人
    this.playHistory = [];             // 出牌历史（用于首圈规则判定）
  }

  // 重置"单局"状态（保留累计积分、庄家、上局赢家、玩家身份）
  // 重洗 / 开新一局时调用，避免把累积分数和色子定的庄家一起清掉
  resetRoundState() {
    this.phase = PHASE.WAITING;
    this.currentPlayer = 0;
    this.round = 0;
    this.turnInRound = 0;
    this.passesInRow = 0;

    this.chain = [];
    this.chainEnds = { left: null, right: null };

    for (const p of this.players) {
      p.hand = [];
      p.passed = false;
      p.isOut = false;
      p.outByPass = false;
      p.suanZhangOut = false;
      p.passedTiles = [];
    }

    this.roundScores = [0, 0, 0, 0];
    this.lastRoundLog = [];
    this.log = [];

    this.suanZhangActive = false;
    this.suanZhangType = null;
    this.suanZhangStarter = null;
    this.suanZhangSuccess = null;
    this.suanZhangDeadPoints = [];

    this.lastPlayChoiceCount = 0;
    this.firstCleanOutPlayer = -1;
    this.playedTileKeys = [];

    this.paoHongActive = false;
    this.paoHongStarter = null;
    this.paoHongSuccess = null;

    this.leaderIndex = -1;
    this.guHongPlayerIndex = -1;
    this.shuangHongBaDeclared = false;
    this.weiSiHongLanZhangPlayer = -1;
    this.playHistory = [];
    // 注意：this.scores / this.dealerIndex / this.lastWinner / players[].name,role 均保留
  }

  loadRules(savedRules) {
    if (savedRules) Object.assign(this.rules, savedRules);
  }

  shuffle(array) {
    const a = [...array];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  dealCards(attempt = 0) {
    let tiles = createAllTiles();
    tiles = this.shuffle(tiles);

    // 每人6张，轮流抓牌
    for (let i = 0; i < 6; i++) {
      for (let p = 0; p < 4; p++) {
        const playerIndex = (this.dealerIndex - p + 4) % 4;
        this.players[playerIndex].hand.push(tiles[i * 4 + p]);
      }
    }

    // 排序手牌
    for (const player of this.players) {
      player.hand.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'horizontal' ? -1 : 1;
        return a.points - b.points;
      });
    }

    this.log.push('发牌完成，每人6张。');
    this.phase = PHASE.PLAYING;
    this.firstCleanOutPlayer = -1;
    this.currentPlayer = this.dealerIndex;
    this.passesInRow = 0;

    // 检测重洗条件（重洗时保留累计积分/庄家/上局赢家，仅重发本局手牌）
    if (attempt < 5 && this.checkReshuffle()) {
      this.log.push('有玩家手牌满足重洗条件，重新洗牌。');
      this.resetRoundState();
      this.dealCards(attempt + 1);
    }
  }

  checkReshuffle() {
    // 按用户要求：不重洗（清三对/六扇横也照常打），始终返回 false
    return false;
    // eslint-disable-next-line
    for (const player of this.players) {
      const hand = player.hand;
      if (!hand || hand.length === 0) continue;
      // 清三对：三个对牌
      const pairs = {};
      for (const t of hand) {
        if (!t || !t.key) continue;
        pairs[t.key] = (pairs[t.key] || 0) + 1;
      }
      const pairCount = Object.values(pairs).filter(c => c >= 2).length;
      if (pairCount >= 3) return true;
      // 六扇横：六张全是横牌
      if (hand.every(t => t.type === 'horizontal')) return true;
    }
    return false;
  }

  pointMatches(a, b) {
    return a === b;
  }

  // 硬牌检测：先手出牌时，检查该牌的每个端点数字，其他三家是否都有竖牌可以接
  // 竖牌 = 两端不同的牌（能改变链端），横牌/不变牌 = 两端相同的牌（不改变链端）
  // 如果所有端点数字的竖牌都被先手垄断 → 硬牌违规（"拉三家"）
  // 注意：对子只需要检查一个数字；竖牌需要检查两个数字，只要有一个数字不被垄断就不算硬牌
  isYingPaiViolation(playerIndex, tile) {
    // 红八(4-4) 豁免硬牌(拉三家)：红八先手受"孤红/双红八"特殊规则管辖，
    // 不应被硬牌拦截（否则孤红/双红八判定永远无法触发）。
    if (tile.key === 'HONGBA') return false;

    const nums = [...new Set(tile.ends)]; // 对子只有一个数字，竖牌有两个

    for (const num of nums) {
      // 检查其他三家手牌中是否有包含该数字的竖牌
      let otherHasVertical = false;
      for (let i = 0; i < 4; i++) {
        if (i === playerIndex) continue;
        for (const t of this.players[i].hand) {
          if (TILE_TYPES[t.key].type === 'vertical' && TILE_TYPES[t.key].ends.includes(num)) {
            otherHasVertical = true;
            break;
          }
        }
        if (otherHasVertical) break;
      }
      if (otherHasVertical) {
        // 至少有一个端点数字的竖牌在其他玩家手中 → 不算硬牌
        return false;
      }
    }

    // 所有端点数字的竖牌都被先手垄断 → 硬牌违规
    return true;
  }

  // 首圈是否"能先手"（链为空时）：只要有一张非拉三家硬牌的牌即可先出
  // 用于首手全是硬牌时跳过该玩家，让下家先出，避免无人能领头的死锁
  canLead(playerIndex) {
    const player = this.players[playerIndex];
    if (player.isOut || player.hand.length === 0) return false;
    for (const tile of player.hand) {
      if (!this.isYingPaiViolation(playerIndex, tile)) return true;
    }
    return false;
  }

  // 检测未死红拦帐：首圈红帐触发时，检查是否有人有六牌却不出
  // 条件：首圈（playHistory <= 4），红帐触发，前一玩家有能改变六端的竖牌（非大天）但没出
  // 大天(6,6)接到六端不变六，不算拦帐牌
  checkWeiSiHongLanZhang() {
    if (this.playHistory.length < 2) return;
    if (this.playHistory.length > 4) return; // 超过首圈不适用

    const triggerEntry = this.playHistory[this.playHistory.length - 1];
    const prevEntry = this.playHistory[this.playHistory.length - 2];

    // 触发前桌面必须有六端（红十(4,6)接六端变四端，所以触发前有六端）
    const preEnds = triggerEntry.chainEndsBefore;
    if (preEnds.left !== 6 && preEnds.right !== 6) return;

    // 前一玩家回合时桌面也要有六端（否则他当时没有机会拦）
    const prevEnds = prevEntry.chainEndsBefore;
    if (prevEnds.left !== 6 && prevEnds.right !== 6) return;

    // 前一玩家必须有能改变六端的牌：含6且非大天(6,6)的竖牌
    // 这些牌接到六端后会变成另一个数字，从而阻止红帐触发
    const blockingTileKeys = ['HUTOU', 'HONGSHI', 'YILIU', 'SANLIU', 'ERLIU'];
    const hadBlockingTile = prevEntry.handKeysBefore.some(k => blockingTileKeys.includes(k));
    if (!hadBlockingTile) return;

    // 前一玩家必须有选择（死上规则：只有1张可出的牌不算故意不拦）
    if (prevEntry.playableCountBefore <= 1) return;

    // 所有条件满足 → 未死红拦帐
    this.weiSiHongLanZhangPlayer = prevEntry.playerIndex;
    this.log.push(this.players[prevEntry.playerIndex].name + ' 未拦红帐！有六牌不出，放任红帐触发！');
  }

  getPlayableEnds(tile, chainEnds) {
    const results = [];
    const left = chainEnds.left;
    const right = chainEnds.right;

    if (left === null && right === null) {
      return [{ end: tile.ends[0], side: 'left' }];
    }

    const seen = new Set();
    for (const ep of tile.ends) {
      if (left !== null && this.pointMatches(ep, left)) {
        const key = 'left_' + ep;
        if (!seen.has(key)) { seen.add(key); results.push({ end: ep, side: 'left' }); }
      }
      if (right !== null && this.pointMatches(ep, right)) {
        const key = 'right_' + ep;
        if (!seen.has(key)) { seen.add(key); results.push({ end: ep, side: 'right' }); }
      }
    }
    return results;
  }

  suggestEnd(tile, chainEnds) {
    const playable = this.getPlayableEnds(tile, chainEnds);
    if (playable.length === 0) return null;
    if (playable.length === 1) return playable[0];
    return playable[0];
  }

  getPlayableTiles(playerIndex) {
    const player = this.players[playerIndex];
    if (player.isOut) return [];

    const left = this.chainEnds.left;
    const right = this.chainEnds.right;

    if (left === null && right === null) {
      return player.hand.map(tile => ({
        tile,
        playableEnds: tile.ends.map(e => ({ end: e, side: 'left' })),
      }));
    }

    return player.hand
      .map(tile => {
        const ends = this.getPlayableEnds(tile, this.chainEnds);
        return ends.length > 0 ? { tile, playableEnds: ends } : null;
      })
      .filter(x => x !== null);
  }

  // ============ 出牌 ============
  playTile(playerIndex, tileId, chosenEnd, side) {
    const player = this.players[playerIndex];
    const tileIndex = player.hand.findIndex(t => t.id === tileId);
    if (tileIndex === -1) return { success: false, msg: '手牌中没有这张牌' };

    const tile = player.hand[tileIndex];
    const playable = this.getPlayableEnds(tile, this.chainEnds);

    // 保存出牌前的桌面端点（用于跑红检测）
    this.prePlayChainEnds = { left: this.chainEnds.left, right: this.chainEnds.right };

    if (playable.length === 0 && !(this.chainEnds.left === null)) {
      return { success: false, msg: '这张牌无法接上桌面' };
    }

    // 防御：显式指定的 side/end 必须是这张牌合法的接法，防止外部传入非法方向破坏牌链
    if (this.chain.length > 0 && side !== undefined) {
      const validSide = playable.some(p => p.side === side && (chosenEnd === undefined || p.end === chosenEnd));
      if (!validSide) {
        return { success: false, msg: '这张牌不能接在这一端' };
      }
    }

    // 硬牌规则：先手（chain为空时）不能出"拉三家"的牌
    // 拉三家 = 该牌所有端点数字的竖牌都被先手垄断，其他三家无法改变链端
    if (this.chain.length === 0 && this.isYingPaiViolation(playerIndex, tile)) {
      return { success: false, msg: '硬牌！其他三家没有能接的竖牌，不能先出这张牌' };
    }

    // 【算账用】出牌前记录：除了这次出牌之外还有多少个可出的方向
    // 用于判断是"有选择却打出算账"还是"死上（没得选）"
    // 注意：同一张牌如果能接左右两端，也算两个选择（比如一五接1端或5端）
    const allPlayableBefore = this.getPlayableTiles(playerIndex);
    const totalMovesBefore = allPlayableBefore.reduce((sum, p) => sum + p.playableEnds.length, 0);
    this.lastPlayChoiceCount = Math.max(0, totalMovesBefore - 1);

    // 追踪出牌历史（用于首圈规则判定：孤红、双红八、未死红拦帐）
    // 保存 splice 前的手牌快照
    this.playHistory.push({
      playerIndex,
      chainEndsBefore: { left: this.chainEnds.left, right: this.chainEnds.right },
      handKeysBefore: [...player.hand.map(t => t.key)],
      playableCountBefore: allPlayableBefore.length,
    });

    // 移除手牌
    player.hand.splice(tileIndex, 1);

    // 确定接哪一端
    let useSide = side;
    let useEnd = chosenEnd;
    if (useSide === undefined) {
      if (playable.length > 0) {
        useSide = playable[0].side;
        useEnd = playable[0].end;
      }
    }

    // 记录本次出牌信息（用于跑红检测）
    this.lastPlayedSide = useSide;
    this.lastPlayedTileKey = tile.key;

    // 添加到牌链
    if (this.chain.length === 0) {
      this.chain.push({ tile, playedBy: playerIndex, leftEnd: tile.ends[0], rightEnd: tile.ends[1] || tile.ends[0] });
      this.chainEnds.left = tile.ends[0];
      this.chainEnds.right = tile.ends[1] || tile.ends[0];
    } else {
      if (useSide === 'left') {
        const otherEnd = tile.ends.find(e => !this.pointMatches(e, this.chainEnds.left)) || tile.ends[0];
        this.chain.unshift({ tile, playedBy: playerIndex, leftEnd: otherEnd, rightEnd: this.chainEnds.left });
        this.chainEnds.left = otherEnd;
      } else {
        const otherEnd = tile.ends.find(e => !this.pointMatches(e, this.chainEnds.right)) || tile.ends[0];
        this.chain.push({ tile, playedBy: playerIndex, leftEnd: this.chainEnds.right, rightEnd: otherEnd });
        this.chainEnds.right = otherEnd;
      }
    }

    // 追踪已打出的牌（用于算账判定）
    this.playedTileKeys.push(tile.key);

    // 首圈规则：先手出牌后检测孤红和双红八
    if (this.chain.length === 1) {
      this.leaderIndex = playerIndex;
      if (tile.key === 'HONGBA') {
        // 检查剩余手牌中是否还有其他红牌（红十或红八）
        const hasOtherRed = player.hand.some(t => t.key === 'HONGSHI' || t.key === 'HONGBA');
        const hasAnotherHongBa = player.hand.some(t => t.key === 'HONGBA');
        if (!hasOtherRed && allPlayableBefore.length > 1) {
          // 孤红：先手出红八，手牌无其他红牌，且有选择（非死上）
          // 死上（只有1张可出牌）不承担孤红责任
          this.guHongPlayerIndex = playerIndex;
          this.log.push(player.name + ' 出红八先手，手牌无其他红牌！孤红！');
        }
        if (hasAnotherHongBa) {
          // 双红八声明：先手出红八，手中还有一张红八
          this.shuangHongBaDeclared = true;
          this.log.push(player.name + ' 声明双红八！先手出红八但手中还有一张！');
        }
      }
    }

    player.passed = false;
    this.passesInRow = 0;

    for (const p of this.players) {
      if (p.id !== playerIndex) {
        p.passed = false;
      }
    }

    this.log.push(`${player.name} 出了 ${tile.name}`);

    if (player.hand.length === 0) {
      player.isOut = true;
      if (this.firstCleanOutPlayer < 0 && !player.outByPass && player.passedTiles.length === 0) {
        this.firstCleanOutPlayer = playerIndex; // 记录第一个真正净手的玩家（无扣牌、无手牌）
      }
      this.log.push(`${player.name} 净手！`);
      return { success: true, isOut: true };
    }

    return { success: true, isOut: false };
  }

  // ============ 扣牌 ============
  passTurn(playerIndex, tileId) {
    const player = this.players[playerIndex];

    // 检查是否还有可出的牌（不能扣活牌）
    const playable = this.getPlayableTiles(playerIndex);
    if (playable.length > 0) {
      return { success: false, msg: '还有可出的牌，不能扣牌' };
    }

    // 找到要扣的牌
    const tileIndex = player.hand.findIndex(t => t.id === tileId);
    if (tileIndex === -1) {
      return { success: false, msg: '手牌中没有这张牌' };
    }

    const tile = player.hand[tileIndex];

    // 从手牌中移除，放入扣牌区
    player.hand.splice(tileIndex, 1);
    player.passedTiles.push(tile);

    player.passed = true;
    this.passesInRow++;

    // 扣完所有手牌后，标记为出局（手牌为空，不能再出牌也不能再扣牌）
    if (player.hand.length === 0) {
      player.isOut = true;
      player.outByPass = true;
      this.log.push(`${player.name} 手牌全部扣完！`);
    }

    this.log.push(`${player.name} 扣了 ${tile.name}（${tile.points}点）`);

    return { success: true };
  }

  // ============ 检查本局是否应该结束 ============
  checkRoundShouldEnd() {
    const activePlayers = this.players.filter(p => !p.isOut);
    // 所有人都净手了
    if (activePlayers.length === 0) return true;
    // 所有活跃玩家手牌为空（全部出完或扣完）
    const allEmpty = activePlayers.every(p => p.hand.length === 0);
    if (allEmpty) return true;
    // 所有活跃玩家都扣牌了（无人可出）
    const allPassed = activePlayers.every(p => p.passed);
    if (allPassed) return true;
    // 连续4次扣牌（所有人依次扣过一轮）
    if (this.passesInRow >= 4) return true;
    return false;
  }

  // ============ 算账（封局）判定 ============
  // 算账触发时机：出牌后即时判定，谁出了"算账牌"谁就是发起者
  //
  // 红帐：第二张红十打出后触发（两张红十都已打出），桌面某端为4
  //   → 有红八的人自动出红八，然后结束
  // 五帐：出牌后桌面两端都是5（只能接大十大十）触发
  //   → 有大十大十的人自动出，然后结束
  // 一帐：第二张地幺打出后触发（两张地幺都已打出），桌面两端都是1
  //   → 有地幺的人自动出地幺，然后结束
  // 二三帐：出牌后桌面两端分别是2和3（只有二板和长三能接）
  //   → 有二板/长三的人自动出，然后结束
  // 砸红帐：出牌后6被锁死（两端都没有6），有选择时砸了红，且红十和红八还未全部打出
  //
  // 返回：{ isSuanZhang, type, desc, autoPlayList: [...] | [] }

  checkSuanZhang(playerIndex) {
    if (!this.rules.enableSuanZhang) return { isSuanZhang: false };
    if (this.chain.length < 1) return { isSuanZhang: false };

    const player = this.players[playerIndex];
    const left = this.chainEnds.left;
    const right = this.chainEnds.right;

    // 头牌（第一张）打出后不触发算账检测
    // （头牌净手属于普通胜负，不算算账）
    const isFirstTile = this.chain.length === 1;
    if (isFirstTile) return { isSuanZhang: false };

    // 净手也可以算账：玩家用最后一张牌封局（如红帐）是合法且常见的获胜手段，
    // 不再以"出的是最后一张牌"为由拦截。
    // （"后手不主动算必输的账"属于 AI 决策优化，不是规则拦截，见 ui.js 的 AI 逻辑。）

    // ===== 1. 红帐检测 =====
    // 红帐优先于死上检查：即使只有1张牌可出，出红十触发红帐仍然有效
    // 红帐的条件：本次出的是红十（算红帐一定是红十），且两张红十都已打出，
    // 出牌后桌面有端点=4（红十接在6端上，4端外露）
    const hongShiCount = this.playedTileKeys.filter(k => k === 'HONGSHI').length;
    const bothHongShiPlayed = hongShiCount >= 2;

    if (bothHongShiPlayed && this.lastPlayedTileKey === 'HONGSHI') {
      // 两张红十都打出来了，检查是否有4端外露
      // 红帐的本质：红十(4,6)打出后，4端暴露，而能接4端且不变4的只有红八(4,4)
      // 无论红八是否已全部打出，只要4端暴露就算红帐
      //   - 红八全在链上 → 手里没有红八可救，4端彻底死，红帐
      //   - 红八还在手中 → 算账流程会自动出红八作为solution

      if (left === 4 || right === 4) {
        // 触发红帐！
        this.suanZhangActive = true;
        this.suanZhangType = 'hongzhang';
        this.suanZhangStarter = playerIndex;
        this.suanZhangDeadPoints = [left, right];

        // 查找所有玩家手中所有的红八（可能有多张），需要全部自动出
        const autoPlayList = [];
        for (let i = 0; i < 4; i++) {
          if (this.players[i].isOut) continue;
          const hongBaTiles = this.players[i].hand.filter(t => t.key === 'HONGBA');
          for (const t of hongBaTiles) {
            autoPlayList.push({ playerIndex: i, tileId: t.id, tileKey: 'HONGBA' });
          }
        }

        this.log.push(`${player.name} 出红十封局！红帐！`);

        // 首圈检测未死红拦帐
        this.checkWeiSiHongLanZhang();

        return {
          isSuanZhang: true,
          type: 'hongzhang',
          desc: '红帐（红十封死红八4）',
          autoPlayList: autoPlayList,
          starter: playerIndex,
        };
      }
    }

    // ===== 2. 一帐检测 =====
    // 死上：手中只有1个可出方向（完全没得选），不算算账（红帐除外，已在上面处理）
    if (this.lastPlayChoiceCount < 1) return { isSuanZhang: false };

    // 条件：刚打出的牌是地幺，且两张地幺都已打出
    // 封局条件：所有能解封1端的牌都不在任何人的手牌中
    // 一六×2、一五×2、一三×2 全出完 → 触发一帐
    const yizhangSolutionKeys = ['YILIU', 'YIWU', 'YISAN'];
    const yzTotal = 6;
    const yzPlayed = yizhangSolutionKeys.reduce((s, k) => s + this.playedTileKeys.filter(x => x === k).length, 0);

    if (left === 1 && right === 1) {
      this.log.push(`一帐检测：两端=1,1，能变1的已出=${yzPlayed}/${yzTotal}`);
      if (yzPlayed >= yzTotal) {
        this.suanZhangActive = true;
        this.suanZhangType = 'yizhang';
        this.suanZhangStarter = playerIndex;
        this.suanZhangDeadPoints = [1, 1];
        const autoPlayList = [];
        for (let i = 0; i < 4; i++) {
          if (this.players[i].isOut) continue;
          for (const t of this.players[i].hand) {
            if (t.key === 'DIYAO') autoPlayList.push({ playerIndex: i, tileId: t.id, tileKey: 'DIYAO' });
          }
        }
        this.log.push(`${player.name} 触发一帐！`);
        return {
          isSuanZhang: true, type: 'yizhang',
          desc: '一帐（两端都是1）',
          autoPlayList: autoPlayList, starter: playerIndex,
        };
      }
    }

    // ===== 3. 五帐检测 =====
    // 条件：出牌后桌面两端都是5，且所有能变5端的牌（一五×2和虎头×2，共4张）都已打出
    // 大十(5-5)不影响死局，它只是唯一能接的牌
    const WUZHANG_SOLUTION = ['YIWU', 'HUTOU']; // 一五×2, 虎头×2，共4张
    const WZ_TOTAL = 4;
    if (left === 5 && right === 5) {
      const wzPlayed = WUZHANG_SOLUTION.reduce(
        (s, k) => s + this.playedTileKeys.filter(x => x === k).length, 0
      );
      this.log.push(`五帐检测：两端=5,5，能变5的已出=${wzPlayed}/${WZ_TOTAL}`);
      if (wzPlayed >= WZ_TOTAL) {
        this.suanZhangActive = true;
        this.suanZhangType = 'wuzhang';
        this.suanZhangStarter = playerIndex;
        this.suanZhangDeadPoints = [5, 5];
        const autoPlayList = [];
        for (let i = 0; i < 4; i++) {
          if (this.players[i].isOut) continue;
          for (const t of this.players[i].hand.filter(t => t.key === 'DASHI')) {
            autoPlayList.push({ playerIndex: i, tileId: t.id, tileKey: 'DASHI' });
          }
        }
        this.log.push(`${player.name} 触发五帐！`);
        return {
          isSuanZhang: true, type: 'wuzhang',
          desc: '五帐（两端都是5）',
          autoPlayList: autoPlayList, starter: playerIndex,
        };
      }
    }

    // ===== 4. 二三帐检测 =====
    // 条件：出牌后桌面两端分别是2和3，且所有能变2/3端的牌都已打出
    // 能变2端的：二六(2,6)×1 能变3端的：一三(1,3)×2、三六(3,6)×1  共4张
    // 不变牌：二板(2,2)接2、长三(3,3)接3 触发时自动出
    const isErSan = (left === 2 && right === 3) || (left === 3 && right === 2);
    if (isErSan) {
      const ersanKeys = ['ERLIU', 'YISAN', 'SANLIU'];
      const esTotal = 4; // 1+2+1
      const esPlayed = ersanKeys.reduce(
        (s, k) => s + this.playedTileKeys.filter(x => x === k).length, 0
      );
      this.log.push(`二三帐检测：两端=${left},${right}，能变2/3的已出=${esPlayed}/${esTotal}`);
      if (esPlayed >= esTotal) {
        this.suanZhangActive = true;
        this.suanZhangType = 'ersanzhang';
        this.suanZhangStarter = playerIndex;
        this.suanZhangDeadPoints = [left, right];
        const autoPlayList = [];
        for (let i = 0; i < 4; i++) {
          if (this.players[i].isOut) continue;
          for (const t of this.players[i].hand) {
            if (t.key === 'ERBAN' || t.key === 'CHANGAN') {
              autoPlayList.push({ playerIndex: i, tileId: t.id, tileKey: t.key });
            }
          }
        }
        this.log.push(`${player.name} 触发二三帐！`);
        return {
          isSuanZhang: true, type: 'ersanzhang',
          desc: '二三帐（两端是2和3）',
          autoPlayList: autoPlayList, starter: playerIndex,
        };
      }
    }

    // ===== 5. 砸红帐检测 =====
    // 砸红帐 = 除大天(DATIAN)和红十(HONGSHI)以外的含6牌全部被出掉了，
    //         出牌后链条上再也没有6端，导致红牌永远出不来。
    // 含6的牌：大天(6-6)×2、红十(4-6)×2、虎头(5-6)×2、一六(1-6)×2、三六(3-6)×1、二六(2-6)×1
    // 排除大天和红十后，需要全部出完的牌：
    //   虎头(HUTOU)×2、一六(YILIU)×2、三六(SANLIU)×1、二六(ERLIU)×1  共6张
    // 注意：只统计"出牌"（playedTileKeys），扣牌不计（扣牌不算算账）
    //
    // 前提条件：红十和红八还没有全部打出！如果红都已经出了，砸死6端不影响红，不算砸红帐。
    //   红十(HONGSHI)×2 全部打出 OR 红八(HONGBA)×2 全部打出 → 红已经"安全"，不触发
    const hongshiPlayedCount = this.playedTileKeys.filter(k => k === 'HONGSHI').length;
    const hongBaPlayedCount = this.playedTileKeys.filter(k => k === 'HONGBA').length;
    const redStillAlive = (hongshiPlayedCount < 2 && hongBaPlayedCount < 2);

    if (redStillAlive) {
      const SIX_PROVIDERS = ['HUTOU', 'YILIU', 'SANLIU', 'ERLIU'];
      const SIX_PROVIDER_TOTAL = 6; // 2+2+1+1
      const sixProviderPlayed = SIX_PROVIDERS.reduce(
        (sum, key) => sum + this.playedTileKeys.filter(k => k === key).length, 0
      );
      // 所有含6牌（除大天红十外）都出完了
      const allSixProvidersOut = sixProviderPlayed >= SIX_PROVIDER_TOTAL;

      // 当前链条两端有没有6
      const hasSixEnd = (left === 6 || right === 6);

      if (this.chain.length >= 2 && !hasSixEnd && allSixProvidersOut) {
        // 用 lastPlayChoiceCount 判断"出牌前是否有其他选择"
        const hadChoice = this.lastPlayChoiceCount > 0;

        if (hadChoice) {
          // 有选择却砸了红 → 砸红帐！
          this.suanZhangActive = true;
          this.suanZhangType = 'zahongzhang';
          this.suanZhangStarter = playerIndex;
          this.suanZhangDeadPoints = [left, right];

          this.log.push(`${player.name} 打死红！砸红帐！（有选择却出致命牌，红永远出不来了）`);

          return {
            isSuanZhang: true,
            type: 'zahongzhang',
            desc: '砸红帐（打死红，红永远出不来）',
            autoPlayList: [],
            starter: playerIndex,
          };
        } else {
          // 死砸：没得选，不算算账，不包庄，游戏继续（正常扣牌）
          this.log.push(`${player.name} 死砸（没得选，6被封死）`);
          // 不触发算账，正常继续
        }
      }
    } // end if (redStillAlive)

    // ===== 6. 闷五帐检测（可选地区规则）=====
    // 闷五帐 = 所有能改变5端的牌（一五×2、虎头×2）都已打出，
    //          出牌后链条上再也没有5端，导致大五(5-5)永远出不来。
    // 有选择才触发；没得选就是"死闷"，不算账。
    if (this.rules.enableMenWuZhang) {
      const FIVE_CHANGERS = ['YIWU', 'HUTOU']; // 共4张
      const FIVE_CHANGER_TOTAL = 4;
      const fiveChangerPlayed = FIVE_CHANGERS.reduce(
        (sum, key) => sum + this.playedTileKeys.filter(k => k === key).length, 0
      );
      const allFiveChangersOut = fiveChangerPlayed >= FIVE_CHANGER_TOTAL;
      const hasFiveEnd = (left === 5 || right === 5);

      if (this.chain.length >= 2 && !hasFiveEnd && allFiveChangersOut && this.lastPlayChoiceCount > 0) {
        this.suanZhangActive = true;
        this.suanZhangType = 'menwuzhang';
        this.suanZhangStarter = playerIndex;
        this.suanZhangDeadPoints = [left, right];
        this.log.push(`${player.name} 闷五帐！（有选择却把5端封死，大五永远出不来）`);
        return {
          isSuanZhang: true,
          type: 'menwuzhang',
          desc: '闷五帐（封死5端，大五出不来）',
          autoPlayList: [],
          starter: playerIndex,
        };
      }
    }

    return { isSuanZhang: false };
  }

  // ============ 跑红检测 ============
  // 跑红 = 玩家有红十无红八，场上已有4端却不封，放对手红八出
  // 跑红不等同于算账，不立即结束对局，设flag到结算时按算账计分
  // 调用时机：每次 playTile 之后（由 ui.js 调用）
  checkPaoHong(playerIndex) {
    if (!this.rules.enablePaoHong) return;
    if (this.paoHongActive) return; // 已触发，不重复

    const pre = this.prePlayChainEnds;
    if (!pre || pre.left === null) return; // 首张牌不检测

    // 1. 出牌前桌面已有4端
    const fourEndSide = pre.left === 4 ? 'left' : (pre.right === 4 ? 'right' : null);
    if (!fourEndSide) return;

    // 2. 红八未全部打出（还有红八可能在别人手里）
    const hongBaPlayedCount = this.playedTileKeys.filter(k => k === 'HONGBA').length;
    if (hongBaPlayedCount >= 2) return;

    const player = this.players[playerIndex];

    // 3. 玩家出牌前有红十（当前手牌中还有，或刚出的就是红十）
    const hasHongShiNow = player.hand.some(t => t.key === 'HONGSHI');
    const justPlayedHongShi = (this.lastPlayedTileKey === 'HONGSHI');
    if (!hasHongShiNow && !justPlayedHongShi) return; // 从没拥有红十

    // 4. 玩家用红十封了任意一个4端（含左右两端都是4的情形）→ 不是跑红
    //    判断依据是红十接的那一端在出牌前就是4
    if (justPlayedHongShi && pre[this.lastPlayedSide] === 4) return;

    // 5. 玩家手中（出牌后）没有红八才可能跑红；
    //    如果玩家刚打出的就是红八，说明他出牌前手里有红八，不算“放对手红八走”
    const hasHongBaInHand = player.hand.some(t => t.key === 'HONGBA');
    const justPlayedHongBa = (this.lastPlayedTileKey === 'HONGBA');
    if (hasHongBaInHand || justPlayedHongBa) {
      this.log.push(`${player.name} 自己有红八在手/自己打出红八，不算跑红`);
      return;
    }

    this.log.push(`${player.name} 跑红检测命中：hongBaPlayed=${hongBaPlayedCount}, fourEndSide=${fourEndSide}`);

    // 跑红触发！
    this.paoHongActive = true;
    this.paoHongStarter = playerIndex;
    this.log.push(`${player.name} 跑红！（有红十不封4端，放红八走）`);
  }

  // 自动出牌（算账触发后，所有能解封的牌全部自动出）
  // autoPlayList: [{ playerIndex, tileId, tileKey }, ...]
  // 返回自动出牌的数量
  autoPlayAllSuanZhangTiles(autoPlayList) {
    if (!autoPlayList || autoPlayList.length === 0) return 0;

    let count = 0;
    for (const item of autoPlayList) {
      const { playerIndex, tileId, tileKey } = item;
      const player = this.players[playerIndex];
      if (player.isOut) continue;

      // 找到手牌中对应的牌
      const tileIndex = player.hand.findIndex(t => t.id === tileId);
      if (tileIndex === -1) continue;

      const tile = player.hand[tileIndex];

      // 自动出这张牌（接在能接的端点上）
      let side = 'left';
      const left = this.chainEnds.left;
      const right = this.chainEnds.right;

      // 判断接哪一端
      if (left !== null && tile.ends.some(e => this.pointMatches(e, left))) {
        side = 'left';
      } else if (right !== null && tile.ends.some(e => this.pointMatches(e, right))) {
        side = 'right';
      }

      // 执行出牌
      player.hand.splice(tileIndex, 1);

      if (this.chain.length === 0) {
        this.chain.push({ tile, playedBy: playerIndex, leftEnd: tile.ends[0], rightEnd: tile.ends[1] || tile.ends[0] });
        this.chainEnds.left = tile.ends[0];
        this.chainEnds.right = tile.ends[1] || tile.ends[0];
      } else {
        if (side === 'left') {
          const otherEnd = tile.ends.find(e => !this.pointMatches(e, this.chainEnds.left)) || tile.ends[0];
          this.chain.unshift({ tile, playedBy: playerIndex, leftEnd: otherEnd, rightEnd: this.chainEnds.left });
          this.chainEnds.left = otherEnd;
        } else {
          const otherEnd = tile.ends.find(e => !this.pointMatches(e, this.chainEnds.right)) || tile.ends[0];
          this.chain.push({ tile, playedBy: playerIndex, leftEnd: this.chainEnds.right, rightEnd: otherEnd });
          this.chainEnds.right = otherEnd;
        }
      }

      this.playedTileKeys.push(tile.key);
      this.log.push(player.name + '（自动出牌）出了 ' + tile.name);

      if (player.hand.length === 0) {
        // 算账/算账自动出牌后净手：不计为"真正净手"，不影响普通结算的净手档位
        // outByPass 标记只用于扣牌出局；这里用 isOut 阻止继续出牌，但不进净手赢分支
        player.isOut = true;
        player.suanZhangOut = true; // 标记为算账流程中净手，结算时不走净手档
        this.log.push(player.name + ' 自动出牌后净手！');
      }

      count++;
    }

    return count;
  }

  // 通用自动出牌：迭代式把所有能接上桌面端点的牌全部自动出完
  // 用于算账触发后，确保能出的牌不计入手牌点数
  // 按玩家顺序轮流出牌，直到一轮没有任何人能出为止
  sweepPlayAllPlayable(startPlayerIndex) {
    let totalPlayed = 0;
    let changed = true;
    let currentIdx = startPlayerIndex;

    while (changed) {
      changed = false;
      // 从startPlayerIndex开始，遍历所有玩家
      for (let round = 0; round < 4; round++) {
        const pi = (startPlayerIndex + round) % 4;
        const player = this.players[pi];
        if (player.isOut || player.hand.length === 0) continue;

        // 找第一张能接上的牌
        let played = false;
        for (let ti = 0; ti < player.hand.length; ti++) {
          const tile = player.hand[ti];
          const playable = this.getPlayableEnds(tile, this.chainEnds);
          if (playable.length > 0) {
            const useSide = playable[0].side;
            const useEnd = playable[0].end;

            // 执行出牌（复用autoPlayAllSuanZhangTiles中相同的逻辑）
            player.hand.splice(ti, 1);
            if (useSide === 'left') {
              const otherEnd = tile.ends.find(e => !this.pointMatches(e, this.chainEnds.left)) || tile.ends[0];
              this.chain.unshift({ tile, playedBy: pi, leftEnd: otherEnd, rightEnd: this.chainEnds.left });
              this.chainEnds.left = otherEnd;
            } else {
              const otherEnd = tile.ends.find(e => !this.pointMatches(e, this.chainEnds.right)) || tile.ends[0];
              this.chain.push({ tile, playedBy: pi, leftEnd: this.chainEnds.right, rightEnd: otherEnd });
              this.chainEnds.right = otherEnd;
            }

            this.playedTileKeys.push(tile.key);
            this.log.push(player.name + '（算账自动出牌）出了 ' + tile.name);

            if (player.hand.length === 0) {
              player.isOut = true;
              player.suanZhangOut = true; // 算账流程净手，不走净手档结算
              this.log.push(player.name + ' 算账自动出牌后净手！');
            }

            totalPlayed++;
            changed = true;
            played = true;
            break; // 每人每次只出一张，然后重新轮
          }
        }
      }
    }

    return totalPlayed;
  }

  // 判断算账胜负（结算时调用）
  // 发起者最低（同分按沾光，先手赢）才能成功
  // 注意：扣完出局(outByPass=true)的玩家手牌为0，也要参与比较
  evaluateSuanZhang() {
    const starterId = this.suanZhangStarter;
    const starter = this.players[starterId];
    // 点数 = 手牌 + 扣牌（出不去的手牌也算扣）
    const totalPoints = p => p.hand.reduce((s, t) => s + t.points, 0)
                           + p.passedTiles.reduce((s, t) => s + t.points, 0);
    const myPoints = totalPoints(starter);

    let isSuccess = true;
    for (let i = 0; i < 4; i++) {
      if (i === starterId) continue;
      const otherPoints = totalPoints(this.players[i]);
      // 沾光：发起者同分也算赢，只有严格更低才算失败
      if (otherPoints < myPoints) {
        isSuccess = false;
        break;
      }
    }

    this.suanZhangSuccess = isSuccess;

    if (isSuccess) {
      this.log.push(`算账成功！${starter.name} 总点数 ${myPoints} 最低（沾光）。`);
    } else {
      this.log.push(`算账失败！${starter.name} 需包庄（总点数 ${myPoints} 非最低）。`);
    }

    return isSuccess;
  }

  // 判断跑红胜负（结算时调用）
  // 与算账相同的沾光规则：发起者同分也算赢，只有严格更低才算失败
  evaluatePaoHong() {
    const starterId = this.paoHongStarter;
    const starter = this.players[starterId];
    const totalPoints = p => p.hand.reduce((s, t) => s + t.points, 0)
                           + p.passedTiles.reduce((s, t) => s + t.points, 0);
    const myPoints = totalPoints(starter);

    let isSuccess = true;
    for (let i = 0; i < 4; i++) {
      if (i === starterId) continue;
      const otherPoints = totalPoints(this.players[i]);
      // 沾光：同分发起者赢
      if (otherPoints < myPoints) {
        isSuccess = false;
        break;
      }
    }

    this.paoHongSuccess = isSuccess;

    if (isSuccess) {
      this.log.push(`跑红成功！${starter.name} 总点数 ${myPoints} 最低。`);
    } else {
      this.log.push(`跑红失败！${starter.name} 需包庄（总点数 ${myPoints} 非最低）。`);
    }

    return isSuccess;
  }

  // ============ 结算 ============
  settleRound() {
    this.phase = PHASE.SETTLING;
    this.lastRoundLog = [];

    let scores = [0, 0, 0, 0];
    let roundMultiplier = 1;

    // ===== 记分方式 =====
    // 'fixed'（默认）：经典固定分，普通+6/输家1/2/3、单人净手+9/输家2/3/4、
    //   算账/跑红+12/输家3/4/5、包庄±12（与早期版一致，底分不参与）。
    // 'multiplier'：底分+翻倍，普通×1、单人净手×2、算账/跑红×3；
    //   底分系数：底分=10 时系数=1，即对应原有确认分值（+6/+9/±12 等）。
    const scoringMode = this.rules.scoringMode === 'multiplier' ? 'multiplier' : 'fixed';
    // 实际乘数：固定分模式恒为1（分值即经典数值）；倍数模式按倍率缩放
    const effMult = m => scoringMode === 'multiplier' ? m : 1;
    // 底分系数：固定分模式恒为1；倍数模式=底分/10
    const unit = scoringMode === 'multiplier' ? Math.max(0.1, (this.rules.baseScore || 10) / 10) : 1;
    const totalPtsOf = p => p.hand.reduce((s, t) => s + t.points, 0)
                            + p.passedTiles.reduce((s, t) => s + t.points, 0);
    const roundScore = v => Math.round(v * 100) / 100;
    // 通用零和结算：赢家收全部输家（按倍数与底分缩放后的）之和
    const applyScore = (multiplier, winnerId, loserPlans) => {
      let winnerGain = 0;
      for (const lp of loserPlans) {
        const v = roundScore(lp.value * unit * multiplier);
        scores[lp.id] = -v;
        winnerGain += v;
      }
      scores[winnerId] = roundScore(winnerGain);
    };
    const suanZhangTypeNames = {
      hongzhang: '红帐',
      wuzhang: '五帐',
      yizhang: '一帐',
      ersanzhang: '二三帐',
      zahongzhang: '砸红帐',
      general: '封局',
    };

    if (this.suanZhangActive) {
      // ====== 算账结算（固定分 +12 / 倍数 ×3）=======
      // 算账只有成功或失败：成功 = 发起者赢，其余三家阶梯记分；
      // 失败 = 发起者包庄给其余三家总点数最低者（永远只有一个赢家）
      const starterId = this.suanZhangStarter;
      const starter = this.players[starterId];
      const typeName = suanZhangTypeNames[this.suanZhangType] || '算账';
      const isSuccess = this.evaluateSuanZhang();
      const MULT = 3;
      roundMultiplier = MULT;

      if (isSuccess) {
        // 算账成功：检查首圈特殊规则（未死红拦帐、孤红）
        let baoZhuangPlayer = -1;

        // 未死红拦帐优先：有六牌不出导致红帐成功 → 责任人包庄
        if (this.weiSiHongLanZhangPlayer >= 0 && this.weiSiHongLanZhangPlayer !== starterId) {
          baoZhuangPlayer = this.weiSiHongLanZhangPlayer;
          this.lastRoundLog.push(this.players[baoZhuangPlayer].name + ' 未拦红帐！包庄 -' + roundScore(12 * unit * effMult(MULT)) + '！');
        }
        // 孤红：先手出红八无其他红牌 → 头牌包庄
        else if (this.guHongPlayerIndex >= 0 && this.guHongPlayerIndex !== starterId) {
          baoZhuangPlayer = this.guHongPlayerIndex;
          this.lastRoundLog.push(this.players[baoZhuangPlayer].name + ' 孤红先手！包庄 -' + roundScore(12 * unit * effMult(MULT)) + '！');
        }

        if (baoZhuangPlayer >= 0) {
          // 顶替包庄：赢家（发起者）+12（倍数模式×3），包庄者对应 -12（倍数×3），其余 0
          const v = roundScore(12 * unit * effMult(MULT));
          scores[starterId] = v;
          scores[baoZhuangPlayer] = -v;
          this.lastRoundLog.push(typeName + '成功！但 ' + this.players[baoZhuangPlayer].name + ' 需包庄！');
        } else {
          // 正常算账成功：发起者 +12（倍数模式×3），其余三家按总点数阶梯 -3/-4/-5（倍数×3）
          this.lastRoundLog.push(`${typeName}成功！${starter.name} 算账赢！`);
          const others = [0, 1, 2, 3]
            .filter(i => i !== starterId)
            .map(id => ({ id, points: totalPtsOf(this.players[id]) }))
            .sort((a, b) => a.points - b.points || a.id - b.id);
          applyScore(effMult(MULT), starterId, others.map((o, idx) => ({ id: o.id, value: [3, 4, 5][idx] })));
        }
      } else {
        // 算账失败（包庄）
        // 未死红拦帐：责任人替代发起者包庄（发起者拿赢家分）
        if (this.weiSiHongLanZhangPlayer >= 0 && this.weiSiHongLanZhangPlayer !== starterId) {
          const v = roundScore(12 * unit * effMult(MULT));
          scores[starterId] = v;
          scores[this.weiSiHongLanZhangPlayer] = -v;
          this.lastRoundLog.push(`${typeName}失败！但 ${this.players[this.weiSiHongLanZhangPlayer].name} 未拦红帐，需包庄！`);
        } else {
          // 正常包庄：发起者 -12（倍数模式×3），其余三家总点数最低者 +12（倍数×3）
          this.lastRoundLog.push(`${typeName}失败！${starter.name} 包庄！`);
          const v = roundScore(12 * unit * effMult(MULT));
          scores[starterId] = -v;
          let minPoints = Infinity;
          let minId = -1;
          for (let i = 0; i < 4; i++) {
            if (i === starterId) continue;
            const pts = totalPtsOf(this.players[i]);
            if (pts < minPoints) { minPoints = pts; minId = i; }
          }
          scores[minId] = v;
        }
      }
    } else if (this.paoHongActive) {
      // ====== 跑红结算（等同算账：固定分 +12 / 倍数 ×3）=======
      const paoHongStarterId = this.paoHongStarter;
      const paoHongStarter = this.players[paoHongStarterId];
      const paoHongSuccess = this.evaluatePaoHong();
      const MULT = 3;
      roundMultiplier = MULT;

      if (paoHongSuccess) {
        this.lastRoundLog.push(`跑红成功！${paoHongStarter.name} 赢！`);
        const others = [0, 1, 2, 3]
          .filter(i => i !== paoHongStarterId)
          .map(id => ({ id, points: totalPtsOf(this.players[id]) }))
          .sort((a, b) => a.points - b.points || a.id - b.id);
        applyScore(effMult(MULT), paoHongStarterId, others.map((o, idx) => ({ id: o.id, value: [3, 4, 5][idx] })));
      } else {
        this.lastRoundLog.push(`跑红失败！${paoHongStarter.name} 包庄！`);
        const v = roundScore(12 * unit * effMult(MULT));
        scores[paoHongStarterId] = -v;
        let minPoints = Infinity;
        let minId = -1;
        for (let i = 0; i < 4; i++) {
          if (i === paoHongStarterId) continue;
          const pts = totalPtsOf(this.players[i]);
          if (pts < minPoints) { minPoints = pts; minId = i; }
        }
        scores[minId] = v;
      }
    } else {
      // ====== 普通结算 ======
      // 净手玩家 = isOut 且不是扣牌出局、不是算账流程净手、且总点数（扣牌+手牌）为0
      const cleanOutPlayers = this.players.filter(p => {
        if (!p.isOut || p.outByPass || p.suanZhangOut) return false;
        const totalPts = p.passedTiles.reduce((s, t) => s + t.points, 0)
                       + p.hand.reduce((s, t) => s + t.points, 0);
        return totalPts === 0;
      });
      let winner = null;
      let isOutWin = false;

      if (cleanOutPlayers.length > 0) {
        // 有人真正净手（出完所有牌，没有扣过）：第一个净手的玩家赢
        isOutWin = true;
        let winnerId = this.firstCleanOutPlayer;
        // 安全验证：firstCleanOutPlayer 必须仍为有效净手玩家
        if (winnerId < 0 || this.players[winnerId].outByPass || this.players[winnerId].suanZhangOut
            || !cleanOutPlayers.some(p => p.id === winnerId)) {
          // 回退到庄家优先，否则按座位顺序
          const outIndices = cleanOutPlayers.map(p => p.id);
          if (outIndices.includes(this.dealerIndex)) {
            winnerId = this.dealerIndex;
          } else {
            let check = (this.dealerIndex + 3) % 4;
            while (!outIndices.includes(check)) {
              check = (check + 3) % 4;
            }
            winnerId = check;
          }
        }
        winner = this.players[winnerId];
      } else {
        // 无人净手（或所有isOut都是扣牌出局的），比总点数（扣牌+手牌点数最少的人赢）
        let minPoints = Infinity;
        for (const p of this.players) {
          const pts = p.passedTiles.reduce((s, t) => s + t.points, 0)
                     + p.hand.reduce((s, t) => s + t.points, 0);
          if (pts < minPoints) {
            minPoints = pts;
            winner = p;
          }
        }
      }

      // 输家按总点数（扣牌+手牌）从少到多排序，少者少输（用户规则：输家按点数 -1/-2/-3）。
      // 注意：不能把“净手”玩家无条件排到前面——净手者也可能有扣牌点数，
      // 若点数更高却排前面，会让低点数玩家吃更重的罚分。
      // 同分时：真正净手者优先，其次按座位顺序。
      const losers = this.players
        .filter(p => p.id !== winner.id)
        .map(p => ({
          id: p.id,
          points: p.passedTiles.reduce((s, t) => s + t.points, 0) + p.hand.reduce((s, t) => s + t.points, 0),
          isCleanOut: p.isOut && !p.outByPass && !p.suanZhangOut,
        }))
        .sort((a, b) => a.points - b.points || (b.isCleanOut ? 1 : 0) - (a.isCleanOut ? 1 : 0) || a.id - b.id);

      if (isOutWin && cleanOutPlayers.length === 1) {
        // 单人净手：赢家 +9（倍数模式×2），输家 -2/-3/-4（倍数×2）
        roundMultiplier = 2;
        if (losers.length >= 3) {
          applyScore(effMult(2), winner.id, [
            { id: losers[0].id, value: 2 },
            { id: losers[1].id, value: 3 },
            { id: losers[2].id, value: 4 },
          ]);
        }
      } else {
        // 多人净手 / 无人净手（普通×1）：赢家 +6，输家 -1/-2/-3
        if (losers.length >= 3) {
          applyScore(1, winner.id, [
            { id: losers[0].id, value: 1 },
            { id: losers[1].id, value: 2 },
            { id: losers[2].id, value: 3 },
          ]);
        }
      }

      this.lastRoundLog.push(`本局赢家：${winner.name}`);
    }

    // 累加积分
    for (let i = 0; i < 4; i++) {
      this.scores[i] += scores[i];
      this.roundScores[i] = scores[i];
    }

    // 记录详细日志
    for (let i = 0; i < 4; i++) {
      const pts = this.players[i].passedTiles.reduce((s, t) => s + t.points, 0);
      const handPts = this.players[i].hand.reduce((s, t) => s + t.points, 0);
      this.lastRoundLog.push(
        `${this.players[i].name}：${scores[i] >= 0 ? '+' : ''}${scores[i]} 分` +
          `（扣牌${pts}点，手牌${handPts}点）`
      );
    }

    // 庄家轮转：输得最多的人坐庄
    let maxLoser = 0, maxLoss = Infinity;
    for (let i = 0; i < 4; i++) {
      if (scores[i] < maxLoss) {
        maxLoss = scores[i];
        maxLoser = i;
      }
    }
    this.dealerIndex = maxLoser;

    this.log.push(`本局结束。下局庄家：${this.players[this.dealerIndex].name}`);
    // 从分数中找出赢家（最高分）
    let maxScore = -Infinity, winnerId = -1;
    for (let i = 0; i < 4; i++) {
      if (scores[i] > maxScore) {
        maxScore = scores[i];
        winnerId = i;
      }
    }
    this.lastWinner = winnerId;

    return {
      success: true,
      suanZhang: this.suanZhangActive,
      suanZhangType: this.suanZhangType,
      suanZhangSuccess: this.suanZhangSuccess,
      suanZhangStarter: this.suanZhangStarter,
      paoHong: this.paoHongActive,
      paoHongSuccess: this.paoHongSuccess,
      paoHongStarter: this.paoHongStarter,
      scores,
      multiplier: roundMultiplier,
      baseScore: this.rules.baseScore,
      nextDealer: this.dealerIndex,
      winnerIndex: this.lastWinner,
    };
  }

  // ============ 开始新一局 ============
  startNewRound(diceDealerIndex) {
    const savedPlayers = this.players.map(p => ({ name: p.name, role: p.role }));
    const savedDealer = (diceDealerIndex !== undefined) ? diceDealerIndex : this.dealerIndex;
    const savedScores = [...this.scores];
    const savedLastWinner = this.lastWinner;

    // 仅重置本局状态，保留累计积分、庄家、上局赢家、玩家身份
    this.resetRoundState();

    for (let i = 0; i < 4; i++) {
      this.players[i].name = savedPlayers[i].name;
      this.players[i].role = savedPlayers[i].role;
    }
    this.dealerIndex = savedDealer;
    this.scores = savedScores;
    this.lastWinner = savedLastWinner;

    this.dealCards();
  }

  // 孤红一家不去：头牌要出红八时，检查其他红牌是否都在同一人手中
  // 如果是，这张红八得拿回去，玩家只能选别的牌出
  checkGuHongYiJia(playerIndex, tileKey) {
    if (this.chain.length > 0) return false;
    if (tileKey !== 'HONGBA') return false;
    const player = this.players[playerIndex];
    const hasOtherRed = player.hand.some(t => t.key === 'HONGSHI' || t.key === 'HONGBA');
    if (hasOtherRed) return false;
    let rc = {};
    for (let i = 0; i < 4; i++) {
      if (i === playerIndex) continue;
      rc[i] = this.players[i].hand.filter(t => t.key === 'HONGBA' || t.key === 'HONGSHI').length;
    }
    return Object.values(rc).some(c => c >= 3);
  }

  // ============ 获取桌面状态（用于渲染）============
  getBoardState() {
    return {
      chain: this.chain,
      chainEnds: this.chainEnds,
      currentPlayer: this.currentPlayer,
      phase: this.phase,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        handCount: p.hand.length,
        isOut: p.isOut,
        passed: p.passed,
        passedCount: p.passedTiles.length,
        passedPoints: p.passedTiles.reduce((s, t) => s + t.points, 0),
      })),
    };
  }
}

// ============ AI 策略 ============
const TILE_DIFFICULTY = {
  DATIAN:  70,
  HONGBA:  95,
  DASHI:    75,
  CHANGAN: 65,
  DIYAO:   50,
  ERBAN:   80,
  HUTOU:   40,
  HONGSHI: 85,
  YILIU:   35,
  YIWU:    35,
  YISAN:   45,
  SANLIU:  55,
  ERLIU:   55,
};

class AIPlayer {
  // ============ AI 通用辅助（纯计算，不修改游戏状态）============

  // 各牌型“死牌”数量（已打出 + 已扣出）
  static _deadCounts(game) {
    const counts = {};
    for (const k of Object.keys(TILE_TYPES)) counts[k] = 0;
    for (const k of game.playedTileKeys) counts[k] = (counts[k] || 0) + 1;
    for (const p of game.players) {
      for (const t of p.passedTiles) counts[t.key] = (counts[t.key] || 0) + 1;
    }
    return counts;
  }

  // 各牌型“已打出”数量（算账触发判定只认打出，扣牌不算）
  static _playedCounts(game) {
    const counts = {};
    for (const k of Object.keys(TILE_TYPES)) counts[k] = 0;
    for (const k of game.playedTileKeys) counts[k] = (counts[k] || 0) + 1;
    return counts;
  }

  // 模拟某张牌接到某端后的链端
  static _simEnds(game, tile, pe) {
    if (game.chain.length === 0) {
      return { left: tile.ends[0], right: tile.ends[1] || tile.ends[0] };
    }
    const ends = { left: game.chainEnds.left, right: game.chainEnds.right };
    const otherEnd = tile.ends.find(e => !game.pointMatches(e, pe.end)) || tile.ends[0];
    if (pe.side === 'left') ends.left = otherEnd;
    else ends.right = otherEnd;
    return ends;
  }

  // 给定链端时，某玩家手牌中可出的张数（模拟下家接牌难度）
  static _countPlayable(game, playerIndex, ends) {
    const p = game.players[playerIndex];
    if (!p || p.isOut || p.hand.length === 0) return 0;
    return p.hand.filter(t => t.ends.some(e => e === ends.left || e === ends.right)).length;
  }

  // 判断某次出牌是否会触发算账（与 checkSuanZhang 同口径：只认打出，扣牌不算）
  static _wouldTriggerSuanZhang(game, tile, pe, hasChoice) {
    const ends = AIPlayer._simEnds(game, tile, pe);
    const cnt = k => game.playedTileKeys.filter(x => x === k).length;
    // 红帐：本张是红十，两张红十齐，桌面有4端（红十接6端后4端外露）
    if (tile.key === 'HONGSHI' && cnt('HONGSHI') >= 1 && (ends.left === 4 || ends.right === 4)) {
      return 'hongzhang';
    }
    if (!hasChoice) return null;
    if (ends.left === 1 && ends.right === 1 && ['YILIU', 'YIWU', 'YISAN'].reduce((s, k) => s + cnt(k), 0) >= 6) {
      return 'yizhang';
    }
    if (ends.left === 5 && ends.right === 5 && ['YIWU', 'HUTOU'].reduce((s, k) => s + cnt(k), 0) >= 4) {
      return 'wuzhang';
    }
    if (((ends.left === 2 && ends.right === 3) || (ends.left === 3 && ends.right === 2)) &&
        ['ERLIU', 'YISAN', 'SANLIU'].reduce((s, k) => s + cnt(k), 0) >= 4) {
      return 'ersanzhang';
    }
    const redAlive = cnt('HONGSHI') < 2 && cnt('HONGBA') < 2;
    if (redAlive && game.chain.length >= 1 && ends.left !== 6 && ends.right !== 6 &&
        ['HUTOU', 'YILIU', 'SANLIU', 'ERLIU'].reduce((s, k) => s + cnt(k), 0) >= 6) {
      return 'zahongzhang';
    }
    return null;
  }

  // 发起算账对自己是否有利（沾光：自己总点数 ≤ 其他所有玩家）
  // margin：要求领先至少 margin 点才视为“明确有利”（AI 判断用，避免仅差1点就梭哈）
  static _suanZhangFavorable(game, playerIndex, margin) {
    const pts = i => game.players[i].hand.reduce((s, t) => s + t.points, 0)
                   + game.players[i].passedTiles.reduce((s, t) => s + t.points, 0);
    const my = pts(playerIndex);
    const need = my + (margin || 0);
    for (let i = 0; i < 4; i++) {
      if (i === playerIndex) continue;
      if (pts(i) < need) return false;
    }
    return true;
  }

  // 判断某次出牌是否会给自己挂上“跑红”标记（复刻 checkPaoHong 的条件）
  static _wouldTriggerPaoHong(game, playerIndex, tile, pe) {
    if (!game.rules.enablePaoHong) return false;
    const pre = game.prePlayChainEnds;
    if (!pre || pre.left === null) return false;
    if (pre.left !== 4 && pre.right !== 4) return false;   // 出牌前桌面必须有4端
    const hongBaPlayed = game.playedTileKeys.filter(k => k === 'HONGBA').length;
    if (hongBaPlayed >= 2) return false;                   // 红八已全出，无红可跑
    const player = game.players[playerIndex];
    const justPlayedHongShi = (tile.key === 'HONGSHI');
    const hasHongShiNow = player.hand.some(t => t.key === 'HONGSHI');
    if (!hasHongShiNow && !justPlayedHongShi) return false; // 从没拥有红十
    // 红十封了任意一个4端 → 不算跑红
    if (justPlayedHongShi && pe.end === 4) return false;
    // 自己手上有红八 → 不算跑红
    if (player.hand.some(t => t.key === 'HONGBA')) return false;
    return true;
  }

  // 扣牌选择分：越低越优先（点数低、且未来越难再接上的牌先扣）
  static _passScore(game, tile) {
    const dead = AIPlayer._deadCounts(game);
    let revive = 0;
    for (const e of tile.ends) {
      for (const k of Object.keys(TILE_TYPES)) {
        if (!TILE_TYPES[k].ends.includes(e)) continue;
        revive += Math.max(0, TILE_TYPES[k].count - (dead[k] || 0));
      }
    }
    return tile.points * 2 + revive;
  }

  // ============ 蒙特卡洛模拟 ============
  // 深拷贝当前对局（数据克隆 + 恢复原型方法），用于不影响真实对局的随机推演
  static _cloneGame(game) {
    const clone = JSON.parse(JSON.stringify(game));
    Object.setPrototypeOf(clone, DingNiuGame.prototype);
    return clone;
  }

  // 模拟算账触发后的自动出牌并结算
  static _simulateSuanZhang(clone, suanZhangInfo) {
    const autoPlayList = suanZhangInfo.autoPlayList || [];
    const starterIndex = suanZhangInfo.starter || 0;
    if (autoPlayList.length > 0) {
      clone.autoPlayAllSuanZhangTiles(autoPlayList);
    }
    clone.sweepPlayAllPlayable(starterIndex);
    clone.settleRound();
  }

  // 模拟中把 currentPlayer 推进到下一个有效玩家
  static _advanceTurn(clone) {
    const g = clone;
    if (!g || !g.players) return;
    if (g.checkRoundShouldEnd()) return;
    let next = (g.currentPlayer + 3) % 4;
    let safety = 0;
    let skippedHard = 0;
    while (safety < 4) {
      const p = g.players[next];
      if (!p || p.isOut || p.hand.length === 0) {
        next = (next + 3) % 4;
        safety++;
        continue;
      }
      if (g.chain.length === 0 && !g.canLead(next)) {
        next = (next + 3) % 4;
        safety++;
        skippedHard++;
        continue;
      }
      break;
    }
    if (safety >= 4) {
      if (skippedHard > 0) {
        let f = (g.currentPlayer + 3) % 4;
        for (let k = 0; k < 4; k++) {
          if (g.players[f] && !g.players[f].isOut && g.players[f].hand.length > 0) {
            next = f;
            break;
          }
          f = (f + 3) % 4;
        }
      } else {
        return;
      }
    }
    g.currentPlayer = next;
  }

  // 随机推演到本局结束，返回 AI（playerIndex）的最终得分
  static _simulateToEnd(clone, playerIndex) {
    let steps = 0;
    while (clone.phase === 'playing' && steps < 200) {
      steps++;
      if (clone.checkRoundShouldEnd()) break;

      const cp = clone.currentPlayer;
      const player = clone.players[cp];
      if (!player || player.isOut || player.hand.length === 0) {
        AIPlayer._advanceTurn(clone);
        continue;
      }

      const playable = clone.getPlayableTiles(cp);
      if (playable.length > 0) {
        const p = playable[Math.floor(Math.random() * playable.length)];
        const pe = p.playableEnds[Math.floor(Math.random() * p.playableEnds.length)];
        const r = clone.playTile(cp, p.tile.id, pe.end, pe.side);
        if (r.success) {
          clone.checkPaoHong(cp);
          const sz = clone.checkSuanZhang(cp);
          if (sz && sz.isSuanZhang) {
            AIPlayer._simulateSuanZhang(clone, sz);
            return;
          }
        } else if (player.hand.length > 0) {
          const sorted = [...player.hand].sort((a, b) => AIPlayer._passScore(clone, a) - AIPlayer._passScore(clone, b));
          clone.passTurn(cp, sorted[0].id);
        }
      } else if (player.hand.length > 0) {
        const sorted = [...player.hand].sort((a, b) => AIPlayer._passScore(clone, a) - AIPlayer._passScore(clone, b));
        clone.passTurn(cp, sorted[0].id);
      }

      AIPlayer._advanceTurn(clone);
    }

    if (clone.phase === 'playing') {
      try { clone.settleRound(); } catch (e) {}
    }
  }

  // 对给定候选走法做蒙特卡洛评估，返回平均分最高的走法
  // candidateMoves: [{ tileId, end, side }]
  static monteCarloPlay(game, playerIndex, candidateMoves) {
    if (!candidateMoves || candidateMoves.length === 0) return null;
    const moves = candidateMoves.slice(0, 4);
    // 控制总模拟次数，避免浏览器和自动化测试卡顿：约 30~50 次随机对局
    const sims = Math.max(2, Math.floor(40 / moves.length));
    let best = null;
    let bestScore = -Infinity;

    for (const m of moves) {
      let total = 0;
      let valid = 0;
      for (let i = 0; i < sims; i++) {
        const clone = AIPlayer._cloneGame(game);
        const r = clone.playTile(playerIndex, m.tileId, m.end, m.side);
        if (!r.success) continue;
        clone.checkPaoHong(playerIndex);
        const sz = clone.checkSuanZhang(playerIndex);
        if (sz && sz.isSuanZhang) {
          AIPlayer._simulateSuanZhang(clone, sz);
        } else {
          AIPlayer._simulateToEnd(clone, playerIndex);
        }
        const score = (clone.scores && clone.scores[playerIndex]) || 0;
        total += score;
        valid++;
      }
      if (valid === 0) continue;
      const avg = total / valid;
      if (avg > bestScore) {
        bestScore = avg;
        best = m;
      }
    }
    return best;
  }

  static easyPlay(game, playerIndex) {
    const playable = game.getPlayableTiles(playerIndex);
    if (playable.length === 0) {
      const hand = game.players[playerIndex].hand;
      const tileToPass = hand[Math.floor(Math.random() * hand.length)];
      return { action: 'pass', tileId: tileToPass.id };
    }
    const choice = playable[Math.floor(Math.random() * playable.length)];
    const end = choice.playableEnds[Math.floor(Math.random() * choice.playableEnds.length)];
    return { action: 'play', tileId: choice.tile.id, chosenEnd: end.end, side: end.side };
  }

  static mediumPlay(game, playerIndex) {
    const playable = game.getPlayableTiles(playerIndex);
    if (playable.length === 0) {
      const hand = game.players[playerIndex].hand;
      const sorted = [...hand].sort((a, b) => AIPlayer._passScore(game, a) - AIPlayer._passScore(game, b));
      return { action: 'pass', tileId: sorted[0].id };
    }

    const player = game.players[playerIndex];
    const hand = player.hand;

    if (player.hand.length === 1) {
      const choice = playable[0];
      const end = choice.playableEnds[0];
      return { action: 'play', tileId: choice.tile.id, chosenEnd: end.end, side: end.side };
    }

    const horizCards = playable.filter(p => p.tile.type === 'horizontal');
    if (horizCards.length > 0) {
      horizCards.sort((a, b) => b.tile.points - a.tile.points);
      const choice = horizCards[0];
      const end = choice.playableEnds[0];
      return { action: 'play', tileId: choice.tile.id, chosenEnd: end.end, side: end.side };
    }

    let bestCard = null;
    let bestScore = -Infinity;

    for (const p of playable) {
      const tile = p.tile;
      let score = TILE_DIFFICULTY[tile.key] || 50;

      const testEnds = { left: game.chainEnds.left, right: game.chainEnds.right };
      if (testEnds.left === null) {
        testEnds.left = tile.ends[0];
        testEnds.right = tile.ends[1] || tile.ends[0];
      } else {
        const endInfo = p.playableEnds[0];
        const otherEnd = tile.ends.find(e => !game.pointMatches(e, endInfo.end)) || tile.ends[0];
        if (endInfo.side === 'left') {
          testEnds.left = otherEnd;
        } else {
          testEnds.right = otherEnd;
        }
      }

      let remainingPlayable = 0;
      for (const h of hand) {
        if (h.id === tile.id) continue;
        for (const ep of h.ends) {
          if (game.pointMatches(ep, testEnds.left) || game.pointMatches(ep, testEnds.right)) {
            remainingPlayable++;
            break;
          }
        }
      }

      score += remainingPlayable * 5;
      score += tile.points * 2;

      if (score > bestScore) {
        bestScore = score;
        bestCard = p;
      }
    }

    if (bestCard) {
      const end = bestCard.playableEnds[0];
      return { action: 'play', tileId: bestCard.tile.id, chosenEnd: end.end, side: end.side };
    }

    playable.sort((a, b) => b.tile.points - a.tile.points);
    const choice = playable[0];
    const end = choice.playableEnds[0];
    return { action: 'play', tileId: choice.tile.id, chosenEnd: end.end, side: end.side };
  }

  static hardPlay(game, playerIndex) {
    const playable = game.getPlayableTiles(playerIndex);
    const player = game.players[playerIndex];
    const hand = player.hand;

    // 无可出牌 → 扣最低分
    if (playable.length === 0) {
      const sorted = [...hand].sort((a, b) => AIPlayer._passScore(game, a) - AIPlayer._passScore(game, b));
      return { action: 'pass', tileId: sorted[0].id };
    }

    const ends = game.chainEnds;
    const isFirstTile = (game.chain.length === 0);
    const nextPlayer = (playerIndex + 3) % 4;

    // === 0. 先手也用蒙特卡洛自判断 ===
    // 让 AI 自己模拟不同首牌的未来结果，而不是只靠写死的口诀
    if (isFirstTile) {
      const legalFirst = playable.filter(p => !game.isYingPaiViolation(playerIndex, p.tile));
      const candidateMoves = legalFirst.slice(0, 4).map(p => ({
        tileId: p.tile.id,
        end: p.playableEnds[0].end,
        side: p.playableEnds[0].side,
      }));
      const mc = AIPlayer.monteCarloPlay(game, playerIndex, candidateMoves);
      if (mc) {
        return { action: 'play', tileId: mc.tileId, chosenEnd: mc.end, side: mc.side };
      }
    }

    // === 1. 先手策略（蒙特卡洛不可用时的启发式兜底）===
    if (isFirstTile) {
      // 计算手牌平均点数
      const avgPts = hand.reduce((s, t) => s + t.points, 0) / hand.length;

      // "头牌出底幺，必定打的高" — 手牌有很多大点时先出地幺
      const diyao = playable.find(p => p.tile.key === 'DIYAO');
      if (diyao && avgPts >= 6.5) {
        return { action: 'play', tileId: diyao.tile.id, chosenEnd: diyao.playableEnds[0].end, side: diyao.playableEnds[0].side };
      }

      // 头牌有对子优先出
      const pairs = playable.filter(p => {
        const key = p.tile.key;
        return hand.filter(t => t.key === key).length >= 2;
      });
      if (pairs.length > 0) {
        pairs.sort((a, b) => b.tile.points - a.tile.points);
        return { action: 'play', tileId: pairs[0].tile.id, chosenEnd: pairs[0].playableEnds[0].end, side: pairs[0].playableEnds[0].side };
      }

      // 红八+红十 → 先出红八，挤兑别人出红十
      const hasHongBa = hand.some(t => t.key === 'HONGBA');
      const hasHongShiInHand = hand.some(t => t.key === 'HONGSHI');
      if (hasHongBa && hasHongShiInHand) {
        // 孤红一家不去检查
        if (!game.checkGuHongYiJia(playerIndex, 'HONGBA')) {
          const hongba = playable.find(p => p.tile.key === 'HONGBA');
          if (hongba) {
            return { action: 'play', tileId: hongba.tile.id, chosenEnd: hongba.playableEnds[0].end, side: hongba.playableEnds[0].side };
          }
        }
      }

      // "大十难出" — 有机会先出
      const dashi = playable.find(p => p.tile.key === 'DASHI');
      if (dashi) {
        return { action: 'play', tileId: dashi.tile.id, chosenEnd: dashi.playableEnds[0].end, side: dashi.playableEnds[0].side };
      }

      // "没有二和三不能上大天"
      const hasTwoOrThree = hand.some(t =>
        TILE_TYPES[t.key].ends.includes(2) || TILE_TYPES[t.key].ends.includes(3));
      const datian = playable.find(p => p.tile.key === 'DATIAN');
      if (datian && !hasTwoOrThree) {
        const others = playable.filter(p => p.tile.key !== 'DATIAN');
        if (others.length > 0) {
          others.sort((a, b) => b.tile.points - a.tile.points);
          return { action: 'play', tileId: others[0].tile.id, chosenEnd: others[0].playableEnds[0].end, side: others[0].playableEnds[0].side };
        }
      }

      // "头牌出一六，神仙估不透"
      const yiliu = playable.find(p => p.tile.key === 'YILIU');
      if (yiliu) {
        return { action: 'play', tileId: yiliu.tile.id, chosenEnd: yiliu.playableEnds[0].end, side: yiliu.playableEnds[0].side };
      }

      // 默认最高分
      playable.sort((a, b) => b.tile.points - a.tile.points);
      return { action: 'play', tileId: playable[0].tile.id, chosenEnd: playable[0].playableEnds[0].end, side: playable[0].playableEnds[0].side };
    }

    // === 3. 红牌策略 ===
    const hasHongBaNow = hand.some(t => t.key === 'HONGBA');
    const hasHongShiNow = hand.some(t => t.key === 'HONGSHI');
    // 没红十 → 红八赶紧出，别等红十出来被卡死
    if (hasHongBaNow && !hasHongShiNow) {
      const hongba = playable.find(p => p.tile.key === 'HONGBA');
      if (hongba) {
        return { action: 'play', tileId: hongba.tile.id, chosenEnd: hongba.playableEnds[0].end, side: hongba.playableEnds[0].side };
      }
    }

    // === 4. 拦红帐策略 ===
    const hongShiInPlayed = game.playedTileKeys.filter(k => k === 'HONGSHI').length;
    // 下家有红十、桌面有6端+4端 → 优先处理6端（不给下家6），或者用大天软拦
    if (hongShiInPlayed === 1) {
      const nextPlayerIndex = (playerIndex + 3) % 4;
      const nextHand = game.players[nextPlayerIndex].hand;
      const nextHasHongShi = nextHand.some(t => t.key === 'HONGSHI');
      if (nextHasHongShi) {
        const has4end = ends.left === 4 || ends.right === 4;
        const has6end = ends.left === 6 || ends.right === 6;
        if (has4end) {
          // "故意放行"：自己总点数≤10，故意不拦等别人包庄
          const myTotal = hand.reduce((s, t) => s + t.points, 0) + player.passedTiles.reduce((s, t) => s + t.points, 0);
          if (myTotal <= 10) {
            // 自己点数很小，故意不拦——随便出
            playable.sort((a, b) => a.tile.points - b.tile.points);
            return { action: 'play', tileId: playable[0].tile.id, chosenEnd: playable[0].playableEnds[0].end, side: playable[0].playableEnds[0].side };
          }
          if (has6end) {
            // "软拦"：用大天接6端，不改变链端
            const dt = playable.find(p => p.tile.key === 'DATIAN' && p.playableEnds.some(pe => pe.end === 6));
            if (dt) {
              const e6 = dt.playableEnds.find(pe => pe.end === 6);
              return { action: 'play', tileId: dt.tile.id, chosenEnd: e6.end, side: e6.side };
            }
            // 用其他含6的牌破6端，不给下家留下6
            const break6 = playable.find(p => {
              for (const e of p.playableEnds) {
                if (e.end === 6) {
                  const other = p.tile.ends.find(v => v !== 6) || p.tile.ends[0];
                  if (other !== 6) return true;
                }
              }
              return false;
            });
            if (break6) {
              const e = break6.playableEnds.find(pe => pe.end === 6);
              return { action: 'play', tileId: break6.tile.id, chosenEnd: e.end, side: e.side };
            }
          }
        }
      }
    }

    // === 5. 统一候选评估 ===
    // 综合考量：触发算账的利弊、下家/下下家接牌难度、净手进度、大点数优先出
    const nextPlayer2 = (nextPlayer + 3) % 4;
    const handSize = hand.length;

    const evaluated = playable.map(p => {
      let best = -Infinity;
      for (const pe of p.playableEnds) {
        let es = 0;
        // 算账触发评估：对自己有利的帐主动触发，必输的帐避开（除非没得选）
        const trig = AIPlayer._wouldTriggerSuanZhang(game, p.tile, pe, playable.length > 1);
        if (trig) {
          es += AIPlayer._suanZhangFavorable(game, playerIndex, 4) ? 260 : -480;
        }
        // 跑红风险：会给自己挂跑红标记 → 不利时严厉回避，有利时允许故意跑红
        if (AIPlayer._wouldTriggerPaoHong(game, playerIndex, p.tile, pe)) {
          // 实测跑红胜率约四成，EV为负：整体回避，仅在所有选择都更差时才接受
          es += AIPlayer._suanZhangFavorable(game, playerIndex) ? -20 : -520;
        }
        // 封堵下家/下下家：让对手无牌可接是大优势
        const simEnds = AIPlayer._simEnds(game, p.tile, pe);
        const n1 = AIPlayer._countPlayable(game, nextPlayer, simEnds);
        const n2 = AIPlayer._countPlayable(game, nextPlayer2, simEnds);
        if (n1 === 0) es += 50;
        else es -= n1 * 10;
        // 下家只剩1张时，绝不能送给他可接的端点（否则他净手直接赢）
        if (game.players[nextPlayer] && !game.players[nextPlayer].isOut &&
            game.players[nextPlayer].hand.length === 1 && n1 > 0) {
          es -= 300;
        }
        es -= n2 * 3;
        // 出牌后自己剩余可出数：别把自己堵死（扣牌是下策）
        let myNext = 0;
        for (const t of hand) {
          if (t.id === p.tile.id) continue;
          if (t.ends.some(e => e === simEnds.left || e === simEnds.right)) myNext++;
        }
        es += myNext * 10;
        // 净手进度：手牌越少越要尽快清空
        if (handSize <= 1) es += 300;
        else if (handSize === 2) es += 150;
        else if (handSize === 3) es += 35;
        // 大点数牌倾向早出（降低结算时手里的点数）
        es += p.tile.points * 0.8;
        best = Math.max(best, es);
      }
      return { p, score: best };
    });

    // 有其他选择时，排除“必然触发不利算账”的候选
    const safePool = evaluated.filter(c => c.score > -250);
    const pool = safePool.length > 0 ? safePool : evaluated;
    pool.sort((a, b) => b.score - a.score);

    // 用蒙特卡洛从启发式 Top 候选中精挑：随机推演多局，选平均分最高的走法
    const topCandidates = pool.slice(0, 3);
    const candidateMoves = [];
    for (const entry of topCandidates) {
      for (const pe of entry.p.playableEnds) {
        candidateMoves.push({ tileId: entry.p.tile.id, end: pe.end, side: pe.side });
        if (candidateMoves.length >= 6) break;
      }
      if (candidateMoves.length >= 6) break;
    }
    const mcMove = AIPlayer.monteCarloPlay(game, playerIndex, candidateMoves);
    if (mcMove) {
      return { action: 'play', tileId: mcMove.tileId, chosenEnd: mcMove.end, side: mcMove.side };
    }

    // 蒙特卡洛不可用时回退到启发式
    const bestChoice = pool[0].p;
    const bestEnd = bestChoice.playableEnds[0];
    return { action: 'play', tileId: bestChoice.tile.id, chosenEnd: bestEnd.end, side: bestEnd.side };
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DingNiuGame, AIPlayer, TILE_TYPES, PHASE };
}

