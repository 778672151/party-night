// 心有灵犀：揭晓后对方的画应该看得到（设计：draw 阶段互不可见，reveal 阶段才给）
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
await A.eval('PN.app.send({t:"start", mode:"codraw"})');
await sleep(2500);

const pix = 'JSON.stringify((function(){var cv=document.querySelector("canvas.cd-cv"); if(!cv)return null; var c=cv.getContext("2d"); var d=c.getImageData(0,0,cv.width,cv.height).data; var n=0; for(var i=3;i<d.length;i+=4){if(d[i]>10)n++;} return n;})())';

// 双方各真画一笔
for (const p of [A, B]) { try { await p.touchDrag('canvas.cd-cv', [0.2, 0.3], [0.7, 0.7], 12); } catch (e) {} }
await sleep(1200);
console.log('draw 阶段：A 自己=' + await A.eval(pix) + ' A 看到对方画布(B侧)=' + await B.eval(pix));
console.log('  （draw 阶段两端各自只看到自己的画 = 设计如此）');

// 双方真点「我画好了」
const ready = '(()=>{var bs=[].slice.call(document.querySelectorAll("button"));var b=bs.filter(function(x){return /画好了/.test(x.textContent)})[0]; if(b){b.click();return true;} return false;})()';
await A.eval(ready); await sleep(900);
await B.eval(ready); await sleep(2000);
const ph = await A.eval('PN.app.state.g.phase');
console.log('交卷后 phase=' + ph);

// 揭晓阶段：等 replay
if (ph === 'reveal') {
  for (let i = 0; i < 12; i++) {
    const a = await A.eval(pix), b = await B.eval(pix);
    if (a !== '0' && b !== '0') break;
    await sleep(1000);
  }
  console.log('reveal 阶段实际像素：A=' + await A.eval(pix) + ' B=' + await B.eval(pix));
  console.log('  → A 画布有两幅画（自己+对方）: ' + (Number(await A.eval(pix)) > 800 ? '✓' : '✗'));
  console.log('  → B 画布有两幅画: ' + (Number(await B.eval(pix)) > 800 ? '✓' : '✗'));
}
console.log('报错 A=' + await A.consoleErrors() + ' B=' + await B.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
