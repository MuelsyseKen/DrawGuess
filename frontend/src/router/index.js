import { createRouter, createWebHistory } from 'vue-router';
import Home from '../pages/Home.vue';

// 页面地图（见 FULLREADME.md 第3节）：
//   Phase 1 只落地"首页/大厅" + 登录注册弹窗。
//   加入房间 / 创建房间 / 房间大厅 / 游戏内页面 / 结算页 从 Phase 2 开始逐步补上。
const routes = [
  { path: '/', name: 'home', component: Home },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
