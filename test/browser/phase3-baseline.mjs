// 阶段3 改动前基线：落地页 + 大厅（联机区/小游戏厅），移动 420x900 与桌面 1280x800
import { connect, newPage, createRoom, joinRoom, waitPlayers, sleep, APP } from './lib.mjs';
const cdp = await connect();
const mobile = { width: 420, height: 900, deviceScaleFactor: 1, mobile: true };
const desk = { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false };
const setVp = async (pg, vp) => pg.send('Emulation.setDeviceMetricsOverride', vp, pg.sid);
const p = await newPage(cdp, APP);
await sleep(2500);
for (const [tag, vp] of [['mobile', mobile], ['desktop', desk]]) {
  await setVp(p, vp);
  await sleep(1200);
  await p.shot('phase3-land-' + tag);
}
await p.dispose();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2);
for (const [tag, vp] of [['mobile', mobile], ['desktop', desk]]) {
  await setVp(A, vp);
  await sleep(1200);
  await A.shot('phase3-lobby-' + tag);
}
console.log('BASELINE 已生成: phase3-land-{mobile,desktop} phase3-lobby-{mobile,desktop}');
await A.dispose(); await B.dispose(); cdp.close();
