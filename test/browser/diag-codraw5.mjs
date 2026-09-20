// 心有灵犀揭晓：应有两张 .cd-sv 画布，且都能看到墨迹
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
await A.eval('PN.app.send({t:"start", mode:"codraw"})');
await sleep(2500);
for (const p of [A, B]) { try { await p.touchDrag('canvas.cd-cv', [0.2, 0.3], [0.7, 0.7], 12); } catch (e) {} }
await sleep(1200);
const ready = '(()=>{var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){return /画好了/.test(x.textContent)})[0]; if(b){b.click();return true;} return false;})()';
await A.eval(ready); await sleep(900);
await B.eval(ready); await sleep(2500);
console.log('phase=' + await A.eval('PN.app.state.g.phase'));

const svPix = 'JSON.stringify((function(){var cs=[].slice.call(document.querySelectorAll("canvas.cd-sv")); return cs.map(function(cv){var c=cv.getContext("2d"); var d=c.getImageData(0,0,cv.width,cv.height).data; var n=0; for(var i=3;i<d.length;i+=4){if(d[i]>10)n++;} return {w:cv.width,h:cv.height,ink:n};});})())';
// 等回放补齐
for (let i = 0; i < 15; i++) {
  const a = JSON.parse(await A.eval(svPix));
  if (a.length >= 2 && a.every(x => x.ink > 200)) break;
  await sleep(1000);
}
const A2 = JSON.parse(await A.eval(svPix));
const B2 = JSON.parse(await B.eval(svPix));
console.log('A 端揭晓画布: ' + JSON.stringify(A2));
console.log('B 端揭晓画布: ' + JSON.stringify(B2));
const okA = A2.length === 2 && A2.every(x => x.ink > 200);
const okB = B2.length === 2 && B2.every(x => x.ink > 200);
console.log('  → A 看到两张有内容的画: ' + (okA ? '✓' : '✗'));
console.log('  → B 看到两张有内容的画: ' + (okB ? '✓' : '✗'));
// 标签文字
console.log('标签: ' + await A.eval('JSON.stringify([].slice.call(document.querySelectorAll(".cd-lbl")).map(function(e){return e.textContent}))'));
console.log('报错 A=' + await A.consoleErrors() + ' B=' + await B.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
