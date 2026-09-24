// 油漆桶：基于像素的泛洪填充（4 方向，栈实现，带颜色容差以兼容描边的抗锯齿边缘）。
// 只在画布位图上执行，不感知矢量数据——服务端只存"在哪个点、填什么颜色"这个意图（见 FULLREADME 12.1 节）。

const TOLERANCE = 48; // 每个通道允许的最大差值，太小会被抗锯齿边缘卡住，太大会填过界

function colorAt(data, idx) {
  return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
}

function matches(data, idx, target) {
  return (
    Math.abs(data[idx] - target[0]) <= TOLERANCE &&
    Math.abs(data[idx + 1] - target[1]) <= TOLERANCE &&
    Math.abs(data[idx + 2] - target[2]) <= TOLERANCE &&
    Math.abs(data[idx + 3] - target[3]) <= TOLERANCE
  );
}

function hexToRgba(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b, 255];
}

// ctx: CanvasRenderingContext2D；px/py: 像素坐标；hexColor: '#RRGGBB'
export function floodFill(ctx, width, height, px, py, hexColor) {
  px = Math.floor(px);
  py = Math.floor(py);
  if (px < 0 || py < 0 || px >= width || py >= height) return;

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const startIdx = (py * width + px) * 4;
  const target = colorAt(data, startIdx);
  const fillColor = hexToRgba(hexColor);

  // 目标点已经是要填的颜色，不用做
  if (
    Math.abs(target[0] - fillColor[0]) < 4 &&
    Math.abs(target[1] - fillColor[1]) < 4 &&
    Math.abs(target[2] - fillColor[2]) < 4 &&
    Math.abs(target[3] - fillColor[3]) < 4
  ) {
    return;
  }

  const stack = [[px, py]];
  const visited = new Uint8Array(width * height);

  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const vIdx = y * width + x;
    if (visited[vIdx]) continue;
    const idx = vIdx * 4;
    if (!matches(data, idx, target)) continue;

    visited[vIdx] = 1;
    data[idx] = fillColor[0];
    data[idx + 1] = fillColor[1];
    data[idx + 2] = fillColor[2];
    data[idx + 3] = fillColor[3];

    stack.push([x + 1, y]);
    stack.push([x - 1, y]);
    stack.push([x, y + 1]);
    stack.push([x, y - 1]);
  }

  ctx.putImageData(imageData, 0, 0);
}
