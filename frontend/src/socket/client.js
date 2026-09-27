// Socket.io 客户端单例：整个应用共用一条连接（见 FULLREADME.md 第11节房间协议）。
// withCredentials 带上登录态 cookie，供后端握手鉴权（backend/src/socket/index.js）。
import { io } from 'socket.io-client';

// 未设置 VITE_SOCKET_URL 时（比如没有 .env 文件）兜底到本地开发默认值；
// 显式设置成空字符串（生产单端口部署，见 scripts/build.sh）则视为"跟前端同源"，
// 不传 url 给 io()，由 socket.io-client 自动连当前页面的 origin。
const envSocketUrl = import.meta.env.VITE_SOCKET_URL;
const SOCKET_URL = envSocketUrl !== undefined ? envSocketUrl : 'http://localhost:3000';

let socket = null;

export function getSocket() {
  if (!socket) {
    const options = { withCredentials: true, autoConnect: true };
    socket = SOCKET_URL ? io(SOCKET_URL, options) : io(options);
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
