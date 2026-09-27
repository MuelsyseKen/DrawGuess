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
set -euo pipefail
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

export FRONTEND_DIST_PATH="$(cd frontend/dist && pwd)"

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
cd backend
exec node src/index.js
