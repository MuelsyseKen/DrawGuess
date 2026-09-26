// 接龙模式对局内存状态（见 FULLREADME.md 第14.1节）：按 roomId 关联，纯内存，不做持久化。
// 结构和写法参照 backend/src/game/store.js（竞猜模式），职责边界也一样：这里只负责
// "状态是什么"，不涉及 Socket.io 广播——回合推进/超时广播/结算由 backend/src/chain/engine.js 负责。
'use strict';

// roomId -> session
const sessions = new Map();

// 组装接龙模式画板会话的复合 key：接龙模式一个房间同时有 N 条链、N 块独立画板
// （见第14.5节），不能像竞猜模式那样直接用 roomId 当 canvas/store.js 的 key，
// 否则所有链会画到同一块板上。canvas/store.js 本身不需要改——它的 key 只是个不透明字符串。
function chainCanvasKey(roomId, chainOwnerId) {
  return `${roomId}::chain::${chainOwnerId}`;
}

function createSession(roomId, { turnOrder, totalRings }) {
  const chains = new Map();
  turnOrder.forEach((ownerId, ownerIndex) => {
    chains.set(ownerId, {
      ownerId,
      ownerIndex, // 该链在 turnOrder 里的起始位置，用于第14.2节的轮转公式
      originalWord: null,
      wordCandidates: null, // 仅 wordSource==='system' 时有值
      autoFail: false, // true 表示这条链从一开始就没有有效词（见第14.3节），结算时不进入投票，直接判不通过
      currentDrawWord: null, // 当前绘画回合（如果轮到这条链画）临时持有的题目，回合结束后清空
      steps: [], // [{ turn, type:'draw'|'guess', by, word?, guessWord?, actions?, timedOut? }]
    });
  });

  const session = {
    turnOrder: [...turnOrder], // 开始游戏那一刻的玩家加入顺序快照，本局固定不变（见第14.7节的简化说明）
    totalRings, // 房间设置里的 chainRounds（"环数"）
    totalTurns: totalRings * 2, // 每环 = 1 次画 + 1 次猜，见第14.2节
    turn: 1,
    phase: 'choosingWord', // 'choosingWord' | 'drawing' | 'guessing' | 'reviewing' | 'ended'
    chains,
    turnDeadline: null,
    chosenOwners: new Set(), // choosingWord 阶段：已经选好词的 owner
    doneUsers: new Set(), // drawing/guessing 阶段：本回合已完成（提前完成作画 / 已提交猜词）的用户
    removedUserIds: new Set(), // 对局中途被移出房间的玩家，见第14.7节
    scores: new Map(),
    review: {
      order: [...turnOrder], // 结算时按这个顺序逐条公示（第14.6节"按顺序公布"）
      index: 0,
      votes: new Map(), // 当前正在评审的这条链：voterUserId -> boolean
      eligibleVoters: [], // 当前正在评审的这条链：可投票的玩家 id 列表
      voteDeadline: null,
    },
    timers: {
      phaseTimer: null,
      phaseTimerCallback: null,
    },
  };
  for (const userId of turnOrder) session.scores.set(userId, 0);
  sessions.set(roomId, session);
  return session;
}

function getSession(roomId) {
  return sessions.get(roomId) || null;
}

function destroySession(roomId) {
  const session = sessions.get(roomId);
  if (session && session.timers.phaseTimer) clearTimeout(session.timers.phaseTimer);
  sessions.delete(roomId);
}

function schedulePhaseTimer(session, ms, callback) {
  session.timers.phaseTimerCallback = callback;
  session.timers.phaseTimer = setTimeout(callback, ms);
}

function clearPhaseTimer(session) {
  if (session.timers.phaseTimer) clearTimeout(session.timers.phaseTimer);
  session.timers.phaseTimer = null;
  session.timers.phaseTimerCallback = null;
}

// 第14.2节轮转公式：链的 owner 在 turnOrder 里的位置 + (turn-1) 按玩家总数取模，
// 就是这一回合负责这条链（画或猜，取决于 turn 奇偶）的玩家。turnOrder 本身固定不变
// （见第14.7节简化说明），即便某个位置上的玩家中途被移出房间，公式也不重新编号——
// 那一位置分配到的动作会在 engine.js 里被当成"这个人不在了，直接判定本步空缺"处理。
function assignedPlayerId(session, chain) {
  const n = session.turnOrder.length;
  const idx = (chain.ownerIndex + session.turn - 1) % n;
  return session.turnOrder[idx];
}

// 当前是否轮到 userId 在这条链（chainOwnerId 标识）上画画（见第14.5节"画板权限"）。
// 房间没有进行中的接龙对局时返回 false（不是 true！和竞猜模式的 canDraw 语义不同——
// 接龙模式的画板从来不存在"没有对局就任意人可画"的场景，因为测试页 canvas-test 走的是
// 不带 chainOwnerId 的普通 roomId key，不受这个函数影响，见 socket/canvas.js）。
function canDraw(roomId, chainOwnerId, userId) {
  const session = sessions.get(roomId);
  if (!session) return false;
  if (session.phase !== 'drawing') return false;
  const chain = session.chains.get(chainOwnerId);
  if (!chain) return false;
  return assignedPlayerId(session, chain) === userId;
}

function addScore(session, userId, delta) {
  session.scores.set(userId, (session.scores.get(userId) || 0) + delta);
}

function addScoreToAll(session, userIds, delta) {
  for (const userId of userIds) addScore(session, userId, delta);
}

function scoresObject(session) {
  const obj = {};
  for (const [userId, score] of session.scores.entries()) obj[userId] = score;
  return obj;
}

// 本回合"是否所有该动作的人都已完成"——分母要扣掉已经被移出房间的玩家，
// 否则一旦有人中途掉线超时被踢，回合会一直等不到这个人交作业，只能靠超时兜底，
// 体验上不够及时（见第14.7节）。
function allDoneForTurn(session) {
  const active = session.turnOrder.filter((id) => !session.removedUserIds.has(id));
  if (active.length === 0) return true;
  return active.every((id) => session.doneUsers.has(id));
}

module.exports = {
  sessions,
  chainCanvasKey,
  createSession,
  getSession,
  destroySession,
  schedulePhaseTimer,
  clearPhaseTimer,
  assignedPlayerId,
  canDraw,
  addScore,
  addScoreToAll,
  scoresObject,
  allDoneForTurn,
};
