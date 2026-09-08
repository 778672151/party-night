# 群友派对之夜 🎉

单文件网页派对游戏合集，**零服务器**联机。把 `dist/party-night.html` 放到任何能打开网页的地方，群里发个链接，2–12 人立刻开玩。

## 四个游戏

| 游戏 | 人数 | 一句话玩法 |
| --- | --- | --- |
| 🕵️ 谁是卧底 | 3–12 | 平民拿到同一个词，卧底拿到近似词，轮流描述后投票放逐 |
| 🌊 心有灵犀（波长） | 3–12 | 通灵者知道 0–100 的目标值，只能用一句话提示，大家盲猜 |
| 🎯 谁最有可能 | 3–12 | 每轮一个问题，全体投票给「最有可能的那个人」 |
| 🎨 你画我猜 | 2–12 | 画家三选一，边画边被抢答，画笔实时同步、中途加入自动回放 |

## 怎么玩（联机）

1. 房主打开页面 → 建房 → 得到 4 位房号（例如 `K7Q2`）
2. 点右上角 📤 分享，复制形如 `.../party-night.html#K7Q2` 的链接，甩到群里
3. 群友点链接 → 自动进房（人到了房主那边会立刻出现）
4. 房主选游戏 → 开始；房主掉线会自动选出新房主，游戏不中断

手机建议用浏览器直接打开链接；微信/QQ 内置浏览器也能玩。

## 为什么不用服务器

- **公共 MQTT broker 中转**：`wss://broker.emqx.io:8084/mqtt` 为主，`wss://broker.hivemq.com:8884/mqtt` 自动兜底，连不上就换。协议是手写的 MQTT 3.1.1 over WebSocket，没有任何依赖。
- **房主即权威**：所有游戏状态只由房主计算，用 retained 消息广播，其他人只负责渲染；晚到的人一进房就拿到当前状态。
- **房号即房间**：话题前缀 `pn3/{房号}/...`，不同群互不干扰。
- **私密消息真加密**：谁是卧底的角色、波长的目标值、你画我猜的候选词，都走 ECDH P-256 协商 + AES-GCM 点对点加密，房主也看不到别人的秘密。`file://` 下浏览器不给 `crypto.subtle`，会自动降级为混淆（能玩，别用来赌钱）。
- **公共 broker 只保证「尽力送达」**（QoS 0，忙时会丢包）：关键消息带应用层 ACK + 重传 + 去重，状态用 retained 自愈，重连后自动补齐。这是实测出来的——见下文测试。

## 直接玩 / 本地跑

- 双击 `dist/party-night.html` 就能玩（`file://` 可用，加密降级）
- 或者起个静态服务：`python3 -m http.server 8080` 然后开 http://localhost:8080/dist/party-night.html

## 部署成固定公网链接

只有一个文件，任何静态托管都行：

- **Cloudflare Pages / Netlify / Vercel**：把 `dist/party-night.html` 改名 `index.html`，拖进控制台即可
- **GitHub Pages**：推一个仓库，开启 Pages
- **临时应急**：`ssh -R 80:localhost:8080 localhost.run`（免注册，链接随进程存活）

注意：**必须用 https 或 localhost 打开**才有 `crypto.subtle`（端到端加密）；http 下会降级。

## 构建与测试

```bash
node build.mjs                      # src/* → dist/party-night.html（内联 CSS/JS/词库）
node test/mqtt-smoke.mjs            # broker 连通性
node test/mostlikely-test.mjs       # 谁最有可能：逻辑
node test/integration-undercover.mjs # 谁是卧底：真实 broker 四人一局
node test/integration-wavelength.mjs # 波长：真实 broker 一回合
node test/integration-drawgame.mjs   # 你画我猜：真实 broker 一轮（含中途加入回放）
```

集成测试是**真的**连公共 broker、真的四五个客户端互相通信：房主 + 三个玩家各自独立连接，私密消息、动作、状态广播全部走真实网络。

`test/harness.mjs` 是共用的建桌脚手架，`test/faketimers.mjs` 把手动泵送计时器交给测试，`test/proxy.mjs` 是 TLS 透传中继（排查「消息到底有没有发出去」用），`test/debug-*.mjs` 是各类复现脚本。

## 目录

```
src/
  app.js          启动装配
  ui.js           界面与路由（落地页/大厅/游戏/结算）
  screens-*.js    各屏渲染
  room.js         房间：MQTT 收发、心跳、选主、ACK 重传、私密通道
  mqtt.js         手写 MQTT 3.1.1 over WebSocket
  host.js         房主权威状态机
  crypto.js       ECDH + AES-GCM（含降级）
  games/          四个游戏（init/action/resume/onLeave）
  data.js         词库装载与随机
  style.css       样式
index.template.html  构建模板（__CSS__/__BANKS__/__SCRIPTS__ 占位）
build.mjs            打包成单文件
data/*.json          词库（卧底 240 对 / 波长 141 条 / 谁最可能 185 题 / 画猜 300 词）
```
