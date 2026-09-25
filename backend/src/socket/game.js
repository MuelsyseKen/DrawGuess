// 竞猜模式对局 Socket.io 事件处理（见 FULLREADME.md 第13.7节）。
// 这一层只做鉴权/房间归属校验 + 转调 game/engine.js，具体编排逻辑都在 engine 里
// （engine 需要在计时器超时时也能广播，天然要持有 io，见 engine.js 顶部注释）。
'use strict';

const roomStore = require('../rooms/store');
const engine = require('../game/engine');

function err(error, message) {
  return { ok: false, error, message };
}

function ok(data) {
  return { ok: true, ...data };
}

function safeAck(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

// 要求：已登录 + 当前正在某个房间里，返回房间对象或 null（并自动 ack 错误）
function requireRoom(socket, ack) {
  if (!socket.user) {
    safeAck(ack, err('NOT_AUTHENTICATED', '请先登录'));
    return null;
  }
  const room = roomStore.getRoomByUserId(socket.user.id);
  if (!room) {
    safeAck(ack, err('NOT_IN_ROOM', '你当前不在任何房间里'));
    return null;
  }
  return room;
}

function attachGameHandlers(io, socket) {
  socket.on('game:start', (payload, ack) => {
    const room = requireRoom(socket, ack);
    if (!room) return;
    const result = engine.startGame(io, room, socket.user.id);
    safeAck(ack, result.ok ? ok({}) : err(result.error, result.message));
  });

  socket.on('game:chooseWord', (payload, ack) => {
    const room = requireRoom(socket, ack);
    if (!room) return;
    const result = engine.chooseWord(io, room.id, socket.user.id, payload && payload.word);
    safeAck(ack, result.ok ? ok({}) : err(result.error, result.message));
  });

  socket.on('game:chat', (payload, ack) => {
    const room = requireRoom(socket, ack);
    if (!room) return;
    const result = engine.handleChat(io, room, socket.user.id, payload && payload.text);
    safeAck(ack, result.ok ? ok({}) : err(result.error, result.message));
  });

  socket.on('game:getState', (payload, ack) => {
    const room = requireRoom(socket, ack);
    if (!room) return;
    safeAck(ack, ok(engine.getStateForUser(room, socket.user.id)));
  });
}

module.exports = { attachGameHandlers };
