<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { fetchMyDrawings, fetchDrawingDetail } from '../api/records';
import { extractErrorMessage } from '../utils/errors';
import ActionsPreview from '../canvas/ActionsPreview.vue';

const router = useRouter();

const drawings = ref([]);
const total = ref(0);
const offset = ref(0);
const limit = 20;
const loading = ref(false);
const error = ref('');

const modeLabel = { guess: '竞猜', chain: '接龙' };

// 列表接口只返回元信息（word/mode/score/time），不带完整笔迹——缩略图列表不需要真的
// 画出每一幅画（那样要给每一条记录都单独发一次详情请求，列表一长就是几十个并发请求）。
// 点开某一条才按需拉取完整 actions，用同一个 ActionsPreview.vue 渲染（和结算页复用同一套）。
const detail = ref(null); // 当前弹窗展示的详情，null 表示没打开
const detailLoading = ref(false);
const detailError = ref('');

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

async function load({ reset } = {}) {
  loading.value = true;
  error.value = '';
  try {
    const nextOffset = reset ? 0 : offset.value;
    const { drawings: rows, total: t } = await fetchMyDrawings({ limit, offset: nextOffset });
    drawings.value = reset ? rows : [...drawings.value, ...rows];
    total.value = t;
    offset.value = nextOffset + rows.length;
  } catch (e) {
    error.value = extractErrorMessage(e, '作画记录加载失败');
  } finally {
    loading.value = false;
  }
}

async function openDetail(row) {
  detail.value = { ...row, actions: null };
  detailLoading.value = true;
  detailError.value = '';
  try {
    detail.value = await fetchDrawingDetail(row.id);
  } catch (e) {
    detailError.value = extractErrorMessage(e, '作画记录加载失败');
  } finally {
    detailLoading.value = false;
  }
}

function closeDetail() {
  detail.value = null;
  detailError.value = '';
}

onMounted(() => load({ reset: true }));
</script>

<template>
  <div class="page">
    <header class="page-header">
      <button type="button" class="back-btn" @click="router.push({ name: 'home' })">← 返回大厅</button>
      <h1>我的作画记录</h1>
    </header>

    <p v-if="error" class="error-msg">{{ error }}</p>
    <p v-else-if="!loading && drawings.length === 0" class="hint">还没有留下任何画作，去玩一局试试。</p>

    <div v-if="drawings.length" class="drawing-grid">
      <button
        v-for="d in drawings"
        :key="d.id"
        type="button"
        class="drawing-card"
        @click="openDetail(d)"
      >
        <span class="card-mode" :class="d.mode">{{ modeLabel[d.mode] || d.mode || '—' }}</span>
        <span class="card-word">{{ d.word || '（自定义出题）' }}</span>
        <span class="card-time">{{ formatTime(d.createdAt) }}</span>
      </button>
    </div>

    <button
      v-if="drawings.length < total"
      type="button"
      class="more-btn"
      :disabled="loading"
      @click="load()"
    >
      {{ loading ? '加载中…' : '加载更多' }}
    </button>
    <p v-else-if="loading && drawings.length === 0" class="hint">加载中…</p>

    <div v-if="detail" class="modal-backdrop" @click.self="closeDetail">
      <div class="modal-panel">
        <button type="button" class="close-btn" @click="closeDetail">✕</button>
        <p v-if="detailError" class="error-msg">{{ detailError }}</p>
        <template v-else>
          <ActionsPreview :actions="detail.actions || []" />
          <div class="modal-meta">
            <span class="modal-word">{{ detail.word || '（自定义出题）' }}</span>
            <span class="modal-time">{{ formatTime(detail.createdAt) }}</span>
          </div>
          <p v-if="detailLoading" class="hint">加载中…</p>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 20px;
  max-width: 720px;
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

.drawing-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.drawing-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  border: 1px solid #eee;
  border-radius: 10px;
  padding: 14px;
  background: var(--surface, #fff);
  cursor: pointer;
  text-align: left;
  aspect-ratio: 1 / 1;
  justify-content: space-between;
}

.drawing-card:hover {
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
}

.card-mode {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
}

.card-mode.guess {
  color: #4c8dff;
  background: rgba(76, 141, 255, 0.12);
}

.card-mode.chain {
  color: #ff8a4c;
  background: rgba(255, 138, 76, 0.12);
}

.card-word {
  font-size: 18px;
  font-weight: 700;
  color: #333;
  word-break: break-all;
}

.card-time {
  font-size: 11px;
  color: #999;
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

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 100;
}

.modal-panel {
  position: relative;
  width: 100%;
  max-width: 420px;
  background: var(--surface, #fff);
  border-radius: 14px;
  padding: 20px;
}

.close-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  border: none;
  background: none;
  font-size: 16px;
  cursor: pointer;
  color: #999;
  line-height: 1;
  padding: 6px;
}

.modal-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
}

.modal-word {
  font-size: 18px;
  font-weight: 700;
  color: #333;
}

.modal-time {
  font-size: 12px;
  color: #999;
}

@media (max-width: 480px) {
  .drawing-grid {
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  }
}
</style>
