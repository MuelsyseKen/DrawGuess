<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../stores/auth';
import AuthModal from '../components/AuthModal.vue';

const auth = useAuth();
const router = useRouter();
const showAuthModal = ref(false);
const placeholderMsg = ref('');

onMounted(() => {
  auth.init();
});

async function handleLogout() {
  await auth.logout();
}

const ROOM_ENTRY_ROUTES = { create: 'create', join: 'join' };
const NAV_ENTRY_ROUTES = { records: 'records-history', leaderboard: 'leaderboard', drawings: 'my-drawings' };

function requireLoginThen(routeName) {
  if (!auth.state.user) {
    placeholderMsg.value = '请先登录';
    setTimeout(() => {
      placeholderMsg.value = '';
    }, 2000);
    showAuthModal.value = true;
    return;
  }
  router.push({ name: routeName });
}

function handleRoomEntryClick(kind) {
  requireLoginThen(ROOM_ENTRY_ROUTES[kind]);
}

function handleNavClick(kind) {
  requireLoginThen(NAV_ENTRY_ROUTES[kind]);
}
</script>

<template>
  <div class="lobby">
    <header class="lobby-header">
      <div class="user-area">
        <template v-if="auth.state.user">
          <span class="username">{{ auth.state.user.username }}</span>
          <button type="button" class="link-btn" @click="handleLogout">登出</button>
        </template>
        <template v-else>
          <button type="button" class="link-btn" @click="showAuthModal = true">登录</button>
        </template>
      </div>
    </header>

    <main class="lobby-main">
      <h1 class="title">你猜我画</h1>
      <p class="subtitle">Muelsyse &amp; long_ken &amp; Claude</p>

      <div class="entry-cards">
        <button type="button" class="entry-card" @click="handleRoomEntryClick('create')">
          <span class="entry-icon">🎨</span>
          <span class="entry-label">创建房间</span>
        </button>
        <button type="button" class="entry-card" @click="handleRoomEntryClick('join')">
          <span class="entry-icon">🚪</span>
          <span class="entry-label">加入房间</span>
        </button>
      </div>

      <p v-if="placeholderMsg" class="placeholder-toast">{{ placeholderMsg }}</p>

      <nav class="nav-links">
        <button type="button" class="nav-link" @click="handleNavClick('records')">📜 我的战绩</button>
        <button type="button" class="nav-link" @click="handleNavClick('leaderboard')">🏆 排行榜</button>
        <button type="button" class="nav-link" @click="handleNavClick('drawings')">🖼️ 我的作画记录</button>
      </nav>
    </main>

    <AuthModal v-if="showAuthModal" @close="showAuthModal = false" />
  </div>
</template>

<style scoped>
.lobby {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.lobby-header {
  display: flex;
  justify-content: flex-start;
  padding: 16px 20px;
}

.user-area {
  display: flex;
  align-items: center;
  gap: 10px;
}

.username {
  font-weight: 600;
  color: #333;
}

.link-btn {
  border: none;
  background: none;
  color: var(--accent, #4c8dff);
  font-size: 14px;
  cursor: pointer;
  padding: 4px 8px;
}

.lobby-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 20px;
}

.title {
  font-size: 32px;
  margin: 0 0 6px;
}

.subtitle {
  color: #999;
  margin: 0 0 32px;
  font-size: 13px;
}

.entry-cards {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  justify-content: center;
}

.entry-card {
  width: 160px;
  height: 130px;
  border: 1px solid #e5e5e5;
  border-radius: 14px;
  background: var(--surface, #fff);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  cursor: pointer;
  transition: box-shadow 0.15s ease, transform 0.15s ease;
}

.entry-card:hover {
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}

.entry-icon {
  font-size: 32px;
}

.entry-label {
  font-size: 15px;
  font-weight: 600;
  color: #333;
}

.placeholder-toast {
  margin-top: 24px;
  font-size: 13px;
  color: #999;
}

.nav-links {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 32px;
}

.nav-link {
  border: none;
  background: none;
  color: #666;
  font-size: 13px;
  cursor: pointer;
  padding: 6px 4px;
}

.nav-link:hover {
  color: var(--accent, #4c8dff);
}

/* 响应式：小屏幕下入口卡片纵向排列、缩小尺寸 */
@media (max-width: 480px) {
  .title {
    font-size: 26px;
  }

  .entry-card {
    width: 100%;
    max-width: 260px;
    height: 100px;
  }
}
</style>
