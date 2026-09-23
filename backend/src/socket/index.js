// Socket.io 骨架：Phase 1 负责把服务挂起来 + 握手鉴权，不包含任何房间/游戏协议。
// 房间协议、画板协议从 Phase 2 开始在这个目录下逐步添加事件处理模块。
'use strict';

const cookie = require('cookie');
const { verifyToken } = require('../utils/token');
const { COOKIE_NAME } = require('../middleware/auth');

// 握手阶段鉴权：从握手请求头的 Cookie 里取出登录态 token 并校验，
// 挂到 socket.user 上供后续 Phase 使用；未登录也允许连接（socket.user 为 null），
// 是否要求登录由具体事件处理器自己判断（比如"创建房间"要登录，"查看大厅人数"可以不用）。
function socketAuthMiddleware(socket, next) {
  const rawCookie = socket.handshake.headers.cookie;
  if (!rawCookie) {
    socket.user = null;
    return next();
  }

  try {
    const parsed = cookie.parse(rawCookie);
    const token = parsed[COOKIE_NAME];
    if (!token) {
      socket.user = null;
      return next();
    }
    const payload = verifyToken(token);
    socket.user = { id: payload.sub, username: payload.username };
    return next();
  } catch (err) {
    // token 无效/过期：当作未登录处理，不拒绝连接（对齐 REST 层 attachUserIfPresent 的行为）
    socket.user = null;
    return next();
  }
}

function attachSocket(io) {
  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    const who = socket.user ? `user#${socket.user.id}(${socket.user.username})` : 'anonymous';
    console.log(`[socket] connected: ${socket.id} as ${who}`);

    socket.on('disconnect', (reason) => {
      console.log(`[socket] disconnected: ${socket.id} (${reason})`);
    });
  });
}

module.exports = { attachSocket };
