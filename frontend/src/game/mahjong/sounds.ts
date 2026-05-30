export const MAHJONG_SOUNDS: Record<string, number> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "mahjong.tileSelect": require("../../../assets/sounds/mahjong-tile-select.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "mahjong.tileMatch": require("../../../assets/sounds/mahjong-tile-match.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "mahjong.shuffle": require("../../../assets/sounds/mahjong-shuffle.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "mahjong.win": require("../../../assets/sounds/hearts-moon-shot.mp3"),
  // shared file with cascade.gameOver, twenty48.gameOver (#1025)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "mahjong.deadlock": require("../../../assets/sounds/cascade-game-over.ogg"),
  // Background music tracks
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "mahjong.bg1": require("../../../assets/sounds/mahjong-bg-1.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "mahjong.bg2": require("../../../assets/sounds/mahjong-bg-2.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "mahjong.bg3": require("../../../assets/sounds/mahjong-bg-3.mp3"),
};
