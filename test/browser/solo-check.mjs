// 通用「单人可玩」验证：node test/browser/solo-check.mjs <mode>
// 断言与具体 DOM 选择器解耦，只看状态：能开局、g 存在、phase 在玩、玩家数=1、且没有被打发回大厅的提示
import { connect, createRoom, sleep } from './lib.mjs';
const mode = process.argv[2];
if (!mode) { console.log('用法: node test/browser/solo-check.mjs <mode>'); process.exit(2); }
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
await sleep(1800);
await A.eval('PN.app.send({t:"start", mode:"' + mode + '"})');
await sleep(2000);
const raw = await A.eval('JSON.stringify({mode: PN.app.state.mode, phase: PN.app.state.phase, g: !!PN.app.state.g, n: (PN.app.state.g && PN.app.state.g.players) ? PN.app.state.g.players.length : 0, toasts: [...document.querySelectorAll(".toast")].map(t=>t.textContent).join(" | ")})');
console.log(mode + ' → ' + raw);
const o = JSON.parse(raw);
let bad = 0;
const check = (c, m) => { if (c) console.log('  ✓ ' + m); else { console.log('  ✗ ' + m); bad++; } };
check(o.mode === mode, '单人能进入 ' + mode + '（实际 ' + o.mode + '）');
check(o.g === true, 'state.g 已建立');
check(o.phase === 'play' || o.phase === 'round', 'phase 进入对局（实际 ' + o.phase + '）');
check(o.n === 1, '参与者为 1 人（实际 ' + o.n + '）');
check(!/要两个人|人数不够/.test(o.toasts), '没有被"要两个人/人数不够"打发回大厅');
console.log(bad === 0 ? 'SOLO-CHECK 通过（' + mode + '）' : 'SOLO-CHECK 未通过（' + mode + '，失败 ' + bad + ' 项）');
process.exitCode = bad ? 1 : 0;
await A.dispose(); cdp.close();
