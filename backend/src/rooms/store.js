// 房间内存状态（见 FULLREADME.md 第6.2节 / 第11.1节）：纯内存 Map，服务重启即清空，不做持久化。
'use strict';

const crypto = require('node:crypto');

// roomId -> room
const rooms = new Map();
// userId -> { roomId, socketId, disconnectTimer } —— 用于断线重连时快速定位玩家当前所在房间
// disconnectTimer 非空表示该玩家当前处于"已断线，60 秒宽限期倒计时"状态
const playerIndex = new Map();

// 断线重连宽限期，默认 60 秒；仅供测试用 env 覆盖成更短的值，生产环境不要设置这个变量。
const DISCONNECT_GRACE_MS = process.env.DISCONNECT_GRACE_MS_OVERRIDE
  ? Number(process.env.DISCONNECT_GRACE_MS_OVERRIDE)
  : 60 * 1000;

const INVITE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉容易混淆的 I/O/0/1

function genInviteCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => INVITE_CODE_CHARS[Math.floor(Math.random() * INVITE_CODE_CHARS.length)]).join('');
  } while (findByInviteCode(code)); // 极小概率碰撞，简单重试即可
  return code;
}

function findByInviteCode(code) {
  for (const room of rooms.values()) {
    if (room.inviteCode === code) return room;
  }
  return null;
}

function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

function getRoomByUserId(userId) {
  const entry = playerIndex.get(userId);
  if (!entry) return null;
  return rooms.get(entry.roomId) || null;
}

function createRoom({ mode, isPublic, settings, host }) {
  const id = crypto.randomUUID();
  const room = {
    id,
    inviteCode: genInviteCode(),
    mode,
    isPublic: Boolean(isPublic),
    status: 'waiting',
    hostUserId: host.userId,
    players: [
      {
        userId: host.userId,
        username: host.username,
        socketId: host.socketId,
        isHost: true,
        connected: true,
        joinedAt: Date.now(),
      },
    ],
    settings,
    createdAt: Date.now(),
  };
  rooms.set(id, room);
  playerIndex.set(host.userId, { roomId: id, socketId: host.socketId });
  return room;
}

// 把某个 userId 从其当前房间（如果有）移除，返回 { room, newHostUserId, closed } 或 null（不在任何房间里）
// 无论玩家当前是"在线"还是"宽限期内断线"，都会清掉挂起的重连计时器。
function removePlayer(userId) {
  const entry = playerIndex.get(userId);
  if (!entry) return null;
  if (entry.disconnectTimer) clearTimeout(entry.disconnectTimer);
  const room = rooms.get(entry.roomId);
  playerIndex.delete(userId);
  if (!room) return null;

  const idx = room.players.findIndex((p) => p.userId === userId);
  if (idx === -1) return null;
  const wasHost = room.players[idx].isHost;
  room.players.splice(idx, 1);

  if (room.players.length === 0) {
    rooms.delete(room.id);
    return { room, newHostUserId: null, closed: true };
  }

  let newHostUserId = null;
  if (wasHost) {
    room.players[0].isHost = true;
    room.hostUserId = room.players[0].userId;
    newHostUserId = room.hostUserId;
  }

  return { room, newHostUserId, closed: false };
}

// 标记玩家为"已断线"，不立即移出房间，留出 60 秒宽限期给客户端重连。
// onTimeout(userId) 会在宽限期结束、且期间没有重连时被调用（由调用方负责用它去做最终移除 + 广播）。
function markDisconnected(userId, onTimeout) {
  const entry = playerIndex.get(userId);
  if (!entry) return null;
  const room = rooms.get(entry.roomId);
  if (!room) return null;
  const player = room.players.find((p) => p.userId === userId);
  if (!player) return null;

  player.connected = false;
  if (entry.disconnectTimer) clearTimeout(entry.disconnectTimer); // 理论上不该出现重复断线，防御性清一下
  entry.disconnectTimer = setTimeout(() => {
    entry.disconnectTimer = null;
    onTimeout(userId);
  }, DISCONNECT_GRACE_MS);

  return room;
}

// 宽限期内重新连接：清掉倒计时，把玩家标回在线状态并绑定新 socketId。
// 找不到"处于宽限期"的记录（比如已经超时被移除，或本来就没断线）时返回 null。
function reconnectPlayer(userId, newSocketId) {
  const entry = playerIndex.get(userId);
  if (!entry || !entry.disconnectTimer) return null;
  clearTimeout(entry.disconnectTimer);
  entry.disconnectTimer = null;
  entry.socketId = newSocketId;

  const room = rooms.get(entry.roomId);
  if (!room) return null;
  const player = room.players.find((p) => p.userId === userId);
  if (!player) return null;
  player.connected = true;
  player.socketId = newSocketId;
  return room;
}

function addPlayer(room, { userId, username, socketId }) {
  const player = {
    userId,
    username,
    socketId,
    isHost: false,
    connected: true,
    joinedAt: Date.now(),
  };
  room.players.push(player);
  playerIndex.set(userId, { roomId: room.id, socketId });
  return player;
}

function listPublicRooms(mode) {
  const result = [];
  for (const room of rooms.values()) {
    if (!room.isPublic || room.status !== 'waiting') continue;
    if (mode && room.mode !== mode) continue;
    const host = room.players.find((p) => p.isHost);
    result.push({
      id: room.id,
      mode: room.mode,
      hostUsername: host ? host.username : '',
      playerCount: room.players.length,
      maxPlayers: room.settings.maxPlayers,
      createdAt: room.createdAt,
    });
  }
  result.sort((a, b) => b.createdAt - a.createdAt);
  return result;
}

// 房间对外展示视图：不暴露 socketId；inviteCode 是否包含由调用方决定（公开列表不给，房间详情给）
function toPublicRoomView(room, { includeInviteCode } = { includeInviteCode: true }) {
  return {
    id: room.id,
    inviteCode: includeInviteCode ? room.inviteCode : undefined,
    mode: room.mode,
    isPublic: room.isPublic,
    status: room.status,
    hostUserId: room.hostUserId,
    settings: room.settings,
    createdAt: room.createdAt,
    players: room.players.map((p) => ({
      userId: p.userId,
      username: p.username,
      isHost: p.isHost,
      connected: p.connected,
    })),
  };
}

module.exports = {
  rooms,
  createRoom,
  getRoom,
  getRoomByUserId,
  removePlayer,
  addPlayer,
  markDisconnected,
  reconnectPlayer,
  findByInviteCode,
  listPublicRooms,
  toPublicRoomView,
  DISCONNECT_GRACE_MS,
};
