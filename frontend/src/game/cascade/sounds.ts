export const CASCADE_SOUNDS: Record<string, number> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "cascade.fruitMerge": require("../../../assets/sounds/cascade-fruit-merge.ogg"),
  // Cascade's own copy of the old Star Swarm wave-clear audio (was shared, #1025; split off in #3526
  // when Star Swarm's sounds were replaced)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "cascade.cascadeCombo": require("../../../assets/sounds/cascade-combo.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "cascade.gameOver": require("../../../assets/sounds/cascade-game-over.ogg"),
};
