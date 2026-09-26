<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { fetchMyRecords } from '../api/records';
import { extractErrorMessage } from '../utils/errors';

const router = useRouter();

const modeTab = ref('all'); // 'all' | 'guess' | 'chain'
const records = ref([]);
const total = ref(0);
const offset = ref(0);
const limit = 20;
const loading = ref(false);
const error = ref('');

const modeLabel = { guess: '竞猜', chain: '接龙' };

function formatTime(iso) {
  // playedAt 是 strftime('%Y-%m-%dT%H:%M:%fZ','now') 出来的 UTC ISO 字符串，
  // 用原生 Date 转成本地时间展示即可，不需要额外引入日期库。
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

async function load({ reset } = {}) {
  loading.value = true;
  error.value = '';
  try {
    const nextOffset = reset ? 0 : offset.value;
    const { records: rows, total: t } = await fetchMyRecords({
      mode: modeTab.value === 'all' ? undefined : modeTab.value,
      limit,
      offset: nextOffset,
    });
    records.value = reset ? rows : [...records.value, ...rows];
    total.value = t;
    offset.value = nextOffset + rows.length;
  } catch (e) {
    error.value = extractErrorMessage(e, '战绩加载失败');
  } finally {
    loading.value = false;
  }
}

function switchTab(tab) {
  if (modeTab.value === tab) return;
  modeTab.value = tab;
  load({ reset: true });
}

onMounted(() => load({ reset: true }));
</script>

<template>
  <div class="page">
    <header class="page-header">
      <button type="button" class="back-btn" @click="router.push({ name: 'home' })">← 返回大厅</button>
      <h1>我的战绩</h1>
    </header>

    <div class="tabs">
      <button type="button" class="tab" :class="{ active: modeTab === 'all' }" @click="switchTab('all')">全部</button>
      <button type="button" class="tab" :class="{ active: modeTab === 'guess' }" @click="switchTab('guess')">竞猜</button>
      <button type="button" class="tab" :class="{ active: modeTab === 'chain' }" @click="switchTab('chain')">接龙</button>
    </div>

    <p v-if="error" class="error-msg">{{ error }}</p>
    <p v-else-if="!loading && records.length === 0" class="hint">还没有对局记录，去玩一局吧。</p>

    <ul v-if="records.length" class="record-list">
      <li v-for="r in records" :key="r.id" class="record-item">
        <div class="record-main">
          <span class="mode-badge" :class="r.mode">{{ modeLabel[r.mode] || r.mode }}</span>
          <span class="record-time">{{ formatTime(r.playedAt) }}</span>
        </div>
        <span class="record-score">{{ r.score }} 分</span>
      </li>
    </ul>

    <button
      v-if="records.length < total"
      type="button"
      class="more-btn"
      :disabled="loading"
      @click="load()"
    >
      {{ loading ? '加载中…' : '加载更多' }}
    </button>
    <p v-else-if="loading && records.length === 0" class="hint">加载中…</p>
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

.record-list {
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.record-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid #eee;
  border-radius: 10px;
  padding: 12px 14px;
  gap: 10px;
  background: var(--surface, #fff);
}

.record-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.mode-badge {
  font-size: 12px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
  white-space: nowrap;
}

.mode-badge.guess {
  color: #4c8dff;
  background: rgba(76, 141, 255, 0.12);
}

.mode-badge.chain {
  color: #ff8a4c;
  background: rgba(255, 138, 76, 0.12);
}

.record-time {
  color: #999;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.record-score {
  font-weight: 700;
  color: #333;
  white-space: nowrap;
}

.more-btn {
  display: block;
  width: 100%;
  padding: 10px;
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 10px;
  cursor: pointer;
  font-size: 14px;
  color: var(--accent, #4c8dff);
}

.more-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 480px) {
  .record-time {
    max-width: 140px;
  }
}
</style>
