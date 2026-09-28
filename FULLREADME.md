# FULLREADME —— 完整设计文档

本文件随开发逐步增减，只保留"当前有效"的设计内容。讨论过程、废弃方案、踩坑记录请写进 `HISTORY.md`，不要留在这里。

---

## 1. 技术栈

- **前端**：Vue3。以多页面为主（登录、大厅、房间设置、游戏内页面等相对独立），允许在单个页面内部使用组件化/局部 SPA 写法。
- **后端**：Node.js + Express，提供 REST（账号、战绩查询等）+ Socket.io（房间、实时画板、聊天、计分广播）。
- **数据库**：SQLite。存储用户账号、历史战绩、排行榜、玩家作画记录（历史画作）。
- **房间/对局状态**：纯内存（Map/对象存储），服务重启即清空，不做持久化，不追求断线续玩。
- **部署**：一期目标是本地部署、局域网/公网可访问的单机服务，不引入 Docker/K8s 等编排方案。

---

## 2. 协议设计原则（为未来 Unity 客户端预留）

- 所有房间状态变化、画板操作、聊天消息、计分结果，都通过**结构清晰的 Socket.io 事件 + JSON payload**传递，不依赖前端框架特性。
- 协议要做到"看文档就能照着实现一个新客户端"，但**不需要**现在就搭建额外的解耦层或引擎无关抽象——保持代码简单，只要协议本身设计干净即可。
- 画板笔迹**必须**以矢量序列形式传输和存储：

```json
{
  "strokeId": "uuid",
  "playerId": "uuid",
  "color": "#RRGGBB",
  "width": 4,
  "points": [{ "x": 0.12, "y": 0.34, "t": 1234 }, ...],
  "tool": "brush | eraser | lineEraser | bucket"
}
```

  坐标建议用 0~1 的归一化比例，而不是像素绝对值，方便不同分辨率/设备下正确还原。

---

## 3. 页面结构

1. **首页/大厅**
   - 左上角：用户名 / 登出（未登录只显示"登录"按钮）
   - 中间：创建房间、加入房间 两个入口
2. **登录/注册弹窗**（非跳转，首页内弹出）
   - 登录：用户名 + 密码
   - 注册：用户名 + 密码 + 确认密码
3. **加入房间**
   - 加入私人房间：弹出输入邀请码的对话框
   - 加入公开房间：进入公开房间列表
4. **创建房间 - 模式选择页**
   - 展示"竞猜模式"和"接龙模式"卡片（参考用户提供的截图样式：模式卡片横向排列，选中态高亮）
5. **创建房间 - 参数设置页**（见第4节，竞猜/接龙分别设置）
6. **房间大厅页**（设置完成后进入）
   - 上方显示邀请码 + 设置入口（默认私人房间，可在设置里转为公开）
7. **游戏内页面**（竞猜模式 / 接龙模式，见第5节）
8. **结算页**（回合/对局结束后展示排名与总分）
9. **战绩历史 / 排行榜 / 我的作画记录**（Phase 6，见第15节；首页底部提供入口，未登录点击和"创建房间"一样先弹登录框）

响应式要求：以上所有页面在桌面浏览器和手机浏览器下都要可用，画板和工具栏在小屏幕下需要有合理的折叠/适配方案（不能简单等比缩小导致按钮点不到）。

---

## 4. 房间设置项

### 4.1 竞猜模式（2 ~ 32 人，UI 显示区间可配置，不写死上限逻辑）

**左侧**
- 特殊效果（单选）：无 / 隐形 / 重力 / 像素艺术（+颗粒度）—— 除"无"外的效果一期只需要做好 UI，选项禁用即可，不实现效果逻辑。
- 工具：笔刷（单一笔刷 / 可调节）、颜色（RGB / 单色）

**右侧**
- 绘画时间：30 / 60 / 90 / 自定义（最高 900 秒）
- 回合：1~5 / 自定义（最高 10）
- 词库（单选）：玩家自己出题 / 系统出题（下拉选择题库目录下的分类文件，选中后每行一个词随机抽一个）

设置完成 → 进入房间大厅页。

### 4.2 接龙模式（4 ~ 32 人）

**左侧**
- 特殊效果（单选）：无 / 隐形 / 重力 / 像素艺术（+颗粒度）—— 同竞猜模式，暂不实现效果逻辑，仅做 UI。
- 匿名投票（多选开关）：开启后，最终"猜测是否与原词一致"的投票**只隐藏投票人身份，投票结果依然公开显示**。
- 工具：笔刷（单一笔刷 / 可调节）、颜色（RGB / 单色）

**右侧**
- 绘画时间：30 / 60 / 90 / 自定义（最高 900 秒）
- 猜测时间：30 / 60 / 自定义（最高 300 秒）
- 接龙次数：1~7 环（默认 3）。接龙模式**没有**"回合"选项，总回合数由接龙次数决定（14.2）
- 结算时展示每步画作（开关，`showDrawingProcess`）：结算评审阶段是否展示每一步的画作缩略图。**底层始终按笔迹矢量序列记录**，与这个开关无关。
- 词库（单选）：同竞猜模式。

设置完成 → 进入房间大厅页。

---

## 5. 游戏内玩法与界面

### 5.1 竞猜模式

**流程**：每人轮流上台画画。系统抽 3 个候选词，作画者选其中一个开始画，其余人在聊天框猜。答对后该玩家禁止继续发言（防止剧透）。

**界面布局**
- 中间：题目（仅作画者可见完整词，其他人看到的是"字数提示"等，具体待细化）+ 倒计时
- 左侧工具栏（从上到下）：画笔粗细、橡皮擦、线条擦、油漆桶、取色器、RGB 颜色选择、当前选中颜色
- 右侧：玩家列表（名称 + 延迟状态 + 累计得分）
- 下方：聊天栏（正常聊天 + 猜词共用同一个输入框）
- 最下方：撤回、重做、清空

**计分规则**：按回答顺序递减加分，越早猜对分越高，最后阶段只有参与分；猜不中不加分。所有回合结束后直接结束游戏，统计总分排名。

### 5.2 接龙模式

**流程**（以 3 人 A/B/C，1 环接龙为例）：

```
第1回合  A(选词+画)      B(选词+画)      C(选词+画)
第2回合  A(猜C的画)      B(猜A的画)      C(猜B的画)
第3回合  A(拿"C猜的词"画) B(拿"A猜的词"画) C(拿"B猜的词"画)
...如此循环，循环次数 = 设置里的"接龙次数"
```

玩家的目标：自己最初选的词，经过一圈接龙后，最后一位玩家猜出的词如果和最初一致，则得分。

**界面布局**
- 中间：题目 + 倒计时
- 左侧工具栏：同竞猜模式（画笔粗细、橡皮擦、线条擦、油漆桶、取色器、RGB 颜色、当前颜色）
- 右侧：玩家列表（名称 + 延迟状态 + 累计得分 + 当前作画状态）
- 下方：聊天栏（正常聊天）
- 最下方：撤回、重做、清空、**提前完成作画**按钮
- 每回合结束后：展示当回合画作 → 下方输入框填"这画的是什么"（猜词）→ 确认按钮

**结算规则**：最后一环结束后，按顺序公布每个人最初的词、每一步猜的词、最终词是否与起始词一致。一致直接加分；不一致时进入**评分环节**——其他玩家投票是否认可"这个链条应该算数"，半数以上同意则加分（是否匿名取决于"匿名投票"设置：匿名只隐藏投票人身份，结果照样公开）。最终按累计得分排名。

---

## 6. 数据模型（草案，实现时以代码为准）

### 6.1 SQLite 表（持久化）

- `users`：id, username, password_hash, created_at
- `game_records`：id, user_id, room_id, mode(竞猜/接龙), score, played_at
- `leaderboard`（可由 `game_records` 聚合生成，不一定需要单独建表）
- `drawings`：id, user_id, game_record_id, stroke_data(JSON，矢量笔迹), created_at —— 玩家作画记录（"黑历史"存档）

### 6.2 内存状态（不持久化）

- `rooms`：房间号 → { 模式, 设置参数, 玩家列表, 邀请码, 是否公开, 当前对局状态 }
- `activeGames`：房间号 → { 当前回合, 当前笔迹缓冲, 计分板, 词库抽取结果 }

---

## 7. 词库格式

- 服务器读取固定目录（如 `wordbanks/`）下的所有 `.txt` 文件，每个文件代表一个分类，文件名即分类显示名。
- 每个 txt 文件内一行一个词。
- 系统出题时：先选分类（下拉），再从该分类文件里随机抽词（竞猜模式抽 3 个供选择，接龙模式同理）。

---

## 8. 尚待细化的点

（开发过程中如果发现新的未决问题，加在这里，解决后移入对应章节并在 `HISTORY.md` 记一笔）

- 隐形/重力/像素艺术等特殊效果的具体实现，一期不做，仅占位。

---

## 9. 开发阶段划分（Phase）与 Git 工作流

为了避免多个对话/多个 AI 同时改动导致混乱，开发按 Phase 拆分，**一个 Phase 对应一条分支，原则上也对应一次对话**。当前规划如下（如某个 Phase 范围过大，可以在开工前进一步拆分成子 Phase，命名为 `phase-N-x-*`）：

| Phase | 分支名建议 | 范围 | 状态 |
|---|---|---|---|
| 1 | `phase-1-skeleton-auth` | 项目骨架（前后端目录结构、构建配置）+ 账号系统（注册/登录、SQLite users 表、密码加密、基础 REST 路由） | 已合并 |
| 2 | `phase-2-rooms` | 房间系统：创建/加入房间（私人/公开）、邀请码、公开房间列表、房间设置页 UI（竞猜/接龙参数表单）、对应 Socket.io 房间协议 | 已合并 |
| 3 | `phase-3-canvas-engine` | 画板引擎：Canvas 工具栏（画笔/橡皮/线擦/油漆桶/取色器/RGB）、矢量笔迹协议、多端实时同步、撤销/重做/清空 | 已合并 |
| 4 | `phase-4-guess-mode` | 竞猜模式完整玩法：抽词、作画者选词、倒计时、聊天+猜词、计分、回合流转、结算页 | 已合并 |
| 5 | `phase-5-chain-mode` | 接龙模式完整玩法：选词作画、传递猜词、多环流转、结算公示、评分投票（含匿名投票） | 已合并 |
| 6 | `phase-6-records` | 战绩/排行榜/个人作画记录：`game_records`/`drawings` 表落地、历史页面、排行榜页面 | 已合并 |
| 7 | `phase-7-polish-deploy` | 响应式适配打磨（桌面/移动端）、特殊效果占位 UI 补全、本地部署脚本与文档收尾 | 已合并 |

**分支与合并流程**（硬性规则见 `Agents.md`）：Phase 开工前从最新 `main` 拉分支；开发与文档更新都在该分支；完成后开 PR，**AI 不自行合并**，等用户确认；合并后下一个 Phase 从更新后的 `main` 重新拉分支。一个 Phase 跨多次对话时沿用同一分支。

---

## 10. 安全问题跟踪

记录方式见 `Agents.md`"安全审查规范"。**只有确认修复并验证过才打勾**；明确不修的标"已知取舍"并说明理由。尚未解决/待验证的事项汇总在 `ISSUES.md`。

### Phase 1（2026-09-23，Deepseek + Gemini 第三方审查 + 人工验证）

| # | 问题 | 来源 | 状态 | 备注 |
|---|---|---|---|---|
| 1 | `JWT_SECRET` 生产环境沿用默认值，可伪造任意用户 | Deepseek + Gemini | [x] | `utils/token.js`：`NODE_ENV=production` 且密钥为默认值时直接 `throw` 拒绝启动；已手工验证 |
| 2 | JWT 未显式锁定算法 | Deepseek | [x] | 显式 `HS256` / `algorithms:['HS256']` |
| 3 | `register`/`login` 响应多下发冗余 `token` 字段，削弱 httpOnly 防护 | Deepseek | [x] | 响应体只留 `user`，前端本来就没读过 |
| 4 | `res.cookie` 与 `res.clearCookie` 属性不一致，登出可能登不掉 | Deepseek + Gemini | [x] | 抽出 `AUTH_COOKIE_OPTIONS` 共用；已验证登出后 `Set-Cookie` 过期且 `/me` 返回 401 |
| 5 | Cookie 有效期与 `JWT_EXPIRES_IN` 两处手写 | Deepseek | [x] | 改用 `ms(JWT_EXPIRES_IN)` 派生 |
| 6 | Socket.io 握手无鉴权 | Deepseek + Gemini | [x] | `io.use(socketAuthMiddleware)` 从握手 Cookie 解析 token 挂 `socket.user`（未登录为 `null`，由具体事件判断） |
| 7 | 鉴权保留了 `Authorization: Bearer` 兜底，白开攻击面 | Deepseek | [x] | 移除，只认 httpOnly cookie；已验证仅带 Bearer 访问 `/me` 返回 401 |
| 8 | 登录/注册无限流 | Deepseek | [x] | `express-rate-limit`，同 IP 15 分钟 20 次；已验证第 20 次后 429 |
| 9 | 密码哈希用同步 API 且轮数偏低 | Deepseek | [x] | 改 `bcryptjs` 异步 `hash/compare`，`SALT_ROUNDS=12`；注册/登录全流程无回归 |
| 10 | 时间字段非标准 ISO 8601 | Deepseek | [x] | 改 `strftime('%Y-%m-%dT%H:%M:%fZ','now')` |
| 11 | 缺基础安全响应头 | Deepseek | [x] | 引入 `helmet()`，curl 确认（CSP 后续见 #35） |
| 12 | 前端输入框无前置长度校验 | Deepseek | [x] | `AuthModal.vue` 加 `minlength`/`maxlength` 对齐后端 |
| 13 | 无 token 黑名单：登出只清 cookie，旧 token 到期前仍有效 | Deepseek | [ ] 已知取舍 | 引入 Redis 属重型依赖（`Agents.md` 禁止未经确认）；有改密码/强制下线需求时再评估 |
| 14 | 无自动化测试框架 | Deepseek | [ ] 已知取舍 | 人工验证已覆盖主要路径；复杂度上升后再评估 |
| 15 | 前端无路由守卫 | Deepseek | [ ] 已知取舍 | Phase 1 无需保护的路由；服务端权限校验才是真正的边界 |
| 16 | `COOKIE_SAME_SITE=none`（跨站部署）未联调 | 人工自查 | [ ] 未验证 | 本地为同源部署；若前后端分属不同顶级域名，上线前须验证 `none` + `COOKIE_SECURE=true` + HTTPS |

### Phase 2（2026-09-23，人工自查：邀请码靠不可猜测性做访问控制）

| # | 问题 | 来源 | 状态 | 备注 |
|---|---|---|---|---|
| 17 | `room:joinByCode` 无限流，可暴力猜 6 位邀请码 | 人工自查 | [x] | `utils/rateLimit.js`（内存滑动窗口），同用户每分钟 20 次，超限 `TOO_MANY_ATTEMPTS`；正常/错误邀请码流程已验证不受影响，限流触发分支仅走读 |
| 18 | 内存状态无全局配额，同用户可无限 `room:create` 刷内存 | 人工自查 | [ ] 已知取舍 | 房间对象很小，小规模场景影响有限；开放给不特定公众前需补"每用户房间数/总房间数"上限 |
| 19 | Socket 事件 payload 无显式大小限制 | 人工自查 | [ ] 已知取舍 | Socket.io 默认 1MB `maxHttpBufferSize` 已是兜底；观察到滥用再收紧 |

### Phase 3（2026-09-24，人工自查：画板高频输入）

| # | 问题 | 来源 | 状态 | 备注 |
|---|---|---|---|---|
| 20 | `canvas:strokeProgress` 无 ack/限流，恶意客户端可高频广播刷带宽 | 人工自查 | [ ] 已知取舍 | 落地类动作受 1MB 上限和逐次校验约束；该事件只转发不落日志、开销小；观察到滥用再加"每 socket 每秒 N 次"节流 |
| 21 | 画板事件"房间内任意人可画/撤销/清空" | 人工自查 | [x] | Phase 4 `requireCanDraw`（13.4）收紧为仅当前作画者；Phase 5 收紧为仅本回合轮到你的链（14.5）；测试页行为不变 |

### Phase 4（2026-09-26 补登：合并前漏做了安全审查登记，Phase 5 开工前补上）

| # | 问题 | 来源 | 状态 | 备注 |
|---|---|---|---|---|
| 22 | `game:chat` 无限流，可刷屏 | 人工自查 | [ ] 已知取舍 | 同 #20；聊天经 Vue 插值渲染，全项目无 `v-html`，无 XSS，仅缺防刷屏 |
| 23 | 自定义出题词无敏感词过滤 | 人工自查 | [ ] 已知取舍 | 13.2 节已写明一期不做；属内容审核范畴，无权限/越权含义 |
| 24 | 私发事件（`game:wordChoices`/`wordRevealed`）是否误走房间广播 | 人工走读 + 自检脚本 | [x] | 逐条核对 `emitToUser` 调用无泄露；脚本验证非作画者收不到候选词/谜底 |

### Phase 5（2026-09-26，人工自查：一房间多画板、全员同时行动）

| # | 问题 | 来源 | 状态 | 备注 |
|---|---|---|---|---|
| 25 | `chain:*` 回合内事件无限流 | 人工自查 | [ ] 已知取舍 | 同 #20/#22；状态机校验完备，重复选词/提交/投票均已验证被拒 |
| 26 | 多画板复合 key 下能否跨链读写他人画板 | 人工自查 + 脚本 | [x] | `canDraw` 严格按轮转公式校验；脚本验证非当前人画别人的链被 `NOT_YOUR_TURN` 拒绝；`canvas:getState` 只读沿用房间成员可读 |
| 27 | 评审投票"可投票人"范围被绕过可自投操纵分数 | 人工自查 + 脚本 | [x] | `castVote` 校验 `eligibleVoters`，开票时固定，链参与者不在其中；非 eligible 投票被 `NOT_ELIGIBLE_VOTER` 拒绝 |
| 28 | "不暂停倒计时"的断线处理会否被用来故意断线躲避猜词 | 人工自查 | [ ] 已知取舍，非疏漏 | 效果等同超时不猜（记 `guessWord:null`），不会更易得分，无操纵空间 |

### Phase 6（2026-09-27，人工自查 + 脚本：查他人数据、持久化用户内容）

| # | 问题 | 来源 | 状态 | 备注 |
|---|---|---|---|---|
| 29 | `GET /api/records/drawings/:id` 按主键查询可能越权遍历 | 人工自查 + 脚本 | [x] | 应用层比对 `row.userId === req.user.id`，非本人与不存在统一 404；脚本验证 |
| 30 | `drawings.stroke_data` 无大小上限 | 人工自查 | [ ] 已知取舍 | 笔迹产生时已受 `MAX_POINTS` 约束；面向公众开放前需重评估 |
| 31 | 排行榜向任意登录用户暴露所有人 `username` + 总分 | 人工自查 | [x] 预期设计 | 用户名在游戏内本就公开；接口未带房间号等可推断"和谁玩过"的字段 |

### Phase 7（2026-09-27，部署脚本会把服务暴露到局域网/公网 + 实机交叉审查）

| # | 问题 | 来源 | 状态 | 备注 |
|---|---|---|---|---|
| 32 | `FRONTEND_DIST_PATH` 配置不当可能经 `express.static` 暴露 `backend/.env` | 人工自查 | [x] | 仅当该目录下存在 `index.html` 才挂载；脚本固定传 `frontend/dist`；提醒部署者勿指向敏感目录 |
| 33 | `start.sh` 打印局域网 IP，局域网内任何人可访问首页 | 人工自查 | [ ] 已知取舍 | "局域网可访问"即需求本身；加入具体房间仍需邀请码（#17）；不可信网络需部署者用防火墙限来源 |
| 34 | 生产 CSP 是否挡住单端口托管的前端产物 | 人工自查 + curl | [x] | `script-src 'self'` 不挡外链模块脚本；`style-src` 允许 `'unsafe-inline'`（Vue scoped style）。仅测了 `localhost`，局域网 IP 下的问题见 #35 |
| 35 | CSP 默认的 `upgrade-insecure-requests` 使局域网 IP 访问时资源被升级成 https，页面白屏（loopback 豁免故 localhost 测不出） | Deepseek（Windows + 局域网 IP 实测） | [x] | `helmet()` 显式去掉该指令；项目本就无内置 HTTPS，放到 HTTPS 反代后无影响 |
| 36 | `start.sh` 仅"提醒"改 `NODE_ENV`/`JWT_SECRET`，照抄 `.env.example` 会得到默认密钥的局域网服务 | Deepseek | [x] | 启动前强制检查 `backend/.env`，不满足 `exit 1` 并指出缺什么；已验证 |
| 37 | 同浏览器换账号后 socket 沿用旧身份（`socket.user` 仅握手时算一次） | Deepseek（中危） | [ ] 已修复，待验证 | `stores/auth.js` 登录/注册/登出调用 `reconnectSocket()`（同一 Socket 对象 `disconnect()`+`connect()`，保留已绑定的监听器）。**仅走读，无自动化测试**，按规范不打勾；实机验证步骤见 `ISSUES.md` |
| 38 | `GET /api/rooms/public`、`GET /api/wordbanks` 未鉴权 | Deepseek 报告 | [ ] 待评估 | 未逐条复核；不含邀请码，无越权后果。详见 `ISSUES.md` |
| 39 | `canvas:strokeProgress` 校验过宽（不限 width 1~64、x/y ∈ [0,1]），可发畸形值让他人渲染异常 | Deepseek 报告 | [ ] 待评估 | 未逐条复核；与 #20 相关。详见 `ISSUES.md` |
| 40 | `utils/rateLimit.js` 的桶 Map 永不清理 | Deepseek 报告 | [ ] 待评估 | 未逐条复核；上限为注册用户数，极低危 |
| 41 | 反向代理下限流按代理 IP 失真（`TRUST_PROXY` 默认 false） | Deepseek 报告 | [ ] 待评估 | `.env.example` 已提示；建议进部署清单 |
| 42 | `records` 查询接口无限流（排行榜为全表聚合） | Deepseek 报告 | [ ] 待评估 | 未逐条复核；需登录，本地部署低危 |

---

## 11. 房间系统协议（Phase 2）

本节先落协议再写代码（`Agents.md` 第2条）。房间/玩家状态一律纯内存（`rooms` Map，见第6.2节），不做持久化；只有已登录用户（`socket.user` 非空）能创建/加入房间。

### 11.1 房间数据结构（内存）

```js
{
  id: 'uuid',                 // 房间内部 id，公开列表/URL 用这个
  inviteCode: 'A1B2C3',       // 6 位大写字母+数字邀请码，仅私人房间加入时使用，不在公开列表接口里返回
  mode: 'guess' | 'chain',
  isPublic: false,
  status: 'waiting',          // Phase 2 只有 waiting 一种状态，对局状态从 Phase 4/5 开始出现
  hostUserId: 1,
  players: [
    { userId: 1, username: 'foo', socketId: 'xxx', isHost: true, connected: true, joinedAt: 1700000000000 }
  ],
  settings: { ... },          // 见 11.2，按 mode 区分字段
  createdAt: 1700000000000
}
```

- `players` 顺序即加入顺序；房主 (`isHost`) 离开、或断线超过宽限期后被正式移出时，顺延给下一位玩家（`players` 数组里的下一位）；房主仅仅是短暂断线（宽限期内）不会立刻交出房主身份。
- 同一个 `userId` 同时只能在一个房间里；创建/加入新房间前，服务器会自动把该用户从旧房间移除（相当于隐式 leave）。
- **断线重连（60 秒宽限期）**：socket `disconnect` 时不会立刻把玩家移出房间，而是把该玩家标记为 `connected:false` 并广播 `room:playerDisconnected`，同时启动 60 秒倒计时（`DISCONNECT_GRACE_MS`，房间人数上限计算时仍占着这个位置，不会被顶掉）。
  - 60 秒内如果同一个 `userId`（已登录用户，鉴权靠 httpOnly cookie）重新建立 socket 连接，服务器会自动把新连接重新 `join` 进原房间 channel，标记 `connected:true`，广播 `room:playerReconnected`，**不需要客户端重新走加入流程**。
  - 超过 60 秒仍未重连，服务器正式把玩家移出房间（房主顺延/房间清空逻辑同主动 `room:leave`），广播 `room:playerLeft`（`reason:'timeout'`）；此后必须重新用邀请码/公开列表加入。
  - 主动调用 `room:leave` 是"立即离开"，不走宽限期，和断线重连是两条不同路径。
- `room:getCurrent` 用于客户端兜底同步当前房间状态（比如 SPA 内部路由跳转到房间大厅页时用它拉一次最新状态）。

### 11.2 房间设置字段（对应 FULLREADME 第4节）

**通用字段**（两种模式都有）：

| 字段 | 类型 | 范围 |
|---|---|---|
| `maxPlayers` | number | 竞猜 2~32，接龙 4~32 |
| `specialEffect` | `'none'\|'invisible'\|'gravity'\|'pixelArt'` | 一期只允许 `'none'`，其余三个服务器直接拒绝（对应前端"选项禁用，仅占位"） |
| `pixelGranularity` | number，仅 `specialEffect==='pixelArt'` 时有意义 | 一期恒为 `null`，字段先留着 |
| `brushMode` | `'fixed'\|'adjustable'` | — |
| `colorMode` | `'rgb'\|'mono'` | — |
| `drawSeconds` | number | 30 / 60 / 90 / 自定义 10~900 |
| `wordSource` | `'custom'\|'system'` | — |
| `wordCategory` | string，仅 `wordSource==='system'` 时必填 | 必须匹配 `wordbanks/` 目录下某个分类（见第7节，Phase 2 提供 `GET /api/wordbanks` 供前端下拉） |

**竞猜模式（`mode: 'guess'`）独有**：

| 字段 | 类型 | 范围 |
|---|---|---|
| `rounds` | number | 1~5 / 自定义 1~10，打几轮，每轮每人轮流画一次（第13.1节 `totalRounds`） |

接龙模式没有 `rounds`（用 `chainRounds`）；服务端只在 `mode==='guess'` 时校验并返回它。

**接龙模式（`mode: 'chain'`）独有**：

| 字段 | 类型 | 范围 |
|---|---|---|
| `guessSeconds` | number | 30 / 60 / 自定义 10~300 |
| `chainRounds` | number | 1~7，默认 3 |
| `anonymousVoting` | boolean | 开启后只隐藏投票人身份，结果依然公开（14.6） |
| `showDrawingProcess` | boolean | 结算评审（14.6）是否展示每步画作；关闭时 `chain:reviewChain` 里画步骤的 `actions` 服务端直接不下发，前端只显示猜词文字。`session` 内的 `actions` 不受影响（Phase 6 落库仍用） |

服务器对以上范围做硬校验，超出范围直接拒绝（`INVALID_SETTINGS`），不做静默 clamp。

### 11.3 REST 接口

- `GET /api/wordbanks` → `{ categories: [{ id, name, wordCount }] }`，读取 `backend/wordbanks/*.txt`，`id`/`name` 都用文件名（不含扩展名）。
- `GET /api/rooms/public?mode=guess|chain`（`mode` 可选）→ `{ rooms: [{ id, mode, hostUsername, playerCount, maxPlayers, createdAt }] }`，只列 `isPublic:true && status:'waiting'` 的房间，**不返回 `inviteCode`**。

### 11.4 Socket.io 房间事件

事件名统一 `room:` 前缀，客户端 → 服务端的事件都带 ack 回调，返回 `{ ok: true, ...data }` 或 `{ ok: false, error, message }`（`error` 取值如 `NOT_AUTHENTICATED` / `INVALID_SETTINGS` / `ROOM_NOT_FOUND` / `ROOM_FULL` / `INVALID_INVITE_CODE` / `NOT_HOST` / `TOO_MANY_ATTEMPTS`）。

`room:joinByCode` 有限流：同一登录用户每分钟最多尝试 20 次，超过返回 `TOO_MANY_ATTEMPTS`（见第10节 Phase 2 安全审查 #1，防止暴力猜邀请码）。

**客户端 → 服务端**

| 事件 | payload | 说明 |
|---|---|---|
| `room:create` | `{ mode, isPublic, settings }` | 成功返回 `{ ok:true, room }`，发起者自动成为房主并加入 |
| `room:joinByCode` | `{ inviteCode }` | 私人/公开房间都可以用邀请码加入 |
| `room:joinPublic` | `{ roomId }` | 从公开列表加入，房间必须 `isPublic:true` |
| `room:leave` | 无 | 退出当前房间；房主退出触发房主顺延，房间空了直接销毁 |
| `room:updateSettings` | `{ settings }` | 仅房主可调用，全量替换 `settings`（沿用当前 `mode`），校验规则同创建 |
| `room:setPublic` | `{ isPublic }` | 仅房主可调用，切换公开/私人 |
| `room:getCurrent` | 无 | 查询当前用户所在房间的完整状态，用于刷新页面后自愈；不在任何房间时返回 `{ ok:true, room:null }` |

**服务端 → 客户端**（广播到 `room:<roomId>` channel）

| 事件 | payload | 触发时机 |
|---|---|---|
| `room:playerJoined` | `{ player }` | 有新玩家加入 |
| `room:playerDisconnected` | `{ userId, reconnectTimeoutMs }` | 玩家断线，进入 60 秒重连宽限期（仍占着房间位置） |
| `room:playerReconnected` | `{ userId }` | 宽限期内重新连接成功 |
| `room:playerLeft` | `{ userId, newHostUserId, reason? }` | 玩家主动离开，或宽限期超时被正式移出；`newHostUserId` 仅房主变更时非空，`reason:'timeout'` 标记是超时移出而非主动离开 |
| `room:settingsUpdated` | `{ settings }` | 房主修改设置 |
| `room:visibilityUpdated` | `{ isPublic }` | 房主切换公开/私人 |
| `room:closed` | `{ reason: 'empty' }` | 最后一名玩家离开/超时移出，房间销毁 |

前端对应页面（第3节）：创建房间-模式选择页 → 创建房间-参数设置页（调用 `room:create`）→ 房间大厅页（订阅上述广播事件，房主可再次打开设置面板调用 `room:updateSettings`/`room:setPublic`）；加入房间-私人（`room:joinByCode`）/ 加入房间-公开（先 `GET /api/rooms/public` 拉列表，选中后 `room:joinPublic`）。

---

## 12. 画板引擎协议（Phase 3）

**范围说明**：本节只定义画板引擎本身（工具栏、矢量协议、多端同步、撤销/重做/清空），不含"谁能画"的游戏规则——对局中的作画权限由 13.4（竞猜）/14.5（接龙）在本协议之上追加校验，不改这里的事件形状；无对局时（如 `/room/:id/canvas-test` 测试页）房间内任意在线玩家都可画。正式游戏页复用这里的 `CanvasBoard.vue` 与 `useCanvas()`。

### 12.1 设计原则

- 画板状态按**动作日志（action log）**存储，不是最终位图，呼应 README"画板与回放"一节。一个房间的画板状态 = 对这个日志做一次"折叠"（fold）算出来的当前可见动作集合。
- 坐标沿用第2节已定的 0~1 归一化比例。
- 撤销/重做是**按玩家**维度的：每个玩家只能撤销/重做自己做过的动作，不会撤到别人的笔迹。
- 清空（`canvas:clear`）是全局性的硬重置，**不可撤销**，且会清空所有玩家的撤销/重做栈（避免清空后还能"重做"出清空前的笔迹）。
- 复合工具语义：
  - `brush`（画笔）/ `eraser`（橡皮）都产出一个 `stroke` 动作，仅 `tool` 字段不同；渲染时 `eraser` 用 `destination-out` 合成模式做真正的像素擦除，而不是"画一条背景色的笔迹"（避免以后换背景/主题时露馅）。
  - `bucket`（油漆桶/取色区域）产出一个 `fill` 动作（一个点 + 颜色），客户端用泛洪填充算法在自己的画布位图上执行，服务端只存这个"意图"，不算像素。
  - `lineEraser`（线擦）**不产出可见笔迹**，而是"擦除整条笔迹"的动作：客户端拖动线擦时在本地做命中检测（碰到哪条已渲染的 `stroke`/`fill` 就整条擦掉），每命中一条就单独提交一次 `canvas:eraseStroke`，服务端记一条 `lineErase` 动作，指向被擦的目标动作 id。这样每条线擦都能被单独撤销/重做（撤销线擦 = 让被擦的那条笔迹重新出现）。
  - 取色器（拾取画布上的颜色）、RGB 调色、画笔粗细都是纯前端 UI 状态（决定"下一笔用什么颜色/粗细"），不产生协议事件。
- 动作可见性规则（客户端和服务端用同一套规则渲染/计算）：设 `lastClearIndex` 为日志里最后一条 `clear` 动作的位置（没有则为 -1）；在这之后的动作里，一个 `stroke`/`fill` 动作可见当且仅当：①没有被它自己的所有者撤销（`tombstoned:false`）；②没有被任何未撤销的 `lineErase` 动作指向（`erasedBy:null`）。`lineErase` 动作本身从不渲染，只参与"隐藏目标动作"的计算。

### 12.2 动作（action）数据结构

```js
// stroke：画笔/橡皮
{
  id: 'uuid', type: 'stroke', playerId: 1, tool: 'brush' | 'eraser',
  color: '#RRGGBB', width: 4, points: [{ x: 0.12, y: 0.34, t: 1234 }, ...],
  tombstoned: false, erasedBy: null, createdAt: 1700000000000
}
// fill：油漆桶
{
  id: 'uuid', type: 'fill', playerId: 1,
  color: '#RRGGBB', point: { x: 0.5, y: 0.5 },
  tombstoned: false, erasedBy: null, createdAt: 1700000000000
}
// lineErase：线擦（指向被擦的目标动作，自己不渲染）
{
  id: 'uuid', type: 'lineErase', playerId: 1, targetActionId: 'uuid-of-stroke-or-fill',
  tombstoned: false, createdAt: 1700000000000
}
// clear：清空（全局，不可撤销）
{ id: 'uuid', type: 'clear', playerId: 1, createdAt: 1700000000000 }
```

服务端内存结构（`backend/src/canvas/store.js`，独立于 `rooms` store，靠 `roomId` 关联，房间销毁时一并清理）：

```js
canvasSessions: Map<roomId, {
  actions: [...],                    // 追加写入的完整日志，只在 clear 时"逻辑截断"（靠 lastClearIndex 计算，不物理删除，为回放留口子）
  actionIndex: Map<actionId, action>,
  undoStacks: Map<userId, [actionId, ...]>,   // 该用户当前"可撤销"的动作 id，LIFO
  redoStacks: Map<userId, [actionId, ...]>,   // 该用户当前"可重做"的动作 id，LIFO
}>
```

### 12.3 Socket.io 事件

事件名统一 `canvas:` 前缀，走已有的 `room:<roomId>` channel（不单独开 socket 房间）。所有客户端→服务端事件都要求 `socket.user` 非空且是该房间当前玩家（否则 `NOT_AUTHENTICATED` / `NOT_IN_ROOM`），带 ack 回调，返回 `{ ok:true, ...data }` 或 `{ ok:false, error, message }`。

**客户端 → 服务端**

| 事件 | payload | 说明 |
|---|---|---|
| `canvas:getState` | 无 | 返回 `{ ok:true, actions }`：当前房间"折叠"后的可渲染动作列表（按第12.1节可见性规则过滤，只含 `stroke`/`fill`），用于首次进入/刷新页面时整幅重绘 |
| `canvas:strokeProgress` | `{ tempId, tool, color, width, points }` | **无 ack**，实时广播（不落日志），供其他客户端画"正在画的这一笔"的实时预览 |
| `canvas:strokeEnd` | `{ tempId, tool, color, width, points }` | 落一条 `stroke` 动作；`tool` 只允许 `'brush'\|'eraser'`；成功后广播 `canvas:actionAdded` |
| `canvas:fill` | `{ point, color }` | 落一条 `fill` 动作；成功后广播 `canvas:actionAdded` |
| `canvas:eraseStroke` | `{ targetActionId }` | 落一条 `lineErase` 动作；目标必须存在、类型是 `stroke`/`fill`、当前可见（未撤销且未被擦过），否则 `ACTION_NOT_ERASABLE`；成功后广播 `canvas:strokeErased` |
| `canvas:undo` | 无 | 弹出该玩家撤销栈顶，标记 `tombstoned:true`（若目标是 `lineErase`，等价于恢复被它擦掉的那条笔迹）；栈空则 `{ ok:true, noop:true }`；成功后广播 `canvas:actionUndone` |
| `canvas:redo` | 无 | 弹出该玩家重做栈顶，标记 `tombstoned:false`；栈空则 `{ ok:true, noop:true }`；成功后广播 `canvas:actionRedone` |
| `canvas:clear` | 无 | 追加一条 `clear` 动作，清空所有玩家的撤销/重做栈；成功后广播 `canvas:cleared` |

校验规则：`color` 必须匹配 `#RRGGBB`；`width` 必须是 1~64 的数字；单条 `points` 数组长度上限 2000（超出直接拒绝，`INVALID_STROKE`，一笔正常不可能画出 2000 个点，这个上限只是兜底）；`points` 里每个点的 `x`/`y` 必须在 `[0,1]`、`t` 必须是数字。不合法直接拒绝，不做静默裁剪（沿用 Phase 2 "校验失败就拒绝"的一贯风格）。

**服务端 → 客户端**（广播到 `room:<roomId>`）

| 事件 | payload | 触发时机 |
|---|---|---|
| `canvas:strokeProgress` | `{ fromUserId, tempId, tool, color, width, points }` | 转发其他玩家的实时画笔预览（不含发送者自己） |
| `canvas:actionAdded` | `{ action }` | 新的 `stroke`/`fill` 落地（含发送者自己，用完整版替换本地的实时预览） |
| `canvas:strokeErased` | `{ targetActionId, eraseActionId, playerId }` | 线擦命中一条笔迹 |
| `canvas:actionUndone` | `{ actionId, type, targetActionId? }` | 撤销；`type==='lineErase'` 时 `targetActionId` 是重新出现的那条笔迹 id |
| `canvas:actionRedone` | `{ actionId, type, targetActionId? }` | 重做 |
| `canvas:cleared` | `{ roomId, chainOwnerId }`（竞猜/测试页 `chainOwnerId` 为 `null`）；前端据此判断是否是当前正在看的画板，缺 `roomId` 会被丢弃 | 清空（含竞猜每回合开始时的自动清空） |

### 12.4 已知限制（记入第10节安全问题跟踪表 #20）

- 线擦只能擦 `stroke`/`fill`，不能擦另一条 `lineErase`（没有"擦除擦除动作"的需求）。
- 客户端渲染策略是"整幅重绘"（每次收到会改变可见集合的事件就用 `actions` 全量重画一次画布），不做局部脏矩形优化——本地部署/小规模场景下笔迹总量有限，这个简化换取实现正确性，若以后发现性能问题再优化。
- `canvas:strokeProgress` 的实时预览事件量没有额外节流/采样，纯靠客户端 `pointermove` 的原生触发频率；如果以后出现高频画笔导致带宽问题，可以在客户端加时间/距离阈值采样。

---

## 13. 竞猜模式完整玩法协议（Phase 4）

**范围说明**：本节把第5.1节的竞猜模式流程落成具体协议。房间大厅页（Phase 2）新增"开始游戏"入口（仅房主、且房间 `mode==='guess'`、`status==='waiting'`、人数 ≥2 时可用）；对局状态挂在 `room.status`（`'waiting' -> 'playing' -> 'waiting'`），对局本身的回合/计分等细节状态**纯内存**，独立于 `rooms/store.js`（类比 `canvas/store.js` 的做法），靠 `roomId` 关联，房间销毁或对局结束时清理。

### 13.1 对局数据结构（内存，`backend/src/game/store.js`）

```js
games: Map<roomId, {
  mode: 'guess',
  turnOrder: [userId, ...],       // 开始游戏那一刻的玩家加入顺序快照，本局固定不变
  round: 1,                        // 当前第几轮（1-based），总轮数 = room.settings.rounds
  turnIndex: 0,                    // 当前轮里，轮到 turnOrder 里第几位作画
  drawerId: userId,
  phase: 'choosingWord' | 'drawing',
  wordCandidates: ['词1','词2','词3'] | null,  // 仅 wordSource==='system' 时有值，只服务端持有
  word: '当前谜底' | null,          // 只服务端持有；choosingWord 阶段为 null
  turnDeadline: 1700000000000 | null, // drawing 阶段的绘画截止时间戳；choosingWord 阶段为选词截止时间戳
  correctGuessers: [{ userId, rank, score }],  // 本回合已猜中的玩家，按猜中顺序
  scores: Map<userId, number>,      // 累计得分，跨回合累加
  timers: { phaseTimer },           // Node setTimeout 句柄，不对外暴露
}>
```

- `turnOrder` 只在开始游戏时快照一次；之后中途加入的玩家（理论上房间 `status:'playing'` 时新玩家不能加入，见13.6节）不会被塞进本局轮次，只有下一局重新开始才会用最新玩家列表。
- 选词候选/谜底**只服务端持有 + 只发给作画者**，其余玩家收到的是"字数提示"（见13.3节），避免通过协议 payload 泄题。

### 13.2 词库来源与选词

- `wordSource==='system'`：沿用 `backend/src/wordbanks/index.js` 的 `pickWords(category, 3)` 抽 3 个候选词给作画者选；`wordSource==='custom'`：跳过候选环节，作画者直接输入自定义词（服务端只做"非空、去首尾空格、长度 1~20"的基本校验，不做敏感词过滤——一期没有这个要求，不在这个 Phase 加）。
- `choosingWord` 阶段有超时（固定 20 秒，不在房间设置项里，属于"选词"这个环节本身的兜底，不是"绘画时间"）：作画者超时未选词/未输入，服务端**自动**从候选里随机选一个（`custom` 模式超时则强制跳过本回合，直接进入下一位，记 0 分，因为没有词就没法进入绘画阶段）。

### 13.3 字数提示（解决第8节遗留问题）

非作画者收到的 `game:turnStarted` 不含 `word`，只有 `wordLength`（谜底的字符数，中文按字符数不按拼音）；前端按 `wordLength` 渲染成等量占位符（比如"＿ ＿ ＿"），不做"提前展示部分汉字"之类的渐进提示——一期只做这个最简单的形式，更复杂的提示策略留到以后有需要再加。

### 13.4 画板权限收紧（解决 Phase 3 遗留的开放假设，第10节 #21）

`backend/src/socket/canvas.js` 里所有会改变画板状态的事件（`strokeEnd`/`fill`/`eraseStroke`/`undo`/`redo`/`clear`）新增一层校验：如果该房间当前有进行中的 Phase 4 对局（`games` 里存在这个 `roomId` 且 `phase==='drawing'`），只有 `socket.user.id === game.drawerId` 才允许操作，其他人一律 `NOT_YOUR_TURN`。`choosingWord` 阶段（还没进入绘画）画板保持锁定（谁都不能画，包括作画者本人——词还没选定）。房间没有进行中对局时（`status:'waiting'`，比如还在 `/room/:id/canvas-test` 测试页玩），行为不变，沿用 Phase 3"任意在线玩家可画"的规则——测试页不受这层限制影响。

### 13.5 计分规则（细化第5.1节"按回答顺序递减加分"）

规则文档只给了方向性描述（"越早猜对分越高，最后阶段只有参与分，猜不中不加分"），没有给具体公式，本 Phase 按此拍板一版：

- 设本回合"猜题方"人数（除作画者外的在场玩家数）为 `N`，某玩家是第 `rank`（1-based）个猜中的：得分 `= max(20, 100 - (rank - 1) * 15)`，即第1名100分，第2名85分，依次递减，最低封顶在20分（"最后阶段只有参与分"）。
- 猜不中（回合结束时仍未猜中）：0 分。
- **作画者得分**（原文档未规定，设计假设，见 `HISTORY.md`）：`10 × 本回合猜中人数`，以猜中人数作为"画得好不好"的代理指标。
- 所有回合结束后，按累计得分从高到低排名，出现平分时按 `userId` 稳定排序（不做特殊并列名次逻辑，一期不需要）。

### 13.6 断线处理（解决第8节遗留问题）

对局中的断线沿用房间层已有的 60 秒宽限期机制（第11.1节），不单独做一套：

- **作画者断线**：`socket:disconnect` 触发房间层 `room:playerDisconnected` 的同时，游戏层暂停当前回合的绘画倒计时（`turnDeadline` 顺延，暂停时长 = 断线时长，不让"画到一半掉线"白白吃掉画画时间）；60 秒内重连则倒计时恢复、画板状态本来就在服务端画板日志里不会丢；超过 60 秒被房间层正式移出，游戏层监听到"玩家被移出"事件后，把当前回合直接判定结束（本回合无人得分，含作画者），跳到下一位作画者继续（`turnOrder` 里把这个 `userId` 摘掉，不影响后续轮次）。
- **猜题方断线**：不影响当前回合进行，其他人继续猜/计时不受影响；60 秒内重连可以继续参与本回合剩余时间的竞猜；超时被正式移出的话，游戏层把它从 `turnOrder` 里摘掉（不影响它是否作过画——已经算过的分数保留在 `scores` 里，只是后续轮次不会再排到它）。
- **房间在对局进行中被销毁**（比如就剩最后一人也退出了）：游戏层 `games` 状态跟 `rooms`/`canvas` 一样清理掉，不做特殊处理。
- **对局进行中不允许新玩家加入**：`room:joinByCode`/`room:joinPublic` 在 `room.status==='playing'` 时直接拒绝（`ROOM_NOT_FOUND`，复用"房间不可加入"的错误码，不新开一个错误类型），文案提示"对局进行中，暂不可加入"。`room:joinPublic` 从 Phase 2 起就已经显式检查 `status==='waiting'`；`room:joinByCode` 之前没查（邀请码加入不经过公开列表筛选），这个 Phase 补上这一条检查。

### 13.7 Socket.io 事件

事件名统一 `game:` 前缀，走已有的 `room:<roomId>` channel。除标注"无 ack"外都要求 `socket.user` 非空且是该房间当前玩家，带 ack 回调，返回 `{ ok:true, ...data }` 或 `{ ok:false, error, message }`（新增错误码：`NOT_HOST`/`GAME_ALREADY_RUNNING`/`NOT_ENOUGH_PLAYERS`/`NO_ACTIVE_GAME`/`NOT_YOUR_TURN`/`ALREADY_GUESSED_CORRECTLY`/`INVALID_WORD`）。

**客户端 → 服务端**

| 事件 | payload | 说明 |
|---|---|---|
| `game:start` | 无 | 仅房主；`room.status` 须为 `'waiting'`、`mode==='guess'`、玩家数 ≥2；成功后 `room.status='playing'`，广播 `game:started` |
| `game:chooseWord` | `{ word }` | 仅当前作画者、仅 `phase==='choosingWord'`；`wordSource==='system'` 时 `word` 必须在本回合候选里，`custom` 时接受任意 1~20 字符的词 |
| `game:chat` | `{ text }` | 聊天 + 猜词共用；服务端判断：作画者/已猜中玩家发送 → 正常按聊天广播（已猜中玩家发送会被拒绝，见下）；其余人发送则比对谜底，猜中广播 `game:correctGuess`（不广播原文，防剧透），猜不中按普通聊天广播 |
| `game:getState` | 无 | 断线重连/刷新页面兜底同步：返回当前对局完整状态（作画者本人额外带 `word`/`wordCandidates`，其他人不带） |

**服务端 → 客户端**（广播到 `room:<roomId>`，除标注外都含全部字段给所有人；"仅作画者"的字段通过 `socket.emit` 单独私发给作画者的 socket，不走房间广播）

| 事件 | payload | 触发时机 |
|---|---|---|
| `game:started` | `{ turnOrder, round, totalRounds }` | `game:start` 成功，所有客户端据此跳转到游戏内页面 |
| `game:turnStarted` | 广播：`{ drawerId, round, totalRounds, phase:'choosingWord', deadline }`；仅作画者私发额外一条 `game:wordChoices`：`{ candidates }`（`wordSource==='custom'` 时不发这条，作画者前端改成显示输入框） | 每个新回合开始，进入选词阶段 |
| `game:wordChosen` | 广播：`{ wordLength, deadline }`（`deadline` 是绘画阶段截止时间）；仅作画者私发一条 `game:wordRevealed`：`{ word }` | 作画者选完词（或超时自动选），画板解锁，进入 `drawing` 阶段 |
| `game:chatMessage` | `{ userId, text }` | 普通聊天（含作画者的话、已用完机会的猜测），原样广播 |
| `game:correctGuess` | `{ userId, rank, score }` | 有人猜中（不含词本身） |
| `game:turnEnded` | `{ drawerId, word, correctGuessers: [{userId, rank, score}], drawerScore, scores }` | 绘画倒计时到/所有人猜中/作画者断线超时；`word` 这时候才公开给所有人；`scores` 是更新后的累计分 |
| `game:ended` | `{ scores, ranking: [{userId, score, rank}] }` | 最后一轮最后一个回合结束；`room.status` 同时改回 `'waiting'` |
| `room:statusUpdated` | `{ status }` | `room.status` 变化时广播（`'waiting'->'playing'` 开始游戏、`'playing'->'waiting'` 对局结束），房间大厅页/公开列表相关 UI 据此同步，不复用 `room:settingsUpdated`（那个事件语义是"设置变了"，状态变化是另一回事，混用会让前端难判断到底该刷新哪部分） |
| `game:timerResumed` | `{ deadline }` | 作画者断线宽限期内重连，暂停的回合倒计时恢复，广播新的 `deadline` 供客户端倒计时组件重新对齐 |

### 13.8 页面（对应第3节第7、8项）

- `frontend/src/pages/GuessGame.vue`：正式游戏内页面，路由 `/room/:id/game`，直接复用 `CanvasBoard.vue`（作画者可画，非作画者组件仍挂载但因13.4节的服务端权限校验，画的动作会被拒绝——前端另外用 `isMyTurn` 隐藏/禁用非作画者的工具栏，双重保险，不是只靠前端隐藏）。布局按第5.1节：中间题目+倒计时、左侧工具栏、右侧玩家列表+分数、下方聊天/猜词输入框共用、最下方撤回/重做/清空。
- 结算展示直接做成 `GuessGame.vue` 内的一个状态切换（收到 `game:ended` 后切到结算视图），不单独拆一个路由页面——排名表 + "返回房间"按钮（点击后 `router.push` 回 `/room/:id`）。
- `RoomLobby.vue` 补一个"开始游戏"按钮（仅房主、`mode==='guess'`、`status==='waiting'` 时可见）；所有房间成员收到 `game:started` 广播后自动跳转到 `/room/:id/game`（在 `stores/room.js` 里订阅这个事件做跳转，不需要每个页面单独订阅）。

---

## 14. 接龙模式完整玩法协议（Phase 5）

**范围说明**：本节把第5.2节的接龙模式流程落成具体协议，架构上尽量复用 Phase 4 的模式（独立的 `chain/store.js` + `chain/engine.js`，`engine.js` 持有 `io`，理由同13节顶部），但接龙模式和竞猜模式有一个根本性的结构差异需要先说清楚：**竞猜模式任意时刻只有一个人在画（其余人在猜），接龙模式任意时刻是所有人同时在各自的一条链上行动**（要么同时在画各自的题，要么同时在猜"上一位传过来的画"）。因此画板要拆成"一房间多块"（14.5）、回合按"全员完成"推进（14.4）、断线不能照搬"暂停单个倒计时"（14.7）。

### 14.1 对局数据结构（内存，`backend/src/chain/store.js`）

```js
sessions: Map<roomId, {
  turnOrder: [userId, ...],   // 开始游戏那一刻的玩家加入顺序快照，本局固定不变（见14.7节）
  totalRings: number,          // room.settings.chainRounds（"环数"）
  totalTurns: totalRings * 2,  // 1 环 = 1 次画 + 1 次猜，见14.2节
  turn: 1,                     // 当前第几"半环"（1-based），奇数=画，偶数=猜
  phase: 'choosingWord' | 'drawing' | 'guessing' | 'reviewing' | 'ended',
  chains: Map<ownerId, {
    ownerId, ownerIndex,       // ownerIndex = 这条链的 owner 在 turnOrder 里的起始位置
    originalWord, wordCandidates, autoFail, currentDrawWord,
    steps: [{ turn, type:'draw'|'guess', by, word?, guessWord?, actions?, timedOut? }],
  }>,
  turnDeadline, doneUsers, chosenOwners, removedUserIds,
  scores: Map<userId, number>,
  review: { order, index, votes, eligibleVoters, voteDeadline },
  timers: { phaseTimer },
}>
```

- 每个玩家同时是"一条链的 owner"，`chains` 的 key 就是 `turnOrder` 里的每个 `userId`，一一对应，没有"旁观者"或者"没有自己链"的玩家。
- `doneUsers` 是"这一回合已经完成动作的人"的集合（绘画阶段=点了"提前完成作画"或被强制判定完成；猜词阶段=已提交猜测），用来判断"是否全员都已完成，可以提前结束这一步、不用等到超时"（见14.4节）。

### 14.2 回合轮转公式（解决第8节遗留问题）

以 `N` 个玩家为例，`chainRounds` 设置项（"环数"）记为 `K`，总回合数 `totalTurns = 2K`：**奇数回合画、偶数回合猜，交替进行**。第 `turn` 回合（1-based），负责某条链（owner 在 `turnOrder` 里的位置是 `ownerIndex`）的玩家是：

```
turnOrder[(ownerIndex + turn - 1) % N]
```

也就是说每条链每回合都往后传一位（`turnOrder` 里的下一位），`turn=1` 时这个公式正好算出 owner 自己（`ownerIndex+0`），所以"第1回合每个人画自己选的词"和"这条公式"是同一件事，不需要为 `turn=1` 单独写一条判断。这条公式是对第5.2节例子的形式化（环数换算总回合数、词在链间传递方式均为本设计的假设，已经用户确认沿用）。

选词只发生在 `turn===1`（每条链的 owner 给自己的链选起点词，见14.3节）；`turn>1` 的画不需要选词，直接把"上一步猜词的结果"当题目发给这一步的画者（`currentDrawWordFor` 函数：取链上最后一步——一定是一次"猜"——的 `guessWord`）。

### 14.3 选词与超时

- 系统出题（`wordSource==='system'`）：`turn===1` 时给**每条链的 owner 同时**发一条私有的候选词（复用 `wordbanks.pickWords`），各自独立选，不用等别人；超时（固定20秒，同13.2节的 `CHOOSE_WORD_TIMEOUT_MS`）自动从候选里随机选一个。
- 自定义出题（`wordSource==='custom'`）：owner 直接输入；超时没输入的链标记 `autoFail=true`（`originalWord` 保持 `null`），这条链从一开始就没有起点词，结算时（14.6节）直接判不通过，不进入投票（没有词就无法比对首尾）。
- `turn>1` 的画（拿"上一位猜的词"作画）不需要选词这一步，也没有超时的概念——那一步"要画什么"是确定的（上一步猜出的词，哪怕是 `null`，前端提示"对方没写猜测，自由发挥"）。

### 14.4 绘画/猜词阶段的"全员完成"推进（第14节顶部提到的结构性差异）

竞猜模式一个回合只有一个作画者，超时或这一个人操作完就结束回合；接龙模式一个回合是**全员同时**在各自的链上行动，因此"回合结束"的判定改成"全员都已完成 或 到达共享的 `turnDeadline`"（`chain/store.js` 的 `allDoneForTurn`），任何一个人晚交也不影响别人先交的部分：

- 绘画阶段：每个人可以点"提前完成作画"（`chain:finishDraw`）主动标记自己这一步已完成；也可以什么都不点，等 `drawSeconds` 超时被强制判定完成（画多少算多少，可能是空白）。
- 猜词阶段：提交猜测（`chain:submitGuess`）本身就是"完成"的标志，不需要单独的"完成"按钮；超时未提交记一条 `guessWord:null` 的猜测（`timedOut:true`），链条继续往下走，不会因为一个人没交就卡住整条链。
- 一旦全员都完成（或超时），立刻推进到下一步，不必等到 `turnDeadline`——这条在自检脚本里专门验证过（全员提前完成作画后应该在 5 秒内进入猜词阶段，不是傻等满 10 秒超时）。

### 14.5 画板：一个房间多块独立画板

接龙模式一个房间在绘画阶段同时有 `N` 块画板在被 `N` 个人分别画（各自的链），不能像竞猜模式那样直接用 `roomId` 当 `canvas/store.js` 的 key（那样所有人会画到同一块板上）。做法：

- `chain/store.js` 导出 `chainCanvasKey(roomId, chainOwnerId) = \`${roomId}::chain::${chainOwnerId}\`` 这个复合 key，`canvas/store.js` 本身**完全不改**——它的 key 只是个不透明字符串，多一层复合 key 对它来说无感知。
- `backend/src/socket/canvas.js` 的所有画板事件（`getState`/`strokeEnd`/`fill`/`eraseStroke`/`undo`/`redo`/`clear`/`strokeProgress`）新增可选的 `chainOwnerId` 字段：带了这个字段就用复合 key + 转去 `chain/store.js` 的 `canDraw`（这条链这一回合是不是轮到你画）；不带（竞猜模式、测试页）行为完全不变，两套逻辑互不影响，靠 `chainOwnerId` 是否存在分流，不是靠 `room.mode` 硬编码分支（这样以后要是有第三种模式也不用再改这个文件）。
- 广播事件（`canvas:actionAdded` 等）都带上 `chainOwnerId`（竞猜模式/测试页固定是 `null`），前端 `useCanvas.js` 按"当前 `enter()` 绑定的是哪个 `roomId`+`chainOwnerId`"过滤广播，避免别的链的动作（比如它被清空重置）误伤当前正在显示的这一块——因为同一个客户端在同一时刻只需要看一块画板（自己正在画的，或者正在看的别人那块），这个本地镜像继续保持模块级单例，没有为接龙模式改成"多实例"。
- 猜词阶段展示"要猜的画"：不额外把 `actions` 塞进 `chain:imageToGuess` 私聊事件里重复发一份，前端 `CanvasBoard` 会用 `canvas:getState` + 拿到的 `chainOwnerId` 自己去查，跟画者刚画完时服务端保留的画板状态是同一份数据源，不会出现"两份画面数据不一致"的问题。
- 每次开始新的一步"画"（`beginDrawPhase`），对应链的画板先 `clear()` 一次（同13.4节"每回合开始清空画板"的做法），保证这条链上一步残留的图不会串到这一步。

### 14.6 结算规则（细化第5.2节"评分环节"）

全部 `totalTurns` 回合跑完后，进入 `reviewing` 阶段，**按 `turnOrder` 顺序**（即每条链 owner 的加入顺序）依次公示每一条链，公示节奏：广播这条链完整的历史（起点词、每一步是谁画的/谁猜的、画面、最终是否一致）→ 停留 `REVIEW_DISPLAY_MS`（5秒，已一致的情况）或走一轮投票 → 下一条链。文档只给了方向性描述（"一致直接加分；不一致时其他玩家投票是否认可，半数以上同意则加分"），具体分数、"其他玩家"范围、多数阈值按下面这版：

- **参与者**：一条链的"参与者"= 这条链的 owner + 所有在这条链上画过/猜过的人（去重）。分数按参与者整体发放，不区分谁画得好谁猜得准——接龙本身是"整条链共同完成"这个概念，拆开算贡献没有意义。
- **完全一致**（最终猜出的词 === 起点词，字符串精确匹配）：参与者每人 **100 分**，不需要投票，直接公示结果。
- **起点词从一开始就是空的**（自定义出题超时没输入，`autoFail`）：直接判不通过，0 分，不进入投票——没有原始答案，投票也没有意义。
- **不一致但有原始答案**：进入投票，"其他玩家" = 房间里**排除这条链的参与者**之外、且当前在线（`connected`）的玩家；`anonymousVoting` 设置项决定广播 `chain:voteCast` 时带不带投票人身份和选择（[stated] 用户已确认"匿名投票"只是不显示是谁投的，票数本身仍然公开）；半数以上（**严格多数**，`赞成数 > 可投票人数/2`，比如2个可投票人里1票赞成不算通过，需要2票）同意：参与者每人 **60 分**；不同意或没人投票（超时 `REVIEW_VOTE_TIMEOUT_MS`=20秒，未投视为不赞成）：0 分。
- **没有人可以投票**（如这条链几乎覆盖所有人）：直接判不通过（已知取舍）。
- 全部链公示完后广播 `game:ended`（和竞猜模式共用同一个事件名/payload 形状：`{ scores, ranking }`），`room.status` 改回 `'waiting'`。

### 14.7 断线处理（第14节顶部提到的第二处结构性差异，解决第8节遗留问题）

竞猜模式"暂停唯一的倒计时"的做法在这里不成立：全员同时行动，为一个断线者暂停共享的 `turnDeadline` 会拖慢所有在线的人。规则：

- **不做计时器暂停/恢复**：断线的人这一步就是"没赶上"（画多少算多少/猜词记空），`turnDeadline` 该到点还是到点，不为任何人暂停——`onPlayerDisconnected`/`onPlayerReconnected` 这两个钩子因此是空实现（有意为之，不是遗漏，注释里写清楚了）。60 秒宽限期内重连、且回合还没结束的话，照样可以正常操作（服务端状态没丢）。
- **正式被移出房间**（超过60秒宽限期）：`turnOrder` 本身**不删除这个人、不重新编号**（不同于竞猜模式的 `turnOrder.splice`）——因为接龙模式的轮转公式（14.2节）是纯粹基于位置的模运算，中途改变数组长度会打乱所有还没轮到的链的分配；改成把这个 `userId` 记进 `removedUserIds` 集合，后续所有轮到他的步骤（不管是画还是猜）自动判定为"已完成"（空白/空猜测），不会卡住其他人，但轮转公式本身照旧不变。这是对"中途有人被移出"的简化处理，因为接龙轮转比竞猜的"单指针轮换"更依赖固定位置编号。
- 剩余在场人数低于 `MIN_PLAYERS_TO_CONTINUE`（2人，和竞猜模式取值一致）时直接提前结算（`endGame`），按已经产生的分数出排名。
- 房间在对局进行中被销毁：`chain/store.js` 的 session 和这局用到的所有链级画板（`chainCanvasKey` 复合 key）一起清理，不遗留。
- 对局进行中不允许新玩家加入：复用房间层已有的 `room.status==='playing'` 时拒绝加入的检查（13.6节），没有额外改动。

### 14.8 Socket.io 事件

事件名分两组：`game:start`/`game:getState` 是竞猜/接龙共用的"通用生命周期"事件，`backend/src/socket/game.js` 按 `room.mode` 分发到 `game/engine.js` 或 `chain/engine.js`；接龙模式独有的回合内事件用 `chain:` 前缀，单独在 `backend/src/socket/chain.js` 里处理。新增错误码：`NOT_ENOUGH_PLAYERS`（沿用竞猜模式的错误码名，含义是"接龙模式至少需要4人"）、`ALREADY_CHOSEN`、`ALREADY_SUBMITTED`、`NOT_ELIGIBLE_VOTER`、`ALREADY_VOTED`。

**客户端 → 服务端**

| 事件 | payload | 说明 |
|---|---|---|
| `game:start` | 无 | 仅房主；`room.status` 须为 `'waiting'`、`mode==='chain'`、玩家数 ≥4（第4.2节设置范围下限）；成功后广播 `game:started`（`{ mode:'chain', turnOrder, totalTurns }`） |
| `chain:chooseWord` | `{ word }` | 仅 `turn===1` 的 `choosingWord` 阶段；只能给**自己的链**选词，`wordSource==='system'` 时必须在候选里 |
| `chain:finishDraw` | 无 | 仅 `drawing` 阶段、且当前这一回合轮到你画；提前标记完成（见14.4节） |
| `chain:submitGuess` | `{ guess }` | 仅 `guessing` 阶段、且当前这一回合轮到你猜；1~20字符非空 |
| `chain:chat` | `{ text }` | 普通聊天（第5.2节），须有进行中对局，1~200 字；广播 `chain:chatMessage`（`{ userId, text }`），不含任何猜中判定（猜词走 `chain:submitGuess`） |
| `chain:vote` | `{ approve }` | 仅 `reviewing` 阶段、且你是当前正在公示的这条链的"可投票人"（14.6节） |
| `game:getState` | 无 | 断线重连/刷新页面兜底同步：返回当前对局状态（`phase`/`turn`/`scores`/我这回合负责的链和角色等，见 `chain/engine.js` 的 `getStateForUser`）。**已知简化**：重连时如果正处在 `reviewing` 阶段，只返回"第几条/共几条"的进度提示，不重放完整的历史播报，前端从下一条 `chain:reviewChain` 广播开始继续看——评审阶段完整状态重建复杂度较高，记为本 Phase 的简化，见 `HISTORY.md`。 |

画板相关事件（`canvas:*`）复用第12.3节的协议，多一个可选的 `chainOwnerId` 字段（见14.5节）。

**服务端 → 客户端**（广播到 `room:<roomId>`，除标注外都是广播；"仅当事人"的字段单独私发）

| 事件 | payload | 触发时机 |
|---|---|---|
| `game:started` | `{ mode:'chain', turnOrder, totalTurns }` | `game:start` 成功 |
| `chain:turnStarted` | `{ turn, totalTurns, phase, deadline, assignments? }`（`assignments` 是 `[{chainOwnerId, drawerId\|guesserId}]`，绘画/猜词阶段才有，谁负责哪条链是公开信息，不泄题） | 每个新回合/阶段开始 |
| `chain:wordChoices` | 私发给链的 owner：`{ candidates }` | `turn===1` 选词阶段开始，`wordSource==='system'` 时 |
| `chain:wordToDraw` | 私发给当前该画的人：`{ chainOwnerId, word, wordLength }` | 绘画阶段开始，`word` 可能是 `null`（上一步没人猜/猜了空） |
| `chain:imageToGuess` | 私发给当前该猜的人：`{ chainOwnerId }`（不带画面数据，见14.5节） | 猜词阶段开始 |
| `chain:chatMessage` | `{ userId, text }` | 有人发了聊天 |
| `chain:guessSubmitted` | `{ chainOwnerId, userId }`（不含猜测原文，防剧透，同13.7节 `game:correctGuess` 的思路） | 有人提交了猜测 |
| `chain:reviewChain` | `{ chainOwnerId, originalWord, steps, matched, participantIds }` | 结算阶段，轮到公示这条链 |
| `chain:reviewResolved` | `{ chainOwnerId, approved, reason, scoreEach, scores }`（`reason`: `matched`/`noWord`/`noEligibleVoters`） | 这条链不需要投票就能出结果 |
| `chain:voteOpened` | `{ chainOwnerId, eligibleVoters, deadline, anonymous }` | 这条链需要投票 |
| `chain:voteCast` | 非匿名：`{ chainOwnerId, userId, approve, voteCount, eligibleCount }`；匿名：`{ chainOwnerId, voteCount, eligibleCount }` | 有人投了票 |
| `chain:voteResult` | `{ chainOwnerId, approveCount, eligibleCount, approved, scoreEach, scores }` | 投票结束（全部投完或超时） |
| `game:ended` | `{ scores, ranking }` | 全部链公示完，和竞猜模式共用同一形状 |
| `room:statusUpdated` | `{ status }` | 同13.7节，`'waiting'<->'playing'` |

### 14.9 页面（对应第3节第7、8项）

- `frontend/src/pages/ChainGame.vue`：正式游戏内页面，路由 `/room/:id/chain-game`（和竞猜模式的 `/room/:id/game` 分开，`stores/room.js` 订阅 `game:started` 时按 `room.mode` 决定跳到哪个路由）。布局按回合的 `phase` 切换：选词（候选按钮/自定义输入框）、绘画（`CanvasBoard` + 题目 + "提前完成作画"按钮，这回合轮不到自己画就只显示等待提示，不挂 `CanvasBoard`）、猜词（`CanvasBoard` 只读模式 + 猜测输入框，轮不到自己猜同样只显示等待提示）、结算（逐条链展示，含历史画作——新增一个 `frontend/src/canvas/ActionsPreview.vue` 轻量静态画板预览组件，从 `CanvasBoard.vue` 抽出纯渲染逻辑到 `frontend/src/canvas/render.js` 共用，因为结算展示要同时静态渲染好几步历史画作，跟 `CanvasBoard` 那套"联网可交互单例状态"的画板不是一回事）。
- 非评审阶段的侧栏含计分板 + 聊天面板（`chain:chat`）；评审阶段为内联布局，暂无聊天入口。
- 结算展示复用竞猜模式的思路（收到 `game:ended` 后切到排名表 + "返回房间"按钮），不单独拆路由页面。
- `RoomLobby.vue` 的"开始游戏"入口从"仅竞猜模式可用"改成竞猜/接龙都用同一个按钮，按 `room.mode` 分别做人数门槛校验（竞猜2人/接龙4人）和分发到对应的 `start()`（`useGame`/`useChain` 两个 composable，事件名都是 `game:start`，服务端按 `room.mode` 分发，前端只是各自维护自己模式的本地状态）。

---

## 15. 战绩/排行榜/个人作画记录协议（Phase 6）

### 15.1 设计取舍

- **落库时机**：每局 `endGame`（正常打完或人数不足提前结算）时，用一个 SQLite 事务一次性写入这一局所有参与者的 `game_records` 与这一局产生的所有 `drawings`，不在回合内事件里穿插写库。代价：服务进程在对局中途崩溃则这一局战绩丢失——与"对局状态纯内存、重启即清空"（第1节）一致，持久化的只是结果。
- **竞猜画作来源**：`game/store.js` session 的 `turnRecords`，在 `endTurn`/`forfeitTurn` 时于画板被清空前同步快照 `canvasStore.getVisibleActions(roomId)`；一笔没画的回合不存。
- **接龙画作来源**：复用 `chain.steps`（14.4）里每个"画"步骤已存的 `{ by, word, actions }`，`endGame` 时把所有 `type==='draw'` 的步骤拍平即可，不另行捕获。
- **`drawings.stroke_data`**：`JSON.stringify({ word, actions })`，`actions` 即第12节矢量动作，前端详情页直接喂给 `ActionsPreview.vue` 重绘。
- **`game_records.room_id`**：不透明字符串，仅用于"同一局记录分组"，不展示。

### 15.2 数据模型（对应第6节草案，Phase 6 起真正有代码读写）

沿用 Phase 1 `db/init.js` 就建好的两张表结构不变，本 Phase 只是补上了业务读写代码和 4 个索引（`game_records(user_id)` / `game_records(played_at)` / `drawings(user_id)` / `drawings(created_at)`）。

### 15.3 REST 接口（`backend/src/routes/records.js`，全部要求登录，见第10节 #29）

| 接口 | 说明 |
|---|---|
| `GET /api/records/me?mode=&limit=&offset=` | 个人战绩历史，按 `played_at` 倒序分页；`mode` 可选 `guess`/`chain`，不传返回全部 |
| `GET /api/records/leaderboard?mode=&limit=` | 总分排行榜（`SUM(score)` 聚合，`ORDER BY totalScore DESC, gamesPlayed DESC`），附带调用者自己的名次（`me` 字段，哪怕不在返回的前 N 名列表里也能拿到） |
| `GET /api/records/drawings?limit=&offset=` | 个人作画记录列表，只带 `word`（用 `json_extract` 从 `stroke_data` 里取，不下发完整 `actions`，避免列表页一次性拉一堆大笔迹数据） |
| `GET /api/records/drawings/:id` | 单条作画记录详情，带完整 `actions`，供前端回放/放大预览；非本人的记录统一 404（第10节 #29） |

`limit` 统一夹在 `[1, 50]`（列表类默认 20，排行榜默认 20），非法 `mode`/非法 `id` 返回 400，不静默纠正。

### 15.4 前端页面（对应第3节，新增3个页面）

- `frontend/src/pages/RecordsHistory.vue`（路由 `/records`，"我的战绩"）：全部/竞猜/接龙三个 tab，列表 + "加载更多"分页。
- `frontend/src/pages/Leaderboard.vue`（路由 `/leaderboard`，"排行榜"）：总分/竞猜/接龙三个 tab，前 50 名列表；如果自己不在列表里，底部单独展示一条"我的排名"。
- `frontend/src/pages/MyDrawings.vue`（路由 `/drawings`，"我的作画记录"）：网格缩略卡片（只展示模式/词/时间，不在列表阶段渲染真实画面，避免几十条记录同时发详情请求），点击某一条才按需拉取详情、用 `ActionsPreview.vue` 弹窗渲染出完整画作。
- `Home.vue` 底部新增三个入口按钮，未登录点击会和"创建房间"/"加入房间"一样弹登录框（复用同一套 `requireLoginThen` 逻辑）。
