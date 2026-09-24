// 线擦命中检测：判断一个点（画布内部参考分辨率像素坐标）是否落在某条 stroke 的路径附近。
// 只对 stroke 生效（fill 没有路径概念，见 FULLREADME 12.4 节"已知限制"）。

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// action: 一条可见的 stroke 动作（points 是归一化 0~1 坐标）
// px, py: 归一化 0~1 坐标；eraserRadius: 归一化半径（线擦笔头大小换算成 0~1 比例）
export function hitTestStroke(action, px, py, eraserRadius) {
  if (action.type !== 'stroke') return false;
  const threshold = eraserRadius + action.width / 2 / 1000; // width 是 1000 参考分辨率下的像素值，换算回 0~1
  const pts = action.points;
  if (pts.length === 1) {
    return Math.hypot(px - pts[0].x, py - pts[0].y) <= threshold;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(px, py, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    if (d <= threshold) return true;
  }
  return false;
}
