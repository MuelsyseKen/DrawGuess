// 接龙模式对局 Socket.io 事件处理（见 FULLREADME.md 第14.8节）。
// 这一层只做鉴权/房间归属校验 + 转调 chain/engine.js，写法照抄 socket/game.js（竞猜模式）。
// game:start / game:getState 这两个"通用生命周期"事件不在这里——它们在 socket/game.js 里
// 按 room.mode 分发到 game/engine.js 或 chain/engine.js（见那边的注释）。
'use strict';

const roomStore = require('../rooms/store');
const engine = require('../chain/engine');

function err(error, message) {
  return { ok: false, error, message };
}

function ok(data) {
  return { ok: true, ...data };
}

function safeAck(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

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

function attachChainHandlers(io, socket) {
  socket.on('chain:chooseWord', (payload, ack) => {
    const room = requireRoom(socket, ack);
    if (!room) return;
    const result = engine.chooseWord(io, room.id, socket.user.id, payload && payload.word);
    safeAck(ack, result.ok ? ok({}) : err(result.error, result.message));
  });

  socket.on('chain:finishDraw', (payload, ack) => {
    const room = requireRoom(socket, ack);
    if (!room) return;
    const result = engine.finishDraw(io, room.id, socket.user.id);
    safeAck(ack, result.ok ? ok({}) : err(result.error, result.message));
  });

  socket.on('chain:submitGuess', (payload, ack) => {
    const room = requireRoom(socket, ack);
    if (!room) return;
    const result = engine.submitGuess(io, room.id, socket.user.id, payload && payload.guess);
    safeAck(ack, result.ok ? ok({}) : err(result.error, result.message));
  });

  socket.on('chain:vote', (payload, ack) => {
    const room = requireRoom(socket, ack);
    if (!room) return;
    const result = engine.castVote(io, room.id, socket.user.id, payload && payload.approve);
    safeAck(ack, result.ok ? ok({}) : err(result.error, result.message));
  });
}

module.exports = { attachChainHandlers };
