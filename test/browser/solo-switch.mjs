// 第3块 切换版验收：①单人点「有单机版」的游戏 → 开单机浮层 ②单人点「没有单机版」的 → 不开浮层、给提示 ③两人点 → 正常开双人局
//   node.exe .../solo-switch.mjs
import { connect, createRoom, joinRoom, waitPlayers, sleep, assert } from './lib.mjs';

const cdp = await connect();
const A = await createRoom(cdp, '小桃');
await sleep(1200);

async function startAndSee(mode) {
  await A.eval('(()=>{const c=[...document.querySelectorAll(".modecard")].find(x=>x.dataset.mode==="' + mode + '"); if(!c) return false; c.querySelector(\'[data-act="start"]\').click(); return true;})()');
  await sleep(1200);
  return {
    mini: await A.eval('!!document.querySelector(".mini-ov .mini-frame")'),
    frameSrc: await A.eval('(()=>{const f=document.querySelector(".mini-ov .mini-frame"); return f ? f.src : "";})()'),
    mode: await A.eval('PN.app.state.mode'),
    toasts: await A.eval('(()=>[...document.querySelectorAll(".toast")].map(t=>t.textContent).join(" | "))()'),
  };
}

const solo = await startAndSee('cube');
console.log('① 单人+魔方接力 → mini=' + solo.mini + ' src含mini=' + /mini\//.test(solo.frameSrc) + ' mode=' + solo.mode);
assert(solo.mini, '① 单人有单机版的游戏应打开单机浮层');
assert(/mini\//.test(solo.frameSrc), '① 浮层指向 mini/ 目录');
await A.eval('(()=>{const b=document.querySelector("#mini-close"); if(b) b.click(); return true;})()');
await sleep(600);

// ② 单人 + 没有单机版的游戏：**行为升级**了 —— 以前抛「人数不够」把人挡住，
//    现在是给配一个机器人真的开起来（只有写了 botTurn 的游戏才会；没写的仍给原提示）。
const nomap = await startAndSee('gomoku');
console.log('② 单人+五子棋 → mini=' + nomap.mini + ' mode=' + nomap.mode + ' toasts=' + nomap.toasts);
assert(!nomap.mini, '② 没有对应单机版的游戏不应开单机浮层');
assert(nomap.mode === 'gomoku', '② 单人应真的开起五子棋（不再是「人数不够」），实际 mode=' + nomap.mode);
assert(/机器人/.test(nomap.toasts), '② 应明确告诉玩家对手是机器人，toasts=' + nomap.toasts);
const botOk = await A.eval('(PN.app.state.players||[]).some(p=>p.bot && p.online)');
assert(botOk, '② 名单里应有一个在线的机器人');

// 回大厅，让 ③ 的前提（在大厅里）重新成立
await A.eval('(()=>{const b=[...document.querySelectorAll("button")].find(x=>/回大厅/.test(x.textContent)); if(b) b.click(); return true;})()');
await sleep(1200);
const backToLobby = await A.eval('PN.app.state.mode');
console.log('   回大厅后 mode=' + backToLobby);
assert(backToLobby === 'lobby', '② 能回大厅（下一段的前提）');
const noBotInLobby = await A.eval('(PN.app.state.players||[]).filter(p=>p.bot).length');
assert(noBotInLobby === 0, '② 回大厅后机器人被收走（大厅里不该杵着假人），实际 ' + noBotInLobby + ' 个');

const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2);
const two = await startAndSee('cube');
console.log('③ 两人+魔方接力 → mini=' + two.mini + ' mode=' + two.mode);
assert(!two.mini, '③ 两人时不该开单机浮层');
assert(two.mode === 'cube', '③ 两人时应正常开双人魔方接力，实际 mode=' + two.mode);

console.log('SOLO-SWITCH 全部通过');
await A.dispose(); await B.dispose(); cdp.close();
