<script setup>
// 画板引擎核心组件：Canvas + 工具栏（见 FULLREADME.md 第5节界面布局 / 第12节协议）。
// 设计为可复用组件——Phase 4/5 的竞猜/接龙游戏内页面会直接引入这个组件，
// 不需要重写画板逻辑，只需要在外层加"当前是否轮到你画"之类的权限判断（见第12.1节范围说明）。
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useCanvas } from './useCanvas';
import { hitTestStroke } from './hitTest';
import { CANVAS_SIZE, toPx, drawPath, drawAction } from './render';

const props = defineProps({
  roomId: { type: String, required: true },
  // 对应房间设置里的 brushMode / colorMode（见 FULLREADME 第4节），未传时按"可调节 + RGB"处理
  brushMode: { type: String, default: 'adjustable' }, // 'fixed' | 'adjustable'
  colorMode: { type: String, default: 'rgb' }, // 'rgb' | 'mono'
  // Phase 4 起：竞猜对局里非作画者传 true，禁用工具栏 + 屏蔽画板交互（见 FULLREADME 第13.4节）。
  // 这是前端的"双重保险"，真正的权限校验在服务端（canvas.js 的 requireCanDraw），
  // 就算这里被绕过，服务端也会拒绝，不会出现"前端隐藏了但后端没管"的假安全。
  readOnly: { type: Boolean, default: false },
  // Phase 5 起：接龙模式一个房间里同时存在多条链、多个独立画板，传这个字段告诉
  // useCanvas 去操作哪一条链的画板（见 FULLREADME 第14.5节）；不传时行为不变，
  // 沿用"每个房间一块画板"的 Phase 3/4 语义（测试页、竞猜模式都不用传）。
  chainOwnerId: { type: [String, Number], default: null },
});

const FIXED_WIDTH = 4;
const MONO_COLOR = '#000000';
const COLOR_PRESETS = ['#000000', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#ffffff'];

const canvas = useCanvas();

const canvasEl = ref(null);
const wrapEl = ref(null);

const tool = ref('brush'); // 'brush' | 'eraser' | 'lineEraser' | 'bucket' | 'colorPicker'
const color = ref(props.colorMode === 'mono' ? MONO_COLOR : '#e53935');
const width = ref(props.brushMode === 'fixed' ? FIXED_WIDTH : 6);
const toolBeforePicker = ref('brush');

const own = reactive({
  drawing: false,
  points: [],
  tempId: '',
});
const eraseDragSeen = new Set(); // 本次线擦拖拽里已经处理过的 actionId，避免重复请求

const busy = reactive({ undo: false, redo: false, clear: false });

let lastProgressAt = 0;
let lastProgressPoint = null;
const PROGRESS_MIN_INTERVAL_MS = 40;
const PROGRESS_MIN_DIST = 0.004; // 归一化距离阈值，太密集的点没必要都发（见 FULLREADME 12.4 节）

function ctx2d() {
  return canvasEl.value ? canvasEl.value.getContext('2d') : null;
}

function normalizedFromEvent(evt) {
  const rect = canvasEl.value.getBoundingClientRect();
  const x = (evt.clientX - rect.left) / rect.width;
  const y = (evt.clientY - rect.top) / rect.height;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

function redraw() {
  const ctx = ctx2d();
  if (!ctx) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.restore();

  for (const action of canvas.visibleActions.value) {
    drawAction(ctx, action);
  }

  // 自己正在画的这一笔（还没提交）+ 其他人正在画的实时预览
  if (own.drawing && own.points.length > 0) {
    drawPath(ctx, own.points, color.value, width.value, tool.value === 'eraser');
  }
  for (const preview of Object.values(canvas.state.livePreviews)) {
    drawPath(ctx, preview.points, preview.color, preview.width, preview.tool === 'eraser');
  }
}

watch(() => canvas.visibleActions.value, redraw, { deep: false });
watch(() => canvas.state.livePreviews, redraw, { deep: true });

function pickColorAt(pt) {
  const ctx = ctx2d();
  const p = toPx(pt);
  const px = Math.min(CANVAS_SIZE - 1, Math.max(0, Math.floor(p.x)));
  const py = Math.min(CANVAS_SIZE - 1, Math.max(0, Math.floor(p.y)));
  const data = ctx.getImageData(px, py, 1, 1).data;
  const hex = '#' + [data[0], data[1], data[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  return hex;
}

function eraserRadiusNormalized() {
  return width.value / 2 / CANVAS_SIZE + 0.01;
}

function handleLineEraseAt(pt) {
  const radius = eraserRadiusNormalized();
  for (const action of canvas.visibleActions.value) {
    if (eraseDragSeen.has(action.id)) continue;
    if (hitTestStroke(action, pt.x, pt.y, radius)) {
      eraseDragSeen.add(action.id);
      canvas.eraseStroke(props.roomId, props.chainOwnerId, action.id).catch(() => {
        // 极小概率的竞态（比如别人同时擦了同一条），忽略即可，不打断当前拖拽
      });
    }
  }
}

function onPointerDown(evt) {
  if (!canvas.state.ready || props.readOnly) return;
  canvasEl.value.setPointerCapture(evt.pointerId);
  const pt = normalizedFromEvent(evt);

  if (tool.value === 'colorPicker') {
    color.value = pickColorAt(pt);
    tool.value = toolBeforePicker.value;
    return;
  }
  if (tool.value === 'bucket') {
    canvas.fill(props.roomId, props.chainOwnerId, { point: pt, color: color.value }).catch(() => {});
    return;
  }
  if (tool.value === 'lineEraser') {
    eraseDragSeen.clear();
    handleLineEraseAt(pt);
    own.drawing = true; // 复用 drawing 标记来维持 pointermove 事件持续触发（不实际画线）
    return;
  }

  own.drawing = true;
  own.points = [{ ...pt, t: Date.now() }];
  own.tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  lastProgressAt = 0;
  lastProgressPoint = null;
  redraw();
}

function onPointerMove(evt) {
  if (!own.drawing) return;
  const pt = normalizedFromEvent(evt);

  if (tool.value === 'lineEraser') {
    handleLineEraseAt(pt);
    return;
  }

  own.points.push({ ...pt, t: Date.now() });
  redraw();

  const now = Date.now();
  const distOk =
    !lastProgressPoint || Math.hypot(pt.x - lastProgressPoint.x, pt.y - lastProgressPoint.y) >= PROGRESS_MIN_DIST;
  if (now - lastProgressAt >= PROGRESS_MIN_INTERVAL_MS && distOk) {
    lastProgressAt = now;
    lastProgressPoint = pt;
    canvas.sendStrokeProgress(props.roomId, props.chainOwnerId, {
      tempId: own.tempId,
      tool: tool.value,
      color: color.value,
      width: width.value,
      points: own.points,
    });
  }
}

function onPointerUp() {
  if (!own.drawing) return;
  own.drawing = false;

  if (tool.value === 'lineEraser') {
    eraseDragSeen.clear();
    return;
  }

  const points = own.points;
  own.points = [];
  if (points.length === 0) return;

  canvas
    .strokeEnd(props.roomId, props.chainOwnerId, {
      tempId: own.tempId,
      tool: tool.value,
      color: color.value,
      width: width.value,
      points,
    })
    .catch(() => {
      // 提交失败（比如校验没过）：本地这一笔直接丢弃，下一次 redraw 会清掉（own.points 已清空）
    })
    .finally(redraw);
}

async function handleUndo() {
  busy.undo = true;
  try {
    await canvas.undo(props.roomId, props.chainOwnerId);
  } finally {
    busy.undo = false;
  }
}

async function handleRedo() {
  busy.redo = true;
  try {
    await canvas.redo(props.roomId, props.chainOwnerId);
  } finally {
    busy.redo = false;
  }
}

async function handleClear() {
  busy.clear = true;
  try {
    await canvas.clear(props.roomId, props.chainOwnerId);
  } finally {
    busy.clear = false;
  }
}

function selectTool(t) {
  // 记住"切到取色器之前用的工具"，取色完成后自动切回去（见 onPointerDown 里的取色分支）
  if (t !== 'colorPicker') toolBeforePicker.value = t;
  tool.value = t;
}

onMounted(async () => {
  await canvas.enter(props.roomId, props.chainOwnerId);
  await nextTick();
  redraw();
});

// 接龙模式（第14节）里同一个 CanvasBoard 实例可能在不同回合被复用、但指向不同的链
// （chainOwnerId 变化，比如从"我在画链A"切到之后"我在画链C"）；防御性地重新 enter 一次，
// 保证画板镜像切到新的那一条链，不残留上一条链的动作。
watch(
  () => props.chainOwnerId,
  async (val, oldVal) => {
    if (val === oldVal) return;
    await canvas.enter(props.roomId, val);
    await nextTick();
    redraw();
  }
);

onBeforeUnmount(() => {
  // 不销毁服务端会话（房间销毁时后端自己清），这里只是离开这个组件的视图
});
</script>

<template>
  <div class="canvas-board" ref="wrapEl" :class="{ 'read-only': readOnly }">
    <aside class="toolbar">
      <div class="tool-group" v-if="brushMode === 'adjustable'">
        <label class="tool-label">画笔粗细</label>
        <input type="range" min="1" max="64" v-model.number="width" :disabled="readOnly" />
        <span class="width-value">{{ width }}px</span>
      </div>

      <div class="tool-group tool-buttons">
        <button type="button" class="tool-btn" :disabled="readOnly" :class="{ active: tool === 'brush' }" @click="selectTool('brush')" title="画笔">🖌️</button>
        <button type="button" class="tool-btn" :disabled="readOnly" :class="{ active: tool === 'eraser' }" @click="selectTool('eraser')" title="橡皮擦">🧹</button>
        <button type="button" class="tool-btn" :disabled="readOnly" :class="{ active: tool === 'lineEraser' }" @click="selectTool('lineEraser')" title="线擦（整条擦除）">✂️</button>
        <button type="button" class="tool-btn" :disabled="readOnly" :class="{ active: tool === 'bucket' }" @click="selectTool('bucket')" title="油漆桶">🪣</button>
        <button type="button" class="tool-btn" :disabled="readOnly" :class="{ active: tool === 'colorPicker' }" @click="selectTool('colorPicker')" title="取色器">🎯</button>
      </div>

      <div class="tool-group" v-if="colorMode === 'rgb'">
        <label class="tool-label">RGB 颜色</label>
        <input type="color" v-model="color" class="color-input" :disabled="readOnly" />
        <div class="palette">
          <button
            v-for="c in COLOR_PRESETS"
            :key="c"
            type="button"
            class="swatch"
            :disabled="readOnly"
            :class="{ active: color === c }"
            :style="{ background: c }"
            @click="color = c"
          />
        </div>
      </div>

      <div class="tool-group">
        <label class="tool-label">当前颜色</label>
        <div class="current-color" :style="{ background: color }"></div>
      </div>

      <div class="tool-group actions">
        <button type="button" class="action-btn" :disabled="readOnly || busy.undo" @click="handleUndo">撤回</button>
        <button type="button" class="action-btn" :disabled="readOnly || busy.redo" @click="handleRedo">重做</button>
        <button type="button" class="action-btn danger" :disabled="readOnly || busy.clear" @click="handleClear">清空</button>
      </div>
    </aside>

    <div class="canvas-area">
      <p v-if="canvas.state.loadError" class="error-msg">{{ canvas.state.loadError }}</p>
      <canvas
        ref="canvasEl"
        :width="CANVAS_SIZE"
        :height="CANVAS_SIZE"
        class="board"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @pointerleave="onPointerUp"
      ></canvas>
    </div>
  </div>
</template>

<style scoped>
.canvas-board {
  display: flex;
  gap: 16px;
  width: 100%;
}

.toolbar {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 140px;
  flex-shrink: 0;
}

.tool-group {
  border: 1px solid #eee;
  border-radius: 10px;
  padding: 10px;
}

.tool-label {
  display: block;
  font-size: 12px;
  color: #999;
  margin-bottom: 6px;
}

.tool-buttons {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  padding: 8px;
}

.tool-btn {
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 8px;
  font-size: 18px;
  padding: 8px 0;
  cursor: pointer;
}

.tool-btn.active {
  border-color: var(--accent, #4c8dff);
  background: #eef4ff;
}

.color-input {
  width: 100%;
  height: 32px;
  border: none;
  padding: 0;
  background: none;
  cursor: pointer;
}

.palette {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-top: 8px;
}

.swatch {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  border: 2px solid #eee;
  cursor: pointer;
}

.swatch.active {
  border-color: var(--accent, #4c8dff);
}

.current-color {
  width: 100%;
  height: 28px;
  border-radius: 6px;
  border: 1px solid #ddd;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: none;
  padding: 0;
}

.action-btn {
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 8px;
  padding: 8px 0;
  font-size: 13px;
  cursor: pointer;
}

.action-btn.danger {
  color: #c0392b;
  border-color: #f3c9c4;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.canvas-area {
  flex: 1;
  min-width: 0;
}

.board {
  width: 100%;
  aspect-ratio: 1 / 1;
  max-width: 720px;
  border: 1px solid #ddd;
  border-radius: 12px;
  background: #fff;
  touch-action: none;
  cursor: crosshair;
  display: block;
}

.canvas-board.read-only .board {
  cursor: not-allowed;
}

.canvas-board.read-only .toolbar {
  opacity: 0.5;
}

.error-msg {
  color: #e0433d;
  font-size: 13px;
}

@media (max-width: 768px) {
  .canvas-board {
    flex-direction: column-reverse;
  }
  .toolbar {
    width: 100%;
    flex-direction: row;
    overflow-x: auto;
    gap: 10px;
    padding-bottom: 4px;
  }
  .tool-group {
    flex-shrink: 0;
  }
  .tool-buttons {
    grid-template-columns: repeat(5, 1fr);
    grid-auto-flow: column;
  }
  .palette {
    grid-template-columns: repeat(4, 1fr);
    width: 120px;
  }
  .actions {
    flex-direction: row;
  }
}
</style>
