<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { fetchPublicRooms } from '../api/rooms';
import { useRoom } from '../stores/room';
import { extractErrorMessage } from '../utils/errors';

const router = useRouter();
const room = useRoom();

const tab = ref('private'); // 'private' | 'public'

const inviteCode = ref('');
const joiningCode = ref(false);
const codeError = ref('');

const publicRooms = ref([]);
const loadingPublic = ref(false);
const publicError = ref('');
const joiningRoomId = ref(null);

const modeLabel = { guess: '竞猜', chain: '接龙' };

async function loadPublicRooms() {
  loadingPublic.value = true;
  publicError.value = '';
  try {
    const { rooms } = await fetchPublicRooms();
    publicRooms.value = rooms;
  } catch (e) {
    publicError.value = extractErrorMessage(e, '公开房间列表加载失败');
  } finally {
    loadingPublic.value = false;
  }
}

function switchTab(t) {
  tab.value = t;
  if (t === 'public' && publicRooms.value.length === 0) {
    loadPublicRooms();
  }
}

async function handleJoinByCode() {
  codeError.value = '';
  const code = inviteCode.value.trim().toUpperCase();
  if (!code) {
    codeError.value = '请输入邀请码';
    return;
  }
  joiningCode.value = true;
  try {
    const joined = await room.joinByCode(code);
    router.push({ name: 'room-lobby', params: { id: joined.id } });
  } catch (e) {
    codeError.value = extractErrorMessage(e, '加入房间失败');
  } finally {
    joiningCode.value = false;
  }
}

async function handleJoinPublic(r) {
  publicError.value = '';
  joiningRoomId.value = r.id;
  try {
    const joined = await room.joinPublic(r.id);
    router.push({ name: 'room-lobby', params: { id: joined.id } });
  } catch (e) {
    publicError.value = extractErrorMessage(e, '加入房间失败');
    loadPublicRooms();
  } finally {
    joiningRoomId.value = null;
  }
}

onMounted(() => {
  if (tab.value === 'public') loadPublicRooms();
});
</script>

<template>
  <div class="page">
    <header class="page-header">
      <button type="button" class="back-btn" @click="router.push({ name: 'home' })">← 返回大厅</button>
      <h1>加入房间</h1>
    </header>

    <div class="tabs">
      <button type="button" class="tab" :class="{ active: tab === 'private' }" @click="switchTab('private')">私人房间</button>
      <button type="button" class="tab" :class="{ active: tab === 'public' }" @click="switchTab('public')">公开房间</button>
    </div>

    <section v-if="tab === 'private'" class="panel">
      <p class="hint">输入房主给你的 6 位邀请码</p>
      <form class="code-form" @submit.prevent="handleJoinByCode">
        <input
          v-model="inviteCode"
          type="text"
          maxlength="6"
          placeholder="邀请码"
          class="code-input"
          autocomplete="off"
        />
        <button type="submit" class="join-btn" :disabled="joiningCode">
          {{ joiningCode ? '加入中…' : '加入' }}
        </button>
      </form>
      <p v-if="codeError" class="error-msg">{{ codeError }}</p>
    </section>

    <section v-else class="panel">
      <p v-if="publicError" class="error-msg">{{ publicError }}</p>
      <p v-if="loadingPublic" class="hint">加载中…</p>
      <p v-else-if="!publicRooms.length" class="hint">暂时没有公开房间，换个邀请码或稍后再来看看。</p>

      <ul v-else class="room-list">
        <li v-for="r in publicRooms" :key="r.id" class="room-item">
          <div class="room-info">
            <span class="room-mode">{{ modeLabel[r.mode] || r.mode }}</span>
            <span class="room-host">{{ r.hostUsername }} 的房间</span>
            <span class="room-count">{{ r.playerCount }}/{{ r.maxPlayers }} 人</span>
          </div>
          <button
            type="button"
            class="join-btn small"
            :disabled="joiningRoomId === r.id || r.playerCount >= r.maxPlayers"
            @click="handleJoinPublic(r)"
          >
            {{ r.playerCount >= r.maxPlayers ? '已满' : joiningRoomId === r.id ? '加入中…' : '加入' }}
          </button>
        </li>
      </ul>

      <button type="button" class="refresh-btn" @click="loadPublicRooms" :disabled="loadingPublic">刷新列表</button>
    </section>
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
}

.code-form {
  display: flex;
  gap: 10px;
}

.code-input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 16px;
  letter-spacing: 2px;
  text-transform: uppercase;
}

.join-btn {
  padding: 10px 18px;
  border: none;
  border-radius: 8px;
  background: var(--accent, #4c8dff);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.join-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.join-btn.small {
  padding: 6px 14px;
  font-size: 13px;
}

.error-msg {
  color: #e0433d;
  font-size: 13px;
  margin: 8px 0;
}

.room-list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.room-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid #eee;
  border-radius: 10px;
  padding: 12px 14px;
  gap: 10px;
}

.room-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  min-width: 0;
}

.room-mode {
  font-weight: 700;
  color: #333;
}

.room-host {
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.room-count {
  color: #999;
}

.refresh-btn {
  border: none;
  background: none;
  color: var(--accent, #4c8dff);
  font-size: 13px;
  cursor: pointer;
  padding: 4px 0;
}

@media (max-width: 480px) {
  .code-form {
    flex-direction: column;
  }
  .join-btn {
    width: 100%;
  }
}
</style>
