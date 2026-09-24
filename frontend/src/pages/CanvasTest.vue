<script setup>
// Phase 3 测试入口：正式游戏内页面（含"当前是否轮到你画"的权限判断）留给 Phase 4/5，
// 这里只是把 CanvasBoard.vue 挂到一个独立路由上，方便本 Phase 联调多端实时同步。
// 见 FULLREADME.md 第12节"范围说明"。
import { onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '../stores/auth';
import { useRoom } from '../stores/room';
import CanvasBoard from '../canvas/CanvasBoard.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuth();
const room = useRoom();

const settings = computed(() => room.state.room?.settings || {});

onMounted(async () => {
  if (!auth.state.initialized) await auth.init();
  if (!room.state.room || room.state.room.id !== route.params.id) {
    await room.syncCurrent();
  }
});
</script>

<template>
  <div class="page">
    <header class="page-header">
      <button type="button" class="back-btn" @click="router.push({ name: 'room-lobby', params: { id: route.params.id } })">← 返回房间</button>
      <h1>画板引擎测试</h1>
    </header>
    <p class="hint">这是 Phase 3 的联调测试页，不是正式游戏页面——房间内任意玩家都可以画，正式对局的"轮到谁画"规则在 Phase 4/5 接入。</p>

    <template v-if="room.state.room && room.state.room.id === route.params.id">
      <CanvasBoard :room-id="room.state.room.id" :brush-mode="settings.brushMode || 'adjustable'" :color-mode="settings.colorMode || 'rgb'" />
    </template>
    <p v-else class="hint">加载中…</p>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 20px;
  max-width: 900px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 8px;
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
  margin-bottom: 16px;
}
</style>
