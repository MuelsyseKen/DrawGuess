'use strict';

const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

// 改成异步版本：同步 hash/compare 会阻塞 event loop，
// Phase 2 之后 socket 心跳和游戏逻辑都在同一进程里跑，登录高峰会卡顿。
function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = { hashPassword, verifyPassword };
