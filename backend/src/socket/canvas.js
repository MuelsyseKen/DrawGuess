// 画板 Socket.io 事件处理（见 FULLREADME.md 第12.3节 / 第13.4节 / 第14.5节）。
// Phase 3 范围：房间没有进行中的对局时（比如 /room/:id/canvas-test 测试页），
// 房间内任意在线玩家都可以画/撤销/清空。
// Phase 4 起：房间有进行中的竞猜对局时收紧权限——选词阶段谁都不能画，绘画阶段
// 只有当前作画者能画（见 game/store.js 的 canDraw，第13.4节"画板权限收紧"）。
// Phase 5 起：payload 里带 chainOwnerId 就代表这是接龙模式某一条链的画板操作——
// canvas/store.js 本身不用改（它的 key 只是个不透明字符串），这里用
// `${roomId}::chain::${chainOwnerId}` 复合 key 把每条链的动作日志分开存（见第14.5节），
// 权限校验则转去 chain/store.js 的 canDraw（这条链这一回合是不是轮到你画）。
// 不带 chainOwnerId 的请求（竞猜模式 / 测试页）行为完全不变，两套逻辑互不影响。
'use strict';

const roomStore = require('../rooms/store');
const canvasStore = require('../canvas/store');
const gameStore = require('../game/store');
const chainStore = require('../chain/store');
const { validateStrokePayload, validateFillPayload, sanitizeProgressPayload } = require('../canvas/validate');

// 计算这次操作实际要落到 canvas/store.js 的哪个 key 上；chainOwnerId 为空就是原来的
// "每个房间一块画板" 语义（roomId 本身当 key）。
function resolveCanvasKey(roomId, chainOwnerId) {
  if (chainOwnerId === undefined || chainOwnerId === null || chainOwnerId === '') return roomId;
  return chainStore.chainCanvasKey(roomId, Number(chainOwnerId));
}

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

// 要求：requireRoomMembership 通过，且当前允许这个用户操作画板（见第13.4节 / 第14.5节）。
// chainOwnerId 非空时走接龙模式的链级权限校验，否则走竞猜模式/测试页原来的逻辑，不变。
function requireCanDraw(socket, roomId, chainOwnerId, ack) {
  const room = requireRoomMembership(socket, roomId, ack);
  if (!room) return null;
  const canDraw =
    chainOwnerId === undefined || chainOwnerId === null || chainOwnerId === ''
      ? gameStore.canDraw(room.id, socket.user.id)
      : chainStore.canDraw(room.id, Number(chainOwnerId), socket.user.id);
  if (!canDraw) {
    safeAck(ack, err('NOT_YOUR_TURN', '现在不是你可以画的时候'));
    return null;
  }
  return room;
}

function attachCanvasHandlers(io, socket) {
  socket.on('canvas:getState', (payload, ack) => {
    const roomId = payload && payload.roomId;
    const chainOwnerId = payload && payload.chainOwnerId;
    const room = requireRoomMembership(socket, roomId, ack);
    if (!room) return;
    const canvasKey = resolveCanvasKey(room.id, chainOwnerId);
    const actions = canvasStore.getVisibleActions(canvasKey).map(toClientAction);
    safeAck(ack, ok({ actions }));
  });

  // 无 ack：实时预览，转发给房间内其他人，不落日志（见 12.3 节）
  socket.on('canvas:strokeProgress', (payload) => {
    if (!socket.user) return;
    const room = roomStore.getRoomByUserId(socket.user.id);
    const roomId = payload && payload.roomId;
    const chainOwnerId = payload && payload.chainOwnerId;
    if (!room || room.id !== roomId) return;
    const canDraw =
      chainOwnerId === undefined || chainOwnerId === null || chainOwnerId === ''
        ? gameStore.canDraw(room.id, socket.user.id)
        : chainStore.canDraw(room.id, Number(chainOwnerId), socket.user.id);
    if (!canDraw) return;
    const clean = sanitizeProgressPayload(payload);
    if (!clean) return;
    socket.to(roomChannel(room.id)).emit('canvas:strokeProgress', {
      roomId: room.id,
      chainOwnerId: chainOwnerId || null,
      fromUserId: socket.user.id,
      tempId: clean.tempId,
      tool: clean.tool,
      color: clean.color,
      width: clean.width,
      points: clean.points,
    });
  });

  socket.on('canvas:strokeEnd', (payload, ack) => {
    const chainOwnerId = payload && payload.chainOwnerId;
    const room = requireCanDraw(socket, payload && payload.roomId, chainOwnerId, ack);
    if (!room) return;
    try {
      const clean = validateStrokePayload(payload);
      const canvasKey = resolveCanvasKey(room.id, chainOwnerId);
      const action = canvasStore.appendAction(canvasKey, {
        type: 'stroke',
        playerId: socket.user.id,
        tool: clean.tool,
        color: clean.color,
        width: clean.width,
        points: clean.points,
      });
      io.to(roomChannel(room.id)).emit('canvas:actionAdded', {
        roomId: room.id,
        chainOwnerId: chainOwnerId || null,
        action: toClientAction(action),
      });
      safeAck(ack, ok({ actionId: action.id }));
    } catch (e) {
      safeAck(ack, err(e.code || 'INTERNAL_ERROR', e.message || '提交笔迹失败'));
    }
  });

  socket.on('canvas:fill', (payload, ack) => {
    const chainOwnerId = payload && payload.chainOwnerId;
    const room = requireCanDraw(socket, payload && payload.roomId, chainOwnerId, ack);
    if (!room) return;
    try {
      const clean = validateFillPayload(payload);
      const canvasKey = resolveCanvasKey(room.id, chainOwnerId);
      const action = canvasStore.appendAction(canvasKey, {
        type: 'fill',
        playerId: socket.user.id,
        color: clean.color,
        point: clean.point,
      });
      io.to(roomChannel(room.id)).emit('canvas:actionAdded', {
        roomId: room.id,
        chainOwnerId: chainOwnerId || null,
        action: toClientAction(action),
      });
      safeAck(ack, ok({ actionId: action.id }));
    } catch (e) {
      safeAck(ack, err(e.code || 'INTERNAL_ERROR', e.message || '提交填充失败'));
    }
  });

  socket.on('canvas:eraseStroke', (payload, ack) => {
    const chainOwnerId = payload && payload.chainOwnerId;
    const room = requireCanDraw(socket, payload && payload.roomId, chainOwnerId, ack);
    if (!room) return;
    const targetActionId = payload && payload.targetActionId;
    if (typeof targetActionId !== 'string' || !targetActionId) {
      return safeAck(ack, err('INVALID_STROKE', 'targetActionId 不能为空'));
    }
    const canvasKey = resolveCanvasKey(room.id, chainOwnerId);
    const eraseAction = canvasStore.eraseStroke(canvasKey, socket.user.id, targetActionId);
    if (!eraseAction) {
      return safeAck(ack, err('ACTION_NOT_ERASABLE', '目标笔迹不存在或已不可擦除'));
    }
    io.to(roomChannel(room.id)).emit('canvas:strokeErased', {
      roomId: room.id,
      chainOwnerId: chainOwnerId || null,
      targetActionId,
      eraseActionId: eraseAction.id,
      playerId: socket.user.id,
    });
    safeAck(ack, ok({ actionId: eraseAction.id }));
  });

  socket.on('canvas:undo', (payload, ack) => {
    const chainOwnerId = payload && payload.chainOwnerId;
    const room = requireCanDraw(socket, payload && payload.roomId, chainOwnerId, ack);
    if (!room) return;
    const canvasKey = resolveCanvasKey(room.id, chainOwnerId);
    const result = canvasStore.undo(canvasKey, socket.user.id);
    if (!result) return safeAck(ack, ok({ noop: true }));
    const eventPayload = {
      roomId: room.id,
      chainOwnerId: chainOwnerId || null,
      actionId: result.action.id,
      type: result.action.type,
    };
    if (result.targetAction) eventPayload.targetActionId = result.targetAction.id;
    io.to(roomChannel(room.id)).emit('canvas:actionUndone', eventPayload);
    safeAck(ack, ok({}));
  });

  socket.on('canvas:redo', (payload, ack) => {
    const chainOwnerId = payload && payload.chainOwnerId;
    const room = requireCanDraw(socket, payload && payload.roomId, chainOwnerId, ack);
    if (!room) return;
    const canvasKey = resolveCanvasKey(room.id, chainOwnerId);
    const result = canvasStore.redo(canvasKey, socket.user.id);
    if (!result) return safeAck(ack, ok({ noop: true }));
    const eventPayload = {
      roomId: room.id,
      chainOwnerId: chainOwnerId || null,
      actionId: result.action.id,
      type: result.action.type,
    };
    if (result.targetAction) eventPayload.targetActionId = result.targetAction.id;
    io.to(roomChannel(room.id)).emit('canvas:actionRedone', eventPayload);
    safeAck(ack, ok({}));
  });

  socket.on('canvas:clear', (payload, ack) => {
    const chainOwnerId = payload && payload.chainOwnerId;
    const room = requireCanDraw(socket, payload && payload.roomId, chainOwnerId, ack);
    if (!room) return;
    const canvasKey = resolveCanvasKey(room.id, chainOwnerId);
    canvasStore.clear(canvasKey, socket.user.id);
    io.to(roomChannel(room.id)).emit('canvas:cleared', { roomId: room.id, chainOwnerId: chainOwnerId || null });
    safeAck(ack, ok({}));
  });
}

module.exports = { attachCanvasHandlers };
