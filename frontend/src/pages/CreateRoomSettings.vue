<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { fetchWordbanks } from '../api/rooms';
import { useRoom } from '../stores/room';
import { extractErrorMessage } from '../utils/errors';
import {
  PLAYER_RANGE,
  DRAW_SECONDS_PRESETS,
  DRAW_SECONDS_CUSTOM_RANGE,
  GUESS_SECONDS_PRESETS,
  GUESS_SECONDS_CUSTOM_RANGE,
  ROUNDS_PRESETS,
  ROUNDS_RANGE,
  CHAIN_ROUNDS_RANGE,
  SPECIAL_EFFECTS,
  defaultSettings,
} from '../rooms/settingsSchema';

const route = useRoute();
const router = useRouter();
const room = useRoom();

const mode = route.params.mode === 'chain' ? 'chain' : 'guess';
const range = PLAYER_RANGE[mode];

const form = reactive(defaultSettings(mode));
form.maxPlayers = Math.min(Math.max(form.maxPlayers, range.min), range.max);

const drawSecondsMode = ref('preset'); // 'preset' | 'custom'
const guessSecondsMode = ref('preset');
const roundsMode = ref('preset');

const categories = ref([]);
const loadingCategories = ref(false);
const submitting = ref(false);
const errorMsg = ref('');

onMounted(async () => {
  loadingCategories.value = true;
  try {
    const { categories: list } = await fetchWordbanks();
    categories.value = list;
    if (form.wordSource === 'system' && !form.wordCategory && list.length) {
      form.wordCategory = list[0].id;
    }
  } catch (e) {
    // 词库拉取失败不阻断创建流程，用户可以切到"玩家自己出题"
    categories.value = [];
  } finally {
    loadingCategories.value = false;
  }
});

const canSubmit = computed(() => {
  if (form.wordSource === 'system' && !form.wordCategory) return false;
  return true;
});

async function handleSubmit() {
  errorMsg.value = '';
  submitting.value = true;
  try {
    const settings = { ...form };
    if (settings.wordSource !== 'system') settings.wordCategory = undefined;
    const createdRoom = await room.createRoom(mode, false, settings);
    router.push({ name: 'room-lobby', params: { id: createdRoom.id } });
  } catch (e) {
    errorMsg.value = extractErrorMessage(e, '创建房间失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <button type="button" class="back-btn" @click="router.push({ name: 'create' })">← 重新选择模式</button>
      <h1>{{ mode === 'chain' ? '接龙模式' : '竞猜模式' }}设置</h1>
    </header>

    <form class="settings-form" @submit.prevent="handleSubmit">
      <div class="columns">
        <section class="col">
          <h2>玩法</h2>

          <div class="field">
            <label>人数上限（{{ range.min }}~{{ range.max }}）</label>
            <input type="number" v-model.number="form.maxPlayers" :min="range.min" :max="range.max" />
          </div>

          <div class="field">
            <label>特殊效果</label>
            <div class="pill-group">
              <button
                v-for="opt in SPECIAL_EFFECTS"
                :key="opt.value"
                type="button"
                class="pill"
                :class="{ active: form.specialEffect === opt.value, disabled: opt.disabled }"
                :disabled="opt.disabled"
                :title="opt.disabled ? '本期仅作 UI 占位，暂不可用' : ''"
                @click="form.specialEffect = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <div class="field">
            <label>笔刷</label>
            <div class="radio-group">
              <label><input type="radio" value="fixed" v-model="form.brushMode" /> 单一笔刷</label>
              <label><input type="radio" value="adjustable" v-model="form.brushMode" /> 可调节</label>
            </div>
          </div>

          <div class="field">
            <label>颜色</label>
            <div class="radio-group">
              <label><input type="radio" value="rgb" v-model="form.colorMode" /> RGB</label>
              <label><input type="radio" value="mono" v-model="form.colorMode" /> 单色</label>
            </div>
          </div>

          <template v-if="mode === 'chain'">
            <div class="field">
              <label><input type="checkbox" v-model="form.anonymousVoting" /> 匿名投票（只隐藏投票人身份，结果依然公开）</label>
            </div>
            <div class="field">
              <label><input type="checkbox" v-model="form.showDrawingProcess" /> 加框画作展示环节</label>
            </div>
          </template>
        </section>

        <section class="col">
          <h2>时间与回合</h2>

          <div class="field">
            <label>绘画时间</label>
            <div class="pill-group">
              <button
                v-for="s in DRAW_SECONDS_PRESETS"
                :key="s"
                type="button"
                class="pill"
                :class="{ active: drawSecondsMode === 'preset' && form.drawSeconds === s }"
                @click="drawSecondsMode = 'preset'; form.drawSeconds = s"
              >
                {{ s }}s
              </button>
              <button
                type="button"
                class="pill"
                :class="{ active: drawSecondsMode === 'custom' }"
                @click="drawSecondsMode = 'custom'"
              >
                自定义
              </button>
            </div>
            <input
              v-if="drawSecondsMode === 'custom'"
              type="number"
              v-model.number="form.drawSeconds"
              :min="DRAW_SECONDS_CUSTOM_RANGE.min"
              :max="DRAW_SECONDS_CUSTOM_RANGE.max"
              placeholder="10~900 秒"
            />
          </div>

          <div class="field" v-if="mode === 'chain'">
            <label>猜测时间</label>
            <div class="pill-group">
              <button
                v-for="s in GUESS_SECONDS_PRESETS"
                :key="s"
                type="button"
                class="pill"
                :class="{ active: guessSecondsMode === 'preset' && form.guessSeconds === s }"
                @click="guessSecondsMode = 'preset'; form.guessSeconds = s"
              >
                {{ s }}s
              </button>
              <button
                type="button"
                class="pill"
                :class="{ active: guessSecondsMode === 'custom' }"
                @click="guessSecondsMode = 'custom'"
              >
                自定义
              </button>
            </div>
            <input
              v-if="guessSecondsMode === 'custom'"
              type="number"
              v-model.number="form.guessSeconds"
              :min="GUESS_SECONDS_CUSTOM_RANGE.min"
              :max="GUESS_SECONDS_CUSTOM_RANGE.max"
              placeholder="10~300 秒"
            />
          </div>

          <div class="field">
            <label>回合</label>
            <div class="pill-group">
              <button
                v-for="r in ROUNDS_PRESETS"
                :key="r"
                type="button"
                class="pill"
                :class="{ active: roundsMode === 'preset' && form.rounds === r }"
                @click="roundsMode = 'preset'; form.rounds = r"
              >
                {{ r }}
              </button>
              <button
                type="button"
                class="pill"
                :class="{ active: roundsMode === 'custom' }"
                @click="roundsMode = 'custom'"
              >
                自定义
              </button>
            </div>
            <input
              v-if="roundsMode === 'custom'"
              type="number"
              v-model.number="form.rounds"
              :min="ROUNDS_RANGE.min"
              :max="ROUNDS_RANGE.max"
              placeholder="1~10"
            />
          </div>

          <div class="field" v-if="mode === 'chain'">
            <label>接龙次数（{{ CHAIN_ROUNDS_RANGE.min }}~{{ CHAIN_ROUNDS_RANGE.max }} 环）</label>
            <input type="number" v-model.number="form.chainRounds" :min="CHAIN_ROUNDS_RANGE.min" :max="CHAIN_ROUNDS_RANGE.max" />
          </div>

          <div class="field">
            <label>词库</label>
            <div class="radio-group">
              <label><input type="radio" value="custom" v-model="form.wordSource" /> 玩家自己出题</label>
              <label><input type="radio" value="system" v-model="form.wordSource" /> 系统出题</label>
            </div>
            <select v-if="form.wordSource === 'system'" v-model="form.wordCategory" :disabled="loadingCategories">
              <option v-if="!categories.length" value="" disabled>
                {{ loadingCategories ? '加载中…' : '暂无可用词库分类' }}
              </option>
              <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}（{{ c.wordCount }} 词）</option>
            </select>
          </div>
        </section>
      </div>

      <p v-if="errorMsg" class="error-msg">{{ errorMsg }}</p>

      <button type="submit" class="submit-btn" :disabled="!canSubmit || submitting">
        {{ submitting ? '创建中…' : '创建房间' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 20px;
  max-width: 860px;
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

.columns {
  display: flex;
  gap: 32px;
  flex-wrap: wrap;
}

.col {
  flex: 1 1 320px;
  min-width: 280px;
}

.col h2 {
  font-size: 15px;
  color: #666;
  margin: 0 0 14px;
}

.field {
  margin-bottom: 18px;
}

.field > label:first-child {
  display: block;
  font-size: 13px;
  color: #444;
  margin-bottom: 6px;
  font-weight: 600;
}

.field input[type='number'],
.field select {
  width: 100%;
  max-width: 240px;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
  margin-top: 6px;
  box-sizing: border-box;
}

.radio-group {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 14px;
}

.radio-group label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.pill-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.pill {
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
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

.error-msg {
  color: #e0433d;
  font-size: 13px;
  margin: 8px 0 0;
}

.submit-btn {
  margin-top: 24px;
  width: 100%;
  max-width: 320px;
  padding: 12px 20px;
  border: none;
  border-radius: 10px;
  background: var(--accent, #4c8dff);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 600px) {
  .columns {
    flex-direction: column;
    gap: 8px;
  }
  .submit-btn {
    max-width: none;
  }
}
</style>
