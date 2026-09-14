# 四阶段优化迭代 · 可核对报告

> 所有命令在仓库根目录执行。前置：`node build.mjs && cp dist/party-night.html index.html`，
> 然后 `python3 -m http.server 8080`（cwd 为本仓库）。浏览器用例需 Windows node：
> `'/mnt/c/Program Files/nodejs/node.exe' "$(wslpath -w test/browser/xxx.mjs)"`。
> 环境事实：本项目**零服务端**，`build.mjs` 把 `src/*.js` + `src/style.css` 拼进 `index.template.html`。

## 阶段 0 现状核查（只读，未改代码）

- 后端/路由：**不存在**。传输层 `src/mqtt.js`（公共 broker over WebSocket，QoS0 + 手写 ACK）。
- 会话层 `src/room.js`：房号 → MQTT topic 命名空间 + retained 状态；`leave(disband)` 清心跳/pending、发 `bye`、可选清 retained、250ms 后 `mqtt.end()`。
- 权威层 `src/host.js`：房主持有唯一状态，`dispatch` 执行 action、`emit` 广播。
- 外壳 `src/ui.js` + `src/app.js`；通用片段 `src/screens-common.js`；11 款游戏 `src/games/*` + 13 个屏幕 `src/screens-*.js`。
- **「返回大厅 / 退出房间」实为 3 个入口**：
  1. 结算页「🏠 回大厅」`screens-common.js:70`——**仅房主**可见（非房主看到"等房主决定"）；走 `ui.send({t:'lobby'})` 改状态，**连接保持**。
  2. 顶栏 `ui.js:47-62`——**同一插槽按身份变义**：房主 `send({t:'lobby'})`；非房主 `room.leave(false)` + `exitToLand()`。
  3. 设置面板 `ui.js:520-529`——房主「解散房间」`leave(true)`；非房主「离开」`leave(false)`，均接 `exitToLand()`。
- `exitToLand()` = `history.replaceState` 抹 URL 房号 → **整页 reload**。
- 掉线与主动离开的区分：`room` 的遗嘱带 `dropped:true`，房主据此 `markOffline`（25s 宽限）或 `removePlayer`。

## 阶段 1 返回大厅 / 退出房间

**结论：实测未发现冲突**（两个假设被证伪，见下）。**未改任何产品代码。**

新增验收测试 `test/browser/repro-cycle.mjs`（连续 3 轮完整链路）：

```
✓ 第1轮：两人进入对局（["小桃+","阿泽+"]）
✓ 第1轮：对方离开后房主端名册干净（["小桃+"]，无重复项/无离线残留）
✓ 第1轮：房主回到大厅（mode=lobby）
✓ 第2轮 / 第3轮 同样全过（共 12 项检查点）
✓ 全程房主页无 JS 报错：[]
CYCLE 完成 3 轮，检查点 12 项
```

被**证伪**的两个假设（`test/browser/repro-leave.mjs` + 代码核对）：

| 假设 | 实测/代码结论 |
|---|---|
| `exitToLand()` 整页刷新抢在 `bye` 之前，对端收到遗嘱 `dropped` | **否**。T+1s 名册即只剩一人（干净 `_left`，非离线） |
| `removePlayer()` 少了 `emit()` | **否**。`src/host.js:69-75` 的 `_left` 分支本就有 `this.emit()` |

## 阶段 2 房间抽象收敛

**未动手**，等决策。事实依据：房号即 MQTT topic 命名空间 + retained 状态，是**无服务端**时两机互找的唯一机制，也是重连/房主迁移/防撞号的基础；字面移除需新增匹配服务（属扩大范围）。

## 阶段 3 大厅画风统一

改动文件：`src/style.css`（三批追加，不改原规则）；新增基线脚本 `test/browser/phase3-baseline.mjs`。

```diff
/* 第一批：落地页头像格子 + 昵称输入框 */
+.field input{border:2.5px solid var(--stroke);background:linear-gradient(...平面色阶...);box-shadow:0 3px 0 rgba(107,85,136,.16);}
+.emoji-row > *{border:2.5px solid var(--stroke);border-radius:14px;background:linear-gradient(...);box-shadow:0 3px 0 rgba(107,85,136,.22);}
+.emoji-row > *.sel{box-shadow:0 0 0 3px var(--acc),0 3px 0 rgba(107,85,136,.22);}
/* 第二批：联机卡片与小游戏卡片统一 */
+.modecard{border:2.5px solid var(--stroke);box-shadow:0 5px 0 rgba(107,85,136,.16),var(--soft);}
+.modecard:active{transform:translateY(3px);box-shadow:0 0 0 var(--stroke);}
/* 第三批：房间号展示区 */
+.roomcode{background:linear-gradient(...);border:2.5px solid var(--stroke);border-radius:var(--r2);box-shadow:0 4px 0 rgba(107,85,136,.18);}
```

复现与证据：
```
node build.mjs && cp dist/party-night.html index.html
node.exe .../phase3-baseline.mjs      # 生成 pn-shots/phase3-{land,lobby}-{mobile,desktop}.png
node.exe .../regress.mjs lobby        # 全部通过
node.exe .../regress.mjs mini         # 全部通过
node test/style-check.mjs             # 全部通过
```
改动前后对照：`pn-shots/phase3-land-mobile-before.png` vs `...-after.png`（`pn-shots` 在 .gitignore 中，仅本地）。

**未改**：`.btn`（本就是 `:active` 下压 + 硬边投影的三渲二）、`.sbrow.top` 结算榜、`.dg-stage` 舞台——经核对已达标。

## 阶段 4 双人互动内容与主玩法的兼容

| 问题 | 文件 | 修法 | 证据 |
|---|---|---|---|
| **75 处用户反馈从未显示**：`host.toast` 只 push 进 `state.log`，而全项目**无渲染者**（`grep -rn 'state\.log' src/` 只有写入方） | `src/host.js` + `src/ui.js` + `src/style.css` | `Host.toast` 增加 `onLocalToast` 回调；`ui.js` 建 Host 时注入 `self.toast`；`.toasts` 加 `pointer-events:none` | 修复前采样 `.toast` 恒为空；修复后 T+1.4s 起稳定出现「对方离开了，这局先到这儿～」，零报错 |
| cube / go 离开收尾与其余 9 款不一致（无提示、跳过自己的 `settle`） | `src/games/cube.js`、`src/games/go.js` | `onLeave` 补 `toast` + `host.event({t:'gameover'})`（保留"不判谁赢/不加分"语义） | 真浏览器：对方离开后房主端 `g.phase=over`、提示可见 |
| gomoku 悔棋/同步断言抖动（固定 sleep / 点击后立即断言） | `test/browser/regress.mjs` | 改为 `waitFor` 等状态到位（负向断言保留 settle 等待） | `gomoku` 场景全部通过（含"同意悔棋后手数回到 1""两边一致") |
| drawgame 结束契约分叉（只写 `state.phase`，不写 `g.phase`）+ 无"在线不足 2 人"收尾 | `src/games/drawgame.js` | 补 `g.phase='over'`（已核实它从不读 `g.phase`，故纯增量）；`onLeave` 复用 `nextRound` 的结束分支 | 真浏览器：非画家离开后 `g.phase=over`、三条 toast 可见（含"对方离开了"）、零报错；`fullgame` 场景全部通过 |

## ⚠️ 未完成：部署

远端 `origin` 指向 `gh-proxy.com` 代理，对该仓库**连续多轮 403**、`ls-remote` 亦返回空 → **线上仍为 v1.14.0**，
本报告所述改动与本地 `v1.14.2` 产物**尚未上线**。链路恢复后执行：
```
git push origin main --tags
# 然后核对：md5sum index.html  vs  线上 md5；并读线上 version.json 的 version/onlineGames
```
