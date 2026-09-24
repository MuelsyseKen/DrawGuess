// 画板引擎 composable：维护画板动作的本地镜像 + 订阅广播事件（见 FULLREADME.md 第12节协议）。
// 写法延续 stores/room.js 的风格（轻量 reactive + composable，不引入 Pinia）。
//
// 本地镜像的可见性规则和后端 backend/src/canvas/store.js 的 getVisibleActions 完全对应：
// 一个 stroke/fill 动作可见 当且仅当 未被撤销（tombstoned:false）且未被某条线擦指向（erasedBy:null）。
// 顺序保持原始插入顺序不变（撤销/重做只切换可见性标记，不移动位置），这样撤销后重做能精确复原原始效果。
import { reactive, readonly, computed } from 'vue';
import { getSocket, emitAsync } from '../socket/client';

const state = reactive({
  roomId: null,
  ready: false,
  loadError: '',
  // actionId -> { id, type: 'stroke'|'fill', playerId, tool?, color, width?, points?, point?, tombstoned, erasedBy }
  actionsById: {},
  order: [], // actionId[]，插入顺序
  // 其他玩家正在画的实时预览：userId -> { tempId, tool, color, width, points }
  livePreviews: {},
});

let listenersBound = false;
let boundRoomId = null;

function upsertAction(action) {
  if (!state.actionsById[action.id]) {
    state.order.push(action.id);
  }
  state.actionsById[action.id] = {
    ...action,
    tombstoned: false,
    erasedBy: null,
  };
}

function bindListeners(roomId) {
  if (listenersBound && boundRoomId === roomId) return;
  listenersBound = true;
  boundRoomId = roomId;
  const socket = getSocket();

  socket.on('canvas:strokeProgress', ({ fromUserId, tempId, tool, color, width, points }) => {
    state.livePreviews[fromUserId] = { tempId, tool, color, width, points };
  });

  socket.on('canvas:actionAdded', ({ action }) => {
    upsertAction(action);
    // 该玩家的这一笔已经落地，清掉它的实时预览（不管 tempId，假设同一时刻每人最多一笔在画）
    delete state.livePreviews[action.playerId];
  });

  socket.on('canvas:strokeErased', ({ targetActionId, eraseActionId }) => {
    const target = state.actionsById[targetActionId];
    if (target) target.erasedBy = eraseActionId;
  });

  socket.on('canvas:actionUndone', ({ actionId, type, targetActionId }) => {
    if (type === 'lineErase') {
      const target = state.actionsById[targetActionId];
      if (target) target.erasedBy = null;
    } else {
      const action = state.actionsById[actionId];
      if (action) action.tombstoned = true;
    }
  });

  socket.on('canvas:actionRedone', ({ actionId, type, targetActionId }) => {
    if (type === 'lineErase') {
      const target = state.actionsById[targetActionId];
      if (target) target.erasedBy = actionId;
    } else {
      const action = state.actionsById[actionId];
      if (action) action.tombstoned = false;
    }
  });

  socket.on('canvas:cleared', () => {
    state.actionsById = {};
    state.order = [];
    state.livePreviews = {};
  });
}

// 当前可见（会被画出来）的动作列表，按插入顺序
const visibleActions = computed(() =>
  state.order
    .map((id) => state.actionsById[id])
    .filter((a) => a && !a.tombstoned && !a.erasedBy)
);

async function enter(roomId) {
  state.roomId = roomId;
  state.ready = false;
  state.loadError = '';
  state.actionsById = {};
  state.order = [];
  state.livePreviews = {};
  bindListeners(roomId);
  try {
    const res = await emitAsync('canvas:getState', { roomId });
    for (const action of res.actions) upsertAction(action);
    state.ready = true;
  } catch (e) {
    state.loadError = e.message || '加载画板失败';
  }
}

function sendStrokeProgress(roomId, payload) {
  getSocket().emit('canvas:strokeProgress', { roomId, ...payload });
}

function strokeEnd(roomId, payload) {
  return emitAsync('canvas:strokeEnd', { roomId, ...payload });
}

function fill(roomId, payload) {
  return emitAsync('canvas:fill', { roomId, ...payload });
}

function eraseStroke(roomId, targetActionId) {
  return emitAsync('canvas:eraseStroke', { roomId, targetActionId });
}

function undo(roomId) {
  return emitAsync('canvas:undo', { roomId });
}

function redo(roomId) {
  return emitAsync('canvas:redo', { roomId });
}

function clear(roomId) {
  return emitAsync('canvas:clear', { roomId });
}

export function useCanvas() {
  return {
    state: readonly(state),
    visibleActions,
    enter,
    sendStrokeProgress,
    strokeEnd,
    fill,
    eraseStroke,
    undo,
    redo,
    clear,
  };
}
