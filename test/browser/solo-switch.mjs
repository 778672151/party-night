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

const nomap = await startAndSee('gomoku');
console.log('② 单人+五子棋 → mini=' + nomap.mini + ' mode=' + nomap.mode + ' toasts=' + nomap.toasts);
assert(!nomap.mini, '② 没有对应单机版的游戏不应开浮层');
assert(/人数不够/.test(nomap.toasts), '② 应给人数不够提示');

const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2);
const two = await startAndSee('cube');
console.log('③ 两人+魔方接力 → mini=' + two.mini + ' mode=' + two.mode);
assert(!two.mini, '③ 两人时不该开单机浮层');
assert(two.mode === 'cube', '③ 两人时应正常开双人魔方接力，实际 mode=' + two.mode);

console.log('SOLO-SWITCH 全部通过');
await A.dispose(); await B.dispose(); cdp.close();
