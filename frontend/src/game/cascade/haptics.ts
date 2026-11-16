/**
 * Cascade haptics (#3701, owner pick: B's map plus C's danger warning).
 *
 *   - land: Light (Medium for tier 6 and up); landings closer than `landGapMs` are dropped;
 *   - merge: Medium (tiers 0-3), Heavy (4-6), Heavy twice `doubleGapMs` apart (7-9);
 *   - chain: a rising run on the counter's paced steps (`MOTION.chain.stepMs`): ×2 Light, ×3
 *     Medium, ×4 and on Heavy; a chain link fires its chain pulse instead of a merge pulse;
 *   - danger: one Warning when the lid count passes `dangerAt` (again only after it has cleared);
 *   - win: the result card's Success (`GameResultModal`, as built), so the win has exactly one,
 *     as in Sort (#3660). The winning merge itself fires nothing here.
 *
 * Best effort, as `GameResultModal`'s `fireHaptic`: a haptic that fails (sync or async) never
 * breaks play, and there are none on web. The app has no haptics setting. Pacing: no two pulses
 * closer than `minGapMs` (later ones wait), at most `maxQueued` waiting, and every pulse is fired
 * from a timer, never from inside the frame that found the event. The screen fires nothing while a
 * restored game settles.
 */
import { useEffect, useMemo } from "react";
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { MOTION } from "./motion";

export type CascadeHaptic = "light" | "medium" | "heavy" | "warning";

export function fireCascadeHaptic(kind: CascadeHaptic): void {
  if (Platform.OS === "web") return;
  try {
    const run =
      kind === "warning"
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        : Haptics.impactAsync(
            kind === "light"
              ? Haptics.ImpactFeedbackStyle.Light
              : kind === "medium"
                ? Haptics.ImpactFeedbackStyle.Medium
                : Haptics.ImpactFeedbackStyle.Heavy
          );
    run?.catch(() => undefined);
  } catch {
    // No haptics available (or a partial module): play goes on.
  }
}

/** The landing pulse for a tier. */
export function landHaptic(tier: number): CascadeHaptic {
  return tier >= 6 ? "medium" : "light";
}

/** A plain merge's pulse for the tier it made, and whether it is doubled. */
export function mergeHaptic(tier: number): { kind: CascadeHaptic; double: boolean } {
  if (tier <= 3) return { kind: "medium", double: false };
  if (tier <= 6) return { kind: "heavy", double: false };
  return { kind: "heavy", double: true };
}

/** The chain pulse for link `link` (2, 3, …). */
export function chainHaptic(link: number): CascadeHaptic {
  return link <= 2 ? "light" : link === 3 ? "medium" : "heavy";
}

export interface HapticPacerDeps {
  now(): number;
  schedule(run: () => void, delayMs: number): void;
  fire(kind: CascadeHaptic): void;
}

export interface HapticPacer {
  land(tier: number): void;
  /** A merge that made `tier`; `link` is its place in the drop's chain (1 = a plain merge). */
  merge(tier: number, link: number): void;
  /** The lid count after a step. */
  danger(ratio: number): void;
  /** A new game: forget the chain and the danger latch, cancel what is waiting. */
  reset(): void;
}

export function createHapticPacer(deps: HapticPacerDeps): HapticPacer {
  const H = MOTION.haptics;
  let generation = 0;
  let lastSlot = -Infinity;
  let queued = 0;
  let lastLand = -Infinity;
  let chainStart = 0;
  let dangerLatched = false;

  function request(kind: CascadeHaptic, at: number): void {
    if (queued >= H.maxQueued) return;
    const now = deps.now();
    const when = Math.max(at, now, lastSlot + H.minGapMs);
    lastSlot = when;
    queued++;
    const gen = generation;
    deps.schedule(() => {
      if (gen !== generation) return;
      queued--;
      deps.fire(kind);
    }, when - now);
  }

  return {
    land(tier) {
      const now = deps.now();
      // A landing is never queued: one that would wait, or comes right after another, is dropped.
      if (now - lastLand < H.landGapMs || lastSlot + H.minGapMs > now) return;
      lastLand = now;
      request(landHaptic(tier), now);
    },
    merge(tier, link) {
      const now = deps.now();
      if (link < 2) {
        const { kind, double } = mergeHaptic(tier);
        request(kind, now);
        if (double) request(kind, now + H.doubleGapMs);
        return;
      }
      if (link === 2) chainStart = now;
      request(chainHaptic(link), chainStart + (link - 2) * MOTION.chain.stepMs);
    },
    danger(ratio) {
      if (!(ratio > 0)) {
        dangerLatched = false;
        return;
      }
      if (dangerLatched || ratio < H.dangerAt) return;
      dangerLatched = true;
      request("warning", deps.now());
    },
    reset() {
      generation++;
      queued = 0;
      lastSlot = -Infinity;
      lastLand = -Infinity;
      dangerLatched = false;
    },
  };
}

const REAL_TIME: HapticPacerDeps = {
  now: () => performance.now(),
  schedule: (run, delayMs) => {
    setTimeout(run, delayMs);
  },
  fire: fireCascadeHaptic,
};

/** The screen's pacer: real time, timers and expo-haptics; waiting pulses are dropped on unmount. */
export function useCascadeHaptics(): HapticPacer {
  const pacer = useMemo(() => createHapticPacer(REAL_TIME), []);
  useEffect(() => () => pacer.reset(), [pacer]);
  return pacer;
}
