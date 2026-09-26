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

**Phase 6（`phase-6-records`）开发已完成，PR 待提交/待用户确认合并。Phase 1~5 的 PR 均已合并到 main（Phase 5 接龙模式完整玩法已合并，之前"PR 待确认合并"的状态已过期，`main` 上早就有了）。**

- **战绩历史 / 排行榜 / 个人作画记录**：`game_records`/`drawings` 两张表从 Phase 1 建表起就在，本 Phase 才第一次有业务代码真正读写。落库时机是每一局 `endGame` 时（正常打完或提前结算都算），一次性把这一局所有参与者的战绩 + 产生的画作用一个事务写进去；竞猜模式的画作是新增 `session.turnRecords` 在每回合结束时从画板快照捕获，接龙模式直接复用 Phase 5 `chain.steps` 里本来就存好的 `actions`，没有另外捕获一套。协议细节见 `FULLREADME.md` 第15节。
- 后端新增：`backend/src/records/store.js`（写入）、`backend/src/routes/records.js`（`GET /api/records/me`、`/leaderboard`、`/drawings`、`/drawings/:id`，全部要求登录）；`db/init.js` 补了 4 个索引；`game/engine.js`/`game/store.js`/`chain/engine.js` 三个 Phase 4/5 遗留下来的文件做了最小侵入的钩子接入（结算时调用落库，回合结束时捕获画作快照），没有改动这三个文件里任何原有的游戏逻辑分支。
- 前端新增三个页面：`RecordsHistory.vue`（`/records`）、`Leaderboard.vue`（`/leaderboard`）、`MyDrawings.vue`（`/drawings`，缩略卡片列表 + 点开按需拉取详情用 `ActionsPreview.vue`（Phase 5 结算页那个组件）弹窗回放），`Home.vue` 底部加了三个入口。
- 验证方式：①store 层单元自检（落库/排行榜聚合/空笔迹跳过等边界）；②REST 层自检（未登录 401、mode 非法 400、越权访问详情 404、分页夹值）；③**端到端回归**——起真实 http+socket.io 服务器跑一整局竞猜模式（开局→选词→作画→猜词→结算），确认 Phase 4 原有链路没有被这次改动破坏，并且结算后 `game_records`/`drawings` 落库结果和 `game:ended` 广播的分数完全一致。三份脚本都不在仓库里。**没有覆盖到的**：接龙模式的端到端落库没有另写单独的 socket 联调（`collectChainDrawings` 读的是 Phase 5 已经验证过的 `session.chains` 数据结构，走读代码确认字段对得上，判断复用 Phase 5 已有的正确性保证已经足够，没有必要为同一件事再跑一遍完整的接龙联调）；真实浏览器多开手动点 UI 三个新页面（只做了 `vite build` 编译检查）。这两条请重点体验一下。
- 下一步：**Phase 7（响应式适配打磨 / 特殊效果占位 UI 补全 / 本地部署脚本与文档收尾）**，开工前先读一遍 `FULLREADME.md` 第9节确认范围。

## 交接须知

- 每次 Phase 阶段性完成或切换后，更新本文件的"当前进度"部分，写清楚现在在哪个 Phase、卡在哪。
- 任何架构性决定（哪怕是"确认沿用之前的方案"）都写进 `HISTORY.md`，不要只在对话里口头确认。
- 涉及需求变更时，先改 `FULLREADME.md` 对应章节，再动代码。
