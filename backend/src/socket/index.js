// Socket.io 骨架：Phase 1 只负责把服务挂起来，不包含任何房间/游戏协议。
// 房间协议、画板协议从 Phase 2 开始在这个目录下逐步添加事件处理模块。
'use strict';

function attachSocket(io) {
  io.on('connection', (socket) => {
    console.log(`[socket] connected: ${socket.id}`);

    socket.on('disconnect', (reason) => {
      console.log(`[socket] disconnected: ${socket.id} (${reason})`);
    });
  });
}

module.exports = { attachSocket };
