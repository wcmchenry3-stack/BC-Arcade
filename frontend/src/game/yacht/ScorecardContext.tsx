import React, { createContext, useContext, useMemo, useState } from "react";

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

export function useYachtScorecard(): YachtScorecardValue {
  const ctx = useContext(YachtScorecardContext);
  if (!ctx) {
    throw new Error("useYachtScorecard must be used within YachtScorecardProvider");
  }
  return ctx;
}
