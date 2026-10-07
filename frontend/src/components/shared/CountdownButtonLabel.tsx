import React, { useEffect, useRef, useState } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";

export interface CountdownButtonLabelProps {
  /** The wall-clock time (ms since epoch) the countdown ends. */
  untilMs: number;
  /** The label for a time ("12:03:09"). Keep it stable (useCallback). */
  renderLabel: (time: string) => string;
  /**
   * Called once, when the countdown reaches zero (at once when it already
   * has). A new `untilMs` starts a new countdown that calls it once more.
   */
  onReady: () => void;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/** `hh:mm:ss` for a number of milliseconds, never below zero. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * A button's countdown text that owns its one-second tick (#2964), so only
 * this text re-renders as the seconds pass, never the screen behind the card
 * (Daily Word's board and keyboard). The same shape as `PlayClockText`.
 */
function CountdownButtonLabelImpl({
  untilMs,
  renderLabel,
  onReady,
  style,
  testID,
}: CountdownButtonLabelProps) {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, untilMs - Date.now()));
  // The latest onReady, so a new callback identity never restarts the timer.
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    let done = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      const remaining = Math.max(0, untilMs - Date.now());
      setRemainingMs(remaining);
      if (remaining === 0 && !done) {
        done = true;
        if (timer !== undefined) clearInterval(timer);
        onReadyRef.current();
      }
    };
    tick();
    if (!done) timer = setInterval(tick, 1000);
    return () => {
      if (timer !== undefined) clearInterval(timer);
    };
  }, [untilMs]);

  return (
    <Text testID={testID} style={style} accessibilityLiveRegion="none">
      {renderLabel(formatCountdown(remainingMs))}
    </Text>
  );
}

export const CountdownButtonLabel = React.memo(CountdownButtonLabelImpl);
