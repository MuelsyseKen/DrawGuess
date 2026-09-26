// 接龙模式对局状态 store：订阅 socket 广播维护当前对局的实时状态（见 FULLREADME.md 第14.8节协议）。
// 写法参照 game/useGame.js（竞猜模式）—— 轻量 reactive + composable。
import { reactive, readonly } from 'vue';
import { getSocket, emitAsync } from '../socket/client';

const state = reactive({
  active: false,
  turn: 0,
  totalTurns: 0,
  phase: null, // 'choosingWord' | 'drawing' | 'guessing' | 'reviewing'
  deadline: null,
  scores: {}, // userId -> 累计得分

  // 选词阶段（仅 turn===1）
  myWordCandidates: null,
  myChosen: false,

  // 绘画/猜词阶段：这回合我具体负责哪条链、做什么
  myChainOwnerId: null,
  myRole: null, // 'draw' | 'guess' | null（这回合轮不到我）
  myWordToDraw: null,
  myWordLength: 0,
  myDone: false,

  // 结算评审阶段（第14.6节）
  review: { index: 0, total: 0 },
  currentReview: null, // 最近一次 chain:reviewChain 广播（含 originalWord/steps/matched/participantIds）
  currentReviewResult: null, // chain:reviewResolved 或 chain:voteResult 的结果
  currentVote: null, // { chainOwnerId, eligibleVoters, deadline, anonymous, voteCount, eligibleCount, myVoted }

  ended: null, // { scores, ranking }
});

let listenersBound = false;

function resetTurnLocalState() {
  state.myWordCandidates = null;
  state.myChosen = false;
  state.myChainOwnerId = null;
  state.myRole = null;
  state.myWordToDraw = null;
  state.myWordLength = 0;
  state.myDone = false;
}

function bindListeners() {
  if (listenersBound) return;
  listenersBound = true;
  const socket = getSocket();

  socket.on('game:started', ({ mode, totalTurns }) => {
    if (mode && mode !== 'chain') return; // 保险：不是本模式的开局广播不处理
    state.active = true;
    state.totalTurns = totalTurns;
    state.ended = null;
    state.scores = {};
    resetTurnLocalState();
  });

  socket.on('chain:turnStarted', ({ turn, totalTurns, phase, deadline }) => {
    state.active = true;
    state.turn = turn;
    state.totalTurns = totalTurns;
    state.phase = phase;
    state.deadline = deadline;
    resetTurnLocalState();
  });

  // 仅链主会收到（wordSource==='system' 时）
  socket.on('chain:wordChoices', ({ candidates }) => {
    state.myWordCandidates = candidates;
  });

  // 仅这回合被分配去画某条链的人会收到
  socket.on('chain:wordToDraw', ({ chainOwnerId, word, wordLength }) => {
    state.myChainOwnerId = chainOwnerId;
    state.myRole = 'draw';
    state.myWordToDraw = word;
    state.myWordLength = wordLength;
    state.myDone = false;
  });

  // 仅这回合被分配去猜某条链的人会收到（不带 actions，画面数据交给 CanvasBoard 自己拉，见后端注释）
  socket.on('chain:imageToGuess', ({ chainOwnerId }) => {
    state.myChainOwnerId = chainOwnerId;
    state.myRole = 'guess';
    state.myDone = false;
  });

  socket.on('chain:reviewChain', (payload) => {
    state.phase = 'reviewing';
    state.currentReview = payload;
    state.currentReviewResult = null;
    state.currentVote = null;
  });

  socket.on('chain:reviewResolved', (payload) => {
    state.currentReviewResult = payload;
    state.scores = payload.scores;
  });

  socket.on('chain:voteOpened', (payload) => {
    state.currentVote = { ...payload, voteCount: 0, eligibleCount: payload.eligibleVoters.length, myVoted: false };
  });

  socket.on('chain:voteCast', (payload) => {
    if (!state.currentVote || state.currentVote.chainOwnerId !== payload.chainOwnerId) return;
    state.currentVote.voteCount = payload.voteCount;
    state.currentVote.eligibleCount = payload.eligibleCount;
  });

  socket.on('chain:voteResult', (payload) => {
    state.currentReviewResult = payload;
    state.scores = payload.scores;
    state.currentVote = null;
  });

  socket.on('game:ended', ({ scores, ranking }) => {
    state.active = false;
    state.phase = null;
    state.ended = { scores, ranking };
  });
}

async function start() {
  bindListeners();
  return emitAsync('game:start', {});
}

async function chooseWord(word) {
  const res = await emitAsync('chain:chooseWord', { word });
  state.myChosen = true;
  return res;
}

async function finishDraw() {
  const res = await emitAsync('chain:finishDraw', {});
  state.myDone = true;
  return res;
}

async function submitGuess(guess) {
  const res = await emitAsync('chain:submitGuess', { guess });
  state.myDone = true;
  return res;
}

async function vote(approve) {
  const res = await emitAsync('chain:vote', { approve });
  if (state.currentVote) state.currentVote.myVoted = true;
  return res;
}

// 深链/刷新页面进入 /room/:id/chain-game 时兜底同步一次当前对局状态
async function syncCurrent() {
  bindListeners();
  const res = await emitAsync('game:getState', {});
  if (!res.active) {
    state.active = false;
    return res;
  }
  state.active = true;
  state.phase = res.phase;
  state.turn = res.turn;
  state.totalTurns = res.totalTurns;
  state.deadline = res.deadline;
  state.scores = res.scores;
  resetTurnLocalState();
  if (res.phase === 'choosingWord') {
    state.myWordCandidates = res.myWordCandidates ?? null;
    state.myChosen = Boolean(res.myChosen);
  }
  if (res.myChainOwnerId != null) {
    state.myChainOwnerId = res.myChainOwnerId;
    state.myRole = res.myRole;
    state.myDone = Boolean(res.myDone);
    if (res.myRole === 'draw') {
      state.myWordToDraw = res.myWordToDraw ?? null;
      state.myWordLength = res.myWordToDraw ? res.myWordToDraw.length : 0;
    }
  }
  if (res.review) {
    state.review = res.review;
  }
  return res;
}

function reset() {
  state.active = false;
  state.turn = 0;
  state.totalTurns = 0;
  state.phase = null;
  state.deadline = null;
  state.scores = {};
  state.review = { index: 0, total: 0 };
  state.currentReview = null;
  state.currentReviewResult = null;
  state.currentVote = null;
  state.ended = null;
  resetTurnLocalState();
}

export function useChain() {
  bindListeners();
  return {
    state: readonly(state),
    start,
    chooseWord,
    finishDraw,
    submitGuess,
    vote,
    syncCurrent,
    reset,
  };
}
