# 真浏览器回归套件（可选）

这套用例跑在**真的浏览器**里，走**真实的公共 MQTT broker**，用多个独立浏览器上下文
（各自独立 localStorage = 各自一个玩家）跑完整流程。它专测那些 **jsdom 测不出来** 的东西：

| 用例 | 测什么 | 对应的历史缺陷 |
| --- | --- | --- |
| `secrets` | `state.g` 里不许出现词/答案 | 题目答案被明文广播（作弊级） |
| `join` | 点链接进房不弹「没找到房间」 | 探测超时 3 秒 vs 实际需要 6~7 秒 |
| `settings` | 大厅设置真的传进游戏 | 设置写到了 `settings[k]`，四个游戏的设置全部无效 |
| `rejoin` | 掉线再回来积分还在、状态正确 | 掉线被直接删出名单，积分清零 |
| `refresh` | 对局中刷新不白屏、能拿回身份 | 缺 secret 时 `appendChild(null)` 把整屏炸成「界面出错了」 |
| `blank` | 白板被投出后能看到猜词框 | 判定用了永远不存在的 `g.blankId` |
| `draw` | 落笔中途来状态消息不断笔、另一端实时可见 | 整树重建拆掉画布 → 指针捕获丢失 |
| `draft` | 别人提交时自己打了一半的描述还在 | 每次状态消息都清空输入框 |
| `slider` | 拖波长滑杆时别人提交不打断 | 和断笔同一机理，只修了画布 |
| `migration` | 关掉房主标签页，新房主能把这局打完 | 迁移后闭包丢失：结算崩溃 / 答案丢失 / 靶心被换 |
| `midjoin` | 开局后新人加入：不白屏、不误发词 | `appendChild(null)` 整屏报错 |
| `fullgame` | **四个游戏各完整跑通一局**（含计分），四人真机 | 端到端冒烟 |

## 怎么跑

需要一个能跑浏览器自动化、并且浏览器能访问到本仓库 HTTP 服务 的环境。以 WSL2 + Windows Edge 为例：

```bash
# 1) 起一个静态服务（Windows 侧用 localhost 访问 WSL 的服务是通的）
python3 -m http.server 8080 --bind 0.0.0.0 &

# 2) 用 Windows 的 Edge 开一个带调试端口的无头实例
"/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
  --headless=new --remote-debugging-port=9222 --remote-allow-origins=* \
  --user-data-dir="C:\pn-edge-profile" --disable-extensions --no-first-run about:blank &

# 3) 用 Windows 的 node 跑用例（脚本走 CDP 连 Edge，零 npm 依赖）
'/mnt/c/Program Files/nodejs/node.exe' "$(wslpath -w test/browser/regress.mjs)"

# 只跑某一条
'/mnt/c/Program Files/nodejs/node.exe' "$(wslpath -w test/browser/regress.mjs)" draw
```

环境变量：`PN_APP`（默认 `http://localhost:8080/dist/party-night.html`）、`PN_SHOTS`（截图目录，可选）。

## 注意

- **必须先在仓库根跑 `node build.mjs`**，用例加载的是 `dist/party-night.html`。
- 用例真的连公共 broker，网络抖动可能偶发失败，重跑即可（不要改断言迁就）。
- `migration` / `rejoin` 要等心跳超时，单条约 1~2 分钟。
- 本套件依赖外部浏览器，**不属于默认 `node test/*.mjs` 套件**；零依赖的那套见 `test/regress-fixes.mjs`。
