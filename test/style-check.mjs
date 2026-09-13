// CSS 静态检查（零依赖）：
//   node test/style-check.mjs
// 为什么需要：有一次给新游戏追加样式时注释漏了结尾的 */，
// 浏览器会把它后面**整段样式**当注释吞掉 —— 语法检查发现不了，页面看起来"样式没生效"。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const css = readFileSync(ROOT + 'src/style.css', 'utf8');
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };

const open = (css.match(/\/\*/g) || []).length;
const close = (css.match(/\*\//g) || []).length;
ok(open === close, '注释成对：/* = ' + open + '，*/ = ' + close + (open === close ? '' : '（缺 ' + (open - close) + ' 个 */ —— 会把后面的样式全吞掉）'));

// 去掉注释再数括号，注释里的 { } 不算
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
const bo = (stripped.match(/{/g) || []).length;
const bc = (stripped.match(/}/g) || []).length;
ok(bo === bc, '大括号成对：{ = ' + bo + '，} = ' + bc);

// 每条规则的选择器不能是空的（例如 "{}" 或 ",{}"）
const badSel = [];
const re = /([^{}]*)\{/g;
let m;
while ((m = re.exec(stripped))) {
  const sel = m[1].replace(/@[a-z-]+[^{]*/gi, '').trim();
  const at = m[1].trim();
  if (at.charAt(0) === '@') continue;           // @keyframes/@media 的头部不算
  if (!sel) badSel.push(JSON.stringify(m[1].slice(-40)));
}
ok(badSel.length === 0, '没有空选择器' + (badSel.length ? '：' + badSel.slice(0, 3).join(' / ') : ''));

// 本轮踩过的坑：新加的功能块必须真的在文件里成段出现
for (const key of ['mem-card', 'cd-stage', '.tac-opt', '.dg-stage']) {
  ok(css.indexOf(key) >= 0, '存在样式块：' + key);
}
console.log('\n结果：' + (fail ? fail + ' 项不合格' : '全部通过'));
process.exit(fail ? 1 : 0);
