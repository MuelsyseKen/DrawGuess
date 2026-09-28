#!/usr/bin/env bash
# 单端口本地部署：构建前端 + 生产模式启动后端，后端顺带把前端静态文件也托管了，
# 局域网/公网访问只需要暴露后端这一个端口。
#
# 用法：
#   ./scripts/start.sh                先构建前端再启动（第一次部署 / 前端有改动时用这个）
#   ./scripts/start.sh --skip-build   跳过构建，直接用已有的 frontend/dist 启动（只改了后端代码时用，更快）
#
# 部署前必读：
#   1. backend/.env 必须存在，且 NODE_ENV=production、JWT_SECRET 改成随机值 ——
#      这两项不满足后端会直接拒绝启动（安全设计，见 FULLREADME.md 第10节 #1）。
#      没有 backend/.env 的话先 `cp backend/.env.example backend/.env` 再改。
#   2. 局域网内其他设备访问时，用下面脚本打印出来的局域网 IP + 端口，不要用 localhost
#      （localhost 在每台设备上指向的都是它自己）。
#   3. 如果要暴露到公网：本脚本只负责"局域网内跑起来"，公网访问涉及的路由器端口转发 /
#      防火墙 / 是否需要 HTTPS 反代等，需要自行评估，脚本不处理。
#
# Windows 用户注意：请用 Git Bash 跑这个脚本。已经踩过的坑（2026-09-27 Deepseek 实机
# 部署审查发现，bug D10000/D10001）都在脚本里绕开了，不需要额外操作，仅供了解：
#   - 不能用 `$(cd xxx && pwd)` 算路径再传给 Node——Git Bash 的 pwd 输出 POSIX 风格路径
#     （形如 /j/DrawGuess/...），Windows 版 Node 会把它错误解析成 J:\j\DrawGuess\...，
#     导致后端根本找不到前端构建产物，3000 端口访问空白。这里改成了传相对路径。
#   - MSYS_NO_PATHCONV=1：Git Bash 默认会把命令行里长得像路径的参数（比如 `/api`）自动转
#     成 Windows 路径，`build.sh` 里 `VITE_API_BASE_URL=/api` 会被转成一个盘符路径，构建出
#     来的前端请求地址就是坏的（注册/登录会莫名其妙失败）。设这个环境变量关掉这个自动转换。
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."

SKIP_BUILD=false
if [[ "${1:-}" == "--skip-build" ]]; then
  SKIP_BUILD=true
fi

if [[ "$SKIP_BUILD" == "false" ]]; then
  ./scripts/build.sh
elif [[ ! -f frontend/dist/index.html ]]; then
  echo "错误：没有找到 frontend/dist/index.html。--skip-build 需要先构建过至少一次，" >&2
  echo "      先跑一次不带参数的 ./scripts/start.sh。" >&2
  exit 1
fi

if [[ ! -f backend/.env ]]; then
  echo "错误：没有找到 backend/.env。先执行：" >&2
  echo "      cp backend/.env.example backend/.env" >&2
  echo "      然后按 README「本地部署」一节修改（至少要改 NODE_ENV=production 和 JWT_SECRET）。" >&2
  exit 1
fi

# 这两项后端自己也会校验（NODE_ENV!==production 时 JWT_SECRET 用默认值不会被拒绝
# 启动），但那条检查是"防止生产环境用弱密钥"，没有强制"本脚本启动的一定是生产模式"。
# `start.sh` 的定位就是"把这台机器暴露到局域网"，如果用户直接 `cp .env.example .env`
# 什么都不改就跑这个脚本，会得到一台用公开默认密钥签发 JWT 的局域网服务，局域网内任何
# 人都能伪造任意用户身份登录——这里在部署脚本这一层再拦一道，而不只是依赖后端那道检查
#（2026-09-27 Deepseek 实机部署审查提出的建议，见 FULLREADME.md 第10节 #35）。
ENV_NODE_ENV=$(grep -E '^NODE_ENV=' backend/.env | tail -1 | cut -d= -f2 || true)
ENV_JWT_SECRET=$(grep -E '^JWT_SECRET=' backend/.env | tail -1 | cut -d= -f2- || true)
if [[ "$ENV_NODE_ENV" != "production" || "$ENV_JWT_SECRET" == "change-me-to-a-random-secret" || -z "$ENV_JWT_SECRET" ]]; then
  echo "错误：backend/.env 还没准备好用于部署：" >&2
  [[ "$ENV_NODE_ENV" != "production" ]] && echo "      - NODE_ENV 当前是 \"${ENV_NODE_ENV:-未设置}\"，需要改成 NODE_ENV=production" >&2
  if [[ "$ENV_JWT_SECRET" == "change-me-to-a-random-secret" || -z "$ENV_JWT_SECRET" ]]; then
    echo "      - JWT_SECRET 还是示例默认值（或没设置），局域网内任何人都能伪造登录态。" >&2
    echo "        换一个随机值，比如执行：openssl rand -hex 32" >&2
  fi
  exit 1
fi

echo "==> 启动后端（含前端静态文件托管），端口见 backend/.env 的 PORT（默认 3000）"

LAN_IP=$(node -e "
const os = require('node:os');
const nets = os.networkInterfaces();
for (const name of Object.keys(nets)) {
  for (const net of nets[name] || []) {
    if (net.family === 'IPv4' && !net.internal) {
      console.log(net.address);
      process.exit(0);
    }
  }
}
" 2>/dev/null || true)

PORT_VAL=$(grep -E '^PORT=' backend/.env | head -1 | cut -d= -f2)
PORT_VAL=${PORT_VAL:-3000}

if [[ -n "$LAN_IP" ]]; then
  echo "==> 局域网内其他设备可通过 http://${LAN_IP}:${PORT_VAL} 访问"
else
  echo "==> 没有检测到局域网网卡，本机可通过 http://localhost:${PORT_VAL} 访问"
fi

# cd 进 backend 再启动：后端用 `require('dotenv').config()` 按当前工作目录找 .env，
# 从仓库根目录直接 `node backend/src/index.js` 会找错路径（相当于去根目录找 .env）。
#
# FRONTEND_DIST_PATH 故意传相对路径（相对于下面 cd 进去的 backend/ 目录），不在这里用
# `$(cd ... && pwd)` 之类的 shell 命令预先展开成绝对路径——原因见上面脚本头部的说明，
# Windows 上会被解析错。相对路径交给 Node 自己的 path.resolve(process.cwd(), ...) 处理，
# 不经过 shell 的路径转换，跨平台表现一致。
export FRONTEND_DIST_PATH="../frontend/dist"
cd backend
exec node src/index.js
