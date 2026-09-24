// 画板动作日志内存状态（见 FULLREADME.md 第12节）：按 roomId 关联，纯内存，不做持久化。
// 独立于 rooms/store.js，房间销毁时由调用方（socket/rooms.js）显式调用 destroySession 清理，
// 避免房间销毁后这里残留一份没人用的画板状态。
'use strict';

const crypto = require('node:crypto');

// roomId -> session
const sessions = new Map();

function createSession() {
  return {
    actions: [], // 追加写入，不物理删除（clear 是逻辑截断，靠 lastClearIndex 计算可见范围，为回放留口子）
    actionIndex: new Map(), // actionId -> action
    undoStacks: new Map(), // userId -> [actionId, ...]（该用户当前可撤销的动作，LIFO）
    redoStacks: new Map(), // userId -> [actionId, ...]（该用户当前可重做的动作，LIFO）
  };
}

function getOrCreateSession(roomId) {
  let session = sessions.get(roomId);
  if (!session) {
    session = createSession();
    sessions.set(roomId, session);
  }
  return session;
}

function destroySession(roomId) {
  sessions.delete(roomId);
}

function lastClearIndex(session) {
  for (let i = session.actions.length - 1; i >= 0; i--) {
    if (session.actions[i].type === 'clear') return i;
  }
  return -1;
}

// 当前可渲染的动作列表（按 FULLREADME 12.1 节可见性规则过滤，只含 stroke/fill，且按原始顺序）
function getVisibleActions(roomId) {
  const session = getOrCreateSession(roomId);
  const from = lastClearIndex(session) + 1;
  const result = [];
  for (let i = from; i < session.actions.length; i++) {
    const action = session.actions[i];
    if (action.type !== 'stroke' && action.type !== 'fill') continue;
    if (action.tombstoned || action.erasedBy) continue;
    result.push(action);
  }
  return result;
}

function pushUndo(session, userId, actionId) {
  if (!session.undoStacks.has(userId)) session.undoStacks.set(userId, []);
  session.undoStacks.get(userId).push(actionId);
  // 新动作会让该用户之前撤销掉的历史失去"重做"的意义（标准 undo/redo 语义）
  session.redoStacks.set(userId, []);
}

function appendAction(roomId, partial) {
  const session = getOrCreateSession(roomId);
  const action = {
    id: crypto.randomUUID(),
    tombstoned: false,
    createdAt: Date.now(),
    ...partial,
  };
  if (action.type === 'stroke' || action.type === 'fill') {
    action.erasedBy = null;
  }
  session.actions.push(action);
  session.actionIndex.set(action.id, action);
  if (action.type !== 'clear') {
    pushUndo(session, action.playerId, action.id);
  }
  return action;
}

// 校验目标是否"当前可擦"：存在、类型是 stroke/fill、未撤销、未被擦过
function canErase(roomId, targetActionId) {
  const session = getOrCreateSession(roomId);
  const target = session.actionIndex.get(targetActionId);
  if (!target) return null;
  if (target.type !== 'stroke' && target.type !== 'fill') return null;
  if (target.tombstoned || target.erasedBy) return null;
  // 目标必须在当前"未被清空"的区间内，否则清空前的笔迹不该还能被擦
  const from = lastClearIndex(session) + 1;
  const idx = session.actions.indexOf(target);
  if (idx < from) return null;
  return target;
}

function eraseStroke(roomId, playerId, targetActionId) {
  const target = canErase(roomId, targetActionId);
  if (!target) return null;
  const session = getOrCreateSession(roomId);
  const eraseAction = appendAction(roomId, {
    type: 'lineErase',
    playerId,
    targetActionId,
  });
  target.erasedBy = eraseAction.id;
  return eraseAction;
}

// 撤销该用户最近一次操作，返回 { action, targetAction? } 或 null（栈空）
function undo(roomId, userId) {
  const session = getOrCreateSession(roomId);
  const stack = session.undoStacks.get(userId);
  if (!stack || stack.length === 0) return null;
  const actionId = stack.pop();
  const action = session.actionIndex.get(actionId);
  if (!action) return null;
  action.tombstoned = true;

  let targetAction = null;
  if (action.type === 'lineErase') {
    targetAction = session.actionIndex.get(action.targetActionId);
    if (targetAction && targetAction.erasedBy === action.id) {
      targetAction.erasedBy = null;
    }
  }

  if (!session.redoStacks.has(userId)) session.redoStacks.set(userId, []);
  session.redoStacks.get(userId).push(actionId);

  return { action, targetAction };
}

// 重做该用户最近一次撤销，返回 { action, targetAction? } 或 null（栈空）
function redo(roomId, userId) {
  const session = getOrCreateSession(roomId);
  const stack = session.redoStacks.get(userId);
  if (!stack || stack.length === 0) return null;
  const actionId = stack.pop();
  const action = session.actionIndex.get(actionId);
  if (!action) return null;
  action.tombstoned = false;

  let targetAction = null;
  if (action.type === 'lineErase') {
    targetAction = session.actionIndex.get(action.targetActionId);
    if (targetAction && !targetAction.tombstoned) {
      targetAction.erasedBy = action.id;
    }
  }

  if (!session.undoStacks.has(userId)) session.undoStacks.set(userId, []);
  session.undoStacks.get(userId).push(actionId);

  return { action, targetAction };
}

// 清空：追加一条 clear 动作，并清空所有玩家的撤销/重做栈
// （避免清空后还能"重做"出清空前的笔迹——见 FULLREADME 12.1 节）
function clear(roomId, playerId) {
  const session = getOrCreateSession(roomId);
  const action = appendAction(roomId, { type: 'clear', playerId });
  session.undoStacks.clear();
  session.redoStacks.clear();
  return action;
}

module.exports = {
  getVisibleActions,
  appendAction,
  eraseStroke,
  undo,
  redo,
  clear,
  destroySession,
};
