/**
 * The chips moving on the Blackjack felt, and the result's pop-in (#3581). Decoration only:
 * hidden from screen readers and never touchable (the bet, the payout and the chip count are
 * in the labels and the HUD).
 *
 * Each chip is one linear Reanimated timing on the UI thread, eased in the worklet; the screen's
 * motion mounts it when it starts and removes it when it ends (a stage of the timeline), so a
 * timing the system cut short never leaves a chip behind.
 */
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Reanimated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import type { Rect } from "../../game/blackjack/layout";
import { FLIGHT_BACKSTOP_MS, type Point } from "../cards/cardMotion";
import { easeSlide, NUDGE_PX, type ChipKind, type ChipShown } from "./blackjackMotion";

/** A moving chip's diameter. */
export const CHIP_SPRITE = 22;

/** Where each kind of chip starts and ends, on the felt. */
export function chipPath(
  kind: ChipKind,
  feltWidth: number,
  feltHeight: number,
  stake: Rect | null
): { from: Point; to: Point } {
  const r = CHIP_SPRITE / 2;
  const at: Point = stake
    ? { x: stake.x + stake.width / 2 - r, y: stake.y + stake.height / 2 - r }
    : { x: feltWidth / 2 - r, y: feltHeight / 2 - r };
  // The tray is under the felt, in the dock; the house is off the felt's top.
  const tray: Point = { x: feltWidth / 2 - r, y: feltHeight + 20 };
  switch (kind) {
    case "bet":
    case "split":
      return { from: tray, to: at };
    case "payout":
      return { from: { x: feltWidth / 2 - r, y: -60 }, to: at };
    case "collect":
      return { from: at, to: { x: feltWidth + 20, y: -50 } };
    case "nudge":
      return { from: at, to: at };
  }
}

interface ChipProps {
  readonly chips: readonly ChipShown[];
  readonly feltWidth: number;
  readonly feltHeight: number;
  /** The stake of each hand (its label), or the betting circle (`bet`). */
  readonly stakeOf: (chip: ChipShown) => Rect | null;
  readonly color: string;
  readonly rim: string;
}

export function FeltChips({ chips, feltWidth, feltHeight, stakeOf, color, rim }: ChipProps) {
  if (chips.length === 0) return null;
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {chips.map((chip) => {
        const { from, to } = chipPath(chip.kind, feltWidth, feltHeight, stakeOf(chip));
        return (
          <ChipSprite
            key={chip.id}
            kind={chip.kind}
            from={from}
            to={to}
            durationMs={chip.durationMs}
            color={color}
            rim={rim}
          />
        );
      })}
    </View>
  );
}

const ChipSprite = React.memo(function ChipSprite({
  kind,
  from,
  to,
  durationMs,
  color,
  rim,
}: {
  readonly kind: ChipKind;
  readonly from: Point;
  readonly to: Point;
  readonly durationMs: number;
  readonly color: string;
  readonly rim: string;
}) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(1, { duration: durationMs, easing: Easing.linear });
    return () => cancelAnimation(p);
    // Once per chip: a chip never changes, the next move is a new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const nudge = kind === "nudge";
  const fades = kind === "collect";
  const style = useAnimatedStyle(() => {
    const t = p.value;
    const e = easeSlide(t);
    return {
      opacity: fades ? 1 - 0.4 * t : 1,
      transform: [
        { translateX: from.x + (to.x - from.x) * e },
        {
          translateY: nudge
            ? from.y + NUDGE_PX * Math.sin(Math.PI * t)
            : from.y + (to.y - from.y) * e,
        },
      ],
    };
  });
  return (
    <Reanimated.View
      testID={`felt-chip-${kind}`}
      style={[styles.chip, { backgroundColor: color, borderColor: rim }, style]}
    />
  );
});

/**
 * Pops its child in (fade, and a scale from `fromScale` to 1) when it first mounts with
 * `animate`; otherwise it is simply there. A JS backstop shows it fully if the timing's end
 * never comes.
 */
export function PopIn({
  testID,
  animate,
  durationMs,
  fromScale,
  style,
  children,
}: {
  readonly testID?: string;
  readonly animate: boolean;
  readonly durationMs: number;
  readonly fromScale: number;
  readonly style?: React.ComponentProps<typeof View>["style"];
  readonly children: React.ReactNode;
}) {
  // Fixed at mount: only a result that appears with the motion pops.
  const [pops] = React.useState(animate);
  const p = useSharedValue(pops ? 0 : 1);
  useEffect(() => {
    if (!pops) return;
    p.value = withTiming(1, { duration: durationMs, easing: Easing.out(Easing.quad) });
    const backstop = setTimeout(() => {
      cancelAnimation(p);
      p.value = 1;
    }, durationMs + FLIGHT_BACKSTOP_MS);
    return () => {
      clearTimeout(backstop);
      cancelAnimation(p);
    };
    // Once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const popStyle = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ scale: fromScale + (1 - fromScale) * p.value }],
  }));
  return (
    <Reanimated.View testID={testID} style={[style, popStyle]}>
      {children}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: "absolute",
    left: 0,
    top: 0,
    width: CHIP_SPRITE,
    height: CHIP_SPRITE,
    borderRadius: CHIP_SPRITE / 2,
    borderWidth: 3,
    borderStyle: "dashed",
  },
});
