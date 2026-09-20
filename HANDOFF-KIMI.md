# 交接提示词：party-night（群友派对之夜）— 交给 Kimi K3 审查并继续开发

> 用法：把本文件**整份**作为新会话的第一条消息发给我（Kimi K3）。它是自包含的，不需要额外上下文。

---

## 0. 你的角色与这次任务

你是接手 **party-night** 的工程师。这位使用者的工作方式是：
- **只认证据**：任何"修好了/通过了"都必须附**实际命令 + 真实输出**；不许说"应该""看起来""大概"。
- **先复现再改**：修 bug 必须先给出可重复的最小复现，再改，一次只动一处，改完立刻验证；失败就回退并如实报告。
- **不要重复造轮子**：项目刻意大量**复用已移植的原作代码**，只做双人兼容层。新功能优先复用现有实现。
- **不提交、不部署，除非明确要求**；改动前先说明"改哪里、影响面多大"。

本次任务：**审查前一位工程师最近的 4 处改动**（见 §4），确认它们正确、无副作用，然后按 §8 的待办继续开发。

---

## 1. 项目是什么

**「两个人的游戏厅」**：双人联机 + 零服务器的**单文件网页**小游戏合集。

- 线上：`https://778672151.github.io/party-night/`（GitHub Pages）
- 仓库：`https://github.com/778672151/party-night`（分支 `main`）
- 玩法：两个人各自打开链接、进同一个房间（4 位房号）就能玩。手机可直接玩。
- **没有账号体系**：身份是 localStorage 里随机生成的 `pXXXXXXX`。"两个人"= **房主** 与 **加入者**（两台设备/两个标签页）。
- **没有后端、没有依赖**：无 `package.json`、无 `node_modules`。构建产物就是一个 HTML 文件。

体量：`src/` 共约 5800 行；最大文件 `src/ui.js` 约 750 行。

---

## 2. 架构（改代码前必须理解的 6 件事）

### 2.1 构建：源码 → 单文件
```
build.mjs 把 src/*.js + src/style.css 拼进 index.template.html
        → dist/party-night.html
        → 同时写 version.json（仓库根 + dist/ 两份）
VERSION 文件是唯一版本来源；版本号内嵌进产物
```
**改完源码必须重新构建**，否则测的还是旧产物：
```bash
node build.mjs && cp dist/party-night.html index.html   # Pages 要的是根目录 index.html
```

### 2.2 传输：公共 MQTT broker（这是最大的外部不确定性）
- 主 `wss://broker.emqx.io:8084/mqtt`，备用 `wss://broker.hivemq.com:8884/mqtt`。
- 手写的 MQTT 3.1.1 over WebSocket，**QoS0**，零依赖。
- **房主即权威**：所有状态只由房主计算，用 retained 消息广播，其他人只渲染；晚到/刷新的人一进房就拿到当前状态。
- **房号即房间**：话题前缀 `pn3/{房号}/...`。
- **私密数据真加密**：词/答案走 ECDH P-256 + AES-GCM 点对点，**绝不进 state**（`host.sendSecret` / `host.secretCache`）。
- ⚠️ 公共 broker 会间歇性抖动/掉线。**测试失败先判断是不是环境问题**（见 §7.3）。

### 2.3 分层
| 文件 | 职责 |
|---|---|
| `src/room.js` | 连接、房号、心跳、选主（房主迁移）、retained 状态、墨迹通道 |
| `src/host.js` | **权威状态机**：`{v,mode,phase,players[],settings,log,g,hostId,ts}`、定时器注册、`dispatch` |
| `src/games/*.js` | 各游戏**纯规则**（只跑在房主侧） |
| `src/screens-*.js` | 各游戏**界面 + 输入**（客户端） |
| `src/ui.js` | 外壳：路由 `setScreen`、大厅、顶栏、toast、屏幕生命周期 |
| `src/toon.js` | 自研三渲二 canvas 渲染层（零依赖、不用 WebGL） |
| `src/canvas-ink.js` | 画笔墨迹通道（归一化坐标、分块、缺号补发） |
| `src/app.js` | 启动装配 |

### 2.4 游戏契约（新增游戏只写数据，入口零改动）
```js
PN.games[ID] = { id, name, emoji, blurb, minPlayers, maxPlayers, init, action, resume, onLeave, meta }
```
入口由"一份目录"驱动：`PN.gameCommon.catalog()` = `PN.games` + `data/mini.json`，
分区 `sections()`、统一卡片 `gameCard()`。加联机游戏只写 `src/games/<id>.js`；
加小游戏只写 `data/mini.json`。**`ui.js` 一行都不用动。**

### 2.5 屏幕生命周期（有坑，别踩）
- 屏幕可实现 `patch(state)`：DOM 关心的字段没变就返回 `true`，**跳过整屏重建**。
- 屏幕可实现 `stop()`：**离开屏幕时收摊**。抽屉里有模块级 `setInterval` 的屏幕**必须**实现它，
  否则切到下一个游戏后会读到错误的 `state.g` 并抛 `TypeError`（历史真事故）。
  目前已实现：`screens-go/cube/domino/soko`。
- **状态广播频率 = DOM 重建频率**，这是本项目最容易踩的性能坑（画布每秒被拆掉重建 → 严重卡顿）。
  画布类屏幕要跨渲染复用同一 canvas 节点，且一个画布只挂一个动画循环。

### 2.6 关键不变量
- 房主 = 唯一权威；客户端**不做乐观更新**（等状态回来再重建）。
- 私密数据（词/答案/牌堆）**只在房主闭包或加密点对点里**，绝不能进 `state`。
- iframe 类游戏（推箱子/围棋/魔方/骨牌顶牛）**游玩期间绝不重建 DOM** —— 重排 iframe 会让原作重新加载，等于白玩。

---

## 3. 当前状态（请以此为准，别照抄过期文档）

- 分支 `main`，**HEAD = `6180ae1`**，**工作区有未提交改动**（见 §4）。
- 版本 `VERSION = 1.14.22`；产物 `index.html` 与 `dist/party-night.html` md5 一致（`08234c08038b`）。
- 线上是 **v1.14.22**。

### 3.1 游戏清单（共 27 款）
**联机 11 款**（`src/games/`）：
`drawgame` 你画我猜 · `tacit` 默契大考验 · `memory` 合作翻牌 · `codraw` 心有灵犀 ·
`gomoku` 五子棋 · `hop` 跳一跳 · `mine` 扫雷 · `soko` 鲸鱼推箱子 · `cube` 魔方接力 ·
`go` 围棋 · `domino` 骨牌顶牛

**小游戏厅 16 款**（`mini/` + `data/mini.json`，浮层里跑，单机/同屏双人）：
超级马里奥 / 双截龙 / 拳皇格斗 / 植物大战僵尸 / 2048 肉鸽 / 魔方动画实验室 / 鲸鱼推箱子 /
幽灵诡计 / 密码破译局 / 3D 重力迷宫 / 三维弹球 / 弹球英雄 / 古戈尔增量 / 单文件靶场 /
弈・棋道初启 / 骨牌顶牛

### 3.2 已知但**不属于本次**的问题
- `test/integration-drawgame.mjs`（真实 broker 跑完整一局）**当前失败**：`等待超时: 房主当选`。
  前一位已用 `git stash` 验证**干净 HEAD 同样失败**，与 §4 的改动无关。broker 连通性本身正常
  （`node test/mqtt-smoke.mjs` 通过）。**这是个待查项，不是回归。**

---

## 4. 待你审查的 4 处改动（前一位工程师的工作）

工作区有 4 个业务文件未提交，共 `+54 / -2`。**请逐条独立核验，并尝试证伪。**

### 4.1 `src/ui.js`（+12）— 房主开房后自己有约 5 秒不在名单里
- **复现证据**：`node test/browser/diag-selfdelay.mjs` 修复前输出
  `房主"自己出现在名单里"耗时: 5064ms`（界面一直显示"还差一个人"）。
- **根因**：`room.js claimHost()` 会**自己写入** retained `meta`；而 `ui.js` 用
  `knownRoom = !!(room.meta && room.meta.host)` 判断"这是别人的既有房间"，
  于是**全新房间**也走"等 retained 状态"分支，但新房间根本没有 retained 状态 → 空等 5 秒兜底 `fresh()`。
- **改法**：在建 room 之前记下意图，用意图判断而不是用 meta 反推：
  `this._freshRoom = !wantJoin;` 且 `var knownRoom = !self._freshRoom && !!(...)`。
- **修复后**：`耗时: 2ms`。
- **⚠️ 这是最需要你审查的一处**：前一位**第一版改错了**（改成 `meta.host !== me.id`），
  导致 `chaos refresh` 立刻报 `✗ 房主刷新后回到同一局（gomoku → lobby）` ——
  因为刷新时 retained 的 `meta.host` 就是房主本人。请重点回归**刷新不丢局**这条路径。

### 4.2 `src/screens-hop.js`（+7/-1）— 跳一跳跳一次之后彻底卡死
- **复现证据**：`node test/browser/hop-real.mjs`（真鼠标/真空格）修复前：
  第 1 跳生效，**第 2～38 次全部无反应**，回合永远停在 1，对手一次都没轮到。
- **根因（互相等待的死锁）**：
  ```
  games/hop.js:228   at.fly = {...}                       ← 每次起跳后置上
  games/hop.js:197   at.fly = null                        ← 只在收到 charge 时清
  screens-hop.js:195 if (at.fly || ...) return;           ← 见 fly 就 return，不发 charge
  ```
  房主等 charge，客户端等 fly 清空 = 永久死锁。
- **改法**：客户端只挡真正不能动的情况 `if (g.attempt.ended || g.attempt.lives <= 0) return;`
  （房主侧那句注释本来就说"免得跳一次之后按不动"，说明房主是好的，是客户端守卫在挡）。
- **修复后**：`node test/browser/hop-real.mjs` → `27/27 全部生效`、3 轮轮流、真实终局、两端一致、零报错。

### 4.3 `src/screens-go.js`（+32）— 围棋真人点棋盘完全无效
- **复现证据**：`node test/browser/diag-go5.mjs` 修复前：
  真鼠标点棋盘 **10 个不同交叉点，日志始终 0**；而真点「停一手」按钮 `日志 0→1` ✓。
- **根因**：`screens-go.js` 在**捕获阶段拦掉** iframe 里棋盘的所有 click（设计是"输入只能由我们喂"），
  但**没有任何地方把点击转成 `move` 上报** → 玩家只剩「停一手 / 认输」可点。
- **改法**：在 **document 捕获阶段、排在拦截器之后**，把坐标按**与原作 `eventPoint` 相同**的换算
  （`margin = w*(n<=9?0.091:0.067)`, `step = (w-2m)/(n-1)`）翻成交叉点，转成 `ui.send({t:'move', p})`；
  仍要求"离交叉点足够近"，且非本方回合不上报。
- **⚠️ 前一位第一版也改错了**：把监听挂在 canvas 上 —— 但 document 捕获阶段的 `stopPropagation()`
  会让事件**根本到不了 canvas**。改挂到 document 捕获阶段才对。
- **修复后**（`diag-go5.mjs`）：`A 真点(4,4) → 日志 0→1 且轮次 0→1 ✓`；
  `不该走的 A 真点(6,6) → 日志 1→1 ✓ 被正确拒绝`；`该走的 B 真点(6,6) → 日志 1→2 ✓`；两端一致 ✓。

### 4.4 `src/style.css`（+3）— 提示条压住游戏标题
- **复现证据**：`node test/browser/diag-hopui.mjs` 实测（不靠肉眼）：
  `toast top:70 bottom:110` 与 `.ghead top:51 bottom:126` 重叠 `91×20px`，把「第 N 回合/轮到你」盖住。
- **改法**：游戏页把提示条移到底部安全区
  `#pn-root:has(.ghead) ~ .toasts, body:has(.ghead) .toasts{top:auto;bottom:calc(env(safe-area-inset-bottom) + 84px)}`
- **修复后**：`node test/browser/diag-toast.mjs` → `与游戏头重叠=0px`、`与输入条重叠=0px`。

---

## 5. 如何审查（建议动作）

1. **独立复核每条复现**：先在不看补丁的前提下跑 §4 的复现脚本，确认问题真实存在；
   再 `git diff` 看改法，判断是否**最小**、是否引入副作用。
2. **重点证伪 4.1 的刷新路径**（它曾改错一次）：
   ```bash
   node test/browser/chaos.mjs refresh      # 期望：房主刷新后回到同一局（gomoku → gomoku）
   node test/browser/chaos.mjs migrate      # 期望：接管后对局没被重置为大厅
   ```
3. **跑真机输入全量**（这是能抓住"UI 层断了但 send 测试全绿"的关键用例）：
   ```bash
   node test/browser/realinput.mjs          # 期望：汇总 39 通过 / 0 失败
   node test/browser/hop-real.mjs           # 期望：27/27 生效
   ```
4. **跑 node 全量**（基线见 §7.2），确认零回归。
5. 若你决定修改，遵守 §0 的规矩：**先复现 → 说明改动点与影响面 → 最小改动 → 立刻验证 → 失败即回退**。

---

## 6. 环境与运行（照抄即可）

### 6.1 起静态服务
```bash
node tools/serve.mjs 8080          # 项目自带的静态服务（推荐，Cache-Control: no-store）
# 或按 README：python3 -m http.server 8080
# 入口：http://localhost:8080/dist/party-night.html
```
> 必须用 **https 或 localhost** 打开才有 `crypto.subtle`（真加密）；file:// 会降级为混淆。

### 6.2 起无头浏览器（本机环境有坑，见下）
浏览器测试通过 **CDP**（`--remote-debugging-port=9222`）驱动。
本机 Chromium 位于：
`/home/zuoye/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`

⚠️ **该环境常常缺 5 个运行库**（`libnspr4.so / libnss3.so / libnssutil3.so / libsmime3.so / libasound.so.2`），
`sudo` 又不可用（需交互认证）。**不需要 root 的绕过办法**（前一位已验证）：
```bash
mkdir -p /tmp/pn-libs/deb /tmp/pn-libs/root && cd /tmp/pn-libs/deb
# 用 apt-get download --print-uris 拿到包地址后 curl 下载（libnspr4 / libnss3 / libasound2t64）
for f in *.deb; do dpkg-deb -x "$f" /tmp/pn-libs/root; done
# 启动时带上解包出的库路径：
export LD_LIBRARY_PATH=/tmp/pn-libs/root/usr/lib/x86_64-linux-gnu:/tmp/pn-libs/root/lib/x86_64-linux-gnu
"$CHROME" --headless=new --remote-debugging-port=9222 --no-sandbox --disable-gpu \
  --disable-dev-shm-usage --user-data-dir=/tmp/pn-chrome-pn --ozone-platform=headless \
  --use-angle=swiftshader-webgl about:blank
```
> 提示：把长驻进程（静态服务、Chrome）作为**长生命周期后台任务**启动；用 `nohup ... &` 容易被作业收尾时连带杀掉。

### 6.3 测试驱动规范（`test/browser/lib.mjs`）
- `connect(port=9222)`；`createRoom(cdp, 昵称)`、`joinRoom(cdp, 昵称, 房号)`、`waitPlayers`、`startGame`、`clickUntil`。
- `Page` 提供 `eval / waitFor / box / mouse / click / drag / touchDrag / fill / type / key / shot / consoleErrors / reload / send / dispose`。
- **`assert` 不抛异常**：它打印 ✓/✗ 并设 `process.exitCode=1`。**结论必须看每条断言与汇总计数，别只看退出码。**
- ⚠️ `Page.box(sel)` 返回的 `x/y` **已经是元素中心点**，不要再 `+ w/2`（前一位因此误判两次）。
- ⚠️ CDP 的 `Input.dispatchKeyEvent` **不会自动路由进跨文档 iframe**；测 iframe 内键盘要在
  iframe 的 document 上派发真实 `KeyboardEvent`。
- ⚠️ 测"真人操作"必须用 `mouse/touchDrag/key` 走浏览器输入管线，**不要用 `PN.app.send()` 直接发动作** ——
  那会绕过 UI 层守卫，把死锁类 bug 全部掩盖（跳一跳与围棋两个真缺陷就是这样漏掉的）。

---

## 7. 测试与基线

### 7.1 跑全部 node 套件
```bash
for t in test/*-test.mjs test/d1[0-9]-*.mjs; do echo -n "$t "; node "$t" 2>&1 | tail -1; done
node test/regress-fixes.mjs
node test/style-check.mjs
```

### 7.2 真实基线（前一位刚在本机实测，可直接对照）
```
catalog-test 22/0 · codraw-test 34/0 · d12-secretcache 3/0 · d14-emitsoon 2/0 · d15-dropgrace 3/0
d16-claim-wipe 5/0 · d17-timer-leak 4/0 · d18-offline-stall 5/0 · d19-refresh-wipe 10/0
gomoku-test 35/0 · hop-test 51/0 · memory-test 29/0 · mine-test 41/0 · mini-test 11/0
playall-test 51/0 · soko-test 37/0 · tacit-test 31/0 · toon-test 42/0 · version-test 17/0
wire-test 16/0 · regress-fixes 24/0 · style-check 全部通过
```
**注意：以上全部为 0 失败。** `test/integration-drawgame.mjs` 例外，见 §3.2。

### 7.3 环境失败 vs 产品缺陷（必须先区分）
- 特征：`等待超时: XXX 连上 broker` / `阿泽 落在了另一台公共服务器` / `连续 5 次都没能和房主进到同一个房间`。
- 判据：`node test/mqtt-smoke.mjs` 若也失败 → **环境问题**，等 broker 恢复后重跑，别改代码。
- 前一位遇到过**两个公共 broker 同时挂掉**（`emqx/hivemq wss = 000` 而 `github = 200`）：先跑不依赖 broker 的套件，等恢复再跑联机套件。

---

## 8. 建议你接下来做的事（按优先级）

1. **审查 §4 的 4 处改动**（尤其 4.1 的刷新路径），确认无误后由使用者决定是否提交。
2. **把真机输入测试纳入常规回归**：`test/browser/realinput.mjs` 目前覆盖 11 款联机游戏的"真实输入"，
   建议补上**破坏性输入**（连点/长按/满蓄力/双方同时操作/中途刷新）到每款，参考 `hop-stress.mjs`。
3. **补 `stop()` 钩子**（前一位实测出的具体缺口，优先做）：
   目前只有 4 个屏幕实现了 `stop()`：`screens-cube`、`screens-domino`、`screens-go`、`screens-soko`。
   但有 **9 个**屏幕用了模块级 `setInterval`：
   `screens-codraw`、`screens-common`、`screens-cube`、`screens-domino`、`screens-drawgame`、
   `screens-go`、`screens-gomoku`、`screens-hop`、`screens-soko`。
   → 其中 **`codraw` / `drawgame` / `gomoku` / `hop`（`screens-common` 是公共模块）缺 `stop()`**，
   是"切换游戏后旧定时器读到新游戏的 `state.g` 而抛 `TypeError`"的高危项，请逐个核实补齐。
   这是历史真事故的根因。验证方式：
   ```bash
   node test/browser/chaos.mjs switch   # 连续切换 9 款游戏，期望无 JS 报错
   ```
4. **待查**：`integration-drawgame.mjs` 为何在 broker 正常时仍"房主当选"超时。
5. **可选**：给 7 款没有单机版的游戏（codraw/drawgame/tacit/gomoku/domino/go/五子棋）加 AI 对手，
   让它们单人也玩得起来 —— **但这需要使用者明确批准（属于新功能）**。
6. **不要做**：不要重构架构、不要引入依赖、不要改"复用原作"的策略、不要动 `mini/` 里的第三方文件。

---

## 9. 部署（只有使用者明确要求时才做）

```bash
node tools/release.mjs patch     # 构建 + 版本号自增 + 写 version.json
git add -A && git commit -m "..."
git push origin main             # ⚠️ origin 走 gh-proxy.com（有时 403，需重试/切换直连）
```
- 提交信息用中文、写清"改了什么 + 为什么 + 怎么验证的"（参考 `git log`）。
- 推送需要 GitHub token（由使用者提供，**不要写进任何文件**）。
- 上线后必须核对线上产物与本地一致：
```bash
W=$(md5sum index.html | cut -d' ' -f1)
curl -sL "https://778672151.github.io/party-night/?x=$RANDOM" | md5sum   # 应等于 $W
curl -sL https://778672151.github.io/party-night/version.json            # version 应等于 VERSION
```
> Pages 有 1～2 分钟构建延迟，md5 不一致先等再重试，不要立刻断定失败。

---

## 10. 红线（务必遵守）

- **不要用 `PN.app.send()` 冒充真人操作**来做 UI 验收。
- **不要为了让测试通过而放松产品断言**；测试写错了就改测试并说明，不要改产品去迁就测试。
- **不要提交**、**不要部署**、**不要动生产环境**，除非使用者明确要求。
- **不要丢失工作区未提交的改动**（§4），也不要 `git checkout` 掉它们。
- **每条结论都要附证据**（命令 + 真实输出 / 截图 / 报错原文）。
- 环境起不来或改动后验证失败：**回退到改动前状态并如实报告**，不要带着失败状态继续。

---

## 11. 有问题就问

若 §4 的某处改动你判断有风险、或 §8 的任务需要取舍，**先停下来问使用者**，说明：
你看到了什么证据、你打算怎么改、影响面多大、有什么替代方案。不要自行假设后一路做下去。
