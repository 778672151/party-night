# 阶段四产出：兼容验证记录 + 迭代机制说明

> 兼容目标全部来自**只读查证到的项目事实**（见 goal ③），不是假设。

## 一、兼容目标逐项验证

| # | 兼容目标（来自项目事实） | 验证方式 | 结果 |
| --- | --- | --- | --- |
| 1 | 入口声明 `viewport-fit=cover` + `user-scalable=no` + `theme-color #fff4f9` + `lang=zh-CN` | `grep` 产物 | 见下方〔已验证〕 |
| 2 | 手机 420×900 视口无横向溢出、画布/棋盘看全 | 浏览器用例 `lobby`/`mini`/`codraw`/`gomoku` 内的 `overflow()` 与 fit 断言 | 全部通过 |
| 3 | 桌面 1280×800 视口无溢出、棋盘看全 | 同上（每个游戏用例末尾切换桌面视口断言） | 全部通过 |
| 4 | 手机小屏 390×844 / 360×640 各界面不溢出 | `node test/browser/mobile-audit.mjs`（落地页/大厅/大厅设置展开/画猜选词/画猜作画） | **修完复验：没有发现横向溢出** |
| 5 | 画布 DPR 上限 2（高分屏不炸显存） | `grep devicePixelRatio`（`canvas-ink.js` / `screens-gomoku.js`） | 两处都是 `Math.min(dpr, 2)` |
| 6 | 输入：click + pointer（画布），无 `touchstart` 依赖 | `grep` 统计输入事件 | click 39 / pointermove 4 / pointerdown 2 / pointerup 2 / keydown 2（touchstart 0） |
| 7 | 加密：`crypto.subtle`，无 https 时降级不报错 | `crypto.js:35` 判定 `crypto.subtle ? : null` | 有降级（http 退化为混淆） |
| 8 | 现代浏览器：用到 `aspect-ratio`/`clamp()`/`min()`/grid | `grep` CSS | `aspect-ratio` 4 处、`clamp(` 5 处、grid 列定义 10 处 → 已知限制：老浏览器不支持（见下） |
| 9 | 全程无 JS 报错（每个浏览器用例都断言 `consoleErrors() === '[]'`） | 9 组用例 | 全部 `[]` |

〔已验证〕1~9 均在阶段三之后重新跑过；9 组浏览器用例为「全部通过」。

### 审计中发现并修掉的真实缺陷（阶段四「补齐兼容处理」）

| 现象 | 定位 | 修法 | 复验 |
| --- | --- | --- | --- |
| 手机 390px 视口下**画猜画家页出现横向滚动**（文档宽 396 > 视口 390） | `mobile-audit.mjs` 报 `<div class="dg-hint"> "你要画打篮球" 位置 -6~396 宽 402` —— 该行是 `font-size:23px` + `letter-spacing:.22em` 的 flex 行，子项 `min-width:auto` 不可收缩，把容器撑破 | 只改 CSS（最小改动）：`.dg-hint` 加 `flex-wrap:wrap;max-width:100%;min-width:0`，`.dg-hint .w` 加 `min-width:0;word-break:break-word`，并加 `@media (max-width:430px)` 收紧字号字距 | 同一审计脚本复跑：**没有发现横向溢出** |

顺带修掉审计脚本自身的一个历史 bug：`mobile-audit.mjs` 用了未定义的 `ids[painter]`（画家页定位），改为按每页自己的 `PN.app.me().id` 匹配——否则审计根本跑不到画家页，这个溢出也就查不出来。

## 二、迭代机制说明（阶段四新建，此前项目里没有）

**改动前的事实**：无版本号、无 service worker、无缓存策略/更新提示/回滚脚本；发布 = `build.mjs` + `cp` + `git push`，回滚只能靠 git（隐式）。

**现在具备的能力**

| 能力 | 实现 | 怎么用 |
| --- | --- | --- |
| 单一版本来源 | 仓库根 `VERSION` 文件（语义化版本） | 手动改，或用发布脚本 |
| 版本进产物 | `build.mjs` 注入 `<meta name="pn-version">` 与 `PN.VERSION` | 任何产物都能自报版本 |
| 发布信息 | `build.mjs` 生成 `version.json`（版本 / 构建时间 / 游戏数量 / **产物 md5**），同时写到仓库根与 `dist/` | 页面加载时拉它做对账；也可用它比对线上产物 |
| 更新提示 | `src/app.js` 的 `checkVersion()`：打开页面 + 切回前台时对比 `version.json` 与内嵌版本，不一致才提示，一分钟最多查一次，失败静默 | 玩家看到「🎁 有新版本 x.y.z」+「刷新看看」 |
| 发布一条命令 | `node tools/release.mjs patch|minor|major|x.y.z` → 升版本 + 构建 + 跑发布一致性用例 | 见下 |
| 发布一致性校验 | `node test/version-test.mjs`（17 项） | VERSION ↔ version.json ↔ 产物内嵌版本 ↔ 产物 md5 ↔ 根 index.html，五处必须一致 |
| 回滚 | 产物是 git 里的普通文件，回滚 = `git revert` + 重新构建推送 | 见下（并有版本号/标签可定位） |

**发布流程（实测）**

```bash
node tools/release.mjs patch          # 1.0.0 → 1.0.1：升版本 + 构建 + 校验（实测通过 17 项）
git add -A && git commit -m '发布 v1.0.1'
git tag v1.0.1 && git push origin main --tags
```

**回滚流程**

```bash
git log --oneline --grep='发布' | head      # 找目标版本提交（配合 git tag 定位）
git revert <sha> --no-edit                  # 撤销该次发布（产物与源码一起回退）
node build.mjs && cp dist/party-night.html index.html
git add -A && git commit --amend --no-edit && git push
```

回滚后线上 `version.json` 的版本号会变回旧值，玩家页面下一次 `checkVersion()` 会对不上并提示刷新 —— **版本对账本身就是回滚生效的观测点**。

## 三、已知限制（不写成「已解决」）

- 老浏览器（不支持 `aspect-ratio`/`clamp()`/grid 的）打不开布局；项目从未声明支持 IE。
- 无 https / localhost 时 `crypto.subtle` 缺失，私密消息降级为混淆（不是加密）——这是既有设计，非本次改动。
- 免费公共 broker 偶发把某一端分到备用服务器（话题空间不同），表现为「进房见不到人 / 刷新后卡在连接中」；已有多处重试与提示，但**不是产品缺陷也不是本阶段能根除的**。实测同一命令会一次过一次不过。
- 更新提示依赖能取到 `version.json`；离线/只打开单文件时会静默跳过（不影响玩）。

