// 验证 5 秒窗口：加入者抢在窗口内进房，两人会不会互相看不到 / 名单错乱
import { connect, createRoom, newPage, waitPlayers, sleep, APP } from './lib.mjs';
const cdp = await connect();
const A = await createRoom(cdp, '小桃');   // createRoom 内部已等到 meta 发布
const t0 = Date.now();
console.log('房主创建完成，房号=' + A.code);

// 立刻（0 延迟）用新标签进房
const B = await newPage(cdp, APP + '#' + A.code);
await B.fill('#pn-name', '阿泽');
await B.click('#pn-join');

// 每 500ms 打一次两端名单，直到稳定
for (let i = 0; i < 20; i++) {
  await sleep(500);
  const a = await A.eval('JSON.stringify({mode:PN.app.state.mode,names:(PN.app.state.players||[]).map(p=>p.name),hs:!!(PN.app.host&&PN.app.host.state)})');
  const b = await B.eval('JSON.stringify({mode:PN.app.state.mode,names:(PN.app.state.players||[]).map(p=>p.name),hs:!!(PN.app.host&&PN.app.host.state)})').catch(()=>'(未就绪)');
  console.log(String(Date.now()-t0).padStart(5) + 'ms 房主=' + a + '  加入者=' + b);
}
console.log('---- 最终 ----');
console.log('房主看到 ' + await A.eval('JSON.stringify((PN.app.state.players||[]).map(p=>p.name))'));
console.log('加入者看到 ' + await B.eval('JSON.stringify((PN.app.state.players||[]).map(p=>p.name))'));
await A.dispose(); await B.dispose(); cdp.close();
