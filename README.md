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

## 本地部署（单端口，局域网/公网访问）

日常开发用上面两个 `npm run dev` 就行；真要把游戏跑起来给别人连（比如同一局域网内几个人用手机/电脑打开网页玩），用这个：

```bash
# 第一次部署：先准备后端配置
cp backend/.env.example backend/.env
# 至少改两处：NODE_ENV=production；JWT_SECRET 换成一个随机字符串
#（这两项不满足后端会直接拒绝启动，是有意为之的安全检查，见 FULLREADME.md 第10节 #1）

./scripts/start.sh
```

`start.sh` 会自动装依赖、构建前端（产物 `frontend/dist`）、然后用生产模式启动后端，后端顺带把前端静态文件也托管了——局域网/公网访问只需要暴露后端这一个端口（默认 3000），不用额外起 Nginx。脚本结束前会打印出局域网 IP，同一局域网内其他设备用 `http://<那个IP>:3000` 访问即可（**不要用 `localhost`**，那在别的设备上指向的是它自己）。

只改了后端代码、前端没变的话，可以用 `./scripts/start.sh --skip-build` 跳过重新构建前端，启动更快。

这套单端口部署只解决"局域网内跑起来"；如果要暴露到公网，路由器端口转发/防火墙/要不要上 HTTPS 反代等需要自行评估，脚本不处理这些。

## 当前进度

**Phase 7（`phase-7-polish-deploy`）开发已完成，PR 待提交/待用户确认合并。Phase 1~6 的 PR 均已合并到 main。**

- **响应式适配打磨**：排查发现除 `ChainGame.vue`（接龙模式游戏内页）外其余页面从早期 Phase 起就陆续加过 `@media` 断点，唯独这一个是漏网之鱼，本 Phase 补了 768px 断点（画板列取消固定最大宽度、计分板栏移动端铺满、选词/猜词表单竖排、候选词按钮组允许换行、投票按钮允许换行）。其余页面这次只做了走读确认，没有大改。
- **特殊效果占位 UI 补全**：`FULLREADME.md` 第4节写的是"像素艺术（+颗粒度）"，但颗粒度这个子参数此前完全没有对应 UI（只有 无/隐形/重力/像素艺术 四个禁用 pill）。本 Phase 在 `CreateRoomSettings.vue`（建房设置页）和 `RoomLobby.vue`（房间内设置编辑）两处都补上了一个禁用状态的颗粒度滑杆占位（新增常量 `settingsSchema.js` 的 `PIXEL_ART_GRANULARITY_RANGE`），纯前端展示用，不下发给后端、不影响 `validateSettings.js` 的校验逻辑。
- **本地部署脚本与文档收尾**：新增 `scripts/build.sh`（装依赖 + 构建前端）、`scripts/start.sh`（构建 + 生产模式启动后端，打印局域网访问地址）。后端 `app.js` 新增可选的 `FRONTEND_DIST_PATH` 静态托管（配合 vue-router history 模式的 SPA 回退），不设置这个变量时对现有"前后端分离开发"模式零影响。为了让单端口部署在任意局域网 IP 下都不用改前端配置，`socket/client.js` 调整为：`VITE_SOCKET_URL` 显式设为空字符串时视为"跟前端同源"，交给 `socket.io-client` 自动连当前页面 origin（`axios` 那边本来就是空串以外的相对路径 `/api` 直接能用，不用改代码）；`scripts/build.sh` 构建时会自动把这两个变量设成单端口部署要的值，不需要手动改 `frontend/.env`。
- 验证方式：**真实跑通了一遍完整部署流程**——`scripts/build.sh` 实际装依赖、`vite build` 编译通过；用临时生成的随机 `JWT_SECRET` + `NODE_ENV=production` 跑 `scripts/start.sh --skip-build` 把服务真起起来，`curl` 验证了 `/api/health`、`index.html`、静态资源（JS/CSS chunk）、vue-router history 模式下非根路径（`/records`）的 SPA 回退、以及 `/api` 下未知路径仍然正确返回 404（没有被 SPA 回退误吞）。**没有覆盖到的**：真实浏览器打开页面走一遍登录/建房/进游戏的完整交互（只验证了服务器返回的 HTTP 层面是对的，没有跑浏览器里的 JS）；真实局域网多设备联调（沙箱环境只有一张网卡，没法模拟"另一台设备用局域网 IP 访问"）；移动端浏览器上的实际触屏体验（响应式改动只在代码层面按现有断点惯例补齐，没有用真机验证）。这几条建议实机部署时重点看一下。
- 下一步：本 Phase 是 FULLREADME.md 第9节列出的最后一个 Phase。用户计划这个 PR 合并后开始实机部署，并让 Gemini / Deepseek 交叉提交 bug 反馈——如果后续还有 Phase，按同样的"读文档 → 拉分支 → 开发 → 自检 → PR"流程走，具体范围等用户在 `FULLREADME.md` 第9节或新对话里补充。

## 交接须知

- 每次 Phase 阶段性完成或切换后，更新本文件的"当前进度"部分，写清楚现在在哪个 Phase、卡在哪。
- 任何架构性决定（哪怕是"确认沿用之前的方案"）都写进 `HISTORY.md`，不要只在对话里口头确认。
- 涉及需求变更时，先改 `FULLREADME.md` 对应章节，再动代码。
