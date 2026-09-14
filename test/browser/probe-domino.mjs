// 探针：骨牌顶牛原作能不能被外部驱动进牌局（桥接思路验证）
import { connect, newPage, sleep, APP } from './lib.mjs';
const cdp = await connect();
const p = await newPage(cdp, APP);
await p.eval(`(() => {
  document.documentElement.innerHTML = '<body style="margin:0"><iframe id="f" style="width:100%;height:100%;border:0" src="/mini/demo-c046ab75/index.html"></iframe></body>';
  return 1;
})()`);
const probe = (expr) => p.eval(expr);
let out = [];
for (const wait of [3000, 6000, 10000]) {
  await sleep(wait === 3000 ? 3000 : 3000);
  const st = await probe(`(() => {
    const w = document.getElementById('f').contentWindow;
    const d = document.getElementById('f').contentDocument;
    let info = {};
    try {
      info = {
        hasGame: !!(w.game && w.game.players),
        phase: w.game ? String(w.game.phase) : '?',
        current: w.game ? w.game.currentPlayer : -1,
        round: w.game ? w.game.round : -1,
        chain: w.game && w.game.chain ? w.game.chain.length : -1,
        screens: Array.prototype.map.call(d.querySelectorAll('[id$=Screen], .screen'), function(e){ return e.id + (getComputedStyle(e).display === 'none' ? ':off' : ':on'); }).slice(0, 6).join(','),
      };
    } catch (e) { info = { err: String(e && e.message) }; }
    return JSON.stringify(info);
  })()`);
  out.push('t+' + wait + 'ms ' + st);
}
out.forEach(l => console.log('  ' + l));
console.log('ERRORS ' + await p.consoleErrors());
await p.dispose(); cdp.close();
