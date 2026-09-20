// 干净测量：房主自己开房后，从「meta 发布」到「自己出现在名单」的真实耗时
// 用createRoom（已等到 meta），再逐 200ms 采样，避免假阳性
import { connect, createRoom, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
// 以 createRoom 返回（= meta 已发布）为起点
const t0 = Date.now();
let firstSeen = null;
const marks = [];
for (let i = 0; i < 60; i++) {
  const s = JSON.parse(await A.eval('JSON.stringify({names:(PN.app.state.players||[]).map(p=>p.name),hs:!!(PN.app.host&&PN.app.host.state),isHost:PN.app.room.isHost})'));
  marks.push({ ms: Date.now() - t0, n: s.names.length, hs: s.hs });
  if (s.names.length >= 1 && firstSeen === null) { firstSeen = Date.now() - t0; }
  if (firstSeen !== null) break;
  await sleep(200);
}
console.log('createRoom 返回时（meta 已发布）房主名单长度应为 0，实测 marks[0].n=' + (marks[0] ? marks[0].n : '?'));
console.log('房主「自己出现在名单里」耗时: ' + (firstSeen === null ? '>12000ms ✗' : firstSeen + 'ms'));
console.log('时间线（前 30 条，ms / 名单人数 / hostState）:');
for (const m of marks.slice(0, 30)) console.log('  ' + String(m.ms).padStart(5) + '  n=' + m.n + '  hostState=' + (m.hs ? 1 : 0));
// 界面文案
// 注意：这里**不能**直接写 split("\n") —— 这个字符串在 Node 里会先被解析成真换行，
// 再作为表达式文本发给 CDP，页面收到的就是「字符串字面量里带真换行」→ SyntaxError。
// 用 String.fromCharCode(10) 绕开转义。（原本本脚本就是死在这一句上，量到的 2ms 是真的。）
const txt = await A.eval('(document.body.innerText||"").split(String.fromCharCode(10)).filter(function(s){return /还差一个人|在房里的人/.test(s)}).join(" / ")');
console.log('落地到大厅期间的关键文案: ' + txt);
await A.dispose(); cdp.close();
