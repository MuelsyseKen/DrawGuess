<script setup>
// 接龙模式游戏内页面（见 FULLREADME.md 第14节）：复用 CanvasBoard 组件（Phase 5 加了
// chainOwnerId 参数，见那边的注释），布局参照 GuessGame.vue 的结构，但回合模型完全不同——
// 每个回合所有人同时行动（各自负责一条链的画或猜），不是"一个人画、其他人猜"。
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '../stores/auth';
import { useRoom } from '../stores/room';
import { useChain } from '../game/useChain';
import CanvasBoard from '../canvas/CanvasBoard.vue';
import ActionsPreview from '../canvas/ActionsPreview.vue';
import { extractErrorMessage } from '../utils/errors';

const route = useRoute();
const router = useRouter();
const auth = useAuth();
const room = useRoom();
const chain = useChain();

const loading = ref(true);
const loadError = ref('');
const chooseError = ref('');
const guessError = ref('');
const voteError = ref('');
const customWord = ref('');
const guessText = ref('');
const nowMs = ref(Date.now());
const finishingDraw = ref(false);

let tickTimer = null;

const myUserId = computed(() => auth.state.user?.id ?? null);
const players = computed(() => (room.state.room ? room.state.room.players : []));
function usernameOf(userId) {
  const p = players.value.find((pl) => pl.userId === userId);
  return p ? p.username : `玩家#${userId}`;
}

const remainingSeconds = computed(() => {
  if (!chain.state.deadline) return 0;
  return Math.max(0, Math.ceil((chain.state.deadline - nowMs.value) / 1000));
});

// 环数展示：每环 = 1 次画 + 1 次猜（第14.2节），turn 是内部的"半环"计数
const totalRings = computed(() => Math.ceil(chain.state.totalTurns / 2));
const currentRing = computed(() => Math.ceil(chain.state.turn / 2) || 1);

const phaseLabel = computed(() => {
  switch (chain.state.phase) {
    case 'choosingWord':
      return '选词';
    case 'drawing':
      return '作画';
    case 'guessing':
      return '猜词';
    case 'reviewing':
      return '结算';
    default:
      return '';
  }
});

const scoreboard = computed(() => {
  const entries = Object.entries(chain.state.scores || {}).map(([userId, score]) => ({
    userId: Number(userId),
    score,
  }));
  entries.sort((a, b) => b.score - a.score);
  return entries;
});

const wordBlanks = computed(() => {
  if (!chain.state.myWordLength) return '';
  return Array.from({ length: chain.state.myWordLength }, () => '＿').join(' ');
});

async function ensureLoaded() {
  loading.value = true;
  loadError.value = '';
  try {
    if (!room.state.room || room.state.room.id !== route.params.id) {
      await room.syncCurrent();
    }
    if (!room.state.room || room.state.room.id !== route.params.id) {
      loadError.value = '房间不存在，或你已不在这个房间里';
      return;
    }
    if (room.state.room.mode !== 'chain') {
      loadError.value = '这个房间不是接龙模式';
      return;
    }
    await chain.syncCurrent();
    if (!chain.state.active && !chain.state.ended) {
      loadError.value = '当前没有进行中的对局';
    }
  } catch (e) {
    loadError.value = extractErrorMessage(e, '加载对局失败');
  } finally {
    loading.value = false;
  }
}

async function submitCandidateWord(word) {
  chooseError.value = '';
  try {
    await chain.chooseWord(word);
  } catch (e) {
    chooseError.value = extractErrorMessage(e, '选词失败');
  }
}

async function submitCustomWord() {
  if (!customWord.value.trim()) return;
  chooseError.value = '';
  try {
    await chain.chooseWord(customWord.value.trim());
    customWord.value = '';
  } catch (e) {
    chooseError.value = extractErrorMessage(e, '选词失败');
  }
}

async function handleFinishDraw() {
  finishingDraw.value = true;
  try {
    await chain.finishDraw();
  } catch (e) {
    // 提前完成失败不算大事，忽略（超时兜底一样能推进）
  } finally {
    finishingDraw.value = false;
  }
}

async function submitGuess() {
  const text = guessText.value.trim();
  if (!text) return;
  guessError.value = '';
  try {
    await chain.submitGuess(text);
    guessText.value = '';
  } catch (e) {
    guessError.value = extractErrorMessage(e, '提交失败');
  }
}

async function castVote(approve) {
  voteError.value = '';
  try {
    await chain.vote(approve);
  } catch (e) {
    voteError.value = extractErrorMessage(e, '投票失败');
  }
}

function backToRoom() {
  chain.reset();
  router.push({ name: 'room-lobby', params: { id: route.params.id } });
}

onMounted(async () => {
  if (!auth.state.initialized) await auth.init();
  await ensureLoaded();
  tickTimer = setInterval(() => {
    nowMs.value = Date.now();
  }, 250);
});

onBeforeUnmount(() => {
  if (tickTimer) clearInterval(tickTimer);
});
</script>

<template>
  <div class="page">
    <p v-if="loading" class="hint">加载中…</p>
    <p v-else-if="loadError" class="error-msg">
      {{ loadError }}
      <router-link :to="{ name: 'room-lobby', params: { id: route.params.id } }">返回房间</router-link>
    </p>

    <!-- 结算视图 -->
    <section v-else-if="chain.state.ended" class="settlement">
      <h1>结算</h1>
      <ol class="ranking-list">
        <li v-for="r in chain.state.ended.ranking" :key="r.userId" class="ranking-item">
          <span class="rank">#{{ r.rank }}</span>
          <span class="name">{{ usernameOf(r.userId) }}</span>
          <span class="score">{{ r.score }} 分</span>
        </li>
      </ol>
      <button type="button" class="back-btn" @click="backToRoom">返回房间</button>
    </section>

    <template v-else-if="chain.state.active">
      <header class="game-header">
        <span class="round-label">第 {{ currentRing }} / {{ totalRings }} 环 · {{ phaseLabel }}</span>
        <span class="timer" v-if="chain.state.phase !== 'reviewing'">{{ remainingSeconds }}s</span>
      </header>

      <!-- 选词阶段：每个人同时给自己的链选词（第14.3节） -->
      <section v-if="chain.state.phase === 'choosingWord'" class="word-panel">
        <template v-if="!chain.state.myChosen">
          <p class="hint">给你自己接龙链的起点选个词（{{ remainingSeconds }}s 内不选就随机/判定作废）</p>
          <div v-if="chain.state.myWordCandidates" class="candidates">
            <button
              v-for="w in chain.state.myWordCandidates"
              :key="w"
              type="button"
              class="candidate-btn"
              @click="submitCandidateWord(w)"
            >
              {{ w }}
            </button>
          </div>
          <form v-else class="custom-word-form" @submit.prevent="submitCustomWord">
            <input v-model="customWord" placeholder="输入你要出的题目（1~20 字）" maxlength="20" />
            <button type="submit">确定</button>
          </form>
          <p v-if="chooseError" class="error-msg">{{ chooseError }}</p>
        </template>
        <p v-else class="hint">已选好，等待其他人选词中…</p>
      </section>

      <!-- 作画阶段：我这回合是不是被分配去画某条链 -->
      <template v-else-if="chain.state.phase === 'drawing'">
        <section v-if="chain.state.myRole === 'draw'" class="word-panel">
          <p v-if="chain.state.myWordToDraw" class="word-reveal">
            题目：<strong>{{ chain.state.myWordToDraw }}</strong>
          </p>
          <p v-else class="word-reveal blanks">上一位没写下猜测，自由发挥吧～</p>
        </section>
        <section v-else class="word-panel">
          <p class="hint">这回合轮不到你画，等待大家作画中…</p>
        </section>

        <div v-if="chain.state.myRole === 'draw'" class="game-body">
          <div class="canvas-col">
            <CanvasBoard
              v-if="room.state.room"
              :room-id="room.state.room.id"
              :chain-owner-id="chain.state.myChainOwnerId"
              :brush-mode="room.state.room.settings.brushMode"
              :color-mode="room.state.room.settings.colorMode"
              :read-only="chain.state.myDone"
            />
            <button
              type="button"
              class="finish-btn"
              :disabled="chain.state.myDone || finishingDraw"
              @click="handleFinishDraw"
            >
              {{ chain.state.myDone ? '已完成，等待其他人' : finishingDraw ? '提交中…' : '提前完成作画' }}
            </button>
          </div>
        </div>
      </template>

      <!-- 猜词阶段：我这回合是不是被分配去猜某条链 -->
      <template v-else-if="chain.state.phase === 'guessing'">
        <section v-if="chain.state.myRole === 'guess'" class="word-panel">
          <p class="hint">这是别人画给你猜的，写下你觉得画的是什么词</p>
        </section>
        <section v-else class="word-panel">
          <p class="hint">这回合轮不到你猜，等待大家猜词中…</p>
        </section>

        <div v-if="chain.state.myRole === 'guess'" class="game-body">
          <div class="canvas-col">
            <CanvasBoard
              v-if="room.state.room"
              :room-id="room.state.room.id"
              :chain-owner-id="chain.state.myChainOwnerId"
              :brush-mode="room.state.room.settings.brushMode"
              :color-mode="room.state.room.settings.colorMode"
              :read-only="true"
            />
            <form v-if="!chain.state.myDone" class="guess-form" @submit.prevent="submitGuess">
              <input v-model="guessText" placeholder="这画的是什么？" maxlength="20" />
              <button type="submit">提交</button>
            </form>
            <p v-else class="hint">已提交，等待其他人</p>
            <p v-if="guessError" class="error-msg">{{ guessError }}</p>
          </div>
        </div>
      </template>

      <!-- 结算评审阶段（第14.6节）：按链依次公示 -->
      <section v-else-if="chain.state.phase === 'reviewing'" class="review-panel">
        <p class="hint review-progress">
          正在结算第 {{ chain.state.review.index + 1 }} / {{ chain.state.review.total }} 条链
        </p>

        <div v-if="chain.state.currentReview" class="review-chain">
          <p class="review-owner">
            起点玩家：<strong>{{ usernameOf(chain.state.currentReview.chainOwnerId) }}</strong>
            ，最初的词：<strong>{{ chain.state.currentReview.originalWord ?? '（未命题）' }}</strong>
          </p>

          <ol class="review-steps">
            <li v-for="(s, i) in chain.state.currentReview.steps" :key="i" class="review-step">
              <template v-if="s.type === 'draw'">
                <p class="step-label">{{ usernameOf(s.by) }} 画的「{{ s.word ?? '（未知）' }}」：</p>
                <ActionsPreview :actions="s.actions || []" />
              </template>
              <template v-else>
                <p class="step-label">
                  {{ usernameOf(s.by) }} 猜：<strong>{{ s.guessWord ?? '（超时未作答）' }}</strong>
                </p>
              </template>
            </li>
          </ol>

          <p v-if="chain.state.currentReview.matched" class="review-result ok">
            最终词与最初的词一致！{{ chain.state.currentReviewResult ? `每人 +${chain.state.currentReviewResult.scoreEach} 分` : '' }}
          </p>

          <template v-else-if="chain.state.currentVote">
            <p class="hint">链条没有首尾一致，其他玩家投票是否认可这条链算数（{{ remainingSeconds }}s）</p>
            <p class="hint">
              {{ chain.state.currentVote.voteCount }} / {{ chain.state.currentVote.eligibleCount }} 人已投票
            </p>
            <div v-if="chain.state.currentVote.eligibleVoters.includes(myUserId) && !chain.state.currentVote.myVoted" class="vote-actions">
              <button type="button" @click="castVote(true)">算数</button>
              <button type="button" @click="castVote(false)">不算</button>
            </div>
            <p v-if="voteError" class="error-msg">{{ voteError }}</p>
          </template>

          <p v-else-if="chain.state.currentReviewResult" class="review-result" :class="{ ok: chain.state.currentReviewResult.approved }">
            {{ chain.state.currentReviewResult.approved ? `评审通过，每人 +${chain.state.currentReviewResult.scoreEach} 分` : '评审未通过，不加分' }}
          </p>
        </div>

        <section class="scoreboard">
          <h2>计分板</h2>
          <ul>
            <li v-for="s in scoreboard" :key="s.userId" class="score-row">
              <span>{{ usernameOf(s.userId) }}</span>
              <span>{{ s.score }}</span>
            </li>
          </ul>
        </section>
      </section>

      <aside v-if="chain.state.phase !== 'reviewing'" class="side-col standalone">
        <section class="scoreboard">
          <h2>计分板</h2>
          <ul>
            <li v-for="s in scoreboard" :key="s.userId" class="score-row">
              <span>{{ usernameOf(s.userId) }}</span>
              <span>{{ s.score }}</span>
            </li>
          </ul>
        </section>
      </aside>
    </template>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 20px;
  max-width: 1100px;
  margin: 0 auto;
}

.hint {
  color: #999;
  font-size: 13px;
}

.error-msg {
  color: #e0433d;
  font-size: 13px;
}

.game-header {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 12px;
  font-size: 14px;
  color: #666;
}

.timer {
  margin-left: auto;
  font-size: 20px;
  font-weight: 700;
  color: var(--accent, #4c8dff);
}

.word-panel {
  text-align: center;
  margin-bottom: 16px;
}

.candidates {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 10px;
}

.candidate-btn {
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 10px;
  padding: 10px 20px;
  font-size: 16px;
  cursor: pointer;
}

.candidate-btn:hover {
  border-color: var(--accent, #4c8dff);
}

.custom-word-form,
.guess-form {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 10px;
}

.custom-word-form input,
.guess-form input {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
}

.word-reveal {
  font-size: 22px;
  letter-spacing: 4px;
}

.word-reveal.blanks {
  color: #888;
  font-size: 15px;
  letter-spacing: normal;
}

.game-body {
  display: flex;
  gap: 20px;
}

.canvas-col {
  flex: 1;
  min-width: 0;
  max-width: 640px;
  margin: 0 auto;
}

.finish-btn {
  margin-top: 10px;
  border: none;
  border-radius: 10px;
  background: var(--accent, #4c8dff);
  color: #fff;
  padding: 10px 20px;
  font-size: 14px;
  cursor: pointer;
}

.finish-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.side-col.standalone {
  width: 260px;
  margin: 16px auto 0;
}

.scoreboard {
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 12px;
}

.scoreboard h2 {
  font-size: 13px;
  color: #666;
  margin: 0 0 8px;
}

.scoreboard ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.score-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}

.review-panel {
  max-width: 640px;
  margin: 0 auto;
}

.review-progress {
  text-align: center;
  margin-bottom: 10px;
}

.review-chain {
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}

.review-owner {
  font-size: 14px;
  margin-bottom: 12px;
}

.review-steps {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.step-label {
  font-size: 13px;
  color: #555;
  margin: 0 0 6px;
}

.review-result {
  text-align: center;
  font-weight: 600;
  color: #999;
}

.review-result.ok {
  color: #2e7d32;
}

.vote-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 8px;
}

.vote-actions button {
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 10px;
  padding: 8px 20px;
  font-size: 14px;
  cursor: pointer;
}

.settlement {
  text-align: center;
  max-width: 420px;
  margin: 60px auto;
}

.ranking-list {
  list-style: none;
  margin: 20px 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ranking-item {
  display: flex;
  justify-content: space-between;
  border: 1px solid #eee;
  border-radius: 10px;
  padding: 10px 16px;
}

.ranking-item .rank {
  color: #999;
}

.back-btn {
  border: none;
  border-radius: 10px;
  background: var(--accent, #4c8dff);
  color: #fff;
  padding: 10px 24px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
</style>
