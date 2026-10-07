import React, { useEffect, useState } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { formatMs, msToNextSecond } from "../../game/_shared/formatMs";
import type { PlayClock } from "../../game/_shared/playClock";

export interface PlayClockTextProps {
  /** The game's play clock (`PlayClock.startedAt`): null while not running. */
  startedAt: PlayClock["startedAt"];
  /** The play banked before the running segment (`PlayClock.accumulatedMs`). */
  accumulatedMs: PlayClock["accumulatedMs"];
  /** Shown before the time, e.g. "TIME". */
  label?: string;
  /**
   * The screen-reader label for a time ("3:07"). Keep it stable (useCallback):
   * a new function re-renders the clock.
   */
  accessibilityLabel?: (time: string) => string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * A game's play clock on screen, as `m:ss` (`h:mm:ss` from an hour), #2747.
 *
 * It reads the same `PlayClock` the game reports as `durationMs`, so it shows
 * exactly the time that ranks: frozen while the clock is paused (another
 * screen covers the game, the app is in the background, Mahjong's Level
 * Select), stopped at a win or a deadlock, and carried across a relaunch.
 *
 * It owns its one-second tick: only this text re-renders as the clock runs,
 * never the game screen around it (Mahjong's Skia board). The tick is aligned
 * to the clock's own seconds, so the shown time never lags a whole second.
 *
 * Not a live region: a screen reader reads the time when the player focuses
 * it, never once a second.
 */
function PlayClockTextImpl({
  startedAt,
  accumulatedMs,
  label,
  accessibilityLabel,
  style,
  testID,
}: PlayClockTextProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const elapsed = accumulatedMs + (Date.now() - startedAt);
      timer = setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, msToNextSecond(elapsed));
    };
    // Catch up at once: `now` may predate this running segment.
    setNow(Date.now());
    schedule();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [startedAt, accumulatedMs]);

  const elapsedMs =
    startedAt === null ? accumulatedMs : accumulatedMs + Math.max(0, now - startedAt);
  const time = formatMs(elapsedMs);
  return (
    <Text
      testID={testID}
      style={[{ fontVariant: ["tabular-nums"] }, style]}
      accessibilityLabel={accessibilityLabel ? accessibilityLabel(time) : undefined}
      accessibilityLiveRegion="none"
    >
      {label ? `${label} ${time}` : time}
    </Text>
  );
}

export const PlayClockText = React.memo(PlayClockTextImpl);
