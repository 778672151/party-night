# 当前任务：四阶段优化迭代（进行中）

> 本文件是跨会话交接。**先读这里**，再动手。

## 当前状态（第 29 轮刷新）

- 本地 HEAD：见 `git log -1`；版本 **v1.14.4**；工作树干净（仅两份早期遗留未跟踪文档）。
- **线上仍是 v1.14.0**：远端 `origin` 指向 `gh-proxy.com` 代理，对该仓库 **push 与 ls-remote 连续 10+ 轮 403/返回空**，
  **本地领先远端 11 个提交**（含阶段3四批画风 + 6 个底层缺陷修复）全部未上线。
  链路恢复后：`git push origin main --tags` → 比对 `md5sum index.html` 与线上、读线上 `version.json`。

## 四阶段进度

| 阶段 | 状态 |
| --- | --- |
| 0 现状核查 | ✅ 零服务端单文件架构；会话在 `room.js`（房号=MQTT topic 命名空间，是两机互找的唯一机制）、权威在 `host.js`、外壳在 `ui.js`；「返回大厅/退出房间」实为 3 个入口 |
| 1 返回大厅/退出房间 | ✅ 验收通过且**未发现冲突**；护栏 `test/browser/repro-cycle.mjs`（3 轮 12 检查点）；两个假设被证伪 |
| 2 房间抽象收敛 | ⏸ **等用户选** (a) 表面收敛（推荐：保留房号/topic，界面取消房间概念）/ (b) 字面移除（需新增匹配服务，会破坏匹配与重连） |
| 3 大厅画风统一 | ✅ 四批（落地页头像格+输入框、`.modecard`↔`.mini-card`、`.roomcode`、`.player`+`.pickable`）；基线脚本 `test/browser/phase3-baseline.mjs`；真浏览器 lobby/mini 通过。**未上线** |
| 4 双人互动兼容 | ✅ 审计完成 + 6 个真缺陷已修；验收受公共 broker 抖动影响**无法稳定通过**（已用受控 A/B 证明与改动无因果） |

## 底层缺陷清单（17 项）

**真缺陷 6 项，全部「先复现再修」并已修**：
- D2 `host.toast` 只写 `state.log` 而全项目无渲染者 → 跨 11 款游戏 **75 处反馈从未显示**（`3b79976`；修法：`onLocalToast` 注入 + `.toasts{pointer-events:none}`）
- D3 cube/go 的 `onLeave` 跳过自己的收尾，与其余 9 款不一致
- D4 drawgame 结束契约分叉（从不写 `g.phase`）+ 无「在线不足 2 人」收尾（`b1fd167`）
- D5 gomoku 悔棋/同步断言抖动（测试侧改 `waitFor`，未放宽断言）
- D12 `secretCache` 跨游戏不失效（重发时用当前 `state.mode` 配旧缓存）→ `goLobby` 里清空（`294fb56`）
- D14 `emitSoon` 用裸 `setTimeout`，不受 `clearAll` 管辖 → 改走 `this.after(...)`

**经代码证据证伪、确认无缺陷 9 项**：D6 幂等去重、D7 定时器释放、D8 `removePlayer` 的 emit、D10 retained 状态、D11 `adopt` 顺序、D13 人数约束、D15 掉线宽限、D16 `_seen` 残留、D17 `every` 抛异常。
**记录项**：D9 `destroy()` 无调用者（dead code）。
**未修 1 项**：**D1** —— `wins`/`streak` 只写不读且 `goLobby` 保留 `score` 却清零 `wins`；收敛需改 state 玩家字段 → **等用户确认**（删除 / 恢复语义并一致维护）。

## 新增护栏用例（都可单独跑）

```
node test/d12-secretcache-test.mjs    # 3/0  secretCache 在 goLobby 后失效
node test/d14-emitsoon-test.mjs       # 2/0  emitSoon 受 clearAll 管辖
node test/d15-dropgrace-test.mjs      # 3/0  玩家回归时 drop 宽限定时器被清除
node test/browser/repro-cycle.mjs     # 阶段1 验收（3 轮 12 检查点）
node test/browser/phase3-baseline.mjs # 阶段3 截图基线（移动/桌面）
```

## 环境事实（重要，避免误判）

- **公共 MQTT broker 会抖动**：可能把两人分到不同服务器，或丢掉 QoS0 的加密私密消息。
  症状：`rejoin` 报「连续 5 次都没能回到对局（公共 broker 兜底导致，非产品缺陷）」；codraw 会出现画布/调色盘缺失、
  秘密不一致、揭晓超时等**逐次不同**的失败。**判定口径见 `PHASE-REPORT.md` 的 A/B 小节**（回退修复后同样失败 → 非产品回归）。
- 浏览器用例需 Windows node：`'/mnt/c/Program Files/nodejs/node.exe' "$(wslpath -w test/browser/regress.mjs)" <场景>`；
  改完源码务必 `node build.mjs && cp dist/party-night.html index.html`（用例读仓库根 index.html）。
- 推送不要仅凭 `git push` 的 403 判断失败，用 `git ls-remote origin refs/heads/main` 核对。

## 未决问题（需用户拍板）

1. 推送链路（A1 绕过代理直连 github.com / A2 等恢复 / A3 用户修复）。
2. D1：删除死状态，还是恢复语义并一致维护？
3. 阶段 2：(a) 表面收敛 / (b) 字面移除？
4. 阶段 1 UX 语义：对方退出后房主端停在结算页需手动点「回大厅」，改不改？
5. D12 的设计问题：`goLobby` 是共用入口（用户主动回大厅 + 少于 2 人自动收局），是否只在用户主动回大厅时失效私密缓存？

