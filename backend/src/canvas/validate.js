// 画板协议输入校验（见 FULLREADME.md 第12.3节）：不合法直接拒绝，不做静默裁剪。
'use strict';

const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const STROKE_TOOLS = ['brush', 'eraser'];
const MAX_POINTS = 2000; // 一笔正常不可能画出这么多点，这个上限只是兜底防御

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateColor(color) {
  if (typeof color !== 'string' || !COLOR_RE.test(color)) {
    throw fail('INVALID_STROKE', 'color 必须是 #RRGGBB 格式');
  }
}

function validateWidth(width) {
  if (!isFiniteNumber(width) || width < 1 || width > 64) {
    throw fail('INVALID_STROKE', 'width 必须是 1~64 之间的数字');
  }
}

function validatePoint(point) {
  if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
    throw fail('INVALID_STROKE', 'point 必须包含数字 x/y');
  }
  if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
    throw fail('INVALID_STROKE', 'point 的 x/y 必须在 0~1 之间');
  }
}

function validatePoints(points) {
  if (!Array.isArray(points) || points.length === 0) {
    throw fail('INVALID_STROKE', 'points 必须是非空数组');
  }
  if (points.length > MAX_POINTS) {
    throw fail('INVALID_STROKE', `points 数量超过上限 ${MAX_POINTS}`);
  }
  for (const p of points) {
    validatePoint(p);
    if (!isFiniteNumber(p.t)) {
      throw fail('INVALID_STROKE', 'point 必须包含数字 t');
    }
  }
}

// canvas:strokeEnd 的 payload 校验，返回规整后的字段
function validateStrokePayload(payload) {
  const { tool, color, width, points } = payload || {};
  if (!STROKE_TOOLS.includes(tool)) {
    throw fail('INVALID_STROKE', "tool 必须是 'brush' 或 'eraser'");
  }
  validateColor(color);
  validateWidth(width);
  validatePoints(points);
  return { tool, color, width, points };
}

// canvas:fill 的 payload 校验
function validateFillPayload(payload) {
  const { point, color } = payload || {};
  validatePoint(point);
  validateColor(color);
  return { point: { x: point.x, y: point.y }, color };
}

// canvas:strokeProgress 是转发广播、不落日志，校验从宽（避免高频事件里一次不合法就报错打断绘画），
// 但仍要基本过滤类型，避免把奇怪的东西转发给其他客户端。
function sanitizeProgressPayload(payload) {
  const { tempId, tool, color, width, points } = payload || {};
  if (typeof tempId !== 'string' || !tempId) return null;
  if (!STROKE_TOOLS.includes(tool)) return null;
  if (typeof color !== 'string' || !COLOR_RE.test(color)) return null;
  if (!isFiniteNumber(width)) return null;
  if (!Array.isArray(points) || points.length === 0 || points.length > MAX_POINTS) return null;
  for (const p of points) {
    if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return null;
  }
  return { tempId, tool, color, width, points };
}

module.exports = {
  validateStrokePayload,
  validateFillPayload,
  sanitizeProgressPayload,
};
