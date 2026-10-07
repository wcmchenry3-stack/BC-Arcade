export const MAHJONG_SOUNDS: Record<string, number> = {
  "mahjong.tileSelect": require("../../../assets/sounds/mahjong-tile-select.ogg"),
  "mahjong.tileMatch": require("../../../assets/sounds/mahjong-tile-match.ogg"),
  "mahjong.shuffle": require("../../../assets/sounds/mahjong-shuffle.ogg"),
  "mahjong.win": require("../../../assets/sounds/hearts-moon-shot.mp3"),
  // shared file with cascade.gameOver, twenty48.gameOver (#1025)
  "mahjong.deadlock": require("../../../assets/sounds/cascade-game-over.ogg"),
  // Background music tracks
  "mahjong.bg1": require("../../../assets/sounds/mahjong-bg-1.mp3"),
  "mahjong.bg2": require("../../../assets/sounds/mahjong-bg-2.mp3"),
  "mahjong.bg3": require("../../../assets/sounds/mahjong-bg-3.mp3"),
};
