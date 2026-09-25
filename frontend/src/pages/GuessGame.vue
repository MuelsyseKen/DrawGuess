<script setup>
// 竞猜模式游戏内页面（见 FULLREADME.md 第13.8节）：复用 CanvasBoard 组件，
// 外层加"当前是否轮到我画"的权限判断（第13.4节），布局按第5.1节竞猜模式界面描述。
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '../stores/auth';
import { useRoom } from '../stores/room';
import { useGame } from '../game/useGame';
import CanvasBoard from '../canvas/CanvasBoard.vue';
import { extractErrorMessage } from '../utils/errors';

const route = useRoute();
const router = useRouter();
const auth = useAuth();
const room = useRoom();
const game = useGame();

const loading = ref(true);
const loadError = ref('');
const chatText = ref('');
const chatError = ref('');
const chooseError = ref('');
const customWord = ref('');
const nowMs = ref(Date.now());

let tickTimer = null;

const myUserId = computed(() => auth.state.user?.id ?? null);
const isDrawer = computed(() => game.state.drawerId !== null && game.state.drawerId === myUserId.value);

const players = computed(() => (room.state.room ? room.state.room.players : []));
function usernameOf(userId) {
  const p = players.value.find((pl) => pl.userId === userId);
  return p ? p.username : `玩家#${userId}`;
}

const remainingSeconds = computed(() => {
  if (!game.state.deadline) return 0;
  return Math.max(0, Math.ceil((game.state.deadline - nowMs.value) / 1000));
});

// 非作画者看到的字数提示占位符（见第13.3节）
const wordBlanks = computed(() => {
  if (!game.state.wordLength) return '';
  return Array.from({ length: game.state.wordLength }, () => '＿').join(' ');
});

const scoreboard = computed(() => {
  const entries = Object.entries(game.state.scores || {}).map(([userId, score]) => ({
    userId: Number(userId),
    score,
  }));
  entries.sort((a, b) => b.score - a.score);
  return entries;
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
    if (room.state.room.mode !== 'guess') {
      loadError.value = '这个房间不是竞猜模式';
      return;
    }
    await game.syncCurrent();
    if (!game.state.active && !game.state.ended) {
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
    await game.chooseWord(word);
  } catch (e) {
    chooseError.value = extractErrorMessage(e, '选词失败');
  }
}

async function submitCustomWord() {
  if (!customWord.value.trim()) return;
  chooseError.value = '';
  try {
    await game.chooseWord(customWord.value.trim());
    customWord.value = '';
  } catch (e) {
    chooseError.value = extractErrorMessage(e, '选词失败');
  }
}

async function submitChat() {
  const text = chatText.value.trim();
  if (!text) return;
  chatError.value = '';
  try {
    await game.sendChat(text);
    chatText.value = '';
  } catch (e) {
    chatError.value = extractErrorMessage(e, '发送失败');
  }
}

function backToRoom() {
  game.reset();
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

    <!-- 结算视图（第13.8节：收到 game:ended 后切到这个状态，不单独拆路由页面） -->
    <section v-else-if="game.state.ended" class="settlement">
      <h1>结算</h1>
      <ol class="ranking-list">
        <li v-for="r in game.state.ended.ranking" :key="r.userId" class="ranking-item">
          <span class="rank">#{{ r.rank }}</span>
          <span class="name">{{ usernameOf(r.userId) }}</span>
          <span class="score">{{ r.score }} 分</span>
        </li>
      </ol>
      <button type="button" class="back-btn" @click="backToRoom">返回房间</button>
    </section>

    <template v-else-if="game.state.active">
      <header class="game-header">
        <span class="round-label">第 {{ game.state.round }} / {{ game.state.totalRounds }} 轮</span>
        <span class="drawer-label">
          作画者：<strong>{{ usernameOf(game.state.drawerId) }}</strong>
        </span>
        <span class="timer">{{ remainingSeconds }}s</span>
      </header>

      <!-- 上一回合结算展示（几秒后被下一回合覆盖，见 useGame.js） -->
      <section v-if="game.state.lastTurnResult" class="turn-result">
        <p v-if="game.state.lastTurnResult.forfeited">这回合作废了（作画者离开）</p>
        <p v-else>
          谜底是「<strong>{{ game.state.lastTurnResult.word }}</strong>」，
          {{ game.state.lastTurnResult.correctGuessers.length }} 人猜中，
          作画者 +{{ game.state.lastTurnResult.drawerScore }} 分
        </p>
      </section>

      <!-- 选词阶段 -->
      <section v-else-if="game.state.phase === 'choosingWord'" class="word-panel">
        <template v-if="isDrawer">
          <p class="hint">轮到你选词啦（{{ remainingSeconds }}s 内不选就随机/跳过）</p>
          <div v-if="game.state.wordCandidates" class="candidates">
            <button
              v-for="w in game.state.wordCandidates"
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
        <p v-else class="hint">等待「{{ usernameOf(game.state.drawerId) }}」选词中…</p>
      </section>

      <!-- 绘画阶段 -->
      <section v-else class="word-panel">
        <p v-if="isDrawer" class="word-reveal">题目：<strong>{{ game.state.word }}</strong></p>
        <p v-else class="word-reveal blanks">{{ wordBlanks }}</p>
      </section>

      <div class="game-body">
        <div class="canvas-col">
          <CanvasBoard
            v-if="room.state.room"
            :room-id="room.state.room.id"
            :brush-mode="room.state.room.settings.brushMode"
            :color-mode="room.state.room.settings.colorMode"
            :read-only="!isDrawer || game.state.phase !== 'drawing'"
          />
        </div>

        <aside class="side-col">
          <section class="scoreboard">
            <h2>计分板</h2>
            <ul>
              <li v-for="s in scoreboard" :key="s.userId" class="score-row">
                <span>{{ usernameOf(s.userId) }}</span>
                <span>{{ s.score }}</span>
              </li>
            </ul>
          </section>

          <section class="chat-panel">
            <div class="chat-log">
              <p v-for="entry in game.state.chatLog" :key="entry.id" class="chat-line" :class="entry.type">
                <strong>{{ usernameOf(entry.userId) }}：</strong>{{ entry.text }}
              </p>
            </div>
            <form class="chat-form" @submit.prevent="submitChat">
              <input v-model="chatText" placeholder="聊天 / 输入猜的词" maxlength="200" />
              <button type="submit">发送</button>
            </form>
            <p v-if="chatError" class="error-msg small">{{ chatError }}</p>
          </section>
        </aside>
      </div>
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

.error-msg.small {
  margin-top: 4px;
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

.turn-result {
  text-align: center;
  background: #fff4e0;
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 14px;
  font-size: 15px;
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

.custom-word-form {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 10px;
}

.custom-word-form input {
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
}

.game-body {
  display: flex;
  gap: 20px;
}

.canvas-col {
  flex: 1;
  min-width: 0;
}

.side-col {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.scoreboard,
.chat-panel {
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

.chat-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 220px;
}

.chat-log {
  flex: 1;
  overflow-y: auto;
  max-height: 320px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.chat-line {
  font-size: 13px;
  margin: 0;
  word-break: break-word;
}

.chat-line.correct {
  color: #2e7d32;
  font-weight: 600;
}

.chat-form {
  display: flex;
  gap: 6px;
}

.chat-form input {
  flex: 1;
  padding: 7px 10px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 13px;
}

.chat-form button {
  border: none;
  border-radius: 8px;
  background: var(--accent, #4c8dff);
  color: #fff;
  padding: 7px 14px;
  font-size: 13px;
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

@media (max-width: 768px) {
  .game-body {
    flex-direction: column;
  }
  .side-col {
    width: 100%;
  }
}
</style>
