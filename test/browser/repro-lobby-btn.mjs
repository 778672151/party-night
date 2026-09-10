// 复现「回大厅」按钮：房主点 vs 非房主点，各自会发生什么
import { connect, createRoom, joinRoom, waitPlayers, startGame, sleep, APP } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '房主');
const B = await joinRoom(cdp, '乙', A.code);
const C = await joinRoom(cdp, '丙', A.code);
await waitPlayers(A, 3);
await startGame(A, 'undercover');
await A.click('[data-go]');
await A.waitFor('PN.app.state.g.phase === "describe"', '发词');
await sleep(1500);

const footer = async (p) => p.eval("!!document.querySelector('.btn.ghost.sm')");
console.log('房主页脚有回大厅按钮 =', await footer(A), '| 乙 =', await footer(B));

console.log('\n--- 非房主（乙）的页脚按钮 ---');
const label = await B.eval("[].slice.call(document.querySelectorAll('button')).filter(function(b){return b.textContent.indexOf('回大厅')>=0||b.textContent.indexOf('退出房间')>=0}).map(function(b){return b.textContent.trim()})[0]");
console.log('按钮文案 =', JSON.stringify(label));
await B.eval("[].slice.call(document.querySelectorAll('button')).filter(function(b){return b.textContent.indexOf('回大厅')>=0||b.textContent.indexOf('退出房间')>=0})[0].click()");
await sleep(3000);
const backToLand = await B.eval("!!document.querySelector('#pn-name')");
console.log('点击后回到落地页（干净地退出并刷新）=', backToLand, '| 还卡在死掉的游戏屏 =', await B.eval("document.body.innerText.indexOf('谁是卧底')>=0 && !document.querySelector('#pn-name')"));
console.log('对话框 =', JSON.stringify(B.dialogs));
console.log('（期望：非房主是「退出房间」，确认后干净地回到落地页，而不是连接断了屏还停着）');

console.log('\n--- 房主（甲）点「🏠 回大厅」 ---');
await A.eval("[].slice.call(document.querySelectorAll('button')).filter(function(b){return b.textContent.indexOf('回大厅')>=0})[0].click()");
await sleep(2000);
console.log('点击后: 房主 mode =', await A.eval('PN.app.state.mode'), '| 屏幕有大厅元素 =', await A.eval("!!document.querySelector('.roomcode')"));

console.log('\n--- 房主回大厅后，乙丙能看到大厅吗 ---');
console.log('乙 mode =', await B.eval('PN.app.state && PN.app.state.mode'), '| 乙屏幕有大厅元素 =', await B.eval("!!document.querySelector('.roomcode')"));
console.log('丙 mode =', await C.eval('PN.app.state && PN.app.state.mode'), '| 丙 conn =', await C.eval('PN.app.conn'));
await A.dispose(); await B.dispose(); await C.dispose(); cdp.close();
process.exit(0);
