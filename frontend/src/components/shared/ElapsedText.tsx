import React, { useEffect, useState } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";

export interface ElapsedTextProps {
  /**
   * Milliseconds the clock has run, read from the game's own timer (a ref the
   * screen keeps), or null before it starts. Keep it stable (useCallback): a
   * new function restarts the timer.
   */
  getElapsedMs: () => number | null;
  /** True while the clock should advance; false stops the timer. */
  running: boolean;
  /** A final time to show instead of the live one (a finished game), else null. */
  frozenS?: number | null;
  /**
   * Change it to re-read the clock at once and re-align the tick: a new
   * puzzle, or a clock that resumed after a pause.
   */
  resetKey?: unknown;
  /** How a number of seconds reads on screen. Keep it stable. */
  format: (seconds: number) => string;
  /** The screen-reader label for a time. Keep it stable (useCallback). */
  accessibilityLabel?: (time: string) => string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/** How often to look for a clock that has not started yet (the first move). */
const WAIT_FOR_START_MS = 250;

/** Milliseconds until `elapsedMs` next crosses a whole second. */
function msToNextSecond(elapsedMs: number): number {
  return 1000 - (((elapsedMs % 1000) + 1000) % 1000);
}

/**
 * A game clock on screen that owns its tick, so only this text re-renders as
 * time passes, never the game screen around it (#2964). The same shape as
 * `PlayClockText`, for a clock that lives in the screen's refs (Sudoku's: it
 * restarts on relaunch and pauses while the app or screen is away) rather
 * than in a `PlayClock`.
 *
 * Each tick is scheduled for the clock's own next whole second, so the shown
 * time never lags and always equals the time the game reports. Before the
 * clock starts it looks for the start a few times a second, then aligns to it.
 *
 * Not a live region: a screen reader reads the time when the player focuses it.
 */
function ElapsedTextImpl({
  getElapsedMs,
  running,
  frozenS = null,
  resetKey,
  format,
  accessibilityLabel,
  style,
  testID,
}: ElapsedTextProps) {
  const [seconds, setSeconds] = useState(() => Math.floor((getElapsedMs() ?? 0) / 1000));

  useEffect(() => {
    if (frozenS !== null || !running) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Reads the clock now, then arms the next tick for its next second.
    const tick = () => {
      const elapsedMs = getElapsedMs();
      if (elapsedMs === null) {
        setSeconds(0);
        timer = setTimeout(tick, WAIT_FOR_START_MS);
        return;
      }
      setSeconds(Math.floor(elapsedMs / 1000));
      timer = setTimeout(tick, msToNextSecond(elapsedMs));
    };
    tick();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [running, frozenS, getElapsedMs, resetKey]);

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
