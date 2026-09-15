// 单人可玩验证：一个人开房也能进跳一跳，且回合真的起得来
//   node test/browser/solo-hop.mjs
import { connect, createRoom, sleep, assert } from './lib.mjs';

const cdp = await connect();
const A = await createRoom(cdp, '小桃');
await sleep(1200);

// 单人房：目录里应显示 1–2 人
const meta = await A.eval('(()=>{const c=[...document.querySelectorAll(".modecard")].find(x=>x.dataset.mode==="hop"); return c ? c.textContent.replace(/\\s+/g," ").slice(0,60) : "找不到卡片";})()');
console.log('卡片文案: ' + meta);

await A.eval('(()=>{const c=[...document.querySelectorAll(".modecard")].find(x=>x.dataset.mode==="hop"); c.querySelector(\'[data-act="start"]\').click(); return true;})()');
await sleep(1800);

const st = await A.eval('JSON.stringify({mode: PN.app.state.mode, phase: PN.app.state.phase, hasG: !!PN.app.state.g, attempt: !!(PN.app.state.g && PN.app.state.g.attempt), screen: !!document.querySelector(".hop-cv")})');
console.log('开局后: ' + st);
const o = JSON.parse(st);
assert(o.mode === 'hop', '单人应能进入跳一跳（实际 mode=' + o.mode + '）');
assert(o.attempt, '第一回合应已开始（state.g.attempt 存在）');
assert(o.screen, '跳一跳画面应渲染出来（.hop-cv 存在）');
console.log('SOLO-HOP 结束（上面若有 ✗ 表示未通过）');
await A.dispose(); cdp.close();
