// 多视口测量：应用容器宽度 / 卡片列数 / 卡片宽度 / 两侧空白（响应式改动前后对比）
import { connect, createRoom, sleep } from './lib.mjs';
const VPS = [
  { n: '手机', w: 390, h: 844 },
  { n: '平板', w: 768, h: 1024 },
  { n: '笔记本', w: 1280, h: 800 },
  { n: '桌面', w: 1920, h: 1080 },
];
const expr = 'JSON.stringify((()=>{const root=document.querySelector("#pn-root")||document.body;const r=root.getBoundingClientRect();const cards=[...document.querySelectorAll(".modecard")];const grid=document.querySelector(".modegrid");const cs=grid?getComputedStyle(grid):{};return {vw:innerWidth,rootW:Math.round(r.width),cols:(cs.gridTemplateColumns||"").split(" ").filter(Boolean).length,cardW:cards[0]?Math.round(cards[0].getBoundingClientRect().width):0,sideGap:Math.round((innerWidth-r.width)/2),docH:document.documentElement.scrollHeight}})())';
const cdp = await connect();
for (const vp of VPS) {
  const A = await createRoom(cdp, '小桃');
  await A.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: false }, A.sid);
  await sleep(1200);
  const o = JSON.parse(await A.eval(expr));
  console.log(vp.n.padEnd(4) + '(' + vp.w + ') 容器' + o.rootW + ' 侧边空' + o.sideGap + '  列数' + o.cols + '  卡宽' + o.cardW + '  页高' + o.docH);
  await A.dispose();
}
cdp.close();
