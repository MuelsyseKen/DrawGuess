<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '../stores/auth';
import { useRoom } from '../stores/room';
import { fetchWordbanks } from '../api/rooms';
import { extractErrorMessage } from '../utils/errors';
import {
  PLAYER_RANGE,
  DRAW_SECONDS_PRESETS,
  GUESS_SECONDS_PRESETS,
  ROUNDS_PRESETS,
  CHAIN_ROUNDS_RANGE,
  SPECIAL_EFFECTS,
} from '../rooms/settingsSchema';

const route = useRoute();
const router = useRouter();
const auth = useAuth();
const room = useRoom();

const loading = ref(true);
const loadError = ref('');
const copyHint = ref('');

const editingSettings = ref(false);
const editError = ref('');
const savingSettings = ref(false);
const editForm = reactive({});
const categories = ref([]);

const modeLabel = { guess: '竞猜模式', chain: '接龙模式' };

const isHost = computed(() => {
  if (!room.state.room || !auth.state.user) return false;
  return room.state.room.hostUserId === auth.state.user.id;
});

async function ensureRoomLoaded() {
  loading.value = true;
  loadError.value = '';
  try {
    if (!room.state.room || room.state.room.id !== route.params.id) {
      await room.syncCurrent();
    }
    if (!room.state.room || room.state.room.id !== route.params.id) {
      loadError.value = '房间不存在，或你已不在这个房间里';
    }
  } catch (e) {
    loadError.value = extractErrorMessage(e, '加载房间失败');
  } finally {
    loading.value = false;
  }
}

function copyInviteCode() {
  const code = room.state.room?.inviteCode;
  if (!code) return;
  navigator.clipboard?.writeText(code).then(() => {
    copyHint.value = '已复制';
    setTimeout(() => (copyHint.value = ''), 1500);
  });
}

async function handleLeave() {
  try {
    await room.leaveRoom();
  } finally {
    router.push({ name: 'home' });
  }
}

async function handleTogglePublic() {
  if (!isHost.value || !room.state.room) return;
  try {
    await room.setPublic(!room.state.room.isPublic);
  } catch (e) {
    loadError.value = extractErrorMessage(e, '切换公开/私人失败');
  }
}

async function openSettingsEditor() {
  editError.value = '';
  Object.assign(editForm, room.state.room.settings);
  if (editForm.wordSource === 'system' && categories.value.length === 0) {
    try {
      const { categories: list } = await fetchWordbanks();
      categories.value = list;
    } catch (e) {
      categories.value = [];
    }
  }
  editingSettings.value = true;
}

async function saveSettings() {
  savingSettings.value = true;
  editError.value = '';
  try {
    const settings = { ...editForm };
    if (settings.wordSource !== 'system') settings.wordCategory = undefined;
    await room.updateSettings(settings);
    editingSettings.value = false;
  } catch (e) {
    editError.value = extractErrorMessage(e, '保存设置失败');
  } finally {
    savingSettings.value = false;
  }
}

watch(
  () => route.params.id,
  () => ensureRoomLoaded()
);

onMounted(async () => {
  if (!auth.state.initialized) await auth.init();
  await ensureRoomLoaded();
});
</script>

<template>
  <div class="page">
    <header class="page-header">
      <button type="button" class="back-btn" @click="handleLeave">← 离开房间</button>
      <h1 v-if="room.state.room">{{ modeLabel[room.state.room.mode] }}</h1>
    </header>

    <p v-if="loading" class="hint">加载中…</p>
    <p v-else-if="loadError" class="error-msg">{{ loadError }}</p>

    <template v-else-if="room.state.room">
      <section class="invite-card">
        <div class="invite-left">
          <span class="invite-label">邀请码</span>
          <span class="invite-code">{{ room.state.room.inviteCode }}</span>
          <button type="button" class="copy-btn" @click="copyInviteCode">{{ copyHint || '复制' }}</button>
        </div>
        <div class="visibility">
          <span :class="['badge', room.state.room.isPublic ? 'public' : 'private']">
            {{ room.state.room.isPublic ? '公开房间' : '私人房间' }}
          </span>
          <button v-if="isHost" type="button" class="link-btn" @click="handleTogglePublic">
            切换为{{ room.state.room.isPublic ? '私人' : '公开' }}
          </button>
        </div>
      </section>

      <section class="players-card">
        <h2>玩家（{{ room.state.room.players.length }}/{{ room.state.room.settings.maxPlayers }}）</h2>
        <ul class="player-list">
          <li v-for="p in room.state.room.players" :key="p.userId" class="player-item">
            <span class="player-name">{{ p.username }}</span>
            <span v-if="p.isHost" class="badge host">房主</span>
            <span v-if="!p.connected" class="badge reconnecting">掉线重连中…</span>
          </li>
        </ul>
      </section>

      <section class="settings-card">
        <div class="settings-header">
          <h2>房间设置</h2>
          <button v-if="isHost && !editingSettings" type="button" class="link-btn" @click="openSettingsEditor">修改</button>
        </div>

        <template v-if="!editingSettings">
          <dl class="settings-view">
            <div><dt>绘画时间</dt><dd>{{ room.state.room.settings.drawSeconds }} 秒</dd></div>
            <div v-if="room.state.room.mode === 'chain'"><dt>猜测时间</dt><dd>{{ room.state.room.settings.guessSeconds }} 秒</dd></div>
            <div><dt>回合</dt><dd>{{ room.state.room.settings.rounds }}</dd></div>
            <div v-if="room.state.room.mode === 'chain'"><dt>接龙次数</dt><dd>{{ room.state.room.settings.chainRounds }} 环</dd></div>
            <div><dt>笔刷</dt><dd>{{ room.state.room.settings.brushMode === 'fixed' ? '单一笔刷' : '可调节' }}</dd></div>
            <div><dt>颜色</dt><dd>{{ room.state.room.settings.colorMode === 'rgb' ? 'RGB' : '单色' }}</dd></div>
            <div><dt>词库</dt><dd>{{ room.state.room.settings.wordSource === 'system' ? `系统出题（${room.state.room.settings.wordCategory}）` : '玩家自己出题' }}</dd></div>
            <div v-if="room.state.room.mode === 'chain'"><dt>匿名投票</dt><dd>{{ room.state.room.settings.anonymousVoting ? '开启' : '关闭' }}</dd></div>
          </dl>
        </template>

        <form v-else class="edit-form" @submit.prevent="saveSettings">
          <div class="field">
            <label>人数上限（{{ PLAYER_RANGE[room.state.room.mode].min }}~{{ PLAYER_RANGE[room.state.room.mode].max }}）</label>
            <input type="number" v-model.number="editForm.maxPlayers" :min="PLAYER_RANGE[room.state.room.mode].min" :max="PLAYER_RANGE[room.state.room.mode].max" />
          </div>
          <div class="field">
            <label>特殊效果</label>
            <div class="pill-group">
              <button
                v-for="opt in SPECIAL_EFFECTS"
                :key="opt.value"
                type="button"
                class="pill"
                :class="{ active: editForm.specialEffect === opt.value, disabled: opt.disabled }"
                :disabled="opt.disabled"
                @click="editForm.specialEffect = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
          <div class="field">
            <label>绘画时间</label>
            <div class="pill-group">
              <button v-for="s in DRAW_SECONDS_PRESETS" :key="s" type="button" class="pill" :class="{ active: editForm.drawSeconds === s }" @click="editForm.drawSeconds = s">{{ s }}s</button>
            </div>
            <input type="number" v-model.number="editForm.drawSeconds" min="10" max="900" />
          </div>
          <div class="field" v-if="room.state.room.mode === 'chain'">
            <label>猜测时间</label>
            <div class="pill-group">
              <button v-for="s in GUESS_SECONDS_PRESETS" :key="s" type="button" class="pill" :class="{ active: editForm.guessSeconds === s }" @click="editForm.guessSeconds = s">{{ s }}s</button>
            </div>
            <input type="number" v-model.number="editForm.guessSeconds" min="10" max="300" />
          </div>
          <div class="field">
            <label>回合</label>
            <div class="pill-group">
              <button v-for="r in ROUNDS_PRESETS" :key="r" type="button" class="pill" :class="{ active: editForm.rounds === r }" @click="editForm.rounds = r">{{ r }}</button>
            </div>
            <input type="number" v-model.number="editForm.rounds" min="1" max="10" />
          </div>
          <div class="field" v-if="room.state.room.mode === 'chain'">
            <label>接龙次数（{{ CHAIN_ROUNDS_RANGE.min }}~{{ CHAIN_ROUNDS_RANGE.max }} 环）</label>
            <input type="number" v-model.number="editForm.chainRounds" :min="CHAIN_ROUNDS_RANGE.min" :max="CHAIN_ROUNDS_RANGE.max" />
          </div>
          <div class="field" v-if="room.state.room.mode === 'chain'">
            <label><input type="checkbox" v-model="editForm.anonymousVoting" /> 匿名投票</label>
          </div>
          <div class="field" v-if="room.state.room.mode === 'chain'">
            <label><input type="checkbox" v-model="editForm.showDrawingProcess" /> 加框画作展示环节</label>
          </div>
          <div class="field">
            <label>词库</label>
            <div class="radio-group">
              <label><input type="radio" value="custom" v-model="editForm.wordSource" /> 玩家自己出题</label>
              <label><input type="radio" value="system" v-model="editForm.wordSource" /> 系统出题</label>
            </div>
            <select v-if="editForm.wordSource === 'system'" v-model="editForm.wordCategory">
              <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}（{{ c.wordCount }} 词）</option>
            </select>
          </div>

          <p v-if="editError" class="error-msg">{{ editError }}</p>

          <div class="edit-actions">
            <button type="button" class="link-btn" @click="editingSettings = false">取消</button>
            <button type="submit" class="save-btn" :disabled="savingSettings">{{ savingSettings ? '保存中…' : '保存' }}</button>
          </div>
        </form>
      </section>

      <p class="hint start-hint">
        游戏开始功能将在后续 Phase 实现，当前只支持房间管理。
        <router-link :to="{ name: 'canvas-test', params: { id: room.state.room.id } }">试试画板引擎（Phase 3 测试页）</router-link>
      </p>
    </template>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 20px;
  max-width: 640px;
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
}

.error-msg {
  color: #e0433d;
  font-size: 13px;
}

.invite-card,
.players-card,
.settings-card {
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}

.invite-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.invite-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.invite-label {
  font-size: 12px;
  color: #999;
}

.invite-code {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 3px;
  color: #333;
}

.copy-btn {
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.visibility {
  display: flex;
  align-items: center;
  gap: 10px;
}

.badge {
  display: inline-block;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
}

.badge.public {
  background: #e6f4ea;
  color: #2e7d32;
}

.badge.private {
  background: #f1f1f1;
  color: #666;
}

.badge.host {
  background: #fff4e0;
  color: #b8720a;
}

.badge.reconnecting {
  background: #fdecea;
  color: #c0392b;
}

.link-btn {
  border: none;
  background: none;
  color: var(--accent, #4c8dff);
  cursor: pointer;
  font-size: 13px;
}

.players-card h2,
.settings-card h2 {
  font-size: 14px;
  color: #666;
  margin: 0 0 12px;
}

.player-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.player-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.player-name {
  font-weight: 600;
  color: #333;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.settings-view {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px 16px;
  margin: 0;
}

.settings-view > div {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  border-bottom: 1px dashed #eee;
  padding-bottom: 6px;
}

.settings-view dt {
  color: #999;
}

.settings-view dd {
  margin: 0;
  color: #333;
  font-weight: 600;
}

.edit-form .field {
  margin-bottom: 14px;
}

.edit-form label {
  display: block;
  font-size: 13px;
  color: #444;
  margin-bottom: 6px;
  font-weight: 600;
}

.edit-form input[type='number'],
.edit-form select {
  width: 100%;
  max-width: 220px;
  padding: 7px 10px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
  margin-top: 6px;
  box-sizing: border-box;
}

.radio-group {
  display: flex;
  gap: 16px;
  font-size: 13px;
}

.radio-group label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 400;
}

.pill-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.pill {
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}

.pill.active {
  border-color: var(--accent, #4c8dff);
  color: var(--accent, #4c8dff);
  font-weight: 600;
}

.pill.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 8px;
}

.save-btn {
  border: none;
  border-radius: 8px;
  background: var(--accent, #4c8dff);
  color: #fff;
  padding: 8px 18px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.start-hint {
  text-align: center;
  margin-top: 20px;
}

@media (max-width: 480px) {
  .settings-view {
    grid-template-columns: 1fr;
  }
  .invite-card {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
