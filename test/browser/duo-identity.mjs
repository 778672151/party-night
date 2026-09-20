// 阶段2a：两个身份（房主 / 加入者）分别走各自的真实界面路径，逐步记录实际表现
//   node test/browser/duo-identity.mjs
// 只用只读操作 + 真实点击，不改任何业务代码。
import { connect, createRoom, joinRoom, waitPlayers, sleep, APP, SHOTS } from './lib.mjs';

const cdp = await connect();
const log = (s) => console.log(s);

/* ---------- 身份 1：房主（自己开房） ---------- */
log('===== 身份1：房主 =====');
const A = await createRoom(cdp, '小桃');
log('  ✓ 落地页：填昵称「小桃」→ 点 #pn-create「开个房」');
log('  ✓ 拿到房号 ' + A.code + '，已连上 broker，meta 已发布');
const aLobby = JSON.parse(await A.eval('JSON.stringify({screen:PN.app.screenName,mode:PN.app.state.mode,players:PN.app.state.players.length,isHost:PN.app.room.isHost})'));
log('  大厅状态：screen=' + aLobby.screen + ' mode=' + aLobby.mode + ' 人数=' + aLobby.players + ' isHost=' + aLobby.isHost);
// 房主可见的关键控件
const aCtl = JSON.parse(await A.eval('JSON.stringify({create:!!document.querySelector("#pn-create"),copy:!!document.querySelector("#pn-copy"),share:!!document.querySelector("#pn-share"),modecards:document.querySelectorAll(".modecard").length,minicards:document.querySelectorAll(".mini-card").length,code:!!document.querySelector(".roomcode .code")})'));
log('  房主可见控件：复制链接=' + aCtl.copy + ' 分享=' + aCtl.share + ' 联机卡=' + aCtl.modecards + ' 小游戏卡=' + aCtl.minicards + ' 房号元素=' + aCtl.code);
await A.shot('duo-1-host-lobby');

/* ---------- 身份 2：加入者（凭房号进） ---------- */
log('===== 身份2：加入者 =====');
const B = await joinRoom(cdp, '阿泽', A.code);
log('  ✓ 落地页：填昵称「阿泽」→ 点 #pn-join「加入房间」（URL 带 #' + A.code + '）');
await waitPlayers(A, 2);
const bLobby = JSON.parse(await B.eval('JSON.stringify({screen:PN.app.screenName,mode:PN.app.state.mode,players:PN.app.state.players.length,isHost:PN.app.room.isHost})'));
log('  大厅状态：screen=' + bLobby.screen + ' mode=' + bLobby.mode + ' 人数=' + bLobby.players + ' isHost=' + bLobby.isHost);
// 加入者应当看不到房主专属控件
const bCtl = JSON.parse(await B.eval('JSON.stringify({copy:!!document.querySelector("#pn-copy"),share:!!document.querySelector("#pn-share"),modecards:document.querySelectorAll(".modecard").length,dissolve:!!document.querySelector("#pn-dissolve")})'));
log('  加入者可见控件：复制链接=' + bCtl.copy + ' 分享=' + bCtl.share + ' 联机卡=' + bCtl.modecards + ' 解散房间=' + bCtl.dissolve);
await B.shot('duo-2-guest-lobby');

/* ---------- 两端名单是否一致 ---------- */
const rosterA = await A.eval('JSON.stringify(PN.app.state.players.map(p=>p.name).sort())');
const rosterB = await B.eval('JSON.stringify(PN.app.state.players.map(p=>p.name).sort())');
log('  两端名单：房主看到 ' + rosterA + ' / 加入者看到 ' + rosterB + (rosterA === rosterB ? '  → 一致 ✓' : '  → 不一致 ✗'));

/* ---------- 权限边界：非房主点开始会怎样 ---------- */
const before = await A.eval('PN.app.state.mode');
await B.eval('PN.app.send({t:"start", mode:"gomoku"})');
await sleep(1200);
const afterA = await A.eval('PN.app.state.mode'), afterB = await B.eval('PN.app.state.mode');
log('  权限边界：非房主发 start → 房主 mode=' + before + '→' + afterA + '，加入者 mode=' + afterB + (afterA === 'lobby' ? '  → 被正确拒绝 ✓' : '  → 竟然开局了 ✗'));

/* ---------- 身份2 的退出路径是否是「退出房间」而非「回大厅」 ---------- */
const footerB = await B.eval('(()=>{const bs=[...document.querySelectorAll("button")].map(b=>b.textContent.trim());return JSON.stringify(bs.filter(t=>/回大厅|退出房间/.test(t)))})()');
const footerA = await A.eval('(()=>{const bs=[...document.querySelectorAll("button")].map(b=>b.textContent.trim());return JSON.stringify(bs.filter(t=>/回大厅|退出房间/.test(t)))})()');
log('  回退按钮：房主=' + footerA + ' / 加入者=' + footerB);

log('');
log('DUO-IDENTITY 结束');
await A.dispose(); await B.dispose(); cdp.close();
