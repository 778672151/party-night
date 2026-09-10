// wire.js 单测：信封 / 分块落位 / 缺号检测 / 补发内容
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
globalThis.PN = globalThis.PN || {};
eval(readFileSync(ROOT + 'src/wire.js', 'utf8'));
const W = globalThis.PN.Wire;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

console.log('[1] 信封');
{
  const m = W.pack('x', { t: 'stroke' }, 3);
  ok(m.v === 4 && m.ch === 'x' && m.r === 3, '包上版本号/通道/轮次');
  ok(W.isV4(m) === true, 'v4 消息判真');
  ok(W.isV4({ v: 3 }) === false && W.isV4(null) === false, '旧版本/空消息判假（整条丢弃）');
  ok(W.pack('x', {}, null).r === undefined, '轮次为空时不写 r');
}

console.log('\n[2] 正常分块：不报缺口，连续前缀一直涨');
{
  const pts = [];
  let have = 0, gaps = 0;
  for (let i = 0; i < 5; i++) {
    const r = W.place(pts, have, { i0: i * 3, s: [[i, i], [i, i], [i, i]] });
    have = r.have; if (r.gap) gaps++;
  }
  ok(gaps === 0, '顺序到达时不报缺口');
  ok(have === 15 && pts.length === 15, '15 个点全部落位（have=' + have + '）');
}

console.log('\n[3] 丢中间一块：必须报出空洞');
{
  const pts = [];
  let have = W.place(pts, 0, { i0: 0, s: [1, 2, 3] }).have;      // 0,1,2
  const r = W.place(pts, have, { i0: 6, s: [7, 8, 9] });          // 直接跳到 6..8
  ok(!!r.gap, '报出空洞');
  ok(r.gap && r.gap[0] === 3 && r.gap[1] === 5, '空洞范围 = [3,5]（实际 ' + JSON.stringify(r.gap) + '）');
  ok(r.have === 3, '连续前缀仍停在 3（后面来的点先存着，不乱画）');
}

console.log('\n[4] 补发后空洞被填上，且乱序到达也不写歪');
{
  const pts = [];
  let have = W.place(pts, 0, { i0: 0, s: ['a', 'b', 'c'] }).have;
  have = W.place(pts, have, { i0: 6, s: ['g', 'h', 'i'] }).have;   // 缺 3,4,5
  const back = W.place(pts, have, { i0: 3, s: ['d', 'e', 'f'] });  // 补发（晚到）
  ok(back.have === 9, '补发到位后连续前缀补到 9（实际 ' + back.have + '）');
  ok(pts.join('') === 'abcdefghi', '点序完全正确：' + pts.join(''));
}

console.log('\n[5] 发送端缓冲：只留最近几笔，补发内容正确');
{
  const out = new W.Out(2);
  out.pack('k1r1', 0, [1, 2, 3], { r: 1 });
  out.pack('k1r1', 3, [4, 5, 6], { r: 1 });
  out.pack('k1r1', 6, [7, 8, 9], { r: 1 });
  const miss = out.missing('k1r1', 3);
  ok(miss.length === 2 && miss[0].i0 === 3 && miss[1].i0 === 6, '要 from=3 → 补发 3.. 和 6.. 两块');
  ok(out.missing('k1r1', 0).length === 3, '要 from=0 → 补发全部三块');
  ok(out.missing('k9r1', 0).length === 0, '要一笔不存在的 → 空');
  out.pack('k2r1', 0, [1], {}); out.pack('k3r1', 0, [1], {});
  ok(out.missing('k1r1', 0).length === 0, '超过保留笔数后，最老的一笔被丢弃（内存有上限）');
  ok(out.seq === 5, '序号全局递增（' + out.seq + '）');
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
