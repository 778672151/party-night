// 推箱子：真键盘必须聚焦到 iframe 内才转发；验证两种方式
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
const meA = await A.eval('PN.app.room.me.id');
await A.eval('PN.app.send({t:"start", mode:"soko"})');
await sleep(4500);

const st = () => A.eval('JSON.stringify({log:(PN.app.state.g.log||[]).length,phase:PN.app.state.g.phase,turnIdx:PN.app.state.g.turnIdx,players:PN.app.state.g.players})').then(JSON.parse);
console.log('开局: ' + JSON.stringify(await st()));

// 方式1：直接在 iframe 的 document 上派发 keydown（模拟真人聚焦在 iframe 内按键）
const inFrame = (p, key) => p.eval('(function(){var d=document.querySelector("iframe").contentDocument; var ev=new KeyboardEvent("keydown",{key:' + JSON.stringify(key) + ',bubbles:true,cancelable:true}); d.dispatchEvent(ev); return true;})()');

let s0 = await st();
const cur = s0.players[s0.turnIdx] === meA ? A : B;
console.log('该谁走: ' + (s0.players[s0.turnIdx] === meA ? 'A' : 'B'));
for (const k of ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown']) {
  await inFrame(cur, k);
  await sleep(900);
}
const s1 = await st();
console.log('方式1（iframe 内真 keydown）：日志 ' + s0.log + '→' + s1.log + (s1.log > s0.log ? ' ✓ 生效' : ' ✗ 无效'));

// 方式2：用 CDP focus 到 iframe 后再派发按键
const hasFocus = await A.eval('(function(){var f=document.querySelector("iframe"); try{ f.focus(); f.contentWindow.focus(); var d=f.contentDocument; d.body.setAttribute("tabindex","-1"); d.body.focus(); return d.activeElement ? d.activeElement.tagName : "none"; }catch(e){ return "err:"+e.message; } })()');
console.log('聚焦 iframe 结果: ' + hasFocus);
let s2 = await st();
const cur2 = s2.players[s2.turnIdx] === meA ? A : B;
const before2 = s2.log;
await cur2.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 }, cur2.sid);
await sleep(200);
await cur2.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 }, cur2.sid);
await sleep(1200);
const s3 = await st();
console.log('方式2（CDP 按键到聚焦的 iframe）：日志 ' + before2 + '→' + s3.log + (s3.log > before2 ? ' ✓ 生效' : ' ✗ 无效'));

// 对照：屏幕十字键（已知有效）
const hasPad = await A.eval('document.querySelectorAll("[data-dir]").length');
console.log('十字键数量=' + hasPad);
console.log('报错: ' + await A.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
