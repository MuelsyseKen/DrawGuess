# ISSUES.md —— 安全问题跟踪 + 未解决问题 + 待验证事项

记录规范见 `Agents.md`"安全审查规范"。**只有确认修复并验证过才打勾**；明确不修的标"已知取舍"并说明理由。

结构：第一部分是完整的安全问题跟踪表（原在 `FULLREADME.md` 第10节，编号不变，2026-09-28 整体迁移到这里，避免两处维护漂移）；后面几部分是安全表之外的、非安全类的未解决事项和已知简化。

---

## 一、安全问题跟踪（Phase 1~7，#1~42）

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
| 21 | 画板事件"房间内任意人可画/撤销/清空" | 人工自查 | [x] | Phase 4 `requireCanDraw`（FULLREADME 13.4）收紧为仅当前作画者；Phase 5 收紧为仅本回合轮到你的链（14.5）；测试页行为不变 |

### Phase 4（2026-09-26 补登：合并前漏做了安全审查登记，Phase 5 开工前补上）

| # | 问题 | 来源 | 状态 | 备注 |
|---|---|---|---|---|
| 22 | `game:chat` 无限流，可刷屏 | 人工自查 | [ ] 已知取舍 | 同 #20；聊天经 Vue 插值渲染，全项目无 `v-html`，无 XSS，仅缺防刷屏 |
| 23 | 自定义出题词无敏感词过滤 | 人工自查 | [ ] 已知取舍 | FULLREADME 13.2 节已写明一期不做；属内容审核范畴，无权限/越权含义 |
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
| 37 | 同浏览器换账号后 socket 沿用旧身份（`socket.user` 仅握手时算一次） | Deepseek（中危） | [ ] 已修复，待验证 | `stores/auth.js` 登录/注册/登出调用 `reconnectSocket()`（同一 Socket 对象 `disconnect()`+`connect()`，保留已绑定的监听器）。**仅走读，无自动化测试**，按规范不打勾；验证步骤见下方"二、A1" |
| 38 | `GET /api/rooms/public`、`GET /api/wordbanks` 未鉴权 | Deepseek 报告 | [ ] 待评估 | 未逐条复核；不含邀请码，无越权后果 |
| 39 | `canvas:strokeProgress` 校验过宽（不限 width 1~64、x/y ∈ [0,1]），可发畸形值让他人渲染异常 | Deepseek 报告 | [ ] 待评估 | 未逐条复核；与 #20 相关 |
| 40 | `utils/rateLimit.js` 的桶 Map 永不清理 | Deepseek 报告 | [ ] 待评估 | 未逐条复核；上限为注册用户数，极低危 |
| 41 | 反向代理下限流按代理 IP 失真（`TRUST_PROXY` 默认 false） | Deepseek 报告 | [ ] 待评估 | `.env.example` 已提示；建议进部署清单 |
| 42 | `records` 查询接口无限流（排行榜为全表聚合） | Deepseek 报告 | [ ] 待评估 | 未逐条复核；需登录，本地部署低危 |

---

## 二、待验证事项（非安全表条目，或安全表条目的验证步骤展开）

| # | 事项 | 现状 | 建议验证方式 |
|---|---|---|---|
| A1 | **socket 身份串号修复**（对应上表 #37，中危） | `stores/auth.js` 登录/注册/登出时调用 `reconnectSocket()`；仅代码走读，无自动化测试 | 实机：账号 A 登录进房间 → 登出 → 账号 B 登录 → 进房间做房主/对局操作，确认服务端按 B 身份处理，A 的房间不受影响 |
| A2 | 真实浏览器完整交互 | 已有的端到端脚本都是 socket.io-client 直连，没跑过浏览器里的 JS；单端口部署下浏览器 socket.io 握手的连通性以实机部署反馈为准 | 登录 → 建房 → 开局 → 竞猜/接龙各打一局 → 看战绩/排行榜/作画记录 |
| A3 | 局域网多设备访问 | 开发环境只有单网卡，无法模拟 | 另一台设备用 `start.sh` 打印的局域网 IP 访问并完整玩一局 |
| A4 | 移动端真机体验 | `ChainGame.vue` 768px 断点、接龙聊天面板、颗粒度占位滑杆均只按代码惯例补齐，未在真机看过 | 手机浏览器过一遍两种模式的游戏页与建房/房间设置页 |
| A5 | 部署脚本的平台覆盖 | `scripts/*.sh` 只在 Linux 与 Windows Git Bash 下出过结果；macOS、Windows PowerShell/cmd 原生均未验证（`.sh` 需要 bash） | 有需要的平台上实跑 `start.sh` |

## 三、待评估的加固细节（补充背景，对应上表 #38~42）

来源：Deepseek 长文审查报告（2026-09-27）。**尚未逐条对照代码复核**，按 `Agents.md`"按代码实际情况判断是否成立"处理。本地小规模部署下风险普遍较低。

| # | 位置（据报告） |
|---|---|
| 38 | `routes/rooms.js`、`routes/wordbanks.js` |
| 39 | `canvas/validate.js` 的 `sanitizeProgressPayload` |
| 40 | `utils/rateLimit.js` |
| 41 | `.env.example` 已提示 |
| 42 | `routes/records.js` |

另有 3 条非安全类、上表没有编号的：

| # | 事项 | 位置 |
|---|---|---|
| B1 | 同一用户多标签页/多 socket：新标签页 socket 不会自动加入房间 channel，旧 socket 仍留在旧房间 channel（体验/正确性问题，非安全漏洞） | `rooms/store.js` 的 `reconnectPlayer` 依赖 `disconnectTimer` |
| B2 | `recordGameSession` 在 `endGame` 中同步写库（32 人 × 7 环量级约 224 步），会短暂阻塞事件循环、延迟 `game:ended` 广播几十毫秒 | `records/store.js` |
| B3 | 注释与实现不符：`records/store.js` 注释称"中途退出的玩家不会出现在这里"，但 `scores` 不清理，退出者仍会写入 `game_records`（接龙里退出者评审阶段还能继续得分）；且开局在场但一局没玩的人也会记 0 分并抬高排行榜 `gamesPlayed`。需先决定意图：参与过就记，还是仅完整打完才记 | `records/store.js` 约第 19–20 行 |

## 四、功能层面的已知简化 / 取舍（非安全问题）

- **接龙评审阶段没有聊天入口**：评审区是内联布局，聊天面板只在非评审阶段的侧栏里（FULLREADME 14.9）。
- **接龙聊天不限制剧透**：有人在猜某条链时，其他人可在公共聊天里说出答案；按 5.2"正常聊天"字面实现。
- **接龙重连的评审阶段简化**：重连时若正处于 `reviewing`，只返回"第几条/共几条"，不重放已公示的历史（FULLREADME 14.8）。
- **特殊效果未实现**：隐形/重力/像素艺术（含颗粒度）仅有禁用的 UI 占位，服务端拒绝非 `none`（FULLREADME 第8节）。
- **无自动化测试框架**：端到端验证靠临时脚本，不在仓库里（对应上表 #14）。
