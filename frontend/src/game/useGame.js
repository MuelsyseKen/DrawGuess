// 竞猜模式对局状态 store：订阅 socket 广播维护当前对局的实时状态（见 FULLREADME.md 第13.7节协议）。
// 写法参照 stores/room.js —— 轻量 reactive + composable。
import { reactive, readonly } from 'vue';
import { getSocket, emitAsync } from '../socket/client';

const state = reactive({
  active: false,
  drawerId: null,
  phase: null, // 'choosingWord' | 'drawing'
  round: 0,
  totalRounds: 0,
  deadline: null, // 当前阶段截止时间戳（ms），倒计时组件用它算剩余秒数
  wordLength: null, // 非作画者：谜底字数提示
  word: null, // 仅作画者：谜底原文
  wordCandidates: null, // 仅作画者、wordSource==='system' 时：候选词
  correctGuessers: [], // 本回合已猜中的人，按顺序
  scores: {}, // userId -> 累计得分
  chatLog: [], // { id, userId, text, type: 'chat' | 'correct' }
  lastTurnResult: null, // 上一回合结束时的结算信息，展示几秒后被新回合覆盖
  ended: null, // { scores, ranking } —— 非空表示已经进入结算视图
});

let listenersBound = false;
let chatSeq = 0;

function pushChat(entry) {
  state.chatLog.push({ id: `${Date.now()}-${chatSeq++}`, ...entry });
  // 聊天记录只在当前对局页面展示，没必要无限增长，保留最近 200 条足够
  if (state.chatLog.length > 200) state.chatLog.splice(0, state.chatLog.length - 200);
}

function bindListeners() {
  if (listenersBound) return;
  listenersBound = true;
  const socket = getSocket();

  socket.on('game:started', ({ totalRounds }) => {
    state.active = true;
    state.totalRounds = totalRounds;
    state.ended = null;
    state.chatLog = [];
    state.scores = {};
  });

  socket.on('game:turnStarted', (payload) => {
    state.active = true;
    state.drawerId = payload.drawerId;
    state.phase = payload.phase;
    state.round = payload.round;
    state.totalRounds = payload.totalRounds;
    state.deadline = payload.deadline;
    state.wordLength = null;
    state.word = null;
    state.wordCandidates = null;
    state.correctGuessers = [];
    state.lastTurnResult = null;
  });

  // 仅作画者会收到（wordSource==='system' 时）
  socket.on('game:wordChoices', ({ candidates }) => {
    state.wordCandidates = candidates;
  });

  socket.on('game:wordChosen', ({ wordLength, deadline }) => {
    state.phase = 'drawing';
    state.wordLength = wordLength;
    state.deadline = deadline;
    state.wordCandidates = null;
  });

  // 仅作画者会收到
  socket.on('game:wordRevealed', ({ word }) => {
    state.word = word;
  });

  socket.on('game:chatMessage', ({ userId, text }) => {
    pushChat({ userId, text, type: 'chat' });
  });

  socket.on('game:correctGuess', ({ userId, rank, score }) => {
    state.correctGuessers.push({ userId, rank, score });
    pushChat({ userId, text: `猜中了！（第 ${rank} 名，+${score} 分）`, type: 'correct' });
  });

  socket.on('game:turnEnded', (payload) => {
    state.phase = null;
    state.lastTurnResult = payload;
    state.scores = payload.scores;
  });

  socket.on('game:timerResumed', ({ deadline }) => {
    state.deadline = deadline;
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
  return emitAsync('game:chooseWord', { word });
}

async function sendChat(text) {
  return emitAsync('game:chat', { text });
}

// 深链/刷新页面进入 /room/:id/game 时兜底同步一次当前对局状态
async function syncCurrent() {
  bindListeners();
  const res = await emitAsync('game:getState', {});
  if (!res.active) {
    state.active = false;
    return res;
  }
  state.active = true;
  state.drawerId = res.drawerId;
  state.phase = res.phase;
  state.round = res.round;
  state.totalRounds = res.totalRounds;
  state.deadline = res.deadline;
  state.wordLength = res.wordLength;
  state.word = res.word ?? null;
  state.wordCandidates = res.wordCandidates ?? null;
  state.correctGuessers = res.correctGuessers;
  state.scores = res.scores;
  return res;
}

// 离开游戏页面时重置本地状态（不影响服务端对局本身，房间层断线宽限期逻辑独立处理）
function reset() {
  state.active = false;
  state.drawerId = null;
  state.phase = null;
  state.round = 0;
  state.totalRounds = 0;
  state.deadline = null;
  state.wordLength = null;
  state.word = null;
  state.wordCandidates = null;
  state.correctGuessers = [];
  state.scores = {};
  state.chatLog = [];
  state.lastTurnResult = null;
  state.ended = null;
}

export function useGame() {
  bindListeners();
  return {
    state: readonly(state),
    start,
    chooseWord,
    sendChat,
    syncCurrent,
    reset,
  };
}
