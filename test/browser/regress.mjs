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
  assert(modes === '["drawgame"]', '游戏注册表里只剩「你画我猜」：' + modes);
  assert(await A.eval('!!document.querySelector(".modecard[data-mode=\'drawgame\']")'), '大厅有画猜的入口卡片');
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
  await G.waitFor('PN.app.state && PN.app.state.mode === "drawgame"', '刷新后回到对局', 40000);
  const G2 = G;
  await sleep(2500);
  assert(await G2.eval('PN.app.room.me.id') === gId, '刷新后还是同一个人（身份没丢）');
  assert(await G2.eval('!document.body.innerText.includes("界面出错了")'), '刷新后不会白屏报错');
  const inkAfter = await measure(G2);
  assert(inkAfter >= inkBefore * 0.7, '刷新后笔迹由回放补齐（' + inkAfter + ' vs ' + inkBefore + '）');
  assert(await G2.eval('PN.app.state.players.length') === 2, '名单没有多出重复的人');
  await G2.shot('04-rejoin');
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

const name = process.argv[2];
const list = name ? [name] : Object.keys(S);
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
}
cdp.close();
console.log('\n' + (process.exitCode ? '有用例失败' : '全部通过'));
process.exit(process.exitCode || 0);
