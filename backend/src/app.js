'use strict';

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

const authRoutes = require('./routes/auth');
const roomsRoutes = require('./routes/rooms');
const wordbanksRoutes = require('./routes/wordbanks');
const recordsRoutes = require('./routes/records');

function createApp() {
  const app = express();

  // 部署在反向代理（Nginx/Caddy 等）后面时需要这个，
  // 否则 express-rate-limit 的 IP 识别、cookie 的 secure 判断都会失真。
  if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }

  app.use(helmet());

  const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'drawguess-backend' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/rooms', roomsRoutes);
  app.use('/api/wordbanks', wordbanksRoutes);
  app.use('/api/records', recordsRoutes);

  // 404
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: '接口不存在' });
  });

  // 单端口本地部署（见 README「本地部署」一节 / scripts/build.sh）：
  // 设置了 FRONTEND_DIST_PATH 且目录里有构建产物时，由后端顺带把前端静态文件也托管了，
  // 这样局域网/公网访问只需要暴露后端这一个端口，不用额外起 Nginx。不设置这个变量时
  // （前后端分离开发模式的默认情况）完全不影响原有行为。
  const frontendDistPath = process.env.FRONTEND_DIST_PATH
    ? path.resolve(process.env.FRONTEND_DIST_PATH)
    : null;
  if (frontendDistPath && fs.existsSync(path.join(frontendDistPath, 'index.html'))) {
    app.use(express.static(frontendDistPath));
    // 前端用的是 vue-router history 模式，非 /api 的路径（比如直接刷新 /records）
    // 服务器这边找不到对应静态文件时要回退到 index.html，交给前端路由自己处理。
    // 走到这里说明前面的 /api 分支已经处理完所有 /api 请求了，这里不会误吞 API 路径。
    app.get('*', (req, res) => {
      res.sendFile(path.join(frontendDistPath, 'index.html'));
    });
  }

  // 统一错误处理
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: '服务器内部错误' });
  });

  return app;
}

module.exports = createApp;
