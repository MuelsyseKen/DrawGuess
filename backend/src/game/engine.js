// 竞猜模式对局编排（见 FULLREADME.md 第13节）：持有 io，负责回合推进、计时器超时后的广播、
// 计分、断线处理。状态本身存在 backend/src/game/store.js（纯数据，不依赖 io）。
//
// 之所以没有沿用 rooms/store.js "onTimeout 回调由调用方传入" 的写法，是因为这里的时间驱动的
// 状态转换（选词超时自动选词、绘画超时结算、断线暂停/恢复）本身就需要广播，广播发生在哪个
// socket 事件触发都一样——所以干脆让这一层直接持有 io，比每个触发点都手写一遍回调更简单。
// 见 HISTORY.md 这个 Phase 的架构决定记录。
'use strict';

const roomStore = require('../rooms/store');
const canvasStore = require('../canvas/store');
const wordbanks = require('../wordbanks');
const gameStore = require('./store');

const CHOOSE_WORD_TIMEOUT_MS = 20 * 1000;
const TURN_RESULT_DISPLAY_MS = 4 * 1000; // 回合结束后，停留展示结果一段时间再开始下一回合
const MIN_PLAYERS_TO_CONTINUE = 2;

function roomChannel(roomId) {
  return `room:${roomId}`;
}

function broadcastRoomStatus(io, room) {
  io.to(roomChannel(room.id)).emit('room:statusUpdated', { status: room.status });
}

// 找到某个 userId 当前的 socketId（用于私发只有作画者能看到的字段），找不到（比如刚好断线）返回 null。
function findSocketId(room, userId) {
  const player = room.players.find((p) => p.userId === userId);
  return player ? player.socketId : null;
}

function emitToUser(io, room, userId, event, payload) {
  const socketId = findSocketId(room, userId);
  if (!socketId) return;
  io.to(socketId).emit(event, payload);
}

// 按第13.5节公式：第 rank（1-based）个猜中的人得分，最低 20 分封顶保底（"最后阶段只有参与分"）。
function guessScore(rank) {
  return Math.max(20, 100 - (rank - 1) * 15);
}

function eligibleGuesserCount(session) {
  return session.turnOrder.filter((id) => id !== session.drawerId).length;
}

// 推算下一个作画者：在 turnOrder 里找上一个作画者的位置，往后挪一位；找不到（比如刚好被移出
// 了房间）就当作"从头开始新一轮"处理，不强行对齐原来的顺序——这是本 Phase 对"作画者中途被
// 移出该怎么继续排"的一个简化处理，记入 HISTORY.md。
function advanceDrawer(session) {
  const order = session.turnOrder;
  if (session.lastDrawerId === null) {
    return { drawerId: order[0], wrapped: false };
  }
  const idx = order.indexOf(session.lastDrawerId);
  if (idx === -1) {
    return { drawerId: order[0], wrapped: false };
  }
  const nextIdx = (idx + 1) % order.length;
  return { drawerId: order[nextIdx], wrapped: nextIdx === 0 };
}

function endGame(io, roomId) {
  const session = gameStore.getSession(roomId);
  const room = roomStore.getRoom(roomId);
  if (!session) return;

  const scores = gameStore.scoresObject(session);
  const ranking = Object.entries(scores)
    .map(([userId, score]) => ({ userId: Number(userId), score }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.userId - b.userId))
    .map((entry, i) => ({ ...entry, rank: i + 1 }));

  io.to(roomChannel(roomId)).emit('game:ended', { scores, ranking });
  gameStore.destroySession(roomId);

  if (room) {
    room.status = 'waiting';
    broadcastRoomStatus(io, room);
  }
}

function beginTurn(io, roomId) {
  const session = gameStore.getSession(roomId);
  const room = roomStore.getRoom(roomId);
  if (!session || !room) return;

  const { drawerId, wrapped } = advanceDrawer(session);
  if (wrapped) session.round += 1;
  if (session.round > session.totalRounds) {
    endGame(io, roomId);
    return;
  }

  session.lastDrawerId = drawerId;
  session.drawerId = drawerId;
  session.phase = 'choosingWord';
  session.word = null;
  session.correctGuessers = [];
  session.turnDeadline = Date.now() + CHOOSE_WORD_TIMEOUT_MS;

  // 每回合开始清空画板（新的作画者、新的画），复用 Phase 3 的 clear，归属给这回合的作画者。
  canvasStore.clear(roomId, drawerId);
  io.to(roomChannel(roomId)).emit('canvas:cleared', {});

  const { wordSource, wordCategory } = room.settings;
  if (wordSource === 'system') {
    session.wordCandidates = wordbanks.pickWords(wordCategory, 3);
    emitToUser(io, room, drawerId, 'game:wordChoices', { candidates: session.wordCandidates });
  } else {
    session.wordCandidates = null;
  }

  io.to(roomChannel(roomId)).emit('game:turnStarted', {
    drawerId,
    round: session.round,
    totalRounds: session.totalRounds,
    phase: 'choosingWord',
    deadline: session.turnDeadline,
  });

  gameStore.schedulePhaseTimer(session, CHOOSE_WORD_TIMEOUT_MS, () => autoChooseWord(io, roomId));
}

function autoChooseWord(io, roomId) {
  const session = gameStore.getSession(roomId);
  if (!session || session.phase !== 'choosingWord') return;

  if (session.wordCandidates && session.wordCandidates.length > 0) {
    const word = session.wordCandidates[Math.floor(Math.random() * session.wordCandidates.length)];
    applyChosenWord(io, roomId, word);
  } else {
    // 自定义出题模式超时没输入：没有词就没法进入绘画阶段，直接判这回合作废，0 分跳过。
    forfeitTurn(io, roomId);
  }
}

function chooseWord(io, roomId, userId, rawWord) {
  const session = gameStore.getSession(roomId);
  const room = roomStore.getRoom(roomId);
  if (!session || !room) return { ok: false, error: 'NO_ACTIVE_GAME', message: '当前没有进行中的对局' };
  if (session.phase !== 'choosingWord') return { ok: false, error: 'INVALID_STATE', message: '当前不是选词阶段' };
  if (session.drawerId !== userId) return { ok: false, error: 'NOT_YOUR_TURN', message: '还没轮到你选词' };

  const word = typeof rawWord === 'string' ? rawWord.trim() : '';
  if (!word || word.length > 20) {
    return { ok: false, error: 'INVALID_WORD', message: '词语不能为空，且不超过 20 个字符' };
  }
  if (session.wordCandidates && !session.wordCandidates.includes(word)) {
    return { ok: false, error: 'INVALID_WORD', message: '只能从候选词里选' };
  }

  gameStore.clearPhaseTimer(session);
  applyChosenWord(io, roomId, word);
  return { ok: true };
}

function applyChosenWord(io, roomId, word) {
  const session = gameStore.getSession(roomId);
  const room = roomStore.getRoom(roomId);
  if (!session || !room) return;

  session.word = word;
  session.phase = 'drawing';
  const drawMs = room.settings.drawSeconds * 1000;
  session.turnDeadline = Date.now() + drawMs;

  io.to(roomChannel(roomId)).emit('game:wordChosen', { wordLength: word.length, deadline: session.turnDeadline });
  emitToUser(io, room, session.drawerId, 'game:wordRevealed', { word });

  gameStore.schedulePhaseTimer(session, drawMs, () => timeUpEndTurn(io, roomId));
}

function timeUpEndTurn(io, roomId) {
  endTurn(io, roomId);
}

// 正常结束一回合（超时或所有人猜中）：结算分数、公布谜底，展示一段时间后进入下一回合。
function endTurn(io, roomId) {
  const session = gameStore.getSession(roomId);
  if (!session) return;
  gameStore.clearPhaseTimer(session);

  const drawerScore = 10 * session.correctGuessers.length;
  gameStore.addScore(session, session.drawerId, drawerScore);

  io.to(roomChannel(roomId)).emit('game:turnEnded', {
    drawerId: session.drawerId,
    word: session.word,
    correctGuessers: session.correctGuessers,
    drawerScore,
    scores: gameStore.scoresObject(session),
  });

  gameStore.schedulePhaseTimer(session, TURN_RESULT_DISPLAY_MS, () => beginTurn(io, roomId));
}

// 作画者中途被移出房间（断线超时）导致的强制跳过：不给任何人加分，谜底可能还没定（选词阶段），
// 直接公布 null，前端按"这回合作废"展示即可。
function forfeitTurn(io, roomId) {
  const session = gameStore.getSession(roomId);
  if (!session) return;
  gameStore.clearPhaseTimer(session);

  io.to(roomChannel(roomId)).emit('game:turnEnded', {
    drawerId: session.drawerId,
    word: session.word,
    correctGuessers: session.correctGuessers,
    drawerScore: 0,
    scores: gameStore.scoresObject(session),
    forfeited: true,
  });

  gameStore.schedulePhaseTimer(session, TURN_RESULT_DISPLAY_MS, () => beginTurn(io, roomId));
}

function startGame(io, room, hostUserId) {
  if (room.hostUserId !== hostUserId) return { ok: false, error: 'NOT_HOST', message: '只有房主可以开始游戏' };
  if (room.mode !== 'guess') return { ok: false, error: 'INVALID_STATE', message: '当前房间不是竞猜模式' };
  if (room.status !== 'waiting') return { ok: false, error: 'GAME_ALREADY_RUNNING', message: '对局已经在进行中' };
  if (room.players.length < MIN_PLAYERS_TO_CONTINUE) {
    return { ok: false, error: 'NOT_ENOUGH_PLAYERS', message: '至少需要 2 名玩家才能开始' };
  }

  const turnOrder = room.players.map((p) => p.userId);
  gameStore.createSession(room.id, { turnOrder, totalRounds: room.settings.rounds });
  room.status = 'playing';

  io.to(roomChannel(room.id)).emit('game:started', {
    turnOrder,
    round: 1,
    totalRounds: room.settings.rounds,
  });
  broadcastRoomStatus(io, room);

  beginTurn(io, room.id);
  return { ok: true };
}

// 聊天 + 猜词共用一个入口（见第13.7节 game:chat）。
function handleChat(io, room, userId, rawText) {
  const session = gameStore.getSession(room.id);
  if (!session) return { ok: false, error: 'NO_ACTIVE_GAME', message: '当前没有进行中的对局' };

  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (!text || text.length > 200) {
    return { ok: false, error: 'INVALID_MESSAGE', message: '消息不能为空，且不超过 200 个字符' };
  }

  const isDrawer = userId === session.drawerId;
  const alreadyCorrect = session.correctGuessers.some((g) => g.userId === userId);
  if (alreadyCorrect) {
    return { ok: false, error: 'ALREADY_GUESSED_CORRECTLY', message: '你已经猜中了，本回合不能再发言（防止剧透）' };
  }

  const isMatch = !isDrawer && session.phase === 'drawing' && session.word && text === session.word;
  if (!isMatch) {
    io.to(roomChannel(room.id)).emit('game:chatMessage', { userId, text });
    return { ok: true };
  }

  const rank = session.correctGuessers.length + 1;
  const score = guessScore(rank);
  session.correctGuessers.push({ userId, rank, score });
  gameStore.addScore(session, userId, score);
  io.to(roomChannel(room.id)).emit('game:correctGuess', { userId, rank, score });

  if (session.correctGuessers.length >= eligibleGuesserCount(session)) {
    endTurn(io, room.id);
  }
  return { ok: true };
}

function getStateForUser(room, userId) {
  const session = gameStore.getSession(room.id);
  if (!session) return { active: false };
  const base = {
    active: true,
    drawerId: session.drawerId,
    phase: session.phase,
    round: session.round,
    totalRounds: session.totalRounds,
    deadline: session.turnDeadline,
    correctGuessers: session.correctGuessers,
    scores: gameStore.scoresObject(session),
    wordLength: session.word ? session.word.length : null,
  };
  if (userId === session.drawerId) {
    base.word = session.word;
    base.wordCandidates = session.wordCandidates;
  }
  return base;
}

// --- 断线相关钩子：由 socket/rooms.js 在对应的房间层事件里调用（见第13.6节）---

function onPlayerDisconnected(io, roomId, userId) {
  const session = gameStore.getSession(roomId);
  if (!session || session.drawerId !== userId) return;
  gameStore.pausePhaseTimer(session);
}

function onPlayerReconnected(io, roomId, userId) {
  const session = gameStore.getSession(roomId);
  if (!session || session.drawerId !== userId) return;
  const deadline = gameStore.resumePhaseTimer(session);
  if (deadline) {
    io.to(roomChannel(roomId)).emit('game:timerResumed', { deadline });
  }
}

// 玩家被正式移出房间（宽限期超时或主动离开）时调用；房间层已经完成 players 数组的移除，
// 这里只需要同步维护对局层的 turnOrder / 立即结算受影响的回合。
function onPlayerRemoved(io, roomId, userId) {
  const session = gameStore.getSession(roomId);
  if (!session) return;

  const idx = session.turnOrder.indexOf(userId);
  if (idx === -1) return;
  session.turnOrder.splice(idx, 1);

  if (session.turnOrder.length < MIN_PLAYERS_TO_CONTINUE) {
    endGame(io, roomId);
    return;
  }

  if (session.drawerId === userId) {
    // 正在画的这位被移出：这回合直接作废，跳到下一位（advanceDrawer 里 indexOf 会找不到
    // lastDrawerId 从而"重新从头数"，是本 Phase 的已知简化，见 advanceDrawer 注释）。
    forfeitTurn(io, roomId);
    return;
  }

  // 被移出的是猜题方：不影响当前回合，但要重新检查"是否所有在场猜题方都已猜中"
  // （分母变小了，可能因此提前触发结算）。
  if (session.phase === 'drawing' && session.correctGuessers.length >= eligibleGuesserCount(session)) {
    endTurn(io, roomId);
  }
}

module.exports = {
  startGame,
  chooseWord,
  handleChat,
  getStateForUser,
  onPlayerDisconnected,
  onPlayerReconnected,
  onPlayerRemoved,
};
