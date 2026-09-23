// Socket.io 客户端单例：整个应用共用一条连接（见 FULLREADME.md 第11节房间协议）。
// withCredentials 带上登录态 cookie，供后端握手鉴权（backend/src/socket/index.js）。
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, {
      withCredentials: true,
      autoConnect: true,
    });
  }
  return socket;
}

// 用 Promise 包一层 ack 回调，事件处理器统一返回 { ok, ...data } | { ok:false, error, message }
export function emitAsync(event, payload = {}) {
  return new Promise((resolve, reject) => {
    getSocket().emit(event, payload, (res) => {
      if (!res) return reject(new Error('无响应'));
      if (res.ok === false) {
        const err = new Error(res.message || '请求失败');
        err.code = res.error;
        return reject(err);
      }
      resolve(res);
    });
  });
}
