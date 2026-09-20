// 心有灵犀：真拖拽后，对端是否真的收到并画出来了（ink 是模块私有，不能从 state 读）
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
const meA = await A.eval('PN.app.room.me.id'), meB = await B.eval('PN.app.room.me.id');
await A.eval('PN.app.send({t:"start", mode:"codraw"})');
await sleep(2500);
console.log('phase=' + await A.eval('PN.app.state.g.phase'));

// 给两端画布加墨迹计数探针：统计画布上的笔画数（canvas 像素非空计数）
const probe = 'window.__ink=0; (function(){var cv=document.querySelector("canvas.cd-cv"); if(!cv)return; var c=cv.getContext("2d"); var orig=c.stroke.bind(c); c.stroke=function(){window.__ink++; return orig.apply(c,arguments);};})()';
await A.eval(probe); await B.eval(probe);

// A 真拖拽画一笔
let drew = false;
try { await A.touchDrag('canvas.cd-cv', [0.2, 0.3], [0.75, 0.7], 12); drew = true; } catch (e) { console.log('A 拖拽失败: ' + e.message); }
await sleep(1800);
console.log('A 拖拽=' + drew);
console.log('A 自己画布 stroke 次数=' + await A.eval('window.__ink'));
console.log('B 画布 stroke 次数=' + await B.eval('window.__ink') + '  ← 对端收到才算同步成功');

// 直接看画布是否有非透明像素（更直接）
const nonEmpty = 'JSON.stringify((function(){var cv=document.querySelector("canvas.cd-cv"); if(!cv)return null; var c=cv.getContext("2d"); var d=c.getImageData(0,0,cv.width,cv.height).data; var n=0; for(var i=3;i<d.length;i+=4){ if(d[i]>10) n++; } return {w:cv.width,h:cv.height,inkPixels:n};})())';
console.log('A 画布墨迹像素: ' + await A.eval(nonEmpty));
console.log('B 画布墨迹像素: ' + await B.eval(nonEmpty));
console.log('报错 A=' + await A.consoleErrors() + ' B=' + await B.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
