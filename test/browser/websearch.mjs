// 用 Windows 浏览器的真实网络抓页面正文（modsearch 工具不可用时的替代）
//
// 【实测结论 2024】搜索引擎会自动搜索被反爬拦死，别在这上面浪费时间：
//   bing.com  → 只返回页面框架，不返回结果条目
//   lite.duckduckgo.com → 直接给人机验证码（Select all squares containing a duck）
// 能用的是【直读具体 URL】：把 url 换成目标页即可，但 JS 重的站点（如 m3.material.io）抽出的正文为空。
//   node.exe .../websearch.mjs "<查询词>" [最多字符数]
import { connect, newPage, sleep } from './lib.mjs';

const q = process.argv[2] || '明日方舟 UI 设计 排版 分析';
const limit = Number(process.argv[3] || 2200);
const cdp = await connect();
const url = 'https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q);
const p = await newPage(cdp, url);
await sleep(3500);
const raw = await p.eval('(document.body.innerText || "")');
const txt = String(raw || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean).join("\n");
console.log('=== 查询: ' + q + ' ===');
console.log(String(txt || '').slice(0, limit));
await p.dispose(); cdp.close();
