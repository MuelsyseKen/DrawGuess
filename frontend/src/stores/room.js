// 房间状态 store：订阅 socket 广播事件维护当前房间的实时状态（见 FULLREADME.md 第11.4节协议）。
// 写法参照 stores/auth.js —— 轻量 reactive + composable，不引入 Pinia（Phase 2 状态还不算复杂）。
import { reactive, readonly } from 'vue';
import { getSocket, emitAsync } from '../socket/client';
import router from '../router';

const state = reactive({
  room: null, // 当前所在房间的完整视图，见后端 toPublicRoomView；不在房间里时为 null
  disconnectedPlayers: {}, // userId -> reconnectTimeoutMs，仅用于 UI 提示"某玩家掉线重连中"
});

let listenersBound = false;

function findPlayer(userId) {
  if (!state.room) return null;
  return state.room.players.find((p) => p.userId === userId) || null;
}

function bindListeners() {
  if (listenersBound) return;
  listenersBound = true;
  const socket = getSocket();

  socket.on('room:playerJoined', ({ player }) => {
    if (!state.room) return;
    if (!findPlayer(player.userId)) {
      state.room.players.push(player);
    }
  });

  socket.on('room:playerDisconnected', ({ userId, reconnectTimeoutMs }) => {
    if (!state.room) return;
    const player = findPlayer(userId);
    if (player) player.connected = false;
    state.disconnectedPlayers[userId] = reconnectTimeoutMs;
  });

  socket.on('room:playerReconnected', ({ userId }) => {
    if (!state.room) return;
    const player = findPlayer(userId);
    if (player) player.connected = true;
    delete state.disconnectedPlayers[userId];
  });

  socket.on('room:playerLeft', ({ userId, newHostUserId }) => {
    if (!state.room) return;
    state.room.players = state.room.players.filter((p) => p.userId !== userId);
    delete state.disconnectedPlayers[userId];
    if (newHostUserId) {
      state.room.hostUserId = newHostUserId;
      state.room.players.forEach((p) => {
        p.isHost = p.userId === newHostUserId;
      });
    }
  });

  socket.on('room:settingsUpdated', ({ settings }) => {
    if (!state.room) return;
    state.room.settings = settings;
  });

  socket.on('room:visibilityUpdated', ({ isPublic }) => {
    if (!state.room) return;
    state.room.isPublic = isPublic;
  });

  socket.on('room:closed', () => {
    state.room = null;
    state.disconnectedPlayers = {};
  });

  // Phase 4：对局开始/结束都会改变 room.status，房间大厅页/公开列表据此同步；
  // 对局开始时所有房间成员（含房主自己，因为也在房间 channel 里）统一跳转到游戏内页面，
  // 不需要每个发起方自己单独处理跳转（见 FULLREADME 第13.8节 / 第14节）。
  // Phase 5 起按 room.mode 分流到竞猜/接龙两个不同的游戏内页面。
  socket.on('room:statusUpdated', ({ status }) => {
    if (!state.room) return;
    state.room.status = status;
  });

  socket.on('game:started', () => {
    if (!state.room) return;
    const routeName = state.room.mode === 'chain' ? 'chain-game' : 'guess-game';
    router.push({ name: routeName, params: { id: state.room.id } });
  });
}

async function createRoom(mode, isPublic, settings) {
  bindListeners();
  const res = await emitAsync('room:create', { mode, isPublic, settings });
  state.room = res.room;
  state.disconnectedPlayers = {};
  return res.room;
}

async function joinByCode(inviteCode) {
  bindListeners();
  const res = await emitAsync('room:joinByCode', { inviteCode });
  state.room = res.room;
  state.disconnectedPlayers = {};
  return res.room;
}

async function joinPublic(roomId) {
  bindListeners();
  const res = await emitAsync('room:joinPublic', { roomId });
  state.room = res.room;
  state.disconnectedPlayers = {};
  return res.room;
}

async function leaveRoom() {
  await emitAsync('room:leave', {});
  state.room = null;
  state.disconnectedPlayers = {};
}

async function updateSettings(settings) {
  const res = await emitAsync('room:updateSettings', { settings });
  state.room = res.room;
  return res.room;
}

async function setPublic(isPublic) {
  const res = await emitAsync('room:setPublic', { isPublic });
  state.room = res.room;
  return res.room;
}

// 页面挂载（比如直接刷新/深链到房间大厅页）时用来兜底同步一次当前房间状态
async function syncCurrent() {
  bindListeners();
  const res = await emitAsync('room:getCurrent', {});
  state.room = res.room;
  if (!res.room) state.disconnectedPlayers = {};
  return res.room;
}

export function useRoom() {
  bindListeners();
  return {
    state: readonly(state),
    createRoom,
    joinByCode,
    joinPublic,
    leaveRoom,
    updateSettings,
    setPublic,
    syncCurrent,
  };
}
