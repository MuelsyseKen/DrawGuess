'use strict';

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

const authRoutes = require('./routes/auth');
const roomsRoutes = require('./routes/rooms');
const wordbanksRoutes = require('./routes/wordbanks');

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

  // 404
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: '接口不存在' });
  });

  // 统一错误处理
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: '服务器内部错误' });
  });

  return app;
}

module.exports = createApp;
