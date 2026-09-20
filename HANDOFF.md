# 交接提示词（粘贴到新会话的第一条消息）

你接手一个已经上线、能用的项目。不要从头重写，先读代码再动手。

## 项目是什么
「群友派对之夜」——一个**单文件 HTML** 的联机派对小游戏合集，给一群朋友（群友）用手机/电脑浏览器一起玩。
- 仓库：/home/zuoye/日用/party-night/（工作目录就是它；`pwd` 确认，不要用 checkout 路径）
- 线上：https://778672151.github.io/party-night/ （GitHub Pages）
- 仓库地址：https://github.com/778672151/party-night
- 当前 HEAD：16226e0（工作树干净）；线上文件与 index.html md5 一致
- 玩法合集：谁是卧底 / 波长 / 谁最有可能 / 你画我猜（4 个游戏 + 大厅）

## 硬约束（用户已确认过的设计决策，不许改）
1. **零服务器**：不引入任何自建后端。联机靠公共 MQTT broker over WSS。
2. **单文件产物**：`node build.mjs` 把 CSS/JS/题库内联成 `dist/party-night.html`，再 `cp dist/party-night.html index.html`。产物是唯一要部署的东西。
3. **零 npm 依赖**：仓库没有 package.json，测试用自己写的 headless harness（test/harness.mjs）。不要引入运行时依赖。
4. **全中文 UI**，面向不懂技术的群友：点链接→输名字→就能玩。
5. **不要用子代理**（用户明确要求过）：所有工作亲自 inline 做完。

## 架构（务必先读这些文件）
- `src/mqtt.js` 手写的 MQTT 3.1.1 over WebSocket（QoS 0 + 应用层 ACK/重传/去重）
- `src/room.js` 房间抽象：beacon/sweep/election 选房主、topic `pn3/{CODE}/{a|s|m|e|x|p|k}`、XOR 混淆；**私密通道 ECDH-P256 + AES-GCM**
- `src/host.js` 房主权威：`dispatch()` 是所有 action 的唯一入口；状态由房主算好后 retained 发布，客户端只渲染
- `src/games/*.js` 4 个游戏的房主逻辑；`src/screens-*.js` 4 个游戏的客户端渲染（`render(state, secret)` 返回一个根元素）
- `src/ui.js` 渲染器：`onState/onHost/onStatus/onPrivate` 触发 render，render = `clear()` + 重建整棵 DOM
- `src/style.css` 样式；`data/*.json` 题库，build 时注入 `__PN_BANKS__`

## 关键设计契约（踩过坑才知道的）
- **客户端每收到一条状态消息就整树重建 DOM**（`ui.js` render → clear）。因此任何"正在进行中的交互"（拖拽作画、输入法拼音）都必须用 `screen.deferRender()` 冻结重建，结束后 `ui.flushRender()` 补渲染。已有实现见 `src/ui.js` 的 `imeFreeze`/`deferRender` 和 `src/screens-drawgame.js` 的 `local.painting`。
- **换局/换轮判定**：`startedAt` 只在开局写一次，**换轮只能靠 `g.round` 判定**（这是刚修过的 bug）。
- 房主 action 名是 `_left`，不是 `bye`（`room.js` 会把 will 消息翻译成 `_left`）。
- 画笔画走 peer 通道，不进 state；房主留一份 `getRD(round).segments` 用于中途加入回放，**按轮次分开存**。

## 刚修完的三个真 bug（都是"单测测不出、真浏览器才犯"的）
1. 落笔期间状态更新重建 DOM → 画布被拆 → 指针捕获丢失 → 断笔。（已用 deferRender 修）
2. 中文输入法：回车确认候选词被当成提交；拼音上屏中重建 DOM 导致丢字。（已用 isComposing/keyCode 229 + imeFreeze 修）
3. 换轮不清屏：`resetIfNewGame` 用 `startedAt` 判定，换轮时它没变 → 画布带着上一轮的画继续用，另一端显示错。（已改按 `round` 判定；笔画带 `r` 标记，收端丢弃非当前轮残尾）

## 本环境的硬事实（别浪费时间去撞）
- Node v24.19.0；**没有 sudo**，**审批提示被禁用**（`sandbox_permissions` 不要设，设了也会被拒）。
- **Playwright/真浏览器跑不起来**（缺 libnss3 等系统库，装不了）。所以：真浏览器行为只能靠 jsdom + 打桩布局来逼近，**最终点击/拖拽验证必须由用户来做**，你要明确说出来。
- jsdom 只装在 `/tmp/pnt/node_modules`（不在仓库里，因为仓库零依赖）。跑 `test/regress-drawgame-screen.mjs` 需要临时软链：`ln -sfn /tmp/pnt/node_modules node_modules` 然后 `rm -f node_modules`。缺 jsdom 时该用例会打印 SKIP。
- jsdom 没有指针捕获语义、不派发 pointercancel、`getBoundingClientRect()` 恒为 0 → 这类测试必须自己打桩矩形并假装捕获。
- `pkill -f 'xxx'` 会匹配到你自己的 shell 命令行（命令行里含该字符串）→ 自杀。别这么干。
- 部署：`cp dist/party-night.html index.html` → commit → `git -c http.extraheader="Authorization: Basic $(printf 'x-access-token:%s' "$TOKEN" | base64 -w0)" push origin main`。远端被改写成 gh-proxy 镜像。**PAT 需要用户提供**（旧的已泄露、要求用户 revoke）。
- 部署后必须验：`curl` 下载线上文件 + `md5sum` 对比 index.html，别只看 HTTP 200。

## 测试怎么跑
```
node test/mostlikely-test.mjs
node test/integration-wavelength.mjs
node test/integration-drawgame.mjs          # 打真实公共 broker，跑完整两轮
node test/proxy.mjs &  PROXY=1 node test/integration-undercover.mjs
ln -sfn /tmp/pnt/node_modules node_modules && node test/regress-drawgame-screen.mjs; rm -f node_modules
node build.mjs
```
（真实 broker 用例是异步联网的，偶发抖动要重跑而不是改断言。）

## 工作纪律
- 先 `grep -n` 确认锚点再 `edit`，禁止凭记忆写 old_string。
- 每次编辑后立刻跑最便宜的真实检查（`node --check` / 相关用例），不许攒着。
- 没有贴出命令+输出，不许说"修好了/通过了"。
- 用户报 bug 时先问清"第几步、点了什么、看到什么"，别猜。用户之前因为猜错方向浪费过时间。

## 当前状态
全部测试绿：mostlikely PASS、wavelength PASS、drawgame PASS（含换轮）、undercover PASS、regress-drawgame-screen 32/0、build 正常、线上已核对。**没有已知未修复缺陷。**
