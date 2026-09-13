/**
 * 顶牛 - UI渲染与交互逻辑
 * 使用 Canvas 绘制牌桌 + DOM 手牌 + 图片素材
 */

// ============ 全局状态 ============
let game = null;
let canvas, ctx;
let selectedTileId = null;
let selectedEnd = null;
let passTileId = null; // 扣牌时选中的牌

// 本地多人（同设备轮流）模式
let localMode = false;
let localReady = false;

// 在线/局域网联机模式
let onlineMode = false;
let mySeat = -1;
let roomCode = '';
let ws = null;
let onlineState = null;
let onlinePlayable = [];
let onlineLockedIds = [];
let onlineHasPlayable = false;
let onlineSettleResult = null;
let roomList = [];
let roomRules = null;
let roomTargetRounds = 0;
let deferredInstallPrompt = null;
let chatVisible = false;
let soundEnabled = true;
let vibrationEnabled = true;

// 图片缓存
const tileImages = {};

// 颜色主题
// ============ 主题调色板（dark / light） ============
const THEME_PALETTES = {
  dark: {
    felt:'#103d22', feltLight:'#1f5e32', tileBg:'#f3ead2', tileBorder:'#9c7b4f',
    tilePlayable:'#4caf50', tileSelected:'#e8c878', tileUnplayable:'rgba(120,120,120,0.4)',
    textGold:'#e8c878', textLight:'#eae0c8', textMuted:'#b9a878',
    playerActive:'#e8c878', playerInactive:'rgba(234,224,200,0.28)',
    chainLine:'rgba(232,200,120,0.6)', dotRed:'#c0392b', dotWhite:'#f3ead2', dotDark:'#2c1810'
  },
  light: {
    felt:'#3c6347', feltLight:'#4e7a57', tileBg:'#f6efdd', tileBorder:'#bba37a',
    tilePlayable:'#3a9d40', tileSelected:'#9c7d2e', tileUnplayable:'rgba(90,90,90,0.4)',
    textGold:'#9c7d2e', textLight:'#3a3326', textMuted:'#6b6450',
    playerActive:'#9c7d2e', playerInactive:'rgba(58,51,38,0.22)',
    chainLine:'rgba(156,125,46,0.6)', dotRed:'#c0392b', dotWhite:'#f6efdd', dotDark:'#2c1810'
  },
};
let _themeMode = (typeof localStorage !== 'undefined') ? (localStorage.getItem('dingniu-theme') || 'dark') : 'dark';
function _resolveTheme() {
  if (_themeMode === 'system') {
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  return _themeMode;
}
let COLORS = THEME_PALETTES[_resolveTheme()];
function isLightTheme() { return _resolveTheme() === 'light'; }
function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// ============ 音效 / 震动 ============
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  }
  return audioCtx;
}
function playTone(freq, duration, type, volume) {
  var ctx = getAudioCtx();
  if (!ctx) return;
  try {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume || 0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (duration || 0.15));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (duration || 0.15) + 0.02);
  } catch (e) {}
}
function playSound(name) {
  if (!soundEnabled) return;
  if (name === 'play') {
    playTone(660, 0.08, 'triangle', 0.12);
    setTimeout(function(){ playTone(880, 0.1, 'triangle', 0.1); }, 70);
  } else if (name === 'pass') {
    playTone(220, 0.12, 'sine', 0.1);
  } else if (name === 'win') {
    playTone(523, 0.12, 'triangle', 0.12);
    setTimeout(function(){ playTone(659, 0.12, 'triangle', 0.12); }, 120);
    setTimeout(function(){ playTone(784, 0.2, 'triangle', 0.12); }, 240);
  } else if (name === 'click') {
    playTone(440, 0.05, 'square', 0.05);
  } else if (name === 'chat') {
    playTone(880, 0.06, 'sine', 0.08);
  }
}
function vibrate(pattern) {
  if (vibrationEnabled && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch (e) {}
  }
}

function safeRender() {
  try {
    if (typeof game === 'undefined' || !game) return;
    renderBoard();
    var gs = document.getElementById('gameScreen');
    if (gs && gs.style.display !== 'none') renderHand();
  } catch (e) {}
}
const THEME_LABELS = { dark: '暗', light: '亮', system: '随系统' };
function applyTheme(mode) {
  _themeMode = mode;
  try { localStorage.setItem('dingniu-theme', mode); } catch (e) {}
  COLORS = THEME_PALETTES[_resolveTheme()];
  const t = _resolveTheme();
  document.documentElement.setAttribute('data-theme', t);
  ['themeBtn', 'themeBtnStart'].forEach(function (id) {
    var b = document.getElementById(id);
    if (b) b.textContent = '主题：' + (THEME_LABELS[mode] || mode);
  });
  safeRender();
}
function cycleTheme() {
  var order = ['dark', 'light', 'system'];
  var next = order[(order.indexOf(_themeMode) + 1) % order.length];
  applyTheme(next);
}
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    if (_themeMode === 'system') {
      COLORS = THEME_PALETTES[_resolveTheme()];
      document.documentElement.setAttribute('data-theme', _resolveTheme());
      safeRender();
    }
  });
}

// ============ 牌桌静态背景缓存（渐变绒布 + 暗角 + 细金线内边框）============
// 背景是纯静态的，按 主题/尺寸 缓存到离屏 canvas，每帧只 drawImage，保证 60fps。
let gBgCanvas = null;
let gBgTheme = null;
let gBgW = 0, gBgH = 0;
function buildBoardBackground() {
  if (!canvas) return;
  const W = canvas.width, H = canvas.height;
  if (gBgCanvas && gBgTheme === _resolveTheme() && gBgW === W && gBgH === H) return;
  const bg = gBgCanvas || document.createElement('canvas');
  bg.width = W; bg.height = H;
  const b = bg.getContext('2d');
  const cx = W / 2, cy = H / 2;
  const light = isLightTheme();

  // 1) 径向渐变绒布：中央略亮，边缘更深，营造立体台呢
  const g = b.createRadialGradient(cx, cy, Math.min(W, H) * 0.05, cx, cy, Math.max(W, H) * 0.62);
  g.addColorStop(0, COLORS.feltLight);
  g.addColorStop(1, COLORS.felt);
  b.fillStyle = g;
  b.fillRect(0, 0, W, H);

  // 2) 细腻绒布纹理（点状 stipple），极低透明度
  b.save();
  b.globalAlpha = 0.06;
  b.fillStyle = COLORS.feltLight;
  for (let x = 12; x < W; x += 22) {
    for (let y = 12; y < H; y += 22) {
      b.beginPath();
      b.arc(x, y, 1.4, 0, Math.PI * 2);
      b.fill();
    }
  }
  b.restore();

  // 3) 暗角（vignette）
  const vg = b.createRadialGradient(cx, cy, Math.min(W, H) * 0.30, cx, cy, Math.max(W, H) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, light ? 'rgba(20,36,15,0.32)' : 'rgba(0,0,0,0.5)');
  b.fillStyle = vg;
  b.fillRect(0, 0, W, H);

  // 4) 精致内边框（细金线，无发光，干净不花哨）
  b.save();
  b.strokeStyle = light ? 'rgba(156,125,46,0.30)' : 'rgba(232,200,120,0.32)';
  b.lineWidth = 1.5;
  roundRect(b, 20, 20, W - 40, H - 40, 18);
  b.stroke();
  b.restore();

  // 5) 中央「顶牛」水印（极淡，呼应牌桌主题，不抢戏）
  b.save();
  const embA = light ? 0.10 : 0.07;
  b.globalAlpha = embA;
  b.fillStyle = light ? '#3c6347' : '#e8c878';
  b.textAlign = 'center';
  b.textBaseline = 'middle';
  const embFs = Math.round(Math.min(W, H) * 0.14);
  b.font = 'bold ' + embFs + 'px "STKaiti","KaiTi","PingFang SC",serif';
  b.fillText('顶', cx, cy - embFs * 0.56);
  b.fillText('牛', cx, cy + embFs * 0.56);
  b.globalAlpha = embA * 0.8;
  b.strokeStyle = light ? '#3c6347' : '#e8c878';
  b.lineWidth = 2;
  b.beginPath();
  b.arc(cx, cy, Math.min(W, H) * 0.22, 0, Math.PI * 2);
  b.stroke();
  b.restore();

  gBgCanvas = bg; gBgTheme = _resolveTheme(); gBgW = W; gBgH = H;
}

// ============ 轻量动效：出牌飞入 ============
// 仅在新牌追加到链尾时触发，动画期间用 RAF 循环重绘，结束即停止（不常驻 RAF）。
let gFlyAnim = null;
let gAnimRAF = null;
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function getSeatOffset() {
  if (onlineMode) return mySeat >= 0 ? mySeat : 0;
  if (localMode) return game ? game.currentPlayer : 0;
  return 0;
}

// 根据当前视角返回某个座位在桌面上的坐标（0=下、1=右、2=上、3=左）
function getSeatPos(id, W, H) {
  const seats = [
    { x: W / 2, y: H - 30 },
    { x: W - 50, y: H / 2 },
    { x: W / 2, y: 30 },
    { x: 50, y: H / 2 },
  ];
  const offset = getSeatOffset();
  const idx = ((id - offset) % 4 + 4) % 4;
  return seats[idx] || seats[0];
}

function seatPoint(id, W, H) {
  return getSeatPos(id, W, H);
}
function startFlyIn(tile, fromX, fromY, toX, toY, w, h, rot) {
  if (prefersReducedMotion()) return; // 尊重「减少动态效果」无障碍偏好
  gFlyAnim = { tile: tile, fromX: fromX, fromY: fromY, toX: toX, toY: toY, w: w, h: h, rot: rot, start: (window.performance ? performance.now() : Date.now()), dur: 260 };
  if (gAnimRAF) return;
  const step = function () {
    if (!gFlyAnim) { gAnimRAF = null; return; }
    const now = window.performance ? performance.now() : Date.now();
    const t = (now - gFlyAnim.start) / gFlyAnim.dur;
    if (t >= 1) {
      gFlyAnim = null; gAnimRAF = null;
      safeRender();
      return;
    }
    safeRender();
    gAnimRAF = requestAnimationFrame(step);
  };
  gAnimRAF = requestAnimationFrame(step);
}

// ============ 图片加载 ============
function preloadImages(callback) {
  const keys = Object.keys(TILE_TYPES);
  let loaded = 0;
  const total = keys.length;

  if (total === 0) {
    if (callback) callback();
    return;
  }

  for (const key of keys) {
    const def = TILE_TYPES[key];
    const img = new Image();
    img.onload = function() {
      loaded++;
      if (loaded >= total && callback) callback();
    };
    img.onerror = function() {
      loaded++;
      if (loaded >= total && callback) callback();
    };
    img.src = 'assets/' + def.img;
    tileImages[key] = img;
  }
}

// ============ 摇色子定头牌 ============
let diceRolled = false;
let diceValue1 = 0;
let diceValue2 = 0;
let diceDealerIndex = -1;

// 色子点数对应的圆点布局
const DICE_DOTS = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

function renderDiceFace(faceEl, value) {
  var dots = DICE_DOTS[value] || [];
  faceEl.innerHTML = '';
  for (var i = 0; i < dots.length; i++) {
    var dot = document.createElement('div');
    dot.className = 'dice-dot';
    dot.style.left = (50 + dots[i][0] * 28) + '%';
    dot.style.top = (50 + dots[i][1] * 28) + '%';
    faceEl.appendChild(dot);
  }
}

function rollDice() {
  var btn = document.getElementById('rollBtn');
  btn.disabled = true;
  btn.textContent = '摇动中...';

  var face1 = document.getElementById('diceFace1');
  var face2 = document.getElementById('diceFace2');
  var dice1El = document.getElementById('dice1');
  var dice2El = document.getElementById('dice2');

  // 动画：快速切换随机点数
  var frames = 0;
  var maxFrames = 12;
  var interval = setInterval(function() {
    var v1 = Math.floor(Math.random() * 6) + 1;
    var v2 = Math.floor(Math.random() * 6) + 1;
    renderDiceFace(face1, v1);
    renderDiceFace(face2, v2);
    frames++;
    if (frames >= maxFrames) {
      clearInterval(interval);
      // 最终结果
      diceValue1 = Math.floor(Math.random() * 6) + 1;
      diceValue2 = Math.floor(Math.random() * 6) + 1;
      renderDiceFace(face1, diceValue1);
      renderDiceFace(face2, diceValue2);

      var total = diceValue1 + diceValue2;
      // 从摇色人开始算1，顺时针
      var rollerIndex = (game && game.lastWinner >= 0) ? game.lastWinner : 0;
      diceDealerIndex = (rollerIndex + total - 1) % 4;

      var dealerNames = localMode
        ? ['玩家1（东家）', '玩家2（下家）', '玩家3（对家）', '玩家4（上家）']
        : ['你（东家）', '对手A（下家）', '对手B（对家）', '对手C（上家）'];
      var rollerName = game ? game.players[rollerIndex].name : (localMode ? '玩家1' : '你');

      document.getElementById('diceSumDisplay').innerHTML =
        '点数：<strong>' + diceValue1 + ' + ' + diceValue2 + ' = ' + total + '</strong>';
      document.getElementById('diceResultDisplay').innerHTML =
        '<span class="dice-result-text">' + rollerName + ' 摇出 <strong>' + total + '</strong> → 头牌：<strong>' + dealerNames[diceDealerIndex] + '</strong> 先出</span>';

      diceRolled = true;
      btn.style.display = 'none';
      document.getElementById('startPlayBtn').style.display = 'inline-block';
    }
  }, 80);
}

// ============ 最小大厅 ============
function enterGame(gameName) {
  if (gameName === 'mahjong') {
    alert('麻将玩法开发中，敬请期待！');
    return;
  }
  if (gameName === 'dingniu') {
    document.getElementById('lobbyScreen').style.display = 'none';
    document.getElementById('startScreen').style.display = 'flex';
  }
}

function backToLobby() {
  // 关闭可能存在的联机连接和弹窗
  if (ws) {
    try { ws.close(); } catch (e) {}
    ws = null;
  }
  onlineMode = false;
  localMode = false;
  localReady = false;
  mySeat = -1;
  roomCode = '';
  onlineState = null;
  chatVisible = false;
  var chatPanel = document.getElementById('chatPanel');
  if (chatPanel) chatPanel.style.display = 'none';
  var roomControl = document.getElementById('roomControlBox');
  if (roomControl) roomControl.style.display = 'none';
  document.getElementById('settleModal').classList.remove('active');
  document.getElementById('settingsPanel').classList.remove('active');
  var passOverlay = document.getElementById('passDeviceOverlay');
  if (passOverlay) passOverlay.classList.remove('active');
  document.getElementById('gameScreen').style.display = 'none';
  document.getElementById('diceScreen').style.display = 'none';
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('lobbyScreen').style.display = 'flex';
  game = null;
}

function showDiceRoll() {
  // 同步当前选择的模式（本地多人/人机）
  var modeEl = document.getElementById('gameMode');
  localMode = modeEl ? modeEl.value === 'local' : false;

  // 隐藏其他界面
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('gameScreen').style.display = 'none';
  document.getElementById('settleModal').classList.remove('active');

  // 显示色子界面
  document.getElementById('diceScreen').style.display = 'flex';

  // 重置状态
  diceRolled = false;
  diceValue1 = 0;
  diceValue2 = 0;
  diceDealerIndex = -1;
  document.getElementById('diceSumDisplay').innerHTML = '';
  document.getElementById('diceResultDisplay').innerHTML = '';
  document.getElementById('diceFace1').innerHTML = '';
  document.getElementById('diceFace2').innerHTML = '';

  // 显示谁摇色子：上一局赢家摇，第一局玩家摇
  var rollerName = localMode ? '玩家1' : '你';
  if (game && game.lastWinner !== undefined && game.lastWinner >= 0) {
    rollerName = game.players[game.lastWinner].name;
  }
  var hintEl = document.querySelector('.dice-hint');
  if (hintEl) {
    hintEl.innerHTML = '上一局赢家 <strong>' + rollerName + '</strong> 摇色子，点数决定谁先出牌';
  }

  var btn = document.getElementById('rollBtn');
  btn.style.display = 'none'; // 自动摇，不显示手动按钮
  btn.disabled = false;
  btn.textContent = '🎲 摇色子';
  document.getElementById('startPlayBtn').style.display = 'none';

  // 自动摇色子（600ms 延迟，让玩家看到是谁在摇）
  setTimeout(function() {
    rollDice();
  }, 600);
}

function startGameWithDealer() {
  document.getElementById('diceScreen').style.display = 'none';
  document.getElementById('gameScreen').style.display = 'flex';

  var modeEl = document.getElementById('gameMode');
  localMode = modeEl ? modeEl.value === 'local' : false;

  if (!game) {
    // 第一局：先创建游戏、预加载图片，再发牌
    game = new DingNiuGame();
    var savedRules = localStorage.getItem('dingniu_rules');
    if (savedRules) game.loadRules(JSON.parse(savedRules));

    if (localMode) {
      setupLocalGame(game);
    } else {
      var aiLevelEl = document.getElementById('aiLevel');
      var aiLevel = aiLevelEl ? aiLevelEl.value : 'medium';
      setAIDifficulty(game, aiLevel);
    }

    // 设置庄家
    if (diceDealerIndex >= 0) game.dealerIndex = diceDealerIndex;

    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    resizeCanvas();

    preloadImages(function() {
      game.dealCards();
      selectedTileId = null;
      selectedEnd = null;
      passTileId = null;
      localReady = false;
      refreshAll();
      if (localMode) {
        showPassDeviceOverlay();
      } else {
        triggerAIIfNeeded();
      }
    });
  } else {
    // 后续局：图片已加载，直接用色子结果更新庄家
    game.startNewRound(diceDealerIndex);

    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    resizeCanvas();

    selectedTileId = null;
    selectedEnd = null;
    passTileId = null;
    localReady = false;
    refreshAll();
    if (localMode) {
      showPassDeviceOverlay();
    } else {
      triggerAIIfNeeded();
    }
  }
}

function setAIDifficulty(gameObj, level) {
  for (let i = 1; i < 4; i++) {
    if (level === 'easy') {
      gameObj.players[i].role = 'ai_easy';
    } else if (level === 'hard') {
      gameObj.players[i].role = 'ai_hard';
    } else {
      gameObj.players[i].role = i === 1 ? 'ai_medium' : 'ai_easy';
    }
  }
}

// ============ 本地多人（同设备轮流） ============
function toggleGameMode() {
  var modeEl = document.getElementById('gameMode');
  var mode = modeEl ? modeEl.value : 'ai';
  var row = document.getElementById('aiLevelRow');
  var onlinePanel = document.getElementById('onlinePanel');
  var menuButtons = document.getElementById('menuButtons');
  if (row) row.style.display = mode === 'local' || mode === 'online' ? 'none' : '';
  if (onlinePanel) onlinePanel.style.display = mode === 'online' ? '' : 'none';
  if (menuButtons) menuButtons.style.display = mode === 'online' ? 'none' : '';
  if (mode === 'online') {
    setTimeout(function() { connectToServer(); }, 50);
  }
}

function setupLocalGame(gameObj) {
  var names = ['玩家1', '玩家2', '玩家3', '玩家4'];
  for (var i = 0; i < 4; i++) {
    gameObj.players[i].name = names[i];
    gameObj.players[i].role = 'human';
  }
}

function activeHumanIndex() {
  if (!game) return -1;
  if (onlineMode) return mySeat;
  if (localMode) return game.currentPlayer;
  return game.currentPlayer === 0 ? 0 : -1;
}

function activePlayerId() {
  if (onlineMode) return mySeat;
  if (localMode) return game ? game.currentPlayer : 0;
  return 0;
}

// 结算等场景中标记“哪个是我”
function isMeSeat(i) {
  if (onlineMode) return i === mySeat;
  if (localMode) {
    var w = game && game.lastWinner !== undefined && game.lastWinner >= 0 ? game.lastWinner : (game ? game.currentPlayer : 0);
    return i === w;
  }
  return i === 0;
}

function canLocalAct() {
  if (!game || game.phase !== 'playing') return false;
  var idx = activeHumanIndex();
  if (idx < 0) return false;
  if (onlineMode) {
    var op = game.players[idx];
    // 必须同时满足：轮到这个玩家，且该玩家有手牌可操作
    return game.currentPlayer === idx && op && op.role === 'human' && !op.isOut && op.hand.length > 0;
  }
  if (localMode && !localReady) return false;
  var p = game.players[idx];
  return p && p.role === 'human' && !p.isOut && p.hand.length > 0;
}

function showPassDeviceOverlay() {
  if (!localMode || !game || game.phase !== 'playing') return;
  var overlay = document.getElementById('passDeviceOverlay');
  if (!overlay) return;
  var cp = game.players[game.currentPlayer];
  if (!cp || cp.isOut || cp.hand.length === 0) return;
  var titleEl = document.getElementById('passDeviceTitle');
  var btnEl = document.getElementById('passDeviceBtn');
  if (titleEl) titleEl.textContent = '请把手机交给 ' + cp.name;
  if (btnEl) btnEl.textContent = '我是' + cp.name + '，开始';
  overlay.classList.add('active');
}

function localPlayerReady() {
  localReady = true;
  var overlay = document.getElementById('passDeviceOverlay');
  if (overlay) overlay.classList.remove('active');
  refreshAll();
}

// ============ 在线/局域网联机 ============
function getClientId() {
  // 用 sessionStorage：每个标签页独立，但刷新页面后保持不变
  // 避免同一浏览器开两个标签页测试时被当成同一个人
  try {
    var id = sessionStorage.getItem('dingniu_client_id');
    if (!id) {
      id = 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('dingniu_client_id', id);
    }
    return id;
  } catch (e) {
    return 'c' + Math.random().toString(36).slice(2);
  }
}

function autoServerAddr() {
  if (typeof location !== 'undefined' && location.host) {
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  }
  return 'ws://localhost:3000';
}

function onlineSetStatus(text, isError) {
  var el = document.getElementById('onlineStatus');
  if (!el) return;
  el.textContent = text;
  el.className = 'online-status' + (isError ? ' error' : ' ok');
}

function resetOnlineRoomUI() {
  var roomControl = document.getElementById('roomControlBox');
  if (roomControl) roomControl.style.display = 'none';
  var roomList = document.getElementById('roomListContainer');
  if (roomList) roomList.innerHTML = '<div class="room-empty">暂无等待中的房间</div>';
  onlineMode = false;
  mySeat = -1;
  roomCode = '';
  onlineState = null;
  roomRules = null;
  roomTargetRounds = 0;
}

function connectToServer() {
  var addr = (document.getElementById('serverAddr').value || '').trim() || autoServerAddr();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'listRooms', clientId: getClientId() }));
    return;
  }
  onlineConnect(addr, { type: 'listRooms', clientId: getClientId() });
}

function leaveRoom() {
  if (ws) {
    try { ws.close(); } catch (e) {}
    ws = null;
  }
  resetOnlineRoomUI();
  onlineSetStatus('已退出房间', false);
}

// ============ 大厅房间列表 ============
function onlineRefreshRooms() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    onlineSetStatus('正在连接服务器...', false);
    connectToServer();
    return;
  }
  ws.send(JSON.stringify({ type: 'listRooms' }));
}

function renderRoomList(list) {
  roomList = list || [];
  var container = document.getElementById('roomListContainer');
  if (!container) return;
  if (roomList.length === 0) {
    container.innerHTML = '<div class="room-empty">暂无等待中的房间</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < roomList.length; i++) {
    var r = roomList[i];
    html += '<div class="room-item">' +
      '<span class="room-code">' + r.code + '</span>' +
      '<span class="room-meta">' + (r.gameType === 'mahjong' ? '麻将' : '顶牛') + ' · ' + r.host + ' · ' + r.players + '/4 · ' + (r.targetRounds > 0 ? r.targetRounds + '局' : '不限') + '</span>' +
      '<button onclick="onlineJoinRoom(\'' + r.code + '\')">加入</button>' +
      '<button onclick="onlineSpectateRoom(\'' + r.code + '\')">观战</button>' +
      '</div>';
  }
  container.innerHTML = html;
}

function onlineJoinRoom(code) {
  document.getElementById('roomCodeInput').value = code;
  onlineJoin();
}

function onlineSpectateRoom(code) {
  document.getElementById('roomCodeInput').value = code;
  onlineSpectate();
}

function onlineSpectate() {
  var code = (document.getElementById('roomCodeInput').value || '').trim().toUpperCase();
  if (!code) {
    onlineSetStatus('请输入要观战的房间码', true);
    return;
  }
  var name = (document.getElementById('onlineName').value || '').trim();
  var msg = { type: 'spectate', room: code, name: name, clientId: getClientId() };
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    return;
  }
  var addr = (document.getElementById('serverAddr').value || '').trim() || autoServerAddr();
  onlineConnect(addr, msg);
}

// ============ 房间内准备/开始/踢人/解散 ============
function renderRoomControl(players, rules, targetRounds, isHost) {
  var box = document.getElementById('roomControlBox');
  if (!box) return;
  box.style.display = 'block';
  document.getElementById('roomCodeLabel').textContent = roomCode;

  var container = document.getElementById('roomPlayersContainer');
  var html = '';
  for (var i = 0; i < 4; i++) {
    var p = players[i];
    if (!p) {
      html += '<div class="room-player-row"><span class="player-name">等待加入...</span><span class="player-ready not-ready">-</span></div>';
    } else {
      var readyText = p.ready ? '已准备' : '未准备';
      var readyCls = p.ready ? 'ready' : 'not-ready';
      var kickBtn = (isHost && i !== 0 && !roomStartedByState()) ? '<button onclick="onlineKick(' + i + ')">踢出</button>' : '';
      html += '<div class="room-player-row">' +
        '<span class="player-name">' + (i === mySeat ? '你·' : '') + p.name + (p.connected ? '' : '（掉线）') + '</span>' +
        '<span class="player-ready ' + readyCls + '">' + readyText + '</span>' +
        kickBtn +
        '</div>';
    }
  }
  container.innerHTML = html;

  var readyBtn = document.getElementById('readyBtn');
  if (readyBtn) {
    var me = players[mySeat];
    readyBtn.textContent = me && me.ready ? '取消准备' : '准备';
  }
  var startBtn = document.getElementById('startGameBtn');
  if (startBtn) startBtn.style.display = isHost ? 'inline-block' : 'none';
  var dismissBtn = document.getElementById('dismissRoomBtn');
  if (dismissBtn) dismissBtn.style.display = isHost ? 'inline-block' : 'none';

  // 同步规则表单（仅房主可编辑由服务端决定，这里先按 isHost 禁用）
  applyOnlineRulesToForm(rules || {}, isHost);
  var roundsEl = document.getElementById('onlineTargetRounds');
  if (roundsEl) roundsEl.value = String(targetRounds || 0);
}

function roomStartedByState() {
  return onlineState && onlineState.phase ? true : false;
}

function onlineToggleReady() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'ready' }));
}

function onlineStartGame() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'start' }));
}

function onlineDismissRoom() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (confirm('确定解散房间吗？')) {
    ws.send(JSON.stringify({ type: 'dismiss' }));
  }
}

function onlineKick(seat) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'kick', seat: seat }));
}

function copyInviteLink() {
  if (!roomCode) return;
  var url = location.origin + '/?room=' + roomCode;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(function() {
      onlineSetStatus('邀请链接已复制', false);
    }).catch(function() {
      prompt('复制邀请链接', url);
    });
  } else {
    prompt('复制邀请链接', url);
  }
}

// ============ 规则预设 ============
function applyOnlinePreset() {
  var preset = document.getElementById('onlinePreset').value;
  var scoring = document.getElementById('onlineScoringMode');
  var pao = document.getElementById('onlinePaoHong');
  var suan = document.getElementById('onlineSuanZhang');
  var menWu = document.getElementById('onlineMenWuZhang');
  if (!scoring || !pao || !suan) return;
  if (preset === 'classic') {
    scoring.value = 'fixed';
    pao.checked = true;
    suan.checked = true;
    if (menWu) menWu.checked = false;
  } else if (preset === 'multiplier') {
    scoring.value = 'multiplier';
    pao.checked = true;
    suan.checked = true;
    if (menWu) menWu.checked = false;
  } else if (preset === 'custom') {
    // 保持当前选择
  }
}

// ============ 聊天 ============
function toggleChat() {
  chatVisible = !chatVisible;
  var panel = document.getElementById('chatPanel');
  if (panel) panel.style.display = chatVisible ? 'flex' : 'none';
}

function sendChat(text) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'chat', text: text }));
  var input = document.getElementById('chatInput');
  if (input) input.value = '';
}

function sendChatFromInput() {
  var input = document.getElementById('chatInput');
  if (!input) return;
  var text = input.value.trim();
  if (text) sendChat(text);
}

function appendChat(msg) {
  playSound('chat');
  var container = document.getElementById('chatMessages');
  if (!container) return;
  var div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = '<span class="chat-name">' + msg.name + ':</span>' + escapeHtml(msg.text);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function showTournamentEnd(msg) {
  var players = (msg.players || []).slice().sort(function(a, b) { return (b.score || 0) - (a.score || 0); });
  var lines = players.map(function(p, i) { return (i + 1) + '. ' + p.name + '  ' + (p.score >= 0 ? '+' : '') + p.score + ' 分'; });
  alert('🏆 比赛结束\n\n' + lines.join('\n'));
}

// ============ PWA 提示条 ============
function showNetBanner(name, show) {
  var map = { offline: 'offlineBanner', update: 'updateBanner', install: 'installBanner' };
  var el = document.getElementById(map[name]);
  if (el) el.style.display = show ? 'block' : 'none';
}

function dismissInstallBanner() {
  showNetBanner('install', false);
  try {
    localStorage.setItem('dingniu_install_dismissed', '1');
  } catch (e) {}
}

function onlineCreate() {
  var name = (document.getElementById('onlineName').value || '').trim();
  var msg = { type: 'create', name: name, clientId: getClientId() };
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    return;
  }
  var addr = (document.getElementById('serverAddr').value || '').trim() || autoServerAddr();
  onlineConnect(addr, msg);
}

function onlineJoin() {
  var name = (document.getElementById('onlineName').value || '').trim();
  var addr = (document.getElementById('serverAddr').value || '').trim() || autoServerAddr();
  var code = (document.getElementById('roomCodeInput').value || '').trim().toUpperCase();
  if (!code) {
    onlineSetStatus('请输入房间码', true);
    return;
  }
  var msg = { type: 'join', room: code, name: name, clientId: getClientId() };
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    return;
  }
  onlineConnect(addr, msg);
}

function onlineConnect(addr, msg) {
  if (ws) {
    try { ws.close(); } catch (e) {}
    ws = null;
  }
  onlineSetStatus('连接中...', false);
  var socket;
  try {
    socket = new WebSocket(addr);
  } catch (e) {
    onlineSetStatus('无法连接：' + e.message, true);
    return;
  }
  ws = socket;

  socket.onopen = function() {
    socket.send(JSON.stringify(msg));
  };
  socket.onmessage = function(ev) {
    var data;
    try {
      data = JSON.parse(ev.data);
    } catch (e) {
      return;
    }
    handleServerMessage(data);
  };
  socket.onclose = function() {
    // 只清理“当前这个 socket”，避免旧连接的 close 误伤新连接
    if (ws === socket) {
      ws = null;
      if (onlineMode) {
        onlineSetStatus('连接已断开', true);
        var startScreen = document.getElementById('startScreen');
        if (startScreen && startScreen.style.display !== 'none') {
          resetOnlineRoomUI();
        }
      }
    }
  };
  socket.onerror = function() {
    if (ws === socket) {
      onlineSetStatus('连接错误', true);
    }
  };
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'created':
    case 'joined':
    case 'reconnected':
      onlineMode = true;
      mySeat = msg.seat;
      roomCode = msg.room;
      var roomInput = document.getElementById('roomCodeInput');
      if (roomInput) roomInput.value = roomCode;
      if (msg.token) {
        try {
          localStorage.setItem('dingniu_online_token_' + roomCode, msg.token);
          localStorage.setItem('dingniu_online_addr', document.getElementById('serverAddr') ? document.getElementById('serverAddr').value.trim() : '');
        } catch (e) {}
      }
      if (msg.rules) roomRules = msg.rules;
      if (msg.targetRounds !== undefined) roomTargetRounds = msg.targetRounds;
      if (msg.rules) applyOnlineRulesToForm(msg.rules, !!msg.isHost);
      renderRoomControl(msg.players || [], roomRules, roomTargetRounds, !!msg.isHost);
      var count = (msg.players || []).filter(Boolean).length;
      onlineSetStatus('已进入房间 ' + roomCode + '，等待其他玩家...（' + count + '/4）', false);
      updateReconnectButton();
      onlineRefreshRooms();
      break;
    case 'spectating':
      onlineMode = true;
      mySeat = -1;
      roomCode = msg.room;
      onlineSetStatus('正在观战房间 ' + roomCode, false);
      var chatBtn = document.getElementById('chatToggleBtn');
      if (chatBtn) chatBtn.style.display = 'inline-block';
      break;
    case 'roomList':
      renderRoomList(msg.rooms || []);
      break;
    case 'roomUpdate':
      if (msg.rules) roomRules = msg.rules;
      if (msg.targetRounds !== undefined) roomTargetRounds = msg.targetRounds;
      if (msg.players) renderRoomControl(msg.players, roomRules, roomTargetRounds, mySeat === 0);
      var c2 = (msg.players || []).filter(Boolean).length;
      onlineSetStatus('房间 ' + roomCode + '，玩家 ' + c2 + '/4', false);
      break;
    case 'playerJoined':
      var c3 = (msg.players || []).filter(Boolean).length;
      onlineSetStatus('房间 ' + roomCode + '，玩家 ' + c3 + '/4', false);
      if (msg.players) renderRoomControl(msg.players, roomRules, roomTargetRounds, mySeat === 0);
      break;
    case 'playerLeft':
      var c4 = (msg.players || []).filter(Boolean).length;
      onlineSetStatus('有玩家离开，当前 ' + c4 + '/4', true);
      if (msg.players) renderRoomControl(msg.players, roomRules, roomTargetRounds, mySeat === 0);
      break;
    case 'roomUpdated':
      if (msg.rules) roomRules = msg.rules;
      if (msg.targetRounds !== undefined) roomTargetRounds = msg.targetRounds;
      if (msg.rules) applyOnlineRulesToForm(msg.rules, mySeat === 0);
      if (msg.players) renderRoomControl(msg.players, roomRules, roomTargetRounds, mySeat === 0);
      onlineSetStatus('房主已更新房间规则', false);
      break;
    case 'chat':
      appendChat(msg);
      break;
    case 'tournamentEnd':
      showTournamentEnd(msg);
      break;
    case 'state':
      applyOnlineState(msg.state, msg.message || '');
      break;
    case 'error':
      onlineSetStatus(msg.message, true);
      alert(msg.message);
      // 房间已不存在/被解散时，清掉当前房间面板
      if (/房间不存在|不在房间中|已解散|房间已满/.test(msg.message || '')) {
        resetOnlineRoomUI();
      }
      break;
    default:
      break;
  }
}

function applyOnlineState(state, message) {
  if (!state) return;
  var prevChainLen = onlineState && onlineState.chain ? onlineState.chain.length : -1;
  var prevPhase = onlineState ? onlineState.phase : '';
  onlineState = state;
  game = state;
  if (typeof state.seat === 'number') mySeat = state.seat;
  onlinePlayable = state.playable || [];
  onlineLockedIds = state.lockedTileIds || [];
  onlineHasPlayable = !!state.hasPlayable;
  onlineSettleResult = state.settleResult || null;

  // 根据状态变化播放音效/震动
  if (state.phase === 'playing' && prevChainLen >= 0 && state.chain && state.chain.length > prevChainLen) {
    playSound('play');
    vibrate(20);
  } else if (state.phase === 'settling' && state.settleResult && prevPhase !== 'settling') {
    playSound('win');
    vibrate([50, 50, 50]);
  }

  // 进入/保持游戏界面
  document.getElementById('lobbyScreen').style.display = 'none';
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('diceScreen').style.display = 'none';
  document.getElementById('gameScreen').style.display = 'flex';

  var roomControl = document.getElementById('roomControlBox');
  if (roomControl) roomControl.style.display = 'none';
  var chatBtn = document.getElementById('chatToggleBtn');
  if (chatBtn) chatBtn.style.display = onlineMode ? 'inline-block' : 'none';

  var passOverlay = document.getElementById('passDeviceOverlay');
  if (passOverlay) passOverlay.classList.remove('active');
  var settleModal = document.getElementById('settleModal');
  if (settleModal) settleModal.classList.remove('active');

  selectedTileId = null;
  selectedEnd = null;
  passTileId = null;
  localReady = false;

  refreshAll();
  // 联机进入对局后重新计算画布尺寸（否则会沿用隐藏状态的窄画布）
  setTimeout(function() { resizeCanvas(); }, 50);

  if (state.phase === 'settling' && state.settleResult) {
    showSettleModal(state.settleResult);
  }
  if (message) {
    // 可选：在日志区/状态区显示服务端消息
    var logArea = document.getElementById('logArea');
    if (logArea && message) {
      var div = document.createElement('div');
      div.className = 'log-entry';
      div.textContent = message;
      logArea.appendChild(div);
      logArea.scrollTop = logArea.scrollHeight;
    }
  }
}

function onlineSendAction(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert('连接已断开，无法操作');
    return;
  }
  ws.send(JSON.stringify({ type: 'action', ...payload }));
}

function onlineNextRound() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert('连接已断开');
    return;
  }
  ws.send(JSON.stringify({ type: 'nextRound' }));
}

function handleNextRoundClick() {
  if (onlineMode) {
    onlineNextRound();
  } else {
    showDiceRoll();
  }
}

function disconnectOnline() {
  if (ws) {
    try { ws.close(); } catch (e) {}
    ws = null;
  }
  onlineMode = false;
  mySeat = -1;
  roomCode = '';
  onlineState = null;
  onlinePlayable = [];
  onlineLockedIds = [];
  onlineHasPlayable = false;
  onlineSettleResult = null;
  roomRules = null;
  roomTargetRounds = 0;
}

function applyOnlineRulesToForm(rules, isHost) {
  var scoringEl = document.getElementById('onlineScoringMode');
  var paoEl = document.getElementById('onlinePaoHong');
  var suanEl = document.getElementById('onlineSuanZhang');
  var menWuEl = document.getElementById('onlineMenWuZhang');
  if (scoringEl) scoringEl.value = rules && rules.scoringMode === 'multiplier' ? 'multiplier' : 'fixed';
  if (paoEl) paoEl.checked = !rules || rules.enablePaoHong !== false;
  if (suanEl) suanEl.checked = !rules || rules.enableSuanZhang !== false;
  if (menWuEl) menWuEl.checked = !!(rules && rules.enableMenWuZhang);
  var box = document.getElementById('onlineRulesBox');
  if (box) {
    var inputs = box.querySelectorAll('select, input');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].disabled = !isHost;
    }
  }
}

function updateReconnectButton() {
  var btn = document.getElementById('reconnectBtn');
  if (!btn) return;
  var hasToken = false;
  try {
    hasToken = !!localStorage.getItem('dingniu_online_token_' + (roomCode || ''));
  } catch (e) {}
  btn.style.display = hasToken ? '' : 'none';
}

function onlineReconnect() {
  if (!roomCode) {
    // 从本地读取上次房间
    var savedAddr = '';
    var savedRoom = '';
    try {
      savedAddr = localStorage.getItem('dingniu_online_addr') || '';
      // 尝试从 token key 推断房间码
      var keys = Object.keys(localStorage).filter(k => k.indexOf('dingniu_online_token_') === 0);
      if (keys.length > 0) savedRoom = keys[0].replace('dingniu_online_token_', '');
    } catch (e) {}
    if (!savedRoom) {
      onlineSetStatus('没有可重连的房间', true);
      return;
    }
    roomCode = savedRoom;
    if (document.getElementById('serverAddr')) {
      document.getElementById('serverAddr').value = savedAddr || document.getElementById('serverAddr').value;
    }
  }
  var token = '';
  try {
    token = localStorage.getItem('dingniu_online_token_' + roomCode) || '';
  } catch (e) {}
  if (!token) {
    onlineSetStatus('缺少重连凭证', true);
    return;
  }
  var addr = (document.getElementById('serverAddr').value || '').trim() || autoServerAddr();
  onlineConnect(addr, { type: 'reconnect', room: roomCode, token: token, name: (document.getElementById('onlineName').value || '').trim(), clientId: getClientId() });
}

function onlineUpdateRules() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    onlineSetStatus('连接已断开', true);
    return;
  }
  if (mySeat !== 0) {
    onlineSetStatus('只有房主可以修改规则', true);
    return;
  }
  var rules = {
    scoringMode: document.getElementById('onlineScoringMode').value,
    enablePaoHong: document.getElementById('onlinePaoHong').checked,
    enableSuanZhang: document.getElementById('onlineSuanZhang').checked,
    enableMenWuZhang: !!document.getElementById('onlineMenWuZhang').checked,
  };
  var targetRounds = parseInt(document.getElementById('onlineTargetRounds').value, 10) || 0;
  rules.targetRounds = targetRounds;
  ws.send(JSON.stringify({ type: 'updateRules', rules: rules }));
}

// ============ 核心调度 ============
function afterAction() {
  try {
    // 检查游戏是否应该结束
    if (checkRoundShouldEnd()) {
      finishRound();
      return;
    }

    // 切换到下一个有效的玩家（未净手且有手牌）
    let next = (game.currentPlayer + 3) % 4;
    let safety = 0;
    let skippedHard = 0; // 因"拉三家"硬牌被跳过的次数（仅首圈）
    while (safety < 4) {
      var p = game.players[next];
      // 跳过已出局的玩家和手牌为空的玩家
      if (!p || p.isOut || p.hand.length === 0) {
        next = (next + 3) % 4;
        safety++;
        continue;
      }
      // 首圈无人出牌：若首手全是"拉三家"硬牌，跳过该玩家，让下家先出
      if (game.chain.length === 0 && !game.canLead(next)) {
        next = (next + 3) % 4;
        safety++;
        skippedHard++;
        continue;
      }
      break;
    }
    if (safety >= 4) {
      if (skippedHard > 0) {
        // 极端情况：所有人都因硬牌被跳过 → 强制让首个有手牌者先出（解除硬牌限制）
        let f = (game.currentPlayer + 3) % 4;
        for (let k = 0; k < 4; k++) {
          if (game.players[f] && !game.players[f].isOut && game.players[f].hand.length > 0) {
            next = f;
            break;
          }
          f = (f + 3) % 4;
        }
      } else {
        // 没有有效玩家了，结算
        finishRound();
        return;
      }
    }
    game.currentPlayer = next;

    // 本地多人：先进入“未准备”状态再刷新，避免把下一个人的手牌提前画出来
    if (localMode) {
      localReady = false;
    }
    refreshAll();
    if (localMode) {
      showPassDeviceOverlay();
    } else {
      triggerAIIfNeeded();
    }
  } catch (e) {
    console.error('afterAction error:', e);
    try { finishRound(); } catch (e2) { console.error('finishRound error:', e2); }
  }
}

// 检查本局是否应该结束
// 结束条件：所有未净手玩家中，无人能出牌（全部已扣牌，或所有人都净手，或手牌全部出完/扣完）
function checkRoundShouldEnd() {
  if (!game || !game.players) return true;
  const activePlayers = game.players.filter(p => p && !p.isOut);
  // 所有人都净手了
  if (activePlayers.length === 0) return true;
  // 所有活跃玩家手牌为空（全部出完或扣完）
  const allEmpty = activePlayers.every(p => p && p.hand.length === 0);
  if (allEmpty) return true;
  // 所有活跃玩家都扣牌了（无人可出）
  const allPassed = activePlayers.every(p => p && p.passed);
  if (allPassed) return true;
  // 连续4次扣牌（所有人依次扣过一轮）
  if (game.passesInRow >= 4) return true;
  return false;
}

function triggerAIIfNeeded() {
  if (game.phase !== 'playing') return;

  const player = game.players[game.currentPlayer];
  if (player.role !== 'human' && !player.isOut) {
    setTimeout(function() {
      if (game.phase !== 'playing') return;
      doAITurn(game.currentPlayer);
    }, 800);
  }
}

// ============ AI 出牌 ============
function doAITurn(playerIndex) {
  if (game.phase !== 'playing') return;

  const player = game.players[playerIndex];
  if (player.isOut || player.role === 'human' || player.hand.length === 0) return;

  let action;
  if (player.role === 'ai_hard') {
    action = AIPlayer.hardPlay(game, playerIndex);
  } else if (player.role === 'ai_medium') {
    action = AIPlayer.mediumPlay(game, playerIndex);
  } else {
    action = AIPlayer.easyPlay(game, playerIndex);
  }

  if (action.action === 'play') {
    const result = game.playTile(playerIndex, action.tileId, action.chosenEnd, action.side);
    if (!result.success) {
      // 出牌失败，如果是硬牌规则，重新选一张合法的牌
      if (game.chain.length === 0) {
        const playable = game.getPlayableTiles(playerIndex);
        const validChoice = playable.find(p => !game.isYingPaiViolation(playerIndex, p.tile));
        if (validChoice) {
          const end = validChoice.playableEnds[0];
          const retryResult = game.playTile(playerIndex, validChoice.tile.id, end.end, end.side);
          if (retryResult.success) {
            // 重试成功，走正常出牌流程（净手与否都要检测算账）
            game.checkPaoHong(playerIndex);
            var suanZhangRetry = game.checkSuanZhang(playerIndex);
            if (suanZhangRetry.isSuanZhang) {
              handleSuanZhang(suanZhangRetry);
              return;
            }
            if (retryResult.isOut) {
              if (checkRoundShouldEnd()) {
                setTimeout(function() { finishRound(); }, 600);
                return;
              }
            }
            afterAction();
            return;
          }
        }
      }
      // 非硬牌或重试也失败，尝试扣牌
      const hand = game.players[playerIndex].hand;
      if (hand.length > 0) {
        const passTile = hand[Math.floor(Math.random() * hand.length)];
        game.passTurn(playerIndex, passTile.id);
      }
    } else if (!result.isOut) {
      // 出牌成功且未净手，检测跑红
      game.checkPaoHong(playerIndex);
      // 检查是否触发算账
      const suanZhang = game.checkSuanZhang(playerIndex);
      if (suanZhang.isSuanZhang) {
        handleSuanZhang(suanZhang);
        return;
      }
    } else if (result.isOut) {
      // AI 净手，也要检测算账（净手时最后一张牌可能触发算账，如红帐）
      game.checkPaoHong(playerIndex);
      const suanZhangOnOut = game.checkSuanZhang(playerIndex);
      if (suanZhangOnOut.isSuanZhang) {
        handleSuanZhang(suanZhangOnOut);
        return;
      }
      // 检查是否所有人都结束了
      if (checkRoundShouldEnd()) {
        setTimeout(function() { finishRound(); }, 600);
        return;
      }
    }
  } else if (action.action === 'pass') {
    game.passTurn(playerIndex, action.tileId);
  }

  afterAction();
}

// 处理算账：如果有自动出牌，先自动出，然后结算
function handleSuanZhang(suanZhangInfo) {
  refreshAll();

  const autoPlayList = suanZhangInfo.autoPlayList;
  const starterIndex = suanZhangInfo.starter || 0;

  setTimeout(function() {
    // 第1步：自动出算账solution牌（红帐出红八，一帐出地幺等）
    if (autoPlayList && autoPlayList.length > 0) {
      game.autoPlayAllSuanZhangTiles(autoPlayList);
      refreshAll();
    }

    // 第2步：迭代式自动出所有能接上桌面的牌（解决砸红帐等场景中能出的牌没出的问题）
    const sweepCount = game.sweepPlayAllPlayable(starterIndex);

    if (sweepCount > 0 || (autoPlayList && autoPlayList.length > 0)) {
      // 有牌自动出了，刷新界面让玩家看到
      refreshAll();
      setTimeout(function() {
        finishRound();
      }, 600);
    } else {
      // 没有牌能自动出，直接结算
      finishRound();
    }
  }, 600);
}

// ============ 刷新界面 ============
function refreshAll() {
  updateUI();
  renderBoard();
  renderHand();
}

// ============ Canvas 渲染 ============

const TILE_W = 44;
const TILE_H = 68;

function renderBoard() {
  if (!ctx || !game) return;
  const W = canvas.width;
  const H = canvas.height;

  // 静态背景（渐变绒布 + 暗角 + 细金线内边框）走缓存层
  buildBoardBackground();
  ctx.drawImage(gBgCanvas, 0, 0);

  drawPlayerPositions();
  drawPassedTiles();
  drawChain();
  // drawEndHints(); // 之字形布局下位置待调整，暂时禁用
  drawDealerMark();

  if (game.phase === 'settling') {
    // 透视图模式下不画 Canvas 结算遮罩，让桌面完全可见
    var settleModal = document.getElementById('settleModal');
    if (!settleModal || !settleModal.classList.contains('peek')) {
      drawSettleOverlay();
    }
  }
}

function drawPlayerPositions() {
  const W = canvas.width;
  const H = canvas.height;
  const offset = getSeatOffset();
  const positions = [];
  for (let i = 0; i < 4; i++) {
    const p = getSeatPos(i, W, H);
    const baseIdx = ((i - offset) % 4 + 4) % 4;
    positions.push({
      x: p.x,
      y: p.y,
      label: (onlineMode && i === mySeat) ? '你' : game.players[i].name,
      id: i,
      baseIdx: baseIdx,
    });
  }

  for (const pos of positions) {
    const isActive = game.currentPlayer === pos.id && game.phase === 'playing';
    const isOut = game.players[pos.id].isOut;

    ctx.save();

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 22, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? 'rgba(240,192,64,0.25)' : 'rgba(0,0,0,0.3)';
    ctx.fill();
    ctx.strokeStyle = isActive ? COLORS.playerActive : 'rgba(200,184,144,0.3)';
    ctx.lineWidth = isActive ? 2.5 : 1;
    ctx.stroke();

    ctx.font = '12px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isOut ? COLORS.textMuted : (isActive ? COLORS.textGold : COLORS.textLight);
    ctx.fillText(pos.label, pos.x, pos.y);

    const pInfo = game.players[pos.id];
    const handCount = pInfo.handCount !== undefined ? pInfo.handCount : (pInfo.hand ? pInfo.hand.length : 0);
    ctx.font = '10px sans-serif';
    ctx.fillStyle = COLORS.textMuted;
    const labelY = pos.baseIdx === 0 ? pos.y - 32 : (pos.baseIdx === 2 ? pos.y + 32 : pos.y + 28);
    ctx.fillText(handCount + '张', pos.x, labelY);

    if (isOut) {
      ctx.fillStyle = game.players[pos.id].outByPass ? '#e67e22' : '#4caf50';
      ctx.font = '10px sans-serif';
      const outY = pos.baseIdx === 0 ? pos.y - 44 : (pos.baseIdx === 2 ? pos.y + 44 : pos.y + 42);
      ctx.fillText(game.players[pos.id].outByPass ? '扣完' : '净手', pos.x, outY);
    }

    ctx.restore();
  }
}

// 绘制每位玩家扣在桌上的牌
function drawPassedTiles() {
  const W = canvas.width;
  const H = canvas.height;
  const offset = getSeatOffset();
  const positions = [];
  for (let i = 0; i < 4; i++) {
    const p = getSeatPos(i, W, H);
    const baseIdx = ((i - offset) % 4 + 4) % 4;
    let x = p.x, y = p.y;
    let align = 'center';
    if (baseIdx === 0) { y = H - 80; align = 'center'; }
    else if (baseIdx === 2) { y = 80; align = 'center'; }
    else if (baseIdx === 1) { x = W - 100; align = 'right'; }
    else { x = 100; align = 'left'; }
    positions.push({ x: x, y: y, id: i, align: align, baseIdx: baseIdx });
  }

  for (const pos of positions) {
    const player = game.players[pos.id];
    const tiles = player.passedTiles || [];
    const passedCount = player.passedCount !== undefined ? player.passedCount : tiles.length;
    if (passedCount === 0) continue;

    ctx.save();
    const pW = 24, pH = 60; // 扣牌尺寸
    const showFace = onlineMode ? (pos.id === mySeat) : (localMode ? (pos.id === game.currentPlayer) : (pos.id === 0));

    if (showFace && tiles.length > 0) {
      // 当前玩家（或人机模式的玩家0）的扣牌：显示每张牌面（缩小）
      const totalW = tiles.length * (pW + 2);
      let startX = pos.x - totalW / 2;
      if (pos.align === 'right') startX = pos.x - totalW;
      if (pos.align === 'left') startX = pos.x;
      for (let i = 0; i < tiles.length; i++) {
        drawTileImage(ctx, startX + i * (pW + 2), pos.y, tiles[i], pW, pH, 0.5);
      }
      // 扣牌总点数
      const totalPoints = tiles.reduce((s, t) => s + (t && t.points || 0), 0);
      ctx.font = '9px sans-serif';
      ctx.fillStyle = COLORS.textMuted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('扣了' + tiles.length + '张(' + totalPoints + '点)', pos.x, pos.y + pH + 2);
    } else {
      // 其他玩家/未拿到明细时：只画一张背面 + 数量
      const bx = pos.align === 'right' ? pos.x - pW : pos.align === 'left' ? pos.x : pos.x - pW / 2;
      drawTileBack(ctx, bx, pos.y, pW, pH, 0.5);
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#f0c040';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('×' + passedCount, bx + pW / 2, pos.y + pH / 2);
    }

    ctx.restore();
  }
}

// 绘制牌背
function drawTileBack(c, x, y, w, h, alpha) {
  c.save();
  c.globalAlpha = alpha;
  c.fillStyle = '#5a3a1a';
  c.strokeStyle = '#8b7355';
  c.lineWidth = 1;
  roundRect(c, x, y, w, h, 5);
  c.fill();
  c.stroke();
  // 牌背花纹
  c.fillStyle = '#7a5a3a';
  roundRect(c, x + 3, y + 3, w - 6, h - 6, 3);
  c.fill();
  c.fillStyle = '#5a3a1a';
  c.font = 'bold ' + Math.round(w * 0.35) + 'px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('?', x + w/2, y + h/2);
  c.restore();
}

function drawDealerMark() {
  const W = canvas.width;
  const H = canvas.height;
  const d = getSeatPos(game.dealerIndex, W, H);
  ctx.save();
  ctx.beginPath();
  ctx.arc(d.x, d.y - 32, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#e74c3c';
  ctx.fill();
  ctx.restore();
}

// ============ 链中单张牌的显示信息 ============
// 根据 chain 中存储的 leftEnd/rightEnd 计算图片旋转角度
function getTileRotation(chainItem) {
  const tile = chainItem.tile;
  // 横牌（两端相同，如5-5大十）：图片本身就是横拍的（宽>高），无需旋转
  // 显示效果：横牌横放，占宽不占高，竖牌接在横牌的"腰"（长边）上
  if (tile.ends[0] === tile.ends[1]) {
    return 0; // 横牌不旋转，图片已横放
  }
  // 竖牌：根据 leftEnd 判断旋转角度
  // 图片素材：小数点在上（tile.ends[0] 在上），大点数在下（tile.ends[1] 在下）
  // 目标：leftEnd 朝向链的左方（即 Canvas 的左方向）
  //   leftEnd === ends[0]（小数点在图片上方）→ 需要让图片逆时针转90°，让小数点朝左
  //   leftEnd === ends[1]（大点数在图片上方）→ 需要让图片顺时针转90°，让大点数朝左（小数点朝右）
  if (chainItem.leftEnd === tile.ends[0]) {
    return -90; // 小数点朝左
  } else {
    return 90; // 小数点朝右（大点数朝左）
  }
}

// 以旋转方式绘制单张牌（支持图片或 fallback 点数绘制）
// 参数 w,h 是占位框尺寸，图片会保持宽高比居中绘制（不变形）
function drawTileRotated(c, x, y, w, h, rotationDeg, tile) {
  c.save();
  c.translate(x + w / 2, y + h / 2);
  c.rotate((rotationDeg * Math.PI) / 180);

  var img = tileImages[tile.key];
  if (img && img.complete && img.naturalWidth > 0) {
    // 保持图片原始宽高比，等比缩放以适应 w x h 的占位框
    // 注意：旋转 ±90° 后图片宽高互换，需要用互换后的尺寸来计算 scale
    var iw = img.naturalWidth;
    var ih = img.naturalHeight;
    var isRotated = (Math.abs(rotationDeg) % 180 === 90);
    var scale;
    if (isRotated) {
      // 旋转后：图片显示宽 = ih*scale, 显示高 = iw*scale
      // 需要同时适应 w(框宽) 和 h(框高)
      scale = Math.min(w / ih, h / iw);
    } else {
      scale = Math.min(w / iw, h / ih);
    }
    var drawW = iw * scale;
    var drawH = ih * scale;

    c.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  } else {
    c.fillStyle = COLORS.tileBg;
    c.strokeStyle = COLORS.tileBorder;
    c.lineWidth = 1;
    roundRect(c, -w / 2, -h / 2, w, h, 5);
    c.fill();
    c.stroke();
    c.fillStyle = '#333';
    c.font = '10px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(tile.name, 0, 0);
  }

  c.restore();
}

// ============ 之字形链绘制（持久化布局，牌不动） ============
let gChainLayout = null;   // { positions: [{x,y,w,h,rot}], scale }
let gLastChainLen = 0;

// 计算整条链的布局（Γ形：第一行横排，满了竖着往下）
function calculateFullLayout(chain, scale) {
  const padding = 10;
  const gap = 1.0;
  const nameH = 10;

  function getDrawSize(item, sc) {
    const rot = getTileRotation(item);
    const isH = (item.tile.ends[0] === item.tile.ends[1]);
    let w, h;
    if (isH) { w = 24 * sc; h = 60 * sc; }
    else if (rot === -90 || rot === 90) { w = TILE_H * sc; h = 28 * sc; }
    else { w = TILE_W * sc; h = TILE_H * sc; }
    return { w: w, h: h, rot: rot };
  }

  function getColSize(item, sc) {
    const s = getDrawSize(item, sc);
    return { w: s.h, h: s.w, rot: s.rot + 90 };
  }

  const availW = canvas.width - padding * 2;

  function calcTotalHeight(sc) {
    let rowW = 0, rowCount = 0, colCount = 0;
    for (let i = 0; i < chain.length; i++) {
      const sz = getDrawSize(chain[i], sc);
      const addW = (rowCount === 0) ? sz.w : sz.w + gap * sc;
      if (rowW + addW > availW && rowCount > 0) { colCount++; }
      else { rowW += addW; rowCount++; }
    }
    const colH = 55 * sc; // 竖列每格平均高度（横牌34+竖牌68≈55）
    return padding * 2 + 50 * sc + (colCount > 0 ? colCount * colH + 2 * sc : 0) + nameH * sc;
  }

  if (calcTotalHeight(scale) > canvas.height * 0.85) {
    let lo = 0.15, hi = 1.0;
    for (let iter = 0; iter < 25; iter++) {
      const mid = (lo + hi) / 2;
      if (calcTotalHeight(mid) > canvas.height * 0.85) hi = mid;
      else lo = mid;
    }
    scale = lo;
  }

  const rowH = 50 * scale;
  const startY = Math.max(padding, (canvas.height - calcTotalHeight(scale)) / 2);
  const positions = [];

  // 第 0 行：横排
  let rowW = 0, rowItems = [];
  for (let i = 0; i < chain.length; i++) {
    const sz = getDrawSize(chain[i], scale);
    const addW = (rowItems.length === 0) ? sz.w : sz.w + gap * scale;
    if (rowW + addW > availW && rowItems.length > 0) break;
    rowW += addW;
    rowItems.push(i);
  }
  let x = (canvas.width - rowW) / 2;
  for (let ci = 0; ci < rowItems.length; ci++) {
    const idx = rowItems[ci];
    const sz = getDrawSize(chain[idx], scale);
    positions[idx] = { x: x, y: startY + (rowH - sz.h) / 2, w: sz.w, h: sz.h, rot: sz.rot };
    x += sz.w + gap * scale;
  }

  // 竖列：每张牌按其实际高度紧密排列
  if (rowItems.length < chain.length) {
    const lastPos = positions[rowItems[rowItems.length - 1]];
    let colY = startY + rowH + 2 * scale;
    for (let i = rowItems.length; i < chain.length; i++) {
      const sz = getColSize(chain[i], scale);
      const cx = lastPos.x + lastPos.w + gap * scale - sz.w / 2;
      positions[i] = { x: cx, y: colY, w: sz.w, h: sz.h, rot: sz.rot };
      colY += sz.h + 2 * scale; // 紧贴排列，仅 4px 间距
    }
  }

  return { positions: positions, scale: scale };
}

// Γ形可用增量布局
let gUseIncremental = true;

// 尾部追加一张牌的位置（Γ形：第一行满了拐弯竖着往下）
function extendLayout(chain, scale) {
  const padding = 10;
  const gap = 1.0;
  const lastPos = gChainLayout.positions[gChainLayout.positions.length - 1];
  const newItem = chain[chain.length - 1];
  const rot = getTileRotation(newItem);
  const isH = (newItem.tile.ends[0] === newItem.tile.ends[1]);
  let w, h;
  if (isH) { w = 24 * scale; h = 60 * scale; }
  else if (rot === -90 || rot === 90) { w = TILE_H * scale; h = 32 * scale; }
  else { w = TILE_W * scale; h = TILE_H * scale; }

  const rowH = 50 * scale;
  // 竖列判断：上一张牌的 y 明显不在第一行高度范围内
  const inColumn = (lastPos.y > rowH + padding * 2);

  if (inColumn) {
    // 竖列中：紧贴上一张牌下方（与 calculateFullLayout 一致）
    return {
      x: lastPos.x,
      y: lastPos.y + lastPos.h + 4 * scale,
      w: h, h: w, rot: rot + 90,
    };
  }

  // 横排中
  if (lastPos.x + lastPos.w + gap * scale + w < canvas.width - padding) {
    // 同一横排：排在右边
    return {
      x: lastPos.x + lastPos.w + gap * scale,
      y: lastPos.y + (lastPos.h - h) / 2,
      w: w, h: h, rot: rot,
    };
  }

  // 横排满了，拐弯进入竖列：居中于横排末牌右边缘下方
  var rowBottom = lastPos.y - (rowH - lastPos.h) / 2 + rowH;
  return {
    x: lastPos.x + lastPos.w + gap * scale - h / 2,
    y: rowBottom + 2 * scale,
    w: h, h: w, rot: rot + 90,
  };
}

function drawFromLayout(chain, layout) {
  const positions = layout.positions;
  const scale = layout.scale;
  const lastIdx = chain.length - 1;
  const animActive = !!(gFlyAnim && chain.length > 0 && gFlyAnim.tile === chain[lastIdx].tile);
  const now = window.performance ? performance.now() : Date.now();
  for (let i = 0; i < chain.length; i++) {
    const pos = positions[i];
    if (!pos) continue;
    const item = chain[i];
    if (animActive && i === lastIdx) {
      // 新牌飞入：从出牌者座位缓动到链上最终位置，带轻微放大
      const t = Math.min(1, (now - gFlyAnim.start) / gFlyAnim.dur);
      const e = easeOutCubic(t);
      const cx = gFlyAnim.fromX + (gFlyAnim.toX - gFlyAnim.fromX) * e;
      const cy = gFlyAnim.fromY + (gFlyAnim.toY - gFlyAnim.fromY) * e;
      const sc = 0.62 + 0.38 * e;
      drawTileRotated(ctx, cx, cy, pos.w * sc, pos.h * sc, pos.rot, item.tile);
      continue; // 动画期间不画出牌者名字，避免抖动
    }
    drawTileRotated(ctx, pos.x, pos.y, pos.w, pos.h, pos.rot, item.tile);
    // 出牌者名字
    ctx.save();
    ctx.font = Math.round(9 * scale) + 'px sans-serif';
    ctx.fillStyle = COLORS.textMuted;
    ctx.textAlign = 'center';
    ctx.fillText(
      game.players[item.playedBy].name,
      pos.x + pos.w / 2,
      pos.y + pos.h + 10 * scale
    );
    ctx.restore();
  }
}

function drawChain() {
  const chain = game.chain;
  if (!chain || chain.length === 0) {
    gChainLayout = null;
    gLastChainLen = 0;
    ctx.save();
    ctx.font = '15px "PingFang SC", sans-serif';
    ctx.fillStyle = 'rgba(240,224,192,0.5)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('桌面为空，请出第一张牌', canvas.width / 2, canvas.height / 2);
    ctx.restore();
    return;
  }

  const chainLen = chain.length;
  let needRecalc = false;

  if (!gChainLayout || !gChainLayout.positions) {
    needRecalc = true;
  } else if (chainLen < gLastChainLen) {
    // 链缩短了（悔牌/新游戏），重新计算
    needRecalc = true;
  } else if (chainLen === gLastChainLen + 1) {
    // 链长增加1，检查是否是尾部追加
    let isTailAppend = true;
    for (let i = 0; i < gLastChainLen; i++) {
      if (!gChainLayout.positions[i] || chain[i].tile.key !== getKeyForPos(gChainLayout.positions[i])) {
        isTailAppend = false;
        break;
      }
    }
    if (isTailAppend && gUseIncremental) {
      // 尾部追加：只计算新牌位置（Γ形可用，Π形需全量重算）
      const scale = gChainLayout.scale;
      const newPos = extendLayout(chain, scale);
      gChainLayout.positions.push(newPos);
      gLastChainLen = chainLen;
      // 触发新牌飞入动效（仅在尚未在播放时，避免重绘重启动画）
      if (!gFlyAnim && chain.length > 0) {
        const last = chain[chain.length - 1];
        const seat = seatPoint(last.playedBy, canvas.width, canvas.height);
        startFlyIn(last.tile, seat.x, seat.y, newPos.x, newPos.y, newPos.w, newPos.h, newPos.rot);
      }
      drawFromLayout(chain, gChainLayout);
      return;
    } else {
      needRecalc = true;
    }
  } else {
    needRecalc = true;
  }

  if (needRecalc) {
    const scale = 1;
    const layout = calculateFullLayout(chain, scale);
    gChainLayout = layout;
    gLastChainLen = chainLen;
  }

  drawFromLayout(chain, gChainLayout);
}

// 辅助：从 position 对象获取 tile key（用于判断是否是尾部追加）
function getKeyForPos(pos) {
  // position 对象本身不存储 key，通过 chain 索引来比对
  // 这里改从 chain 直接比对
  return null; // 实际逻辑在 drawChain 中直接比对 chain[i].tile.key
}

// 使用图片绘制骨牌
function drawTileImage(c, x, y, tile, w, h, alpha) {
  c.save();
  c.globalAlpha = alpha;

  const img = tileImages[tile.key];
  if (img && img.complete && img.naturalWidth > 0) {
    // 有图片素材，使用图片
    c.drawImage(img, x, y, w, h);
  } else {
    // 无图片，回退到绘制点数
    c.fillStyle = COLORS.tileBg;
    c.strokeStyle = COLORS.tileBorder;
    c.lineWidth = 1;
    roundRect(c, x, y, w, h, 5);
    c.fill();
    c.stroke();
    drawTileContent(c, x, y, w, h, tile);
  }

  c.restore();
}

function drawTileContent(c, x, y, w, h, tile) {
  const ends = tile.ends;
  const isVertical = tile.type === 'vertical' && ends.length >= 2;

  if (isVertical) {
    drawEndDots(c, x + w/2, y + h * 0.25, ends[0], w, h * 0.4);
    c.beginPath();
    c.moveTo(x + 4, y + h/2);
    c.lineTo(x + w - 4, y + h/2);
    c.strokeStyle = COLORS.tileBorder;
    c.lineWidth = 0.5;
    c.stroke();
    drawEndDots(c, x + w/2, y + h * 0.75, ends[1], w, h * 0.4);
  } else {
    drawEndDots(c, x + w/2, y + h/2, ends[0], w, h * 0.75);
  }

  c.save();
  c.font = '8px sans-serif';
  c.fillStyle = '#888';
  c.textAlign = 'center';
  c.textBaseline = 'top';
  c.fillText(tile.name, x + w/2, y + h + 2);
  c.restore();
}

function drawEndDots(c, cx, cy, end, tileW, tileH) {
  c.save();

  if (end === 'R') {
    c.fillStyle = COLORS.dotRed;
    c.beginPath();
    c.arc(cx, cy, Math.min(tileW, tileH) * 0.3, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'white';
    c.font = 'bold 10px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('红', cx, cy);
  } else {
    const num = parseInt(end);
    if (isNaN(num)) { c.restore(); return; }
    const dotR = Math.min(tileW, tileH) * 0.12;
    const cols = num <= 3 ? 1 : (num <= 6 ? 2 : 3);
    const rows = Math.ceil(num / cols);
    const gapX = tileW * 0.2;
    const gapY = tileH * 0.15;
    const startX = cx - ((cols - 1) * gapX) / 2;
    const startY = cy - ((rows - 1) * gapY) / 2;

    let count = 0;
    for (let r = 0; r < rows && count < num; r++) {
      const cCount = (r === rows - 1 && num % cols !== 0) ? (num % cols) : cols;
      const rowStartX = cx - ((cCount - 1) * gapX) / 2;
      for (let col = 0; col < cCount && count < num; col++) {
        const dx = rowStartX + col * gapX;
        const dy = startY + r * gapY;
        c.beginPath();
        c.arc(dx, dy, dotR, 0, Math.PI * 2);
        c.fillStyle = COLORS.dotDark;
        c.fill();
        count++;
      }
    }
  }

  c.restore();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

function drawEndHints() {
  const ends = game.chainEnds;
  const chain = game.chain;
  if (!chain || chain.length === 0) return;

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  // 计算缩放后的牌链边界
  const padding = 30;
  const maxTotalW = canvas.width - padding * 2;
  const baseStep = TILE_W + 4;
  const naturalTotalW = chain.length * baseStep;
  const scale = naturalTotalW > maxTotalW ? maxTotalW / naturalTotalW : 1;
  const stepW = baseStep * scale;
  const tileW = TILE_W * scale;
  const tileH = TILE_H * scale;
  const totalW = chain.length * stepW;
  const startX = cx - totalW / 2;
  const y = cy - tileH / 2;

  if (ends.left !== null) {
    ctx.save();
    ctx.font = Math.round(13 * Math.max(0.7, scale)) + 'px sans-serif';
    ctx.fillStyle = COLORS.textGold;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('< ' + formatEnd(ends.left), startX - 6, cy);
    ctx.restore();
  }
  if (ends.right !== null) {
    ctx.save();
    ctx.font = Math.round(13 * Math.max(0.7, scale)) + 'px sans-serif';
    ctx.fillStyle = COLORS.textGold;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatEnd(ends.right) + ' >', startX + totalW + 6, cy);
    ctx.restore();
  }
}

function formatEnd(end) {
  if (end === 'R') return '红';
  return String(end);
}

function drawSettleOverlay() {
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, H);

  // 中央结算框
  const boxW = 280;
  const boxH = 100;
  const bx = (W - boxW) / 2;
  const by = (H - boxH) / 2;

  ctx.fillStyle = 'rgba(253,245,230,0.95)';
  roundRect(ctx, bx, by, boxW, boxH, 12);
  ctx.fill();
  ctx.strokeStyle = '#f0c040';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = 'bold 18px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#1a5c2a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('本局结束', W / 2, by + 30);

  ctx.font = '12px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#666';
  ctx.fillText('查看下方结算详情', W / 2, by + 60);

  ctx.restore();
}

// ============ 手牌渲染（DOM，使用图片）============
function renderHand() {
  const container = document.getElementById('handTiles');
  if (!container) return;
  container.innerHTML = '';

  var pid = activePlayerId();

  // 观战模式：不显示手牌和操作按钮
  if (onlineMode && mySeat < 0) {
    var specLabel = document.getElementById('handLabel');
    if (specLabel) specLabel.textContent = '观战模式';
    var specBar = document.getElementById('actionBar');
    if (specBar) specBar.style.display = 'none';
    return;
  }

  if (pid < 0 || !game.players[pid]) return;

  if (localMode && !localReady) {
    var waitLabel = document.getElementById('handLabel');
    if (waitLabel) {
      var waitName = game.players[game.currentPlayer] ? game.players[game.currentPlayer].name : '玩家';
      waitLabel.textContent = '请把手机交给 ' + waitName + '，然后点击屏幕中央按钮';
    }
    var waitBar = document.getElementById('actionBar');
    if (waitBar) waitBar.style.display = 'none';
    return;
  }

  const player = game.players[pid];
  if (!player) return;

  let playable;
  if (onlineMode) {
    playable = onlinePlayable;
  } else {
    playable = game.getPlayableTiles(pid);
  }
  const playableIds = new Set(playable.map(function(p) {
    return p.tileId !== undefined ? p.tileId : (p.tile ? p.tile.id : null);
  }));

  const isMyTurn = canLocalAct();
  const actionBar = document.getElementById('actionBar');
  if (actionBar) {
    actionBar.style.display = isMyTurn ? 'flex' : 'none';
  }

  for (const tile of player.hand) {
    const div = document.createElement('div');
    div.className = 'tile-dom';

    const canPlay = playableIds.has(tile.id) || (game.chain.length === 0);
    // 硬牌规则：先手时"拉三家"的牌不可出（其他三家没有能接的竖牌）
    const isYingPai = onlineMode
      ? (onlineLockedIds.indexOf(tile.id) >= 0)
      : (game.chain.length === 0 && game.isYingPaiViolation(pid, tile));
    const hasPlayable = onlineMode ? onlineHasPlayable : (playable.length > 0 || game.chain.length === 0);

    if (canPlay && isMyTurn && !isYingPai) {
      div.classList.add('playable');
    } else if (isMyTurn && isYingPai) {
      // 硬牌：先手不能出的垄断对子
      div.classList.add('locked');
      div.title = '硬牌！其他三家没有能接的竖牌';
    } else if (isMyTurn && !canPlay && !hasPlayable) {
      // 无牌可出时，允许选牌扣牌
      div.classList.add('unplayable');
    } else if (isMyTurn && !canPlay && hasPlayable) {
      // 有其他牌能出，这张不可选
      div.classList.add('locked');
    } else {
      div.classList.add('unplayable');
    }

    if (selectedTileId === tile.id) {
      div.style.borderColor = COLORS.tileSelected;
      div.style.boxShadow = '0 0 12px rgba(240,192,64,0.6)';
      div.style.transform = 'translateY(-8px)';
    }

    if (passTileId === tile.id) {
      div.style.borderColor = '#e74c3c';
      div.style.boxShadow = '0 0 12px rgba(231,76,60,0.6)';
    }

    // 使用图片
    const img = tileImages[tile.key];
    if (img && img.complete && img.naturalWidth > 0) {
      div.innerHTML = '<img src="' + img.src + '" alt="' + tile.name + '" style="width:100%;height:100%;object-fit:contain;border-radius:4px;">';
    } else {
      div.innerHTML =
        '<div class="tile-name">' + tile.name + '</div>' +
        '<div class="tile-ends">' + tile.ends.join('/') + '</div>' +
        '<div class="tile-pts">' + tile.points + '点</div>';
    }

    if (isMyTurn) {
      (function(tid) {
        div.addEventListener('click', function() { selectTile(tid); });
      })(tile.id);
    }

    container.appendChild(div);
  }

  // 更新手牌提示
  var handLabel = document.getElementById('handLabel');
  var ownerName = onlineMode ? '你' : (localMode ? player.name : '你');
  if (handLabel && isMyTurn) {
    var hasPlayable2 = onlineMode ? onlineHasPlayable : (playable.length > 0 || game.chain.length === 0);
    if (hasPlayable2) {
      handLabel.textContent = ownerName + '的手牌（请选择一张可出的牌出牌，绿色边框为可出）';
    } else {
      handLabel.textContent = ownerName + '没有可出的牌，请选择一张手牌扣牌';
    }
  } else if (handLabel) {
    handLabel.textContent = ownerName + '的手牌';
  }

  // 出牌方向按钮逻辑
  var btnConfirm = document.getElementById('btnConfirm');
  var btnSideLeft = document.getElementById('btnSideLeft');
  var btnSideRight = document.getElementById('btnSideRight');
  var btnPass = document.getElementById('btnPass');

  // 找到选中牌的可接端
  var selectedPlayable = null;
  if (selectedTileId && playable.length > 0) {
    selectedPlayable = playable.find(function(p) {
      return p.tileId !== undefined ? p.tileId === selectedTileId : p.tile.id === selectedTileId;
    });
  }

  // 判断是否需要方向选择：只要左右都能接，就显示“接左/接右”
  var needSideChoice = false;
  if (selectedPlayable && selectedPlayable.playableEnds.length >= 2 && game.chain.length > 0) {
    var leftEnd = selectedPlayable.playableEnds.find(function(e) { return e.side === 'left'; });
    var rightEnd = selectedPlayable.playableEnds.find(function(e) { return e.side === 'right'; });
    if (leftEnd && rightEnd) {
      needSideChoice = true;
    }
  }

  if (needSideChoice) {
    if (btnConfirm) btnConfirm.style.display = 'none';
    if (btnSideLeft) {
      btnSideLeft.textContent = '接左边（' + formatEnd(leftEnd.end) + '）';
      btnSideLeft.style.display = 'inline-block';
    }
    if (btnSideRight) {
      btnSideRight.textContent = '接右边（' + formatEnd(rightEnd.end) + '）';
      btnSideRight.style.display = 'inline-block';
    }
  } else {
    if (btnSideLeft) btnSideLeft.style.display = 'none';
    if (btnSideRight) btnSideRight.style.display = 'none';
    if (btnConfirm) btnConfirm.style.display = selectedTileId ? 'inline-block' : 'none';
  }

  // 扣牌按钮：只有在没有可出的牌时才显示（强制出牌规则）
  var hasPlayable = onlineMode ? onlineHasPlayable : (playable.length > 0 || game.chain.length === 0);
  if (btnPass) {
    if (hasPlayable) {
      btnPass.style.display = 'none';
    } else {
      btnPass.style.display = 'inline-block';
      if (passTileId) {
        btnPass.textContent = '扣这张';
        btnPass.style.background = '#e74c3c';
        btnPass.style.color = 'white';
      } else {
        btnPass.textContent = '选择要扣的牌';
        btnPass.style.background = '';
        btnPass.style.color = '';
      }
    }
  }

  // 更新提示文字
  if (handLabel && isMyTurn && selectedPlayable && selectedPlayable.playableEnds.length >= 2) {
    handLabel.textContent = '这张牌两端都能接，请选择接左边还是右边';
  }
}

// ============ 玩家操作 ============
function selectTile(tileId) {
  if (!canLocalAct()) return;
  var pid = activePlayerId();

  let playable;
  if (onlineMode) {
    playable = onlinePlayable;
  } else {
    playable = game.getPlayableTiles(pid);
  }
  const found = playable.find(function(p) {
    return p.tileId !== undefined ? p.tileId === tileId : p.tile.id === tileId;
  });

  if (!found && game.chain.length > 0) {
    // 不能出的牌
    // 强制出牌规则：如果还有其他可出的牌，不允许进入扣牌模式
    if (onlineMode ? onlineHasPlayable : playable.length > 0) {
      return; // 有其他牌能出，不能选这张
    }
    // 无牌可出 -> 进入扣牌选择模式
    if (passTileId === tileId) {
      passTileId = null;
    } else {
      passTileId = tileId;
      selectedTileId = null;
    }
    renderHand();
    return;
  }

  selectedTileId = tileId;
  passTileId = null;

  const tile = game.players[pid].hand.find(function(t) { return t.id === tileId; });
  if (tile && tile.type === 'vertical' && game.chain.length > 0 && found) {
    if (found.playableEnds.length >= 2) {
      selectedEnd = null;
    } else if (found.playableEnds.length === 1) {
      selectedEnd = found.playableEnds[0];
    } else {
      selectedEnd = null;
    }
  } else if (found && found.playableEnds.length > 0) {
    selectedEnd = found.playableEnds[0];
  } else {
    selectedEnd = null;
  }

  renderHand();
}

function confirmPlay() {
  if (!selectedTileId) return;
  if (!canLocalAct()) return;
  var pid = activePlayerId();

  // 在线模式：把出牌指令发给服务器，等服务器广播新状态
  if (onlineMode) {
    var endO = selectedEnd ? selectedEnd.end : undefined;
    var sideO = selectedEnd ? selectedEnd.side : undefined;
    onlineSendAction({ action: 'play', tileId: selectedTileId, end: endO, side: sideO });
    selectedTileId = null;
    selectedEnd = null;
    passTileId = null;
    renderHand();
    return;
  }

  // 孤红一家不去：头牌出红八时检查
  var selTile = game.players[pid].hand.find(function(t) { return t.id === selectedTileId; });
  if (selTile && game.checkGuHongYiJia(pid, selTile.key)) {
    alert('孤红一家不去！其他三张红牌都在同一对手手中，请另选别的牌');
    selectedTileId = null;
    selectedEnd = null;
    refreshAll();
    return;
  }

  var end = selectedEnd ? selectedEnd.end : undefined;
  var side = selectedEnd ? selectedEnd.side : undefined;

  var result = game.playTile(pid, selectedTileId, end, side);
  if (!result.success) {
    alert(result.msg);
    return;
  }
  playSound('play');
  vibrate(30);

  selectedTileId = null;
  selectedEnd = null;
  passTileId = null;

  // 无论净手与否，都要检测跑红和算账（净手也可能是最后一张触发算账，如红帐）
  game.checkPaoHong(pid);
  var suanZhang = game.checkSuanZhang(pid);
  if (suanZhang.isSuanZhang) {
    refreshAll();
    handleSuanZhang(suanZhang);
    return;
  }

  afterAction();
}

// 选择方向后出牌
function confirmPlaySide(side) {
  if (!selectedTileId) return;
  if (!canLocalAct()) return;
  var pid = activePlayerId();

  // 在线模式：发送出牌指令
  if (onlineMode) {
    onlineSendAction({ action: 'play', tileId: selectedTileId, side: side });
    selectedTileId = null;
    selectedEnd = null;
    passTileId = null;
    renderHand();
    return;
  }

  // 孤红一家不去
  var selTile2 = game.players[pid].hand.find(function(t) { return t.id === selectedTileId; });
  if (selTile2 && game.checkGuHongYiJia(pid, selTile2.key)) {
    alert('孤红一家不去！其他三张红牌都在同一对手手中，请另选别的牌');
    selectedTileId = null;
    refreshAll();
    return;
  }

  var playable = game.getPlayableTiles(pid);
  var found = playable.find(function(p) { return p.tile.id === selectedTileId; });
  if (!found) return;

  var endInfo = found.playableEnds.find(function(e) { return e.side === side; });
  if (!endInfo) return;

  var result = game.playTile(pid, selectedTileId, endInfo.end, side);
  if (!result.success) {
    alert(result.msg);
    return;
  }
  playSound('play');
  vibrate(30);

  selectedTileId = null;
  selectedEnd = null;
  passTileId = null;

  // 无论净手与否，都要检测跑红和算账（净手也可能是最后一张触发算账，如红帐）
  game.checkPaoHong(pid);
  var suanZhang2 = game.checkSuanZhang(pid);
  if (suanZhang2.isSuanZhang) {
    refreshAll();
    handleSuanZhang(suanZhang2);
    return;
  }

  afterAction();
}

function playerPass() {
  if (!canLocalAct()) return;
  var pid = activePlayerId();

  // 在线模式：发送扣牌指令
  if (onlineMode) {
    if (!passTileId) {
      if (onlineHasPlayable) {
        alert('还有可出的牌，不能扣牌！请选择一张不能出的牌点击扣牌。');
      } else {
        alert('请点击一张手牌选择要扣的牌，然后点击"扣这张"。');
      }
      return;
    }
    onlineSendAction({ action: 'pass', tileId: passTileId });
    passTileId = null;
    selectedTileId = null;
    selectedEnd = null;
    renderHand();
    return;
  }

  // 如果有选中的扣牌，直接扣这张
  if (passTileId) {
    var result = game.passTurn(pid, passTileId);
    if (!result.success) {
      alert(result.msg);
      return;
    }
    playSound('pass');
    vibrate(20);
    passTileId = null;
    selectedTileId = null;
    selectedEnd = null;
    afterAction();
    return;
  }

  // 没有选中扣牌，检查是否真的没有可出的牌
  var playable = game.getPlayableTiles(pid);
  if (playable.length > 0) {
    alert('还有可出的牌，不能扣牌！请选择一张不能出的牌点击扣牌。');
    return;
  }

  alert('请点击一张手牌选择要扣的牌，然后点击"扣这张"。');
}

// ============ 结算 ============
function finishRound() {
  try {
    var result = game.settleRound();
    refreshAll();
    showSettleModal(result);
  } catch (e) {
    console.error('finishRound error:', e);
    alert('结算出错：' + e.message);
  }
}

function showSettleModal(result) {
  if (!onlineMode) {
    playSound('win');
    vibrate([50, 50, 50]);
  }
  var modal = document.getElementById('settleModal');
  var content = document.getElementById('settleContent');

  var html = '';

  // 显示算账结果
  if (result.suanZhang) {
    var typeNames = {
      hongzhang: '红帐',
      wuzhang: '五帐',
      menwuzhang: '闷五帐',
      yizhang: '一帐',
      ersanzhang: '二三帐',
      zahongzhang: '砸红帐',
      general: '封局',
    };
    var typeName = typeNames[result.suanZhangType] || '算账';
    var starterName = game.players[result.suanZhangStarter].name;
    var starter = game.players[result.suanZhangStarter];
    var myPoints = starter.hand.reduce(function(s, t) { return s + t.points; }, 0)
                 + starter.passedTiles.reduce(function(s, t) { return s + t.points; }, 0);

    if (result.suanZhangSuccess) {
      html += '<div class="result-line special suanzhang-success">' + starterName + ' 发起' + typeName + '，总点数 ' + myPoints + ' 为全场最低（沾光）！</div>';
    } else {
      html += '<div class="result-line special suanzhang-fail">' + starterName + ' 发起' + typeName + '，总点数 ' + myPoints + ' 并非最低，需包庄！</div>';
    }

    // 显示孤红信息
    if (game.guHongPlayerIndex >= 0) {
      var guHongName = game.players[game.guHongPlayerIndex].name;
      html += '<div class="result-line special paohong-fail">' + guHongName + ' 孤红先手（出红八无其他红牌）！</div>';
    }

    // 显示未死红拦帐信息
    if (game.weiSiHongLanZhangPlayer >= 0) {
      var lanZhangName = game.players[game.weiSiHongLanZhangPlayer].name;
      html += '<div class="result-line special paohong-fail">' + lanZhangName + ' 未拦红帐（有六牌不出，放任红帐触发）！</div>';
    }

    // 显示双红八声明信息
    if (game.shuangHongBaDeclared) {
      var leaderName = game.players[game.leaderIndex].name;
      html += '<div class="result-line">' + leaderName + ' 声明了双红八</div>';
    }
  }

  // 显示跑红结果
  if (result.paoHong) {
    var paoHongStarter = game.players[result.paoHongStarter];
    var isMultMode = game.rules.scoringMode === 'multiplier';
    var paoHongUnit = isMultMode ? Math.round(((game.rules.baseScore || 10) / 10) * 12 * 3) : 12;
    if (result.paoHongSuccess) {
      html += '<div class="result-line special paohong-success">' + paoHongStarter.name + ' 跑红成功！赢' + paoHongUnit + '分！</div>';
    } else {
      html += '<div class="result-line special paohong-fail">' + paoHongStarter.name + ' 跑红失败，包庄！-' + paoHongUnit + '分</div>';
    }
  }

  for (var i = 0; i < 4; i++) {
    var score = game.roundScores[i];
    var pts = game.players[i].passedTiles.reduce(function(s, t) { return s + t.points; }, 0);
    var handPts = game.players[i].hand.reduce(function(s, t) { return s + t.points; }, 0);
    var cls = score > 0 ? 'winner' : '';
    html += '<div class="result-line ' + cls + '">' +
      game.players[i].name + (isMeSeat(i) ? '（你）' : '') + '：' + (score >= 0 ? '+' : '') + score + ' 分（扣牌 ' + pts + ' 点，手牌 ' + handPts + ' 点）</div>';
  }

  html += '<hr style="margin:10px 0;border-color:#ddd;">';
  var scoreStr = game.scores.map(function(s, i) {
    return game.players[i].name + ' ' + s;
  }).join(' / ');
  html += '<div class="result-line">累计积分：' + scoreStr + '</div>';
  // 计分方式说明
  var isMultMode = game && game.rules && game.rules.scoringMode === 'multiplier';
  var tierName = result.multiplier === 3 ? '算账/跑红' : (result.multiplier === 2 ? '单人净手' : '普通');
  if (isMultMode) {
    var multLabel = result.multiplier === 3 ? '算账/跑红×3' : (result.multiplier === 2 ? '净手×2' : '普通×1');
    html += '<div class="result-line result-note">记分：倍数计分 · 底分 ' + (result.baseScore || 10) + '，本局 ' + multLabel + '</div>';
  } else {
    var fixedLabel = result.multiplier === 3 ? '+12 / 输家 3/4/5' : (result.multiplier === 2 ? '+9 / 输家 2/3/4' : '+6 / 输家 1/2/3');
    html += '<div class="result-line result-note">记分：固定分（经典）· 本局 ' + tierName + ' ' + fixedLabel + '</div>';
  }

  content.innerHTML = html;

  // 展示各玩家扣的牌和剩余手牌
  var passedContainer = document.getElementById('settlePassedTiles');
  if (passedContainer) {
    var passedHtml = '<div class="passed-tiles-section"><h3>本局各玩家明细</h3>';
    for (var i = 0; i < 4; i++) {
      var p = game.players[i];
      passedHtml += '<div class="passed-player-row">';
      passedHtml += '<span class="passed-player-name">' + p.name + (isMeSeat(i) ? '（你）' : '') + '</span>';

      // 扣牌
      passedHtml += '<div class="passed-tiles-list">';
      if (p.passedTiles && p.passedTiles.length > 0) {
        passedHtml += '<span class="passed-label">扣牌:</span>';
        for (var j = 0; j < p.passedTiles.length; j++) {
          var pt = p.passedTiles[j];
          var img = tileImages[pt.key];
          if (img && img.complete && img.naturalWidth > 0) {
            passedHtml += '<img class="passed-tile-img" src="' + img.src + '" alt="' + pt.name + '" title="' + pt.name + ' (' + pt.points + '点)">';
          } else {
            passedHtml += '<div class="passed-tile-back" title="' + pt.name + '">' + pt.points + '</div>';
          }
        }
      } else {
        passedHtml += '<span class="passed-label">扣牌:</span><span class="passed-empty">无</span>';
      }
      passedHtml += '</div>';

      // 剩余手牌
      passedHtml += '<div class="passed-tiles-list">';
      if (p.hand && p.hand.length > 0) {
        passedHtml += '<span class="passed-label hand-label">手牌:</span>';
        for (var k = 0; k < p.hand.length; k++) {
          var ht = p.hand[k];
          var himg = tileImages[ht.key];
          if (himg && himg.complete && himg.naturalWidth > 0) {
            passedHtml += '<img class="passed-tile-img" src="' + himg.src + '" alt="' + ht.name + '" title="' + ht.name + ' (' + ht.points + '点)">';
          } else {
            passedHtml += '<div class="passed-tile-back" title="' + ht.name + '">' + ht.points + '</div>';
          }
        }
      } else {
        passedHtml += '<span class="passed-label hand-label">手牌:</span><span class="passed-empty">无</span>';
      }
      passedHtml += '</div>';

      passedHtml += '</div>';
    }
    passedHtml += '</div>';
    passedContainer.innerHTML = passedHtml;
  }

  // 下一局按钮：本地多人时明确由赢家摇色子
  var nextBtn = document.querySelector('#settleModal .modal-btns button');
  if (nextBtn) {
    if (localMode && game.lastWinner !== undefined && game.lastWinner >= 0) {
      nextBtn.textContent = '赢家 ' + game.players[game.lastWinner].name + ' 摇色子';
    } else {
      nextBtn.textContent = '摇色子下一局';
    }
  }

  modal.classList.add('active');

  // 结算透视图：点击弹窗外灰色背景可半透明看到桌面，再点恢复
  function togglePeek(e) {
    if (e.target === modal) {
      modal.classList.toggle('peek');
      // 切换后刷新桌面渲染
      renderBoard();
    }
  }
  modal.addEventListener('click', togglePeek);
  // 清除上次的监听器，避免重复
  var oldToggle = modal._togglePeek;
  if (oldToggle) {
    modal.removeEventListener('click', oldToggle);
  }
  modal._togglePeek = togglePeek;
}

function newRound() {
  showDiceRoll();
}

// ============ UI 更新 ============
function updateUI() {
  var phaseEl = document.getElementById('phaseText');
  var turnEl = document.getElementById('turnText');
  var dealerEl = document.getElementById('dealerText');

  dealerEl.textContent = '庄家：' + game.players[game.dealerIndex].name;

  if (game.phase === 'playing') {
    var cp = game.players[game.currentPlayer];
    turnEl.textContent = '当前：' + cp.name;
    if (onlineMode) {
      phaseEl.textContent = game.currentPlayer === mySeat ? '你的回合' : ('等待 ' + cp.name + ' 出牌...');
    } else if (localMode) {
      phaseEl.textContent = cp.name + ' 的回合';
    } else {
      phaseEl.textContent = cp.role === 'human' ? '你的回合' : cp.name + ' 思考中...';
    }
  } else if (game.phase === 'settling') {
    phaseEl.textContent = '本局结束';
    turnEl.textContent = '';
  }
}

function renderPlayersPanel() {
  var container = document.getElementById('playersPanel');
  container.innerHTML = '';

  for (var i = 0; i < 4; i++) {
    var p = game.players[i];
    var div = document.createElement('div');
    var cls = 'player-card';
    if (i === game.currentPlayer && game.phase === 'playing') cls += ' active';
    if (p.isOut) cls += ' out';
    div.className = cls;

    var handCount = p.handCount !== undefined ? p.handCount : (p.hand ? p.hand.length : 0);
    var passedTiles = p.passedTiles || [];
    var passedCount = p.passedCount !== undefined ? p.passedCount : passedTiles.length;
    var pts = 0;
    if (passedTiles.length > 0) {
      pts = passedTiles.reduce(function(s, t) { return s + (t && t.points || 0); }, 0);
    }
    var dealerMark = i === game.dealerIndex ? ' 🎲' : '';
    var isMe = onlineMode ? (i === mySeat) : (localMode ? (i === game.currentPlayer) : (i === 0));
    var nameText = p.name + (isMe ? '（你）' : '');
    var statusText = p.isOut ? (p.outByPass ? '扣完' : '净手 ✓') : (handCount + ' 张');
    var passText = '';
    if (passedCount > 0) {
      if (onlineMode) {
        passText = i === mySeat ? (' 扣' + pts + '点') : (' 扣了' + passedCount + '张');
      } else if (localMode) {
        passText = i === game.currentPlayer ? (' 扣' + pts + '点') : (' 扣了' + passedCount + '张');
      } else {
        passText = i === 0 ? (' 扣' + pts + '点') : (' 扣了' + passedCount + '张');
      }
    }
    var scoreText = (game.scores[i] >= 0 ? '+' : '') + game.scores[i] + ' 分';

    div.innerHTML =
      '<div class="name">' + nameText + dealerMark + '</div>' +
      '<div class="hand-count">' + statusText + passText + '</div>' +
      '<div class="score">' + scoreText + '</div>';

    container.appendChild(div);
  }
}

function renderLog() {
  var container = document.getElementById('logArea');
  container.innerHTML = '';
  var logs = game.log.slice(-20);
  for (var i = 0; i < logs.length; i++) {
    var div = document.createElement('div');
    div.className = 'log-entry';
    div.textContent = logs[i];
    container.appendChild(div);
  }
  container.scrollTop = container.scrollHeight;
}

// ============ 退出游戏 ============
function exitGame() {
  // 关闭所有弹窗
  document.getElementById('settleModal').classList.remove('active');
  document.getElementById('settingsPanel').classList.remove('active');
  var passOverlay = document.getElementById('passDeviceOverlay');
  if (passOverlay) passOverlay.classList.remove('active');
  localMode = false;
  localReady = false;
  chatVisible = false;
  var chatPanel = document.getElementById('chatPanel');
  if (chatPanel) chatPanel.style.display = 'none';
  disconnectOnline();
  updateReconnectButton();
  // 回到游戏大厅
  document.getElementById('gameScreen').style.display = 'none';
  document.getElementById('diceScreen').style.display = 'none';
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('lobbyScreen').style.display = 'flex';
  game = null;
}

// ============ 规则设置 ============
function openSettings() {
  var g = game ? game : { rules: { baseScore: 10, enablePaoHong: true, enableSuanZhang: true } };
  document.getElementById('settingBaseScore').value = g.rules.baseScore;
  document.getElementById('settingEnablePaoHong').checked = g.rules.enablePaoHong;
  document.getElementById('settingEnableSuanZhang').checked = g.rules.enableSuanZhang;
  var menWuEl = document.getElementById('settingEnableMenWuZhang');
  if (menWuEl) menWuEl.checked = !!g.rules.enableMenWuZhang;
  document.getElementById('settingScoringMode').value = g.rules.scoringMode === 'multiplier' ? 'multiplier' : 'fixed';
  updateBaseScoreVisibility();
  // 联机时规则由房主控制，只允许调整音效/震动
  var ruleIds = ['settingScoringMode', 'settingBaseScore', 'settingEnablePaoHong', 'settingEnableSuanZhang'];
  for (var i = 0; i < ruleIds.length; i++) {
    var el = document.getElementById(ruleIds[i]);
    if (el) el.disabled = !!onlineMode;
  }
  document.getElementById('settingsPanel').classList.add('active');
}

// 固定分（经典）模式不涉及底分：隐藏底分输入行与提示
function updateBaseScoreVisibility() {
  var row = document.getElementById('settingBaseScoreRow');
  if (!row) return;
  var mode = document.getElementById('settingScoringMode').value;
  row.style.display = mode === 'multiplier' ? '' : 'none';
}

function closeSettings() {
  document.getElementById('settingsPanel').classList.remove('active');
}

function saveSettings() {
  if (!onlineMode) {
    var rules = {
      baseScore: parseInt(document.getElementById('settingBaseScore').value) || 10,
      enablePaoHong: document.getElementById('settingEnablePaoHong').checked,
      enableSuanZhang: document.getElementById('settingEnableSuanZhang').checked,
      enableMenWuZhang: !!document.getElementById('settingEnableMenWuZhang').checked,
      scoringMode: document.getElementById('settingScoringMode').value === 'multiplier' ? 'multiplier' : 'fixed',
    };

    if (game) {
      game.loadRules(rules);
    }

    localStorage.setItem('dingniu_rules', JSON.stringify(rules));
  }

  var soundCb = document.getElementById('settingSound');
  var vibCb = document.getElementById('settingVibration');
  soundEnabled = !soundCb || soundCb.checked;
  vibrationEnabled = !vibCb || vibCb.checked;
  try {
    localStorage.setItem('dingniu_sound', soundEnabled ? '1' : '0');
    localStorage.setItem('dingniu_vibration', vibrationEnabled ? '1' : '0');
  } catch (e) {}

  closeSettings();
}

// ============ Canvas 自适应 ============
function isTouchDevice() {
  try {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    if (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) return true;
  } catch (e) {}
  return false;
}

function resizeCanvas() {
  if (!canvas) return;
  var area = document.querySelector('.board-area');
  if (!area) return;

  var vw = window.innerWidth || document.documentElement.clientWidth || 0;
  var vh = window.innerHeight || document.documentElement.clientHeight || 0;
  var isTouch = isTouchDevice();
  var isSmall = isTouch && vw < 900;
  var isPortrait = isSmall && vw < vh;

  var areaW = area.clientWidth - 20;
  if (areaW < 320) areaW = 320;

  // 逻辑宽度：手机竖屏更窄，PC/平板可更宽
  var logicalW = Math.max(320, Math.min(isSmall ? 480 : 900, areaW));

  // 为顶部栏/玩家区/手牌区/底部按钮预留高度，剩余高度尽量给牌桌
  var reserved = isSmall ? 290 : 260;
  var maxCanvasH = Math.max(160, vh - reserved);
  var logicalH;

  if (isPortrait) {
    // 竖屏：接近 4:5 的较高牌桌，但不超过窗口剩余高度
    logicalH = Math.max(160, Math.min(560, Math.round(logicalW * 1.08), maxCanvasH));
  } else {
    // 横屏/桌面：优先适配可视高度，宽度尽量铺满
    logicalH = Math.max(160, Math.min(600, Math.round(logicalW * 0.58), maxCanvasH));
    // 桌面宽屏回到经典 900x600（如果窗口高度足够）
    if (!isSmall) logicalH = Math.min(600, maxCanvasH);
  }

  canvas.width = logicalW;
  canvas.height = logicalH;

  // 显示尺寸完全交给 CSS 控制，但不超过逻辑宽度，避免被拉伸变形
  canvas.style.maxWidth = logicalW + 'px';
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  canvas.style.margin = '0 auto';

  renderBoard();
}

window.addEventListener('resize', resizeCanvas);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', resizeCanvas);
}

// ============ 启动 ============
document.addEventListener('DOMContentLoaded', function() {
  // 初始化主题：设置 data-theme、按钮文案、CSS 变量对应的 JS 调色板
  try { applyTheme(_themeMode); } catch (e) {}
  // 如果客户端是从联机服务器打开的，自动填好 WebSocket 地址
  var addrInput = document.getElementById('serverAddr');
  if (addrInput && typeof location !== 'undefined' && location.host) {
    addrInput.value = autoServerAddr();
  }

  // 音效/震动设置
  try {
    soundEnabled = localStorage.getItem('dingniu_sound') !== '0';
    vibrationEnabled = localStorage.getItem('dingniu_vibration') !== '0';
  } catch (e) {}
  var soundCb = document.getElementById('settingSound');
  var vibCb = document.getElementById('settingVibration');
  if (soundCb) soundCb.checked = soundEnabled;
  if (vibCb) vibCb.checked = vibrationEnabled;

  // 邀请链接：?room=ABCD
  try {
    var params = new URLSearchParams(location.search);
    var inviteRoom = (params.get('room') || '').toUpperCase();
    if (inviteRoom) {
      var roomInput = document.getElementById('roomCodeInput');
      var modeSelect = document.getElementById('gameMode');
      if (roomInput) roomInput.value = inviteRoom;
      if (modeSelect) { modeSelect.value = 'online'; toggleGameMode(); }
      onlineSetStatus('检测到邀请链接，点击“加入房间”即可进入 ' + inviteRoom, false);
    }
  } catch (e) {}

  // 在线/离线提示
  function updateOnlineStatus() {
    showNetBanner('offline', !navigator.onLine);
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  // PWA 安装引导
  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    deferredInstallPrompt = e;
    var installDismissed = false;
    try {
      installDismissed = localStorage.getItem('dingniu_install_dismissed') === '1';
    } catch (err) {}
    if (!installDismissed) {
      showNetBanner('install', true);
    }
  });
  var installBtn = document.getElementById('installBtn');
  if (installBtn) {
    installBtn.addEventListener('click', function() {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt = null;
        showNetBanner('install', false);
      }
    });
  }

  // PWA 更新提示
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(function(reg) {
      reg.addEventListener('updatefound', function() {
        var newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', function() {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showNetBanner('update', true);
          }
        });
      });
    }).catch(function() {});
  }

  toggleGameMode();
  updateReconnectButton();
  // 提前预加载骨牌图片，单机和联机都能正常显示牌面
  preloadImages(function() {});
  canvas = document.getElementById('gameCanvas');
  if (canvas) {
    ctx = canvas.getContext('2d');
    // 延迟执行，确保容器布局已稳定，避免初始尺寸算错
    setTimeout(function() { resizeCanvas(); }, 120);
  }
});

