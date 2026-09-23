// 房间设置的默认值/范围常量，和后端 backend/src/rooms/validateSettings.js 的规则保持一致
// （见 FULLREADME.md 第4节 / 第11.2节）。改范围时两边都要改。

export const PLAYER_RANGE = {
  guess: { min: 2, max: 32 },
  chain: { min: 4, max: 32 },
};

export const DRAW_SECONDS_PRESETS = [30, 60, 90];
export const DRAW_SECONDS_CUSTOM_RANGE = { min: 10, max: 900 };

export const GUESS_SECONDS_PRESETS = [30, 60];
export const GUESS_SECONDS_CUSTOM_RANGE = { min: 10, max: 300 };

export const ROUNDS_RANGE = { min: 1, max: 10 };
export const ROUNDS_PRESETS = [1, 2, 3, 4, 5];

export const CHAIN_ROUNDS_RANGE = { min: 1, max: 7 };

export const SPECIAL_EFFECTS = [
  { value: 'none', label: '无' },
  { value: 'invisible', label: '隐形', disabled: true },
  { value: 'gravity', label: '重力', disabled: true },
  { value: 'pixelArt', label: '像素艺术', disabled: true },
];

export function defaultSettings(mode) {
  const common = {
    maxPlayers: mode === 'chain' ? 8 : 8,
    specialEffect: 'none',
    brushMode: 'adjustable',
    colorMode: 'rgb',
    drawSeconds: 60,
    rounds: 3,
    wordSource: 'system',
    wordCategory: '',
  };
  if (mode === 'chain') {
    return {
      ...common,
      guessSeconds: 60,
      chainRounds: 3,
      anonymousVoting: false,
      showDrawingProcess: true,
    };
  }
  return common;
}
