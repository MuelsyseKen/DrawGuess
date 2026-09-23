import { reactive, readonly } from 'vue';
import * as authApi from '../api/auth';

const state = reactive({
  user: null, // { id, username, createdAt } | null
  initialized: false, // 是否已经完成过一次"启动时查登录态"
  loading: false,
});

async function init() {
  if (state.initialized) return;
  state.loading = true;
  try {
    const { user } = await authApi.fetchMe();
    state.user = user;
  } catch (err) {
    state.user = null;
  } finally {
    state.loading = false;
    state.initialized = true;
  }
}

async function doLogin(username, password) {
  const { user } = await authApi.login(username, password);
  state.user = user;
  return user;
}

async function doRegister(username, password) {
  const { user } = await authApi.register(username, password);
  state.user = user;
  return user;
}

async function doLogout() {
  await authApi.logout();
  state.user = null;
}

export function useAuth() {
  return {
    state: readonly(state),
    init,
    login: doLogin,
    register: doRegister,
    logout: doLogout,
  };
}
