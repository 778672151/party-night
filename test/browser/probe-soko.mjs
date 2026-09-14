// 复用可行性探针：原作《鲸鱼推箱子》能不能从外部驱动？
//   node test/browser/probe-soko.mjs
// 验证：①能载入并跑起来 ②window.tallgrass.puzzle.input(dir) 真的能让鲸鱼动 ③状态可读 ④能指定关卡
// 注意：父页面必须从本地服务载入（about:blank 的原点是 opaque，/mini/... 解析不到同源路径）
import { connect, newPage, sleep, assert, APP } from './lib.mjs';

const cdp = await connect();
const p = await newPage(cdp, APP);
const out = [];

await p.eval(`(() => {
  window.__errs = [];
  window.addEventListener('error', e => window.__errs.push(String(e.message || e)), true);
  document.documentElement.innerHTML = '<head></head><body style="margin:0"><iframe id="f" style="width:100%;height:100%;border:0" src="/mini/plus-2265f7c6/index.html"></iframe></body>';
  const fr = document.getElementById('f');
  fr.addEventListener('load', () => {
    try {
      fr.contentWindow.addEventListener('error', e => window.__errs.push('iframe: ' + String(e.message || e)), true);
    } catch (e) {}
  });
  return 1;
})()`);

let booted = false, probe = '';
for (let i = 0; i < 70; i++) {
  const r = await p.eval('(() => { try { const w = document.getElementById("f").contentWindow; const h = document.getElementById("f").contentDocument; return JSON.stringify({ tg: !!(w && w.tallgrass), puzzle: !!(w && w.tallgrass && w.tallgrass.puzzle), title: h ? (h.title || "") : "", body: h && h.body ? h.body.innerText.slice(0, 80) : "" }); } catch (e) { return JSON.stringify({ err: String(e && e.message) }); } })()');
  probe = r;
  const o = JSON.parse(r);
  if (o.puzzle) { booted = true; break; }
  await sleep(500);
}
const errs = await p.eval('JSON.stringify((window.__errs || []).slice(0, 6))');
out.push('① 载入 boot：' + (booted ? '成功' : '失败'));
out.push('   探测：' + probe);
out.push('   页面报错：' + errs);
assert(booted, '原作能在 iframe 里跑起来（window.tallgrass.puzzle 存在）');

const st0 = JSON.parse(await p.eval(`(() => {
  const q = document.getElementById('f').contentWindow.tallgrass.puzzle;
  const r = q.rules;
  return JSON.stringify({ player: r.player, boxes: r.boxes, moves: r.moves, pushes: r.pushes, goals: (r.level && r.level.goals) ? r.level.goals.length : -1 });
})()`));
out.push('② 状态可读：player=' + JSON.stringify(st0.player) + ' boxes=' + JSON.stringify(st0.boxes) + ' moves=' + st0.moves + ' 目标点=' + st0.goals);

await p.eval(`(() => { document.getElementById('f').contentWindow.tallgrass.puzzle.input('right'); return 1; })()`);
await sleep(1400);
const st1 = JSON.parse(await p.eval(`(() => { const r = document.getElementById('f').contentWindow.tallgrass.puzzle.rules; return JSON.stringify({ player: r.player, boxes: r.boxes, moves: r.moves, pushes: r.pushes }); })()`));
out.push('③ 外部驱动 input("right")：moves ' + st0.moves + '→' + st1.moves + '，pushes ' + st0.pushes + '→' + st1.pushes);
out.push('   player ' + JSON.stringify(st0.player) + ' → ' + JSON.stringify(st1.player));

const loaded = await p.eval(`(() => { try { document.getElementById('f').contentWindow.tallgrass.puzzle.load(3); return 'ok'; } catch (e) { return String(e && e.message); } })()`);
await sleep(900);
const st2 = JSON.parse(await p.eval(`(() => { const r = document.getElementById('f').contentWindow.tallgrass.puzzle.rules; return JSON.stringify({ boxes: r.boxes.length, moves: r.moves, player: r.player }); })()`));
out.push('④ 载入第 4 关 load(3)：' + loaded + ' → boxes=' + st2.boxes + ' moves=' + st2.moves + ' player=' + JSON.stringify(st2.player));

await p.shot('probe-soko');
console.log('\n=== 探针结果 ===');
out.forEach(l => console.log('  ' + l));
await p.dispose(); cdp.close();
