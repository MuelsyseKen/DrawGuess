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

// 登录态变化（登录/注册/登出）时调用：后端 socket 握手鉴权（backend/src/socket/index.js）
// 只在"建立连接那一刻"读一次 Cookie 算出 socket.user，之后不管 Cookie 后来怎么变都不会
// 重新算。如果不重连，同一个浏览器 tab 换账号登录后，所有房间/对局操作会继续以旧账号的
// 身份在服务端执行——这是中危问题，2026-09-27 Deepseek 审查报告里提过。
// 这里用同一个 socket 实例的 disconnect()+connect()（而不是整个换掉 `socket` 变量重建一个
// 新实例），是因为 useGame.js/useChain.js/useRoom.js/useCanvas.js 这几个 composable 各自
// 只在模块级绑定一次事件监听器（`listenersBound` 卫兵），如果换成一个新的 Socket 对象，
// 这些已经绑好的监听器全部会挂在旧对象上、收不到新连接的任何事件；重用同一个对象的
// disconnect+connect 会触发一次新的握手（浏览器此时的 Cookie 已经是最新的），但监听器
// 全部还在，不需要谁重新绑定。
export function reconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket.connect();
  }
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
