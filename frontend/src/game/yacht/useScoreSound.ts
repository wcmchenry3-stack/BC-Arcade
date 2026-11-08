import { useEffect, useRef } from "react";
import type { GameEvent } from "./types";

/** The one sound a score plays, top of the ladder first (#3578). */
export type ScoreSound =
  | "yacht"
  | "joker"
  | "upperBonus"
  | "largeStraight"
  | "fullHouse"
  | "smallStraight"
  | "commit"
  | "zero";

const MILESTONES = [
  ["yacht", ["yacht"]],
  ["joker", ["joker"]],
  ["upperBonus", ["upperBonus"]],
  ["largeStraight", ["largeStraight"]],
  ["fullHouse", ["fullHouse"]],
  ["smallStraight", ["smallStraight"]],
] as const;

/**
 * The sound for one action's events: null unless they hold a score. A score plays exactly one
 * sound: its highest milestone, which replaces the commit, else the commit (or `zero` for a 0).
 */
export function scoreSoundFor(events: readonly GameEvent[] | undefined): ScoreSound | null {
  if (!events) return null;
  const scored = events.find((e) => e.type === "scored");
  if (!scored || scored.type !== "scored") return null;
  const types = new Set(events.map((e) => e.type));
  for (const [sound, triggers] of MILESTONES) {
    if (triggers.some((t) => types.has(t))) return sound;
  }
  return scored.value === 0 ? "zero" : "commit";
}

/**
 * Plays a score's sound once per new events array (identity, like `useGameEvents`). The events
 * the screen mounts with are skipped, so a game restored from a save doesn't replay its last
 * score. `play` maps each sound to a player; a missing entry stays silent.
 */
export function useScoreSound(
  events: readonly GameEvent[] | undefined,
  play: Partial<Record<ScoreSound, () => void>>
): void {
  const lastRef = useRef(events);
  const playRef = useRef(play);
  useEffect(() => {
    playRef.current = play;
  });
  useEffect(() => {
    if (events === lastRef.current) return;
    lastRef.current = events;
    const sound = scoreSoundFor(events);
    if (sound) playRef.current[sound]?.();
  }, [events]);
}
