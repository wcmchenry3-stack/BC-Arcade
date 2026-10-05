import React, { useEffect, useState } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";

export interface ElapsedTextProps {
  /**
   * Whole seconds the clock has run, read from the game's own timer (a ref the
   * screen keeps), or null before it starts. Keep it stable (useCallback): a
   * new function restarts the interval.
   */
  getElapsedS: () => number | null;
  /** True while the clock should advance; false stops the interval. */
  running: boolean;
  /** A final time to show instead of the live one (a finished game), else null. */
  frozenS?: number | null;
  /** Change it to show the clock's current time at once (a new puzzle). */
  resetKey?: unknown;
  /** How a number of seconds reads on screen. Keep it stable. */
  format: (seconds: number) => string;
  /** The screen-reader label for a time. Keep it stable (useCallback). */
  accessibilityLabel?: (time: string) => string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * A game clock on screen that owns its one-second tick, so only this text
 * re-renders as time passes, never the game screen around it (#2964). The same
 * shape as `PlayClockText`, for a clock that lives in the screen's refs
 * (Sudoku's: it restarts on relaunch and pauses while the app or screen is
 * away) rather than in a `PlayClock`.
 *
 * Not a live region: a screen reader reads the time when the player focuses it.
 */
function ElapsedTextImpl({
  getElapsedS,
  running,
  frozenS = null,
  resetKey,
  format,
  accessibilityLabel,
  style,
  testID,
}: ElapsedTextProps) {
  const [seconds, setSeconds] = useState(() => frozenS ?? getElapsedS() ?? 0);

  useEffect(() => {
    if (frozenS !== null || !running) return;
    const read = () => setSeconds(getElapsedS() ?? 0);
    // Catch up at once: a new puzzle or a resumed clock shows its time now.
    read();
    const timer = setInterval(read, 1000);
    return () => clearInterval(timer);
  }, [running, frozenS, getElapsedS, resetKey]);

  const time = format(frozenS ?? seconds);
  return (
    <Text
      testID={testID}
      style={style}
      accessibilityLabel={accessibilityLabel ? accessibilityLabel(time) : time}
      accessibilityLiveRegion="none"
    >
      {time}
    </Text>
  );
}

export const ElapsedText = React.memo(ElapsedTextImpl);
