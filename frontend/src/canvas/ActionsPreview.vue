<script setup>
// 静态画作预览（见 FULLREADME.md 第14.6节"结算展示"）：接龙模式结算时要同时回看
// 一条链上好几步的历史画作，跟 CanvasBoard.vue 那套"联网、可交互、单例状态"的画板不是一回事，
// 这里只是把一份 actions 数组一次性画到一个独立的 <canvas> 上，不订阅任何 socket 事件。
import { ref, watch, onMounted, nextTick } from 'vue';
import { CANVAS_SIZE, renderActions } from './render';

const props = defineProps({
  actions: { type: Array, default: () => [] },
});

const canvasEl = ref(null);

function redraw() {
  const ctx = canvasEl.value ? canvasEl.value.getContext('2d') : null;
  if (!ctx) return;
  renderActions(ctx, props.actions || []);
}

watch(() => props.actions, redraw, { deep: false });

onMounted(async () => {
  await nextTick();
  redraw();
});
</script>

<template>
  <div class="preview-wrap">
    <canvas ref="canvasEl" :width="CANVAS_SIZE" :height="CANVAS_SIZE" class="preview-canvas"></canvas>
  </div>
</template>

<style scoped>
.preview-wrap {
  width: 100%;
  aspect-ratio: 1 / 1;
  border: 1px solid #eee;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}

.preview-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
