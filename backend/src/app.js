'use strict';

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/auth');

function createApp() {
  const app = express();

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
