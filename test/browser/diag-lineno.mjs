// 复现「切换游戏时报 TypeError」并拿到精确 filename:lineno，再回读构建产物对应源码行
import { connect, createRoom, joinRoom, waitPlayers, sleep, APP } from './lib.mjs';
const SEQ = ['gomoku', 'soko', 'mine', 'hop', 'memory', 'cube', 'domino', 'go', 'tacit', 'codraw', 'drawgame'];
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
async function install(p) { await p.eval('(()=>{ if(window.__hits) return true; window.__hits=[]; window.addEventListener("error", function(e){ window.__hits.push({msg:String(e.message), f:String(e.filename||""), l:e.lineno, c:e.colno}); }); return true; })()'); }
await install(A); await install(B);
const takeA = async () => JSON.parse(await A.eval('JSON.stringify(window.__hits.splice(0))'));
const takeB = async () => JSON.parse(await B.eval('JSON.stringify(window.__hits.splice(0))'));
for (const m of SEQ) {
  await takeA(); await takeB();
  await A.eval('PN.app.send({t:"start", mode:' + JSON.stringify(m) + '})');
  await sleep(900);
  const hits = [...await takeA(), ...await takeB()];
  if (hits.length) {
    const h = hits[0];
    console.log('★ ' + m + ' → ' + h.msg + '  @' + h.f.split('/').pop() + ':' + h.l + ':' + h.c + '  (共' + hits.length + '条)');
    // 把这个行号附近的构建产物打出来
    const ctx = await A.eval('(async()=>{const t=await (await fetch(location.href)).text();const ls=t.split("\\n");const n=' + h.l + ';return JSON.stringify(ls.slice(Math.max(0,n-4),n+2).map((s,i)=>((n-3+i)+": "+s.slice(0,150))));})()');
    console.log('   构建产物上下文:\n' + JSON.parse(ctx).map(s => '     ' + s).join('\n'));
    break;
  }
  console.log('  ok ' + m);
  await A.eval('PN.app.send({t:"lobby"})'); await sleep(500);
}
await A.dispose(); await B.dispose(); cdp.close();
