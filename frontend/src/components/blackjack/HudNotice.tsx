import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Text, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import type { TFunction } from "i18next";
import { useReduceMotion } from "../shared/useReduceMotion";
import { typography } from "../../theme/typography";

export type HudNoticeKind = "comeback" | "milestone" | "allIn";

/** One run notice, drawn in the HUD strip in place of the table tag (#3797). */
export interface HudNoticeData {
  kind: HudNoticeKind;
  /** The short chip text. */
  text: string;
  /** The full sentence a screen reader announces. */
  label: string;
  /** Hold-and-fade opacity, driven on the UI thread by the screen. */
  opacity: SharedValue<number>;
  background: string;
}

interface PickInput {
  comebackVisible: boolean;
  milestoneChips: number | null;
  allInVisible: boolean;
  opacities: Record<HudNoticeKind, SharedValue<number>>;
  accent: string;
}

/** Which notice the strip shows when several coincide: comeback, then milestone, then all-in. */
export function pickHudNotice(
  input: PickInput,
  t: TFunction,
  colors: { bonus: string; secondary: string }
): HudNoticeData | null {
  const { comebackVisible, milestoneChips, allInVisible, opacities, accent } = input;
  if (comebackVisible) {
    return {
      kind: "comeback",
      text: t("blackjack:hud.comeback"),
      label: t("blackjack:comeback.bannerAccessibilityLabel"),
      opacity: opacities.comeback,
      background: colors.bonus,
    };
  }
  if (milestoneChips !== null) {
    return {
      kind: "milestone",
      text: t("blackjack:hud.milestone", { chips: milestoneChips }),
      label: t("blackjack:milestone.toast", { chips: milestoneChips }),
      opacity: opacities.milestone,
      background: accent,
    };
  }
  if (allInVisible) {
    return {
      kind: "allIn",
      text: t("blackjack:allIn.badge"),
      label: t("blackjack:allIn.badgeAccessibilityLabel"),
      opacity: opacities.allIn,
      background: colors.secondary,
    };
  }
  return null;
}

export default function HudNotice({
  notice,
  textColor,
}: {
  notice: HudNoticeData;
  textColor: string;
}) {
  const style = useAnimatedStyle(() => ({ opacity: notice.opacity.value }));
  // The chip mounts at opacity 0 and iOS ignores live regions, so announce the full sentence
  // once when a notice appears, on every platform (a live region would say it twice).
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(notice.label);
  }, [notice.label]);
  return (
    <Animated.View
      testID="blackjack-hud-notice"
      accessible
      accessibilityLabel={notice.label}
      style={[styles.chip, { backgroundColor: notice.background }, style]}
    >
      <Text style={[styles.star, { color: textColor }]} accessibilityElementsHidden>
        {"★"}
      </Text>
      <Text
        style={[styles.text, { color: textColor, fontFamily: typography.label }]}
        numberOfLines={1}
      >
        {notice.text}
      </Text>
    </Animated.View>
  );
}

interface HoldState {
  milestone: number | null;
  comeback: boolean;
  allIn: boolean;
}
const IDLE: HoldState = { milestone: null, comeback: false, allIn: false };

/**
 * The notices' visible state, each held for its duration. One timer per kind: a notice of a
 * kind that arrives within its hold restarts that hold instead of being cleared by the old
 * timer; unmount and `reset` (New Game) clear them all.
 */
export function useHudNoticeHolds() {
  const [state, setState] = useState<HoldState>(IDLE);
  const timers = useRef<Partial<Record<HudNoticeKind, ReturnType<typeof setTimeout>>>>({});
  const clearTimers = useCallback(() => {
    Object.values(timers.current).forEach((id) => clearTimeout(id));
    timers.current = {};
  }, []);
  const show = useCallback((kind: HudNoticeKind, holdMs: number, chips?: number) => {
    clearTimeout(timers.current[kind]);
    setState((s) => ({ ...s, [kind]: kind === "milestone" ? (chips ?? null) : true }));
    timers.current[kind] = setTimeout(() => {
      setState((s) => ({ ...s, [kind]: kind === "milestone" ? null : false }));
    }, holdMs);
  }, []);
  const reset = useCallback(() => {
    clearTimers();
    setState(IDLE);
  }, [clearTimers]);
  useEffect(() => clearTimers, [clearTimers]);
  return useMemo(() => ({ ...state, show, reset }), [state, show, reset]);
}

/** The goal bar's one-time highlight, mounted when a milestone or comeback chip appears (#3797). */
export function GoalPulse({ kind, color }: { kind?: HudNoticeKind; color: string }) {
  const reduceMotion = useReduceMotion();
  if (reduceMotion || (kind !== "milestone" && kind !== "comeback")) return null;
  return <GoalPulseBar color={color} />;
}

function GoalPulseBar({ color }: { color: string }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.set(withSequence(withTiming(1, { duration: 150 }), withTiming(0, { duration: 550 })));
  }, [pulse]);
  const style = useAnimatedStyle(() => ({
    opacity: pulse.get(),
    transform: [{ scaleY: 1 + pulse.get() }],
  }));
  return (
    <Animated.View
      testID="blackjack-goal-pulse"
      pointerEvents="none"
      style={[styles.pulse, { backgroundColor: color }, style]}
    />
  );
}

const styles = StyleSheet.create({
  pulse: { ...StyleSheet.absoluteFill, borderRadius: 3 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  star: { fontSize: 10, fontWeight: "800" },
  text: { fontSize: 11, fontWeight: "800", letterSpacing: 0.3, flexShrink: 1 },
});
