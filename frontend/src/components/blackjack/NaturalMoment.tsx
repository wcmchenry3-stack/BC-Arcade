/**
 * The natural-blackjack moment on the felt (#3621; owner decisions in #3739, direction B "glint +
 * sweep"). Decoration only: every view here is `pointerEvents="none"` and hidden from screen
 * readers (the banner says "Blackjack! 3:2"), so input is never blocked.
 *
 * When the player's second card lands and makes a natural that wins 3:2, from that landing:
 *   - the two cards lift `NATURAL_LIFT_PX` (up 160 ms ease-out, hold 520 ms, down 240 ms);
 *   - a 2 px gold edge with an 8 px glow fades in over 120 ms, and stays until the next deal;
 *   - a sheen band crosses each card once (380 ms, from +60 ms);
 *   - one diagonal light sweep (18°) crosses the felt (560 ms, from +60 ms, peak opacity ~0.14).
 * The dealer's natural that decided the round gets a static cool-silver edge once it has turned;
 * a push of naturals gets both edges, static (no lift, glint or sweep).
 *
 * The moment runs on the UI thread: one linear timing of the time since it started, each part
 * worked out from it in a worklet. It is timed from `since` (a JS-clock time), never from when a
 * view mounts, so a view mounted mid-moment picks it up where it is, and the first frame drawn
 * is already right (no pop). With `since` null everything is static: Reduce Motion, a tap that
 * landed the moment, a restore, the player away. A JS backstop lands a timing whose end the
 * system cut short.
 */
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Reanimated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { FLIGHT_BACKSTOP_MS } from "../cards/cardMotion";
import {
  NATURAL_EDGE_IN_MS,
  NATURAL_EDGE_PX,
  NATURAL_GLINT_DELAY_MS,
  NATURAL_GLINT_MS,
  NATURAL_GLOW_PX,
  NATURAL_LIFT_DOWN_MS,
  NATURAL_LIFT_HOLD_MS,
  NATURAL_LIFT_PX,
  NATURAL_LIFT_UP_MS,
  NATURAL_MOMENT_MS,
  NATURAL_SWEEP_DEG,
  NATURAL_SWEEP_DELAY_MS,
  NATURAL_SWEEP_MS,
  NATURAL_SWEEP_PEAK,
} from "./blackjackMotion";
import {
  BLACKJACK_NATURAL_GOLD,
  BLACKJACK_NATURAL_SHEEN,
  BLACKJACK_NATURAL_SILVER,
  BLACKJACK_NATURAL_SWEEP,
} from "../../theme/theme.constants";

/** The edge on a natural's two cards: the player's gold, the dealer's silver. */
export type NaturalTone = "gold" | "silver";

/** The JS clock. */
const now = () => Date.now();

/** How far into the moment `t` is (ms), or its end when none is playing. */
export function momentElapsed(since: number | null, t: number): number {
  if (since === null) return NATURAL_MOMENT_MS;
  return Math.min(NATURAL_MOMENT_MS, Math.max(0, t - since));
}

/** 0 → 1 over `durationMs` from `delayMs`. */
function phase(ms: number, delayMs: number, durationMs: number): number {
  "worklet";
  return Math.min(1, Math.max(0, (ms - delayMs) / durationMs));
}

function easeInOutQuad(p: number): number {
  "worklet";
  return p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);
}

/** How high the cards are lifted `ms` into the moment (px, up). */
export function liftAt(ms: number): number {
  "worklet";
  if (ms <= 0 || ms >= NATURAL_MOMENT_MS) return 0;
  if (ms < NATURAL_LIFT_UP_MS) {
    const q = 1 - ms / NATURAL_LIFT_UP_MS;
    return NATURAL_LIFT_PX * (1 - q * q);
  }
  const down = NATURAL_LIFT_UP_MS + NATURAL_LIFT_HOLD_MS;
  if (ms < down) return NATURAL_LIFT_PX;
  return NATURAL_LIFT_PX * (1 - easeInOutQuad(phase(ms, down, NATURAL_LIFT_DOWN_MS)));
}

/** The gold edge's opacity `ms` into the moment. */
export function edgeAt(ms: number): number {
  "worklet";
  return phase(ms, 0, NATURAL_EDGE_IN_MS);
}

/** How far the sheen band has crossed its card (0 → 1), `ms` into the moment. */
export function glintAt(ms: number): number {
  "worklet";
  return easeInOutQuad(phase(ms, NATURAL_GLINT_DELAY_MS, NATURAL_GLINT_MS));
}

/** How far the sweep has crossed the felt (0 → 1), `ms` into the moment. */
export function sweepAt(ms: number): number {
  "worklet";
  return phase(ms, NATURAL_SWEEP_DELAY_MS, NATURAL_SWEEP_MS);
}

/** Runs `e` (ms into the moment) from `from` to the moment's end, on the UI thread. */
function runMoment(e: { value: number }, from: number): () => void {
  if (from >= NATURAL_MOMENT_MS) return () => undefined;
  const left = NATURAL_MOMENT_MS - from;
  e.value = withTiming(NATURAL_MOMENT_MS, { duration: left, easing: Easing.linear });
  const backstop = setTimeout(() => {
    cancelAnimation(e as never);
    e.value = NATURAL_MOMENT_MS;
  }, left + FLIGHT_BACKSTOP_MS);
  return () => {
    clearTimeout(backstop);
    cancelAnimation(e as never);
  };
}

/**
 * The time into the moment, for a view mounted for it (keyed by `since`): it starts where the
 * moment is at mount, so its first frame is right.
 */
function useMomentClock(since: number | null) {
  const [first] = useState(() => momentElapsed(since, now()));
  const e = useSharedValue(first);
  useEffect(() => runMoment(e, first), []); // eslint-disable-line react-hooks/exhaustive-deps
  return e;
}

/**
 * A natural card's lift, for the card's own view (it lives as long as the card, not the moment).
 * At rest and at the moment's start the lift is 0, so a change of `since` never pops; `since`
 * going null (a tap, Reduce Motion, leaving) puts the card down at once.
 */
export function useNaturalLift(since: number | null) {
  const e = useSharedValue(momentElapsed(since, now()));
  useEffect(() => {
    cancelAnimation(e);
    const from = momentElapsed(since, now());
    e.value = from;
    return runMoment(e, from);
    // On a change of moment only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [since]);
  return useAnimatedStyle(() => ({ transform: [{ translateY: -liftAt(e.value) }] }));
}

/**
 * The edge around one of a natural's cards (drawn just outside it), and, on the player's moment,
 * its fade-in and the sheen across the card. Mount it keyed by `since`.
 */
export function NaturalEdge({
  tone,
  since,
  width,
  height,
  testID,
}: {
  readonly tone: NaturalTone;
  readonly since: number | null;
  readonly width: number;
  readonly height: number;
  readonly testID: string;
}) {
  const color = tone === "gold" ? BLACKJACK_NATURAL_GOLD : BLACKJACK_NATURAL_SILVER;
  const gold = tone === "gold";
  const edge = {
    width: width + 2 * NATURAL_EDGE_PX,
    height: height + 2 * NATURAL_EDGE_PX,
    borderColor: color,
    // The glow (RN's boxShadow draws on iOS and Android alike).
    boxShadow: `0 0 ${gold ? NATURAL_GLOW_PX : NATURAL_GLOW_PX / 2}px ${color}`,
  };
  if (since === null || !gold) {
    return (
      <View
        testID={`${testID}-natural-${tone}`}
        pointerEvents="none"
        style={[styles.edge, edge]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    );
  }
  return <MomentEdge since={since} edge={edge} width={width} height={height} testID={testID} />;
}

function MomentEdge({
  since,
  edge,
  width,
  height,
  testID,
}: {
  readonly since: number;
  readonly edge: object;
  readonly width: number;
  readonly height: number;
  readonly testID: string;
}) {
  const e = useMomentClock(since);
  const edgeStyle = useAnimatedStyle(() => ({ opacity: edgeAt(e.value) }));
  const sheenStyle = useAnimatedStyle(() => {
    const g = glintAt(e.value);
    return {
      opacity: g > 0 && g < 1 ? 1 : 0,
      transform: [{ translateX: -width + g * (2 * width + 20) }, { rotate: "20deg" }],
    };
  });
  return (
    <>
      <Reanimated.View
        testID={`${testID}-natural-gold`}
        pointerEvents="none"
        style={[styles.edge, edge, edgeStyle]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <View
        pointerEvents="none"
        style={[styles.clip, { width, height }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Reanimated.View
          testID={`${testID}-natural-sheen`}
          style={[
            styles.sheen,
            { height: height * 1.6, backgroundColor: BLACKJACK_NATURAL_SHEEN },
            sheenStyle,
          ]}
        />
      </View>
    </>
  );
}

/** One band's width and peak opacity: a soft band, brightest at its middle (~0.14). */
const BANDS = [
  { width: 110, left: 0, opacity: 0.06 / NATURAL_SWEEP_PEAK },
  { width: 64, left: 23, opacity: 0.1 / NATURAL_SWEEP_PEAK },
  { width: 22, left: 44, opacity: 1 },
] as const;
const SWEEP_WIDTH = 110;

/** The diagonal light sweep across the felt, on the player's moment. Mount it keyed by `since`. */
export function NaturalSweep({
  since,
  feltWidth,
  feltHeight,
}: {
  readonly since: number;
  readonly feltWidth: number;
  readonly feltHeight: number;
}) {
  const e = useMomentClock(since);
  const style = useAnimatedStyle(() => {
    const s = sweepAt(e.value);
    const x = easeInOutQuad(s);
    return {
      opacity: s > 0 && s < 1 ? NATURAL_SWEEP_PEAK * Math.sin(Math.PI * s) : 0,
      transform: [
        { translateX: -SWEEP_WIDTH - 50 + x * (feltWidth + 2 * SWEEP_WIDTH + 100) },
        { rotate: `${NATURAL_SWEEP_DEG}deg` },
      ],
    };
  });
  const sweep = BLACKJACK_NATURAL_SWEEP;
  return (
    <View
      testID="natural-sweep"
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Reanimated.View
        testID="natural-sweep-band"
        style={[styles.sweep, { top: -feltHeight * 0.25, height: feltHeight * 1.5 }, style]}
      >
        {BANDS.map((b) => (
          <View
            key={b.width}
            style={[
              styles.band,
              { width: b.width, left: b.left, opacity: b.opacity, backgroundColor: sweep },
            ]}
          />
        ))}
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  edge: {
    position: "absolute",
    left: -NATURAL_EDGE_PX,
    top: -NATURAL_EDGE_PX,
    borderWidth: NATURAL_EDGE_PX,
    borderRadius: 8,
  },
  clip: {
    position: "absolute",
    left: 0,
    top: 0,
    overflow: "hidden",
    borderRadius: 6,
  },
  sheen: {
    position: "absolute",
    top: "-30%",
    left: 0,
    width: 16,
  },
  sweep: {
    position: "absolute",
    left: 0,
    width: SWEEP_WIDTH,
  },
  band: {
    position: "absolute",
    top: 0,
    bottom: 0,
  },
});
