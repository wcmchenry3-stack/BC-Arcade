import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Reanimated, {
  cancelAnimation,
  Easing as ReEasing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import PlayingCard from "./PlayingCard";
import { EASE_OUT, QUEEN_TIMING, seg } from "./momentTimeline";
import {
  FLIGHT_EASING,
  FLIGHT_MS,
  SOUND_LEAD_MS,
  SWEEP_BACKSTOP_MS,
  SWEEP_EASING,
  SWEEP_MS,
  sweepOpacity,
  TRICK_HOLD_MS,
} from "./trickMotion";
import { useReduceMotion } from "../shared/useReduceMotion";
import { isQueenOfSpades } from "../../game/hearts/engine";
import { computeHeartsGeometry, type TrickGeometry } from "../../game/hearts/layout";
import type { Card, TrickCard } from "../../game/hearts/types";

interface Props {
  trick: TrickCard[];
  playerIndex: number;
  playerLabels?: string[];
  winnerIndex?: number | null;
  /**
   * The sweep has ended (with Reduce Motion: the trick has cleared). Called exactly once per
   * completed trick: the screen's AI loop waits on it with no timeout.
   */
  onAnimationComplete?: () => void;
  /** Card size, spots and sweep on the card table (#3587); a phone-sized table when omitted. */
  geometry?: TrickGeometry;
  /**
   * While true a completed trick stays on the table instead of sweeping; the sweep starts
   * when it turns false. The Queen of Spades moment holds it (#3588).
   */
  holdSweep?: boolean;
  /** The Queen of Spades moment (#3588): the trick's other cards nudge outward once. */
  nudge?: boolean;
  /**
   * A newly played card's card-place cue (#3574): `SOUND_LEAD_MS` before its flight's contact,
   * or as it appears with Reduce Motion. Never for the cards already on the table at mount.
   */
  onCardPlace?: (card: Card) => void;
  /** A newly played card has landed in its slot (the Queen of Spades moment starts here). */
  onCardLanded?: (card: Card) => void;
  /** A completed trick's sweep starts (with Reduce Motion: it clears): the trick-gathered cue. */
  onSweepStart?: () => void;
}

/** How far the other trick cards nudge outward for the Queen of Spades, at the mockup's 66 dp. */
const NUDGE_DISTANCE = 8;
const MOCK_CARD_W = 66;
/** Outward, from the trick's centre, for each slot. */
const OUTWARD = {
  bottom: [0, 1],
  left: [-1, 0],
  top: [0, -1],
  right: [1, 0],
} as const;

const DEFAULT_GEOMETRY = computeHeartsGeometry({ width: 390, height: 708 }).trick;

const POSITIONS = ["bottom", "left", "top", "right"] as const;
type Position = (typeof POSITIONS)[number];

const cardKey = (card: Card) => `${card.suit}-${card.rank}`;

// The motion (#3574, "A. Brisk"; the values are in ./trickMotion):
// - A newly played card flies from its seat to its slot in FLIGHT_MS (out-cubic); card place
//   is cued SOUND_LEAD_MS before the contact.
// - Once a completed trick's last card has landed it rests TRICK_HOLD_MS, then the four cards
//   sweep together to the winner's plate in SWEEP_MS (in-quad), fading from SWEEP_FADE_FROM.
//   The trick-gathered cue is at the sweep's start; completion comes from the sweep's own end
//   (runOnJS), with a JS backstop (SWEEP_BACKSTOP_MS) so it is never lost.
// - Reduce Motion: no flight and no sweep; after the hold the trick clears at once, with its cue.
// Everything moves on the UI thread: JS sees two timers per card and one per trick, no frames.

export default function TrickArea({
  trick,
  playerIndex,
  playerLabels,
  winnerIndex,
  onAnimationComplete,
  geometry = DEFAULT_GEOMETRY,
  holdSweep = false,
  nudge = false,
  onCardPlace,
  onCardLanded,
  onSweepStart,
}: Props) {
  const { t } = useTranslation("hearts");
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();

  // Read when a timer fires, never during render, so a callback is never a render behind.
  const handlers = useLatest({ onAnimationComplete, onCardPlace, onCardLanded, onSweepStart });

  // Map seat index (0-3) to compass position relative to human player
  function positionForSeat(seat: number): Position {
    const offset = (seat - playerIndex + 4) % 4;
    return POSITIONS[offset] ?? "bottom";
  }

  const keys = trick.map((tc) => cardKey(tc.card));
  // Called before the sweep, so a trick's last card is in flight when the sweep's effect looks.
  const { arrivingKey, flightEndsAtRef } = useArrivingCard(keys, reduceMotion);

  const hasWinner = winnerIndex !== null && winnerIndex !== undefined;
  const completeKey = hasWinner && trick.length === 4 ? keys.join("|") : null;
  // A won trick slides to the winner's plate: each card on its own vector, so the four converge.
  const winnerPosition = completeKey !== null ? positionForSeat(winnerIndex as number) : null;
  const sweep = useTrickSweep(completeKey, holdSweep, reduceMotion, flightEndsAtRef, handlers);

  const slots: Partial<Record<Position, TrickCard>> = {};
  for (const tc of trick) {
    slots[positionForSeat(tc.playerIndex)] = tc;
  }

  /** Where a card flies in from, relative to its slot: its seat's plate (you: below the table). */
  function flightFrom(pos: Position) {
    const spot = geometry.slots[pos];
    const plate = geometry.plateCentres[pos];
    const below = pos === "bottom" ? geometry.cardH : 0;
    return {
      x: plate.x - (spot.x + geometry.cardW / 2),
      y: plate.y + below - (spot.y + geometry.cardH / 2),
    };
  }

  function renderSlot(pos: Position, seatIndex: number) {
    const tc = slots[pos];
    const label = playerLabels?.[seatIndex] ?? String(seatIndex);
    const isWinner = hasWinner && winnerIndex === seatIndex;
    const spot = geometry.slots[pos];

    let sweepTo = { x: 0, y: 0 };
    if (winnerPosition) {
      const target = geometry.plateCentres[winnerPosition];
      sweepTo = {
        x: target.x - (spot.x + geometry.cardW / 2),
        y: target.y - (spot.y + geometry.cardH / 2),
      };
    }
    const from = flightFrom(pos);

    return (
      <SweepSlot
        key={pos}
        sweep={sweep}
        dx={sweepTo.x}
        dy={sweepTo.y}
        style={[
          styles.slot,
          { left: spot.x, top: spot.y, width: geometry.cardW, height: geometry.cardH },
        ]}
        accessibilityLabel={
          tc
            ? isWinner
              ? t("trick.winner", { label })
              : undefined
            : t("trick.slot.empty", { label })
        }
      >
        {tc && (
          <NudgeOutward
            active={nudge && !reduceMotion && !isQueenOfSpades(tc.card)}
            dx={OUTWARD[pos][0] * NUDGE_DISTANCE * (geometry.cardW / MOCK_CARD_W)}
            dy={OUTWARD[pos][1] * NUDGE_DISTANCE * (geometry.cardW / MOCK_CARD_W)}
          >
            <FlyIn
              key={cardKey(tc.card)}
              arriving={cardKey(tc.card) === arrivingKey}
              reduceMotion={reduceMotion}
              dx={from.x}
              dy={from.y}
              onPlace={() => handlers.current.onCardPlace?.(tc.card)}
              onLanded={() => handlers.current.onCardLanded?.(tc.card)}
            >
              <PlayingCard
                card={tc.card}
                highlighted={isWinner}
                width={geometry.cardW}
                height={geometry.cardH}
                rotation={spot.rotation}
              />
            </FlyIn>
          </NudgeOutward>
        )}
      </SweepSlot>
    );
  }

  return (
    <View
      style={[styles.area, { width: geometry.area.w, height: geometry.area.h }]}
      accessibilityLabel={t("trick.area")}
      accessibilityRole="none"
    >
      <Text style={[styles.srOnly, { color: colors.text }]}>{t("trick.area")}</Text>
      {([0, 1, 2, 3] as const).map((offset) => {
        const seat = (playerIndex + offset) % 4;
        const pos = POSITIONS[offset] ?? "bottom";
        return renderSlot(pos, seat);
      })}
    </View>
  );
}

interface Handlers {
  onAnimationComplete?: () => void;
  onCardPlace?: (card: Card) => void;
  onCardLanded?: (card: Card) => void;
  onSweepStart?: () => void;
}

/** The latest `value`, for callbacks that run later (timers, the UI thread's end callback). */
function useLatest<T>(value: T): React.RefObject<T> {
  const ref = useRef(value);
  // A layout effect, so it is current before any child's mount effect calls back.
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * The "seen" guard: only a card added to the trick since the last render is played in (it
 * flies and cues its sound). At mount every card is already seen, so a restored or remounted
 * trick never flies again; several new cards at once (a jump in state, not a play) are shown
 * in place too. Also returns when the last card now in flight lands (a Date.now() time).
 */
function useArrivingCard(keys: readonly string[], reduceMotion: boolean) {
  const joined = keys.join("|");
  const [played, setPlayed] = useState<{
    joined: string;
    seen: ReadonlySet<string>;
    arriving?: string;
  }>(() => ({ joined, seen: new Set(keys) }));
  let current = played;
  if (played.joined !== joined) {
    // React's pattern for state derived from the previous render: render again at once.
    const fresh = keys.filter((k) => !played.seen.has(k));
    current = { joined, seen: new Set(keys), arriving: fresh.length === 1 ? fresh[0] : undefined };
    setPlayed(current);
  }
  const flightEndsAtRef = useRef(0);
  useEffect(() => {
    if (played.arriving !== undefined && !reduceMotion) {
      flightEndsAtRef.current = Date.now() + FLIGHT_MS;
    }
    // Only when a card arrives; Reduce Motion is read as it is then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [played]);
  return { arrivingKey: current.arriving, flightEndsAtRef };
}

/**
 * The completed trick's sweep, on the UI thread: after the last card's flight and the hold,
 * the trick-gathered cue, then all four cards to the winner. `onAnimationComplete` is reported
 * exactly once per trick (`completeKey`): from the sweep's end, or its backstop; with Reduce
 * Motion, at the cue. A hold (`holdSweep`) before the sweep starts stops it, and its release
 * starts the hold again; once the sweep has started (and cued), it runs to its end.
 */
function useTrickSweep(
  completeKey: string | null,
  holdSweep: boolean,
  reduceMotion: boolean,
  flightEndsAtRef: React.RefObject<number>,
  handlers: React.RefObject<Handlers>
): SharedValue<number> {
  const sweep = useSharedValue(0);
  // The completed trick whose sweep has started (its cue played), and whose completion has
  // been reported: each happens once per trick.
  const cuedKeyRef = useRef<string | null>(null);
  const doneKeyRef = useRef<string | null>(null);
  // One trick's life on the table: ends when the trick changes or the trick area unmounts,
  // and only then is a sweep under way cancelled.
  const lifeRef = useRef<{ alive: boolean; backstop?: ReturnType<typeof setTimeout> }>({
    alive: true,
  });
  useEffect(() => {
    const life: { alive: boolean; backstop?: ReturnType<typeof setTimeout> } = { alive: true };
    lifeRef.current = life;
    cancelAnimation(sweep);
    sweep.value = 0;
    if (completeKey === null) {
      // Between tricks: a later trick of the same four cards is a new trick.
      cuedKeyRef.current = null;
      doneKeyRef.current = null;
    }
    return () => {
      life.alive = false;
      clearTimeout(life.backstop);
      cancelAnimation(sweep);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completeKey]);

  useEffect(() => {
    if (completeKey === null || holdSweep) return;
    if (cuedKeyRef.current === completeKey) return; // under way or done: not again
    const life = lifeRef.current;
    const finish = () => {
      if (!life.alive || doneKeyRef.current === completeKey) return;
      doneKeyRef.current = completeKey;
      handlers.current.onAnimationComplete?.();
    };
    const startIn = Math.max(0, flightEndsAtRef.current - Date.now()) + TRICK_HOLD_MS;
    const timer = setTimeout(() => {
      cuedKeyRef.current = completeKey;
      handlers.current.onSweepStart?.();
      if (reduceMotion) {
        sweep.value = 1;
        finish();
        return;
      }
      life.backstop = setTimeout(finish, SWEEP_BACKSTOP_MS);
      sweep.value = withTiming(1, { duration: SWEEP_MS, easing: SWEEP_EASING }, (finished) => {
        "worklet";
        if (finished) runOnJS(finish)();
      });
    }, startIn);
    // Only the wait before the sweep: a sweep that has started is the trick's life's to end.
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completeKey, holdSweep, reduceMotion]);
  return sweep;
}

interface SweepSlotProps {
  sweep: SharedValue<number>;
  /** Where the slot's card is at the sweep's end (the winner's plate), from its slot. */
  dx: number;
  dy: number;
  style: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  children: React.ReactNode;
}

/** One trick slot: in the sweep it slides with the other three and fades over its last 40%. */
function SweepSlot({ sweep, dx, dy, style, accessibilityLabel, children }: SweepSlotProps) {
  const animated = useAnimatedStyle(() => {
    const p = sweep.value;
    return {
      opacity: sweepOpacity(p),
      transform: [{ translateX: dx * p }, { translateY: dy * p }],
    };
  });
  return (
    <Reanimated.View
      style={[style, animated]}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </Reanimated.View>
  );
}

interface FlyInProps {
  /** The card was just played (the "seen" guard): it flies in and cues its sound. */
  arriving: boolean;
  reduceMotion: boolean;
  /** Where the flight starts, from the slot. */
  dx: number;
  dy: number;
  onPlace: () => void;
  onLanded: () => void;
  children: React.ReactNode;
}

/**
 * A played card's flight from its seat to the slot, on the UI thread. Card place is cued from
 * the flight's own clock (`FLIGHT_MS - SOUND_LEAD_MS`), not from the state change. What it does
 * is fixed at mount, so a card already on the table never flies or sounds again.
 */
function FlyIn({ arriving, reduceMotion, dx, dy, onPlace, onLanded, children }: FlyInProps) {
  const [mode] = useState<"fly" | "place" | "still">(() =>
    !arriving ? "still" : reduceMotion ? "place" : "fly"
  );
  const progress = useSharedValue(mode === "fly" ? 0 : 1);
  useEffect(() => {
    if (mode === "still") return;
    if (mode === "place") {
      onPlace();
      onLanded();
      return;
    }
    progress.value = withTiming(1, { duration: FLIGHT_MS, easing: FLIGHT_EASING });
    const place = setTimeout(onPlace, FLIGHT_MS - SOUND_LEAD_MS);
    const land = setTimeout(onLanded, FLIGHT_MS);
    return () => {
      clearTimeout(place);
      clearTimeout(land);
      cancelAnimation(progress);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => {
    const k = 1 - progress.value;
    return { transform: [{ translateX: dx * k }, { translateY: dy * k }] };
  });
  return <Reanimated.View style={style}>{children}</Reanimated.View>;
}

interface NudgeProps {
  active: boolean;
  dx: number;
  dy: number;
  children: React.ReactNode;
}

/**
 * One outward nudge and back, on the UI thread, when `active` turns true: timed to the Queen
 * of Spades' gong strike (`QUEEN_TIMING.nudgeAt`, 500 ms).
 */
function NudgeOutward({ active, dx, dy, children }: NudgeProps) {
  const progress = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;
    if (!active) return;
    progress.value = withDelay(
      QUEEN_TIMING.nudgeAt,
      withTiming(1, { duration: QUEEN_TIMING.nudgeDuration, easing: ReEasing.linear })
    );
    return () => cancelAnimation(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  const style = useAnimatedStyle(() => {
    const k = seg(progress.value, 0, 1, [0, 0.5, 1], [0, 1, 0], EASE_OUT);
    return { transform: [{ translateX: dx * k }, { translateY: dy * k }] };
  });
  return <Reanimated.View style={style}>{children}</Reanimated.View>;
}

const styles = StyleSheet.create({
  area: {
    position: "relative",
  },
  slot: {
    position: "absolute",
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0,
  },
});
