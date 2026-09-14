# 续作接力单（供下一轮/新会话直接接着干）

> 目标（见 goal-7b5020aa）：①修本地 three ②复核 memory-test ③其余游戏按"整包复用+桥接+轮次/日志"改造
> ④每款出双人对局+帧率证据 ⑤逐款升版本发布核对。完成度基准：`mini/plus-2265f7c6`（原作）。

## 当前稳定状态（可用，勿破坏）

- 线上/仓库：**v1.5.0**（`6343e30`），线上 md5 与本地一致；8 款联机 + 16 款小游戏
- 鲸鱼推箱子 = **整包复用原作**：`src/screens-soko.js` 用 iframe 跑 `mini/plus-2265f7c6/`，
  注入 61 行桥接；`src/games/soko.js` 只做轮流出手/移动日志/换关计分（**零行推箱子规则**）
- 真浏览器双人对局通过：`node test/browser/regress.mjs soko`（用例已含"两端重放收敛""键盘接管"）
- 单测：`node test/soko-test.mjs` 36/0；其余套件全绿

## 已闭环

- **② memory-test 计数**：稳定 29/0（声明 30 处，6 处挂在条件分支里 → 通过数会浮动）。
  之前看到的 24 是并发压测下同一现象，**不是功能失败**。已结案。

## 未闭环：① 本地 three（离线可用）

**已证实的部分**
- 把 importmap 的 `three` 与 `three/addons/` 指向本地后：three **确实从 `vendor/three.module.js` 加载**，
  `performance` 里 **jsdelivr 请求降为 0**
- 但原作**起不来**：`readyState:complete`、启动遮罩停在「正在启动」、**console/异常域零报错**

**已排除**：路径写错、MIME 问题、addon 相对 import（`RGBELoader`→`HDRLoader` 图已闭合，共 2 文件 624KB）
**未验证的可疑点**：boot 流程在 await 一个不返回的东西（最可能是外部 HDR：
`dl.polyhaven.org/.../kloofendal_48d_partly_cloudy_puresky_1k.hdr`，1–2MB）。下一步应先看
`src/gfx/sky.js` 的加载与兜底分支、以及 `src/main.js` 的 boot 步骤（`ui.setBoot`/`finishBoot`）**谁在 await**。

**可靠诊断手法**（上次踩过坑：iframe 的 `load` 事件里挂 error 监听会竞态、抓不到东西）：
- 用 CDP 的 console/异常域：`test/browser/diag-three2.mjs`（改 sleep 时长即可复测）
- 参考：`test/browser/probe-vendor.mjs`（跑 `performance.getEntriesByType('resource')` 看真实来源）

**现状**：importmap 已回退 CDN；`mini/plus-2265f7c6/vendor/`（624KB）留着未启用。**改它之前先备份 index.html**。



## 骨牌顶牛帧率体检（已并入 perf 场景：node test/browser/regress.mjs perf domino）

- idle（原作三渲二场景）：14 帧 / 平均 75.5ms（13fps）/ p95 89ms
- 出牌往返中：83 帧 / 平均 38.1ms（26fps）/ p95 89ms / 最长 111ms
- **必须注明**：这是无头软件渲染（无 GPU）的数字，同机纯 DOM 扫雷 idle 也仅 21fps，绝对值不代表真机。
- 结论：桥接往返没有引入额外卡顿（p95 与 idle 相同）；绝对流畅度需真机确认。

## 2048 肉鸽版（mini/2048-roguelike-ed8cf859）—— 已做完但**未通过验证，暂未上线**

**已可用的部分**（代码保留在 src/games/tile2048.js.wip + src/screens-tile2048.js.wip）：
- 房主权威轮次层（轮流走一步、日志、每局计分、结算）→ 逻辑层没问题
- 父页面 contentWindow.eval 完成：装固定种子（覆盖 w.Math.random，2048 出新方块是随机的）、
  拦本地按键、轮询读进度 → 双人对局用例 16 项断言里 15 项通过（含"越位被拒""无 JS 报错""两端不分叉"）

**卡住的地方（下次从这里接着查）**：
- 它是 **canvas 渲染**（#tiles 是空容器、.tile 数为 0），进度只能从 body 文本里
  正则取 SCORE n / MOVES n（这一招有效，已写进 .wip 代码）
- **转发的输入驱动不动它**：试过 document/window 派发 keydown（带 key/code/keyCode/which）、
  也试过在 #board 上模拟 pointer 滑动（pointerdown/move/up）——MOVES 始终 0。
  下一步建议：直接读它 index.html 1780-1810 行的 pointer 处理，看它读哪些字段
  （可能 touchStart 记的是 e.touches[0]，所以要派发 **TouchEvent** 而不是 PointerEvent）。
- 注意：**未验证的东西不要挂进构建**。这一款当前是 .wip，build.mjs 与 regress 的 ORDER 里都已移除。



### 12 轮摸底结果（很有用，先看这张表再挑游戏）

| 原作 | 是否 type=module | 全局 API | 复用难度 |
| --- | --- | --- | --- |
| plus-2265f7c6 推箱子 | module 但暴露 tallgrass | window.tallgrass | 已上线 v1.5.0 |
| demo-c046ab75 骨牌 | classic | 全局词法 game / 一堆全局函数 | 已上线 v1.6.0 |
| 2048-roguelike | **module** | 只有 gsap | **难：这就是 eval 驱动不动的根因** |
| demo-29b78d69 围棋 | module | **window.YiApp**（game/playMove/onPoint/cancelAI/finishScore/render/action） | 可行（已按 YiApp 改写） |
| rubik-anime-lab | classic | **window.__cubeAPI / __cubeApp** | 待做，天然回合制 |
| 3d-754ac5bb | classic | **window.__MAZE__** | 待做 |
| demo-70c71aac | classic | window.GT | 待看 |
| 其余（马里奥/拳皇/植物/弹球等） | — | — | 实时动作，QoS0 同步不了，不做 |

**围棋的未解矛盾（下一轮第一件事）**：\`PN.screens.go\` 确实在产物里（grep 计数 1）、index.html 也同步了，
但运行时 \`PN.screens.go\` 是 undefined，且 *.go-frame* 不在 DOM。最直接：在浏览器 eval \`Object.keys(PN.screens)\`
看实际注册了什么，再对齐 build.mjs 的屏幕清单位置（怀疑拼接位置与 ui.js 的 \`var PN\` 覆盖顺序有关）。






#### 第 17 轮：结论收紧到「dispatch 手上的 game 不是我注册的那个」

在 \`host.js:42\` 之后加探针，跑围棋用例得到：

    [诊断] dispatch 取值={"disp":16, "mode":"go", "gameOk":true}
    [诊断] action 到达次数={"dbg":0}

\`disp=16\` 说明 \`host.dispatch\` 跑了 16 次；\`mode=go\`；\`gameOk=true\` 说明 \`PN.games['go'].action\` 存在。
也就是说 \`game.action(this, action, from)\` 这句**执行了 16 次**，可我游戏里 action 入口的计数探针**始终是 0**。
唯一自洽的解释：**dispatch 持有的 game 对象不是我注册的那一个**（重复注册 / 同名覆盖）。

**收口只需一步**（下一轮若回来做围棋，就做这个）：在 dispatch 里加
\`PN.__ft = (PN.games[this.state.mode].action + '').slice(0, 40);\`，与 \`PN.games.go.action + ''\` 对比，
或直接 \`PN.__same = (PN.games[this.state.mode] === PN.games.go);\` —— 一眼看出是不是同一对象。

#### 第 16 轮决定性证据（围棋的最后一格）

在 \`ui.js:304\` 加计数探针后跑用例得到：

    [诊断] onAction 门={"act":4, "host":true, "isHost":true, "t":"caps"}
    [诊断] action 到达次数={"dbg":0}

即：门进了 4 次（都是屏幕轮询发的 \`caps\`）、\`host/isHost\` 都为真、\`host.dispatch\` **被调用了**，
但 \`PN.games.go.action\` 一次都没进 —— 连 caps 都没进。

⇒ 剩下的唯一嫌疑是 \`host.dispatch\` 里这一句（\`src/host.js:42\`）：
\`var game = this.state.mode && this.state.mode !== 'lobby' ? PN.games[this.state.mode] : null;\`
要么 \`this.state.mode\` 在那个实例上不是 'go'，要么 \`PN.games['go']\` 当时是 undefined。
**下一轮唯一动作**：在这句后面加 \`PN.__disp = (PN.__disp||0)+1; PN.__mode = this.state.mode; PN.__gameOk = !!(PN.games[this.state.mode] && PN.games[this.state.mode].action);\`，一次跑通即可收口。

#### 第 15 轮：把分发门找到了（下一轮的最小探针写在这里）

动作从发送到落地只有两跳，都已定位：

1. \`src/room.js:291\`：\`if (this.isHost) { this.cb.onAction(action, this.me.id); return; }\`
   —— **发送者本身就是房主时，动作直接本地回调，不走网络**（骨牌/围棋用例里发动作的都是房主，所以走的是这条）
2. \`src/ui.js:304\`：\`onAction: function (action, from) { if (self.host && self.room.isHost) self.host.dispatch(action, from); }\`
   —— 只有这一道门会进 \`host.dispatch\`，而 \`dispatch\` 里才是 \`PN.games[mode].action(...)\`

按这两条，围棋用例的动作**应当**直达 dispatch，但探针显示 \`g.dbg === 0\`（游戏层从未被调用）。
⇒ 矛盾点只可能在：\`self.host\` 为空、\`self.room.isHost\` 非真、或 **onAction 被后注册的回调覆盖**。

**下一轮唯一要做的事**（很小）：在 \`ui.js:304\` 那行里加一次性计数 + 两个布尔值（\`PN.__act = (PN.__act||0)+1; PN.__actHost = !!self.host; PN.__actIsHost = !!(self.room && self.room.isHost);\`），
跑一次围棋用例读这三个值 —— 立刻知道是没进这道门、还是进了门但 dispatch 里 mode/game 查不到。

#### 第 14 轮：把范围缩小到「动作没到达游戏层」

在围棋的 \`action\` 入口加了计数探针后，判别实验给出决定性结论：

- 用**屏幕上的真实按钮**（⏸️ 停一手，走 \`ui.send\`）和用 \`PN.app.send\` 两种方式发动作，结果一样
- 房主侧 \`state.g.dbg === 0\` → **\`PN.games.go.action\` 从未被调用**
- 而 \`src/host.js:38-49\` 的分发是通用的且形如 \`PN.games[this.state.mode].action(this, action, from)\`，骨牌走同一段代码是通的

⇒ 故障在**比游戏层更上游**的地方：\`src/room.js\` 的 \`sendAction\`/{接收}，或 \`src/wire.js\` 里对动作类型的校验/白名单。
下一轮从这里查（不再查游戏逻辑、也不再查用例写法）：先看 \`room.sendAction\` 到 \`host.dispatch\` 之间那一跳。

### 围棋第 13 轮的进展（已解决两个真问题，剩一个）

**已解决 1：子串陷阱**。判断构建清单里有没有 go 屏幕时，我用的是 \`'screens-go' in s\` 和 \`grep 'screens-go'\` ——
而 **\`src/screens-gomoku.js\` 本身就以 \`screens-go\` 开头**，所以判断永远误判成「已存在」，\`src/screens-go.js\`
根本没进清单；同理 \`grep -c 'PN.screens.go'\` 命中的是 \`PN.screens.gomoku\`。
教训：**用带引号的完整文件名判断**（\`'src/screens-go.js'\`），别用前缀子串。

**已解决 2：屏幕已进包**。修正后 \`grep -c go-frame dist/party-night.html\` = 1，用例前 5 项全过：
9 路棋盘 / 黑先 / 原作整包跑在 iframe / 两端就绪 / **两端都是全新棋局（存档已清）**。

**剩余卡点**：用例调 \`PN.app.send({t:'move', p:40})\`（\`src/app.js:36\` 把 UI 实例挂为 \`PN.app\`，\`UI.prototype.send\` 存在），
但房主侧 \`state.g.log.length\` 始终 0。下一轮查两件事：① \`UI.prototype.send\` 有没有给动作带上 \`from\`（缺了会被 \`participants.indexOf(from) < 0\` 拦掉）；
② 房主自己发出的动作是否走同一条应用路径（骨牌那款用同一 API 是能记录的，可对比 \`S.domino\` 的写法差异）。



## v1.7.0 已上线：魔方接力（第 3 款）

\`f51bb81\` / tag v1.7.0 / 线上 md5 \`b8f1ca33944c10a250a716151edfe547\` 与本地一致 / onlineGames=10。
本地真浏览器双人对局 12 项全绿（含两端 stateKey 一致、越位拒绝、复原结算、零报错）；14 个 node 套件全绿。

**上线前修掉的三个真 bug（都值得记住）**：
1. 原作魔方**初始就是复原状态** → 我的屏幕一检测到 solved() 就上报，开局瞬间通关。
   修法：房主拒绝「一步没转就复原」+ 就绪后先 reset+scramble。
2. 打乱用 Math.random → 两端不同。修法：同种子覆盖（与 2048/骨牌同一招）。
3. **\`patch()\` 用房间阶段判断结束**（\`state.phase === 'over'\`，而房间阶段一直是 round）→ 结算界面永不渲染。
   修法：改用游戏自己的 \`state.g.phase === 'over'\`。

**一个未解的反常（重要线索，别忽略）**：把第 3 条同样的修改也应用到**骨牌**后，
骨牌的「两端牌局没有分叉」连续 3 次失败；**还原成 \`state.phase\` 后立刻恢复全绿**。
也就是说：骨牌那个 \`patch\` 里用 \`state.g.phase\` 会破坏骨牌的同步（机制未明）。
→ 骨牌保持已发布写法（用 \`state.phase\`），**不要顺手改**；若要改，先看清 domino 的 \`state.g\` 在 patch 时到底是什么。

**残留抖动（非产品缺陷）**：公网 broker 下偶发「两端没有分叉」这条断言失败（本地全绿、线上偶发），
以及一次测试侧 \`undefined.click\`（怀疑公网下某位玩家一度掉线）。属于公共 MQTT 的固有抖动，已在多处见过。

**魔方还缺 ④ 的帧率体检**（perf 场景目前支持 hop/mine/soko/domino，加 cube 即可）。

## 魔方接力（rubik-anime-lab-0b0c6984）

**第 21 轮：初始一致性已过（同种子生效），剩「对手侧不收敛」**

修好后跑出（房主本地断言全过）：
\`✓ 打乱种子 ✓ 先加入先转 ✓ 原作整包跑在 iframe ✓ 12 个转动按钮\`
\`✓ 两端魔方初始状态一致（同种子打乱，stateKey 相同）\`  ← 本轮解决
\`✓ 第一手被记录 ✓ 换人 ✓ 越位被拒 ✓ 复原一次即完成本局 ✓ 双方各得 2 分 ✓ 两页零报错\`
\`✗ 两端魔方没有分叉   ✗ 结算界面出现总积分\`

两条失败指向同一个方向：**非房主那一侧没有跟着更新**（对手页的魔方不落地、也没渲染结算界面），
而房主本地一切正常。骨牌用同一套传输是通的，所以问题在我这款屏幕在「对手侧」的落地环节。

**下一轮从这里查（很可能是一处小 bug）**：对比 S.domino 与 S.cube 的 patch/applyLog；
重点看 S.cube 的 \`applyLog\` 里那个「log 变短就 reset+scramble」的分支 —— 在对手侧它可能被反复触发（每次都重置，于是永远追不上）。



**第 20 轮：产品侧全绿，只差用例两处时序（已找到两个真 bug 并修好）**

修掉的真 bug：
1. **开局瞬间通关**：原作魔方初始就是复原状态，屏幕一检测到 solved() 就上报 → 改成①房主拒绝「一步没转就复原」；②就绪后先 reset+scramble。
2. **两端打乱不同**：scramble() 用 Math.random → 加同种子覆盖（和 2048/骨牌同一招）。

跑出来的结果（产品侧全过）：
\`✓ 打乱种子 ✓ 先加入先转 ✓ 原作整包跑在 iframe ✓ 12 个转动按钮 ✓ 两端就绪 ✓ 第一手被记录 ✓ 换人\`
\`✓ 两端落地后 stateKey 一致（17,3,11,12,21,0,18,8,8…）  ← 双人兼容的核心 ✓ 连转两步含带撇仍一致\`
\`✓ 越位被拒 ✓ 复原一次即完成本局 ✓ 双方各得 2 分 ✓ 两页零 JS 报错\`
\`✗ 两端魔方初始状态一致  ✗ 结算界面出现总积分\` ← **都是用例时序**：前者在两端打乱未完成时就 break；后者在重渲染前查文案。

**下一轮（只改用例，不改产品）**：把初始一致性那段循环改成「a.key === b.key 才 break」；结算文案改成轮询最多 8 秒。
注意：改 regress.mjs 前先 grep 出确切行（我本轮三次因凭记忆写锚点而失败）。



**第 19 轮的补充**：改成独立用例 \`test/browser/test-cube.mjs\`（不走 regress 插入，避免再弄坏它）后，
仍在 "进入对局" 超时 —— 但**上一轮在 regress 的 S.cube 里，同一个 \`startGame(H, 'cube')\` 是把游戏开起来了的**
（诊断有 \`mode=cube / phase=play / players=2\`）。差别只可能在我这个独立文件自己的房间/主机判定与等待时序上。
**下一轮建议**：直接用 regress 里的 S.cube 场景（把 waitFor 表达式改对即可），不要在独立文件里重造房间流程。

—— 产品代码已通，只差一个写对的用例（最有希望的一款）

**原作 API（实测）**：\`window.__cubeAPI\` = \`applySeq(txt)\`（吃 "U R' F2" 这样的序列，自己排队+播动画）、
\`stateKey()\`（状态字符串）、\`solved()\`、\`busyNow()\`、\`scramble()\`、\`reset()\`、\`pickAt()\`；\`window.__cubeApp\` 是内部对象。
classic 脚本、非 module —— 正是能便宜复用的那一类。

**已完成**（\`src/games/cube.js.wip\` 124 行 + \`src/screens-cube.js.wip\`，均未挂进构建）：
轮流转动、权威日志、复原结算（每复原一个双方各 +2）、打乱种子两端一致、12 个转动按钮、捕获拦截拖拽、
父页面轮询 \`stateKey/solved/busyNow\`。

**实测证据（产品是通的）**：用例在 "进入对局" 那步超时时，诊断打出：
\`{"mode":"cube","phase":"round","g":[..."phase"...],"players":2,"hasScreen":true,"hasGame":true}\`
→ 游戏确实开起来了、屏幕也注册了；**卡的是我在用例里用 python 拼 SQL 似的引号，把 waitFor 表达式写坏了**。

**下一轮（很小）**：把用例里 \`H.waitFor\` 的表达式用反引号模板写（不要用 python 拼引号），先跑通 "两端 stateKey 一致"，
再做发布（这一步做成了就是第 3 款上线游戏）。注意：改 test/browser/regress.mjs 用 edit 工具或整文件重写，
不要用 python 行替换（本轮两次把 try/catch 结构弄坏）。

## 围棋（mini/demo-29b78d69）—— 结构探明，**驱动方式要换，暂未上线**

**决定性证据**（`test/browser/probe-go.mjs` 可复跑）：
在 iframe 外部 eval 时，`typeof C` / `typeof game` / `typeof playMove` **全是 undefined**，而 `canvas:1` 正常、
`localStorage` 为空 —— 说明原作的引擎与状态是**模块作用域**，外部脚本碰不到（这与推箱子/骨牌那两款不同，
那两款的状态是全局词法绑定，所以 `contentWindow.eval` 读得到）。

**因此不能沿用"eval 直接调引擎"的路子，要改成"驱动 UI + 读 DOM"**（这条路原作是支持的）：
- 落子：给它 canvas 发**键盘事件**（原作 523 行：方向键移动选中点、**回车确认**），
  选中点会显示在 `#board-caption` 文本里（"键盘选择：D4 · 回车确认"）→ 可以据此确认选到了哪一点
- 读进度：棋谱渲染成 DOM（`.move-chip` 的数量 = 手数，456 行），吃子/形势也在它的侧栏文本里
- 它把棋局存 localStorage（键名待确认，探针里当前为空），两端同源必须防载入同一盘旧棋
- 另外它自带 AI：`playMove(p, fromAI)` + `cancelAI()`（在模块作用域内，外部调不到 → 只能靠 UI 或注入脚本）

**现状**：`src/games/go.js.wip` + `src/screens-go.js.wip` 保留（逻辑层已写完：轮流/停一手/认输/按吃子结算，
130 行），`build.mjs` 与 regress ORDER 里已移除。

## 下一轮主线：③ 其余游戏整包复用

优先级建议（都要求：真浏览器双人对局 + `perf` 帧率数据 + 发布核对）：

| 顺序 | 游戏 | 复用对象 | 备注 |
| --- | --- | --- | --- |
| 1 | 骨牌顶牛 | `mini/demo-c046ab75`（243 行、手写单文件） | 无全局 API，桥接要靠**模拟点击 + 读 DOM**；先读它代码确认状态形状 |
| 2 | 2048 肉鸽版 | `mini/2048-roguelike-ed8cf859` | 键盘驱动 → 桥接转发按键 + 读盘面 |
| 3 | 3D 重力迷宫 / 古戈尔增量 / 围棋 | 各自 mini 目录 | 同上，逐款评估桥接面 |
| 4 | 五子棋 / 扫雷 / 翻牌 | 无可复用三渲二成品 | 才用 `PN.Toon`（`src/toon.js`）重绘 |

### 第 1 款探明的接缝：骨牌顶牛（demo-c046ab75）

**它不是手写单文件，是另一套成熟项目**：`game.js` 1979 行 + `ui.js` 3007 行 + `sw.js`/PWA，
自带大厅、色子定庄、规则设置、多牌类（`dingniu` 可玩、`mahjong` 置灰）。

- **可用的全局动作**（index.html 的 onclick 直接调，说明挂在 window 上）：
  `enterGame('dingniu')` / `rollDice()` / `startGameWithDealer()` /
  `playerPass()` / `confirmPlay()` / `confirmPlaySide('left'|'right')` / `handleNextRoundClick()`
- **它自带"传递设备"双人**：`passDeviceBtn` → `localPlayerReady()` —— 说明"轮到谁"是它内部概念，
  我们要做的是把这个"轮到谁"换成**我们的房主权威轮次**，动作仍调它自己的函数
- 内部有 `PHASE { WAITING, DEALING, PLAYING }` 与完整牌谱（`TILE_TYPES`，含 ends/points/count/img）
- **已定位（全部在 `ui.js`）**：
  - 状态：**顶层 `let game = null`**（另有 `selectedTileId/selectedEnd/passTileId` 等 UI 选择态）。
    注入的桥接是普通 script，和它共享全局词法环境，**直接写 `game` 即可**（不是 `window.game`）
  - 动作：`rollDice():325` / `enterGame():375` / `startGameWithDealer():459` /
    **`localPlayerReady():606`** / `confirmPlay():2351` / `confirmPlaySide():2406` / `playerPass():2461`
  - **它自带两种双人**：`localMode/localReady`（同屏传递设备）与
    `onlineMode/mySeat/roomCode/ws/onlineState`（自带 WebSocket 联机 —— 需要服务器，本项目零服务器用不了）
- **路线（下一轮可照做）**：让它跑在 **localMode（传递设备）**，把这个"传给下一位"的交接点
  `localPlayerReady()` 换成**我们的房主权威轮次**：某玩家动作 → 发 MQTT 给房主 → 房主追加日志并广播 →
  两端按同一顺序调用同一动作。即：**它管牌局，我们管"谁在什么时候能动"**。
  （注意：动作依赖 `selectedTileId/selectedEnd` 这类本地选择态，重放时要么把选择一起同步，
  要么在桥接里先设置好选择再调 `confirmPlay` —— 这是这个游戏最需要小心的一处。）

**桥接模式模板**（照抄推箱子，别再自己写游戏）：
1. iframe 载入原作，父页面**每 300ms 主动补注入**桥接（不要只依赖 `load` 事件）
2. 桥接只做：`postMessage` 出状态、进来指令 → 调原作自己的输入 API
3. **捕获阶段拦截** iframe 内键盘/UI 按钮，输入只能由我们喂
4. 房主侧只存**移动日志**；两端各自确定性重放；带**回执 + 未落地重发**（原作动画期间会拒收输入）
5. 屏幕实现 `patch()` 恒返回真：**游玩期间绝不重建 DOM**（重排 iframe 会让原作重新加载）
6. 注意嵌套引号：桥接字符串里的 `querySelector("[data-action=play]")` 不要用引号包属性值

## 常用命令

```bash
python3 -m http.server 8080                     # 需要它跑着（browser 测试靠它）
node test/browser/regress.mjs <lobby|mine|soko|hop|gomoku|...>   # 真浏览器对局
node test/browser/regress.mjs perf [hop|mine|soko]               # 帧率体检
node tools/release.mjs minor                    # 升版本 + 构建 + 校验 + 同步 index.html
# 推送（需要 PAT，务必用后撤销）：
git -c http.extraheader="Authorization: Basic $(printf 'x-access-token:%s' "$TOKEN" | base64 -w0)" push origin main --tags
```
