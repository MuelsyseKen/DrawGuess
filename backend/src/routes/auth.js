'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const ms = require('ms');
const db = require('../db/init');
const { hashPassword, verifyPassword } = require('../utils/password');
const { signToken, JWT_EXPIRES_IN } = require('../utils/token');
const { requireAuth, COOKIE_NAME } = require('../middleware/auth');

const router = express.Router();

// cookie 有效期直接从 JWT_EXPIRES_IN 派生，避免两处手写数字导致不一致
const COOKIE_MAX_AGE_MS = ms(JWT_EXPIRES_IN);

const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5]{3,20}$/; // 3~20 位，支持中文/字母/数字/下划线
const MIN_PASSWORD_LEN = 6;
const MAX_PASSWORD_LEN = 72; // bcrypt 对超长密码会静默截断，这里显式限制避免歧义

// set 和 clear 共用同一份属性，避免因为属性不一致导致浏览器拒绝清除 cookie
const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: process.env.COOKIE_SAME_SITE || 'lax',
  secure: process.env.COOKIE_SECURE === 'true',
  path: '/',
};

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, AUTH_COOKIE_OPTIONS);
}

function publicUser(row) {
  return { id: row.id, username: row.username, createdAt: row.created_at };
}

// 注册/登录接口的暴力破解防护：同一 IP 每 15 分钟最多 20 次
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS', message: '请求过于频繁，请稍后再试' },
});

// POST /api/auth/register
router.post('/register', authRateLimit, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};

    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'INVALID_INPUT', message: '用户名和密码不能为空' });
    }
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({
        error: 'INVALID_USERNAME',
        message: '用户名需为 3~20 位字母/数字/下划线/中文',
      });
    }
    if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) {
      return res.status(400).json({
        error: 'INVALID_PASSWORD',
        message: `密码长度需在 ${MIN_PASSWORD_LEN}~${MAX_PASSWORD_LEN} 位之间`,
      });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(409).json({ error: 'USERNAME_TAKEN', message: '用户名已被占用' });
    }

    const passwordHash = await hashPassword(password);
    const info = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run(username, passwordHash);

    const user = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(info.lastInsertRowid);

    const token = signToken({ sub: user.id, username: user.username });
    setAuthCookie(res, token);

    // 前端是纯 cookie 模型，不需要也不应该在响应体里再下发一份 token
    // （httpOnly 的意义就是不让 JS 碰到它，写在这里等于白设）
    return res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/login
router.post('/login', authRateLimit, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};

    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'INVALID_INPUT', message: '用户名和密码不能为空' });
    }

    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    const ok = row && (await verifyPassword(password, row.password_hash));
    if (!ok) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: '用户名或密码错误' });
    }

    const token = signToken({ sub: row.id, username: row.username });
    setAuthCookie(res, token);

    return res.json({ user: publicUser(row) });
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  return res.json({ ok: true });
});

// GET /api/auth/me —— 已登录则返回用户信息，否则 401
router.get('/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!row) {
    return res.status(401).json({ error: 'NOT_AUTHENTICATED', message: '请先登录' });
  }
  return res.json({ user: publicUser(row) });
});

module.exports = router;
