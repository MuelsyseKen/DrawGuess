#!/usr/bin/env bash
# 构建前端生产包（产物在 frontend/dist），给 scripts/start.sh 的"单端口部署"模式用。
# 日常前后端分离开发（两个 npm run dev）不需要跑这个脚本，见 README「本地开发」一节。
#
# Windows 用户：这里的 VITE_API_BASE_URL=/api 是给 Vite 构建用的相对路径，不是真的
# Windows 文件路径。Git Bash 默认会把这种"看起来像路径"的参数自动转换成盘符路径
# （比如 /api 被转成 C:/Program Files/Git/api），导致构建出来的前端请求地址是坏的，
# 注册/登录会莫名其妙失败（2026-09-27 Deepseek 实机部署审查发现，bug D10001）。
# MSYS_NO_PATHCONV=1 关掉这个自动转换，Linux/Mac 上这个变量不生效，无副作用。
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."

echo "==> 安装后端依赖"
(cd backend && npm install)

echo "==> 安装前端依赖"
(cd frontend && npm install)

echo "==> 构建前端（单端口部署：API/Socket 走相对路径，跟后端同源，
#     这样不管用 localhost 还是局域网 IP 访问，前端都不用改配置）"
(cd frontend && VITE_API_BASE_URL=/api VITE_SOCKET_URL= npm run build)

echo "==> 构建完成：frontend/dist"
