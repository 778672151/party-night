# 阶段二产出：统一画风整合方案 + 入口系统升级方案

> 依据：阶段一候选清单（`GAME-CANDIDATES.md`）+ 对现有规范的**实际读取**（`src/style.css`、`src/screens-common.js`、`src/ui.js`、`build.mjs`）。
> 本阶段只出方案，**不改代码**；阶段三按本文执行。

## 一、现有画风规范（逐条读取所得，作为唯一标准）

**色板**（`src/style.css` 的 `:root`，全部实际使用中）

| 变量 | 现值 | 语义 |
| --- | --- | --- |
| `--bg` / `--bg2` | `#fff4f9` / `#ffe9f3` | 页面底 / 次底（奶油粉） |
| `--card` / `--card2` | `#ffffff` / `#fff7fb` | 卡片 / 次卡片 |
| `--ink` / `--ink2` | `#4b3a63` / `#a08cb8` | 正文 / 次要文字（紫） |
| `--line` / `--stroke` | `#ffd7e8` / `#6b5588` | 分隔线 / 描边（Q 弹贴纸风的关键） |
| `--acc` / `--acc2` | `#ff8fb8` / `#8ad7ff` | 主强调（粉）/ 次强调（蓝） |
| `--good` / `--bad` | `#5fd6a8` / `#ff8fa3` | 成功 / 失败 |
| `--blue` / `--yellow` / `--purple` | `#8ad7ff` / `#ffd86b` / `#c9a7ff` | 辅助三色 |
| `--r` / `--r2` | `26px` / `18px` | 大圆角 / 小圆角 |
| `--pop` / `--soft` | 立体贴纸阴影 / 柔和阴影 | 卡片立体感 |
| `--spring` | `cubic-bezier(.34,1.56,.64,1)` | **Q 弹过冲缓动（所有交互都用它）** |

**动画**（`@keyframes`，共 10 个）：`qbounce`（跳）、`qfloat`（浮）、`qpop`（弹出，进场默认）、`qwiggle`（摇）、`qdrop`（落下）、`qdot`（等待点）、`qslideL/qslideR`（左右滑入）、`qflipIn`（翻牌）、`qdone`（完成脉冲）。

**共用组件**（`src/screens-common.js` → `PN.gameCommon`）：`esc`、`gameHeader`（标题+阶段文案+右上角 pill）、`deadlineChip`/`fmtLeft`（倒计时）、`playerGrid`（玩家格）、`scoreboard`（记分榜）、`overButtons`（再来一局/回大厅）、`wireOver`（自动绑定）。

**布局与命名约定**：每个游戏一段 `/* ===== 游戏名 ===== */` + `<前缀>-*` 类名（现有 `.dg-` / `.tac-` / `.mem-` / `.cd-` / `.gm-`）；卡片 `.card`、按钮 `.btn primary|ghost|warn sm`、标签 `.pill`；**全站零图片素材**（美术 = CSS + emoji + canvas 绘制）。

**注册与加载机制**：玩法 `src/games/<id>.js` 末尾 `PN.games[ID]=game`；界面 `src/screens-<id>.js` 注册 `PN.screens[ID]`；`build.mjs` 里 `src/games/*.js` 自动按名排序纳入，**screens 必须手工加一行**；大厅卡片由 `ui.js renderLobby` 遍历 `PN.games` 自动生成；小游戏厅数据在 `data/mini.json`、文件在 `mini/<id>/`。

## 二、候选现状与冲突点（实测配色，非推测）

| 候选 | 现有基调（实测最高频色值） | 与现有规范的冲突 |
| --- | --- | --- |
| 3D 极简跳一跳 `3d-b830652d` | 深色 `#15171d`、`#3c3f52`、`#33364a`、灰 `#8a8ea3`；已有暖色 `#fff3d6`/`#ffd9e9`/`#ffd166` | 底色相反（深 vs 奶油）；方角硬阴影；无 `--spring` 弹跳 |
| 扫雷 `demo-b9f6349a` | GitHub 深色 `#0d1117`/`#1a1a1a`、金 `#ffd700`、红 `#ff6b6b`/`#cc0000`、`#e6edf3` | 底色相反；红金配色与马卡龙粉紫冲突；等宽字体 |
| 鲸鱼推箱子 `plus-2265f7c6` | 深绿底 `#10180d`、羊皮纸 `#f8f0da`/`#f6dcb0`/`#efe4c8`、`--font-pixel` | 深绿底 + 像素字体 vs 奶油底 + 系统圆体；但暖色羊皮纸可映射到 `--card` |

**冲突结论**：三款都是深色/写实风，与奶油马卡龙**方向相反**，属于阶段一预案里说的「现有画风规范与候选冲突」→ 走**最小改动映射**，不推翻任何现有规范。

## 三、统一画风整合方案（可执行）

### 3.1 配色映射表（候选色 → 现有变量，不新增变量）

| 候选用途 | 候选原值 | 映射到 |
| --- | --- | --- |
| 页面/画布底 | `#15171d` `#0d1117` `#10180d` | `var(--bg)` `#fff4f9`（canvas 里用同值常量） |
| 面板/格子 | `#1a1a1a` `#3c3f52` `#33364a` | `var(--card)` `#ffffff` / `var(--bg2)` `#ffe9f3` |
| 主文字 | `#eef1f4` `#e6edf3` `#f8f0da` | `var(--ink)` `#4b3a63` |
| 次文字 | `#8a8ea3` | `var(--ink2)` `#a08cb8` |
| 强调/得分 | `#ffd166` `#ffd700` | `var(--yellow)` `#ffd86b` / `var(--acc)` `#ff8fb8` |
| 危险/失败 | `#ff6b6b` `#cc0000` `#f85149` | `var(--bad)` `#ff8fa3` |
| 成功/安全 | 绿系 | `var(--good)` `#5fd6a8` |
| 描边/分隔 | 深灰边 | `var(--stroke)` `#6b5588` / `--line` `#ffd7e8` |

### 3.2 组件与交互统一

- 标题区一律用 `PN.gameCommon.gameHeader`；结算一律 `scoreboard` + `overButtons` + `wireOver`；倒计时用 `deadlineChip`。
- 卡片/按钮/标签一律用现有 `.card` / `.btn` / `.pill` 类，**不新写一套**。
- 进场动画用 `qpop`，按压缩放 `.96`，过渡一律 `var(--spring)`；禁止候选自带的线性/无缓动过渡。
- 圆角统一 `var(--r2)`（小控件）与 `var(--r)`（大卡片）；阴影统一 `var(--soft)` / `--pop`。
- 字体统一 `-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`（删掉候选的像素/等宽字体）。

### 3.3 素材规格（保持零图片素材）

- 不引入任何图片/图标库；角色与状态用 **emoji**（与现有 5 款一致）。
- canvas 绘制所需颜色**集中写在文件顶部常量**（如 `var C = {bg:'#fff4f9', card:'#ffffff', ink:'#4b3a63', acc:'#ff8fb8'}`），取值必须与 `style.css` 的 `:root` 一一对应，便于日后统一改色。
- 画布尺寸规范沿用现有：`aspect-ratio:1/1` 或 `min(...)` 限高、DPR 上限 2、`touch-action:manipulation`。

### 3.4 命名与目录约定（沿用现有，不新增体系）

| 类型 | 位置 | 数据 | 构建 |
| --- | --- | --- | --- |
| 联机游戏 | `src/games/<id>.js` + `src/screens-<id>.js` | 如需题库放 `data/<id>.json` | `build.mjs`：games 自动、**screens 手工加一行** |
| 单机/整包小游戏 | `mini/<id>/` | `data/mini.json` | 无需改构建 |
| 样式 | `src/style.css` 末尾追加 `/* ===== 名称 ===== */` + `.<前缀>-*` | — | 自动内联 |

## 四、入口系统升级方案（阶段三执行）

**问题（已读取确认）**：大厅卡片**只按 `PN.games` 遍历**，没有分类、没有来源/画风元信息，单机小游戏与联机游戏分成两套渲染代码，加新游戏只能再写一个卡片模板。

**升级内容（小步、可回滚）**

1. **游戏元信息标准化**：给 `PN.games[id]` 增加可选 `meta = { group: 'online'|'mini'|'solo', tags: [...], origin: {site, slug, author} }`；老游戏不写也能跑（向后兼容）。
2. **大厅分区渲染**：按 `meta.group` 分区（联机双人 / 小游戏厅 / 单机），卡片模板**统一为一个函数**（消除现在 lobby 与 mini 两套卡片代码）。
3. **统一卡片组件**：抽 `PN.gameCommon.gameCard({emoji,title,desc,tags,disabled})`，lobby 与 mini 共用 → 以后加游戏只写数据。
4. **扩展点**：`data/mini.json` 与 `PN.games` 合并成一份游戏目录视图（`PN.Catalog.list()`），入口只依赖目录，新增游戏零改入口。
5. **不动**：`PN.screens` 注册方式、`build.mjs` 的 games 自动纳入、小游戏厅 iframe 浮层机制、`mini/` 目录约定。

## 五、需要改动的文件清单（阶段三）

| 文件 | 改动 | 风险 |
| --- | --- | --- |
| `src/screens-common.js` | 新增 `gameCard()` 与 `catalog()` 辅助（纯新增，不动现有 8 个函数） | 低 |
| `src/ui.js` | `renderLobby` 改为调用统一卡片 + 分区渲染；mini 卡片改用同一函数 | 中（大厅是入口，必须逐次验证） |
| `src/style.css` | 追加分区标题/统一卡片的少量样式（复用既有变量） | 低 |
| `build.mjs` | 不改（games 自动纳入；仅新 screen 时加 1 行） | 低 |
| `test/browser/regress.mjs` | `lobby` 用例断言同步（仍是 5 款联机 + 16 款小游戏） | 低 |

## 六、冲突预案（遵循阶段纪律）

- **若候选色无法映射**：优先复用最相近的现有变量；确实需要新色时，只在 `:root` **新增一个变量**并在本文件登记，不散落硬编码。
- **若入口改造后大厅报错**：先 `git checkout -- src/ui.js` 回退到可用状态，再最小化复现（定位到具体一行）后小步重改。
- **若某候选无法改双人**：按阶段一预案在清单里标注原因并换替代项，不强行改造。

