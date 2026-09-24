import { createRouter, createWebHistory } from 'vue-router';
import Home from '../pages/Home.vue';
import CreateRoomMode from '../pages/CreateRoomMode.vue';
import CreateRoomSettings from '../pages/CreateRoomSettings.vue';
import JoinRoom from '../pages/JoinRoom.vue';
import RoomLobby from '../pages/RoomLobby.vue';
import CanvasTest from '../pages/CanvasTest.vue';
import { useAuth } from '../stores/auth';

// 页面地图（见 FULLREADME.md 第3节）：
//   Phase 1 落地了“首页/大厅” + 登录注册弹窗。
//   Phase 2 补上创建房间（模式选择/参数设置）、加入房间、房间大厅页。
//   Phase 3 补上 /room/:id/canvas-test——画板引擎的联调测试页，不是正式游戏页面（见 FULLREADME 第12节）。
//   正式游戏内页面 / 结算页仍然留给 Phase 4/5。
const routes = [
  { path: '/', name: 'home', component: Home },
  { path: '/create', name: 'create', component: CreateRoomMode, meta: { requiresAuth: true } },
  { path: '/create/:mode', name: 'create-settings', component: CreateRoomSettings, meta: { requiresAuth: true } },
  { path: '/join', name: 'join', component: JoinRoom, meta: { requiresAuth: true } },
  { path: '/room/:id', name: 'room-lobby', component: RoomLobby, meta: { requiresAuth: true } },
  { path: '/room/:id/canvas-test', name: 'canvas-test', component: CanvasTest, meta: { requiresAuth: true } },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// 路由守卫：房间相关页面需要登录（Phase 1 记在 FULLREADME.md 第10节#15 的已知取舍，Phase 2 补上）。
// 未登录时跳回大厅，大厅页会展示登录入口。
router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true;
  const auth = useAuth();
  if (!auth.state.initialized) {
    await auth.init();
  }
  if (!auth.state.user) {
    return { name: 'home' };
  }
  return true;
});

export default router;
