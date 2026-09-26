<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { fetchLeaderboard } from '../api/records';
import { useAuth } from '../stores/auth';
import { extractErrorMessage } from '../utils/errors';

const router = useRouter();
const auth = useAuth();

const modeTab = ref('all'); // 'all' | 'guess' | 'chain'
const leaderboard = ref([]);
const me = ref(null);
const loading = ref(false);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await fetchLeaderboard({
      mode: modeTab.value === 'all' ? undefined : modeTab.value,
      limit: 50,
    });
    leaderboard.value = data.leaderboard;
    me.value = data.me;
  } catch (e) {
    error.value = extractErrorMessage(e, '排行榜加载失败');
  } finally {
    loading.value = false;
  }
}

function switchTab(tab) {
  if (modeTab.value === tab) return;
  modeTab.value = tab;
  load();
}

// 自己是否已经出现在当前展示的前 N 名列表里——出现了就不需要在底部再重复展示一条"我的排名"
function meInList() {
  if (!me.value || !auth.state.user) return true;
  return leaderboard.value.some((row) => row.userId === auth.state.user.id);
}

onMounted(load);
</script>

<template>
  <div class="page">
    <header class="page-header">
      <button type="button" class="back-btn" @click="router.push({ name: 'home' })">← 返回大厅</button>
      <h1>排行榜</h1>
    </header>

    <div class="tabs">
      <button type="button" class="tab" :class="{ active: modeTab === 'all' }" @click="switchTab('all')">总分</button>
      <button type="button" class="tab" :class="{ active: modeTab === 'guess' }" @click="switchTab('guess')">竞猜</button>
      <button type="button" class="tab" :class="{ active: modeTab === 'chain' }" @click="switchTab('chain')">接龙</button>
    </div>

    <p v-if="error" class="error-msg">{{ error }}</p>
    <p v-else-if="!loading && leaderboard.length === 0" class="hint">还没有人有战绩，快去玩一局占领榜首吧。</p>
    <p v-else-if="loading" class="hint">加载中…</p>

    <ol v-if="leaderboard.length" class="board-list">
      <li
        v-for="row in leaderboard"
        :key="row.userId"
        class="board-item"
        :class="{ mine: auth.state.user && row.userId === auth.state.user.id }"
      >
        <span class="rank" :class="{ top: row.rank <= 3 }">{{ row.rank }}</span>
        <span class="username">{{ row.username }}</span>
        <span class="games">{{ row.gamesPlayed }} 局</span>
        <span class="score">{{ row.totalScore }} 分</span>
      </li>
    </ol>

    <div v-if="me && !meInList()" class="my-rank-wrap">
      <p class="hint">我的排名</p>
      <div class="board-item mine standalone">
        <span class="rank">{{ me.rank }}</span>
        <span class="username">{{ me.username }}</span>
        <span class="games">{{ me.gamesPlayed }} 局</span>
        <span class="score">{{ me.totalScore }} 分</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 20px;
  max-width: 560px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.back-btn {
  border: none;
  background: none;
  color: var(--accent, #4c8dff);
  cursor: pointer;
  font-size: 14px;
  padding: 4px 0;
}

.page-header h1 {
  font-size: 20px;
  margin: 0;
}

.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}

.tab {
  flex: 1;
  padding: 10px;
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 10px;
  cursor: pointer;
  font-size: 14px;
}

.tab.active {
  border-color: var(--accent, #4c8dff);
  color: var(--accent, #4c8dff);
  font-weight: 600;
}

.hint {
  color: #999;
  font-size: 13px;
  margin-bottom: 12px;
  text-align: center;
}

.error-msg {
  color: #e0433d;
  font-size: 13px;
  margin: 8px 0;
}

.board-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.board-item {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid #eee;
  border-radius: 10px;
  padding: 10px 14px;
  background: var(--surface, #fff);
}

.board-item.mine {
  border-color: var(--accent, #4c8dff);
  background: rgba(76, 141, 255, 0.06);
}

.rank {
  width: 26px;
  flex-shrink: 0;
  font-weight: 700;
  color: #999;
  text-align: center;
}

.rank.top {
  color: #ff8a4c;
}

.username {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  color: #333;
}

.games {
  color: #999;
  font-size: 12px;
  white-space: nowrap;
}

.score {
  font-weight: 700;
  color: var(--accent, #4c8dff);
  white-space: nowrap;
  min-width: 56px;
  text-align: right;
}

.my-rank-wrap {
  margin-top: 20px;
}

.board-item.standalone {
  margin-top: 4px;
}

@media (max-width: 480px) {
  .games {
    display: none;
  }
}
</style>
