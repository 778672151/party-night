// 更新提示实测（阶段四：迭代机制）
//   node test/browser/update-tip.mjs
// 做法：把 dist/version.json 临时改成"更高版本"（模拟线上已发新版），
// 打开页面看有没有出现「有新版本」提示；无论成败最后都还原文件（finally）。
import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connect, newPage, sleep, assert, APP } from './lib.mjs';

// 用 fileURLToPath：这个脚本是用 Windows 的 node 跑的，脚本 URL 是 UNC 路径（\\wsl.localhost\...），
// 手写字符串替换会拼错（之前就拼成了 ...\Ubuntu\Ubuntu\...）。
const VJSON = fileURLToPath(new URL('../../dist/version.json', import.meta.url));
const BAK = VJSON + '.bak-test';
const original = readFileSync(VJSON, 'utf8');
let cdp = null, page = null, failed = 0;

try {
  copyFileSync(VJSON, BAK);
  const fake = JSON.parse(original);
  fake.version = '9.9.9';
  fake.builtAt = new Date().toISOString();
  writeFileSync(VJSON, JSON.stringify(fake, null, 1) + '\n');
  console.log('把版本临时改成 9.9.9（当前 ' + JSON.parse(original).version + '）');

  cdp = await connect();                 // connect(port) 连的是 CDP 端口
  page = await newPage(cdp, APP);        // newPage(cdp, url) 才负责打开页面
  await sleep(2500);
  const shown = await page.eval('!!document.getElementById("pn-update")');
  const text = await page.eval('(document.getElementById("pn-update")||{}).textContent || ""');
  assert(shown, '页面提示了「有新版本」（检测到 version.json 与内嵌版本不一致）');
  assert(text.indexOf('9.9.9') >= 0, '提示里写出了新版本号：' + text.replace(/\s+/g, ' ').trim().slice(0, 60));
  assert(await page.eval('!!document.getElementById("pn-update-go")'), '提示里有「刷新看看」按钮（点它 location.reload）');
  await page.shot('update-tip');

  // 还原后再刷一次：不该再有提示（否则就是误报）
  writeFileSync(VJSON, original);
  await page.eval('location.reload()');
  await page.waitFor('document.readyState === "complete"', '重新加载', 20000);
  await sleep(2500);
  assert(!(await page.eval('!!document.getElementById("pn-update")')), '版本一致时不会提示（不误报）');
  const errs = await page.consoleErrors();
  assert(errs === '[]', '全程无 JS 报错：' + errs);
} catch (e) {
  failed = 1;
  console.log('  ✗ 异常: ' + (e && e.message));
} finally {
  writeFileSync(VJSON, original);                       // 还原（失败也要还原）
  if (existsSync(BAK)) unlinkSync(BAK);
  console.log('已还原 dist/version.json：' + readFileSync(VJSON, 'utf8').trim().split('\n')[1]);
  try { if (page) await page.dispose(); if (cdp) await cdp.close(); } catch (e) {}
}
console.log(failed ? '有用例失败' : '全部通过');
process.exit(failed);
