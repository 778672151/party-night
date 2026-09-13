# 两个人的游戏厅 🧸

**双人联机 · 零服务器 · 单文件网页小游戏**。两个人各自打开链接、进同一个房间，一个画一个猜。
马卡龙配色的二次元 Q 弹可爱风，手机上直接玩。

🎮 **在线直接玩：<https://778672151.github.io/party-night/>**（GitHub Pages，永久链接）

## 玩法：你画我猜（双人）

1. 一方打开页面 → 填昵称、选头像 → **开个房**，拿到 4 位房号（例如 \`K7Q2\`）
2. 点右上角 **📤 分享**（或 📋 复制链接），把 \`.../#K7Q2\` 发给对方
3. 对方点开 → 填昵称 → **加入房间**
4. 房主点 **开始**：画家三选一 → 作画；猜的人打字抢答，猜中有分
5. 一局 6 回合（可在 ⚙️ 里改回合数与单回合时长），两人轮流当画家；可以随时回大厅重开

- 画笔实时同步：一笔一笔地传，中途掉线/刷新会自动补齐
- 猜到「差一点」会给橙色提示；全员猜中会提前揭晓
- 房主掉线会自动选出新房主，对局不中断

> 只做两个人和一个玩法，是有意的：内容少一点，每处手感都做好。

## 为什么不用服务器

- **公共 MQTT broker 中转**：\`wss://broker.emqx.io:8084/mqtt\` 为主，\`wss://broker.hivemq.com:8884/mqtt\` 自动兜底。协议是手写的 MQTT 3.1.1 over WebSocket，**零依赖**。
- **房主即权威**：所有状态只由房主计算，用 retained 消息广播，其他人只渲染；晚到/刷新的人一进房就拿到当前状态。
- **房号即房间**：话题前缀 \`pn3/{房号}/...\`。
- **私密消息真加密**：画家的候选词与答案走 ECDH P-256 协商 + AES-GCM 点对点加密，不走广播。
- **画笔走专门的墨迹通道**（\`src/wire.js\`）：每块带「本块首点在整笔中的下标」，接收端按位落位 —— 公共 broker 是 QoS0 会丢包，丢块能靠**缺号自动补发 + 周期性自愈**补齐，而不是在画面上留一道断口。实测：人为每 3 块丢 1 块，对端墨迹 4366 vs 画家 4371（99.9%）。

## 本地跑 / 构建 / 部署

    # 直接打开（file:// 也能玩，但浏览器不给 crypto.subtle，私密消息会降级为混淆）
    xdg-open dist/party-night.html

    # 或者起个静态服务（推荐：有真加密）
    python3 -m http.server 8080        # 然后开 http://localhost:8080/dist/party-night.html

    # 改完源码重新打包成单文件（内联 CSS/JS/词库）
    node build.mjs                     # → dist/party-night.html
    cp dist/party-night.html index.html   # GitHub Pages 要的是根目录 index.html

只有一个文件，任何静态托管都行：Cloudflare Pages / Netlify / Vercel 拖进去即可；GitHub Pages 就是本仓库的做法。

> 必须用 **https 或 localhost** 打开才有 \`crypto.subtle\`（真加密）；http 会降级。

## 测试

零依赖的 Node 用例（直接跑）：

    node test/wire-test.mjs               # 墨迹通道：信封/按位落位/缺号检测/补发缓冲（16 项）
    node test/regress-fixes.mjs           # 核心缺陷护栏：答案泄露 / 设置失效 / 房主迁移 / 掉线丢分 / 挂机兜底（18 项）
    node test/integration-drawgame.mjs    # 真实 broker 跑完整一局（选词→作画→猜中→揭晓→回放→换轮）
    node test/mqtt-smoke.mjs              # broker 连通性
    ln -sfn /tmp/pnt/node_modules node_modules && node test/regress-drawgame-screen.mjs; rm -f node_modules
                                          # 画布/DOM 竞态回归（需要 jsdom；没装会 SKIP 并退出 0）

真浏览器端到端（Windows Edge + CDP，多个浏览器上下文 = 两个玩家；用法见 \`test/browser/README.md\`）：

    node test/browser/regress.mjs         # lobby / fullgame / rejoin / migration 四组
    node test/browser/regress-stroke.mjs  # 画笔专项：慢画快画、丢包注入、掩码、不许出现「起点连终点」
    node test/browser/mobile-audit.mjs    # 各手机视口下不许横向溢出
    node test/browser/shots.mjs after     # 出图（落地页/大厅/选词/作画/揭晓）

当前实测结果：wire **16 通过 / 0 失败**、regress-fixes **18 / 0**、jsdom **32 / 0**、
真 broker 一局 **PASS**、真浏览器四组 **全部通过**（含刷新后笔迹由回放补齐 2571 vs 2568）。

## 目录

    src/
      app.js                启动装配
      ui.js                 界面与路由（落地页/大厅/游戏/结算）+ 音效
      screens-common.js     游戏屏通用组件（头部/玩家宫格/计分板）
      screens-drawgame.js   你画我猜：画布、猜词、回放
      wire.js               墨迹通道：v4 信封 + 按位落位 + 缺号补发
      room.js               房间：MQTT 收发、心跳、选主、ACK 重传、私密通道
      mqtt.js               手写 MQTT 3.1.1 over WebSocket
      host.js               房主权威状态机（dispatch 是唯一动作入口）
      crypto.js             ECDH + AES-GCM（含降级）
      games/drawgame.js     玩法逻辑：选词/回合/计分/迁移恢复
      data.js               词库装载与随机
      style.css             二次元 Q 弹可爱风样式
    index.template.html     构建模板（__CSS__ / __BANKS__ / __SCRIPTS__ 占位）
    build.mjs               打包成单个 HTML
    data/draw.json          词库：300 个词，12 个分类（动作/场景/动物/成语/食物/网络/物品/运动/交通/自然/…）
    test/                   零依赖用例 + 真浏览器套件

## 已知限制

- 依赖第三方免费公共 broker：偶尔会连到备用服务器而与对方「不在同一个房间」（大厅会提示刷新）。不适合正经比赛。
- 两人都在同一浏览器（同一 localStorage）会导致身份相同；请用两台设备/两个浏览器。
- 只支持文字猜词，没有语音；口述靠语音通话自己解决。
- 历史：这个仓库原本是 4 个游戏 2–12 人的派对合集（谁是卧底 / 波长 / 谁最有可能 / 你画我猜），
  已按「只留双人可玩的那一个」收敛为你画我猜；旧版本在 git 历史里。
