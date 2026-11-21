/**
 * Cascade's sounds (#3702): one set of 21 files per piece set, synthesized in-house by
 * `tools/assets/synth_cascade_sfx.py` (owner picks: Fruits "Juicy pops", Cosmos "Starlight
 * glass"). The Fruits / Cosmos toggle picks the set. What plays when, and how it is paced:
 * `soundPacer.ts`; the players: `useCascadeSounds.ts`. Design log:
 * docs/games/cascade-sound-design.md.
 */
import type { TierSetId } from "./tiers";
import { CAPSTONE_TIER } from "./tiers";
import { MOTION, clamp01 } from "./motion";

export const CASCADE_SOUND_NAMES = [
  "drop",
  "land-light",
  "land-heavy",
  "merge-t0",
  "merge-t1",
  "merge-t2",
  "merge-t3",
  "merge-t4",
  "merge-t5",
  "merge-t6",
  "merge-t7",
  "merge-t8",
  "merge-t9",
  "merge-t10",
  "merge-t11",
  "chain-1",
  "chain-2",
  "chain-3",
  "chain-4",
  "danger",
  "win",
  "game-over",
] as const;

export type CascadeSoundName = (typeof CASCADE_SOUND_NAMES)[number];

export const CASCADE_SOUNDS: Readonly<
  Record<TierSetId, Readonly<Record<CascadeSoundName, number>>>
> = {
  fruits: {
    drop: require("../../../assets/sounds/cascade-fruits-drop.ogg"),
    "land-light": require("../../../assets/sounds/cascade-fruits-land-light.ogg"),
    "land-heavy": require("../../../assets/sounds/cascade-fruits-land-heavy.ogg"),
    "merge-t0": require("../../../assets/sounds/cascade-fruits-merge-t0.ogg"),
    "merge-t1": require("../../../assets/sounds/cascade-fruits-merge-t1.ogg"),
    "merge-t2": require("../../../assets/sounds/cascade-fruits-merge-t2.ogg"),
    "merge-t3": require("../../../assets/sounds/cascade-fruits-merge-t3.ogg"),
    "merge-t4": require("../../../assets/sounds/cascade-fruits-merge-t4.ogg"),
    "merge-t5": require("../../../assets/sounds/cascade-fruits-merge-t5.ogg"),
    "merge-t6": require("../../../assets/sounds/cascade-fruits-merge-t6.ogg"),
    "merge-t7": require("../../../assets/sounds/cascade-fruits-merge-t7.ogg"),
    "merge-t8": require("../../../assets/sounds/cascade-fruits-merge-t8.ogg"),
    "merge-t9": require("../../../assets/sounds/cascade-fruits-merge-t9.ogg"),
    "merge-t10": require("../../../assets/sounds/cascade-fruits-merge-t10.ogg"),
    // TEMP(#3962): the t10 file again until #3966 synthesises the real merge-t11.
    "merge-t11": require("../../../assets/sounds/cascade-fruits-merge-t10.ogg"),
    "chain-1": require("../../../assets/sounds/cascade-fruits-chain-1.ogg"),
    "chain-2": require("../../../assets/sounds/cascade-fruits-chain-2.ogg"),
    "chain-3": require("../../../assets/sounds/cascade-fruits-chain-3.ogg"),
    "chain-4": require("../../../assets/sounds/cascade-fruits-chain-4.ogg"),
    danger: require("../../../assets/sounds/cascade-fruits-danger.ogg"),
    win: require("../../../assets/sounds/cascade-fruits-win.ogg"),
    "game-over": require("../../../assets/sounds/cascade-fruits-game-over.ogg"),
  },
  cosmos: {
    drop: require("../../../assets/sounds/cascade-cosmos-drop.ogg"),
    "land-light": require("../../../assets/sounds/cascade-cosmos-land-light.ogg"),
    "land-heavy": require("../../../assets/sounds/cascade-cosmos-land-heavy.ogg"),
    "merge-t0": require("../../../assets/sounds/cascade-cosmos-merge-t0.ogg"),
    "merge-t1": require("../../../assets/sounds/cascade-cosmos-merge-t1.ogg"),
    "merge-t2": require("../../../assets/sounds/cascade-cosmos-merge-t2.ogg"),
    "merge-t3": require("../../../assets/sounds/cascade-cosmos-merge-t3.ogg"),
    "merge-t4": require("../../../assets/sounds/cascade-cosmos-merge-t4.ogg"),
    "merge-t5": require("../../../assets/sounds/cascade-cosmos-merge-t5.ogg"),
    "merge-t6": require("../../../assets/sounds/cascade-cosmos-merge-t6.ogg"),
    "merge-t7": require("../../../assets/sounds/cascade-cosmos-merge-t7.ogg"),
    "merge-t8": require("../../../assets/sounds/cascade-cosmos-merge-t8.ogg"),
    "merge-t9": require("../../../assets/sounds/cascade-cosmos-merge-t9.ogg"),
    "merge-t10": require("../../../assets/sounds/cascade-cosmos-merge-t10.ogg"),
    // TEMP(#3962): the t10 file again until #3966 synthesises the real merge-t11.
    "merge-t11": require("../../../assets/sounds/cascade-cosmos-merge-t10.ogg"),
    "chain-1": require("../../../assets/sounds/cascade-cosmos-chain-1.ogg"),
    "chain-2": require("../../../assets/sounds/cascade-cosmos-chain-2.ogg"),
    "chain-3": require("../../../assets/sounds/cascade-cosmos-chain-3.ogg"),
    "chain-4": require("../../../assets/sounds/cascade-cosmos-chain-4.ogg"),
    danger: require("../../../assets/sounds/cascade-cosmos-danger.ogg"),
    win: require("../../../assets/sounds/cascade-cosmos-win.ogg"),
    "game-over": require("../../../assets/sounds/cascade-cosmos-game-over.ogg"),
  },
};

/**
 * The rarer sounds (merges from tier 4 up, chain steps from ×3 up, danger, the win and the game
 * over): their players are created on the first play, or pre-warmed when they become likely
 * (`useCascadeSounds`; docs/PERFORMANCE.md, "SFX players"). The other 8 (drop, the landings,
 * merges t0-t3, the first chain step) are created when the screen mounts, so the sounds of every
 * turn have no creation latency.
 */
export const LAZY_CASCADE_SOUNDS: ReadonlySet<CascadeSoundName> = new Set<CascadeSoundName>([
  "merge-t4",
  "merge-t5",
  "merge-t6",
  "merge-t7",
  "merge-t8",
  "merge-t9",
  "merge-t10",
  "merge-t11",
  "chain-2",
  "chain-3",
  "chain-4",
  "danger",
  "win",
  "game-over",
]);

/** The skin's sound set: Cosmos for the Cosmos pieces, Fruits otherwise. */
export function soundSetFor(setId: string): TierSetId {
  return setId === "cosmos" ? "cosmos" : "fruits";
}

/** A landing of `tier`: the light file below `heavyLandTier`, the heavy one from there; louder with the tier. */
export function landSound(tier: number): { name: CascadeSoundName; volume: number } {
  const S = MOTION.sound;
  const k = clamp01(tier / CAPSTONE_TIER);
  return {
    name: tier >= S.heavyLandTier ? "land-heavy" : "land-light",
    volume: S.landVolume0 + (1 - S.landVolume0) * k,
  };
}

/** The pre-pitched merge file for the tier a merge made (clamped to the ladder). */
export function mergeSound(tier: number): CascadeSoundName {
  const t = Math.min(CAPSTONE_TIER, Math.max(0, Math.round(tier)));
  return `merge-t${t}` as CascadeSoundName;
}

/** The chain step for link `link` (2 → chain-1 … 5 and on → chain-4); null for a plain merge. */
export function chainSound(link: number): CascadeSoundName | null {
  if (link < 2) return null;
  return `chain-${Math.min(4, link - 1)}` as CascadeSoundName;
}

/** The danger tick's volume for a lid count `ratio`: soft as the count starts, full at its end. */
export function dangerVolume(ratio: number): number {
  const v0 = MOTION.sound.dangerVolume0;
  return v0 + (1 - v0) * clamp01(ratio);
}
