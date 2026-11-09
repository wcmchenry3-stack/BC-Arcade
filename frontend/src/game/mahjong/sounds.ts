export const MAHJONG_SOUNDS: Record<string, number> = {
  // select and match, "real tiles", "crisp clack": three variations each, played by
  // useSoundVariants; the match's clack sits on the pair meeting (motion.ts) (#3578)
  "mahjong.tileSelect": require("../../../assets/sounds/mahjong-select-1.ogg"),
  "mahjong.tileSelect2": require("../../../assets/sounds/mahjong-select-2.ogg"),
  "mahjong.tileSelect3": require("../../../assets/sounds/mahjong-select-3.ogg"),
  "mahjong.tileMatch": require("../../../assets/sounds/mahjong-match-1.ogg"),
  "mahjong.tileMatch2": require("../../../assets/sounds/mahjong-match-2.ogg"),
  "mahjong.tileMatch3": require("../../../assets/sounds/mahjong-match-3.ogg"),
  "mahjong.shuffle": require("../../../assets/sounds/mahjong-shuffle.ogg"),
  "mahjong.win": require("../../../assets/sounds/hearts-moon-shot.mp3"),
  // shared file with cascade.gameOver, twenty48.gameOver (#1025)
  "mahjong.deadlock": require("../../../assets/sounds/cascade-game-over.ogg"),
  // Background music tracks
  "mahjong.bg1": require("../../../assets/sounds/mahjong-bg-1.mp3"),
  "mahjong.bg2": require("../../../assets/sounds/mahjong-bg-2.mp3"),
  "mahjong.bg3": require("../../../assets/sounds/mahjong-bg-3.mp3"),
};

/** The tile select variations, in registry order, for `useSoundVariants` (#3578). */
export const MAHJONG_TILE_SELECT = [
  "mahjong.tileSelect",
  "mahjong.tileSelect2",
  "mahjong.tileSelect3",
] as const;

/** The tile match variations, in registry order, for `useSoundVariants` (#3578). */
export const MAHJONG_TILE_MATCH = [
  "mahjong.tileMatch",
  "mahjong.tileMatch2",
  "mahjong.tileMatch3",
] as const;
