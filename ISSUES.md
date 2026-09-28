# ISSUES.md —— 未解决问题与待验证事项

只放**还没解决 / 还没验证**的事项，是一份"活清单"：解决后从这里删掉，并在 `HISTORY.md` 追加一笔（`HISTORY.md` 只增不减，本文件可增可删）。
安全类条目同时登记在 `FULLREADME.md` 第10节（编号对应），这里给出更完整的背景和验证步骤。

---

## A. 已改代码、但缺验证

| # | 事项 | 现状 | 建议验证方式 |
|---|---|---|---|
| A1 | **socket 身份串号修复**（FULLREADME #37，中危） | `stores/auth.js` 登录/注册/登出时调用 `reconnectSocket()`；仅代码走读，无自动化测试 | 实机：账号 A 登录进房间 → 登出 → 账号 B 登录 → 进房间做房主/对局操作，确认服务端按 B 身份处理，A 的房间不受影响 |
| A2 | 真实浏览器完整交互 | 已有的端到端脚本都是 socket.io-client 直连，没跑过浏览器里的 JS；单端口部署下浏览器 socket.io 握手的连通性以实机部署反馈为准 | 登录 → 建房 → 开局 → 竞猜/接龙各打一局 → 看战绩/排行榜/作画记录 |
| A3 | 局域网多设备访问 | 开发环境只有单网卡，无法模拟 | 另一台设备用 `start.sh` 打印的局域网 IP 访问并完整玩一局 |
| A4 | 移动端真机体验 | `ChainGame.vue` 768px 断点、接龙聊天面板、颗粒度占位滑杆均只按代码惯例补齐，未在真机看过 | 手机浏览器过一遍两种模式的游戏页与建房/房间设置页 |
| A5 | 部署脚本的平台覆盖 | `scripts/*.sh` 只在 Linux 与 Windows Git Bash 下出过结果；macOS、Windows PowerShell/cmd 原生均未验证（`.sh` 需要 bash） | 有需要的平台上实跑 `start.sh` |

## B. 审查报告提出的加固项（待评估，未修）

来源：Deepseek 长文审查报告（2026-09-27）。**尚未逐条对照代码复核**，按 `Agents.md` 应"按代码实际情况判断是否成立"后再决定修不修。已在 FULLREADME 第10节登记为 #38~#42。本地小规模部署下风险普遍较低。

| # | 事项 | 位置（据报告） |
|---|---|---|
| B1 | `GET /api/rooms/public`、`GET /api/wordbanks` 无需登录即可访问（不含邀请码） | `routes/rooms.js`、`routes/wordbanks.js` |
| B2 | 同一用户多标签页/多 socket：新标签页 socket 不会自动加入房间 channel，旧 socket 仍留在旧房间 channel（体验/正确性问题，非安全漏洞） | `rooms/store.js` 的 `reconnectPlayer` 依赖 `disconnectTimer` |
| B3 | `canvas:strokeProgress` 校验过宽：不限 width 1~64、x/y ∈ [0,1]，恶意客户端可发畸形值让他人画板渲染异常 | `canvas/validate.js` 的 `sanitizeProgressPayload` |
| B4 | 限流桶 Map 永不清理，每个 `user.id` 永久驻留 | `utils/rateLimit.js` |
| B5 | 反向代理下限流按代理 IP 失真：`TRUST_PROXY` 默认 false，Nginx/Caddy 后须设为 true | `.env.example` 已提示，建议加进部署清单 |
| B6 | `records` 查询接口无限流（排行榜为全表聚合，需登录） | `routes/records.js` |
| B7 | `recordGameSession` 在 `endGame` 中同步写库（32 人 × 7 环量级约 224 步），会短暂阻塞事件循环、延迟 `game:ended` 广播几十毫秒 | `records/store.js` |
| B8 | 注释与实现不符：`records/store.js` 注释称"中途退出的玩家不会出现在这里"，但 `scores` 不清理，退出者仍会写入 `game_records`（接龙里退出者评审阶段还能继续得分）；且开局在场但一局没玩的人也会记 0 分并抬高排行榜 `gamesPlayed`。需先决定意图：参与过就记，还是仅完整打完才记 | `records/store.js` 约第 19–20 行 |

## C. 功能层面的已知简化 / 取舍

- **接龙评审阶段没有聊天入口**：评审区是内联布局，聊天面板只在非评审阶段的侧栏里（FULLREADME 14.9）。
- **接龙聊天不限制剧透**：有人在猜某条链时，其他人可在公共聊天里说出答案；按 5.2"正常聊天"字面实现。
- **接龙重连的评审阶段简化**：重连时若正处于 `reviewing`，只返回"第几条/共几条"，不重放已公示的历史（FULLREADME 14.8）。
- **特殊效果未实现**：隐形/重力/像素艺术（含颗粒度）仅有禁用的 UI 占位，服务端拒绝非 `none`（FULLREADME 第8节）。
- **无自动化测试框架**：端到端验证靠临时脚本，不在仓库里（FULLREADME #14）。

## D. 已登记的安全类"已知取舍"

均为"本地/小规模部署下可接受"的判断，理由见 FULLREADME 第10节对应行：#13 无 token 黑名单、#15 无前端路由守卫、#16 跨站 cookie 未联调、#18 无房间配额、#19 无 payload 大小限制、#20/#22/#25 高频事件无限流、#23 无敏感词过滤、#28 断线躲避猜词、#30 笔迹无落库上限、#33 局域网可访问。**若以后要面向不特定公众开放，这一批需要整体重新评估。**
