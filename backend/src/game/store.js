// 竞猜模式对局内存状态（见 FULLREADME.md 第13.1节）：按 roomId 关联，纯内存，不做持久化。
// 独立于 rooms/store.js（类比 canvas/store.js 的做法），房间销毁或对局结束时由调用方清理。
//
// 这里只负责"状态是什么"，不涉及 Socket.io 广播——真正的回合推进/超时后如何广播由
// backend/src/game/engine.js 负责（它需要持有 io 实例，纯状态层不应该依赖 io）。
'use strict';

// roomId -> session
const sessions = new Map();

function createSession(roomId, { turnOrder, totalRounds }) {
  const session = {
    turnOrder: [...turnOrder], // 开始游戏那一刻的玩家加入顺序快照
    lastDrawerId: null, // 上一个作画者，用于推算下一个（按 turnOrder 里的位置）；null 表示本局还没开始第一回合
    round: 1,
    totalRounds,
    drawerId: null,
    phase: 'choosingWord', // 'choosingWord' | 'drawing'
    wordCandidates: null, // 仅 wordSource==='system' 时有值
    word: null,
    turnDeadline: null,
    correctGuessers: [], // [{ userId, rank, score }]
    scores: new Map(), // userId -> 累计得分
    turnRecords: [], // Phase 6：每回合结束时缓存一份 { drawerId, word, actions }，供 endGame 落库个人作画记录用
    timers: {
      phaseTimer: null,
      phaseTimerCallback: null,
      phaseTimerRemainingMs: null, // 非空表示当前处于"作画者断线，倒计时暂停"状态
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

// 安排下一次阶段超时回调；调用前应确保旧的计时器已经清理（见 clearPhaseTimer）。
function schedulePhaseTimer(session, ms, callback) {
  session.timers.phaseTimerCallback = callback;
  session.timers.phaseTimerRemainingMs = null;
  session.timers.phaseTimer = setTimeout(callback, ms);
}

function clearPhaseTimer(session) {
  if (session.timers.phaseTimer) clearTimeout(session.timers.phaseTimer);
  session.timers.phaseTimer = null;
  session.timers.phaseTimerCallback = null;
  session.timers.phaseTimerRemainingMs = null;
}

// 暂停当前阶段倒计时（作画者断线时用）：记住剩余时长，清掉真正的定时器。
function pausePhaseTimer(session) {
  if (!session.timers.phaseTimer) return;
  const remaining = Math.max(0, session.turnDeadline - Date.now());
  clearTimeout(session.timers.phaseTimer);
  session.timers.phaseTimer = null;
  session.timers.phaseTimerRemainingMs = remaining;
}

// 恢复之前暂停的倒计时（作画者宽限期内重连时用），返回新的 deadline；没有可恢复的计时器则返回 null。
function resumePhaseTimer(session) {
  if (session.timers.phaseTimerRemainingMs == null || !session.timers.phaseTimerCallback) return null;
  const ms = session.timers.phaseTimerRemainingMs;
  const callback = session.timers.phaseTimerCallback;
  session.turnDeadline = Date.now() + ms;
  session.timers.phaseTimerRemainingMs = null;
  session.timers.phaseTimer = setTimeout(callback, ms);
  return session.turnDeadline;
}

function addScore(session, userId, delta) {
  session.scores.set(userId, (session.scores.get(userId) || 0) + delta);
}

function scoresObject(session) {
  const obj = {};
  for (const [userId, score] of session.scores.entries()) obj[userId] = score;
  return obj;
}

// 第13.4节"画板权限收紧"：房间没有进行中的对局时不限制（Phase 3 行为，测试页仍然适用）；
// 有对局时，选词阶段谁都不能画（词还没定），绘画阶段只有当前作画者能画。
function canDraw(roomId, userId) {
  const session = sessions.get(roomId);
  if (!session) return true;
  if (session.phase !== 'drawing') return false;
  return session.drawerId === userId;
}

module.exports = {
  createSession,
  getSession,
  destroySession,
  schedulePhaseTimer,
  clearPhaseTimer,
  pausePhaseTimer,
  resumePhaseTimer,
  addScore,
  scoresObject,
  canDraw,
};
