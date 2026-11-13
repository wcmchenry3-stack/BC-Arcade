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
  // pour glug: one 0.38 s bottle glug per unit, at each unit's slot start (pourTimeline)
  "sort.pourGlug": require("../../../assets/sounds/sort-pour-glug-1.ogg"),
  "sort.pourGlug2": require("../../../assets/sounds/sort-pour-glug-2.ogg"),
  "sort.pourGlug3": require("../../../assets/sounds/sort-pour-glug-3.ogg"),
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

/** The glug variations, in registry order, for `useSoundVariants`. */
export const SORT_POUR_GLUG = ["sort.pourGlug", "sort.pourGlug2", "sort.pourGlug3"] as const;
