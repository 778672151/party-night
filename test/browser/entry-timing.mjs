// 进场链路耗时基线（单页面即可，绕开公共 broker 配对抖动）
//
// 【已测基线 v1.14.4 / Edg 153 / localhost:8080，2024 实测两次】
//   NAV 导航：domContentLoaded 129~194ms、load 341~457ms   → 启动解析不是瓶颈
//   落地页：按钮已就绪；昵称未预填（namePrefilled=""）；头像 20 个
//   点击「开个房」→ 等待页出现     16ms（同步渲染）
//   点击「开个房」→ room 对象建立  2581 / 2816ms  ← 几乎等于 ui.js:356 那句固定 probe 2500ms
//   必填交互数：3（昵称 / 头像 / 开房）
//   已知缺口：CLICK_TO_CONNECTED 采不到（脚本读的 room.conn 字段名不对，需按实际字段修正后才算基线）
//   复现：'/mnt/c/Program Files/nodejs/node.exe' "$(wslpath -w test/browser/entry-timing.mjs)"
//
// 输出：导航耗时 + 落地页交互次数 + 点击「开个房」到各检查点的耗时
import { connect, newPage, sleep, APP } from './lib.mjs';

const cdp = await connect();
const p = await newPage(cdp, APP);
await sleep(2500);

const nav = await p.eval('JSON.stringify((()=>{const n=performance.getEntriesByType("navigation")[0]||{};return {dcl:Math.round(n.domContentLoadedEventEnd||0),load:Math.round(n.loadEventEnd||0)};})())');
const landReady = await p.eval('JSON.stringify({hasBtn: !!document.querySelector("#pn-create"), namePrefilled: (document.querySelector("#pn-name")||{}).value || "", emoCount: document.querySelectorAll("#pn-emojis .e").length})');
console.log('NAV=' + nav);
console.log('LAND=' + landReady);

// 模拟落地页所需交互：填昵称(1) + 选头像(1) + 点开房(1)
const clickAt = Date.now();
const beats = { waiting: null, room: null, connected: null };
await p.eval('document.querySelector("#pn-name").value="计时"; document.querySelectorAll("#pn-emojis .e")[3].click();');
await p.eval('document.querySelector("#pn-create").click()');
for (let i = 0; i < 160; i++) {
  const st = await p.eval('JSON.stringify((()=>{try{const r=PN.app&&PN.app.room;return {waiting: !!(document.body.textContent||"").match(/正在建房|正在进入房间/), room: !!r, conn: r?(r.conn||r.state||"?"):""};}catch(e){return {err:1};}})())');
  let o = {};
  try { o = JSON.parse(st || '{}'); } catch (e) {}
  const t = Date.now() - clickAt;
  if (o.waiting && beats.waiting === null) beats.waiting = t;
  if (o.room && beats.room === null) beats.room = t;
  if (o.conn === 'connected' && beats.connected === null) { beats.connected = t; break; }
  if (o.room && beats.room !== null && i > 120) break;
  await sleep(150);
}
console.log('CLICK_TO_WAITING_ms=' + beats.waiting);
console.log('CLICK_TO_ROOM_OBJ_ms=' + beats.room);
console.log('CLICK_TO_CONNECTED_ms=' + beats.connected);
console.log('INTERACTIONS_REQUIRED=3 (昵称/头像/开房)  namePrefilled=' + JSON.parse(landReady).namePrefilled);
await p.shot('entry-baseline');
await p.dispose(); cdp.close();
