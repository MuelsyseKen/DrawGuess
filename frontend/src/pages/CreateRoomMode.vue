<script setup>
import { useRouter } from 'vue-router';

const router = useRouter();

const modes = [
  {
    value: 'guess',
    icon: '🎯',
    title: '竞猜模式',
    desc: '一人画画，其他人聊天框里抢答，越早猜中分越高。',
  },
  {
    value: 'chain',
    icon: '🔗',
    title: '接龙模式',
    desc: '所有人同时画词，轮流传递猜词，看最后猜出的词是否和最初一致。',
  },
];

function selectMode(mode) {
  router.push({ name: 'create-settings', params: { mode } });
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <button type="button" class="back-btn" @click="router.push({ name: 'home' })">← 返回大厅</button>
      <h1>创建房间</h1>
    </header>

    <p class="hint">选择一种玩法</p>

    <div class="mode-cards">
      <button
        v-for="m in modes"
        :key="m.value"
        type="button"
        class="mode-card"
        @click="selectMode(m.value)"
      >
        <span class="mode-icon">{{ m.icon }}</span>
        <span class="mode-title">{{ m.title }}</span>
        <span class="mode-desc">{{ m.desc }}</span>
      </button>
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
  margin-bottom: 24px;
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
  font-size: 22px;
  margin: 0;
}

.hint {
  color: #999;
  font-size: 13px;
  margin-bottom: 20px;
}

.mode-cards {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}

.mode-card {
  flex: 1 1 260px;
  min-width: 220px;
  border: 1px solid #e5e5e5;
  border-radius: 16px;
  background: var(--surface, #fff);
  padding: 28px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  cursor: pointer;
  transition: box-shadow 0.15s ease, transform 0.15s ease, border-color 0.15s ease;
}

.mode-card:hover {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
  border-color: var(--accent, #4c8dff);
}

.mode-icon {
  font-size: 40px;
}

.mode-title {
  font-size: 18px;
  font-weight: 700;
  color: #222;
}

.mode-desc {
  font-size: 13px;
  color: #888;
  line-height: 1.5;
}

@media (max-width: 480px) {
  .mode-cards {
    flex-direction: column;
  }
  .mode-card {
    min-width: 0;
  }
}
</style>
