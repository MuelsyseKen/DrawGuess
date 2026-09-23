// 房间设置校验（见 FULLREADME.md 第4节 / 第11.2节）。
// 原则：超出范围直接拒绝（INVALID_SETTINGS），不做静默 clamp，避免前后端对"实际生效值"理解不一致。
'use strict';

const { categoryExists } = require('../wordbanks');

const MODE_PLAYER_RANGE = {
  guess: { min: 2, max: 32 },
  chain: { min: 4, max: 32 },
};

const SPECIAL_EFFECTS = ['none', 'invisible', 'gravity', 'pixelArt'];
const BRUSH_MODES = ['fixed', 'adjustable'];
const COLOR_MODES = ['rgb', 'mono'];
const WORD_SOURCES = ['custom', 'system'];

function isInt(v) {
  return typeof v === 'number' && Number.isInteger(v);
}

function fail(message) {
  const err = new Error(message);
  err.code = 'INVALID_SETTINGS';
  return err;
}

// 校验通用字段，返回规整后的通用部分（不含 mode 专属字段）
function validateCommon(mode, settings) {
  const range = MODE_PLAYER_RANGE[mode];
  if (!isInt(settings.maxPlayers) || settings.maxPlayers < range.min || settings.maxPlayers > range.max) {
    throw fail(`maxPlayers 必须是 ${range.min}~${range.max} 之间的整数`);
  }

  if (!SPECIAL_EFFECTS.includes(settings.specialEffect)) {
    throw fail('specialEffect 取值不合法');
  }
  // 一期除了 "none" 之外的特殊效果只做 UI 占位，后端不接受真正启用（避免出现"设置了但没实现"的假象）。
  if (settings.specialEffect !== 'none') {
    throw fail('该特殊效果本期仅作 UI 占位，暂不可启用');
  }

  if (!BRUSH_MODES.includes(settings.brushMode)) {
    throw fail('brushMode 取值不合法');
  }
  if (!COLOR_MODES.includes(settings.colorMode)) {
    throw fail('colorMode 取值不合法');
  }

  const ALLOWED_DRAW_SECONDS_PRESETS = [30, 60, 90];
  if (
    !isInt(settings.drawSeconds) ||
    !(ALLOWED_DRAW_SECONDS_PRESETS.includes(settings.drawSeconds) || (settings.drawSeconds >= 10 && settings.drawSeconds <= 900))
  ) {
    throw fail('drawSeconds 必须是 30/60/90 或 10~900 之间的整数');
  }

  if (!isInt(settings.rounds) || settings.rounds < 1 || settings.rounds > 10) {
    throw fail('rounds 必须是 1~10 之间的整数');
  }

  if (!WORD_SOURCES.includes(settings.wordSource)) {
    throw fail('wordSource 取值不合法');
  }
  if (settings.wordSource === 'system') {
    if (!categoryExists(settings.wordCategory)) {
      throw fail('wordCategory 不存在，请重新选择词库分类');
    }
  }

  return {
    maxPlayers: settings.maxPlayers,
    specialEffect: settings.specialEffect,
    pixelGranularity: null, // 一期恒为 null，特殊效果未真正启用
    brushMode: settings.brushMode,
    colorMode: settings.colorMode,
    drawSeconds: settings.drawSeconds,
    rounds: settings.rounds,
    wordSource: settings.wordSource,
    wordCategory: settings.wordSource === 'system' ? settings.wordCategory : null,
  };
}

function validateChainExtra(settings) {
  const ALLOWED_GUESS_SECONDS_PRESETS = [30, 60];
  if (
    !isInt(settings.guessSeconds) ||
    !(ALLOWED_GUESS_SECONDS_PRESETS.includes(settings.guessSeconds) || (settings.guessSeconds >= 10 && settings.guessSeconds <= 300))
  ) {
    throw fail('guessSeconds 必须是 30/60 或 10~300 之间的整数');
  }

  if (!isInt(settings.chainRounds) || settings.chainRounds < 1 || settings.chainRounds > 7) {
    throw fail('chainRounds 必须是 1~7 之间的整数');
  }

  if (typeof settings.anonymousVoting !== 'boolean') {
    throw fail('anonymousVoting 必须是布尔值');
  }
  if (typeof settings.showDrawingProcess !== 'boolean') {
    throw fail('showDrawingProcess 必须是布尔值');
  }

  return {
    guessSeconds: settings.guessSeconds,
    chainRounds: settings.chainRounds,
    anonymousVoting: settings.anonymousVoting,
    showDrawingProcess: settings.showDrawingProcess,
  };
}

// 入口：按 mode 校验并返回"规整后的完整 settings 对象"（多余字段会被丢弃）
function validateSettings(mode, rawSettings) {
  if (!rawSettings || typeof rawSettings !== 'object') {
    throw fail('settings 不能为空');
  }
  const common = validateCommon(mode, rawSettings);
  if (mode === 'chain') {
    return { ...common, ...validateChainExtra(rawSettings) };
  }
  return common;
}

function validateMode(mode) {
  if (mode !== 'guess' && mode !== 'chain') {
    throw fail('mode 必须是 guess 或 chain');
  }
}

module.exports = { validateSettings, validateMode, MODE_PLAYER_RANGE };
