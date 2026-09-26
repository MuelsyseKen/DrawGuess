// 画板动作 -> Canvas 2D 渲染的纯函数（见 FULLREADME.md 第12节协议）。
// 从 CanvasBoard.vue 抽出（Phase 5），因为接龙模式结算展示（第14节）需要同时静态渲染
// 多条链的历史画作，不能复用 CanvasBoard 那套"实时可交互 + 单例 useCanvas 状态"的逻辑，
// 只需要这里的纯绘制部分。CanvasBoard.vue 现在也从这里导入，避免两份重复实现。
import { floodFill } from './floodFill';

export const CANVAS_SIZE = 1000; // 内部固定参考分辨率，见 FULLREADME 第12.1节

export function toPx(pt) {
  return { x: pt.x * CANVAS_SIZE, y: pt.y * CANVAS_SIZE };
}

export function drawPath(ctx, points, strokeColor, strokeWidth, erase) {
  if (points.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.strokeStyle = strokeColor;
  ctx.fillStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (points.length === 1) {
    const p = toPx(points[0]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, strokeWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    const p0 = toPx(points[0]);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < points.length; i++) {
      const p = toPx(points[i]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function drawAction(ctx, action) {
  if (action.type === 'stroke') {
    drawPath(ctx, action.points, action.color, action.width, action.tool === 'eraser');
  } else if (action.type === 'fill') {
    const p = toPx(action.point);
    floodFill(ctx, CANVAS_SIZE, CANVAS_SIZE, p.x, p.y, action.color);
  }
}

// 在 ctx 上把整份 actions（已按可见性规则过滤好的列表）从白底开始画一遍。
export function renderActions(ctx, actions) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.restore();
  for (const action of actions) {
    drawAction(ctx, action);
  }
}
