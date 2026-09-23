// 房间 Socket.io 事件处理（见 FULLREADME.md 第11.4节）。
'use strict';

const store = require('../rooms/store');
const { validateSettings, validateMode } = require('../rooms/validateSettings');
const rateLimit = require('../utils/rateLimit');

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

function attachRoomHandlers(io, socket) {
  // 宽限期重连：如果这个已登录用户此刻正处于"断线倒计时"中，直接把新连接接回原房间，
  // 不需要客户端重新走一遍加入流程；超过 60 秒宽限期的，走正常的"已被移出房间"流程，
  // 客户端应该用邀请码/公开列表重新加入。
  if (socket.user) {
    const room = store.reconnectPlayer(socket.user.id, socket.id);
    if (room) {
      socket.join(roomChannel(room.id));
      broadcastRoom(io, room.id, 'room:playerReconnected', { userId: socket.user.id });
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
      if (prev && !prev.closed) {
        socket.leave(roomChannel(prev.room.id));
        broadcastRoom(io, prev.room.id, 'room:playerLeft', {
          userId: user.id,
          newHostUserId: prev.newHostUserId,
        });
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
    if (room.players.length >= room.settings.maxPlayers) {
      return safeAck(ack, err('ROOM_FULL', '房间已满'));
    }
    if (room.players.some((p) => p.userId === user.id)) {
      // 已经在这个房间里了（比如重复点击），直接返回当前状态
      return safeAck(ack, ok({ room: store.toPublicRoomView(room) }));
    }

    const prev = store.removePlayer(user.id);
    if (prev && !prev.closed && prev.room.id !== room.id) {
      socket.leave(roomChannel(prev.room.id));
      broadcastRoom(io, prev.room.id, 'room:playerLeft', {
        userId: user.id,
        newHostUserId: prev.newHostUserId,
      });
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
    if (prev && !prev.closed && prev.room.id !== room.id) {
      socket.leave(roomChannel(prev.room.id));
      broadcastRoom(io, prev.room.id, 'room:playerLeft', {
        userId: user.id,
        newHostUserId: prev.newHostUserId,
      });
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
    } else {
      broadcastRoom(io, result.room.id, 'room:playerLeft', {
        userId: user.id,
        newHostUserId: result.newHostUserId,
      });
    }
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
      } else {
        broadcastRoom(io, result.room.id, 'room:playerLeft', {
          userId: timedOutUserId,
          newHostUserId: result.newHostUserId,
          reason: 'timeout',
        });
      }
    });
    if (!room) return; // 断线时不在任何房间里，什么都不用做
    broadcastRoom(io, room.id, 'room:playerDisconnected', {
      userId,
      reconnectTimeoutMs: store.DISCONNECT_GRACE_MS,
    });
  });
}

module.exports = { attachRoomHandlers };
