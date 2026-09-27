#!/usr/bin/env bash
# 构建前端生产包（产物在 frontend/dist），给 scripts/start.sh 的"单端口部署"模式用。
# 日常前后端分离开发（两个 npm run dev）不需要跑这个脚本，见 README「本地开发」一节。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> 安装后端依赖"
(cd backend && npm install)

echo "==> 安装前端依赖"
(cd frontend && npm install)

echo "==> 构建前端（单端口部署：API/Socket 走相对路径，跟后端同源，
#     这样不管用 localhost 还是局域网 IP 访问，前端都不用改配置）"
(cd frontend && VITE_API_BASE_URL=/api VITE_SOCKET_URL= npm run build)

echo "==> 构建完成：frontend/dist"
