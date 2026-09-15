// 多视口截图（人工/视觉复核用）：开始页与大厅，桌面与手机
//   node test/browser/shot-views.mjs
import { connect, newPage, createRoom, sleep, APP } from './lib.mjs';
const cdp = await connect();
const desk = { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false };
const phone = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };
const p = await newPage(cdp, APP);
await p.send('Emulation.setDeviceMetricsOverride', desk, p.sid);
await sleep(1500); await p.shot('views-landing-desk');
await p.send('Emulation.setDeviceMetricsOverride', phone, p.sid);
await sleep(1200); await p.shot('views-landing-phone');
await p.dispose();
const A = await createRoom(cdp, '小桃');
await A.send('Emulation.setDeviceMetricsOverride', desk, A.sid);
await sleep(1500); await A.shot('views-lobby-desk');
await A.send('Emulation.setDeviceMetricsOverride', phone, A.sid);
await sleep(1200); await A.shot('views-lobby-phone');
console.log('SHOTS OK');
await A.dispose(); cdp.close();
