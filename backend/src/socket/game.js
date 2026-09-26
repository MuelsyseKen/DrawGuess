// 对局生命周期 Socket.io 事件处理：竞猜模式细节协议见 FULLREADME.md 第13.7节，
// 接龙模式见第14.8节。这一层只做鉴权/房间归属校验 + 转调对应 engine，具体编排逻辑都在
// engine 里（engine 需要在计时器超时时也能广播，天然要持有 io，见 engine.js 顶部注释）。
//
// game:start / game:getState 是两种模式共用的"通用生命周期"事件名（开始游戏/查询当前对局
// 状态这两个概念不分模式），这里按 room.mode 分发到 game/engine.js（竞猜）或
// chain/engine.js（接龙）；每种模式各自的回合内事件（choosingWord/chooseWord、
// chat/correctGuess 是竞猜的，chain:chooseWord/finishDraw/submitGuess/vote 是接龙的）
// 分别在这个文件和 socket/chain.js 里，不复用同一个事件名。
'use strict';

const roomStore = require('../rooms/store');
const guessEngine = require('../game/engine');
const chainEngine = require('../chain/engine');

function engineForMode(mode) {
  return mode === 'chain' ? chainEngine : guessEngine;
}

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
    const result = engineForMode(room.mode).startGame(io, room, socket.user.id);
    safeAck(ack, result.ok ? ok({}) : err(result.error, result.message));
  });

  socket.on('game:chooseWord', (payload, ack) => {
    const room = requireRoom(socket, ack);
    if (!room) return;
    const result = guessEngine.chooseWord(io, room.id, socket.user.id, payload && payload.word);
    safeAck(ack, result.ok ? ok({}) : err(result.error, result.message));
  });

  socket.on('game:chat', (payload, ack) => {
    const room = requireRoom(socket, ack);
    if (!room) return;
    const result = guessEngine.handleChat(io, room, socket.user.id, payload && payload.text);
    safeAck(ack, result.ok ? ok({}) : err(result.error, result.message));
  });

  socket.on('game:getState', (payload, ack) => {
    const room = requireRoom(socket, ack);
    if (!room) return;
    safeAck(ack, ok(engineForMode(room.mode).getStateForUser(room, socket.user.id)));
  });
}

module.exports = { attachGameHandlers };
