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

**Phase 3（`phase-3-canvas-engine`）开发已完成，PR 待提交/待用户确认合并。Phase 2 的 PR 也仍待确认合并（见下）。**

- **画板引擎**：Canvas 工具栏（画笔粗细、橡皮擦、线条擦、油漆桶、取色器、RGB 颜色/当前颜色）、矢量动作协议（`stroke`/`fill`/`lineErase`/`clear` 组成的"动作日志"，非位图）、多端实时同步（画的过程实时广播预览，落笔后广播最终动作）、按玩家维度的撤销/重做、全局清空。协议细节见 `FULLREADME.md` 第12节。
- **范围内的开放假设（等待用户确认）**：Phase 3 只做引擎本身，没有做"仅作画者可画"的权限限制——房间内任意在线玩家都能画/撤销/清空，这条留给 Phase 4/5 接入真实对局流程时在这层协议上加。已记入 `FULLREADME.md` 第10节 #21。
- 后端：`backend/src/canvas/store.js`（内存动作日志 + 按用户的撤销/重做栈）、`backend/src/canvas/validate.js`（输入校验，不合法直接拒绝）、`backend/src/socket/canvas.js`（`canvas:` 前缀的 Socket.io 事件）；房间销毁时同步清理对应的画板会话（`socket/rooms.js` 里补了 `canvasStore.destroySession` 调用）。
- 前端：`frontend/src/canvas/useCanvas.js`（协议 composable，本地镜像动作可见性规则，和后端 `getVisibleActions` 对应）、`frontend/src/canvas/CanvasBoard.vue`（可复用的画板组件，Phase 4/5 的游戏页面会直接引入）、`frontend/src/canvas/floodFill.js`（油漆桶泛洪填充）、`frontend/src/canvas/hitTest.js`（线擦命中检测）。
- **测试入口**：Phase 4/5 的正式游戏页面还没做，本 Phase 在房间大厅页加了一个"画板引擎测试"入口（`/room/:id/canvas-test`），明确标注为测试页而非正式游戏页面。
- 安全自查：记了两条已知取舍（`canvas:strokeProgress` 无限流/节流、上面提到的"任意玩家可画"权限假设），见 `FULLREADME.md` 第10节 Phase 3 审查表 #20/#21。
- 验证方式：写了一个不在仓库里的 Node 测试脚本，用两个模拟客户端跑通了完整协议——实时预览转发、落笔广播、非法输入拒绝、油漆桶、线擦（含"擦除已被擦除的笔迹"应拒绝）、撤销/重做（含线擦的撤销=恢复笔迹、重做=再次擦除）、清空（含清空后撤销/重做栈失效）、非房间成员访问被拒绝，全部通过。前端 `vite build` / `vite dev` 均通过。没有引入自动化测试框架/浏览器自动化测试，延续 Phase 1/2 的判断。
- 竞猜/接龙的具体游戏流程（抽词、回合流转、计分、聊天）仍然完全没有实现。
- 下一步：**Phase 4（竞猜模式完整玩法）**，开工前先读一遍 `FULLREADME.md` 第9节确认范围，并请用户确认上面提到的"任意玩家可画"这条开放假设该怎么收紧。

## 交接须知

- 每次 Phase 阶段性完成或切换后，更新本文件的"当前进度"部分，写清楚现在在哪个 Phase、卡在哪。
- 任何架构性决定（哪怕是"确认沿用之前的方案"）都写进 `HISTORY.md`，不要只在对话里口头确认。
- 涉及需求变更时，先改 `FULLREADME.md` 对应章节，再动代码。
