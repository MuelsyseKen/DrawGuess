// 接龙模式对局编排（见 FULLREADME.md 第14节）：持有 io，负责回合推进、计时器超时后的广播、
// 计分、结算评审。状态本身存在 backend/src/chain/store.js（纯数据，不依赖 io）。
// 架构上延续 game/engine.js（竞猜模式）的选择：这一层直接持有 io，原因同那边顶部注释——
// 时间驱动的状态转换本身就需要广播，不管由哪个 socket 事件触发都一样。
'use strict';

const roomStore = require('../rooms/store');
const canvasStore = require('../canvas/store');
const wordbanks = require('../wordbanks');
const chainStore = require('./store');
const recordsStore = require('../records/store');

const CHOOSE_WORD_TIMEOUT_MS = 20 * 1000; // 选词兜底时长，和竞猜模式一致（见第13.2节）
const REVIEW_DISPLAY_MS = 5 * 1000; // 结算时每条链公示结果后，停留展示一段时间再看下一条
const REVIEW_VOTE_TIMEOUT_MS = 20 * 1000; // "评分环节"投票兜底时长
const MIN_PLAYERS_TO_START = 4; // 接龙模式房间设置范围是 4~32 人（第4.2节），开局门槛沿用这个下限
const MIN_PLAYERS_TO_CONTINUE = 2; // 对局中途掉到这个人数以下直接提前结算（见第14.7节）

// 结算得分：文档只给了"一致直接加分""半数以上同意则加分"的方向性描述（第5.2节），
// 没给具体数字，本 Phase 自己拍板一版（同 Phase 4 计分公式的处理方式），记入 HISTORY.md：
// 链条最终词与起始词完全一致 -> 该链条每个参与者（owner + 所有画过/猜过这条链的人，去重）100 分；
// 不一致但评审投票半数以上通过 -> 60 分；都不满足 -> 0 分。
const CHAIN_MATCH_SCORE = 100;
const CHAIN_VOTE_APPROVED_SCORE = 60;

function roomChannel(roomId) {
  return `room:${roomId}`;
}

function broadcastRoomStatus(io, room) {
  io.to(roomChannel(room.id)).emit('room:statusUpdated', { status: room.status });
}

function findSocketId(room, userId) {
  const player = room.players.find((p) => p.userId === userId);
  return player ? player.socketId : null;
}

function emitToUser(io, room, userId, event, payload) {
  const socketId = findSocketId(room, userId);
  if (!socketId) return;
  io.to(socketId).emit(event, payload);
}

function currentDrawWordFor(chain) {
  if (chain.steps.length === 0) return chain.originalWord;
  const last = chain.steps[chain.steps.length - 1];
  return last.type === 'guess' ? last.guessWord : chain.originalWord;
}

function lastGuessWord(chain) {
  for (let i = chain.steps.length - 1; i >= 0; i -= 1) {
    if (chain.steps[i].type === 'guess') return chain.steps[i].guessWord;
  }
  return null;
}

// 一条链的"参与者"：owner 本身 + 所有在 steps 里画过/猜过这条链的人，去重。
// 用于结算加分（第14.6节：链条整体是否成立，参与者一起获得/不获得这条链的分数）。
function uniqueParticipants(chain) {
  const set = new Set([chain.ownerId]);
  for (const step of chain.steps) set.add(step.by);
  return [...set];
}

// Phase 6：接龙模式每一步"画"在 endDrawPhase 时就已经把 { by, word, actions } 存进了
// chain.steps（第14.4节），不需要像竞猜模式那样另外从 canvasStore 里补捞一次——这里直接
// 从 session.chains 里把所有 type==='draw' 的步骤拍平成落库用的 drawings 列表即可。
function collectChainDrawings(session) {
  const drawings = [];
  for (const chain of session.chains.values()) {
    for (const step of chain.steps) {
      if (step.type !== 'draw') continue;
      drawings.push({ userId: step.by, word: step.word, actions: step.actions });
    }
  }
  return drawings;
}

function endGame(io, roomId) {
  const session = chainStore.getSession(roomId);
  const room = roomStore.getRoom(roomId);
  if (!session) return;

  const scores = chainStore.scoresObject(session);
  const ranking = Object.entries(scores)
    .map(([userId, score]) => ({ userId: Number(userId), score }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.userId - b.userId))
    .map((entry, i) => ({ ...entry, rank: i + 1 }));

  recordsStore.recordGameSession({ roomId, mode: 'chain', scores, drawings: collectChainDrawings(session) });

  for (const ownerId of session.chains.keys()) {
    canvasStore.destroySession(chainStore.chainCanvasKey(roomId, ownerId));
  }

  io.to(roomChannel(roomId)).emit('game:ended', { scores, ranking });
  chainStore.destroySession(roomId);

  if (room) {
    room.status = 'waiting';
    broadcastRoomStatus(io, room);
  }
}

// --- 选词阶段（仅 turn===1）---

function beginChoosingPhase(io, roomId) {
  const session = chainStore.getSession(roomId);
  const room = roomStore.getRoom(roomId);
  if (!session || !room) return;

  session.phase = 'choosingWord';
  session.chosenOwners = new Set();
  session.turnDeadline = Date.now() + CHOOSE_WORD_TIMEOUT_MS;

  const { wordSource, wordCategory } = room.settings;
  for (const chain of session.chains.values()) {
    if (wordSource === 'system') {
      chain.wordCandidates = wordbanks.pickWords(wordCategory, 3);
      emitToUser(io, room, chain.ownerId, 'chain:wordChoices', { candidates: chain.wordCandidates });
    } else {
      chain.wordCandidates = null;
    }
  }

  io.to(roomChannel(roomId)).emit('chain:turnStarted', {
    turn: 1,
    totalTurns: session.totalTurns,
    phase: 'choosingWord',
    deadline: session.turnDeadline,
  });

  chainStore.schedulePhaseTimer(session, CHOOSE_WORD_TIMEOUT_MS, () => resolveChoosingPhase(io, roomId));
}

function chooseWord(io, roomId, userId, rawWord) {
  const session = chainStore.getSession(roomId);
  const room = roomStore.getRoom(roomId);
  if (!session || !room) return { ok: false, error: 'NO_ACTIVE_GAME', message: '当前没有进行中的对局' };
  if (session.phase !== 'choosingWord') return { ok: false, error: 'INVALID_STATE', message: '当前不是选词阶段' };

  const chain = session.chains.get(userId);
  if (!chain) return { ok: false, error: 'NOT_YOUR_TURN', message: '你不是这局的玩家' };
  if (session.chosenOwners.has(userId)) {
    return { ok: false, error: 'ALREADY_CHOSEN', message: '你已经选过词了' };
  }

  const word = typeof rawWord === 'string' ? rawWord.trim() : '';
  if (!word || word.length > 20) {
    return { ok: false, error: 'INVALID_WORD', message: '词语不能为空，且不超过 20 个字符' };
  }
  if (chain.wordCandidates && !chain.wordCandidates.includes(word)) {
    return { ok: false, error: 'INVALID_WORD', message: '只能从候选词里选' };
  }

  chain.originalWord = word;
  session.chosenOwners.add(userId);

  if (session.chosenOwners.size >= session.turnOrder.filter((id) => !session.removedUserIds.has(id)).length) {
    chainStore.clearPhaseTimer(session);
    resolveChoosingPhase(io, roomId);
  }
  return { ok: true };
}

function resolveChoosingPhase(io, roomId) {
  const session = chainStore.getSession(roomId);
  if (!session || session.phase !== 'choosingWord') return;

  for (const chain of session.chains.values()) {
    if (chain.originalWord != null) continue;
    if (chain.wordCandidates && chain.wordCandidates.length > 0) {
      chain.originalWord = chain.wordCandidates[Math.floor(Math.random() * chain.wordCandidates.length)];
    } else {
      // 自定义出题模式超时没输入：这条链从一开始就没有有效词，标记 autoFail，
      // 结算时直接判不通过、不进入投票（见第14.3节/第14.6节）。
      chain.originalWord = null;
      chain.autoFail = true;
    }
  }

  beginDrawPhase(io, roomId);
}

// --- 绘画阶段 ---

function beginDrawPhase(io, roomId) {
  const session = chainStore.getSession(roomId);
  const room = roomStore.getRoom(roomId);
  if (!session || !room) return;

  session.phase = 'drawing';
  session.doneUsers = new Set();
  const drawMs = room.settings.drawSeconds * 1000;
  session.turnDeadline = Date.now() + drawMs;

  const assignments = [];
  for (const chain of session.chains.values()) {
    const drawerId = chainStore.assignedPlayerId(session, chain);
    assignments.push({ chainOwnerId: chain.ownerId, drawerId });

    const canvasKey = chainStore.chainCanvasKey(roomId, chain.ownerId);
    canvasStore.clear(canvasKey, drawerId);
    io.to(roomChannel(roomId)).emit('canvas:cleared', { roomId, chainOwnerId: chain.ownerId });

    const word = currentDrawWordFor(chain);
    chain.currentDrawWord = word;
    if (session.removedUserIds.has(drawerId)) continue; // 人已经不在房间里了，没法私发
    emitToUser(io, room, drawerId, 'chain:wordToDraw', {
      chainOwnerId: chain.ownerId,
      word,
      wordLength: word ? word.length : 0,
    });
  }

  io.to(roomChannel(roomId)).emit('chain:turnStarted', {
    turn: session.turn,
    totalTurns: session.totalTurns,
    phase: 'drawing',
    deadline: session.turnDeadline,
    assignments,
  });

  chainStore.schedulePhaseTimer(session, drawMs, () => endDrawPhase(io, roomId));
}

// 提前完成作画（第14.4节"提前完成作画"按钮）
function finishDraw(io, roomId, userId) {
  const session = chainStore.getSession(roomId);
  if (!session) return { ok: false, error: 'NO_ACTIVE_GAME', message: '当前没有进行中的对局' };
  if (session.phase !== 'drawing') return { ok: false, error: 'INVALID_STATE', message: '现在不是绘画阶段' };

  const myChain = [...session.chains.values()].find((c) => chainStore.assignedPlayerId(session, c) === userId);
  if (!myChain) return { ok: false, error: 'NOT_YOUR_TURN', message: '这回合不需要你画画' };
  if (session.doneUsers.has(userId)) return { ok: true, noop: true };

  session.doneUsers.add(userId);
  if (chainStore.allDoneForTurn(session)) {
    chainStore.clearPhaseTimer(session);
    endDrawPhase(io, roomId);
  }
  return { ok: true };
}

function endDrawPhase(io, roomId) {
  const session = chainStore.getSession(roomId);
  if (!session) return;
  chainStore.clearPhaseTimer(session);

  for (const chain of session.chains.values()) {
    const drawerId = chainStore.assignedPlayerId(session, chain);
    const canvasKey = chainStore.chainCanvasKey(roomId, chain.ownerId);
    const actions = canvasStore.getVisibleActions(canvasKey);
    chain.steps.push({ turn: session.turn, type: 'draw', by: drawerId, word: chain.currentDrawWord, actions });
    chain.currentDrawWord = null;
  }

  nextTurn(io, roomId);
}

// --- 猜词阶段 ---

function beginGuessPhase(io, roomId) {
  const session = chainStore.getSession(roomId);
  const room = roomStore.getRoom(roomId);
  if (!session || !room) return;

  session.phase = 'guessing';
  session.doneUsers = new Set();
  const guessMs = room.settings.guessSeconds * 1000;
  session.turnDeadline = Date.now() + guessMs;

  const assignments = [];
  for (const chain of session.chains.values()) {
    const guesserId = chainStore.assignedPlayerId(session, chain);
    assignments.push({ chainOwnerId: chain.ownerId, guesserId });
    if (session.removedUserIds.has(guesserId)) continue;

    // 只告诉猜词者"该看哪条链"，不重复发一份 actions——前端的 CanvasBoard 会用
    // canvas:getState + 这个 chainOwnerId 去拉当前画板状态，和作画者提交后广播的
    // canvas:actionAdded 走同一套数据源，避免两份画面数据不一致（见第14.5节）。
    emitToUser(io, room, guesserId, 'chain:imageToGuess', { chainOwnerId: chain.ownerId });
  }

  io.to(roomChannel(roomId)).emit('chain:turnStarted', {
    turn: session.turn,
    totalTurns: session.totalTurns,
    phase: 'guessing',
    deadline: session.turnDeadline,
    assignments,
  });

  chainStore.schedulePhaseTimer(session, guessMs, () => endGuessPhase(io, roomId));
}

function submitGuess(io, roomId, userId, rawGuess) {
  const session = chainStore.getSession(roomId);
  const room = roomStore.getRoom(roomId);
  if (!session || !room) return { ok: false, error: 'NO_ACTIVE_GAME', message: '当前没有进行中的对局' };
  if (session.phase !== 'guessing') return { ok: false, error: 'INVALID_STATE', message: '现在不是猜词阶段' };

  const myChain = [...session.chains.values()].find((c) => chainStore.assignedPlayerId(session, c) === userId);
  if (!myChain) return { ok: false, error: 'NOT_YOUR_TURN', message: '这回合不需要你猜词' };
  if (session.doneUsers.has(userId)) return { ok: false, error: 'ALREADY_SUBMITTED', message: '你已经提交过了' };

  const guess = typeof rawGuess === 'string' ? rawGuess.trim() : '';
  if (!guess || guess.length > 20) {
    return { ok: false, error: 'INVALID_GUESS', message: '猜测不能为空，且不超过 20 个字符' };
  }

  session.doneUsers.add(userId);
  myChain.steps.push({ turn: session.turn, type: 'guess', by: userId, guessWord: guess });
  io.to(roomChannel(roomId)).emit('chain:guessSubmitted', { chainOwnerId: myChain.ownerId, userId });

  if (chainStore.allDoneForTurn(session)) {
    chainStore.clearPhaseTimer(session);
    endGuessPhase(io, roomId);
  }
  return { ok: true };
}

function endGuessPhase(io, roomId) {
  const session = chainStore.getSession(roomId);
  if (!session) return;
  chainStore.clearPhaseTimer(session);

  for (const chain of session.chains.values()) {
    const guesserId = chainStore.assignedPlayerId(session, chain);
    const last = chain.steps[chain.steps.length - 1];
    const alreadyGuessedThisTurn = last && last.turn === session.turn && last.type === 'guess';
    if (!alreadyGuessedThisTurn) {
      // 超时未提交，或这个人已经被移出房间：记一条空猜测，链条继续往下走（见第14.7节）。
      chain.steps.push({ turn: session.turn, type: 'guess', by: guesserId, guessWord: null, timedOut: true });
    }
  }

  nextTurn(io, roomId);
}

function nextTurn(io, roomId) {
  const session = chainStore.getSession(roomId);
  if (!session) return;

  if (session.turn >= session.totalTurns) {
    beginReview(io, roomId);
    return;
  }
  session.turn += 1;
  if (session.turn % 2 === 0) {
    beginGuessPhase(io, roomId);
  } else {
    beginDrawPhase(io, roomId);
  }
}

// --- 结算评审阶段（第14.6节）---

function beginReview(io, roomId) {
  const session = chainStore.getSession(roomId);
  if (!session) return;
  session.phase = 'reviewing';
  session.review.index = 0;
  session.turnDeadline = null;
  processNextReview(io, roomId);
}

function processNextReview(io, roomId) {
  const session = chainStore.getSession(roomId);
  const room = roomStore.getRoom(roomId);
  if (!session || !room) return;

  if (session.review.index >= session.review.order.length) {
    endGame(io, roomId);
    return;
  }

  const ownerId = session.review.order[session.review.index];
  const chain = session.chains.get(ownerId);
  const finalGuess = lastGuessWord(chain);
  const matched = !chain.autoFail && finalGuess != null && finalGuess === chain.originalWord;
  const participantIds = uniqueParticipants(chain);

  io.to(roomChannel(roomId)).emit('chain:reviewChain', {
    chainOwnerId: ownerId,
    originalWord: chain.originalWord,
    steps: chain.steps.map((s) => ({
      turn: s.turn,
      type: s.type,
      by: s.by,
      word: s.type === 'draw' ? s.word : undefined,
      guessWord: s.type === 'guess' ? s.guessWord : undefined,
      actions: s.type === 'draw' ? s.actions : undefined,
      timedOut: Boolean(s.timedOut),
    })),
    matched,
    participantIds,
  });

  if (matched) {
    chainStore.addScoreToAll(session, participantIds, CHAIN_MATCH_SCORE);
    io.to(roomChannel(roomId)).emit('chain:reviewResolved', {
      chainOwnerId: ownerId,
      approved: true,
      reason: 'matched',
      scoreEach: CHAIN_MATCH_SCORE,
      scores: chainStore.scoresObject(session),
    });
    chainStore.schedulePhaseTimer(session, REVIEW_DISPLAY_MS, () => advanceReview(io, roomId));
    return;
  }

  if (chain.autoFail) {
    io.to(roomChannel(roomId)).emit('chain:reviewResolved', {
      chainOwnerId: ownerId,
      approved: false,
      reason: 'noWord',
      scoreEach: 0,
      scores: chainStore.scoresObject(session),
    });
    chainStore.schedulePhaseTimer(session, REVIEW_DISPLAY_MS, () => advanceReview(io, roomId));
    return;
  }

  const eligibleVoters = room.players
    .filter((p) => p.connected && !participantIds.includes(p.userId))
    .map((p) => p.userId);
  session.review.eligibleVoters = eligibleVoters;
  session.review.votes = new Map();

  if (eligibleVoters.length === 0) {
    // 没有可以投票的人（比如房间很小、几乎每个人都参与了这条链）：文档没规定这种边界情况，
    // 本 Phase 按"已知取舍"直接判不通过，记入 HISTORY.md。
    io.to(roomChannel(roomId)).emit('chain:reviewResolved', {
      chainOwnerId: ownerId,
      approved: false,
      reason: 'noEligibleVoters',
      scoreEach: 0,
      scores: chainStore.scoresObject(session),
    });
    chainStore.schedulePhaseTimer(session, REVIEW_DISPLAY_MS, () => advanceReview(io, roomId));
    return;
  }

  session.review.voteDeadline = Date.now() + REVIEW_VOTE_TIMEOUT_MS;
  io.to(roomChannel(roomId)).emit('chain:voteOpened', {
    chainOwnerId: ownerId,
    eligibleVoters,
    deadline: session.review.voteDeadline,
    anonymous: Boolean(room.settings.anonymousVoting),
  });
  chainStore.schedulePhaseTimer(session, REVIEW_VOTE_TIMEOUT_MS, () => resolveVote(io, roomId));
}

function castVote(io, roomId, userId, approve) {
  const session = chainStore.getSession(roomId);
  const room = roomStore.getRoom(roomId);
  if (!session || !room) return { ok: false, error: 'NO_ACTIVE_GAME', message: '当前没有进行中的对局' };
  if (session.phase !== 'reviewing' || !session.review.eligibleVoters.length) {
    return { ok: false, error: 'INVALID_STATE', message: '现在不是投票阶段' };
  }
  if (!session.review.eligibleVoters.includes(userId)) {
    return { ok: false, error: 'NOT_ELIGIBLE_VOTER', message: '你不能给这条链投票（可能你也参与了这条链）' };
  }
  if (session.review.votes.has(userId)) {
    return { ok: false, error: 'ALREADY_VOTED', message: '你已经投过票了' };
  }

  session.review.votes.set(userId, Boolean(approve));
  const ownerId = session.review.order[session.review.index];

  if (room.settings.anonymousVoting) {
    io.to(roomChannel(roomId)).emit('chain:voteCast', {
      chainOwnerId: ownerId,
      voteCount: session.review.votes.size,
      eligibleCount: session.review.eligibleVoters.length,
    });
  } else {
    io.to(roomChannel(roomId)).emit('chain:voteCast', {
      chainOwnerId: ownerId,
      userId,
      approve: Boolean(approve),
      voteCount: session.review.votes.size,
      eligibleCount: session.review.eligibleVoters.length,
    });
  }

  if (session.review.votes.size >= session.review.eligibleVoters.length) {
    chainStore.clearPhaseTimer(session);
    resolveVote(io, roomId);
  }
  return { ok: true };
}

function resolveVote(io, roomId) {
  const session = chainStore.getSession(roomId);
  if (!session) return;
  chainStore.clearPhaseTimer(session);

  const ownerId = session.review.order[session.review.index];
  const chain = session.chains.get(ownerId);
  const eligible = session.review.eligibleVoters.length;
  const approveCount = [...session.review.votes.values()].filter(Boolean).length;
  const approved = eligible > 0 && approveCount > eligible / 2;
  const participantIds = uniqueParticipants(chain);

  if (approved) chainStore.addScoreToAll(session, participantIds, CHAIN_VOTE_APPROVED_SCORE);

  io.to(roomChannel(roomId)).emit('chain:voteResult', {
    chainOwnerId: ownerId,
    approveCount,
    eligibleCount: eligible,
    approved,
    scoreEach: approved ? CHAIN_VOTE_APPROVED_SCORE : 0,
    scores: chainStore.scoresObject(session),
  });

  chainStore.schedulePhaseTimer(session, REVIEW_DISPLAY_MS, () => advanceReview(io, roomId));
}

function advanceReview(io, roomId) {
  const session = chainStore.getSession(roomId);
  if (!session) return;
  session.review.index += 1;
  processNextReview(io, roomId);
}

// --- 开局 ---

function startGame(io, room, hostUserId) {
  if (room.hostUserId !== hostUserId) return { ok: false, error: 'NOT_HOST', message: '只有房主可以开始游戏' };
  if (room.mode !== 'chain') return { ok: false, error: 'INVALID_STATE', message: '当前房间不是接龙模式' };
  if (room.status !== 'waiting') return { ok: false, error: 'GAME_ALREADY_RUNNING', message: '对局已经在进行中' };
  if (room.players.length < MIN_PLAYERS_TO_START) {
    return { ok: false, error: 'NOT_ENOUGH_PLAYERS', message: `至少需要 ${MIN_PLAYERS_TO_START} 名玩家才能开始` };
  }

  const turnOrder = room.players.map((p) => p.userId);
  chainStore.createSession(room.id, { turnOrder, totalRings: room.settings.chainRounds });
  room.status = 'playing';

  io.to(roomChannel(room.id)).emit('game:started', {
    mode: 'chain',
    turnOrder,
    totalTurns: room.settings.chainRounds * 2,
  });
  broadcastRoomStatus(io, room);

  beginChoosingPhase(io, room.id);
  return { ok: true };
}

function getStateForUser(room, userId) {
  const session = chainStore.getSession(room.id);
  if (!session) return { active: false };

  const base = {
    active: true,
    phase: session.phase,
    turn: session.turn,
    totalTurns: session.totalTurns,
    deadline: session.turnDeadline,
    scores: chainStore.scoresObject(session),
  };

  const myChain = session.chains.get(userId);

  if (session.phase === 'choosingWord' && myChain) {
    base.myWordCandidates = myChain.wordCandidates || null;
    base.myChosen = session.chosenOwners.has(userId);
  }

  if (session.phase === 'drawing' || session.phase === 'guessing') {
    const assignedChain = [...session.chains.values()].find(
      (c) => chainStore.assignedPlayerId(session, c) === userId
    );
    if (assignedChain) {
      base.myChainOwnerId = assignedChain.ownerId;
      base.myRole = session.phase === 'drawing' ? 'draw' : 'guess';
      base.myDone = session.doneUsers.has(userId);
      if (base.myRole === 'draw') {
        base.myWordToDraw = currentDrawWordFor(assignedChain);
      }
      // myRole==='guess' 时不需要在这里带画面数据，前端会用 myChainOwnerId 去
      // canvas:getState 拉当前画板状态（原因同 beginGuessPhase 里的注释）。
    }
  }

  if (session.phase === 'reviewing') {
    // 重连兜底只给一个进度提示，不重放完整的历史播报——评审阶段的完整状态重建复杂度较高，
    // 本 Phase 简化为"重连后从下一条 chain:reviewChain 广播开始继续看"，记入 HISTORY.md。
    base.review = { index: session.review.index, total: session.review.order.length };
  }

  return base;
}

// --- 断线相关钩子：由 socket/rooms.js 调用（见第14.7节）---

// 接龙模式一个回合里同时有多个玩家在各自的链上行动（不是竞猜模式那种"只有一个作画者"），
// 给某一个人暂停/恢复共享倒计时会不公平地影响其他仍在线的人，所以本 Phase 不做计时器暂停/
// 恢复，断线的人就是"这一步没赶上"，回合正常在共享的 deadline 到点时结束（见第14.7节的
// 简化说明，需要用户重点确认）。这两个钩子留空是有意为之，不是遗漏。
function onPlayerDisconnected() {}
function onPlayerReconnected() {}

function onPlayerRemoved(io, roomId, userId) {
  const session = chainStore.getSession(roomId);
  if (!session) return;
  if (!session.turnOrder.includes(userId)) return;

  session.removedUserIds.add(userId);
  if (session.phase === 'choosingWord' || session.phase === 'drawing' || session.phase === 'guessing') {
    session.doneUsers.add(userId);
    if (
      (session.phase === 'drawing' && chainStore.allDoneForTurn(session)) ||
      (session.phase === 'guessing' && chainStore.allDoneForTurn(session))
    ) {
      chainStore.clearPhaseTimer(session);
      if (session.phase === 'drawing') endDrawPhase(io, roomId);
      else endGuessPhase(io, roomId);
    } else if (
      session.phase === 'choosingWord' &&
      session.chosenOwners.size >= session.turnOrder.filter((id) => !session.removedUserIds.has(id)).length
    ) {
      chainStore.clearPhaseTimer(session);
      resolveChoosingPhase(io, roomId);
    }
  }

  const room = roomStore.getRoom(roomId);
  const remaining = room ? room.players.length : 0;
  if (remaining < MIN_PLAYERS_TO_CONTINUE) {
    endGame(io, roomId);
  }
}

module.exports = {
  startGame,
  chooseWord,
  finishDraw,
  submitGuess,
  castVote,
  getStateForUser,
  onPlayerDisconnected,
  onPlayerReconnected,
  onPlayerRemoved,
};
