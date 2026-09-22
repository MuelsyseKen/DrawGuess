'use strict';

const express = require('express');
const db = require('../db/init');
const { hashPassword, verifyPassword } = require('../utils/password');
const { signToken } = require('../utils/token');
const { requireAuth, COOKIE_NAME } = require('../middleware/auth');

const router = express.Router();

const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 天，需与 JWT_EXPIRES_IN 保持大致一致

const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5]{3,20}$/; // 3~20 位，支持中文/字母/数字/下划线
const MIN_PASSWORD_LEN = 6;
const MAX_PASSWORD_LEN = 72; // bcrypt 对超长密码会静默截断，这里显式限制避免歧义

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

function publicUser(row) {
  return { id: row.id, username: row.username, createdAt: row.created_at };
}

// POST /api/auth/register
router.post('/register', (req, res) => {
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

  const passwordHash = hashPassword(password);
  const info = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, passwordHash);

  const user = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(info.lastInsertRowid);

  const token = signToken({ sub: user.id, username: user.username });
  setAuthCookie(res, token);

  return res.status(201).json({ user: publicUser(user), token });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '用户名和密码不能为空' });
  }

  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: '用户名或密码错误' });
  }

  const token = signToken({ sub: row.id, username: row.username });
  setAuthCookie(res, token);

  return res.json({ user: publicUser(row), token });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
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
