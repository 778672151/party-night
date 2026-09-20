// 合作翻牌：真点卡牌到底有没有生效（避开所有引号转义：用 data-i 直接算选择器）
import { connect, createRoom, joinRoom, waitPlayers, sleep } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');
const B = await joinRoom(cdp, '阿泽', A.code);
await waitPlayers(A, 2); await waitPlayers(B, 2);
await A.eval('PN.app.send({t:"start", mode:"memory"})');
await sleep(2500);
const meA = await A.eval('PN.app.room.me.id');
const st = () => A.eval('JSON.stringify({turn:PN.app.state.g.turn,turns:PN.app.state.g.turns,matched:PN.app.state.g.matched,flipped:(PN.app.state.g.flipped||[]).length,phase:PN.app.state.g.phase})').then(JSON.parse);
console.log('开局: ' + JSON.stringify(await st()));

// 取第一个可点卡片的 data-i（返回纯数字，避免引号）
const firstFree = (p) => p.eval('(function(){var c=[].slice.call(document.querySelectorAll(".mem-card")).filter(function(x){return !x.disabled})[0];return c?Number(c.getAttribute("data-i")):-1;})()');

const tapCard = async (p, i) => {
  const b = await p.box('.mem-card[data-i="' + i + '"]');
  if (!b) { console.log('    找不到卡 ' + i); return false; }
  await p.mouse('mouseMoved', b.x, b.y, { button: 'none' });
  await p.mouse('mousePressed', b.x, b.y, { buttons: 1, button: 'left', clickCount: 1 });
  await p.mouse('mouseReleased', b.x, b.y, { buttons: 0, button: 'left', clickCount: 1 });
  return true;
};

const owner = (await st()).turn === meA ? A : B;
let i1 = await firstFree(owner);
console.log('第一个可点卡 data-i=' + i1);
await tapCard(owner, i1); await sleep(1100);
console.log('点1张后: ' + JSON.stringify(await st()));
let i2 = await firstFree(owner);
console.log('第二张可点卡 data-i=' + i2);
await tapCard(owner, i2); await sleep(2200);
console.log('点2张后: ' + JSON.stringify(await st()));
console.log('报错: ' + await A.consoleErrors());
await A.dispose(); await B.dispose(); cdp.close();
