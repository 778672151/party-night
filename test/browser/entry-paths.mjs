// 阶段二A 验证：三条进场路径的交互次数与点击→进房耗时
//   node.exe .../entry-paths.mjs
import { connect, newPage, sleep, APP } from './lib.mjs';

const cdp = await connect();
async function trial(label, setup, hash, expectClicks) {
  const p = await newPage(cdp, APP + (hash || ''));
  await sleep(1500);
  if (setup) await p.eval(setup);
  // 重新加载以让 renderLand 走对应分支
  await p.send('Page.navigate', { url: APP + '?t=' + Date.now() + (hash || '') }, p.sid);
  await sleep(2000);
  const land = await p.eval('JSON.stringify({oneClick: !!document.querySelector("#pn-edit-land"), fullForm: !!document.querySelector("#pn-name"), hash: (location.hash||"")})');
  const t0 = Date.now();
  // 模拟「立即进场」所需的最少操作：有房号则什么都不点；否则点主按钮
  const noClick = JSON.parse(land).hash && JSON.parse(land).hash.length > 1;
  if (!noClick) await p.eval('document.querySelector("#pn-create").click()');
  let roomAt = null;
  for (let i = 0; i < 100; i++) {
    const has = await p.eval('!!(PN.app && PN.app.room)');
    if (has) { roomAt = Date.now() - t0; break; }
    await sleep(100);
  }
  console.log('PATH=' + label + ' clicks=' + (noClick ? 0 : 1) + '(期望' + expectClicks + ') ms=' + roomAt + ' LAND=' + land);
  await p.dispose();
}
const store = 'localStorage.setItem("pn_name","小桃");localStorage.setItem("pn_emoji","😎");localStorage.setItem("pn_id","pTESTID01");';
await trial('存量身份+带房号', store, '#ABCD', 0);
await trial('存量身份+无房号', store, '', 1);
await trial('首访(无存储)', 'localStorage.clear();', '', 3);
cdp.close();
