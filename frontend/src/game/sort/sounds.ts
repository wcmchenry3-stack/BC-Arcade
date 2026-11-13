// Sort's sounds (#3661): original synthesized "glass and water", from tools/assets/synth_puzzle_sfx.py.
// Design and timings: docs/games/puzzle-sound-design.md. Levels are baked into the files.
export const SORT_SOUNDS: Record<string, number> = {
  // select: a bright glass tick, on the tap that lifts a bottle (three variations)
  "sort.select": require("../../../assets/sounds/sort-select-1.ogg"),
  "sort.select2": require("../../../assets/sounds/sort-select-2.ogg"),
  "sort.select3": require("../../../assets/sounds/sort-select-3.ogg"),
  // pour lift: a faint glass touch and a puff of air, at the tap that starts a pour
  "sort.pourLift": require("../../../assets/sounds/sort-pour-lift-1.ogg"),
  "sort.pourLift2": require("../../../assets/sounds/sort-pour-lift-2.ogg"),
  "sort.pourLift3": require("../../../assets/sounds/sort-pour-lift-3.ogg"),
  // pour stream: one file per unit count (1 to 4), three variations each, played once at the
  // stream's start (flowStartMs) for the pour's unit count
  "sort.pourStream1u": require("../../../assets/sounds/sort-pour-stream-1u-1.ogg"),
  "sort.pourStream1u2": require("../../../assets/sounds/sort-pour-stream-1u-2.ogg"),
  "sort.pourStream1u3": require("../../../assets/sounds/sort-pour-stream-1u-3.ogg"),
  "sort.pourStream2u": require("../../../assets/sounds/sort-pour-stream-2u-1.ogg"),
  "sort.pourStream2u2": require("../../../assets/sounds/sort-pour-stream-2u-2.ogg"),
  "sort.pourStream2u3": require("../../../assets/sounds/sort-pour-stream-2u-3.ogg"),
  "sort.pourStream3u": require("../../../assets/sounds/sort-pour-stream-3u-1.ogg"),
  "sort.pourStream3u2": require("../../../assets/sounds/sort-pour-stream-3u-2.ogg"),
  "sort.pourStream3u3": require("../../../assets/sounds/sort-pour-stream-3u-3.ogg"),
  "sort.pourStream4u": require("../../../assets/sounds/sort-pour-stream-4u-1.ogg"),
  "sort.pourStream4u2": require("../../../assets/sounds/sort-pour-stream-4u-2.ogg"),
  "sort.pourStream4u3": require("../../../assets/sounds/sort-pour-stream-4u-3.ogg"),
  // refused pour: two dull glass taps, on the shake
  "sort.refused": require("../../../assets/sounds/sort-refused.ogg"),
  // bottle complete: a two-note glass chime, as the badge pops
  "sort.complete": require("../../../assets/sounds/sort-complete.ogg"),
  // undo: a reversed clink
  "sort.undo": require("../../../assets/sounds/sort-undo.ogg"),
  // hint: three rising glass pings
  "sort.hint": require("../../../assets/sounds/sort-hint.ogg"),
  // win: a glass chime cascade whose chord lands as the result card opens (WIN_CASCADE_MS)
  "sort.win": require("../../../assets/sounds/sort-win.ogg"),
};

/** The select variations, in registry order, for `useSoundVariants`. */
export const SORT_SELECT = ["sort.select", "sort.select2", "sort.select3"] as const;

/** The pour lift variations, in registry order, for `useSoundVariants`. */
export const SORT_POUR_LIFT = ["sort.pourLift", "sort.pourLift2", "sort.pourLift3"] as const;

/**
 * The pour stream variations for a pour of 1 to 4 units (index = units - 1), in registry order,
 * for `useSoundVariants`.
 */
export const SORT_POUR_STREAM = [
  ["sort.pourStream1u", "sort.pourStream1u2", "sort.pourStream1u3"],
  ["sort.pourStream2u", "sort.pourStream2u2", "sort.pourStream2u3"],
  ["sort.pourStream3u", "sort.pourStream3u2", "sort.pourStream3u3"],
  ["sort.pourStream4u", "sort.pourStream4u2", "sort.pourStream4u3"],
] as const;
