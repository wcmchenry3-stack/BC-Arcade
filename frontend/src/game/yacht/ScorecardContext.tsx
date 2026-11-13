import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { GameState } from "./types";

// Snapshot of Yacht state shared between GameScreen (writer) and the
// upcoming Yacht ScorecardScreen variant (reader). Mirrors the Hearts
// RoundsContext pattern so the new stack screen can read live scorecard
// data without round-tripping through route params.
export interface YachtScorecardSnapshot {
  /** scores[category] = points scored, or null if the category is unscored. */
  readonly scores: Readonly<Record<string, number | null>>;
  readonly upperSubtotal: number;
  readonly upperBonus: number;
  readonly yachtBonusCount: number;
  readonly totalScore: number;
}

interface YachtScorecardValue extends YachtScorecardSnapshot {
  setSnapshot: (next: YachtScorecardSnapshot) => void;
}

const DEFAULT_SNAPSHOT: YachtScorecardSnapshot = {
  scores: {},
  upperSubtotal: 0,
  upperBonus: 0,
  yachtBonusCount: 0,
  totalScore: 0,
};

const YachtScorecardContext = createContext<YachtScorecardValue | null>(null);

export function YachtScorecardProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<YachtScorecardSnapshot>(DEFAULT_SNAPSHOT);
  const value = useMemo<YachtScorecardValue>(() => ({ ...snapshot, setSnapshot }), [snapshot]);
  return <YachtScorecardContext.Provider value={value}>{children}</YachtScorecardContext.Provider>;
}

/**
 * The writer's side (GameScreen): keeps the snapshot in step with the player's card. Only when the
 * card changes, so a roll or a hold re-renders nothing through the context (#3749).
 */
export function useSyncYachtScorecard(state: GameState): void {
  const { setSnapshot } = useYachtScorecard();
  const { scores, upper_subtotal, upper_bonus, yacht_bonus_count, total_score } = state;
  useEffect(() => {
    setSnapshot({
      scores,
      upperSubtotal: upper_subtotal,
      upperBonus: upper_bonus,
      yachtBonusCount: yacht_bonus_count,
      totalScore: total_score,
    });
  }, [scores, upper_subtotal, upper_bonus, yacht_bonus_count, total_score, setSnapshot]);
}

export function useYachtScorecard(): YachtScorecardValue {
  const ctx = useContext(YachtScorecardContext);
  if (!ctx) {
    throw new Error("useYachtScorecard must be used within YachtScorecardProvider");
  }
  return ctx;
}
