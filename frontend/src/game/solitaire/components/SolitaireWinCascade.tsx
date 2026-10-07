import React, { useCallback, useEffect, useRef } from "react";
import { useTheme } from "../../../theme/ThemeContext";
import { ConfettiFall, type ConfettiFallTiming } from "../../../components/shared/ConfettiFall";
import { useReduceMotion } from "../../../components/shared/useReduceMotion";
import { playTimedPhases, type PhaseTimeline } from "../../../components/shared/timedPhases";

/** How long the cascade plays before handing over to the result card. */
export const WIN_CASCADE_MS = 2000;

const CASCADE_TIMELINE: PhaseTimeline = { phases: [], endAt: WIN_CASCADE_MS };
const FALL: ConfettiFallTiming = {
  fromY: -80,
  toY: 520,
  staggerMs: 110,
  holdMs: 700,
  fadeOutMs: 500,
};
const CARD = { width: 22, height: 32, borderRadius: 3 } as const;

interface Props {
  /** Called once the cascade has played — or at once when motion is reduced. */
  readonly onDone: () => void;
}

/**
 * The win celebration (#2509): six cards fall across the board. Rendered in
 * the shared result card's `celebration` slot, so it plays on mount and
 * calls `onDone` to reveal the card.
 */
export function SolitaireWinCascade({ onDone }: Props) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();

  // The setting is live, so it can flip after the cascade started (or after
  // it already skipped); hand over to the card only once.
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      finish();
      return;
    }
    return playTimedPhases(CASCADE_TIMELINE, finish);
  }, [reduceMotion, finish]);

  if (reduceMotion) return null;

  return (
    <ConfettiFall
      testID="solitaire-win-cascade"
      colors={[
        colors.error,
        colors.accent,
        colors.outcomeWin,
        colors.celebration,
        colors.outcomeDraw,
        colors.accentBright,
      ]}
      pieceStyle={CARD}
      timing={FALL}
    />
  );
}
