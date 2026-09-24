// 画板 Socket.io 事件处理（见 FULLREADME.md 第12.3节）。
// Phase 3 范围：房间内任意在线玩家都可以画/撤销/清空，没有"仅作画者可操作"的限制
// （见 FULLREADME 12.1 节"范围说明"，这是明确标注等待用户确认的开放假设，不是疏漏）。
'use strict';

const roomStore = require('../rooms/store');
const canvasStore = require('../canvas/store');
const { validateStrokePayload, validateFillPayload, sanitizeProgressPayload } = require('../canvas/validate');

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

// 画板动作只在"可渲染"的字段范围内广播给客户端（不泄露 tombstoned/erasedBy 这些服务端记账字段）
function toClientAction(action) {
  if (action.type === 'stroke') {
    return { id: action.id, type: 'stroke', playerId: action.playerId, tool: action.tool, color: action.color, width: action.width, points: action.points };
  }
  if (action.type === 'fill') {
    return { id: action.id, type: 'fill', playerId: action.playerId, color: action.color, point: action.point };
  }
  return { id: action.id, type: action.type, playerId: action.playerId };
}

// 要求：已登录 + 当前正在这个房间里，返回房间对象或 null（并自动 ack 错误）
function requireRoomMembership(socket, roomId, ack) {
  if (!socket.user) {
    safeAck(ack, err('NOT_AUTHENTICATED', '请先登录'));
    return null;
  }
  const room = roomStore.getRoomByUserId(socket.user.id);
  if (!room || room.id !== roomId) {
    safeAck(ack, err('NOT_IN_ROOM', '你当前不在这个房间里'));
    return null;
  }
  return room;
}

function attachCanvasHandlers(io, socket) {
  socket.on('canvas:getState', (payload, ack) => {
    const roomId = payload && payload.roomId;
    const room = requireRoomMembership(socket, roomId, ack);
    if (!room) return;
    const actions = canvasStore.getVisibleActions(room.id).map(toClientAction);
    safeAck(ack, ok({ actions }));
  });

  // 无 ack：实时预览，转发给房间内其他人，不落日志（见 12.3 节）
  socket.on('canvas:strokeProgress', (payload) => {
    if (!socket.user) return;
    const room = roomStore.getRoomByUserId(socket.user.id);
    const roomId = payload && payload.roomId;
    if (!room || room.id !== roomId) return;
    const clean = sanitizeProgressPayload(payload);
    if (!clean) return;
    socket.to(roomChannel(room.id)).emit('canvas:strokeProgress', {
      fromUserId: socket.user.id,
      tempId: clean.tempId,
      tool: clean.tool,
      color: clean.color,
      width: clean.width,
      points: clean.points,
    });
  });

  socket.on('canvas:strokeEnd', (payload, ack) => {
    const room = requireRoomMembership(socket, payload && payload.roomId, ack);
    if (!room) return;
    try {
      const clean = validateStrokePayload(payload);
      const action = canvasStore.appendAction(room.id, {
        type: 'stroke',
        playerId: socket.user.id,
        tool: clean.tool,
        color: clean.color,
        width: clean.width,
        points: clean.points,
      });
      io.to(roomChannel(room.id)).emit('canvas:actionAdded', { action: toClientAction(action) });
      safeAck(ack, ok({ actionId: action.id }));
    } catch (e) {
      safeAck(ack, err(e.code || 'INTERNAL_ERROR', e.message || '提交笔迹失败'));
    }
  });

  socket.on('canvas:fill', (payload, ack) => {
    const room = requireRoomMembership(socket, payload && payload.roomId, ack);
    if (!room) return;
    try {
      const clean = validateFillPayload(payload);
      const action = canvasStore.appendAction(room.id, {
        type: 'fill',
        playerId: socket.user.id,
        color: clean.color,
        point: clean.point,
      });
      io.to(roomChannel(room.id)).emit('canvas:actionAdded', { action: toClientAction(action) });
      safeAck(ack, ok({ actionId: action.id }));
    } catch (e) {
      safeAck(ack, err(e.code || 'INTERNAL_ERROR', e.message || '提交填充失败'));
    }
  });

  socket.on('canvas:eraseStroke', (payload, ack) => {
    const room = requireRoomMembership(socket, payload && payload.roomId, ack);
    if (!room) return;
    const targetActionId = payload && payload.targetActionId;
    if (typeof targetActionId !== 'string' || !targetActionId) {
      return safeAck(ack, err('INVALID_STROKE', 'targetActionId 不能为空'));
    }
    const eraseAction = canvasStore.eraseStroke(room.id, socket.user.id, targetActionId);
    if (!eraseAction) {
      return safeAck(ack, err('ACTION_NOT_ERASABLE', '目标笔迹不存在或已不可擦除'));
    }
    io.to(roomChannel(room.id)).emit('canvas:strokeErased', {
      targetActionId,
      eraseActionId: eraseAction.id,
      playerId: socket.user.id,
    });
    safeAck(ack, ok({ actionId: eraseAction.id }));
  });

  socket.on('canvas:undo', (payload, ack) => {
    const room = requireRoomMembership(socket, payload && payload.roomId, ack);
    if (!room) return;
    const result = canvasStore.undo(room.id, socket.user.id);
    if (!result) return safeAck(ack, ok({ noop: true }));
    const eventPayload = { actionId: result.action.id, type: result.action.type };
    if (result.targetAction) eventPayload.targetActionId = result.targetAction.id;
    io.to(roomChannel(room.id)).emit('canvas:actionUndone', eventPayload);
    safeAck(ack, ok({}));
  });

  socket.on('canvas:redo', (payload, ack) => {
    const room = requireRoomMembership(socket, payload && payload.roomId, ack);
    if (!room) return;
    const result = canvasStore.redo(room.id, socket.user.id);
    if (!result) return safeAck(ack, ok({ noop: true }));
    const eventPayload = { actionId: result.action.id, type: result.action.type };
    if (result.targetAction) eventPayload.targetActionId = result.targetAction.id;
    io.to(roomChannel(room.id)).emit('canvas:actionRedone', eventPayload);
    safeAck(ack, ok({}));
  });

  socket.on('canvas:clear', (payload, ack) => {
    const room = requireRoomMembership(socket, payload && payload.roomId, ack);
    if (!room) return;
    canvasStore.clear(room.id, socket.user.id);
    io.to(roomChannel(room.id)).emit('canvas:cleared', {});
    safeAck(ack, ok({}));
  });
}

module.exports = { attachCanvasHandlers };
