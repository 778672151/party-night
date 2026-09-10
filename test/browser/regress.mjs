// 真浏览器回归用例（Windows Edge over CDP，走真实公共 broker）
// 用法: node regress.mjs <scenario>   不带参数则跑全部
import { connect, newPage, createRoom, joinRoom, waitPlayers, startGame, sleep, assert, APP, dumpOpen, reopenInContext, closeTabOnly, clickUntil } from './lib.mjs';

const S = {};

/* ---------- P0-1 题目答案不许出现在广播状态里 ---------- */
S.secrets = async (cdp) => {
  const A = await createRoom(cdp, '房主');
  const code = A.code;
  const B = await joinRoom(cdp, '乙', code);
  const C = await joinRoom(cdp, '丙', code);
  await waitPlayers(A, 3);
  console.log('房号', code);

  // --- 你画我猜 ---
  await startGame(A, 'drawgame');
  await A.waitFor('PN.app.state.g && PN.app.state.g.cur', '画猜开局');
  await sleep(1200);
  const painter = await A.eval('PN.app.state.g.cur.painter');
  const words = await A.eval('JSON.stringify((PN.app.host.secretCache[' + JSON.stringify(painter) + ']||{}).words || [])');
  const broadcast = await B.eval('JSON.stringify(PN.app.state.g)');
  console.log('  画家候选词(私密) =', words, '| 乙收到的 state.g =', broadcast.slice(0, 160));
  assert(!JSON.parse(words).some(w => broadcast.includes(w)), '你画我猜：候选词没有出现在广播 state.g 里');

  // --- 谁是卧底 ---
  await A.eval('PN.app.send({t:"lobby"})'); // 等价于点游戏页脚的「🏠 回大厅」（房主走本地 dispatch）
  await A.waitFor('PN.app.state.mode === "lobby"', '回大厅');
  await sleep(800);
  await startGame(A, 'undercover');
  await A.waitFor('PN.app.state.g.phase === "setup"', '卧底 setup');
  await clickUntil(A, '[data-go]', 'PN.app.state.g.phase === "describe"', '发词完成');
  await sleep(1500);
  const wordsUnder = await A.eval(`JSON.stringify(Object.values(PN.app.host.secretCache).filter(s=>s&&s.word).map(s=>s.word))`);
  const bState = await B.eval('JSON.stringify(PN.app.state.g)');
  console.log('  卧底词(私密) =', wordsUnder, '| 乙收到的 state.g =', bState.slice(0, 200));
  assert(!JSON.parse(wordsUnder).some(w => bState.includes(w)), '谁是卧底：词没有出现在广播 state.g 里');

  for (const p of [A, B, C]) await p.dispose();
};

/* ---------- P0-8 加入房间不该弹「没找到房间」 ---------- */
S.join = async (cdp) => {
  const A = await createRoom(cdp, '房主');
  const code = A.code;
  const B = await joinRoom(cdp, '乙', code);
  await waitPlayers(A, 2);
  console.log('  乙的对话框:', JSON.stringify(B.dialogs));
  assert(B.dialogs.length === 0, '加入房间没有弹出任何原生确认框');
  assert(B.code === A.code, '乙和房主在同一个房号');
  // 房主名单到位 ≠ 乙这边也收到了那条状态（跨公网 broker 有延迟），等乙自己那份
  await B.waitFor('PN.app.state && PN.app.state.players.some(function(p){return p.id===PN.app.room.me.id})', '乙在自己名单里', 20000);
  assert(true, '乙出现在名单里');
  for (const p of [A, B]) await p.dispose();
};

/* ---------- P0-9 大厅设置必须真的生效（以前全部写到 settings[k]，游戏读的是 settings[模式][k]） ---------- */
S.settings = async (cdp) => {
  const A = await createRoom(cdp, '房主');
  const B = await joinRoom(cdp, '乙', A.code);
  const C = await joinRoom(cdp, '丙', A.code);
  const D = await joinRoom(cdp, '丁', A.code); // 2 个卧底 + 白板至少需要 4 人
  await waitPlayers(A, 4);
  const set = async (mode, values) => { await A.eval('PN.app.send({t:"settings",mode:' + JSON.stringify(mode) + ',values:' + JSON.stringify(values) + '})'); await sleep(400); };

  await set('undercover', { numUnder: 2, blank: true, textMode: false, roundSec: 90 });
  const st1 = await A.eval('JSON.stringify(PN.app.state.settings.undercover)');
  console.log('  卧底设置 =', st1);
  assert(JSON.parse(st1).blank === true && JSON.parse(st1).numUnder === 2, '设置写进了 settings.undercover');

  await startGame(A, 'undercover');
  await A.waitFor('PN.app.state.g.phase === "setup"', '卧底 setup');
  await clickUntil(A, '[data-go]', 'PN.app.state.g.phase === "describe"', '发词完成');
  const g1 = await A.eval('JSON.stringify({numUnder:PN.app.state.g.numUnder,blank:PN.app.state.g.blank,textMode:PN.app.state.g.textMode,sec:Math.round((PN.app.state.g.deadline-Date.now())/1000)})');
  console.log('  开局后 g =', g1);
  const gg = JSON.parse(g1);
  assert(gg.blank === true && gg.numUnder === 2, '白板/卧底人数真的生效');
  assert(gg.textMode === false, '描述方式「开口说」真的生效');
  assert(gg.sec >= 88 && gg.sec <= 91, '每轮时长 90 秒真的生效（实测 ' + gg.sec + ' 秒）');

  await A.eval('PN.app.send({t:"lobby"})'); await A.waitFor('PN.app.state.mode === "lobby"', '回大厅'); await sleep(500);
  await set('wavelength', { rounds: 4 });
  await startGame(A, 'wavelength');
  assert(await A.eval('PN.app.state.g.rounds') === 4, '波长「总局数 4」真的生效');

  await A.eval('PN.app.send({t:"lobby"})'); await A.waitFor('PN.app.state.mode === "lobby"', '回大厅'); await sleep(500);
  await set('mostlikely', { rounds: 6, eachSec: 45 });
  await startGame(A, 'mostlikely');
  const g3 = await A.eval('JSON.stringify(PN.app.state.g.settings)');
  console.log('  谁最可能 g.settings =', g3);
  assert(JSON.parse(g3).rounds === 6 && JSON.parse(g3).eachSec === 45, '谁最可能「题数/每题时长」真的生效');

  await A.eval('PN.app.send({t:"lobby"})'); await A.waitFor('PN.app.state.mode === "lobby"', '回大厅'); await sleep(500);
  await set('drawgame', { rounds: 9, drawSec: 120 });
  await startGame(A, 'drawgame');
  const g4 = await A.eval('JSON.stringify(PN.app.state.settings.drawgame)');
  console.log('  画猜 settings =', g4);
  assert(JSON.parse(g4).rounds === 9 && JSON.parse(g4).drawSec === 120, '你画我猜「回合数/画画时长」真的生效');

  for (const p of [A, B, C, D]) await p.dispose();
};

/* ---------- P0-7 掉线再回来：积分和位置都还在，不能被删号 ---------- */
S.rejoin = async (cdp) => {
  const A = await createRoom(cdp, '房主');
  const B = await joinRoom(cdp, '乙', A.code);
  const C = await joinRoom(cdp, '丙', A.code);
  await waitPlayers(A, 3);
  await startGame(A, 'mostlikely');
  await A.waitFor('PN.app.state.phase === "vote"', '投票阶段');
  await sleep(800);
  // 三个人都投乙 -> 乙得 3*3=9 分
  const pages = {}; for (const p of [A, B, C]) pages[await p.eval('PN.app.room.me.id')] = p;
  const bId = await B.eval('PN.app.room.me.id');
  for (const id of Object.keys(pages)) { await pages[id].eval('PN.app.send({t:"vote",id:' + JSON.stringify(bId) + '})'); await sleep(300); }
  await A.waitFor('PN.app.state.phase === "reveal"', '开奖');
  await sleep(1000);
  const scoreBefore = await A.eval('(PN.app.state.players.find(p=>p.id===' + JSON.stringify(bId) + ')||{}).score');
  console.log('  乙掉线前积分 =', scoreBefore);
  assert(scoreBefore > 0, '乙拿到了分数（用于验证掉线不丢分）');

  console.log('  让乙掉线（关标签页，但保留浏览器身份）…');
  await closeTabOnly(cdp, B);
  await sleep(32000); // 超过 25 秒宽限期，确认不会把人删掉

  const listAfter = await A.eval('JSON.stringify(PN.app.state.players.map(p=>({n:p.name,score:p.score,on:p.online})))');
  console.log('  掉线 32 秒后房主名单 =', listAfter);
  const bAfter = JSON.parse(listAfter).find(p => p.n === '乙');
  assert(!!bAfter, '掉线的人没有被删出名单');
  assert(bAfter && bAfter.score === scoreBefore, '掉线期间积分原样保留（旧版直接清零）');
  assert(bAfter && bAfter.on === false, '掉线的人被正确标记为离线');

  // 同一个人回来（同一浏览器上下文 = 同一个 id）
  const B2 = await reopenInContext(cdp, B, APP + '#' + A.code);
  await B2.fill('#pn-name', '乙');
  await B2.click('#pn-join');
  await B2.waitFor('PN.app.room && PN.app.room.code', '乙重新进房', 40000);
  // 连接公共 broker 要 5~7 秒，别用固定 sleep 等
  await A.waitFor('(PN.app.state.players.find(function(p){return p.name==="乙"})||{}).online === true', '乙重新上线', 45000);
  const bBack = await A.eval('JSON.stringify(PN.app.state.players.map(p=>({n:p.name,score:p.score,on:p.online})))');
  console.log('  乙回来后房主名单 =', bBack);
  const bFinal = JSON.parse(bBack).find(p => p.n === '乙');
  assert(!!bFinal && bFinal.score === scoreBefore, '回来后积分还在');
  assert(!!bFinal && bFinal.on === true, '回来后重新标记为在线');
  for (const p of [A, C, B2]) await p.dispose();
};

/* ---------- P0-2 开局后刷新：不许整屏报错，且能拿回自己的词 ---------- */
S.refresh = async (cdp) => {
  const A = await createRoom(cdp, '房主');
  const code = A.code;
  const B = await joinRoom(cdp, '乙', code);
  const C = await joinRoom(cdp, '丙', code);
  await waitPlayers(A, 3);
  await startGame(A, 'undercover');
  await clickUntil(A, '[data-go]', 'PN.app.state.g.phase === "describe"', '发词完成');
  await sleep(2500);
  const roleBefore = await B.eval('(PN.app.secrets.undercover && PN.app.secrets.undercover.mine && PN.app.secrets.undercover.mine.role) || null');
  console.log('  乙刷新前的身份 =', roleBefore);

  // 真人刷新：重新加载 -> 落地页 -> 再点加入房间（链接带 #房号）
  await B.send('Page.reload', {}, B.sid);
  await B.waitFor('document.readyState === "complete"', '刷新完成');
  await B.waitFor('!!document.querySelector("#pn-join")', '落地页');
  await B.fill('#pn-name', '乙');
  await B.click('#pn-join');
  await B.waitFor('PN.app.room && PN.app.room.code', '乙重新进房', 40000);
  await B.waitFor('PN.app.conn === "connected"', '乙重连', 40000);
  await waitPlayers(A, 3);
  await sleep(3000);

  const bodyText = await B.eval('document.body.innerText');
  assert(!bodyText.includes('界面出错了'), '刷新后没有整屏「界面出错了」');
  const roleAfter = await B.eval('(PN.app.secrets.undercover && PN.app.secrets.undercover.mine && PN.app.secrets.undercover.mine.role) || null');
  console.log('  乙刷新后的身份 =', roleAfter);
  assert(roleAfter === roleBefore && roleAfter !== null, '刷新后拿回了自己的身份/词');

  await B.shot('refresh-B');
  for (const p of [A, B, C]) await p.dispose();
};

/* ---------- P0-6 白板被投出后必须出现猜词输入框 ---------- */
S.blank = async (cdp) => {
  const A = await createRoom(cdp, '房主');
  const code = A.code;
  const B = await joinRoom(cdp, '乙', code);
  const C = await joinRoom(cdp, '丙', code);
  await waitPlayers(A, 3);
  // 打开白板设置（走设置按钮同一条 action；大厅会被 4 秒一次的心跳重建，点 DOM 不可靠）
  await A.eval('PN.app.send({t:"settings",mode:"undercover",values:{blank:true}})');
  await A.waitFor('PN.app.state.settings.undercover.blank === true', '白板设置生效');
  await sleep(600);
  await startGame(A, 'undercover');
  await clickUntil(A, '[data-go]', 'PN.app.state.g.phase === "describe"', '发词完成');
  await sleep(2500);

  const blankId = await A.eval(`(() => { const sc = PN.app.host.secretCache; for (const k in sc) if (sc[k] && sc[k].role === 'blank') return k; return null; })()`);
  console.log('  白板 =', blankId);
  assert(!!blankId, '本局有白板');

  const pages = { [await A.eval('PN.app.room.me.id')]: A, [await B.eval('PN.app.room.me.id')]: B, [await C.eval('PN.app.room.me.id')]: C };
  // 描述
  for (const id of Object.keys(pages)) { await pages[id].eval('PN.app.send({t:"desc",text:"随便说一句"})'); await sleep(300); }
  await A.waitFor('PN.app.state.g.phase === "vote"', '进入投票', 20000);
  // 全体投票：除白板外都投白板，白板自己投别人（不能投自己，全员投完才会结算）
  const otherId = Object.keys(pages).find(id => id !== blankId);
  for (const id of Object.keys(pages)) {
    const target = id === blankId ? otherId : blankId;
    await pages[id].eval('PN.app.send({t:"vote",id:' + JSON.stringify(target) + '})');
    await sleep(300);
  }
  await A.waitFor('PN.app.state.g.phase === "blankGuess"', '进入白板猜词', 20000);
  await sleep(2000);

  const blankPage = pages[blankId];
  const hasInput = await blankPage.eval('!!document.querySelector(".inputbar input")');
  console.log('  白板页面上有没有猜词输入框 =', hasInput);
  assert(hasInput === true, '白板本人看到了猜词输入框');
  await blankPage.shot('blank-guess');
  for (const p of [A, B, C]) await p.dispose();
};

/* ---------- 真·画布：落笔期间来状态消息不许断笔，另一端要实时看到 ---------- */
S.draw = async (cdp) => {
  const A = await createRoom(cdp, '房主');
  const B = await joinRoom(cdp, '乙', A.code);
  await waitPlayers(A, 2);
  await startGame(A, 'drawgame');
  await A.waitFor('PN.app.state.g.cur && PN.app.state.g.cur.phase === "pick"', '选词阶段');
  const aId = await A.eval('PN.app.room.me.id'), bId = await B.eval('PN.app.room.me.id');
  const painter = await A.eval('PN.app.state.g.cur.painter');
  const P = painter === aId ? A : B, G = painter === aId ? B : A;
  console.log('  画家 =', painter === aId ? '房主' : '乙');
  await P.waitFor('!!document.querySelector("[data-word]")', '画家看到选词卡');
  await clickUntil(P, '[data-word="0"]', 'PN.app.state.g.cur.phase === "draw"', '进入作画');
  await sleep(1200);

  const inkOf = (page) => page.eval(`(() => {
    const c = document.querySelector('.dg-stage canvas');
    if (!c) return -1;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  })()`);

  assert(await inkOf(G) === 0, '开局时另一端的画布是干净的');
  // 记录画家发出的画笔消息，用来看这一笔有没有被拆成两笔
  await P.eval('window.__sends = []; const _o = PN.app.send.bind(PN.app); PN.app.send = a => { window.__sends.push(a); return _o(a); }');

  const box = await P.box('.dg-stage canvas');
  const y = box.top + box.h * 0.5;
  await P.mouse('mouseMoved', box.left + box.w * 0.2, y, { button: 'none' });
  await P.mouse('mousePressed', box.left + box.w * 0.2, y, { buttons: 1 });
  for (let i = 1; i <= 8; i++) { await P.mouse('mouseMoved', box.left + box.w * (0.2 + 0.06 * i), y, { buttons: 1 }); await sleep(50); }

  // 落笔正中间：另一端发一条猜错 -> 聊天 -> 房主 emit -> 一条状态消息打到画家这边
  await G.eval('PN.app.send({t:"guess",text:"肯定不是这个"})');
  await sleep(700);
  console.log('  落笔中来了一条状态消息（另一端的聊天）');

  for (let i = 9; i <= 14; i++) { await P.mouse('mouseMoved', box.left + box.w * (0.2 + 0.06 * i), y, { buttons: 1 }); await sleep(50); }
  await P.mouse('mouseReleased', box.left + box.w * (0.2 + 0.06 * 14), y, { buttons: 0 });
  await sleep(600);

  const strokes = await P.eval('JSON.stringify(window.__sends.filter(a => a.t === "peer" && a.msg && a.msg.t === "stroke").map(a => a.msg.id))');
  const ids = [...new Set(JSON.parse(strokes))];
  console.log('  这一笔被拆成了', ids.length, '段:', strokes);
  assert(ids.length === 1, '整笔是连续的一段（状态消息没有把它打断）');
  const mineInk = await inkOf(P);
  // 画笔画走 peer 通道 + 公共 broker，另一端落地有延迟：等它出现，而不是睡固定秒数
  let otherInk = 0;
  for (let i = 0; i < 40 && otherInk === 0; i++) { await sleep(250); otherInk = await inkOf(G); }
  console.log('  画家画布墨迹像素 =', mineInk, '| 另一端 =', otherInk);
  assert(mineInk > 0, '画家画布上有笔迹');
  assert(otherInk > 0, '另一端实时看到了笔迹（真·跨浏览器同步）');
  assert(!(await P.eval('document.body.innerText')).includes('界面出错了'), '画家屏幕没报错');
  await P.shot('draw-painter'); await G.shot('draw-guesser');
  for (const p of [A, B]) await p.dispose();
};

/* ---------- P1-1 别人提交时，我正在打的描述不能被清空 ---------- */
S.draft = async (cdp) => {
  const A = await createRoom(cdp, '房主');
  const B = await joinRoom(cdp, '乙', A.code);
  const C = await joinRoom(cdp, '丙', A.code);
  await waitPlayers(A, 3);
  await startGame(A, 'undercover');
  await clickUntil(A, '[data-go]', 'PN.app.state.g.phase === "describe"', '发词完成');
  await sleep(1500);

  // 乙在输入框里打字（真实键盘事件）
  await B.click('.inputbar input');
  await B.type('我正在打一半的描述');
  await sleep(300);
  const before = await B.eval('document.querySelector(".inputbar input").value');
  console.log('  乙输入的内容 =', JSON.stringify(before));
  assert(before.length > 0, '乙确实打进了字');

  // 丙提交描述 -> 房主 emit -> 乙这边整树重建
  await C.eval('PN.app.send({t:"desc",text:"丙的描述"})');
  await sleep(1500);

  const after = await B.eval('document.querySelector(".inputbar input") ? document.querySelector(".inputbar input").value : null');
  const focused = await B.eval('document.activeElement === document.querySelector(".inputbar input")');
  console.log('  重建后乙输入框 =', JSON.stringify(after), '| 还聚焦 =', focused);
  assert(after === before, '重建后草稿还在（旧版会被清空）');
  assert(focused === true, '重建后光标还在输入框里（拼音不会丢）');
  for (const p of [A, B, C]) await p.dispose();
};

/* ---------- P1-2 拖滑杆时别人提交，不能打断我的拖拽 ---------- */
S.slider = async (cdp) => {
  const A = await createRoom(cdp, '房主');
  const B = await joinRoom(cdp, '乙', A.code);
  const C = await joinRoom(cdp, '丙', A.code);
  await waitPlayers(A, 3);
  await startGame(A, 'wavelength');
  await A.waitFor('PN.app.state.g.curPhase === "clue"', '线索阶段');
  await sleep(800);
  const pages = {}; for (const p of [A, B, C]) pages[await p.eval('PN.app.room.me.id')] = p;
  const psychic = await A.eval('PN.app.state.g.cur');
  await pages[psychic].eval('PN.app.send({t:"clue",text:"偏左一点点"})');
  await A.waitFor('PN.app.state.g.curPhase === "guess"', '猜位置阶段');
  await sleep(1000);

  // 拖拽的人必须是猜词者（通灵者看到的是靶心，没有可拖的滑杆）
  const guesserIds = Object.keys(pages).filter(id => id !== psychic);
  const V = pages[guesserIds[0]], O = pages[guesserIds[1]];
  console.log('  拖拽者是', V.name, '| 提交者是', O.name, '| 通灵者是', pages[psychic] && pages[psychic].name);
  const b = await V.box('.wave-track');
  assert(!!b, '猜词者看到了滑杆');
  if (!b) { for (const p of [A, B, C]) await p.dispose(); return; }
  const y = b.top + b.h / 2;
  await V.eval('window.__track = document.querySelector(".wave-track")');
  await V.mouse('mouseMoved', b.left + b.w * 0.5, y, { button: 'none' });
  await V.mouse('mousePressed', b.left + b.w * 0.5, y, { buttons: 1 });
  await V.mouse('mouseMoved', b.left + b.w * 0.3, y, { buttons: 1 });
  await sleep(200);
  assert(await V.eval('document.querySelector(".wave-knob").style.left') === '30%', '拖到 30%');

  // 另一个猜词者提交 -> 房主 emit -> 拖拽这边本该整树重建
  await O.eval('PN.app.send({t:"guess",v:70})');
  await sleep(1500);

  assert(await V.eval('document.querySelector(".wave-track") === window.__track'), '拖拽中滑杆元素没有被重建（指针捕获不丢）');
  assert(await V.eval('document.querySelector(".wave-knob").style.left') === '30%', '拖到一半的位置没被打回 50%');
  // 还能接着拖
  await V.mouse('mouseMoved', b.left + b.w * 0.8, y, { buttons: 1 });
  await sleep(200);
  assert(await V.eval('document.querySelector(".wave-knob").style.left') === '80%', '松手前还能继续拖动');
  await V.mouse('mouseReleased', b.left + b.w * 0.8, y, { buttons: 0 });
  await sleep(1500);
  assert(await V.eval('document.querySelector(".wave-knob").style.left') === '80%', '松手后位置依然是 80%（补渲染不会打回默认值）');
  assert(!(await V.eval('document.body.innerText')).includes('界面出错了'), '拖拽者屏幕没有报错');
  for (const p of [A, B, C]) await p.dispose();
};

/* ---------- P0-3 真·房主掉线：关掉房主页面，新房主必须能继续把这一局打完 ---------- */
S.migration = async (cdp) => {
  const A = await createRoom(cdp, '房主');
  const code = A.code;
  const B = await joinRoom(cdp, '乙', code);
  const C = await joinRoom(cdp, '丙', code);
  const D = await joinRoom(cdp, '丁', code);
  await waitPlayers(A, 4);
  await startGame(A, 'undercover');
  await A.waitFor('PN.app.state.g.phase === "setup"', '卧底 setup');
  await clickUntil(A, '[data-go]', 'PN.app.state.g.phase === "describe"', '发词完成');
  await sleep(2500);
  const rolesBefore = {};
  for (const [p, n] of [[B, '乙'], [C, '丙'], [D, '丁']]) {
    rolesBefore[n] = await p.eval('(PN.app.secrets.undercover && PN.app.secrets.undercover.mine && PN.app.secrets.undercover.mine.role) || null');
  }
  console.log('  掉线前身份 =', JSON.stringify(rolesBefore));

  console.log('  关掉房主页面，等新房主选出来（心跳超时约 26 秒）…');
  await A.dispose();

  const others = [B, C, D];
  let newHost = null;
  for (let i = 0; i < 60 && !newHost; i++) {
    await sleep(2000);
    for (const p of others) { if (await p.eval('!!(PN.app.room && PN.app.room.isHost)')) { newHost = p; break; } }
  }
  assert(!!newHost, '房主掉线后自动选出了新房主（' + (newHost && newHost.name) + '）');
  if (!newHost) return;
  await sleep(4000); // 等 recover 私密消息来回

  const rolesAfter = {};
  for (const [p, n] of [[B, '乙'], [C, '丙'], [D, '丁']]) {
    rolesAfter[n] = await p.eval('(PN.app.secrets.undercover && PN.app.secrets.undercover.mine && PN.app.secrets.undercover.mine.role) || null');
  }
  console.log('  掉线后身份 =', JSON.stringify(rolesAfter));
  for (const n of ['乙', '丙', '丁']) assert(rolesAfter[n] === rolesBefore[n] && rolesAfter[n] !== null, n + ' 的身份没丢');
  for (const p of others) assert(!(await p.eval('document.body.innerText')).includes('界面出错了'), (p.name || p) + ' 屏幕上没有「界面出错了」');

  // 继续把这一轮打完：描述 -> 投票 -> 必须能推进（旧版这里会抛异常卡死）
  const pages = {};
  for (const p of others) pages[await p.eval('PN.app.room.me.id')] = p;
  const phase = await newHost.eval('PN.app.state.g.phase');
  console.log('  新房主看到的阶段 =', phase);
  if (phase === 'describe') {
    for (const id of Object.keys(pages)) { await pages[id].eval('PN.app.send({t:"desc",text:"迁移后照样描述"})'); await sleep(400); }
  }
  await sleep(3000);
  console.log('  房主侧诊断 =', await newHost.eval(`JSON.stringify({
    descCount: PN.app.state.g.descCount, desc: (PN.app.state.g.desc||[]).length,
    alive: (PN.app.state.g.alive||[]).length,
    onlineAlive: (PN.app.state.g.alive||[]).filter(id => { const p = PN.app.state.players.find(x=>x.id===id); return p && p.online; }).length,
    onlineFlags: PN.app.state.players.map(p => p.name + ':' + (p.online?'on':'off')),
    peers: Object.keys(PN.app.room.peers).length
  })`));
  await newHost.waitFor('PN.app.state.g.phase === "vote"', '进入投票', 30000);
  const ids = Object.keys(pages);
  await pages[ids[0]].eval('PN.app.send({t:"vote",id:' + JSON.stringify(ids[1]) + '})'); await sleep(400);
  await pages[ids[2]].eval('PN.app.send({t:"vote",id:' + JSON.stringify(ids[1]) + '})'); await sleep(400);
  await pages[ids[1]].eval('PN.app.send({t:"vote",id:' + JSON.stringify(ids[1] === ids[0] ? ids[2] : ids[0]) + '})');
  try {
    await newHost.waitFor('PN.app.state.g.phase !== "vote"', '投票结算完成', 25000);
    assert(true, '房主掉线后投票能正常结算，游戏没有卡死（阶段 = ' + await newHost.eval('PN.app.state.g.phase') + '）');
  } catch (e) {
    assert(false, '房主掉线后投票卡死：' + e.message);
  }
  for (const p of others) await p.dispose();
};

/* ---------- 四个游戏各完整跑通一局（真浏览器 + 真 broker） ---------- */
S.fullgame = async (cdp) => {
  const A = await createRoom(cdp, '房主');
  const B = await joinRoom(cdp, '乙', A.code);
  const C = await joinRoom(cdp, '丙', A.code);
  const D = await joinRoom(cdp, '丁', A.code);
  await waitPlayers(A, 4);
  const pages = {}; for (const p of [A, B, C, D]) pages[await p.eval('PN.app.room.me.id')] = p;
  const ids = Object.keys(pages);
  const P = (id) => pages[id];
  const send = async (id, action) => { await P(id).eval('PN.app.send(' + JSON.stringify(action) + ')'); await sleep(200); };
  const set = async (mode, values) => { await A.eval('PN.app.send({t:"settings",mode:' + JSON.stringify(mode) + ',values:' + JSON.stringify(values) + '})'); await sleep(400); };
  const backToLobby = async () => { await A.eval('PN.app.send({t:"lobby"})'); await A.waitFor('PN.app.state.mode === "lobby"', '回大厅'); await sleep(700); };
  const noError = async (id) => !(await P(id).eval('document.body.innerText')).includes('界面出错了');
  const allClean = async (tag) => { for (const id of ids) assert(await noError(id), tag + '：' + P(id).name + ' 屏幕没报错'); };

  /* --- 你画我猜：3 回合 --- */
  await set('drawgame', { rounds: 3, drawSec: 60 });
  await startGame(A, 'drawgame');
  for (let r = 1; r <= 3; r++) {
    await A.waitFor('PN.app.state.g.cur && PN.app.state.g.cur.phase === "pick"', '画猜第' + r + '回合选词', 40000);
    const painter = await A.eval('PN.app.state.g.cur.painter');
    await P(painter).waitFor('!!document.querySelector("[data-word]")', '画家选词卡');
    await clickUntil(P(painter), '[data-word="0"]', 'PN.app.state.g.cur.phase === "draw"', '作画中');
    // 画家的答案走私密通道异步到达，必须先等到，否则猜词发的是空串（会被房主直接丢掉）
    await P(painter).waitFor('!!(PN.app.secrets.drawgame && PN.app.secrets.drawgame.mine && PN.app.secrets.drawgame.mine.answer)', '画家拿到答案', 25000);
    const answer = await P(painter).eval('PN.app.secrets.drawgame.mine.answer');
    for (const id of ids) if (id !== painter) await send(id, { t: 'guess', text: answer });
    await A.waitFor('PN.app.state.g.cur && PN.app.state.g.cur.phase === "reveal"', '揭晓', 30000);
    await sleep(200);
  }
  await A.waitFor('PN.app.state.phase === "over"', '画猜结算', 40000);
  assert(true, '你画我猜：3 回合完整跑完进入结算');
  const dgScore = await A.eval('JSON.stringify(PN.app.state.players.map(p=>p.score))');
  console.log('  画猜总分 =', dgScore);
  assert(JSON.parse(dgScore).some(s => s > 0), '画猜计分有分');
  await allClean('画猜');

  /* --- 波长：4 回合 --- */
  await backToLobby();
  await set('wavelength', { rounds: 4 });
  await startGame(A, 'wavelength');
  for (let r = 1; r <= 4; r++) {
    await A.waitFor('PN.app.state.g.curPhase === "clue"', '波长第' + r + '回合线索', 30000);
    const psychic = await A.eval('PN.app.state.g.cur');
    await send(psychic, { t: 'clue', text: '偏左一点点' });
    await A.waitFor('PN.app.state.g.curPhase === "guess"', '猜位置', 20000);
    for (const id of ids) if (id !== psychic) await send(id, { t: 'guess', v: 25 + r * 5 });
    await A.waitFor('PN.app.state.g.curPhase === "reveal"', '开奖', 30000);
    await sleep(200);
  }
  await A.waitFor('PN.app.state.phase === "over"', '波长结算', 40000);
  assert(true, '波长：4 回合完整跑完进入结算');
  await allClean('波长');

  /* --- 谁最有可能：6 题 --- */
  await backToLobby();
  await set('mostlikely', { rounds: 6, eachSec: 15 });
  await startGame(A, 'mostlikely');
  for (let r = 1; r <= 6; r++) {
    await A.waitFor('PN.app.state.phase === "vote"', '谁最可能第' + r + '题', 30000);
    for (const id of ids) await send(id, { t: 'vote', id: ids[0] });
    await A.waitFor('PN.app.state.phase === "reveal"', '开奖', 20000);
    await sleep(200);
  }
  await A.waitFor('PN.app.state.phase === "over"', '谁最可能结算', 40000);
  assert(true, '谁最有可能：6 题完整跑完进入结算');
  await allClean('谁最可能');

  /* --- 谁是卧底：一直投到分出胜负 --- */
  await backToLobby();
  await set('undercover', { numUnder: 1, blank: false, textMode: true, roundSec: 90 });
  await startGame(A, 'undercover');
  await clickUntil(A, '[data-go]', 'PN.app.state.g.phase === "describe"', '发词', 4, 8000);
  for (let guard = 0; guard < 8; guard++) {
    const phase = await A.eval('PN.app.state.g.phase');
    if (phase === 'over') break;
    if (phase === 'describe') {
      for (const id of ids) await send(id, { t: 'desc', text: '我的描述' });
      await A.waitFor('PN.app.state.g.phase === "vote"', '进入投票', 30000);
      continue;
    }
    if (phase === 'vote' || phase === 'revote') {
      const alive = JSON.parse(await A.eval('JSON.stringify(PN.app.state.g.alive)'));
      const target = alive[0], alt = alive[1];
      for (const id of alive) await send(id, { t: 'vote', id: id === target ? alt : target });
      await sleep(1500);
      continue;
    }
    if (phase === 'blankGuess') { await sleep(2000); continue; }
    break;
  }
  await A.waitFor('PN.app.state.phase === "over"', '卧底结算', 60000);
  assert(true, '谁是卧底：一直投到分出胜负，进入结算');
  console.log('  卧底胜方 =', await A.eval('JSON.stringify(PN.app.state.g.winner)'));
  await allClean('卧底');
  for (const p of [A, B, C, D]) await p.dispose();
};

/* ---------- 中途加入：新人不能在开局后进来看白屏或干扰对局 ---------- */
S.midjoin = async (cdp) => {
  const A = await createRoom(cdp, '房主');
  const B = await joinRoom(cdp, '乙', A.code);
  const C = await joinRoom(cdp, '丙', A.code);
  await waitPlayers(A, 3);
  await startGame(A, 'undercover');
  await clickUntil(A, '[data-go]', 'PN.app.state.g.phase === "describe"', '发词');
  await sleep(1500);

  const D = await joinRoom(cdp, '后来的', A.code);
  await waitPlayers(A, 4);
  await sleep(3000);
  const txt = await D.eval('document.body.innerText');
  assert(!txt.includes('界面出错了'), '中途加入的人不会看到白屏报错');
  assert(txt.includes('旁观'), '中途加入的人被明确告知「本局已开始，你在旁观」');
  assert(await A.eval('PN.app.state.g.phase') === 'describe', '对局没有被新人打乱');
  const word = await D.eval('JSON.stringify((PN.app.secrets.undercover && PN.app.secrets.undercover.mine) || null)');
  assert(word === 'null', '新人没有拿到任何人的词（不会泄露身份）');
  for (const p of [A, B, C, D]) await p.dispose();
};

const name = process.argv[2];
const list = name ? [name] : Object.keys(S);
const cdp = await connect();
console.log('browser =', cdp.browser);
for (const n of list) {
  if (!S[n]) { console.log('未知用例', n); process.exitCode = 1; continue; }
  console.log('\n===== ' + n + ' =====');
  try { await S[n](cdp); } catch (e) { console.log('  ✗ 异常: ' + e.message); console.log('  --- 各页面状态 ---'); await dumpOpen(); process.exitCode = 1; }
}
cdp.close();
console.log('\n' + (process.exitCode ? '有用例失败' : '全部通过'));
process.exit(process.exitCode || 0);