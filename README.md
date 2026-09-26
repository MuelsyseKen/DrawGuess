# 你猜我画（暂命名）

署名：**Muelsyse & long_ken & Claude**

## 这是什么

一个本地部署、可通过网页对外访问的多人"你画我猜"类游戏。分两种模式：

- **竞猜模式**：一人上台画画，其他人在聊天框里猜，猜得越早分越高。
- **接龙模式**：所有人同时画自己抽到的词，然后把画传给下一位玩家猜，猜完再基于"猜到的词"接着画下一轮，最后看首尾词是否一致来计分。

一期目标：先做出能跑起来的网页版（本地部署 + 局域网/公网可访问）。**不是**这一期的目标：Unity 客户端本身（详见下方"关于 Unity"）。

## 技术栈（已确定）

| 层 | 选择 |
|---|---|
| 前端 | Vue3（多页面为主，允许局部做成 SPA） |
| 后端 | Node.js + Express |
| 实时通信 | Socket.io（房间状态、画板笔迹、聊天、计分广播） |
| 数据库 | SQLite（用户账号、历史战绩、排行榜、作画记录） |
| 房间/对局状态 | 纯内存，服务重启即清空（不追求断线续玩的持久化） |

## 关于 Unity

产品定位是**协议先行**：房间状态、笔迹数据、词库、计分规则全部走一套清晰的 JSON 消息协议（Socket.io 事件）。现阶段**不需要**为 Unity 做任何额外的解耦或抽象层——把协议设计干净、有版本感即可，以后如果真的要做 Unity 客户端，可以照着协议重新实现一套 UI。当前网页版做完后大概率不会有人接着做 Unity 版，所以不要为了"可能用不到的将来"过度设计。

## 画板与回放

画板底层**必须**按"笔迹矢量序列"存储（每一笔的坐标序列 + 颜色 + 粗细 + 时间戳），而不是只存最终 PNG。这样数据量很小，且为将来做"作画回放"功能留好了口子。一期 UI 可以不做回放播放器，但数据结构要按这个来设计，不要偷懒存位图。

## 文档地图

- `README.md`（本文件）——粗略介绍 + 交接文档，每次交接给下一个对话/下一个 AI 前更新。
- `Agents.md`——协作 AI（可能是 Claude / Deepseek / Gemini 等）必须遵守的规则，开发前必读。
- `FULLREADME.md`——完整文档：架构、数据模型、页面结构、协议设计、部署方式，随开发增减，只留必要内容。
- `HISTORY.md`——开发历史、踩坑记录，只增不减。

## 开发阶段（Phase）

开发按 Phase 拆分，**一个 Phase 一条 Git 分支，原则上也对应一次对话**。完整的 Phase 列表和范围见 `FULLREADME.md` 第9节。简要流程：

1. 从最新 `main` 拉出当前 Phase 的分支。
2. 在这条分支上开发，不直接动 `main`。
3. Phase 完成后开 PR，**不自行合并**，等用户确认后合并。
4. 下一个 Phase 从更新后的 `main` 重新拉分支。

协作用的 GitHub Token 仅限本仓库，权限只有 Contents + Pull Requests，具体限制见 `Agents.md`。

## 本地开发（Phase 1 起可用）

```bash
# 后端
cd backend
cp .env.example .env
npm install
npm run dev        # http://localhost:3000

# 前端（另开一个终端）
cd frontend
cp .env.example .env
npm install
npm run dev         # http://localhost:5173
```

后端提供 `/api/auth/register`、`/api/auth/login`、`/api/auth/logout`、`/api/auth/me` 四个账号相关接口，前端大厅页（`/`）已接入登录/注册弹窗。

## 当前进度

**Phase 5（`phase-5-chain-mode`）开发已完成，PR 待提交/待用户确认合并。Phase 1/2/3/4 的 PR 均已合并到 main。**

- **接龙模式完整玩法**：开始游戏（至少4人）、选词（系统词库抽3选1 / 玩家自定义出题，每条链的 owner 同时各自选自己的）、按轮转公式在多条链之间传递画/猜（奇数回合画、偶数回合猜，见 `FULLREADME.md` 第14.2节）、全员同时行动的"提前完成/全员完成即推进"机制、结算逐条链公示 + 不一致时的匿名/非匿名投票评审。协议细节见 `FULLREADME.md` 第14节，多处开放假设（回合数换算公式、计分数值、断线处理简化）已在文档里标注，**请重点确认**。
- **一房间多块画板**：接龙模式同时有多条链在画，`backend/src/canvas/store.js` 本身没改，靠复合 key（`roomId::chain::chainOwnerId`）分开存，`socket/canvas.js` 按 payload 是否带 `chainOwnerId` 分流，竞猜模式/测试页行为完全不受影响（第14.5节）。
- **断线处理和竞猜模式不一样**：接龙模式任意时刻是全员同时行动，不能照搬"暂停单个作画者倒计时"的做法，改成了"不暂停、断线者这一步算没赶上，正式移出的人后续轮到的步骤自动判定完成"，这条和竞猜模式的思路有实质性差异，见 `FULLREADME.md` 第14.7节，**请重点确认**这个简化是否可接受。
- 后端：`backend/src/chain/store.js`（对局内存状态）、`backend/src/chain/engine.js`（回合编排/结算评审）、`backend/src/socket/chain.js`（`chain:` 前缀事件）；`socket/game.js` 改成按 `room.mode` 分发 `game:start`/`game:getState`；`socket/canvas.js`/`socket/rooms.js` 相应接入了接龙模式的权限校验和断线钩子分发，竞猜模式路径改动很小（主要是把原来直接调用改成按 mode 分发一层）。
- 前端：`frontend/src/game/useChain.js`（对局状态 composable）、`frontend/src/pages/ChainGame.vue`（正式游戏内页面，路由 `/room/:id/chain-game`）；新增 `frontend/src/canvas/render.js`（从 `CanvasBoard.vue` 抽出的纯渲染逻辑）和 `frontend/src/canvas/ActionsPreview.vue`（结算展示用的静态画板预览）；`CanvasBoard.vue` 新增 `chainOwnerId` prop；`RoomLobby.vue` 的"开始游戏"入口改成两种模式共用。
- 验证方式：写了三个不在仓库里的 Node 测试脚本（`socket.io-client`），全部跑通：①核心链路（人数校验、选词/候选私发、轮转公式、画板权限、提前完成/全员提交提前推进、猜对计分、投票评审、结算排名）；②人数不足拒绝开局 + **完全没有任何人操作、纯靠服务端超时把整局从选词一路推到结算跑完**（这条专门覆盖了"没人做任何事"这种最容易被 happy-path 测试漏掉的路径，耗时约140秒，和公式预估一致）；③竞猜模式回归测试（确认 Phase 5 改的三个共用文件没有破坏 Phase 4）。**没有覆盖到的**：真实浏览器多开手动点 UI（只做了 `vite build` 编译检查），断线重连的真实网络断开场景（走读代码确认逻辑，没有真实断网验证）。这两条请重点体验一下。
- 顺带按用户要求把 **Phase 4 也回归自检了一遍**：补了一遍 Phase 4 当时没走完的安全审查登记（`FULLREADME.md` 第10节新增"Phase 4 审查"表格），并跑了一遍竞猜模式端到端测试（见上一条③）确认没有回归。
- 下一步：**Phase 6（战绩/排行榜/个人作画记录）**，开工前先读一遍 `FULLREADME.md` 第9节确认范围。

## 交接须知

- 每次 Phase 阶段性完成或切换后，更新本文件的"当前进度"部分，写清楚现在在哪个 Phase、卡在哪。
- 任何架构性决定（哪怕是"确认沿用之前的方案"）都写进 `HISTORY.md`，不要只在对话里口头确认。
- 涉及需求变更时，先改 `FULLREADME.md` 对应章节，再动代码。
