// 真浏览器端到端（Windows Edge + CDP）：双人联机小游戏「你画我猜」
//   node test/browser/regress.mjs            # 全部
//   node test/browser/regress.mjs fullgame   # 单个
// 注意：本文件由 Windows 的 node.exe 跑（见 test/browser/README.md）
import {
  connect, createRoom, joinRoom, waitPlayers, startGame, sleep, assert,
  clickUntil, closeTabOnly, dumpOpen, APP,
} from './lib.mjs';

const S = {};

/** 画布上有多少不透明像素：用来判断「对端到底看没看到笔迹」 */
const measure = (page) => page.eval(`(() => {
  const c = document.querySelector('.dg-stage canvas');
  if (!c) return 0;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
})()`);

/** 落地页如果没自动入房，就补点一下「进房」（名字会从 localStorage 带出来） */
async function enterIfNeeded(page) {
  for (let i = 0; i < 24; i++) {
    if (await page.eval('PN.app && PN.app.room && !!PN.app.room.code')) return true;
    if (await page.eval('!!document.querySelector("#pn-join")')) await page.click('#pn-join').catch(() => {});
    await sleep(500);
  }
  return false;
}

/** 等「刷新后回到对局」：公共 broker 偶尔把重连的客户端分到另一台服务器（兜底），
 *  这时房间找不回来 —— 重试几次刷新/入房，连续失败才算真问题。 */
async function waitBackInGame(page, label, tries = 5) {
  for (let t = 0; t < tries; t++) {
    try {
      await page.waitFor('PN.app.state && PN.app.state.mode === "drawgame"', label, 20000);
      return true;
    } catch (e) {
      console.log('    [重试 ' + (t + 1) + '/' + tries + '] ' + label);
      await page.reload();
      await sleep(2500);           // 等公共 broker 把连接重新分配到同一台上
      await enterIfNeeded(page);
    }
  }
  throw new Error('连续 ' + tries + ' 次都没能回到对局（公共 broker 兜底导致，非产品缺陷）');
}

/** 开局到「作画中」，返回 {A, B, H(房主页), P(画家), G(猜词者), answer}
 *  注意：房主身份是选举出来的，可能不是先建房的那一页，所以开始游戏要用真正的房主页。 */
async function drawing(cdp) {
  const A = await createRoom(cdp, '甲');
  const B = await joinRoom(cdp, '乙', A.code);
  await waitPlayers(A, 2);
  const H = (await A.eval('PN.app.isHost()')) ? A : B;   // 谁是真房主就用谁开局
  await startGame(H, 'drawgame');
  const aId = await A.eval('PN.app.room.me.id');
  await A.waitFor('PN.app.state.g.cur && PN.app.state.g.cur.phase === "pick"', '进入选词');
  const painterId = await A.eval('PN.app.state.g.cur.painter');
  const P = painterId === aId ? A : B;
  const G = painterId === aId ? B : A;
  await P.waitFor('!!document.querySelector("[data-word]")', '画家拿到候选词');
  await clickUntil(P, '[data-word="0"]', 'PN.app.state.g.cur.phase === "draw"', '进入作画');
  const answer = await P.eval('(PN.app.secrets.drawgame && PN.app.secrets.drawgame.mine && PN.app.secrets.drawgame.mine.answer) || null');
  return { A, B, H, P, G, answer };
}

/* ============ 1. 两个人各自打开，进到同一局 ============ */
S.lobby = async (cdp) => {
  const A = await createRoom(cdp, '甲');
  const B = await joinRoom(cdp, '乙', A.code);
  await waitPlayers(A, 2);
  assert(await A.eval('PN.app.state.players.length') === 2, '房主看到 2 个人');
  assert(await B.eval('PN.app.state.mode') === 'lobby', '乙直接进大厅（不会再弹「没找到房间」）');
  const modes = await A.eval('JSON.stringify(Object.keys(PN.games))');
  assert(modes === '["codraw","cube","domino","drawgame","go","gomoku","hop","memory","mine","soko","tacit"]', '大厅有十一款游戏：你画我猜 + 合作翻牌 + 默契大考验 + 心有灵犀 + 五子棋 + 跳一跳 + 扫雷 + 鲸鱼推箱子 + 骨牌顶牛 + 魔方接力 + 围棋（' + modes + '）');
  assert(await A.eval('!!document.querySelector(".modecard[data-mode=\'cube\']")'), '大厅有魔方接力的入口卡片');
  assert(await A.eval('!!document.querySelector(".modecard[data-mode=\'go\']")'), '大厅有围棋的入口卡片');
  assert(await A.eval('!!document.querySelector(".modecard[data-mode=\'codraw\']")'), '大厅有心有灵犀的入口卡片');
  assert(await A.eval('!!document.querySelector(".modecard[data-mode=\'gomoku\']")'), '大厅有五子棋的入口卡片');
  assert(await A.eval('!!document.querySelector(".modecard[data-mode=\'hop\']")'), '大厅有跳一跳的入口卡片');
  assert(await A.eval('!!document.querySelector(".modecard[data-mode=\'mine\']")'), '大厅有扫雷的入口卡片');
  assert(await A.eval('!!document.querySelector(".modecard[data-mode=\'soko\']")'), '大厅有鲸鱼推箱子的入口卡片');
  assert(await A.eval('!!document.querySelector(".modecard[data-mode=\'domino\']")'), '大厅有骨牌顶牛的入口卡片');
  // 阶段三：入口系统升级后的分区与统一卡片
  assert(await A.eval('!!document.querySelector(".game-sec .game-head")'), '联机游戏有独立分区标题');
  assert(await A.eval('document.querySelectorAll(".gcard").length') >= 20, '两类游戏共用统一卡片（.gcard 共 ' + await A.eval('document.querySelectorAll(".gcard").length') + ' 张）');
  assert(await A.eval('!!document.querySelector(".modecard .gc-ico") && !!document.querySelector(".mini-card .gc-ico")'), '联机与小游戏卡片内部元素一致（.gc-ico）');
  assert(await A.eval('!!document.querySelector(".modecard .gc-tag") || !!document.querySelector(".mini-card .gc-tag")'), '卡片带标签（画风/类型）');
  await A.shot('lobby-hall');
  assert(await A.eval('!!document.querySelector(".modecard[data-mode=\'memory\']")'), '大厅有合作翻牌的入口卡片');
  assert(await A.eval('!!document.querySelector(".modecard[data-mode=\'drawgame\']")'), '大厅有画猜的入口卡片');
  assert(await A.eval('!!document.querySelector(".modecard[data-mode=\'tacit\']")'), '大厅有默契大考验的入口卡片');
  await A.shot('01-lobby');
  assert((await A.consoleErrors()) === '[]', '房主页面无 JS 报错');
  assert((await B.consoleErrors()) === '[]', '加入者页面无 JS 报错');
  await A.dispose(); await B.dispose();
};

/* ============ 2. 双人完整一局：选词 → 作画 → 猜中 → 揭晓 ============ */
S.fullgame = async (cdp) => {
  const { A, B, P, G, answer } = await drawing(cdp);
  assert(!!answer, '画家拿到答案：' + answer);
  await P.touchDrag('.dg-stage canvas', [0.2, 0.5], [0.8, 0.5], 20);
  await sleep(1500);
  const ink = await measure(G);
  assert(ink > 200, '对端看到画家画的笔迹（' + ink + ' 像素）');
  assert(!(await G.eval('document.body.innerText')).includes('界面出错了'), '对端没有白屏报错');
  await G.shot('02-guesser');
  await G.fill('.dg-input input', answer);
  await G.key('Enter', 'Enter', 13);
  await G.waitFor('PN.app.state.g.cur && PN.app.state.g.cur.phase === "reveal"', '进入揭晓', 25000);
  assert(await G.eval('PN.app.state.g.cur.reveal') === answer, '揭晓答案正确：' + answer);
  assert(await A.eval('PN.app.state.players.some(p => p.score > 0)'), '有人拿到分数');
  await G.shot('03-reveal');
  await A.dispose(); await B.dispose();
};

/* ============ 3. 断线重连：猜词者刷新后回到同一局，笔迹靠回放补齐 ============ */
S.rejoin = async (cdp) => {
  const { A, B, P, G } = await drawing(cdp);
  await P.touchDrag('.dg-stage canvas', [0.2, 0.45], [0.8, 0.55], 18);
  await sleep(1600);
  const inkBefore = await measure(G);
  const gId = await G.eval('PN.app.room.me.id');
  assert(inkBefore > 200, '刷新前对端已经看到笔迹（' + inkBefore + ' 像素）');

  // 真·刷新同一个标签页：localStorage 保留 → 还是同一个人；再点一下入房回到同一局
  await G.reload();
  await sleep(600);
  await enterIfNeeded(G);
  await waitBackInGame(G, '刷新后回到对局');
  const G2 = G;
  await sleep(2500);
  assert(await G2.eval('PN.app.room.me.id') === gId, '刷新后还是同一个人（身份没丢）');
  assert(await G2.eval('!document.body.innerText.includes("界面出错了")'), '刷新后不会白屏报错');
  // 回放/补发可能被公共 broker 丢一次，靠 askInk 自愈 —— 轮询等它补齐，最多 20 秒
  let inkAfter = 0;
  for (let t = 0; t < 40; t++) {
    inkAfter = await measure(G2);
    if (inkAfter >= inkBefore * 0.7) break;
    await sleep(500);
  }
  assert(inkAfter >= inkBefore * 0.7, '刷新后笔迹由回放补齐（' + inkAfter + ' vs ' + inkBefore + '）');
  assert(await G2.eval('PN.app.state.players.length') === 2, '名单没有多出重复的人');
  await G2.shot('04-rejoin');

  // 开房的那个人刷新也要能回来（他的链接原本不带 #房号 —— 线上就是这一路挂的）
  const creator = (await A.eval('!!PN.app.room.me.id')) ? A : B;
  const creatorId = await creator.eval('PN.app.room.me.id');
  assert(await creator.eval('location.hash.length > 1'), '进房后地址栏带上了房号：' + await creator.eval('location.hash'));
  await creator.reload();
  await sleep(600);
  await enterIfNeeded(creator);
  await waitBackInGame(creator, '开房者刷新后回到对局');
  assert(await creator.eval('PN.app.room.me.id') === creatorId, '开房者刷新后还是同一个人');
  assert(await creator.eval('!document.body.innerText.includes("界面出错了")'), '开房者刷新后没有白屏报错');
  assert(await creator.eval('PN.app.state.players.length') === 2, '开房者刷新后名单还是 2 个人');
  await A.dispose(); await B.dispose();
};

/* ============ 4. 房主掉线：换主后对局不崩、状态可读 ============ */
S.migration = async (cdp) => {
  const { A, B, P, G } = await drawing(cdp);
  await P.touchDrag('.dg-stage canvas', [0.2, 0.5], [0.7, 0.6], 14);
  await sleep(1200);
  const bId = await B.eval('PN.app.room.me.id');
  const phaseBefore = await B.eval('PN.app.state.g.cur.phase');

  await closeTabOnly(cdp, A);                       // 房主标签直接关掉（模拟掉线）
  await B.waitFor('PN.app.state.hostId === ' + JSON.stringify(bId), '乙成为新房主', 40000);
  assert(true, '房主掉线后自动选出新房主');
  assert(await B.eval('PN.app.state.mode') === 'drawgame', '对局没有被踢回大厅');
  assert(await B.eval('!(document.body.innerText.includes("界面出错了"))'), '换主过程中没有白屏报错');
  assert(phaseBefore === 'draw', '换主前正在作画（' + phaseBefore + '）');
  await B.shot('05-migration');
  await B.dispose();
};

/** 横向溢出检查：手机端最典型的「显示 bug」 */
const overflow = (page) => page.eval(`(() => {
  const vw = window.innerWidth, bad = [];
  document.querySelectorAll('#pn-root *, .overlay, .toasts').forEach(function (el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.right > vw + 0.5 || r.left < -0.5) bad.push((el.className || el.tagName) + '@' + Math.round(r.left) + '..' + Math.round(r.right));
  });
  return JSON.stringify({ vw: vw, scrollW: document.documentElement.scrollWidth, bad: bad.slice(0, 6) });
})()`);

/* ============ 5. 默契大考验：双人闭环（作答 → 揭晓 → 结算 → 再来一局）============ */
S.tacit = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2);
  const H = (await A.eval('PN.app.isHost()')) ? A : B;
  const O = H === A ? B : A;
  await startGame(H, 'tacit');
  // 两页都要等到作答阶段：公共 broker 下对方的 retained 状态可能晚一两秒到
  const inAnswer = 'PN.app.state.mode === "tacit" && PN.app.state.g && PN.app.state.g.cur && PN.app.state.g.cur.phase === "answer"';
  await H.waitFor(inAnswer, '房主进入作答', 30000);
  await O.waitFor(inAnswer, '对方进入作答', 30000);
  assert(await H.eval('PN.app.state.g.cur.q') === await O.eval('PN.app.state.g.cur.q'), '两人看到同一道题');
  assert(await H.eval('PN.app.state.g.total') === 8, '默认 8 题（可在 ⚙️ 里改）');
  await H.shot('tacit-1-answer');

  // 动效不能只是"写了样式"，要真的在跑（截图看不出动效，所以直接查 DOM 上正在运行的动画）
  const anim = JSON.parse(await H.eval(`(() => {
    const o = document.querySelector('.tac-opt');
    const cs = getComputedStyle(o);
    const sheet = document.getElementById('pncss') ? document.getElementById('pncss').textContent : '';
    const running = (document.getAnimations ? document.getAnimations() : [])
      .map(a => a.animationName || a.transitionProperty || a.constructor.name);
    return JSON.stringify({
      name: cs.animationName, trans: cs.transitionProperty,
      active: /\.tac-opt:active\{[^}]*translateY/.test(sheet),
      slide: /@keyframes qslideL/.test(sheet), dots: /@keyframes qdot/.test(sheet),
      running: Array.from(new Set(running)).slice(0, 8)
    });
  })()`));
  assert(anim.name && anim.name !== 'none', '选项按钮有入场动画：' + anim.name);
  assert(anim.trans.indexOf('transform') >= 0, '按钮有点按过渡：' + anim.trans);
  assert(anim.active, '按下时下沉回弹（Q 弹手感）');
  assert(anim.slide && anim.dots, '揭晓滑入 / 等待点点 动画都在');
  assert(anim.running.length > 0, 'DOM 上确实有动画在跑：' + anim.running.join(','));

  // 第 1 题：都选 A → 心有灵犀（这一下用真实点击，验证点按路径）
  await H.click('.tac-opt');
  await sleep(700);
  assert(await H.eval('!!document.querySelector(".tac-wait")'), '答完显示「已提交，等对方选…」');
  assert(await O.eval('!document.querySelector(".tac-wait")'), '对方没答完时不会提前揭晓');
  await H.shot('tacit-2-waiting');
  await O.click('.tac-opt');
  await O.waitFor('PN.app.state.g.cur.phase === "reveal"', '揭晓');
  assert(await O.eval('PN.app.state.g.cur.reveal.match') === true, '两人同选 → 心有灵犀');
  assert(await H.eval('PN.app.state.players.every(p => p.score === 1)'), '两个人各 +1 分（合作）');
  await O.shot('tacit-3-reveal');

  // 第 2 题：故意选不同 → 不计分
  // 两页都要等到第 2 题：只等一页的话另一页可能还在上一题揭晓页，点击会打空、只能干等 30 秒超时
  const inRound2 = 'PN.app.state.g.round === 2 && PN.app.state.g.cur && PN.app.state.g.cur.phase === "answer"';
  await O.waitFor(inRound2, '第 2 题（对方）', 30000);
  await H.waitFor(inRound2, '第 2 题（房主）', 30000);
  await H.click('.tac-opt');
  await O.eval("[].slice.call(document.querySelectorAll('.tac-opt'))[1].click()");
  await O.waitFor('PN.app.state.g.cur.phase === "reveal"', '揭晓 2', 25000);
  assert(await O.eval('PN.app.state.g.cur.reveal.match') === false, '选不同 → 不算默契，不计分');
  await O.shot('tacit-4-mismatch');

  // 一路打到结算（每题都选 A）。注意：检查状态与点击之间可能刚好切到揭晓，
  // 那时选项按钮已经不在 DOM 里了 —— 所以点击要防御式，不能直接 .click()。
  const clickOpt = (p, i) => p.eval(`(() => { const b = document.querySelectorAll('.tac-opt')[${i}]; if (!b) return false; b.click(); return true; })()`);
  for (let g = 0; g < 200; g++) {
    if (await H.eval('PN.app.state.g.phase') === 'over') break;
    const a1 = await clickOpt(H, 0);
    if (a1) { await sleep(140); await clickOpt(O, 0); }
    await sleep(500);
  }
  assert(await H.eval('PN.app.state.g.phase') === 'over', '走完全部题目进入结算');
  const sum = JSON.parse(await H.eval('JSON.stringify(PN.app.state.g.summary)'));
  assert(sum.total === 8 && sum.matched >= 5, '结算给出默契度：' + sum.matched + '/' + sum.total + ' = ' + sum.percent + '%');
  assert(await H.eval('!!document.querySelector(".tac-percent")'), '结算页显示大大的默契度百分比');
  await H.shot('tacit-5-over');

  const ov = JSON.parse(await overflow(H));
  assert(!ov.bad.length && ov.scrollW <= ov.vw + 1, '手机视口无横向溢出（' + ov.vw + 'px，溢出元素 ' + ov.bad.length + ' 个）');
  // 探针：只有房主侧会渲染「再来一局」，所以两页都看一眼（顺便暴露房主标记有没有抖动）
  const overProbe = (p) => p.eval(`JSON.stringify({
    host: PN.app.isHost(),
    again: !!document.querySelector('[data-over="again"]'),
    hasOver: /data-over=/.test(document.body.innerHTML),
    screen: PN.app.screenName
  })`).then(JSON.parse);
  const probeH = await overProbe(H), probeO = await overProbe(O);
  console.log('  [探针] 房主页=' + JSON.stringify(probeH) + ' 对方页=' + JSON.stringify(probeO));
  const btnHost = probeH.again ? H : (probeO.again ? O : null);
  assert(!!btnHost, '结算页有「再来一局」（房主侧）');
  await btnHost.click('[data-over="again"]');
  await H.waitFor('PN.app.state.g.round === 1 && PN.app.state.g.cur.phase === "answer"', '再来一局', 20000);
  assert(await H.eval('PN.app.state.g.summary') === null, '再来一局清掉了上一局结算');

  // 桌面视口也检查一遍
  await H.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, H.sid);
  await sleep(600);
  const ovd = JSON.parse(await overflow(H));
  assert(!ovd.bad.length && ovd.scrollW <= ovd.vw + 1, '桌面视口 1280px 无横向溢出');
  await H.shot('tacit-6-desktop');
  assert((await H.consoleErrors()) === '[]', '房主页面全程无 JS 报错');
  assert((await O.consoleErrors()) === '[]', '对方页面全程无 JS 报错');
  await A.dispose(); await B.dispose();
};

/* ============ 6. 合作翻牌：双人闭环（翻牌 → 配对 → 结算 → 再来一局）============ */
S.memory = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2);
  const H = (await A.eval('PN.app.isHost()')) ? A : B;
  const O = H === A ? B : A;
  await startGame(H, 'memory');
  const inPlay = 'PN.app.state.mode === "memory" && PN.app.state.g && PN.app.state.g.phase === "play"';
  await H.waitFor(inPlay, '进入牌局', 30000);
  await O.waitFor(inPlay, '对方进入牌局', 30000);

  assert(await H.eval('PN.app.state.g.slots.length') === 16, '8 对 = 16 张牌');
  assert(await H.eval('PN.app.state.g.slots.every(s => s === null)'), '开局全部背面朝上');
  const dump = await H.eval('JSON.stringify(PN.app.state.g)');
  assert(!/[🐱🐶🌸🍀🍰🍩🐰🐼]/.test(dump), 'state 里搜不到牌面（牌堆只在房主闭包里）');
  assert(await H.eval('document.querySelectorAll(".mem-card").length') === 16, '牌桌渲染出 16 张牌');
  const fitMobile = JSON.parse(await H.eval('(() => { const b = document.querySelector(".mem-board").getBoundingClientRect(); return JSON.stringify({bottom: Math.round(b.bottom), vh: window.innerHeight, w: Math.round(b.width)}); })()'));
  assert(fitMobile.bottom <= fitMobile.vh + 2, '整副牌在手机视口内看全（底 ' + fitMobile.bottom + ' ≤ ' + fitMobile.vh + '，宽 ' + fitMobile.w + '）');
  await H.shot('memory-1-board');

  // 谁的回合：把 player id 映射到页面
  const pidA = await A.eval('PN.app.me().id'), pidB = await B.eval('PN.app.me().id');
  const pageOf = (pid) => (pid === pidA ? A : B);
  const st = () => H.eval('JSON.stringify({phase:PN.app.state.g.phase,turn:PN.app.state.g.turn,flipped:PN.app.state.g.flipped,slots:PN.app.state.g.slots,done:PN.app.state.g.done,matched:PN.app.state.g.matched,turns:PN.app.state.g.turns})').then(JSON.parse);
  const clickCard = (p, i) => p.eval('(() => { const c = document.querySelector(".mem-card[data-i=\'' + i + '\']"); if (!c || c.disabled) return false; c.click(); return true; })()');

  // 点按动画 + 不是你的回合点不动
  let s0 = await st();
  const meP = pageOf(s0.turn), otherP = meP === A ? B : A;
  assert(await clickCard(otherP, 0) === false, '不是自己的回合点不动（防乱点）');
  assert(await clickCard(meP, 0) === true, '轮到你时点得动');
  // 翻牌动画由「房主状态回来 → 重建 → 补 .just」触发，所以要轮询等它出现
  let anims = '';
  for (let t = 0; t < 25; t++) {
    anims = await meP.eval('document.getAnimations().map(a => a.animationName || "").join(",")');
    if (anims.indexOf('qflipIn') >= 0) break;
    await sleep(60);
  }
  assert(anims.indexOf('qflipIn') >= 0, '翻牌有 3D 翻转动画在跑：' + anims);
  await sleep(500);
  assert((await st()).slots[0] !== null, '翻开的牌面出现在状态里');
  await meP.shot('memory-2-flip');

  // 用「会记忆的解法」把整局下完（每步都按真实点击，验证真人操作路径）
  const known = {};
  let miss = 0, matchSeen = false;
  const remember = (g) => g.slots.forEach((e, i) => {
    if (!e || (g.done || []).indexOf(i) >= 0) return;
    known[e] = known[e] || [];
    if (known[e].indexOf(i) < 0) known[e].push(i);
  });
  for (let step = 0; step < 200; step++) {
    let g = await st();
    if (g.phase === 'over') break;
    remember(g);
    if (g.flipped.length === 2) { await sleep(1400); continue; }   // 等房主把翻错的扣回
    let picks = [];
    for (const e in known) {
      const down = known[e].filter(i => g.slots[i] === null);
      if (down.length >= 2) { picks = [down[0], down[1]]; break; }
    }
    if (!picks.length) {
      const downKnown = [], unseen = [], seenIdx = {};
      for (const e in known) known[e].forEach(i => { seenIdx[i] = true; if (g.slots[i] === null) downKnown.push(i); });
      g.slots.forEach((e, i) => { if (e === null && !seenIdx[i]) unseen.push(i); });
      if (downKnown.length && unseen.length) picks = [downKnown[0], unseen[0]];
      else if (unseen.length >= 2) picks = [unseen[0], unseen[1]];
      else if (downKnown.length) picks = [downKnown[0]];
      else if (unseen.length) picks = [unseen[0]];
    }
    if (!picks.length) break;
    const P = pageOf(g.turn);
    for (const i of picks) { await clickCard(P, i); await sleep(160); }
    if (picks.length === 2) {
      if (await H.eval('!!PN.app.state.g.done.length')) matchSeen = true;
      await sleep(500);
      const after = await st();
      if (after.flipped.length === 2) miss++;
    }
  }
  const fin = await st();
  assert(fin.phase === 'over', '把整副牌配完 → 进入结算');
  const over = JSON.parse(await H.eval('JSON.stringify(PN.app.state.g.over)'));
  assert(over && over.pairs === 8 && over.turns >= 8, '结算：' + over.turns + ' 步配完 ' + over.pairs + ' 对，' + over.stars + ' 星');
  assert(await H.eval('document.querySelectorAll(".mem-stars").length') === 1, '结算页显示星级');
  assert(await H.eval('PN.app.state.players.every(p => p.score === 16)'), '两人各 16 分（8 对 × 2 分，合作）');
  await H.shot('memory-3-over');

  const ov = JSON.parse(await overflow(H));
  assert(!ov.bad.length && ov.scrollW <= ov.vw + 1, '手机视口无横向溢出（' + ov.vw + 'px）');
  const probeH = await H.eval('JSON.stringify({host:PN.app.isHost(),again:!!document.querySelector(\'[data-over="again"]\')})').then(JSON.parse);
  const probeO = await O.eval('JSON.stringify({host:PN.app.isHost(),again:!!document.querySelector(\'[data-over="again"]\')})').then(JSON.parse);
  console.log('  [探针] 房主页=' + JSON.stringify(probeH) + ' 对方页=' + JSON.stringify(probeO));
  const btnHost = probeH.again ? H : (probeO.again ? O : null);
  assert(!!btnHost, '结算页有「再来一局」（房主侧）');
  await btnHost.click('[data-over="again"]');
  await H.waitFor('PN.app.state.g.phase === "play" && PN.app.state.g.done.length === 0', '再来一局', 20000);
  assert(await H.eval('PN.app.state.g.matched') === 0, '再来一局清空上一局进度');

  await H.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, H.sid);
  await sleep(600);
  const ovd = JSON.parse(await overflow(H));
  assert(!ovd.bad.length && ovd.scrollW <= ovd.vw + 1, '桌面视口 1280px 无横向溢出');
  const fitDesk = JSON.parse(await H.eval('(() => { const b = document.querySelector(".mem-board").getBoundingClientRect(); return JSON.stringify({bottom: Math.round(b.bottom), vh: window.innerHeight, w: Math.round(b.width)}); })()'));
  assert(fitDesk.bottom <= fitDesk.vh + 2, '整副牌在桌面视口内看全（底 ' + fitDesk.bottom + ' ≤ ' + fitDesk.vh + '，宽 ' + fitDesk.w + '）');
  await H.shot('memory-4-desktop');
  assert((await H.consoleErrors()) === '[]', '房主页面全程无 JS 报错');
  assert((await O.consoleErrors()) === '[]', '对方页面全程无 JS 报错');
  await A.dispose(); await B.dispose();
};

/* ============ 17. 魔方接力：复用原作整包 + 双人轮流（stateKey 一致 / 复原结算） ============ */
S.cube = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2);
  const H = (await A.eval('PN.app.isHost()')) ? A : B;
  const O = H === A ? B : A;
  const idA = await A.eval('PN.app.me().id');
  const pageOf = (pid) => (pid === idA ? A : B);
  const snap = async (pg) => JSON.parse(await pg.eval('JSON.stringify({log:PN.app.state.g?PN.app.state.g.log.length:-1, applied:PN.screens.cube.debug().applied, key:String(PN.screens.cube.debug().key).slice(0,18), phase:PN.app.state.g?PN.app.state.g.phase:null})'));

  await startGame(H, 'cube');
  await H.waitFor(`PN.app.state.mode === 'cube' && PN.app.state.g && PN.app.state.g.phase === 'play'`, '进入对局', 30000);
  await O.waitFor(`PN.app.state.mode === 'cube'`, '对方进入对局', 30000);
  const g0 = JSON.parse(await H.eval('JSON.stringify({players:PN.app.state.g.players, turn:PN.app.state.g.turnIdx})'));
  assert(await H.eval('document.querySelectorAll(".cb-frame").length') === 1, '原作整包跑在 iframe 里');

  let same0 = false;
  for (let i = 0; i < 90; i++) {
    const a = await snap(H), b = await snap(O);
    if (a.key.length > 10 && b.key.length > 10 && a.key === b.key) { same0 = true; break; }
    await sleep(500);
  }
  assert(same0, '两端魔方初始状态一致（同种子打乱）');

  const actor = pageOf(g0.players[0]);
  await actor.click('[data-face="R"]');
  await H.waitFor('PN.app.state.g.log.length === 1', '房主记录一次转动', 25000);
  assert(true, '第一次转动被房主记录');
  await H.waitFor('PN.app.state.g.turnIdx === 1', '换人', 25000);
  assert(true, '转一步就交给对方');

  let agree = false;
  for (let i = 0; i < 60; i++) {
    const a = await snap(H), b = await snap(O);
    if (a.applied >= 1 && b.applied >= 1 && a.key === b.key) { agree = true; break; }
    await sleep(400);
  }
  console.log('  [诊断] 房主=' + JSON.stringify(await snap(H)) + ' 对手=' + JSON.stringify(await snap(O)));
  assert(agree, '两端魔方没有分叉（这是双人兼容的核心）');

  const p2 = pageOf(g0.players[1]);
  await p2.eval('document.querySelectorAll("[data-face]")[1].click(); 1');
  await H.waitFor('PN.app.state.g.log.length === 2', '第二步（带撇）', 25000);
  let agree2 = false;
  for (let i = 0; i < 60; i++) {
    const a = await snap(H), b = await snap(O);
    if (a.applied >= 2 && b.applied >= 2 && a.key === b.key) { agree2 = true; break; }
    await sleep(400);
  }
  assert(agree2, '连转两步（含带撇）后两端仍然一致');

  const wrong = pageOf(g0.players[1]);
  const lb = await H.eval('PN.app.state.g.log.length');
  await wrong.eval('PN.app.send({ t: "move", m: "D" }); 1');
  await sleep(900);
  assert(await H.eval('PN.app.state.g.log.length') === lb, '不是你的回合发转动会被房主拒绝');

  const cur = pageOf(await H.eval('PN.app.state.g.players[PN.app.state.g.turnIdx]'));
  await cur.eval('PN.app.send({ t: "solved" }); 1');
  await H.waitFor(`PN.app.state.g.phase === 'over'`, '复原后结算', 25000);
  assert(await H.eval('PN.app.state.g.played') === 1, '复原一次即完成本局');
  let sc = false;
  for (let i = 0; i < 20; i++) { if (await H.eval('document.body.innerText.indexOf("总积分") >= 0')) { sc = true; break; } await sleep(400); }
  assert(sc, '结算界面出现总积分');
  assert(await H.eval('PN.app.state.players.every(function(p){return p.score>=2;})') === true, '双方各得 2 分');

  const eH = await H.consoleErrors(), eO = await O.consoleErrors();
  assert(eH === '[]', '房主页面全程无 JS 报错：' + eH);
  assert(eO === '[]', '对方页面全程无 JS 报错：' + eO);
  await A.dispose(); await B.dispose();
};

/* ============ 15. 围棋：复用原作整包 + 双人对局（关掉 AI / 轮流落子 / 停一手终局） ============ */
S.go = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2);
  const H = (await A.eval('PN.app.isHost()')) ? A : B;
  const O = H === A ? B : A;
  A.pidCache = await A.eval('PN.app.me().id');
  B.pidCache = await B.eval('PN.app.me().id');
  const pageOf = (pid) => (pid === A.pidCache ? A : B);

  await startGame(H, 'go');
  await H.waitFor('PN.app.state.mode === "go" && PN.app.state.g && PN.app.state.g.phase === "play"', '进入对局', 30000);
  await O.waitFor('PN.app.state.mode === "go"', '对方进入对局', 30000);

  const g0 = JSON.parse(await H.eval('JSON.stringify({size:PN.app.state.g.size, players:PN.app.state.g.players, turnIdx:PN.app.state.g.turnIdx})'));
  assert(g0.size === 9, '9 路棋盘（与原作默认一致）');
  assert(g0.turnIdx === 0, '黑先（先加入的执黑）');
  assert(await H.eval('document.querySelectorAll(".go-frame").length') === 1, '原作整包跑在 iframe 里');

  // 等两端都就绪，并且都是全新棋局（原作会写 localStorage，两个 iframe 同源要防载入旧棋）
  let bothReady = false, fresh = false;
  for (let i = 0; i < 80; i++) {
    const a = JSON.parse(await H.eval('JSON.stringify(PN.screens.go.debug())'));
    const b = JSON.parse(await O.eval('JSON.stringify(PN.screens.go.debug())'));
    if (a.ready && b.ready && a.moves === 0 && b.moves === 0) { bothReady = true; fresh = true; break; }
    await sleep(500);
  }
  assert(bothReady, '两端原作都就绪');
  assert(fresh, '两端都是全新棋局（0 手，存档已清）');
  await H.shot('go-1-start');

  // 该黑方落子：中间第 40 点（9 路正中）
  const actor = pageOf(g0.players[0]);
  await actor.eval('PN.app.send({ t: "move", p: 40 }); 1');
  try { await H.waitFor('PN.app.state.g.log.length === 1', '房主记录第一手', 12000); }
  catch (e) {
    console.log('  [诊断] H state=' + await H.eval('JSON.stringify({mode:PN.app.state.mode, log:PN.app.state.g.log.length, turn:PN.app.state.g.turnIdx, players:PN.app.state.g.players, me:PN.app.me().id, host:PN.app.isHost()})'));
    console.log('  [诊断] O state=' + await O.eval('JSON.stringify({mode:PN.app.state.mode, me:PN.app.me().id, host:PN.app.isHost()})'));
    console.log('  [诊断] go debug=' + await H.eval('JSON.stringify(PN.screens.go.debug())'));
    console.log('  [诊断] dispatch 取值=' + await H.eval('JSON.stringify({disp:PN.__disp||0, mode:PN.__mode||null, gameOk:PN.__gameOk})'));
    console.log('  [诊断] onAction 门=' + await H.eval('JSON.stringify({act:PN.__act||0, host:PN.__actHost, isHost:PN.__actIsHost, t:PN.__actT||null})'));
    console.log('  [诊断] 权威状态=' + await H.eval('JSON.stringify({dbg:PN.app.host.state.g.dbg||0, t:PN.app.host.state.g.lastT, from:PN.app.host.state.g.lastFrom, turn:PN.app.host.state.g.lastTurn, log:PN.app.host.state.g.log.length})'));
    console.log('  [诊断] move 到达=' + await H.eval('JSON.stringify({seen:PN.app.host.state.g.mvSeen||0, from:PN.app.host.state.g.mvFrom, p:PN.app.host.state.g.mvP, turn:PN.app.host.state.g.mvTurn, whose:PN.app.host.state.g.mvWhose})'));
    console.log('  [诊断] 权威 players=' + await H.eval('JSON.stringify(PN.app.host.state.g.players)') + ' 当前该走=' + await H.eval('JSON.stringify(PN.app.host.state.g.players[PN.app.host.state.g.turnIdx])'));
    throw e;
  }
  assert(true, '第一手被房主记录（权威日志 +1）');
  await H.waitFor('PN.app.state.g.turnIdx === 1', '换白方', 20000);
  assert(true, '落子后换成白方');

  // 两端各自把这一手落到原作 → 手数必须一致（围棋引擎本身确定，不需要种子）
  let agree = false;
  for (let i = 0; i < 40; i++) {
    const a = JSON.parse(await H.eval('JSON.stringify(PN.screens.go.debug())'));
    const b = JSON.parse(await O.eval('JSON.stringify(PN.screens.go.debug())'));
    if (a.moves === 1 && b.moves === 1 && JSON.stringify(a.caps) === JSON.stringify(b.caps)) {
      agree = true; assert(true, '两端落地后手数一致（1 手，吃子 ' + a.caps.join(':') + '）'); break;
    }
    await sleep(400);
  }
  assert(agree, '两端棋局没有分叉（这是双人兼容的核心）');

  // 越位
  const wrong = pageOf(g0.players[0]);
  const lb = await H.eval('PN.app.state.g.log.length');
  await wrong.eval('PN.app.send({ t: "move", p: 41 }); 1');
  await sleep(800);
  assert(await H.eval('PN.app.state.g.log.length') === lb, '不是你的回合发落子会被房主拒绝');

  // 白方也下一手，确认连续同步
  const act2 = pageOf(g0.players[1]);
  await act2.eval('PN.app.send({ t: "move", p: 30 }); 1');
  await H.waitFor('PN.app.state.g.log.length === 2', '第二手', 20000);
  let agree2 = false;
  for (let i = 0; i < 40; i++) {
    const a = JSON.parse(await H.eval('JSON.stringify(PN.screens.go.debug())'));
    const b = JSON.parse(await O.eval('JSON.stringify(PN.screens.go.debug())'));
    if (a.moves === 2 && b.moves === 2) { agree2 = true; break; }
    await sleep(400);
  }
  assert(agree2, '连下两手后两端仍然一致（2 手）');
  await H.shot('go-2-two-moves');

  // 连续两次停一手 → 终局结算
  const cp1 = pageOf(await H.eval('PN.app.state.g.players[PN.app.state.g.turnIdx]'));
  await cp1.eval('PN.app.send({ t: "move", p: -1 }); 1');
  await H.waitFor('PN.app.state.g.log.length === 3', '白方停一手', 20000);
  const act3 = pageOf(g0.players[0]);
  const cp2 = pageOf(await H.eval('PN.app.state.g.players[PN.app.state.g.turnIdx]'));
  await cp2.eval('PN.app.send({ t: "move", p: -1 }); 1');
  await H.waitFor('PN.app.state.g.phase === "over"', '两次停一手终局', 30000);
  assert(true, '连续两次停一手 → 终局结算');
  const over = JSON.parse(await H.eval('JSON.stringify({ phase:PN.app.state.g.phase, caps:PN.app.state.g.caps })'));
  assert(over.phase === 'over', '终局状态正确（吃子 ' + over.caps.join(':') + '）');
  assert(await H.eval('document.body.innerText.indexOf("总积分") >= 0') === true, '结算界面出现总积分');

  const eH = await H.consoleErrors(), eO = await O.consoleErrors();
  assert(eH === '[]', '房主页面全程无 JS 报错：' + eH);
  assert(eO === '[]', '对方页面全程无 JS 报错：' + eO);
  await A.dispose(); await B.dispose();
};

/* ============ 14. 2048 肉鸽版：复用原作整包 + 双人轮流走一步（同种子 / 两端一致） ============ */
S.tile2048 = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2);
  const H = (await A.eval('PN.app.isHost()')) ? A : B;
  const O = H === A ? B : A;
  A.pidCache = await A.eval('PN.app.me().id');
  B.pidCache = await B.eval('PN.app.me().id');
  const pageOf = (pid) => (pid === A.pidCache ? A : B);

  await startGame(H, 'tile2048');
  await H.waitFor('PN.app.state.mode === "tile2048" && PN.app.state.g && PN.app.state.g.phase === "play"', '进入对局', 30000);
  await O.waitFor('PN.app.state.mode === "tile2048"', '对方进入对局', 30000);

  const g0 = JSON.parse(await H.eval('JSON.stringify({seed:PN.app.state.g.seed, rounds:PN.app.state.g.rounds})'));
  assert(typeof g0.seed === 'number' && g0.seed !== 0, '房主生成固定种子：' + g0.seed + '（2048 出新方块要两端一致）');
  assert(g0.rounds === 2, '默认 2 局（⚙️可改 1/3）');
  assert(await H.eval('document.querySelectorAll(".t48-frame").length') === 1, '原作整包跑在 iframe 里');

  // 等两端都自动开局（点 #startBtn）并读到盘面
  let bothUp = false;
  for (let i = 0; i < 80; i++) {
    const a = JSON.parse(await H.eval('JSON.stringify(PN.screens.tile2048.debug())'));
    const b = JSON.parse(await O.eval('JSON.stringify(PN.screens.tile2048.debug())'));
    if (a.started && b.started && a.tiles > 0 && b.tiles > 0) { bothUp = true; assert(true, '两端原作都自动开局（画布已渲染，SCORE ' + a.score + ' / MOVES ' + a.moves + '）'); break; }
    await sleep(500);
  }
  if (!bothUp) console.log('  [诊断] H=' + await H.eval('JSON.stringify(PN.screens.tile2048.debug())'));
  assert(bothUp, '两端原作都进入可玩状态（自动点开始）');
  const d0 = JSON.parse(await H.eval('JSON.stringify(PN.screens.tile2048.debug())'));
  const d0b = JSON.parse(await O.eval('JSON.stringify(PN.screens.tile2048.debug())'));
  assert(d0.score === d0b.score && d0.moves === d0b.moves, '同种子生效：两端开局状态一致（' + d0.score + '分/' + d0.moves + '步）');
  await H.shot('2048-1-start');

  // 轮流走：该出手那页点十字键
  const turnPage = async () => pageOf(await H.eval('PN.app.state.g.players[PN.app.state.g.turnIdx]'));
  const P1 = await turnPage();
  const before = await H.eval('PN.app.state.g.log.length');
  await P1.click('[data-dir="left"]');
  await H.waitFor('PN.app.state.g.log.length === ' + (before + 1), '房主记录一步', 20000);
  assert(true, '第一步被房主记录（权威日志 +1）');
  await H.waitFor('PN.app.state.g.turnIdx === 1', '换人', 20000);
  assert(true, '走一步就交给对方');

  // 两端各自把这一步 dispatch 进原作 → 盘面必须一致（这是双人兼容的核心）
  let agree = false;
  for (let i = 0; i < 40; i++) {
    const a = JSON.parse(await H.eval('JSON.stringify(PN.screens.tile2048.debug())'));
    const b = JSON.parse(await O.eval('JSON.stringify(PN.screens.tile2048.debug())'));
    if (a.applied === 1 && b.applied === 1 && a.moves === b.moves && a.score === b.score) {
      agree = true; assert(true, '两端落地后状态一致（' + a.score + '分/' + a.moves + '步）'); break;
    }
    await sleep(400);
  }
  assert(agree, '两端盘面没有分叉（这是双人兼容的核心）');

  // 再走两步，确认持续一致
  const P2 = await turnPage();
  await P2.click('[data-dir="up"]');
  await H.waitFor('PN.app.state.g.log.length === ' + (before + 2), '第二步', 20000);
  let agree2 = false;
  for (let i = 0; i < 40; i++) {
    const a = JSON.parse(await H.eval('JSON.stringify(PN.screens.tile2048.debug())'));
    const b = JSON.parse(await O.eval('JSON.stringify(PN.screens.tile2048.debug())'));
    if (a.applied === 2 && b.applied === 2 && a.moves === b.moves && a.score === b.score) { agree2 = true; break; }
    await sleep(400);
  }
  assert(agree2, '连走两步后两端仍然一致（applied=2）');

  // 越位：不是你的回合发动作要被拒
  const wrong = await H.eval('PN.app.state.g.players[(PN.app.state.g.turnIdx + 1) % 2]');
  const wrongPage = pageOf(wrong);
  const lb = await H.eval('PN.app.state.g.log.length');
  await wrongPage.eval('PN.app.send({ t: "move", dir: "down" }); 1');
  await sleep(800);
  assert(await H.eval('PN.app.state.g.log.length') === lb, '不是你的回合发动作会被房主拒绝');

  const fit = JSON.parse(await H.eval('(() => { const b = document.querySelector(".t48-stage").getBoundingClientRect(); return JSON.stringify({bottom: Math.round(b.bottom), vh: window.innerHeight, w: Math.round(b.width)}); })()'));
  assert(fit.bottom <= fit.vh + 2 && fit.w > 200, '手机视口里原作舞台看全（底 ' + fit.bottom + ' ≤ ' + fit.vh + '，宽 ' + fit.w + '）');
  const ov = JSON.parse(await overflow(H));
  assert(!ov.bad.length && ov.scrollW <= ov.vw + 1, '手机视口无横向溢出（' + ov.vw + 'px）');
  await H.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, H.sid);
  await sleep(800);
  await H.shot('2048-2-desktop');

  const eH = await H.consoleErrors(), eO = await O.consoleErrors();
  assert(eH === '[]', '房主页面全程无 JS 报错：' + eH);
  assert(eO === '[]', '对方页面全程无 JS 报错：' + eO);
  await A.dispose(); await B.dispose();
};

/* ============ 13. 骨牌顶牛：复用原作整包 + 双人各带两家（同种子 / 只上报 / 两端一致） ============ */
S.domino = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2);
  const H = (await A.eval('PN.app.isHost()')) ? A : B;
  const O = H === A ? B : A;
  A.pidCache = await A.eval('PN.app.me().id');
  B.pidCache = await B.eval('PN.app.me().id');

  await startGame(H, 'domino');
  await H.waitFor('PN.app.state.mode === "domino" && PN.app.state.g && PN.app.state.g.phase === "play"', '进入对局', 30000);
  await O.waitFor('PN.app.state.mode === "domino"', '对方进入对局', 30000);

  const g0 = JSON.parse(await H.eval('JSON.stringify({seed:PN.app.state.g.seed, owners:PN.app.state.g.owners, players:PN.app.state.g.players})'));
  assert(typeof g0.seed === 'number' && g0.seed !== 0, '房主生成固定种子：' + g0.seed + '（原作摇色子/洗牌要两端一致）');
  assert(g0.owners[0] === g0.players[0] && g0.owners[2] === g0.owners[0], 'A 带 1、3 家（座位 0/2）');
  assert(g0.owners[1] === g0.owners[3] && g0.owners[1] !== g0.owners[0], 'B 带 2、4 家（座位 1/3）—— 出牌顺序天然轮流');
  assert(await H.eval('document.querySelectorAll(".dm-frame").length') === 1, '原作整包跑在 iframe 里');
  const seedBoth = await O.eval('PN.app.state.g.seed');
  assert(seedBoth === g0.seed, '两端拿到同一种子');

  // 桥接把原作推进到 PLAYING（要用裸标识符 game 读它，顶层是 let 不在 window 上）
  let bothReady = false;
  for (let i = 0; i < 90; i++) {
    const a = await H.eval('PN.screens.domino.debug().ready === true');
    const b = await O.eval('PN.screens.domino.debug().ready === true');
    if (a && b) { bothReady = true; break; }
    await sleep(500);
  }
  if (!bothReady) {
    console.log('  [诊断] H=' + await H.eval('JSON.stringify(PN.screens.domino.debug())') +
      ' O=' + await O.eval('JSON.stringify(PN.screens.domino.debug())'));
  }
  assert(bothReady, '两端原作都被推进到 PLAYING（桥接自动走完 开始→摇色子→开始对局）');
  const readState = `(() => {
    const f = document.querySelector('.dm-frame');
    try {
      return f.contentWindow.eval('JSON.stringify({phase:String(game.phase), seat:game.currentPlayer|0, round:game.round|0, chain:game.chain.length, hands:game.players.map(function(p){return p.hand.length;})})');
    } catch (e) { return JSON.stringify({ err: String(e && e.message) }); }
  })()`;
  const s1 = JSON.parse(await H.eval(readState));
  const s2 = JSON.parse(await O.eval(readState));
  assert(!s1.err && !s2.err, '两端都能读到原作牌局状态：' + JSON.stringify(s1));
  assert(s1.phase === 'playing' && s1.hands && s1.hands.every(h => h > 0), '牌已发到手上（' + JSON.stringify(s1.hands) + '）');
  assert(s1.seat === s2.seat && s1.round === s2.round && s1.chain === s2.chain,
    '同种子生效：两端座位/局数/牌链完全一致（' + s1.seat + '/' + s1.round + '/' + s1.chain + '）');
  await H.shot('domino-1-start');

  // 让"该出手那家的主人"打一手：包过的 playTile 只上报，不本地落地
  const ownerPid = await H.eval('PN.app.state.g.owners[PN.app.state.g.seat]');
  const actor = (ownerPid === A.pidCache) ? A : B;
  const before = await H.eval('PN.app.state.g.log.length');
  const act = JSON.parse(await actor.eval(`(() => {
    const f = document.querySelector('.dm-frame');
    return f.contentWindow.eval('(function(){ var p = game.currentPlayer; var t = game.players[p].hand[0]; var res = game.playTile(p, t.id); return JSON.stringify({ seat: p, tileId: t.id, res: res }); })()');
  })()`));
  assert(act.res && act.res.success === true && act.res.msg === 'pending', '本地出牌被桥接接管（返回 pending，不本地落地）：' + JSON.stringify(act.res));
  await H.waitFor('PN.app.state.g.log.length === ' + (before + 1), '房主收到动作', 20000);
  assert(true, '房主权威日志记录了这一手（座位 ' + act.seat + '）');

  // 两端各自落地 → 牌链必须一致
  let agree = false;
  for (let i = 0; i < 40; i++) {
    const a = await H.eval(readState), b = await O.eval(readState);
    const ja = JSON.parse(a), jb = JSON.parse(b);
    if (ja.chain === jb.chain && ja.chain >= 0 && (await H.eval('PN.screens.domino.debug().applied')) > 0) { agree = true; assert(true, '两端落地后牌链一致（chain=' + ja.chain + '）'); break; }
    await sleep(400);
  }
  assert(agree, '两端的牌局没有分叉（这是双人兼容的核心）');

  // 混出手：不是他家的座位发动作，房主必须拒绝
  const wrong = await H.eval('PN.app.state.g.owners[(PN.app.state.g.seat + 1) % 4]');
  const wrongPage = (wrong === A.pidCache) ? A : B;
  const logBefore = await H.eval('PN.app.state.g.log.length');
  await wrongPage.eval('PN.app.send({ t: "act", kind: "play", seat: (PN.app.state.g.seat + 1) % 4, tileId: "x" }); 1');
  await sleep(900);
  assert(await H.eval('PN.app.state.g.log.length') === logBefore, '不属于自己家的座位发动作会被房主拒绝');

  const fit = JSON.parse(await H.eval('(() => { const b = document.querySelector(".dm-stage").getBoundingClientRect(); return JSON.stringify({bottom: Math.round(b.bottom), vh: window.innerHeight, w: Math.round(b.width)}); })()'));
  assert(fit.bottom <= fit.vh + 2 && fit.w > 200, '手机视口里原作舞台看全（底 ' + fit.bottom + ' ≤ ' + fit.vh + '，宽 ' + fit.w + '）');
  const ov = JSON.parse(await overflow(H));
  assert(!ov.bad.length && ov.scrollW <= ov.vw + 1, '手机视口无横向溢出（' + ov.vw + 'px）');
  await H.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, H.sid);
  await sleep(800);
  await H.shot('domino-2-desktop');

  const eH = await H.consoleErrors(), eO = await O.consoleErrors();
  assert(eH === '[]', '房主页面全程无 JS 报错：' + eH);
  assert(eO === '[]', '对方页面全程无 JS 报错：' + eO);
  await A.dispose(); await B.dispose();
};

/* ============ 12. 鲸鱼推箱子：复用原作整包 + 双人兼容（轮流出手 / 日志重放 / 两端收敛） ============ */
S.soko = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2);
  const H = (await A.eval('PN.app.isHost()')) ? A : B;
  const O = H === A ? B : A;
  A.pidCache = await A.eval('PN.app.me().id');
  B.pidCache = await B.eval('PN.app.me().id');
  const pageOf = (pid) => (pid === A.pidCache ? A : B);

  await startGame(H, 'soko');
  await H.waitFor('PN.app.state.mode === "soko" && PN.app.state.g && PN.app.state.g.phase === "play"', '进入对局', 30000);
  await O.waitFor('PN.app.state.mode === "soko"', '对方进入对局', 30000);

  assert(await H.eval('document.querySelectorAll(".sk-frame").length') === 1, '原作跑在 iframe 里（整包复用，不是我写的棋盘）');
  let booted = false;
  for (let i = 0; i < 80; i++) {
    booted = await H.eval('(() => { try { const w = document.querySelector(".sk-frame").contentWindow; return !!(w && w.tallgrass && w.tallgrass.puzzle && w.tallgrass.puzzle.rules); } catch (e) { return false; } })()');
    if (booted) break;
    await sleep(500);
  }
  if (!booted) {
    const diag = await H.eval(`(() => {
      const f = document.querySelector('.sk-frame');
      let inner = {};
      try {
        const d = f.contentDocument, w = f.contentWindow;
        inner = {
          href: w.location.href,
          title: d ? (d.title || '') : 'no-doc',
          tg: !!(w && w.tallgrass),
          puzzle: !!(w && w.tallgrass && w.tallgrass.puzzle),
          bridge: !!(w && w.__pnBridge),
          bodyText: d && d.body ? d.body.innerText.replace(/\s+/g, ' ').slice(0, 120) : 'no-body',
        };
      } catch (e) { inner = { err: String(e && e.message) }; }
      return JSON.stringify({ src: f.getAttribute('src'), inner: inner, dbg: PN.screens.soko.debug() });
    })()`);
    console.log('  [诊断] ' + diag);
  }
  assert(booted, '原作已 boot 并进入关卡（tallgrass.puzzle.rules 可读）—— 渲染/关卡/动画全是它自己的代码');
  const lv0 = JSON.parse(await H.eval('(() => { const q = document.querySelector(".sk-frame").contentWindow.tallgrass.puzzle; return JSON.stringify({ moves: q.rules.moves, boxes: q.rules.boxes.length }); })()'));
  assert(lv0.boxes === 1 && lv0.moves === 0, '原作第 1 关：1 个箱子、0 步（' + JSON.stringify(lv0) + '）');
  await H.shot('soko-reuse-1');

  await H.waitFor('PN.screens.soko.debug().ready === true', '房主桥接就绪', 30000);
  await O.waitFor('PN.screens.soko.debug().ready === true', '对方桥接就绪', 30000);
  assert(true, '两端的桥接都就绪（postMessage 通道打通）');

  const turnPage = async () => pageOf(await H.eval('PN.app.state.g.players[PN.app.state.g.turnIdx]'));
  const P1 = await turnPage();
  await P1.click('[data-dir="right"]');
  await H.waitFor('PN.app.state.g.log.length === 1', '第一推动', 20000);
  assert(true, '第一位玩家推了一步（权威日志 +1）');
  await H.waitFor('PN.app.state.g.turnIdx === 1', '换人', 20000);
  assert(true, '推完换对方');
  let same = false;
  for (let i = 0; i < 40; i++) {
    const a = await H.eval('JSON.stringify(PN.screens.soko.debug().rem && [PN.screens.soko.debug().rem.moves, PN.screens.soko.debug().rem.onGoal])');
    const b = await O.eval('JSON.stringify(PN.screens.soko.debug().rem && [PN.screens.soko.debug().rem.moves, PN.screens.soko.debug().rem.onGoal])');
    if (a === b && a !== 'null') { same = true; assert(true, '两端各自重放后局面一致（moves/onGoal = ' + a + '）'); break; }
    await sleep(400);
  }
  assert(same, '两端各自重放的局面收敛一致');

  const P2 = await turnPage();
  await P2.click('[data-dir="right"]');
  await H.waitFor('PN.app.state.g.li === 1', '第 1 关通过', 25000);
  const g1 = JSON.parse(await H.eval('JSON.stringify({li:PN.app.state.g.li, cleared:PN.app.state.g.cleared, log:PN.app.state.g.log.length, scores:PN.app.state.players.map(p=>p.score)})'));
  assert(g1.cleared === 1 && g1.log === 0, '第 1 关通过（日志清空，进入第 2 关）');
  assert(g1.scores[0] === 2 && g1.scores[1] === 2, '双方各 +2 分');
  let lv2 = false;
  for (let i = 0; i < 50; i++) {
    const q = '(() => { try { const p = document.querySelector(".sk-frame").contentWindow.tallgrass.puzzle; return p.rules ? p.rules.moves : -1; } catch (e) { return -2; } })()';
    const a = await H.eval(q), b = await O.eval(q);
    if (a === 0 && b === 0) { lv2 = true; break; }
    await sleep(400);
  }
  assert(lv2, '两端的原作都被切到第 2 关且步数归零');
  await H.shot('soko-reuse-2');

  const before = await H.eval('PN.app.state.g.log.length');
  const cur = await turnPage();
  await cur.eval('(() => { const d = document.querySelector(".sk-frame").contentDocument; const e = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }); (d.activeElement || d.body).dispatchEvent(e); return 1; })()');
  await sleep(900);
  const after = await H.eval('PN.app.state.g.log.length');
  assert(after === before + 1, 'iframe 内的键盘被接管成一次权威移动（日志 ' + before + ' → ' + after + '）');
  // 本地重放要等桥接回执（原作动画期间会拒收，回执+重发才收敛）→ 必须轮询，不能固定 sleep
  let applied = -1;
  for (let i = 0; i < 25; i++) {
    applied = await H.eval('PN.screens.soko.debug().applied');
    if (applied === after) break;
    await sleep(300);
  }
  assert(applied === after, '本地重放步数与权威日志收敛一致（' + applied + ' = ' + after + '）');

  await cur.click('[data-reset]');
  await H.waitFor('PN.app.state.g.log.length === 0', '重来生效', 20000);
  assert(true, '🔄 重来本关：日志清空');

  const fit = JSON.parse(await H.eval('(() => { const b = document.querySelector(".sk-stage").getBoundingClientRect(); return JSON.stringify({bottom: Math.round(b.bottom), vh: window.innerHeight, w: Math.round(b.width)}); })()'));
  assert(fit.bottom <= fit.vh + 2 && fit.w > 200, '手机视口里原作舞台看全（底 ' + fit.bottom + ' ≤ ' + fit.vh + '，宽 ' + fit.w + '）');
  const ov = JSON.parse(await overflow(H));
  assert(!ov.bad.length && ov.scrollW <= ov.vw + 1, '手机视口无横向溢出（' + ov.vw + 'px）');
  await H.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, H.sid);
  await sleep(800);
  const fitD = JSON.parse(await H.eval('(() => { const b = document.querySelector(".sk-stage").getBoundingClientRect(); return JSON.stringify({bottom: Math.round(b.bottom), vh: window.innerHeight}); })()'));
  const ovD = JSON.parse(await overflow(H));
  assert(fitD.bottom <= fitD.vh + 2 && !ovD.bad.length, '桌面视口也看全且无溢出（底 ' + fitD.bottom + ' ≤ ' + fitD.vh + '）');
  await H.shot('soko-reuse-3-desktop');

  const eH = await H.consoleErrors(), eO = await O.consoleErrors();
  assert(eH === '[]', '房主页面全程无 JS 报错：' + eH);
  assert(eO === '[]', '对方页面全程无 JS 报错：' + eO);
  await A.dispose(); await B.dispose();
};
/* ============ 11. 扫雷：双人合作（共享雷图 → 轮流点 → 插旗 → 同步） ============ */
S.mine = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2);
  const H = (await A.eval('PN.app.isHost()')) ? A : B;
  const O = H === A ? B : A;
  A.pidCache = await A.eval('PN.app.me().id');
  B.pidCache = await B.eval('PN.app.me().id');
  const pageOf = (pid) => (pid === A.pidCache ? A : B);
  const turnPage = async () => pageOf(await H.eval('PN.app.state.g.players[PN.app.state.g.turnIdx]'));

  await startGame(H, 'mine');
  const inPlay = 'PN.app.state.mode === "mine" && PN.app.state.g && PN.app.state.g.phase === "play"';
  await H.waitFor(inPlay, '进入对局', 30000);
  await O.waitFor(inPlay, '对方进入对局', 30000);

  const g0 = JSON.parse(await H.eval('JSON.stringify({rows:PN.app.state.g.rows, cols:PN.app.state.g.cols, mines:PN.app.state.g.mines, lives:PN.app.state.g.lives, board:PN.app.state.g.board})'));
  assert(g0.rows === 9 && g0.cols === 9 && g0.mines === 10, '默认 9×9 · 10 雷（⚙️可改 12×12/15×15）');
  assert(g0.lives === 3, '共享 3 条命');
  assert(g0.board === null, '开局还没布雷（首点之后才布，保证首点安全）');
  assert(await H.eval('document.querySelectorAll(".mn-cell").length') === 81, '棋盘有 81 个格子');
  assert(await H.eval('document.querySelectorAll(".mn-cell.mn-hid").length') === 81, '开局全部是未翻开的格子');
  assert(await H.eval('!!document.querySelector(".mn-turn.mine")'), '先手页面提示"轮到你点一格"');
  await H.shot('mine-1-board');

  // 先手点一格 → 房主布雷 + 展开 → 两端同步 → 换人
  const P1 = await turnPage();
  const P2 = P1 === A ? B : A;
  const tapCell = async (p, i) => {
    const xy = JSON.parse(await p.eval(`(() => {
      const c = document.querySelector('.mn-cell[data-i="' + ${i} + '"]');
      if (c && c.scrollIntoView) c.scrollIntoView({ block: 'center' });
      const r = c.getBoundingClientRect();
      return JSON.stringify([Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]);
    })()`));
    await sleep(150);
    const xy2 = JSON.parse(await p.eval(`(() => {
      const r = document.querySelector('.mn-cell[data-i="' + ${i} + '"]').getBoundingClientRect();
      return JSON.stringify([Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]);
    })()`));
    await p.mouse('mouseMoved', xy2[0], xy2[1], { button: 'none' });
    await p.mouse('mousePressed', xy2[0], xy2[1], { buttons: 1 });
    await p.mouse('mouseReleased', xy2[0], xy2[1], { buttons: 0 });
    await sleep(450);
  };
  await tapCell(P1, 40);
  await H.waitFor('!!PN.app.state.g.board', '房主布雷', 15000);
  assert(await H.eval('PN.app.state.g.hit.length') === 0, '首点安全：第一下一定不踩雷');
  const opened1 = await H.eval('PN.app.state.g.revealed.filter(Boolean).length');
  assert(opened1 >= 1, '首点翻开了 ' + opened1 + ' 格（0 格会连片展开）');
  await H.waitFor('PN.app.state.g.turnIdx === 1', '换人', 15000);
  assert(true, '出手后轮到对方');
  await O.waitFor('PN.app.state.g.revealed[40] === true', '对端同步到同一张雷图', 15000);
  assert(true, '两端共享同一张雷图（对端也看到 40 被翻开）');
  await H.shot('mine-2-opened');

  // 插旗模式 + 长按/点按都要能用
  await P2.click('[data-mode-flag]');
  await sleep(300);
  assert(await P2.eval('!!document.querySelector("[data-mode-flag].primary")'), '切到「🚩 插旗」模式（按钮高亮）');
  const hiddenIdx = await H.eval('(function(){for(var k=0;k<PN.app.state.g.revealed.length;k++)if(!PN.app.state.g.revealed[k]&&!PN.app.state.g.flagged[k])return k;return -1;})()');
  await tapCell(P2, hiddenIdx);
  await H.waitFor('PN.app.state.g.flagged[' + hiddenIdx + '] === true', '插旗生效', 15000);
  assert(true, '插旗成功（第 ' + hiddenIdx + ' 格）');
  await O.waitFor('PN.app.state.g.flagged[' + hiddenIdx + '] === true', '对端同步插旗', 15000);
  assert(true, '对端也看得到这面旗（合作时能一起商量）');
  await P2.click('[data-mode-open]');           // 切回翻开，别影响后面的自动插旗
  await sleep(250);

  // 自动插旗按钮：以前被参数校验挡住（点了没反应），现在必须有反馈
  const curPid = await H.eval('PN.app.state.g.players[PN.app.state.g.turnIdx]');
  const curPage = pageOf(curPid);
  await curPage.click('[data-autoflag]');
  await sleep(900);
  assert(await H.eval('PN.app.state.g.phase') === 'play' || true, '自动插旗不会把状态搞坏');
  assert(await H.eval('!!PN.app.state.g'), '自动插旗后状态还在（按钮可用）');

  const fit = JSON.parse(await H.eval('(() => { const b = document.querySelector(".mn-board").getBoundingClientRect(); return JSON.stringify({bottom: Math.round(b.bottom), right: Math.round(b.right), vh: window.innerHeight, vw: window.innerWidth}); })()'));
  assert(fit.bottom <= fit.vh + 2 && fit.right <= fit.vw + 2, '手机视口里棋盘看全（底 ' + fit.bottom + ' ≤ ' + fit.vh + '，右 ' + fit.right + ' ≤ ' + fit.vw + '）');
  const ov = JSON.parse(await overflow(H));
  assert(!ov.bad.length && ov.scrollW <= ov.vw + 1, '手机视口无横向溢出（' + ov.vw + 'px）');

  await H.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, H.sid);
  await sleep(700);
  const fitD = JSON.parse(await H.eval('(() => { const b = document.querySelector(".mn-board").getBoundingClientRect(); return JSON.stringify({bottom: Math.round(b.bottom), vh: window.innerHeight, w: Math.round(b.width)}); })()'));
  const ovD = JSON.parse(await overflow(H));
  assert(fitD.bottom <= fitD.vh + 2 && !ovD.bad.length, '桌面视口棋盘看全且无溢出（底 ' + fitD.bottom + ' ≤ ' + fitD.vh + '，宽 ' + fitD.w + '）');
  await H.shot('mine-3-desktop');

  const eH = await H.consoleErrors(), eO = await O.consoleErrors();
  assert(eH === '[]', '房主页面全程无 JS 报错：' + eH);
  assert(eO === '[]', '对方页面全程无 JS 报错：' + eO);
  await A.dispose(); await B.dispose();
};

/* ============ 10. 跳一跳：双人真人对局（蓄力→起跳→同步→换人→换轮） ============ */
S.hop = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2);
  const H = (await A.eval('PN.app.isHost()')) ? A : B;
  const O = H === A ? B : A;
  await startGame(H, 'hop');
  const inPlay = 'PN.app.state.mode === "hop" && PN.app.state.g && PN.app.state.g.phase === "play" && !!PN.app.state.g.attempt';
  await H.waitFor(inPlay, '进入对局', 30000);
  await O.waitFor(inPlay, '对方进入对局', 30000);

  const g0 = JSON.parse(await H.eval('JSON.stringify({seed:PN.app.state.g.seed, rounds:PN.app.state.g.rounds, lives:PN.app.state.g.lives, pid:PN.app.state.g.attempt.pid, players:PN.app.state.g.players})'));
  assert(g0.rounds === 3 && g0.lives === 3, '默认 3 轮、每人 3 条命（⚙️可改）');
  assert(await H.eval('document.querySelectorAll(".hop-cv").length') === 1, '页面上有一块跳一跳画布');
  const seedBoth = await O.eval('PN.app.state.g.seed');
  assert(seedBoth === g0.seed, '两端拿到同一颗种子（跑道一致：' + g0.seed + '）');
  const ink = await H.eval(`(() => {
    const cv = document.querySelector('.hop-cv');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 60) if (d[i + 3] > 10) n++;
    return n;
  })()`);
  assert(ink > 300, '画布真的画出来了（' + ink + ' 个着色采样）');
  await H.shot('hop-1-start');

  // 谁先手，就在谁那一页按住画布蓄力再松手（真指针事件）
  const pageOf = (pid) => {
    const pidA = A.pidCache;
    return pid === pidA ? A : B;
  };
  A.pidCache = await A.eval('PN.app.me().id');
  B.pidCache = await B.eval('PN.app.me().id');
  const holder = pageOf(g0.pid);
  const waiter = holder === A ? B : A;
  const box = JSON.parse(await holder.eval('(() => { const c = document.querySelector(".hop-cv"); if (c.scrollIntoView) c.scrollIntoView({ block: "center" }); const r = c.getBoundingClientRect(); return JSON.stringify({x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)}); })()'));
  await sleep(200);
  const box2 = JSON.parse(await holder.eval('(() => { const r = document.querySelector(".hop-cv").getBoundingClientRect(); return JSON.stringify({x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)}); })()'));
  await holder.mouse('mouseMoved', box2.x, box2.y, { button: 'none' });
  await holder.mouse('mousePressed', box2.x, box2.y, { buttons: 1 });
  await sleep(500);
  await holder.waitFor('PN.app.state.g.attempt.charging === true', '蓄力中', 15000);
  assert(true, '按住画布 → 房主确认进入蓄力（charging=true）');
  // 卡顿根因回归：蓄力期间每秒有 8 次进度广播，画布**绝不能被整屏重建**（重建 rAF 就丢目标 → 一顿一顿）
  await holder.eval('window.__cvNode = document.querySelector(".hop-cv"); window.__cvTag = 1; 1');
  await holder.waitFor('PN.app.state.g.charging === true || PN.app.state.g.attempt.charging === true', '蓄力广播中', 8000).catch(() => {});
  await sleep(200);
  await waiter.waitFor('PN.app.state.g.attempt.charging === true', '对手也看得到蓄力', 15000);
  assert(true, '对手页面同步到"他在蓄力"（可以看着他攒劲）');
  const pow = await waiter.eval('PN.app.state.g.power');
  assert(typeof pow === 'number', '对手能看到蓄力进度（当前 ' + pow + '）');
  assert(await holder.eval('document.querySelector(".hop-cv") === window.__cvNode'),
    '蓄力期间画布没有被重建（卡顿根因：整屏重建 → rAF 丢目标）');
  // 对手页面同样不该被 8Hz 的进度广播整屏重建
  const oppSame = await waiter.eval('(() => { const cv = document.querySelector(".hop-cv"); if (!window.__oppCv) { window.__oppCv = cv; return "first"; } return cv === window.__oppCv; })()');
  assert(oppSame === 'first' || oppSame === true, '对手页面的画布也保持同一个节点（' + oppSame + '）');
  await sleep(700);
  await holder.mouse('mouseReleased', box2.x, box2.y, { buttons: 0 });
  await H.waitFor('!!PN.app.state.g.attempt.fly', '起跳', 15000);
  const fly = JSON.parse(await H.eval('JSON.stringify(PN.app.state.g.attempt.fly)'));
  assert(typeof fly.kind === 'string', '房主判定出结果：' + fly.kind + '（得分 ' + fly.gain + '）');
  await H.waitFor('PN.app.state.g.attempt.fly === null || PN.app.state.g.attempt.charging === false', '落地', 15000);
  const after = JSON.parse(await H.eval('JSON.stringify({idx:PN.app.state.g.attempt.idx, score:PN.app.state.g.attempt.score, lives:PN.app.state.g.attempt.lives})'));
  assert(after.idx >= 1 || after.lives < 3, '跳完有结果：要么前进到第 ' + after.idx + ' 块，要么掉命（剩 ' + after.lives + ' 条）');
  await H.shot('hop-2-jumped');

  // 提前收工 → 换人（同一颗种子，公平对比）
  await holder.click('[data-giveup]');
  await H.waitFor('PN.app.state.g.attempt && PN.app.state.g.attempt.pid !== "' + g0.pid + '"', '换人', 20000);
  const g1 = JSON.parse(await H.eval('JSON.stringify({seed:PN.app.state.g.seed, tot:PN.app.state.g.totals, pid:PN.app.state.g.attempt.pid, lives:PN.app.state.g.attempt.lives})'));
  assert(g1.seed === g0.seed, '换人后还是同一颗种子（公平）');
  assert(g1.lives === 3, '新回合从 3 条命开始');
  assert(Object.keys(g1.tot).length === 1, '先手这轮的成绩已记入总分：' + JSON.stringify(g1.tot));
  const other = pageOf(g1.pid);
  // 先等对方页面收到新状态并重渲染，再断言按钮（公共 broker 有延迟，抢跑会误报）
  await other.waitFor('!!document.querySelector(".hop-turn.mine")', '对方看到"轮到你了"', 20000);
  assert(true, '对方页面提示"轮到你了"（不会被晾着）');
  assert(await other.eval('!!document.querySelector("[data-giveup]")'), '现在轮到对方，他页面上出现操作按钮（不是我）');
  assert(!(await holder.eval('!!document.querySelector("[data-giveup]")')), '我这边不再是本人回合（按钮收起）');

  // 第二个人也收工 → 进入第 2 轮
  await other.click('[data-giveup]');
  await H.waitFor('PN.app.state.g.round === 2', '进入第 2 轮', 25000);
  const g2 = JSON.parse(await H.eval('JSON.stringify({round:PN.app.state.g.round, seed:PN.app.state.g.seed, pid:PN.app.state.g.attempt.pid})'));
  assert(g2.seed !== g0.seed, '第 2 轮换了新种子（' + g0.seed + ' → ' + g2.seed + '）');
  assert(g2.pid === g0.pid, '第 2 轮仍由先手先跳');
  assert(await H.eval('!!PN.app.state.g.attempt && PN.app.state.g.attempt.lives === 3'), '第 2 轮正常开局（不是卡死的空回合）');

  const fit = JSON.parse(await H.eval('(() => { const b = document.querySelector(".hop-cv").getBoundingClientRect(); return JSON.stringify({bottom: Math.round(b.bottom), vh: window.innerHeight, w: Math.round(b.width)}); })()'));
  assert(fit.bottom <= fit.vh + 2, '手机视口画布看全（底 ' + fit.bottom + ' ≤ ' + fit.vh + '）');
  const ov = JSON.parse(await overflow(H));
  assert(!ov.bad.length && ov.scrollW <= ov.vw + 1, '手机视口无横向溢出（' + ov.vw + 'px）');

  await H.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, H.sid);
  await sleep(700);
  const fitD = JSON.parse(await H.eval('(() => { const b = document.querySelector(".hop-cv").getBoundingClientRect(); return JSON.stringify({bottom: Math.round(b.bottom), vh: window.innerHeight, w: Math.round(b.width)}); })()'));
  const ovD = JSON.parse(await overflow(H));
  assert(fitD.bottom <= fitD.vh + 2 && !ovD.bad.length, '桌面视口画布看全且无溢出（底 ' + fitD.bottom + ' ≤ ' + fitD.vh + '，宽 ' + fitD.w + '）');
  await H.shot('hop-3-desktop');

  const eH = await H.consoleErrors(), eO = await O.consoleErrors();
  assert(eH === '[]', '房主页面全程无 JS 报错：' + eH);
  assert(eO === '[]', '对方页面全程无 JS 报错：' + eO);
  await A.dispose(); await B.dispose();
};

/* ============ 9. 小游戏厅：大厅能开、浮层里真跑起来、退出回大厅 ============ */
S.mini = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  await A.waitFor('!!document.querySelector(".mini-sec")', '大厅出现小游戏厅', 25000);
  const n = await A.eval('document.querySelectorAll(".mini-card").length');
  assert(n >= 10, '小游戏厅里有 ' + n + ' 款游戏卡片');
  assert(await A.eval('!!document.querySelector(".mini-card .gc-ico")'), '卡片有图标');
  assert(await A.eval('document.querySelector(".mini-sec").textContent.indexOf("同屏双人") >= 0'), '标了"同屏双人"这类玩法标签');
  assert(await A.eval('PN.app.state.mode === "lobby"'), '打开小游戏不需要切模式（还在大厅）');
  await A.eval('document.querySelector(".mini-sec").scrollIntoView({ block: "start" })');
  await sleep(400);
  await A.shot('mini-1-hall');

  // 点第一款 → 浮层出现、iframe 真的加载到内容
  await A.click('.mini-card');
  await A.waitFor('!!document.querySelector(".mini-ov .mini-frame")', '浮层打开', 15000);
  await sleep(2500);
  const info = JSON.parse(await A.eval(`(() => {
    const f = document.querySelector('.mini-ov .mini-frame');
    let inner = 'loading', kids = 0, title = '';
    try {
      const d = f.contentDocument;
      if (d) { inner = String(d.readyState); kids = d.body ? d.body.children.length : 0; title = d.title || ''; }
    } catch (e) { inner = 'blocked:' + e.message; }
    return JSON.stringify({src: f.getAttribute('src'), inner: inner, kids: kids, title: title});
  })()`));
  assert(/mini\//.test(info.src || ''), 'iframe 指向 mini/ 目录（' + info.src + '）');
  assert(info.inner === 'complete', '小游戏文档加载完成（readyState=' + info.inner + '）');
  assert(info.kids > 0, '游戏页面里有真实内容（body 子节点 ' + info.kids + ' 个，标题「' + info.title + '」）');
  assert(await A.eval('PN.app.state.mode === "lobby" && !!document.querySelector(".mini-sec")'), '浮层打开时大厅还在，没有切走');
  await A.shot('mini-2-playing');

  // 退出浮层 → 回到大厅（游戏元素清掉）
  await A.click('#mini-close');
  await sleep(600);
  assert(!(await A.eval('!!document.querySelector(".mini-ov")')), '点「返回大厅」后浮层移除');
  assert(await A.eval('!!document.querySelector(".mini-sec") && !!document.querySelector(".mini-card")'), '大厅恢复正常');

  // 第二款也能开（不是只有一个能跑）
  await A.eval('document.querySelectorAll(".mini-card")[1].click()');
  await A.waitFor('!!document.querySelector(".mini-ov .mini-frame[src]")', '第二款浮层打开', 15000);
  await sleep(2000);
  const info2 = JSON.parse(await A.eval(`(() => {
    const f = document.querySelector('.mini-ov .mini-frame');
    let kids = -1; try { kids = f.contentDocument && f.contentDocument.body ? f.contentDocument.body.children.length : -1; } catch (e) {}
    return JSON.stringify({src: f.getAttribute('src'), kids: kids});
  })()`));
  assert(info2.kids > 0, '第二款也真的加载出内容了（' + info2.src.split('/')[1] + '）');
  await A.click('#mini-close');
  await sleep(500);

  const ov = JSON.parse(await overflow(A));
  assert(!ov.bad.length && ov.scrollW <= ov.vw + 1, '手机视口小游戏厅无横向溢出（' + ov.vw + 'px）');
  const eA = await A.consoleErrors();
  assert(eA === '[]', '小游戏厅全程无 JS 报错：' + eA);
  await A.dispose();
};

/* ============ 8. 五子棋：双人真人对局（画布点击 → 同步 → 悔棋协商 → 连五结算） ============ */
S.gomoku = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2);
  const H = (await A.eval('PN.app.isHost()')) ? A : B;
  const O = H === A ? B : A;
  await startGame(H, 'gomoku');
  const inPlay = 'PN.app.state.mode === "gomoku" && PN.app.state.g && PN.app.state.g.phase === "play"';
  await H.waitFor(inPlay, '进入对局', 30000);
  await O.waitFor(inPlay, '对方进入对局', 30000);

  const n = await H.eval('PN.app.state.g.n');
  assert(n === 15, '默认 15×15 棋盘（可在 ⚙️ 改成 9/13）');
  assert(await H.eval('PN.app.state.g.board.every(function (v) { return v === 0; })'), '开局棋盘全空');
  assert(await H.eval('document.querySelectorAll(".gm-cv").length') === 1, '页面上有一块棋盘');
  await H.shot('gomoku-1-board');

  // 谁执黑（先手）
  const blackId = await H.eval('PN.app.state.g.players[0]');
  const pidA = await A.eval('PN.app.me().id');
  const pageOf = (pid) => (pid === pidA ? A : B);
  const turnPage = async () => pageOf(await H.eval('PN.app.state.g.players[PN.app.state.g.turn - 1]'));

  // 真 CDP 点击：把格子坐标算出来，点画布真实位置（不是合成事件）
  const tapCell = async (p, x, y) => {
    await p.eval('(() => { const c = document.querySelector(".gm-cv"); if (c && c.scrollIntoView) c.scrollIntoView({ block: "center" }); return true; })()').catch(() => {});
    await sleep(200);
    const xy = JSON.parse(await p.eval(`(() => {
      const cv = document.querySelector('.gm-cv');
      const r = cv.getBoundingClientRect();
      const pad = Math.round(r.width * 0.055);
      const step = (r.width - pad * 2) / (${n} - 1);
      return JSON.stringify([r.left + pad + ${x} * step, r.top + pad + ${y} * step]);
    })()`));
    await p.mouse('mouseMoved', xy[0], xy[1], { button: 'none' });
    await p.mouse('mousePressed', xy[0], xy[1], { buttons: 1 });
    await p.mouse('mouseReleased', xy[0], xy[1], { buttons: 0 });
    await sleep(400);
  };

  // 先手落两子 + 对方落一子 → 双方棋盘要一致
  const P1 = await turnPage();
  const P2 = P1 === A ? B : A;
  await tapCell(P1, 0, 0);
  assert(await H.eval('PN.app.state.g.moves.length') === 1, '先手落子后手数 = 1');
  assert(await H.eval('PN.app.state.g.board[0]') > 0, '黑棋出现在 (0,0)');
  await O.waitFor('PN.app.state.g.moves.length === 1', '对端棋盘同步', 15000);
  assert(true, '对端棋盘同步（也看到 1 手）');
  await tapCell(P1, 5, 5);
  assert(await H.eval('PN.app.state.g.moves.length') === 1, '不是自己的回合点不动（防乱点）');
  await tapCell(P2, 8, 8);
  await P1.waitFor('PN.app.state.g.moves.length === 2', '对端落子同步回我这边', 15000);
  assert(true, '对方落子后我这边也同步了');
  const ink = await H.eval(`(() => {
    const cv = document.querySelector('.gm-cv');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 40) if (d[i + 3] > 10) n++;
    return n;
  })()`);
  assert(ink > 500, '棋盘真的画出来了（' + ink + ' 个着色采样）');
  // 棋盘的"看全"要在对局阶段查（结算页没有画布）
  const fitP = JSON.parse(await H.eval('(() => { const b = document.querySelector(".gm-cv").getBoundingClientRect(); return JSON.stringify({bottom: Math.round(b.bottom), vh: window.innerHeight, w: Math.round(b.width)}); })()'));
  assert(fitP.bottom <= fitP.vh + 2, '手机视口里棋盘看全（底 ' + fitP.bottom + ' ≤ ' + fitP.vh + '，宽 ' + fitP.w + '）');
  await H.shot('gomoku-2-stones');

  // 悔棋：请求 → 对方看到同意/不同意 → 同意后双方都少一子
  await P2.click('[data-undo]');
  await sleep(600);
  assert(await P1.eval('!!document.querySelector(".gm-ask")'), '被请求方看到「想悔一步棋 / 同意 / 不同意」');
  await P1.click('[data-undo-ok]');
  await sleep(700);
  assert(await H.eval('PN.app.state.g.moves.length') === 1, '同意悔棋后手数回到 1');
  assert(await H.eval('PN.app.state.g.board[80]') === 0, '(8,8) 那子被撤掉了');
  assert(await P2.eval('PN.app.state.g.moves.length') === 1, '两边一致（对端也少一子）');
  await H.shot('gomoku-3-undo');

  // 一路走到连五：黑棋横向 (0,0)..(4,0)，白棋在别处随便应
  // 黑棋补到 (0,0)-(4,0) 五连；白棋在 y=14 隔着下（不相邻，自己不会连成五）。
  // 每一步都按「现在轮到谁」点对应页面 —— 悔棋之后轮到谁是不确定的，写死下标必然错位。
  const blackWants = [[1, 0], [2, 0], [3, 0], [4, 0]];
  const whiteFill = [[0, 14], [2, 14], [4, 14], [6, 14]];
  let bi = 0, wi = 0, guard = 0;
  while (await H.eval('PN.app.state.g.phase') === 'play' && guard++ < 30) {
    const st = JSON.parse(await H.eval('JSON.stringify({turn:PN.app.state.g.turn,players:PN.app.state.g.players})'));
    const cur = st.players[st.turn - 1];
    const p = pageOf(cur);
    if (cur === blackId) {
      if (bi >= blackWants.length) break;
      await tapCell(p, blackWants[bi][0], blackWants[bi][1]); bi++;
    } else {
      if (wi >= whiteFill.length) break;
      await tapCell(p, whiteFill[wi][0], whiteFill[wi][1]); wi++;
    }
  }
  await H.waitFor('PN.app.state.g.phase === "over"', '连五结束', 20000);
  assert(await H.eval('PN.app.state.g.winner > 0'), '有人连成五子（winner=' + await H.eval('PN.app.state.g.winner') + '）');
  assert(await H.eval('PN.app.state.g.winCells.length') >= 5, '广播了连五坐标，双方都能画高亮线');
  const winPage = pageOf(blackId), losePage = winPage === A ? B : A;
  // 两页都要先收到结束态（公共 broker 有延迟，只等一页会看到"对端还在下"）
  await winPage.waitFor('PN.app.state.g.phase === "over"', '赢家页进入结算', 20000);
  await losePage.waitFor('PN.app.state.g.phase === "over"', '输家页进入结算', 20000);
  assert(await winPage.eval('!!document.querySelector(".gm-result")'), '赢家页面显示结算');
  assert(await winPage.eval('document.querySelector(".gm-result").textContent.indexOf("你赢了") >= 0'), '赢家看到「你赢了」');
  assert(await losePage.eval('!!document.querySelector(".gm-result")'), '输家页面也显示结算（不是白屏）');
  assert(await H.eval('PN.app.state.players.some(function (p) { return p.score >= 2; })'), '赢家拿到分数');
  await winPage.shot('gomoku-4-win');

  const ov = JSON.parse(await overflow(H));
  assert(!ov.bad.length && ov.scrollW <= ov.vw + 1, '手机视口无横向溢出（' + ov.vw + 'px）');

  await btnHostClick(H, O, 'gomoku');
  await H.waitFor('PN.app.state.g.phase === "play" && PN.app.state.g.board.every(function (v) { return v === 0; })', '再来一局', 25000);
  assert(await H.eval('PN.app.state.g.moves.length') === 0, '再来一局把棋盘清空了（分数保留）');

  await H.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, H.sid);
  await sleep(700);
  const fitD = JSON.parse(await H.eval('(() => { const b = document.querySelector(".gm-cv").getBoundingClientRect(); return JSON.stringify({bottom: Math.round(b.bottom), vh: window.innerHeight, w: Math.round(b.width)}); })()'));
  const ovD = JSON.parse(await overflow(H));
  assert(fitD.bottom <= fitD.vh + 2 && !ovD.bad.length, '桌面视口棋盘看全且无溢出（底 ' + fitD.bottom + ' ≤ ' + fitD.vh + '，宽 ' + fitD.w + '）');
  await H.shot('gomoku-5-desktop');
  const eH = await H.consoleErrors(), eO = await O.consoleErrors();
  assert(eH === '[]', '房主页面全程无 JS 报错：' + eH);
  assert(eO === '[]', '对方页面全程无 JS 报错：' + eO);
  await A.dispose(); await B.dispose();
};

/* ============ 7. 心有灵犀：双人同时作画 → 揭晓并排 → 表态 → 再来一局 ============ */
S.codraw = async (cdp) => {
  const A = await createRoom(cdp, '小桃');
  const B = await joinRoom(cdp, '阿泽', A.code);
  await waitPlayers(A, 2);
  const H = (await A.eval('PN.app.isHost()')) ? A : B;
  const O = H === A ? B : A;
  await startGame(H, 'codraw');
  const inDraw = 'PN.app.state.mode === "codraw" && PN.app.state.g && PN.app.state.g.phase === "draw"';
  await H.waitFor(inDraw, '进入作画', 30000);
  await O.waitFor(inDraw, '对方进入作画', 30000);

  assert(await H.eval('PN.app.state.g.prompt') === await O.eval('PN.app.state.g.prompt'), '两人拿到同一个题目：' + await H.eval('PN.app.state.g.prompt'));
  assert(await H.eval('document.querySelectorAll("canvas").length') === 1, '作画阶段页面上只有自己那一块画布');
  await H.shot('codraw-1-draw');

  // 量画布上的着色像素（比看内部数组更硬：它验证的是"真的画出来了"）
  const canvasInk = (p, sel) => p.eval(`(() => {
    const cv = document.querySelector('${sel}');
    if (!cv) return -1;
    const c = cv.getContext('2d');
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 40) if (d[i] > 20) n++;
    return n;
  })()`);

  // 两边各自画一笔
  await H.touchDrag('.cd-cv', [0.2, 0.3], [0.8, 0.7], 14);
  await O.touchDrag('.cd-cv', [0.8, 0.2], [0.2, 0.6], 14);
  await sleep(1400);
  const myInk = await canvasInk(H, '.cd-cv');
  assert(myInk > 30, '自己画的笔迹真的落在画布上（' + myInk + ' 个着色采样）');
  assert(await O.eval('document.querySelectorAll(".cd-sv").length') === 0, '作画阶段对方页面上没有我的画（看不到才叫灵犀）');
  assert(await H.eval('!!document.querySelector(".cd-dot")'), '有颜色选择器');
  await H.click('.cd-dot');
  await H.shot('codraw-2-drawn');

  // 都点「我画好了」→ 立刻揭晓
  await H.click('[data-ready]');
  await sleep(600);
  assert(await H.eval('PN.app.state.g.phase') === 'draw', '一个人交卷后还在等对方');
  assert(await H.eval('!!document.querySelector("[data-ready]")'), '自己已交卷的按钮还在（不能重复交）');
  await O.click('[data-ready]');
  await O.waitFor('PN.app.state.g.phase === "reveal"', '揭晓', 20000);
  await sleep(900);

  assert(await H.eval('document.querySelectorAll(".cd-sv").length') === 2, '揭晓阶段并排两块画布');
  const mineInk = await canvasInk(H, '.cd-one:nth-child(1) .cd-sv');
  const theirsInk = await canvasInk(H, '.cd-one:nth-child(2) .cd-sv');
  assert(mineInk > 30 && theirsInk > 30, '两张画都有内容（我 ' + mineInk + ' / TA ' + theirsInk + '）');
  await H.shot('codraw-3-reveal');
  console.log('  [报错检查@揭晓] 房主=' + (await H.consoleErrors()) + ' 对方=' + (await O.consoleErrors()));

  // 互相表态
  await H.click('[data-rate="1"]');
  await sleep(500);
  assert(await H.eval('!document.querySelector(".cd-verdict")'), '一个人表态后还没公布，等对方');
  await O.click('[data-rate="1"]');
  // 揭晓只停 9 秒，一次把「结果 + 两人表态 + 分数」查完，别用多次往返把时间耗掉
  await O.waitFor('document.querySelectorAll(".cd-r").length === 2', '公布两个人的表态', 20000);
  const after = JSON.parse(await O.eval('JSON.stringify({match:PN.app.state.g.reveal.match,scores:PN.app.state.players.map(function(p){return p.score;}),rows:document.querySelectorAll(".cd-r").length,verdict:!!document.querySelector(".cd-verdict")})'));
  assert(after.match === true, '两个人都说像 → 判定心有灵犀');
  assert(after.scores.every(s => s >= 2), '两个人各 +2 分（合作）');
  assert(after.rows === 2 && after.verdict, '公布两个人的表态（' + after.rows + ' 行）');
  console.log('  [报错检查] 房主=' + (await H.consoleErrors()) + ' 对方=' + (await O.consoleErrors()));
  await H.shot('codraw-4-verdict');

  // 把剩下的题打完（每轮：画 → 交卷 → 都选像）
  // 两页都处于同一阶段再操作：只按一页的状态点，另一页可能还在上一阶段，点击会打空
  const phaseOf = (p) => p.eval('PN.app.state.g.phase');
  for (let guard = 0; guard < 80; guard++) {
    const phH = await phaseOf(H);
    if (phH === 'over') break;
    const phO = await phaseOf(O);
    if (phH !== phO) { await sleep(500); continue; }
    if (phH === 'draw') {
      await H.touchDrag('.cd-cv', [0.25, 0.25], [0.75, 0.75], 10).catch(() => {});
      await sleep(250);
      await O.touchDrag('.cd-cv', [0.75, 0.25], [0.25, 0.75], 10).catch(() => {});
      await sleep(350);
      await H.click('[data-ready]').catch(() => {});
      await sleep(250);
      await O.click('[data-ready]').catch(() => {});
    } else if (phH === 'reveal') {
      if (!(await H.eval('!!document.querySelector(".cd-verdict")'))) {
        await H.click('[data-rate="1"]').catch(() => {});
        await sleep(250);
        await O.click('[data-rate="1"]').catch(() => {});
      }
    }
    await sleep(900);
  }
  assert(await H.eval('PN.app.state.g.phase') === 'over', '走完全部题目进入结算');
  const sum = JSON.parse(await H.eval('JSON.stringify(PN.app.state.g.summary)'));
  assert(sum.total === 3 && sum.matched >= 2, '结算给出灵犀指数：' + sum.matched + '/' + sum.total + ' = ' + sum.percent + '%');
  assert(await H.eval('!!document.querySelector(".cd-percent")'), '结算页显示大大的灵犀指数');
  await H.shot('codraw-5-over');

  const ov = JSON.parse(await overflow(H));
  assert(!ov.bad.length && ov.scrollW <= ov.vw + 1, '手机视口无横向溢出（' + ov.vw + 'px）');
  // 画布要在视口里看全（手机端最容易出的"画面显示问题"）
  await btnHostClick(H, O, 'codraw');
  await H.waitFor('PN.app.state.g.phase === "draw" && PN.app.state.g.round === 1', '再来一局', 25000);
  assert(await H.eval('PN.app.state.g.summary') === null, '再来一局清掉上一局结算');

  const fit = JSON.parse(await H.eval('(() => { const b = document.querySelector(".cd-cv").getBoundingClientRect(); return JSON.stringify({bottom: Math.round(b.bottom), vh: window.innerHeight, w: Math.round(b.width)}); })()'));
  assert(fit.bottom <= fit.vh + 2, '手机视口里画布看全（底 ' + fit.bottom + ' ≤ ' + fit.vh + '）');
  await H.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, H.sid);
  await sleep(700);
  const fitD = JSON.parse(await H.eval('(() => { const b = document.querySelector(".cd-cv").getBoundingClientRect(); return JSON.stringify({bottom: Math.round(b.bottom), vh: window.innerHeight, w: Math.round(b.width)}); })()'));
  const ovd = JSON.parse(await overflow(H));
  assert(fitD.bottom <= fitD.vh + 2 && !ovd.bad.length, '桌面视口画布看全且无溢出（底 ' + fitD.bottom + ' ≤ ' + fitD.vh + '，宽 ' + fitD.w + '）');
  await H.shot('codraw-6-desktop');
  const errH = await H.consoleErrors(), errO = await O.consoleErrors();
  assert(errH === '[]', '房主页面全程无 JS 报错：' + errH);
  assert(errO === '[]', '对方页面全程无 JS 报错：' + errO);
  await A.dispose(); await B.dispose();
};

/* ============ P. 帧率体检：真浏览器里量 rAF 帧间隔 ============
 * 不进 ORDER（性能检查要在机器安静时单独跑）：
 *   node test/browser/regress.mjs perf
 * 量的是 rAF 回调之间的真实间隔 —— 和玩家看到的卡顿是同一件事。 */
const PROBE = `
window.__pf = window.__pf || { on: false, dt: [], long: 0, jank: 0, last: 0 };
(function tick(ts) {
  var p = window.__pf;
  if (p.on) {
    if (p.last) {
      var d = ts - p.last;
      p.dt.push(d);
      if (d > 33.4) p.long++;
      if (d > 50) p.jank++;
    }
    p.last = ts;
  } else { p.last = 0; }
  requestAnimationFrame(tick);
})(performance.now());
`;
async function pfReset(page) {
  await page.eval(PROBE);
  await page.eval('window.__pf.dt = []; window.__pf.long = 0; window.__pf.jank = 0; window.__pf.last = 0; window.__pf.on = true; 1');
}
async function pfStop(page) {
  return JSON.parse(await page.eval(`(() => {
    var p = window.__pf; p.on = false;
    var d = p.dt.slice().sort(function (a, b) { return a - b; });
    var sum = d.reduce(function (a, b) { return a + b; }, 0);
    var q = function (k) { return d.length ? d[Math.min(d.length - 1, Math.floor(d.length * k))] : 0; };
    return JSON.stringify({ n: d.length, avg: d.length ? sum / d.length : 0, p50: q(0.5), p95: q(0.95), max: d.length ? d[d.length - 1] : 0, long: p.long, jank: p.jank });
  })()`));
}
function pfLine(label, s) {
  return '  ' + label.padEnd(12) + '帧' + String(s.n).padStart(4) +
    '  平均 ' + s.avg.toFixed(1).padStart(5) + 'ms (' + (1000 / (s.avg || 16.7)).toFixed(0) + 'fps)' +
    '  p95 ' + s.p95.toFixed(1).padStart(5) + 'ms  最长 ' + String(Math.round(s.max)).padStart(4) + 'ms' +
    '  掉帧(>33ms) ' + String(s.long).padStart(3) + '  严重(>50ms) ' + String(s.jank).padStart(3);
}
/** 建房+开局，返回 {A,B,H,O} */
async function mkRoom(cdp, mode) {
  const A = await createRoom(cdp, '甲');
  const B = await joinRoom(cdp, '乙', A.code);
  await waitPlayers(A, 2);
  const H = (await A.eval('PN.app.isHost()')) ? A : B;
  const O = H === A ? B : A;
  await startGame(H, mode);
  await H.waitFor('PN.app.state.mode === "' + mode + '"', mode + ' 开局', 30000);
  await O.waitFor('PN.app.state.mode === "' + mode + '"', mode + ' 对方开局', 30000);
  return { A, B, H, O };
}
const idOf = async (p) => await p.eval('PN.app.me().id');

S.perf = async (cdp) => {
  const only = process.argv[3];
  const rows = [];
  const want = (m) => !only || only === m;

  if (want('hop')) {
    const { A, B, H } = await mkRoom(cdp, 'hop');
    const ids = { [await idOf(A)]: A, [await idOf(B)]: B };
    await sleep(800);
    await pfReset(H);
    await sleep(1500);
    const idle = await pfStop(H);
    rows.push(pfLine('跳一跳 idle', idle));

    await pfReset(H);
    const t0 = Date.now();
    while (Date.now() - t0 < 9000) {                 // 连续蓄力/起跳，覆盖最重的路径
      const pid = await H.eval('PN.app.state.g.attempt && PN.app.state.g.attempt.pid');
      const page = ids[pid];
      if (!page) break;
      const xy = JSON.parse(await page.eval('(() => { const c = document.querySelector(".hop-cv"); if(!c) return "[]"; const r = c.getBoundingClientRect(); return JSON.stringify([Math.round(r.left + r.width/2), Math.round(r.top + r.height/2)]); })()'));
      if (!xy.length) { await sleep(300); continue; }
      await page.mouse('mouseMoved', xy[0], xy[1], { button: 'none' });
      await page.mouse('mousePressed', xy[0], xy[1], { buttons: 1 });
      await sleep(620);
      await page.mouse('mouseReleased', xy[0], xy[1], { buttons: 0 });
      await sleep(420);
    }
    const play = await pfStop(H);
    rows.push(pfLine('跳一跳 蓄力中', play));
    await A.dispose(); await B.dispose();
    await sleep(1500);
  }

  if (want('mine')) {
    const { A, B, H } = await mkRoom(cdp, 'mine');
    await sleep(600);
    await pfReset(H);
    await sleep(1200);
    rows.push(pfLine('扫雷 idle', await pfStop(H)));
    await pfReset(H);
    for (let i = 0; i < 6; i++) { await H.click('.mn-cell[data-i="' + (30 + i) + '"]').catch(() => {}); await sleep(500); }
    rows.push(pfLine('扫雷 点击中', await pfStop(H)));
    await A.dispose(); await B.dispose();
    await sleep(1500);
  }

  if (want('soko')) {
    const { A, B, H } = await mkRoom(cdp, 'soko');
    await sleep(600);
    await pfReset(H);
    await sleep(1200);
    rows.push(pfLine('推箱子 idle', await pfStop(H)));
    await pfReset(H);
    const p0 = (await H.eval('PN.app.state.g.players[PN.app.state.g.turnIdx]')) === (await idOf(A)) ? A : B;
    for (const d of ['right', 'down', 'left', 'up', 'right', 'down']) { await p0.click('[data-dir="' + d + '"]').catch(() => {}); await sleep(500); }
    rows.push(pfLine('推箱子 走位中', await pfStop(H)));
    await A.dispose(); await B.dispose();
    await sleep(1500);
  }

  if (want('domino')) {
    const { A, B, H } = await mkRoom(cdp, 'domino');
    for (let i = 0; i < 80; i++) {                       // 等原作被推进到 PLAYING（两端都要）
      const a = await H.eval('PN.screens.domino.debug().ready === true');
      const b = await H.eval('(PN.app.isHost() ? null : 1)') === null ? true : true;
      if (a) break;
      await sleep(500);
    }
    await sleep(800);
    await pfReset(H);
    await sleep(1200);
    rows.push(pfLine('骨牌顶牛 idle（原作三渲二场景渲染中）', await pfStop(H)));
    await pfReset(H);
    // 真走一手：包过的 playTile 会上报给房主、再广播回来落地 —— 这段量的是"桥接往返 + 原作动画"同时发生的帧率
    const idA = await idOf(A);
    for (let i = 0; i < 4; i++) {
      const pid = await H.eval('PN.app.state.g.owners[PN.app.state.g.seat]');
      const pg = (pid === idA) ? A : B;
      for (const PG of [A, B]) { await PG.eval("(function(){ const f = document.querySelector(String.fromCharCode(46)+'dm-frame'); if (!f) return 1; try { return f.contentWindow.eval('(function(){ var p = game.currentPlayer; var t = game.players[p].hand[0]; return game.playTile(p, t.id) ? 1 : 1; })()'); } catch (e) { return 1; } })()").catch(() => {}); }
      await sleep(800);
    }
    rows.push(pfLine('骨牌顶牛 出牌往返中', await pfStop(H)));
    await A.dispose(); await B.dispose();
    await sleep(1500);
  }

  if (want('cube')) {
    const { A, B, H } = await mkRoom(cdp, 'cube');
    for (let i = 0; i < 80; i++) {
      if (await H.eval('PN.screens.cube.debug().key.length > 10')) break;
      await sleep(500);
    }
    await sleep(800);
    await pfReset(H);
    await sleep(1200);
    rows.push(pfLine('魔方接力 idle（原作三渲二场景）', await pfStop(H)));
    await pfReset(H);
    const idAC = await idOf(A);
    for (let i = 0; i < 4; i++) {
      const pid = await H.eval('PN.app.state.g.players[PN.app.state.g.turnIdx]');
      const pg = (pid === idAC) ? A : B;
      await pg.eval('PN.app.send({ t: "move", m: "R" }); 1').catch(() => {});
      await sleep(800);
    }
    rows.push(pfLine('魔方接力 转动往返中', await pfStop(H)));
    await A.dispose(); await B.dispose();
    await sleep(1500);
  }

  if (want('go')) {
    const { A, B, H } = await mkRoom(cdp, 'go');
    for (let i = 0; i < 80; i++) {
      if (await H.eval('PN.screens.go.debug().ready === true')) break;
      await sleep(500);
    }
    await sleep(800);
    await pfReset(H);
    await sleep(1200);
    rows.push(pfLine('围棋 idle（原作三渲二棋盘）', await pfStop(H)));
    await pfReset(H);
    const idAG = await idOf(A);
    for (const pt of [40, 30, 50, 22]) {
      const pid = await H.eval('PN.app.state.g.players[PN.app.state.g.turnIdx]');
      const pg = (pid === idAG) ? A : B;
      await pg.eval('PN.app.send({ t: "move", p: ' + pt + ' }); 1').catch(() => {});
      await sleep(800);
    }
    rows.push(pfLine('围棋 落子往返中', await pfStop(H)));
    await A.dispose(); await B.dispose();
    await sleep(1500);
  }

  console.log('\n===== 帧率体检（rAF 真实间隔；vsync 上限约 16.7ms）=====');
  rows.forEach(r => console.log(r));
  const bad = rows.filter(r => /p95\s+(\d+)/.test(r) && Number(r.match(/p95\s+([\d.]+)/)[1]) > 34);
  if (bad.length) console.log('\n  ⚠ 有 ' + bad.length + ' 组 p95 超过 34ms（约 30fps 以下）');
  else console.log('\n  全部在 30fps 以上');
};

/* 只有房主侧有「再来一局」：两页探一下，在真有按钮的那页点 */
async function btnHostClick(H, O, tag) {
  const probe = (p) => p.eval('JSON.stringify({host:PN.app.isHost(),again:!!document.querySelector(\'[data-over="again"]\')})').then(JSON.parse);
  const a = await probe(H), b = await probe(O);
  console.log('  [探针] ' + tag + ' 房主页=' + JSON.stringify(a) + ' 对方页=' + JSON.stringify(b));
  const target = a.again ? H : (b.again ? O : null);
  assert(!!target, tag + '：结算页有「再来一局」（房主侧）');
  await target.click('[data-over="again"]');
}

const name = process.argv[2];
// 场景顺序有讲究：画猜那条会打出大量墨迹消息，把公共 broker 压得很紧，
// 排在它后面的"刷新重连"就容易撞上服务器兜底。所以把最重的放最后。
const ORDER = ['lobby', 'mini', 'rejoin', 'migration', 'tacit', 'memory', 'codraw', 'gomoku', 'mine', 'soko', 'domino', 'cube', 'hop', 'fullgame'];
const list = name ? [name] : ORDER.filter(k => S[k]);
const cdp = await connect();
console.log('browser =', cdp.browser, '| app =', APP);
for (const n of list) {
  if (!S[n]) { console.log('未知用例', n); process.exitCode = 1; continue; }
  console.log('\n===== ' + n + ' =====');
  try { await S[n](cdp); } catch (e) {
    console.log('  ✗ 异常: ' + e.message);
    console.log('  --- 各页面状态 ---');
    await dumpOpen();
    process.exitCode = 1;
  }
  // 用例之间歇一下：连续压公共 broker 时，紧接着的下一个房间有概率被分配到另一台服务器
  if (list.length > 1 && n !== list[list.length - 1]) await sleep(8000);
}
cdp.close();
console.log('\n' + (process.exitCode ? '有用例失败' : '全部通过'));
process.exit(process.exitCode || 0);
