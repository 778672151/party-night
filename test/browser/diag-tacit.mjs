import { connect, createRoom, joinRoom, waitPlayers, startGame, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2);
const H = (await A.eval('PN.app.isHost()')) ? A : B;
await startGame(H, 'tacit');
await H.waitFor('PN.app.state.mode === "tacit" && PN.app.state.g && PN.app.state.g.cur', '进入对局', 30000);
await sleep(1500);
await sleep(2500); await H.shot('tacit-toon-check');
const out = await H.eval(`(function(){
  var o = document.querySelector('.tac-opts'), c = document.querySelector('.tac-3d'), b = document.querySelector('.tac-opt');
  function info(el, name){ if(!el) return name + '=缺失'; var s = getComputedStyle(el), r = el.getBoundingClientRect();
    return name + '{display:' + s.display + ', pos:' + s.position + ', w:' + Math.round(r.width) + ', h:' + Math.round(r.height) + ', pad:' + s.paddingTop + ', cssPos:' + (s.position) + '}'; }
  var cs = c ? getComputedStyle(c) : null; return 'canvasAttr=' + (c ? (c.width + 'x' + c.height) : '?') + ' cssBox=' + (c ? (Math.round(c.getBoundingClientRect().width) + 'x' + Math.round(c.getBoundingClientRect().height)) : '?') + ' dpr=' + devicePixelRatio + ' transform=' + (cs ? cs.transform : '-') + ' | ' + [info(o,'opts'), info(c,'canvas'), info(b,'btn'), 'optsKids=' + (o ? o.children.length : -1), 'btnH=' + (b ? Math.round(b.getBoundingClientRect().height) : -1)].join(' | ');
})()`);
console.log('DIAG ' + out);
console.log('ERRORS ' + await A.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
