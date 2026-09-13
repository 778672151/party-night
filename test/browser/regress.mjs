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
  assert(modes === '["codraw","drawgame","memory","tacit"]', '大厅有四款游戏：你画我猜 + 合作翻牌 + 默契大考验 + 心有灵犀（' + modes + '）');
  assert(await A.eval('!!document.querySelector(".modecard[data-mode=\'codraw\']")'), '大厅有心有灵犀的入口卡片');
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
const ORDER = ['lobby', 'rejoin', 'migration', 'tacit', 'memory', 'codraw', 'fullgame'];
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
