export const TWENTY48_SOUNDS: Record<string, number> = {
  // merge and spawn, "wooden tiles": three variations each, played by useSoundVariants (#3578)
  "twenty48.tileMerge": require("../../../assets/sounds/tile-merge-1.ogg"),
  "twenty48.tileMerge2": require("../../../assets/sounds/tile-merge-2.ogg"),
  "twenty48.tileMerge3": require("../../../assets/sounds/tile-merge-3.ogg"),
  "twenty48.tileSpawn": require("../../../assets/sounds/tile-spawn-1.ogg"),
  "twenty48.tileSpawn2": require("../../../assets/sounds/tile-spawn-2.ogg"),
  "twenty48.tileSpawn3": require("../../../assets/sounds/tile-spawn-3.ogg"),
  "twenty48.win2048": require("../../../assets/sounds/hearts-moon-shot.mp3"),
  "twenty48.gameOver": require("../../../assets/sounds/cascade-game-over.ogg"),
};

/** The tile merge variations, in registry order, for `useSoundVariants` (#3578). */
export const TWENTY48_TILE_MERGE = [
  "twenty48.tileMerge",
  "twenty48.tileMerge2",
  "twenty48.tileMerge3",
] as const;

/** The tile spawn variations, in registry order, for `useSoundVariants` (#3578). */
export const TWENTY48_TILE_SPAWN = [
  "twenty48.tileSpawn",
  "twenty48.tileSpawn2",
  "twenty48.tileSpawn3",
] as const;
