<script setup>
import { ref, computed } from 'vue';
import { useAuth } from '../stores/auth';
import { extractErrorMessage } from '../utils/errors';

const emit = defineEmits(['close']);

const auth = useAuth();

const mode = ref('login'); // 'login' | 'register'
const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const errorMsg = ref('');
const submitting = ref(false);

const isRegister = computed(() => mode.value === 'register');

function switchMode(next) {
  mode.value = next;
  errorMsg.value = '';
}

async function handleSubmit() {
  errorMsg.value = '';

  if (!username.value || !password.value) {
    errorMsg.value = '用户名和密码不能为空';
    return;
  }
  if (isRegister.value && password.value !== confirmPassword.value) {
    errorMsg.value = '两次输入的密码不一致';
    return;
  }

  submitting.value = true;
  try {
    if (isRegister.value) {
      await auth.register(username.value, password.value);
    } else {
      await auth.login(username.value, password.value);
    }
    emit('close');
  } catch (err) {
    errorMsg.value = extractErrorMessage(err, isRegister.value ? '注册失败' : '登录失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-card">
      <div class="modal-tabs">
        <button
          type="button"
          class="tab-btn"
          :class="{ active: mode === 'login' }"
          @click="switchMode('login')"
        >
          登录
        </button>
        <button
          type="button"
          class="tab-btn"
          :class="{ active: mode === 'register' }"
          @click="switchMode('register')"
        >
          注册
        </button>
        <button type="button" class="close-btn" aria-label="关闭" @click="emit('close')">✕</button>
      </div>

      <form class="modal-form" @submit.prevent="handleSubmit">
        <label class="field">
          <span>用户名</span>
          <input v-model.trim="username" type="text" autocomplete="username" placeholder="3~20 位字母/数字/下划线/中文" minlength="3" maxlength="20" />
        </label>

        <label class="field">
          <span>密码</span>
          <input
            v-model="password"
            type="password"
            :autocomplete="isRegister ? 'new-password' : 'current-password'"
            placeholder="至少 6 位"
            minlength="6"
            maxlength="72"
          />
        </label>

        <label v-if="isRegister" class="field">
          <span>确认密码</span>
          <input v-model="confirmPassword" type="password" autocomplete="new-password" minlength="6" maxlength="72" />
        </label>

        <p v-if="errorMsg" class="error-msg">{{ errorMsg }}</p>

        <button type="submit" class="submit-btn" :disabled="submitting">
          {{ submitting ? '提交中…' : isRegister ? '注册' : '登录' }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 100;
}

.modal-card {
  width: 100%;
  max-width: 360px;
  background: var(--surface, #fff);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}

.modal-tabs {
  display: flex;
  align-items: center;
  border-bottom: 1px solid #eee;
}

.tab-btn {
  flex: 1;
  padding: 14px 0;
  background: none;
  border: none;
  font-size: 15px;
  cursor: pointer;
  color: #888;
}

.tab-btn.active {
  color: #333;
  font-weight: 600;
  box-shadow: inset 0 -2px 0 var(--accent, #4c8dff);
}

.close-btn {
  border: none;
  background: none;
  padding: 0 14px;
  font-size: 16px;
  cursor: pointer;
  color: #aaa;
}

.modal-form {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #555;
}

.field input {
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 15px;
}

.field input:focus {
  outline: none;
  border-color: var(--accent, #4c8dff);
}

.error-msg {
  color: #e0523f;
  font-size: 13px;
  margin: 0;
}

.submit-btn {
  margin-top: 4px;
  padding: 11px 0;
  border: none;
  border-radius: 8px;
  background: var(--accent, #4c8dff);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 小屏幕适配 */
@media (max-width: 420px) {
  .modal-card {
    max-width: 100%;
  }
}
</style>
