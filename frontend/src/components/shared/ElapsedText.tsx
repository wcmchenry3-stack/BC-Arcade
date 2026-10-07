import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { msToNextSecond } from "../../game/_shared/formatMs";

/**
 * Whether a game's clock is advancing right now (started, not paused), kept
 * outside React state so a pause or the first move does not re-render the game
 * screen: only the `ElapsedText` that reads it does (#2964).
 */
export interface ClockActivity {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => boolean;
  /** Set whether the clock is advancing; listeners run only when it changes. */
  set: (advancing: boolean) => void;
}

export function createClockActivity(): ClockActivity {
  let advancing = false;
  const listeners = new Set<() => void>();
  return {
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getSnapshot: () => advancing,
    set: (next) => {
      if (next === advancing) return;
      advancing = next;
      listeners.forEach((listener) => listener());
    },
  };
}

export interface ElapsedTextProps {
  /**
   * Milliseconds the clock has run, read from the game's own timer (a ref the
   * screen keeps), or null before it starts. Keep it stable (useCallback): a
   * new function restarts the timer.
   */
  getElapsedMs: () => number | null;
  /**
   * Whether the clock is advancing: the timer runs only while it is true, and
   * is cleared (not polled) while it is false, then re-armed when it turns
   * true. Pass `activity` to have the screen's pause and first move reach it
   * without a screen render.
   */
  running: boolean;
  /** The game's clock activity (started and not paused); `running` still applies. */
  activity?: ClockActivity;
  /** A final time to show instead of the live one (a finished game), else null. */
  frozenS?: number | null;
  /** Change it to re-read the clock at once and re-align the tick (a new puzzle). */
  resetKey?: unknown;
  /** How a number of seconds reads on screen. Keep it stable. */
  format: (seconds: number) => string;
  /** The screen-reader label for a time. Keep it stable (useCallback). */
  accessibilityLabel?: (time: string) => string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

const NEVER_ACTIVE: ClockActivity = {
  subscribe: () => () => {},
  getSnapshot: () => true,
  set: () => {},
};

/**
 * A game clock on screen that owns its tick, so only this text re-renders as
 * time passes, never the game screen around it (#2964). The same shape as
 * `PlayClockText`, for a clock that lives in the screen's refs (Sudoku's: it
 * restarts on relaunch and pauses while the app or screen is away) rather
 * than in a `PlayClock`.
 *
 * Each tick is scheduled for the clock's own next whole second, so the shown
 * time never lags and always equals the time the game reports. While the clock
 * is not advancing (not started, paused, finished) no timer runs.
 *
 * Not a live region: a screen reader reads the time when the player focuses it.
 */
function ElapsedTextImpl({
  getElapsedMs,
  running,
  activity = NEVER_ACTIVE,
  frozenS = null,
  resetKey,
  format,
  accessibilityLabel,
  style,
  testID,
}: ElapsedTextProps) {
  const [seconds, setSeconds] = useState(() => Math.floor((getElapsedMs() ?? 0) / 1000));
  const advancing = useSyncExternalStore(activity.subscribe, activity.getSnapshot);
  const live = running && advancing;

  useEffect(() => {
    if (frozenS !== null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Reads the clock now; while it is advancing, arms the next tick for its
    // next second.
    const tick = () => {
      const elapsedMs = getElapsedMs();
      setSeconds(Math.floor((elapsedMs ?? 0) / 1000));
      if (live && elapsedMs !== null) timer = setTimeout(tick, msToNextSecond(elapsedMs));
    };
    tick();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [live, frozenS, getElapsedMs, resetKey]);

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
