import React, { createContext, useContext, useMemo, useState } from "react";

// Snapshot of Hearts score state shared between HeartsScreen (which mutates
// it as hands complete) and ScorecardScreen (which renders it). Lives in
// React state at app root so the new stack screen can read the same data
// HeartsScreen is producing without round-tripping arrays-of-arrays through
// route params.
export interface HeartsRoundsSnapshot {
  readonly cumulativeScores: readonly number[];
  /** scoreHistory[round][playerIndex] = applied points that round (post-moon). */
  readonly scoreHistory: readonly (readonly number[])[];
  readonly playerLabels: readonly string[];
}

interface HeartsRoundsValue extends HeartsRoundsSnapshot {
  setSnapshot: (next: HeartsRoundsSnapshot) => void;
}

const DEFAULT_SNAPSHOT: HeartsRoundsSnapshot = {
  cumulativeScores: [0, 0, 0, 0],
  scoreHistory: [],
  playerLabels: ["You", "West", "North", "East"],
};

const HeartsRoundsContext = createContext<HeartsRoundsValue | null>(null);

export function HeartsRoundsProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<HeartsRoundsSnapshot>(DEFAULT_SNAPSHOT);
  const value = useMemo<HeartsRoundsValue>(() => ({ ...snapshot, setSnapshot }), [snapshot]);
  return <HeartsRoundsContext.Provider value={value}>{children}</HeartsRoundsContext.Provider>;
}

export function useHeartsRounds(): HeartsRoundsValue {
  const ctx = useContext(HeartsRoundsContext);
  if (!ctx) {
    throw new Error("useHeartsRounds must be used within HeartsRoundsProvider");
  }
  return ctx;
}
