// 极简的内存限流器，给 Socket.io 事件用（REST 侧已经有 express-rate-limit，这里不想为了一个
// socket 事件再引入新依赖，手写一个滑动窗口计数器足够用）。
// 主要用途：防止有人拿 room:joinByCode 暴力猜邀请码（见 Agents.md 安全审查规范）。
'use strict';

// key -> { count, windowStart }
const buckets = new Map();

// 返回 true 表示"这次调用被允许"，false 表示"超过限制，应当拒绝"。
function allow(key, { max, windowMs }) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= max) {
    return false;
  }
  bucket.count += 1;
  return true;
}

module.exports = { allow };
