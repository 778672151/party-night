# 交接提示词（粘贴到新会话的第一条消息）

你接手一个**已经上线、可玩**的项目。不要从头重写，先读代码再动手。
本文件由上一轮工作核对自己的实测输出写成；凡写"未确认/未验证"的，就是真的没验过，别当成已完成。

---

## 0. 交接区（元信息，先读这一段）

| 项 | 值 |
| --- | --- |
| 交接编号 | HO-PN-20260923-01 |
| 前序交接 | HANDOFF.md 旧版（写于 HEAD `16226e0`／4 游戏时代，已失效，见 §9） |
| 工作目录 | `/home/zuoye/派对游戏/`（绝对路径，跨机/跨会话都用它；2026-09-23 由 `日用/party-night` 迁入） |
| 动作范围 | 本编号只授权"接手核验 + 继续开发"；**不授权提交、推送、发布、删除、改配置** |
| 接手任务编号 | （留空 —— 本轮是"仅保存"，未新建接续任务） |
| 交接状态 | 材料已核对 |
| 本次核对时间 | 2026-09-23 16:10 |

---

## 1. 项目是什么

**「群友派对之夜」**——一个**单文件 HTML** 的联机派对小游戏合集，给一群朋友用手机/电脑浏览器一起玩。

- 线上：https://778672151.github.io/party-night/
- 仓库：https://github.com/778672151/party-night
- 本地：`/home/zuoye/派对游戏/`（`pwd` 确认；**不要**用 deepseek-harness 的 checkout 路径）
- **当前 HEAD：`16c6001`**（本地 = 远端 = tag `v1.14.24`）。工作树干净。
- **VERSION：`1.14.24`**；`index.html` 与 `dist/party-night.html` md5 都是 `889d86dc1ddb3a28c40e7beca9008c71`
- **线上已核对**：抓 https://778672151.github.io/party-night/ 实测 md5 与本地一致，
  且**真机实测线上开房 `CLICK→当选房主` = 4508ms**（v1.14.23 时为 20213ms，见 §8）。

**玩法**：11 款联机游戏 + 16 款小游戏。
- 联机（`src/games/`，房主权威）：`drawgame` 你画我猜 · `tacit` 默契大考验 · `memory` 合作翻牌 · `codraw` 心有灵犀 · `gomoku` 五子棋 · `hop` 跳一跳 · `mine` 扫雷 · `soko` 鲸鱼推箱子 · `cube` 魔方接力 · `go` 围棋 · `domino` 骨牌顶牛
- 小游戏厅（`data/mini.json`，浮层里跑，单机/同屏双人）：经典超级马里奥 · 双截龙 · 拳皇格斗 · 植物大战僵尸 · 2048 肉鸽版 · 魔方动画实验室 · 鲸鱼推箱子 · 幽灵诡计 · 密码破译局 · 骨牌顶牛 · 弈・棋道初启 · 3D 重力迷宫 · 三维弹球 · 弹球英雄 · 古戈尔增量 · 单文件靶场

> README.md:358 还写着"原本是 4 个游戏（谁是卧底／波长／谁最有可能／你画我猜）"—— 那是**历史沿革**，不是现状。当前没有这 4 款。

---

## 2. 硬约束（用户已确认的设计决策，不许改）

1. **零服务器**：不引入任何自建后端。联机靠公共 MQTT broker over WSS。
2. **单文件产物**：`node build.mjs` 把 `src/*.js` + `src/style.css` 内联进 `index.template.html` → `dist/party-night.html`；再 `cp dist/party-night.html index.html`（Pages 要的是根目录那份）。产物是唯一要部署的东西。
3. **零 npm 依赖**：仓库**没有 package.json**。不要引入运行时依赖。
4. **全中文 UI**，面向不懂技术的群友：点链接 → 输名字 → 就能玩。
5. **不要用子代理**（用户明确要求过）：所有工作亲自 inline 做完。
6. **尽可能复用已移植的原作代码**（用户明确要求），只做双人兼容层；不要自己重写游戏。`mini/` 里的第三方文件不要动。
7. **不要提交、不要推送、不要部署**，除非用户明确要求。
8. 测试写错了就改测试并说明，**绝不许放松产品断言去迁就测试**。

---

## 3. 架构（先读这些文件）

体量：`src/` 约 6479 行（含 style.css 684）。最大文件 `src/ui.js` 750 行。

| 文件 | 职责 |
| --- | --- |
| `src/mqtt.js` (213) | 手写 MQTT 3.1.1 over WebSocket，QoS0。主 `wss://broker.emqx.io:8084/mqtt`，备 `wss://broker.hivemq.com:8884/mqtt` |
| `src/room.js` (469) | 房间：beacon/sweep/election 选房主、话题 `pn3/{房号}/{a\|s\|m\|e\|x\|p\|k}`、retained 状态、墨迹通道；**私密通道 ECDH-P256 + AES-GCM** |
| `src/host.js` (330) | 房主权威：`dispatch()` 是所有 action 的唯一入口；状态由房主算好后 retained 发布，客户端**只渲染** |
| `src/games/*.js` | 各游戏**纯规则**（只跑在房主侧） |
| `src/screens-*.js` | 各游戏**界面 + 输入**（客户端） |
| `src/ui.js` (750) | 外壳：路由 `setScreen`、大厅、顶栏、toast、屏幕生命周期 |
| `src/toon.js` (257) | 自研三渲二 canvas 渲染层（零依赖、不用 WebGL） |
| `src/canvas-ink.js` (293) | 画笔墨迹通道（归一化坐标、分块、缺号补发） |
| `src/style.css` (684) | 样式 |

**游戏契约**（加联机游戏只写数据，入口零改动）：
```js
PN.games[ID] = { id, name, emoji, blurb, minPlayers, maxPlayers, init, action, resume, onLeave, meta }
```
入口由"一份目录"驱动：`PN.gameCommon.catalog()` = `PN.games` + `data/mini.json`，`sections()` 分区、`gameCard()` 统一卡片。**加联机游戏只写 `src/games/<id>.js` + 一个 screen；加小游戏只改 `data/mini.json`，`ui.js` 一行都不用动。**

---

## 4. 关键契约与已踩过的坑（都是真事故换来的）

1. **状态广播频率 = DOM 重建频率**。客户端每收到一条状态消息就**整树重建 DOM**（`ui.js` render → clear）。
   仍在进行的交互（拖拽作画、输入法拼音）必须用 `screen.deferRender()` 冻结重建，结束 `ui.flushRender()`。
   **画布类屏幕必须跨渲染复用同一 canvas 节点**，且一个画布只挂一个动画循环 —— 否则每秒被拆掉重建，严重卡顿。
2. **屏幕生命周期 `stop()`**：离开屏幕时收摊。模块级 `setInterval` 的屏幕**必须**实现它，否则切到下一个游戏后旧定时器会读到错误的 `state.g` 并抛 `TypeError`（历史真事故）。
   已实现 `stop()` 的：`screens-cube` / `domino` / `go` / `soko` / `codraw` / `drawgame` / `gomoku` / `hop`（共 8 个）。
   还有 `screens-common` 用 `setInterval` —— 它是公共模块，请自行核实是否需要。
3. **iframe 类游戏**（推箱子/围棋/魔方/骨牌顶牛）游玩期间**绝不重建 DOM**：重排 iframe 会让原作重新加载，等于白玩。
   原作输入被**故意在捕获阶段拦掉**（`block` + `w.__pnAllow`），两端不能分叉，**所以父层必须自己把输入喂进去**。
   ⚠️ 挂监听器要挂在 **document 的捕获阶段、且排在拦截器之后**；挂在 canvas 上**没用**（document 捕获里的 `stopPropagation()` 会让事件根本到不了 canvas）。
4. **换局/换轮判定**：`startedAt` 只在开局写一次，**换轮只能靠 `g.round` 判定**。
5. 房主 action 名是 `_left`（不是 `bye`）。
6. 私密数据（词/答案/牌堆）**只在房主闭包或加密点对点里**，绝不能进 `state`。走 `host.sendSecret/requestSecret/resendSecret`，客户端缓存在 `secretCache`。
7. **没有账号体系**：身份是 localStorage 里随机的 `pXXXXXXX`。"两个人" = **房主** 与 **加入者**（两台设备/两个标签页）。

---

## 5. 测试怎么跑（附**实测基线**，可直接对照）

### 5.1 node 套件（22 个，全部 0 失败 —— 本机实测）
```bash
cd /home/zuoye/派对游戏
for t in test/*-test.mjs; do echo -n "$t "; node "$t" 2>&1 | tail -1; done
for t in regress-fixes d16-claim-wipe d17-timer-leak d18-offline-stall d19-refresh-wipe; do node test/$t.mjs 2>&1 | tail -1; done
node test/style-check.mjs
```
```
catalog 22/0 · codraw 34/0 · d12-secretcache 3/0 · d14-emitsoon 2/0 · d15-dropgrace 3/0
gomoku 35/0 · hop 51/0 · memory 29/0 · mine 41/0 · mini 11/0 · playall 51/0
（注：memory 的计数会在 29 与 24 之间跳 —— 它有约 1/15 的概率走到「前两张刚好是一对」的随机分支，
 该分支用 1 条断言替换 6 条。**两种情况都是 0 失败**，不要把它当回归。见 §7 与 test/memory-test.mjs:112。）
soko 37/0 · tacit 31/0 · toon 42/0 · version 17/0 · wire 16/0
regress-fixes 24/0 · d16-claim-wipe 5/0 · d17-timer-leak 4/0 · d18-offline-stall 5/0 · d19-refresh-wipe 10/0
style-check 全部通过
```

### 5.2 真浏览器测试（102 个文件在 `test/browser/`）
先起环境（见 §6；运行库可直接跑 `bash tools/pn-browser-libs.sh`），然后：
```bash
node test/browser/realinput.mjs    # 11 款联机游戏真实鼠标/键盘；基线 39 通过 / 0 失败
node test/browser/hop-real.mjs     # 跳一跳真鼠标按住/真空格；基线连续 3 次全绿（25/25、25/25、27/27）
node test/browser/hop-real2.mjs    # 轻点/提前收工/终局/再来一局/中途刷新；基线 3 次全过
node test/browser/hop-stress.mjs   # 连点20/满蓄力/双方同按/打到终局；基线 4 次全过
node test/browser/chaos.mjs        # 12 个场景
node test/browser/duo-human.mjs    # 两身份+真人专项；基线 16/16
node test/browser/stress-all.mjs   # 10 款游戏的破坏性输入；基线 141 通过 / 0 失败
node test/browser/duo-conflict.mjs # 操作冲突+显示错位；基线 6 次全绿（修掉瞬时重排假红后）
```

### 5.3 测试驱动规范（`test/browser/lib.mjs`）
- `connect(port=9222)`；`createRoom(cdp,昵称)` / `joinRoom(cdp,昵称,房号)` / `waitPlayers` / `startGame`。
- `Page`：`eval / waitFor / box / mouse / click / drag / touchDrag / fill / type / key / shot / consoleErrors / reload / send / dispose`。
- ⚠️ **`assert` 不抛异常**：它打印 ✓/✗ 并设 `process.exitCode=1`。**结论必须看每条断言与汇总计数，不能只看退出码。**
- ⚠️ `Page.box(sel)` 返回的 `x/y` **已经是元素中心点**，不要再 `+ w/2`（曾因此误判两次）。
- ⚠️ `Page.mouse(type,x,y,extra)` 第一参数必须是类型字符串：`A.mouse('mousePressed', x, y, {buttons:1})`。
- ⚠️ `Page.key(key,code,keyCode)` 是 keyDown+keyUp **连发、中间不等**，**不能**用来模拟蓄力/长按；要自己派发 `keyDown` → `sleep` → `keyUp`。
- ⚠️ CDP 的 `Input.dispatchKeyEvent` **不会自动路由进跨文档 iframe**；测 iframe 内键盘要在 iframe 的 document 上派发真实 `KeyboardEvent`。

---

## 6. 环境（本机硬事实，别浪费时间撞）

- Node **v24.19.0**；**没有 sudo**（交互认证不可用）；**审批提示被禁用** —— `sandbox_permissions` 不要设，设了也会被拒。
- **`pkill -f 'xxx'` 会匹配到你自己的 shell 命令行 → 自杀**。别这么干。

### 6.1 起静态服务
```bash
cd /home/zuoye/派对游戏
exec node tools/serve.mjs 8080      # 项目自带；入口 http://localhost:8080/dist/party-night.html
# 或按 README:258：python3 -m http.server 8080
```
必须用 **https 或 localhost** 打开才有 `crypto.subtle`（真加密）；`file://` 会降级。
⚠️ 长驻进程要用**长生命周期后台任务**启动；`nohup ... &` 容易被作业收尾时连带杀掉。

### 6.2 真浏览器（**能跑** —— 旧 HANDOFF.md 说"跑不起来"已过时）
浏览器在 `/home/zuoye/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`，用 CDP（端口 9222）驱动。

本机常缺 5 个运行库（`libnspr4.so / libnss3.so / libnssutil3.so / libsmime3.so / libasound.so.2`），且没有 sudo。**不需要 root 的绕过办法**（已验证）：
```bash
mkdir -p /tmp/pn-libs/deb /tmp/pn-libs/root && cd /tmp/pn-libs/deb
# 取包地址（libnspr4 / libnss3 / libasound2t64），再 curl 下来
apt-get download --print-uris libnspr4 libnss3 libasound2t64
# 从 http://mirrors.ustc.edu.cn/ubuntu/pool/main/{n/nspr,n/nss,a/alsa-lib}/... 下载后：
for f in *.deb; do dpkg-deb -x "$f" /tmp/pn-libs/root; done

export LD_LIBRARY_PATH=/tmp/pn-libs/root/usr/lib/x86_64-linux-gnu:/tmp/pn-libs/root/lib/x86_64-linux-gnu
"$CHROME" --headless=new --remote-debugging-port=9222 --no-sandbox --disable-gpu \
  --disable-dev-shm-usage --user-data-dir=/tmp/pn-chrome-pn --ozone-platform=headless \
  --use-angle=swiftshader-webgl about:blank
```
`/tmp` 是易失的，环境重置后**要重建** `/tmp/pn-libs/root`。
**已封装成一键脚本**（2026-09-23 加，免 root，自动探测包地址）：
```bash
bash tools/pn-browser-libs.sh     # 幂等：已存在则直接跳过
```
（上面那一大段手工步骤保留作为原理说明；日常直接用脚本即可。）

### 6.3 公共 broker 会间歇性抖动
- 特征：`等待超时: XXX 连上 broker` / `阿泽 落在了另一台公共服务器` / `连续 5 次都没能和房主进到同一个房间`。
- 判据：`node test/mqtt-smoke.mjs` 若也失败 → **环境问题**，等恢复后重跑，**别改代码**。
- 曾遇到**两个公共 broker 同时挂掉**（`emqx/hivemq wss = 000` 而 `github = 200`）：先跑不依赖 broker 的套件，等恢复再跑联机套件。

---

## 7. 测试方法学铁律（**这一节最值钱，违反它会让你把测试问题误判成产品缺陷**）

1. **不能用 `PN.app.send(...)` 冒充真人操作。** 它会绕过 UI 层守卫，把死锁类缺陷全部掩盖 ——
   `playall.mjs` 曾给出 "51/0 全绿"，而**跳一跳和围棋两个真缺陷就是这样漏掉的**（真实玩家完全玩不了）。
   UI 验收必须走浏览器输入管线：`mouse / touchDrag / key`。
2. **选"该谁操作"要用操作端自己界面显示的 `mine`，不能用房主侧 `attempt.pid`。**
   在 1.4s 换人窗口里，房主侧仍指向刚掉下去那位（`ended=true, lives=0`），而对方界面显示"等对方"；
   此时按键会被 `isMine` 守卫**正确**挡掉，看起来像"没反应"（实测 `diag-hop-lag6.mjs`）。
3. **所有跨端断言必须"等对端收敛"再读。** 实测房主进入终局后，对端看到终局的延迟样本 = `[105, 2, 5605, 14, 1]ms`（最长 **5.6 秒**）。
   立刻读会读到 `A=over B=play` 并被误判成"失步"（`diag-hop-over-lag.mjs` 复现 **0/6** 失步，等待后全部一致）。
   这个坑已踩过 **3 次**（合作翻牌 / 围棋 / 跳一跳）。
4. **压力测试要限制"有效操作"次数，不是循环次数。** 换人窗口空转实测最多 **57 次**，会把预算吃光，
   于是"打不到终局"被误报成失败（实测一局只需 **26~29 次**有效按键）。
5. 每条结论都要**贴命令 + 真实输出**；不许说"应该/看起来/大概"。

---

## 8. 当前状态与已知问题

**v1.14.23（历史版本，HEAD `0669aeb`）** 修了 6 类产品缺陷，其中 4 类有真机复现证据：
1. 跳一跳"跳一次之后彻底玩不了"（`at.fly` 与 `charge` 互相等待的死锁）—— 改 `src/screens-hop.js` 的 `doCharge` 守卫
2. 围棋"真人点棋盘完全无效"（原作 click 被捕获拦掉、无人转发）—— 改 `src/screens-go.js`，在 document 捕获阶段补转发
3. 房主开房后约 5 秒内自己不在名单里（`_freshRoom` 意图判断）—— 改 `src/ui.js`，5064ms → 2ms
4. 提示条压住游戏标题 —— 改 `src/style.css`
5. 4 个屏幕补 `stop()`（切游戏后旧定时器抛 TypeError）
6. `chaos.mjs` QoS0 时序假失败（改等对端收敛）

**已发布 v1.14.24**（HEAD `16c6001`，已推送 + tag `v1.14.24`，线上已核对）。本版修了 1 个**线上真回归** +
2 处失效测试契约（详见 §8 下文与提交信息）：

**§11.1 已查明并修复（2026-09-23，已随 v1.14.24 发布）**：
- `test/integration-drawgame.mjs` 的 `等待超时: 房主当选` **不是环境抖动，是两个真问题叠在一起**：
  1. **产品缺陷（真回归，线上 v1.14.23 仍存在）**：`src/room.js` 的 `_election` 把「持续判死」门槛
     （`4e1fe48` 为防心跳抖动误抢主而加，需持续判死 `OFFLINE_MS`=13s）**无条件套用到了全新空房上**。
     空房里根本没有房主可保护，却要白等一个离线周期。**实测开房 4.0s → 20.2s**，浏览器里
     `CLICK→当选` = 20218ms，**线上站点实测同样 20213ms**；这段时间里谁都不是房主、开不了局。
     修法：加 `knowsHost = !!(this.hostId || this.meta)`，门槛只对**已知房主**生效。
     修后实测 `CLICK→当选` = 4222ms / 4261ms / 4226ms。
  2. **测试驱动过期**：`test/harness.mjs` 的 `makeTable` 只给「房主当选」15s，本就覆盖不了选举契约。
     已放宽到 30s（放宽的是驱动预算，不是产品断言）。
- 回归证据：node 22 套件全绿（含 `d16-claim-wipe 5/0`）；`integration-drawgame` **2/2 PASS**（此前 3/3 必红，
  且它后面那串断言此前从未跑到过 —— 现全部跑到并 PASS）；
  浏览器 `game-survive`（d16 的浏览器对应物）**3/3**：一次心跳抖动仍**不抢主**、持续判死仍**会**接管且不洗回大厅；
  `rescue` 2/2、`duo-human` 零 JS 报错；对抗性用例（加入者 id 故意排在前面）**未发生抢主**。
- 注：`duo-conflict.mjs` **退出码 1**，但在**未改动的干净 HEAD 上同样退出 1** → 既存问题，与本次无关。

**未验证**：只在本地 headless Chrome 验证过；**真机手机浏览器未验证**（用户需自行手机开线上链接点几下跳一跳/围棋确认手感）。

---

## 9. 权威资料与冲突

| 资料 | 管什么 | 状态 |
| --- | --- | --- |
| **本文件 HANDOFF.md** | 交接入口（唯一权威） | ✅ 已更新到 v1.14.24 |
| `README.md` | 玩家向说明、启动方式、游戏清单 | ⚠️ :358 的"4 个游戏"是历史沿革，非现状 |
| `HANDOFF-KIMI.md` | 前一轮给另一个 AI 的交接（含 4 处改动逐条取证） | ✅ 内容有效，但它是**上一轮**视角，本文件为准 |
| `NEXT-ROUND.md` / `PHASE-REPORT.md` / `AUDIT-AND-DEVELOP.md` | 更早阶段报告 | ⚠️ 历史文档，可能过时，**以代码与测试实测为准** |
| `test/` 下的 `*-test.mjs` 与 `test/browser/*.mjs` | 可执行的事实 | ✅ 唯一能确定"现在是不是好的"的依据 |

**已否决的路线**（不要重提）：用 `PN.app.send()` 做 UI 验收（见 §7.1）；用"读一次就判"的跨端断言（见 §7.3）。

---

## 10. 你的第一步（建议顺序）

1. **只读核对**（不要改业务文件）：`pwd` → `git rev-parse --short HEAD`（应是 `16c6001`）→ `git status --short`（应干净）→ `cat VERSION`（应 `1.14.24`）→ `md5sum index.html dist/party-night.html`（两个应都是 `889d86dc1ddb…`）。
   有差异就**先报告差异**，不要自行"修好"。
2. 读 `README.md` + `src/ui.js` + `src/host.js`，建立架构认知（≈20 分钟）。
3. 跑 §5.1 的 node 套件，对照基线确认零回归。
4. 需要真机验收时，按 §6 起服务 + 浏览器（先跑 `bash tools/pn-browser-libs.sh` 重建运行库）。
5. 然后进入下面第 11 节的任务。

---

## 11. 建议的下一步工作（按优先级）

1. ~~查 `integration-drawgame.mjs` 为何在 broker 正常时仍"房主当选"超时~~ **已查明并修复并发布**（v1.14.24；含一个线上真回归：开房 20.2s → 4.5s，线上已核对）。
   ~~duo-conflict 的既存红项~~ 也已查清并修复（是竞态测试，不是产品缺陷；现 8/8 全绿）。
2. ~~把破坏性真机输入纳入常规回归~~ **已完成**（2026-09-23，未随 v1.14.24 发布，在下一次发布里）：
   新增 `test/browser/stress-all.mjs`，对**每一款**联机游戏跑四条破坏性输入 ——
     ① 连点 20 次（真人手抖） ② 长按 2 秒（超过任何蓄力上限） ③ 双方同按（抢） ④ 一端中途刷新（最高频真实操作）
   每条之后断言与游戏无关的不变量：**不崩 / 两端无 JS 报错 / 两端收敛一致（等收敛再读）/ 破坏完仍能回大厅**。
   ```bash
   node test/browser/stress-all.mjs            # 全部 10 款，基线 141 通过 / 0 失败
   node test/browser/stress-all.mjs gomoku     # 单款
   node test/browser/hop-stress.mjs            # 第 11 款（跳一跳）已有专属破坏性套件，4 个场景全绿
   ```
   覆盖：gomoku · memory · mine · soko · tacit · codraw · cube · go · domino · drawgame（+ hop）。
   写这套件时踩到并已修的**测试自身**的坑（都不是产品缺陷，记下来省得后人重踩）：
     · `cube` 的控件是 `[data-face]`；`go` 是 `[data-go=pass|resign|reset]`；`domino` 可见控件只有 `[data-reset=1]`，牌局推进在 iframe 里点 `localPlayerReady`。
     · `drawgame` 的画布**没有 class/id**，且选词/作画控件**只在画手那一端** —— 拿 A 端硬点必然失败。
       套件为此加了 `actor()`：像真人一样「谁手里有控件谁操作」。
     · 顶栏「回大厅」按钮**没有稳定选择器**（ui.js 用 `this.el` 建，只有文案），测试按文案找。
3. ~~核实剩余屏幕的 `stop()`~~ **已核实，结论：都不需要加**（见 §4.2 的判据 = 「模块级 setInterval」）：
   · `screens-common.js` 确实有 `setInterval`，但它是**全局单例**（建一次、走到底），回调只改
     `[data-deadline]` 元素的 textContent/color，**从不读 `state.g`** —— 切游戏后既不会读到错字段，也不会叠加定时器。
   · `screens-memory.js` / `screens-tacit.js`：**完全没有定时器**。
   · `screens-mine.js`：唯一的 `setTimeout` 是**每个格子按钮自己的局部变量**（长按插旗），
     且 pointerup / pointercancel / pointerleave 三处都会 clearTimeout —— 无泄漏。
   结论：8 个已实现 `stop()` 的屏幕覆盖了所有真正持定时器/动画循环的屏幕，无需再加。
4. ~~查两个偶发假红的根因~~ **已查清并修复**（2026-09-23，只改测试，未动业务代码）：
   · **`realinput.mjs` 偶发假红（实测 6 次里红 4 次）** —— 根因是「开完局 sleep 固定秒数就动手」：
     开局的 state 走 QoS0，晚到是常态。于是 ① state 还没到就读 `state.g.moves` → 抛
     `Cannot read properties of null`；② 要操作的那一端界面还没武装（十字键 `disabled`、
     画家端词卡还没渲染、骨牌 iframe 还没推进完）就点下去 → 断言「0→0」假红。
     修法：新增 `waitGameReady(page, mode)` 等**本端**真的进入这一局；读结果一律用 `settle()` 等收敛；
     要操作哪一端就等**那一端自己**的控件就绪（§7.2）。实测：**改前 6 次红 4 次 → 改后 8 次全绿**。
   · **`duo-conflict.mjs` §2「长昵称」偶发假红（实测 3 次红 2 次）** —— 根因与昵称**无关**：
     改视口后重排需要时间，而**越界是瞬时的**（逐 200ms 采样 6 秒：越界点 0/30、2/30、3/30，
     全部落在改视口后的 600~1000ms）。命中的是大厅游戏卡片 `.gcard`（`l=-2/r=392`）。
     已单独验证这**不是产品缺陷**：视口稳定后 `docW=clientW=vw=390`、`hScroll=false`、卡片 `l=0 r=390`，
     没有任何真实溢出。修法：等两端布局**稳定**后仍越界才算错位。实测：**改前 3 次红 2 次 → 改后 6 次全绿**。
   · **`hop-real.mjs` 的「偶发假红」其实是我误报** —— 它从来没有失败过（每次 `EXIT=0`）：
     文件里那句 `✗没反应` 只是**每一跳的打印**，真正的判定是文件末尾的三条 `assert`（`eff > 0` 等）。
     之前用 `grep '✗'` 统计失败，把这个中性诊断行也数进去了。已把该记号改成 `(本跳无状态变化)`
     并加了一行汇总，避免后人再误读。**特此更正我上一轮「hop-real 有既有偶发假红」的说法。**
5. ~~给没有单机版的游戏加 AI 对手~~ **已做（用户批准的新功能，2026-09-23）** —— 详见 §13。
   只给**房主真能推理**的两款加了：**五子棋**（房主持有 board，可以真算）和**默契大考验**
   （房主持有选项，机器人也跟真人一样"猜"）。
   其余几款**没有做，也不建议做**，理由见 §13.4（不是偷懒，是做了会变成假对手）：
   · `domino` / `go` / `cube`：规则和手牌都在**没动过的第三方 iframe** 里，房主只有一个动作日志，
     算不出下一步；而且这三款**已经有单机版兜底**（`SOLO_FALLBACK`），单人点开始本来就能玩。
   · `codraw` / `drawgame`：笔画走墨迹通道，发送者身份由 `room.sendInk` 的 `msg.from = self.me.id`
     定死，房主伪造不了"机器人画的"；真要做必须改协议，收益不值。
6. **不要做**：不要重构架构、不要引入依赖、不要改"复用原作"的策略、不要动 `mini/` 里的第三方文件。

---

## 13. 机器人对手（v1.14.25 新增，单人也能开局）

### 13.1 做法：房主侧的虚拟玩家
机器人是 `state.players` 里一个普通玩家（id 形如 `bot:1`，多一个 `bot:true` 标记），
由 `src/bots.js` 驱动。**11 款游戏一行都没改**就能容纳它 —— 轮次判定、计分、终局名单、
悔棋同意全都照原样工作，因为 `participants()` / `onlinePlayers()` 看到的只是"一个在线玩家"。

游戏自己实现 `game.botTurn(host) → { pid, action } | null`（**纯函数**，只读状态、无副作用，
所以能在 node 里直接单元测试）。`bots.js` 只负责排一个 0.7~1.6 秒的拟人延迟再以它的身份 dispatch。

**为什么不是"单机版"**：那样要把每款游戏的规则再实现一遍，和本项目"复用原作"的策略相反。

### 13.2 三个必须处理的危险点（都踩过）
1. **机器人不在 `room.roster()` 里** → `syncOnline()` 会判它离线 → `markOffline` 排 25 秒收尾
   → `onLeave` 把它踢出对局，游戏卡死。**修**：`syncOnline` 里 `if (p.bot) return;`。
2. **`goLobby()` 用 `!!room.peers[p.id]` 复原在线状态**，会同时把机器人**和房主自己**判离线
   （`peers[me.id]` 是 `room.roster()` 里才补进去的）。**修**：`p.bot || isSelf` 都算在线。
3. **真人进大厅要让出座位**：2 人局里若机器人还占着座，两个真人反而开不了局。
   **修**：`_joined/hi` 里对新来的人调 `bots.dropAll()`（只在大厅做）。

另外踩到并修掉的一个真缺陷：把判断写成 `botsDropped || this.syncOnline()` ——
`||` **短路**，机器人一被撤走，后面的整句同步就被跳过了，房主在线状态再也修不回来。必须无条件调用。

### 13.3 机器人的生命周期
机器人是「**这一局**」的陪练，不是大厅常驻成员：
· `start` 时按 id **幂等**补到最低人数（只补 `bot:1..bot:N` 里缺的）——
  判据必须是"具体 id 在不在"，不能是"已有几个"。用数量推算实测会漏：连开 4 局机器人从 1 涨到 2。
· 回大厅 `goLobby` 收走（大厅里不该杵着假人）；
· 有真人进大厅立刻让座。

### 13.4 覆盖范围（诚实版）
| 单人路径 | 游戏 |
|---|---|
| `SOLO_FALLBACK` 开单机版浮层 | cube、soko、domino、go |
| 本来就 `minPlayers:1` | hop、memory、mine、soko |
| **新增机器人对手** | **gomoku、tacit** |

### 13.5 怎么验
```bash
node test/bots-test.mjs              # 41/0 纯函数单测（造局、只读性、难度贯通、边界）
node test/bots-integration.mjs       # 37/0 集成（真 Host dispatch + 受控时钟跑完整局）
node test/bots-adversarial.mjs       # 24/0 对抗性：重复 emit / 跨局 / 换房主 / 人走了 / 不越权
node test/bots-strength.mjs          # 10/0 棋力量：必堵必赢的**行为**探针
node test/browser/bot-solo.mjs       # 真浏览器：一个人点一下 → 真和机器人下完一局 + 牌桌标注
node test/browser/bot-tacit.mjs      # 真浏览器：单人默契局，机器人会作答、能揭晓
node test/browser/bot-difficulty.mjs # 真浏览器：难度面板 → state → 引擎，全程贯通
node test/browser/bot-refresh.mjs    # 真浏览器：局中刷新后机器人必须继续动
```
浏览器实测：一个人点开始 → `mode=gomoku`、名单里有 `bot:1`、`phase=over`、真落了 9~12 手、0 个 JS 报错。
另：`realinput` 39/0、`duo-conflict` 0 失败（**真人双人局没被机器人影响**）、`solo-switch` 全过。

### 13.6 `solo-switch.mjs` 的行为升级（测试跟着产品改了，不是放松断言）
以前单人点五子棋 → 抛「人数不够」；现在 → 真的开一局、并提示「给你配了个机器人对手 🤖」。
该测试的 ② 段据此改成断言"真的开起来 + 名单里有在线机器人 + 回大厅后机器人被收走"，
比原来那条**更强**（原来只断言"看到提示"）。测试里也修了一个前提问题：② 把房主留在对局里，
③ 却假设两人都在大厅 —— 现在 ② 末尾显式回大厅。

### 13.8 实测调平衡：默认档「玩家几乎赢不了」是个**产品**问题（2026-09-24）

代码全绿 ≠ 好玩。这轮把自己当玩家实测，发现一个测试测不出来的问题：

**拿一个"休闲玩家"模型**（会连五、会堵四连、会堵活三，但 25% 看漏）对打，实测：

| | 调之前 | 调之后（各 150 局，±4%） |
|---|---|---|
| easy | 27% | **77%** |
| normal（默认） | **13%** | **57%** |
| hard | 15% | 0% |

调之前有两个毛病：默认档让人几乎赢不了；**normal 13% 与 hard 15% 根本分不出来** —— 难度选择形同虚设。

**怎么找到有效旋钮的（这些数字都是量出来的，改之前先跑 `test/bots-balance.mjs`）**：
· 调 `def`（防守）/`atk`（进攻）：只把胜率从 13% 抬到 ~40%，而且**方向不单调** ——
  把 atk 调低反而更难赢，因为机器人退化成"纯防守、什么都堵"，玩家更没机会。
· 调 `blockThree`（漏堵活三）：上限还是 ~40%，且会把机器人变成"漏堵型"，手感差。
· 真正有效的是 **`blunder`**（完全不走战术、随手下一手附近空点）。曲线（normal、各 40 局）：
  `0.15→13% / 0.25→28%(会玩45%) / 0.35→30%(会玩68%) / 0.45→60%`。

**顺带测出一个次序 bug**：`blunder` 放在"我自己能连五"**之前**时，easy/normal 有
**38~52% 的概率看不见自己的五连** —— 那看起来不是"让着你"，而是"这游戏坏了"。
已把「我能赢」移到最前面：示弱应该表现为**漏堵 / 不主动做棋**，而不是不吃送到嘴边的胜利。

**性能也量了**（`test/bots-playout.mjs`，在**产品默认的 15×15** 上打整局 ——
之前的测试全都跑 9×9，没覆盖默认盘）：每步 p50 1~2ms、p95 ≤11ms、max 13ms；
满盘（只剩 10 个空位）0ms。远低于可感知阈值，所以"思考延迟 0.7~1.6s"是拟人需要，不是算不过来。

浏览器实测（真鼠标连打 3 局 + 再来一局）：每局 **22~24 手**才分胜负（调平衡前只有 9~12 手，
一局很快就没了），机器人 0 次卡住、0 个 JS 报错。

**测试随设计意图更新（不是放松断言）**：
· `bots-test` 第 6 节原断言"必堵四连"，现改为断言**设计意图**：
  hard 30/30 必堵；normal/easy 故意会漏，且 easy 比 normal 漏得多。
· `bots-strength` 的判据从"普通档必堵"改成"hard 必堵、easy 比 normal 漏得多"。

---

### 13.7 后续四轮迭代：修掉 3 个真缺陷 / 量出来的结论（2026-09-24）

四轮都是「先写会失败的测试 → 再看是不是真 bug」，抓到 **3 个真缺陷**：

1. **跨局打一枪**（迭代1）：调度机器人时只比对 `host.state.mode` 判「这手过期没」，
   而**重开同一款游戏时 mode 一模一样** —— 只要有一条路径没清掉定时器
   （本项目历史上真出过泄漏，见 `test/d17-timer-leak.mjs`），上一局的动作就会打到新局上。
   修法：`clearAll()` 维护**当局世代号** `host._gen`，回调带上调度时的世代号，对不上就作废。

2. **刷新后机器人僵住**（迭代3，浏览器实测复现）：单人局里房主刷新，state 靠 retained 回来了，
   但**定时器随旧页面死了**；而"把 state 挂上 host"的三条路径都是**裸赋值**，
   压根不触发 `bots.onState` → 刷新之后机器人整局不再动，用户看到的是"轮到机器人然后永远卡住"。
   修法：新增 `Host.prototype.attach(state, keepHostId)` 作为**唯一**的状态接管入口
   （接管 + 按需改 hostId + 跑 resume + **再问一次轮到机器人了吗**），`adopt()` 改为复用它，
   ui.js 三处裸赋值全部改走 attach。现在 `grep 'host.state = ' src/ui.js` 无结果。

3. **默认值不显示**（迭代2）：设置面板按 `settings[mode][key]` 高亮，
   不预置默认值就**一个都不亮**，玩家看不出默认是什么。修法：`host.fresh` 预置
   `settings.gomoku = { size: 15, difficulty: 'normal' }`（与引擎兜底一致）。

**量出来的结论（别再用胜率当棋力指标）**：9×9 上**先手几乎必胜** ——
实测 hard vs hard 黑 20 白 0、normal vs normal 黑 20 白 0，连 easy vs easy 都是黑 13 白 7。
所以档位强弱要用**行为探针**衡量（各 40 次）：必堵四连 easy 21/40、normal 40/40、hard 40/40；
必胜局面三档都 40/40 直接连五（"故意不赢"会显得很假）。

**踩过的三个测试自坑（记录以免重犯）**：
· 对局中**大厅名册根本不渲染**（`.player` 一个都没有），玩家名字只出现在计分板 `.sbrow` 里 ——
  第一版机器人标识只加在大厅名册，等于永远看不到。现在两处都有。
· 四条恒真断言（`had ? true : true`、`x ? y : true`）等于没写，已改成真断言；
  其中一条改成「抓住那个还没跑的旧回调直接执行它」，这才验到了**异常路径**。
· 测试辅助函数（`humansTurn`/`humanMove`）只在某个文件里定义，跨文件复制时漏带 → 抛异常。

---

## 12. 部署（**只有用户明确要求时才做**）

```bash
cd /home/zuoye/派对游戏
node tools/release.mjs patch      # 升版本 + 构建 + cp 到根 index.html + 自跑 version-test
git add -A && git commit -m "..."  # 提交信息用中文，写清"改了什么 + 为什么 + 怎么验证的"
git tag v<版本>
git push origin main --tags
```
- `origin` 指向 `gh-proxy.com` 镜像（**有时会失败**，需重试；也可直连 `https://github.com:443/778672151/party-night.git`）。
- **凭据不写入任何文件**，由用户提供；推送用 `git -c http.extraheader="Authorization: Basic …" push`，失败则重试并切换直连。
- 部署后**必须**核对线上产物（别只看 HTTP 200）：
```bash
W=$(md5sum index.html | cut -d' ' -f1)
curl -sL "https://778672151.github.io/party-night/?x=$RANDOM" | md5sum   # 应等于 $W
curl -sL https://778672151.github.io/party-night/version.json            # version 应等于 VERSION
```
- Pages 有 1~2 分钟构建延迟，**第一次可能拿到 `d41d8cd98f00`（空响应）**，等 20 秒重试，不要立刻判定失败。
- 更好的做法：不要只比 md5，**再 grep 一下关键修复的特征串**确认真的在线。

---

## 13. 工作纪律

- 先 `grep -n` 确认锚点存在且唯一，再 `edit`；**禁止凭记忆写 old_string**。
- 每次编辑后**立刻**跑最便宜的真实检查（`node --check` / 相关套件），不许攒着。
- **没有贴出命令 + 输出，不许说"修好了/通过了"**。
- 先复现再改；一次只动一处；失败就**回退并如实报告**。
- 用户报 bug 时先问清"第几步、点了什么、看到什么"，别猜。
- 发现自己之前说错了：**主动撤回并说明**，不要掩盖。
- 不要只靠静态阅读代码就断言"界面正常" —— 必须实际运行、实际点击操作。
