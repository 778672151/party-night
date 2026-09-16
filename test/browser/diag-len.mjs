// 精确定位那个 TypeError 的源码行号（filename:lineno:colno）
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);

async function install(p) {
  await p.eval('(()=>{ window.__hits=[]; window.addEventListener("error", function(e){ window.__hits.push({msg:String(e.message), f:String(e.filename||""), l:e.lineno, c:e.colno, st:String((e.error&&e.error.stack)||"")}); }); return true; })()');
}
await install(A); await install(B);
const takeA = async () => JSON.parse(await A.eval('JSON.stringify(window.__hits.splice(0))'));
const takeB = async () => JSON.parse(await B.eval('JSON.stringify(window.__hits.splice(0))'));

async function step(m) {
  await takeA(); await takeB();
  await A.eval('PN.app.send({t:"start", mode:' + JSON.stringify(m) + '})');
  await sleep(900);
  const eA = await takeA(); const eB = await takeB();
  console.log(m + ': A错误=' + eA.length + ' B错误=' + eB.length + ' mode=' + await A.eval('PN.app.state&&PN.app.state.mode'));
  for (const e of [...eA, ...eB].slice(0, 1)) {
    console.log('   msg=' + e.msg);
    console.log('   at=' + e.f + ':' + e.l + ':' + e.c);
    console.log('   stack=' + e.st.replace(/\n/g, ' || ').slice(0, 400));
  }
  await A.eval('PN.app.send({t:"lobby"})'); await sleep(500);
}
console.log('--- 直接开 go（不经过其它游戏）---');
await step('go');
console.log('--- 开 gomoku（对照）---');
await step('gomoku');
console.log('--- 再开 soko（对照）---');
await step('soko');

// 让 A 把包裹的源码行打出来
const src = await A.eval('(async()=>{const t=await (await fetch(location.href)).text(); const ls=t.split("\\n"); return JSON.stringify(ls.map((s,i)=>({i:i+1,s:s})).filter(o=>/length/.test(o.s)&&/settings|players/.test(o.s)).slice(0,20));})()');
console.log('候选源码行:', String(src).slice(0, 600));
await A.dispose(); await B.dispose(); cdp.close();
