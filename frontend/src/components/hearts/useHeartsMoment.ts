import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import {
  cancelAnimation,
  Easing,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useReduceMotion } from "../shared/useReduceMotion";
import { playTimedPhases } from "../shared/timedPhases";

interface MomentOptions {
  visible: boolean;
  /** When the full-motion moment is over (ms). */
  end: number;
  /** When the Reduce Motion version (a static caption) is over (ms). */
  reducedEnd: number;
  /**
   * When each later part of the moment appears (ms, ascending). Stage 0 is the start; stage
   * `i + 1` is reached at `stages[i]`.
   */
  stages: readonly number[];
  /** The stage whose start reveals the caption; the caption is announced (iOS) then. */
  captionStage: number;
  /** The caption, announced once per showing. */
  announcement: string;
  onAnimationEnd: () => void;
}

export interface MomentState {
  /** The moment's clock (ms since it started), animated on the UI thread. */
  clock: SharedValue<number>;
  /** The last stage reached, or -1 while hidden. */
  stage: number;
  /**
   * The caption is showing: from its stage (or at once with Reduce Motion) until the moment
   * hides. Toggling Reduce Motion mid-moment keeps it, so it is neither remounted nor
   * announced again.
   */
  captionShown: boolean;
  reduceMotion: boolean;
}

/**
 * Runs one Hearts moment (#3588): a linear clock from 0 to `end` on the UI thread, a handful
 * of stage changes (when parts of the moment mount) from `playTimedPhases`, and
 * `onAnimationEnd` at `end`. With Reduce Motion there is no clock: the caption shows at once
 * and `onAnimationEnd` fires at `reducedEnd`. Hiding the moment, unmounting it or changing the
 * Reduce Motion setting cancels the run, so `onAnimationEnd` never fires for a cut-short one.
 *
 * The caption is announced once: Android and web read the caption's polite live region; iOS
 * ignores live regions, so it is announced explicitly when the caption appears.
 */
export function useHeartsMoment({
  visible,
  end,
  reducedEnd,
  stages,
  captionStage,
  announcement,
  onAnimationEnd,
}: MomentOptions): MomentState {
  const reduceMotion = useReduceMotion();
  const clock = useSharedValue(0);
  const [stage, setStage] = useState(0);
  const [captionReached, setCaptionReached] = useState(false);
  const announcementRef = useRef(announcement);
  const onEndRef = useRef(onAnimationEnd);
  // Announced once per showing, even if Reduce Motion changes mid-moment.
  const announcedRef = useRef(false);

  // The latest caption and callback, for the timers below (declared first, so they run first).
  useEffect(() => {
    announcementRef.current = announcement;
    onEndRef.current = onAnimationEnd;
  });
  // A showing's caption state lasts until it hides.
  useEffect(() => {
    if (!visible) return;
    return () => {
      announcedRef.current = false;
      setCaptionReached(false);
    };
  }, [visible]);

  useEffect(() => {
    cancelAnimation(clock);
    clock.value = 0;
    if (!visible) return;
    const announce = () => {
      if (announcedRef.current) return;
      announcedRef.current = true;
      setCaptionReached(true);
      if (Platform.OS === "ios")
        AccessibilityInfo.announceForAccessibility(announcementRef.current);
    };
    const finish = () => onEndRef.current();

    if (reduceMotion) {
      announce();
      return playTimedPhases({ phases: [], endAt: reducedEnd }, finish);
    }

    clock.value = withTiming(end, { duration: end, easing: Easing.linear });
    const cancel = playTimedPhases(
      {
        phases: stages.map((at, i) => ({
          at,
          run: () => {
            setStage(i + 1);
            if (i + 1 === captionStage) announce();
          },
        })),
        endAt: end,
      },
      finish
    );
    if (captionStage === 0) announce();
    return () => {
      cancel();
      cancelAnimation(clock);
      setStage(0);
    };
    // The timeline is fixed per moment; only showing it and the setting restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduceMotion]);

  return {
    clock,
    stage: visible ? stage : -1,
    reduceMotion,
    captionShown: visible && (captionReached || reduceMotion),
  };
}
