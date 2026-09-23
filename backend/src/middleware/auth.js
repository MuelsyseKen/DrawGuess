'use strict';

const { verifyToken } = require('../utils/token');

const COOKIE_NAME = 'drawguess_token';

// 纯 cookie 模型：前端从不读写 token，只依赖 httpOnly cookie。
// 不再接受 Authorization: Bearer —— 留着这条路等于给 XSS 多开一个即拿即用的攻击面。
function extractToken(req) {
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    return req.cookies[COOKIE_NAME];
  }
  return null;
}

// 必须登录才能访问的路由用这个
function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'NOT_AUTHENTICATED', message: '请先登录' });
  }
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, username: payload.username };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'INVALID_TOKEN', message: '登录状态已失效，请重新登录' });
  }
}

// 登录与否都能访问，但如果登录了要拿到 req.user（例如大厅页判断是否显示用户名）
function attachUserIfPresent(req, res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      const payload = verifyToken(token);
      req.user = { id: payload.sub, username: payload.username };
    } catch (err) {
      // 静默忽略：token 无效就当作未登录，不阻断请求
    }
  }
  return next();
}

module.exports = { requireAuth, attachUserIfPresent, COOKIE_NAME };
