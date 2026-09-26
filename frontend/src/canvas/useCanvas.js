// 画板引擎 composable：维护画板动作的本地镜像 + 订阅广播事件（见 FULLREADME.md 第12节协议）。
// 写法延续 stores/room.js 的风格（轻量 reactive + composable，不引入 Pinia）。
//
// 本地镜像的可见性规则和后端 backend/src/canvas/store.js 的 getVisibleActions 完全对应：
// 一个 stroke/fill 动作可见 当且仅当 未被撤销（tombstoned:false）且未被某条线擦指向（erasedBy:null）。
// 顺序保持原始插入顺序不变（撤销/重做只切换可见性标记，不移动位置），这样撤销后重做能精确复原原始效果。
//
// Phase 5 起：接龙模式一个房间里同时存在多条链的画板（见 FULLREADME 第14.5节），
// 服务端按 roomId + chainOwnerId 区分不同的画板会话，这里对应加一个 chainOwnerId 参数
// （不传/传 null 就是 Phase 3/4 的"每个房间一块画板"语义，完全不变）。因为这个 state
// 还是模块级单例（同一时刻前端只需要看一块画板——不管是自己在画的，还是正在看的别人的），
// 所有广播事件都额外按"当前 enter() 绑定的是哪个 roomId/chainOwnerId"过滤一遍，避免别的链
// 的动作（比如它被清空重置）误伤当前正在显示的这一块。
import { reactive, readonly, computed } from 'vue';
import { getSocket, emitAsync } from '../socket/client';

const state = reactive({
  roomId: null,
  chainOwnerId: null,
  ready: false,
  loadError: '',
  // actionId -> { id, type: 'stroke'|'fill', playerId, tool?, color, width?, points?, point?, tombstoned, erasedBy }
  actionsById: {},
  order: [], // actionId[]，插入顺序
  // 其他玩家正在画的实时预览：userId -> { tempId, tool, color, width, points }
  livePreviews: {},
});

let listenersBound = false;

function normalizeChainOwnerId(chainOwnerId) {
  return chainOwnerId === undefined || chainOwnerId === null || chainOwnerId === '' ? null : String(chainOwnerId);
}

// 广播事件里的 chainOwnerId 是否匹配当前 enter() 绑定的那一块画板
function matchesCurrent(roomId, chainOwnerId) {
  if (roomId !== state.roomId) return false;
  return normalizeChainOwnerId(chainOwnerId) === state.chainOwnerId;
}

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

function bindListeners() {
  if (listenersBound) return;
  listenersBound = true;
  const socket = getSocket();

  socket.on('canvas:strokeProgress', ({ roomId, chainOwnerId, fromUserId, tempId, tool, color, width, points }) => {
    if (!matchesCurrent(roomId, chainOwnerId)) return;
    state.livePreviews[fromUserId] = { tempId, tool, color, width, points };
  });

  socket.on('canvas:actionAdded', ({ roomId, chainOwnerId, action }) => {
    if (!matchesCurrent(roomId, chainOwnerId)) return;
    upsertAction(action);
    // 该玩家的这一笔已经落地，清掉它的实时预览（不管 tempId，假设同一时刻每人最多一笔在画）
    delete state.livePreviews[action.playerId];
  });

  socket.on('canvas:strokeErased', ({ roomId, chainOwnerId, targetActionId, eraseActionId }) => {
    if (!matchesCurrent(roomId, chainOwnerId)) return;
    const target = state.actionsById[targetActionId];
    if (target) target.erasedBy = eraseActionId;
  });

  socket.on('canvas:actionUndone', ({ roomId, chainOwnerId, actionId, type, targetActionId }) => {
    if (!matchesCurrent(roomId, chainOwnerId)) return;
    if (type === 'lineErase') {
      const target = state.actionsById[targetActionId];
      if (target) target.erasedBy = null;
    } else {
      const action = state.actionsById[actionId];
      if (action) action.tombstoned = true;
    }
  });

  socket.on('canvas:actionRedone', ({ roomId, chainOwnerId, actionId, type, targetActionId }) => {
    if (!matchesCurrent(roomId, chainOwnerId)) return;
    if (type === 'lineErase') {
      const target = state.actionsById[targetActionId];
      if (target) target.erasedBy = actionId;
    } else {
      const action = state.actionsById[actionId];
      if (action) action.tombstoned = false;
    }
  });

  socket.on('canvas:cleared', ({ roomId, chainOwnerId } = {}) => {
    if (!matchesCurrent(roomId, chainOwnerId)) return;
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

async function enter(roomId, chainOwnerId = null) {
  state.roomId = roomId;
  state.chainOwnerId = normalizeChainOwnerId(chainOwnerId);
  state.ready = false;
  state.loadError = '';
  state.actionsById = {};
  state.order = [];
  state.livePreviews = {};
  bindListeners();
  try {
    const res = await emitAsync('canvas:getState', { roomId, chainOwnerId: state.chainOwnerId });
    for (const action of res.actions) upsertAction(action);
    state.ready = true;
  } catch (e) {
    state.loadError = e.message || '加载画板失败';
  }
}

function sendStrokeProgress(roomId, chainOwnerId, payload) {
  getSocket().emit('canvas:strokeProgress', { roomId, chainOwnerId, ...payload });
}

function strokeEnd(roomId, chainOwnerId, payload) {
  return emitAsync('canvas:strokeEnd', { roomId, chainOwnerId, ...payload });
}

function fill(roomId, chainOwnerId, payload) {
  return emitAsync('canvas:fill', { roomId, chainOwnerId, ...payload });
}

function eraseStroke(roomId, chainOwnerId, targetActionId) {
  return emitAsync('canvas:eraseStroke', { roomId, chainOwnerId, targetActionId });
}

function undo(roomId, chainOwnerId) {
  return emitAsync('canvas:undo', { roomId, chainOwnerId });
}

function redo(roomId, chainOwnerId) {
  return emitAsync('canvas:redo', { roomId, chainOwnerId });
}

function clear(roomId, chainOwnerId) {
  return emitAsync('canvas:clear', { roomId, chainOwnerId });
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
