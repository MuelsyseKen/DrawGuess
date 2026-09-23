'use strict';

const jwt = require('jsonwebtoken');

const DEFAULT_SECRET = 'change-me-to-a-random-secret';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const ALGORITHM = 'HS256';

// 生产环境绝不允许沿用示例密钥——一旦泄漏等价于任意用户身份可伪造。
// 非生产环境放行但打印醒目警告，避免打断本地开发体验。
if (JWT_SECRET === DEFAULT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'FATAL: JWT_SECRET 未设置或仍是示例默认值，生产环境禁止启动。请在 .env 中设置一个随机长字符串。'
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    '[security] JWT_SECRET 未设置，正在使用不安全的默认值。仅限本地开发，部署前务必修改 .env。'
  );
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN, algorithm: ALGORITHM });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET, { algorithms: [ALGORITHM] });
}

module.exports = { signToken, verifyToken, JWT_EXPIRES_IN };
