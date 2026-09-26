// 房间 Socket.io 事件处理（见 FULLREADME.md 第11.4节）。
'use strict';

const store = require('../rooms/store');
const { validateSettings, validateMode } = require('../rooms/validateSettings');
const rateLimit = require('../utils/rateLimit');
const canvasStore = require('../canvas/store');
const gameStore = require('../game/store');
const gameEngine = require('../game/engine');
const chainStore = require('../chain/store');
const chainEngine = require('../chain/engine');

// 断线/移出相关的钩子要转给哪个 engine，取决于这个房间当时是竞猜还是接龙对局
// （两者互斥：一个房间同一时刻只可能有其中一种 session 存在，见各自 engine 的 startGame）。
function gameEngineFor(roomId) {
  if (chainStore.getSession(roomId)) return chainEngine;
  return gameEngine; // 没有接龙 session 时，按竞猜模式处理（包括两种都没有 session 的情况，
  // 此时 gameEngine 的这几个钩子本身也是"找不到 session 就直接返回"，是安全的 no-op）。
}

// 邀请码是 6 位大写字母+数字（约 33^6 ≈ 12.9 亿种组合），单次猜中概率很低，
// 但没有限流的话，脚本可以在短时间内发起海量尝试去撞库存活跃房间。
// 同一登录用户每分钟最多尝试 20 次，超过直接拒绝（不消耗到真正的房间查找逻辑）。
const JOIN_BY_CODE_RATE_LIMIT = { max: 20, windowMs: 60 * 1000 };

function roomChannel(roomId) {
  return `room:${roomId}`;
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

function requireUser(socket, ack) {
  if (!socket.user) {
    safeAck(ack, err('NOT_AUTHENTICATED', '请先登录'));
    return null;
  }
  return socket.user;
}

function broadcastRoom(io, roomId, event, payload) {
  io.to(roomChannel(roomId)).emit(event, payload);
}

// 统一处理"某个 userId 离开了 prevRoom"之后的收尾：房间清空就把画板/对局状态一起清掉；
// 房间还在就广播 playerLeft，并让对局层（如果这个房间当时有对局在进行）同步这次移出
// （见 FULLREADME 第13.6节：猜题方/作画者中途被移出对局该怎么处理）。
function handlePlayerGone(io, prevResult, userId, extra) {
  const { room, newHostUserId, closed } = prevResult;
  if (closed) {
    canvasStore.destroySession(room.id);
    gameStore.destroySession(room.id);
    // 接龙模式一个房间同时有 N 条链、N 块独立画板（见第14.5节），房间清空时要把这些
    // 复合 key 的画板会话也一并清掉，否则每盘接龙对局都会在 canvas/store.js 里留下
    // 再也没人访问的残留 session（Phase 5 引入的清理点，Phase 3/4 的单画板房间不受影响）。
    const chainSession = chainStore.getSession(room.id);
    if (chainSession) {
      for (const ownerId of chainSession.chains.keys()) {
        canvasStore.destroySession(chainStore.chainCanvasKey(room.id, ownerId));
      }
    }
    chainStore.destroySession(room.id);
  } else {
    broadcastRoom(io, room.id, 'room:playerLeft', { userId, newHostUserId, ...extra });
    gameEngineFor(room.id).onPlayerRemoved(io, room.id, userId);
  }
}

function attachRoomHandlers(io, socket) {
  // 宽限期重连：如果这个已登录用户此刻正处于"断线倒计时"中，直接把新连接接回原房间，
  // 不需要客户端重新走一遍加入流程；超过 60 秒宽限期的，走正常的"已被移出房间"流程，
  // 客户端应该用邀请码/公开列表重新加入。
  if (socket.user) {
    const room = store.reconnectPlayer(socket.user.id, socket.id);
    if (room) {
      socket.join(roomChannel(room.id));
      broadcastRoom(io, room.id, 'room:playerReconnected', { userId: socket.user.id });
      gameEngineFor(room.id).onPlayerReconnected(io, room.id, socket.user.id);
    }
  }

  socket.on('room:create', (payload, ack) => {
    const user = requireUser(socket, ack);
    if (!user) return;

    try {
      const { mode, isPublic, settings } = payload || {};
      validateMode(mode);
      const normalizedSettings = validateSettings(mode, settings);

      // 同一用户只能在一个房间里：先把旧房间清掉（如果有）
      const prev = store.removePlayer(user.id);
      if (prev) {
        socket.leave(roomChannel(prev.room.id));
        handlePlayerGone(io, prev, user.id);
      }

      const room = store.createRoom({
        mode,
        isPublic,
        settings: normalizedSettings,
        host: { userId: user.id, username: user.username, socketId: socket.id },
      });
      socket.join(roomChannel(room.id));

      safeAck(ack, ok({ room: store.toPublicRoomView(room) }));
    } catch (e) {
      safeAck(ack, err(e.code || 'INTERNAL_ERROR', e.message || '创建房间失败'));
    }
  });

  socket.on('room:joinByCode', (payload, ack) => {
    const user = requireUser(socket, ack);
    if (!user) return;

    if (!rateLimit.allow(`joinByCode:${user.id}`, JOIN_BY_CODE_RATE_LIMIT)) {
      return safeAck(ack, err('TOO_MANY_ATTEMPTS', '尝试次数过多，请稍后再试'));
    }

    const inviteCode = (payload && payload.inviteCode ? String(payload.inviteCode) : '').toUpperCase();
    const room = store.findByInviteCode(inviteCode);
    if (!room) {
      return safeAck(ack, err('INVALID_INVITE_CODE', '邀请码无效'));
    }
    if (room.status !== 'waiting') {
      return safeAck(ack, err('ROOM_NOT_FOUND', '对局进行中，暂不可加入'));
    }
    if (room.players.length >= room.settings.maxPlayers) {
      return safeAck(ack, err('ROOM_FULL', '房间已满'));
    }
    if (room.players.some((p) => p.userId === user.id)) {
      // 已经在这个房间里了（比如重复点击），直接返回当前状态
      return safeAck(ack, ok({ room: store.toPublicRoomView(room) }));
    }

    const prev = store.removePlayer(user.id);
    if (prev && prev.room.id !== room.id) {
      socket.leave(roomChannel(prev.room.id));
      handlePlayerGone(io, prev, user.id);
    }

    const player = store.addPlayer(room, { userId: user.id, username: user.username, socketId: socket.id });
    socket.join(roomChannel(room.id));
    broadcastRoom(io, room.id, 'room:playerJoined', { player: { userId: player.userId, username: player.username, isHost: player.isHost, connected: true } });

    safeAck(ack, ok({ room: store.toPublicRoomView(room) }));
  });

  socket.on('room:joinPublic', (payload, ack) => {
    const user = requireUser(socket, ack);
    if (!user) return;

    const roomId = payload && payload.roomId;
    const room = store.getRoom(roomId);
    if (!room || !room.isPublic || room.status !== 'waiting') {
      return safeAck(ack, err('ROOM_NOT_FOUND', '房间不存在或已不可加入'));
    }
    if (room.players.length >= room.settings.maxPlayers) {
      return safeAck(ack, err('ROOM_FULL', '房间已满'));
    }
    if (room.players.some((p) => p.userId === user.id)) {
      return safeAck(ack, ok({ room: store.toPublicRoomView(room) }));
    }

    const prev = store.removePlayer(user.id);
    if (prev && prev.room.id !== room.id) {
      socket.leave(roomChannel(prev.room.id));
      handlePlayerGone(io, prev, user.id);
    }

    const player = store.addPlayer(room, { userId: user.id, username: user.username, socketId: socket.id });
    socket.join(roomChannel(room.id));
    broadcastRoom(io, room.id, 'room:playerJoined', { player: { userId: player.userId, username: player.username, isHost: player.isHost, connected: true } });

    safeAck(ack, ok({ room: store.toPublicRoomView(room) }));
  });

  socket.on('room:leave', (payload, ack) => {
    const user = requireUser(socket, ack);
    if (!user) return;

    const result = store.removePlayer(user.id);
    if (!result) {
      return safeAck(ack, ok({}));
    }
    socket.leave(roomChannel(result.room.id));
    if (result.closed) {
      broadcastRoom(io, result.room.id, 'room:closed', { reason: 'empty' });
    }
    handlePlayerGone(io, result, user.id);
    safeAck(ack, ok({}));
  });

  socket.on('room:updateSettings', (payload, ack) => {
    const user = requireUser(socket, ack);
    if (!user) return;

    const room = store.getRoomByUserId(user.id);
    if (!room) return safeAck(ack, err('ROOM_NOT_FOUND', '你当前不在任何房间里'));
    if (room.hostUserId !== user.id) return safeAck(ack, err('NOT_HOST', '只有房主可以修改设置'));

    try {
      const normalized = validateSettings(room.mode, (payload || {}).settings);
      room.settings = normalized;
      broadcastRoom(io, room.id, 'room:settingsUpdated', { settings: normalized });
      safeAck(ack, ok({ room: store.toPublicRoomView(room) }));
    } catch (e) {
      safeAck(ack, err(e.code || 'INTERNAL_ERROR', e.message || '设置更新失败'));
    }
  });

  socket.on('room:setPublic', (payload, ack) => {
    const user = requireUser(socket, ack);
    if (!user) return;

    const room = store.getRoomByUserId(user.id);
    if (!room) return safeAck(ack, err('ROOM_NOT_FOUND', '你当前不在任何房间里'));
    if (room.hostUserId !== user.id) return safeAck(ack, err('NOT_HOST', '只有房主可以修改设置'));

    const isPublic = Boolean(payload && payload.isPublic);
    room.isPublic = isPublic;
    broadcastRoom(io, room.id, 'room:visibilityUpdated', { isPublic });
    safeAck(ack, ok({ room: store.toPublicRoomView(room) }));
  });

  socket.on('room:getCurrent', (payload, ack) => {
    if (!socket.user) return safeAck(ack, ok({ room: null }));
    const room = store.getRoomByUserId(socket.user.id);
    safeAck(ack, ok({ room: room ? store.toPublicRoomView(room) : null }));
  });

  socket.on('disconnect', () => {
    if (!socket.user) return;
    const userId = socket.user.id;
    const room = store.markDisconnected(userId, (timedOutUserId) => {
      // 60 秒宽限期到期仍未重连：正式移出房间（房主顺延/房间清空同 room:leave 的逻辑）
      const result = store.removePlayer(timedOutUserId);
      if (!result) return;
      if (result.closed) {
        broadcastRoom(io, result.room.id, 'room:closed', { reason: 'empty' });
      }
      handlePlayerGone(io, result, timedOutUserId, { reason: 'timeout' });
    });
    if (!room) return; // 断线时不在任何房间里，什么都不用做
    broadcastRoom(io, room.id, 'room:playerDisconnected', {
      userId,
      reconnectTimeoutMs: store.DISCONNECT_GRACE_MS,
    });
    gameEngineFor(room.id).onPlayerDisconnected(io, room.id, userId);
  });
}

module.exports = { attachRoomHandlers };
