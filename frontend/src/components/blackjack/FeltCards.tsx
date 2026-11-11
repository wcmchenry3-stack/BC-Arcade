/**
 * FeltCards — every card on the Blackjack felt (#3580), and its motion (#3581).
 *
 * Positions come from the table geometry (game/blackjack/layout.ts): each hand's cards fanned
 * left to right so each shows its corner index. The cards are one flat list keyed by card id
 * (`CardIds`), so a card keeps its view from its deal to the result, and a split's second card
 * slides to its new hand instead of being dealt again.
 *
 * The view at the card's place (its testID, size and label) never moves; the card drawn inside
 * it does, on the UI thread:
 *   - a card first drawn while it is being dealt flies in from just off the felt's top-right
 *     (240 ms, −18° → 0°, `easeDeal`);
 *   - a card whose place changes slides there (`slideMs`), from where it is shown;
 *   - the hole card turns over (320 ms, Y axis, lifting to 1.08 at the midpoint).
 * Each motion is one linear Reanimated timing, eased in the worklet. JS sets it going once and
 * works out where a card is shown from the same curves (no UI-thread read). A JS backstop
 * (`FLIGHT_BACKSTOP_MS` after its end) lands a motion whose end the system cut short, so a card
 * is never left off its place. A new `epoch` lands every card at once.
 */
import React, { useEffect, useLayoutEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Reanimated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "../../theme/ThemeContext";
import type { CardResponse } from "../../game/blackjack/types";
import type { FanGeometry } from "../../game/blackjack/layout";
import { FLIGHT_BACKSTOP_MS, type Point } from "../cards/cardMotion";
import PlayingCard from "./PlayingCard";
import { holeCardOutline } from "./tableColors";
import {
  DEAL_FLIGHT_MS,
  DEAL_ROTATE_DEG,
  easeDeal,
  easeFlip,
  easeSlide,
  FLIP_LIFT,
  FLIP_MS,
} from "./blackjackMotion";
import type { CardMotion } from "./useBlackjackMotion";

/** Width of the outline around a face-down card, drawn just outside its edge. */
const OUTLINE = 1.5;

/** One hand's cards as the felt draws them. */
export interface FeltHand {
  /** Stable id of the hand ("dealer", "hand-0" ...): prefixes each card's testID. */
  readonly id: string;
  readonly cards: readonly CardResponse[];
  /** Each card's id (`CardIds`), by place. */
  readonly ids: readonly string[];
  readonly fan: FanGeometry;
  /** Dim the cards (a split hand already played). */
  readonly dimmed?: boolean;
}

interface Props {
  readonly hands: readonly FeltHand[];
  readonly motion: CardMotion;
  /** Where a dealt card's flight starts (its top-left, in the felt's coordinates). */
  readonly origin: Point;
}

export default function FeltCards({ hands, motion, origin }: Props) {
  return (
    <>
      {hands.flatMap((hand) =>
        hand.cards.map((card, i) => {
          const id = hand.ids[i] ?? `${hand.id}-${i}`;
          return (
            <FeltCard
              key={id}
              testID={`${hand.id}-card-${i}`}
              card={card}
              x={hand.fan.x + i * hand.fan.step}
              y={hand.fan.y}
              width={hand.fan.cardWidth}
              height={hand.fan.cardHeight}
              dimmed={hand.dimmed ?? false}
              dealIn={motion.dealing.has(id)}
              flips={motion.flipping.has(id)}
              slideMs={motion.slideMs}
              epoch={motion.epoch}
              originX={origin.x}
              originY={origin.y}
            />
          );
        })
      )}
    </>
  );
}

/** The card's offset from its place (top-left), scale (about the top-left) and turn. */
interface Pose {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly rotate: number;
}

const REST: Pose = { x: 0, y: 0, scale: 1, rotate: 0 };

/** A motion from `from` to rest, on the JS clock (`start`), with the deal's or a slide's curve. */
interface Segment {
  readonly from: Pose;
  readonly start: number;
  readonly durationMs: number;
  readonly deal: boolean;
}

/** Where a segment shows the card at `now`, relative to its place. */
function poseAt(seg: Segment | null, now: number): Pose {
  if (seg === null || seg.durationMs <= 0) return REST;
  const p = Math.min(1, Math.max(0, (now - seg.start) / seg.durationMs));
  const e = seg.deal ? easeDeal(p) : easeSlide(p);
  const { from } = seg;
  return {
    x: from.x * (1 - e),
    y: from.y * (1 - e),
    scale: from.scale + (1 - from.scale) * e,
    rotate: from.rotate * (1 - e),
  };
}

interface CardProps {
  readonly testID: string;
  readonly card: CardResponse;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly dimmed: boolean;
  readonly dealIn: boolean;
  readonly flips: boolean;
  readonly slideMs: number;
  readonly epoch: number;
  /** Where a dealt card's flight starts: numbers, so the card's memo holds across renders. */
  readonly originX: number;
  readonly originY: number;
}

type PoseInput = Omit<CardProps, "testID" | "card" | "dimmed"> & { readonly faceDown: boolean };

/** A card's motion on the UI thread: its styles, set going by its props' changes. */
function useCardPose({
  x,
  y,
  width,
  height,
  faceDown,
  dealIn,
  flips,
  slideMs,
  epoch,
  originX,
  originY,
}: PoseInput) {
  // The motion in progress, on the UI thread: its start pose, its curve and its progress (0 → 1).
  const fromX = useSharedValue(0);
  const fromY = useSharedValue(0);
  const fromScale = useSharedValue(1);
  const fromRotate = useSharedValue(0);
  const dealCurve = useSharedValue(0);
  const progress = useSharedValue(1);
  // The hole card's turn: 1 when face up and still.
  const turn = useSharedValue(1);

  const segRef = useRef<Segment | null>(null);
  const placeRef = useRef({ x, y, width });
  const dealtRef = useRef(false);
  const faceDownRef = useRef(faceDown);
  const moveBackstop = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnBackstop = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rest = () => {
    segRef.current = null;
    if (moveBackstop.current !== null) clearTimeout(moveBackstop.current);
    moveBackstop.current = null;
    cancelAnimation(progress);
    progress.value = 1;
  };
  const restTurn = () => {
    if (turnBackstop.current !== null) clearTimeout(turnBackstop.current);
    turnBackstop.current = null;
    cancelAnimation(turn);
    turn.value = 1;
  };

  const startSegment = (from: Pose, durationMs: number, deal: boolean) => {
    if (durationMs <= 0) {
      rest();
      return;
    }
    segRef.current = { from, start: Date.now(), durationMs, deal };
    fromX.value = from.x;
    fromY.value = from.y;
    fromScale.value = from.scale;
    fromRotate.value = from.rotate;
    dealCurve.value = deal ? 1 : 0;
    cancelAnimation(progress);
    progress.value = 0;
    progress.value = withTiming(1, { duration: durationMs, easing: Easing.linear });
    if (moveBackstop.current !== null) clearTimeout(moveBackstop.current);
    moveBackstop.current = setTimeout(rest, durationMs + FLIGHT_BACKSTOP_MS);
  };

  // Dealt: the card flies in from off the felt as it is first drawn by the deal.
  useLayoutEffect(() => {
    if (!dealIn || dealtRef.current) return;
    dealtRef.current = true;
    startSegment(
      { x: originX - x, y: originY - y, scale: 1, rotate: DEAL_ROTATE_DEG },
      DEAL_FLIGHT_MS,
      true
    );
    // Once, when the deal first draws the card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealIn]);

  // Moved: it slides from where it is shown to its new place (or jumps, with no slide).
  useLayoutEffect(() => {
    const old = placeRef.current;
    placeRef.current = { x, y, width };
    if (old.x === x && old.y === y && old.width === width) return;
    const shown = poseAt(segRef.current, Date.now());
    const seg = segRef.current;
    const from: Pose = {
      x: old.x + shown.x - x,
      y: old.y + shown.y - y,
      scale: (old.width * shown.scale) / width,
      rotate: shown.rotate,
    };
    // A card still being dealt keeps the deal's curve for what is left of its flight.
    const left = seg?.deal ? Math.max(0, seg.start + seg.durationMs - Date.now()) : 0;
    startSegment(from, Math.max(slideMs, left), seg?.deal === true && left > slideMs);
    // On a change of place only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, width]);

  // Turned face up: the hole card flips, when this action turns it.
  useLayoutEffect(() => {
    const was = faceDownRef.current;
    faceDownRef.current = faceDown;
    if (!(was && !faceDown) || !flips) return;
    cancelAnimation(turn);
    turn.value = 0;
    turn.value = withTiming(1, { duration: FLIP_MS, easing: Easing.linear });
    if (turnBackstop.current !== null) clearTimeout(turnBackstop.current);
    turnBackstop.current = setTimeout(restTurn, FLIP_MS + FLIGHT_BACKSTOP_MS);
    // On a turn only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceDown]);

  // Everything lands at once (a tap mid-motion, Reduce Motion turned on, the player away).
  const epochRef = useRef(epoch);
  useLayoutEffect(() => {
    if (epochRef.current === epoch) return;
    epochRef.current = epoch;
    rest();
    restTurn();
    // On a new epoch only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);

  useEffect(
    () => () => {
      if (moveBackstop.current !== null) clearTimeout(moveBackstop.current);
      if (turnBackstop.current !== null) clearTimeout(turnBackstop.current);
      cancelAnimation(progress);
      cancelAnimation(turn);
    },
    // Cleanup at unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const moveStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const e = dealCurve.value === 1 ? easeDeal(p) : easeSlide(p);
    const s = fromScale.value + (1 - fromScale.value) * e;
    const t = turn.value;
    const lift = 1 + (FLIP_LIFT - 1) * Math.sin(Math.PI * t);
    // React Native scales about the view's centre: shift it so the top-left corner holds.
    return {
      transform: [
        { translateX: fromX.value * (1 - e) - ((1 - s) * width) / 2 },
        { translateY: fromY.value * (1 - e) - ((1 - s) * height) / 2 },
        { rotate: `${fromRotate.value * (1 - e)}deg` },
        { perspective: 800 },
        { rotateY: `${180 * (1 - easeFlip(t))}deg` },
        { scale: s * lift },
      ],
    };
  });
  // The back shows over the face until the turn is edge-on.
  const backStyle = useAnimatedStyle(() => ({ opacity: turn.value < 0.5 ? 1 : 0 }));

  return { moveStyle, backStyle };
}

const FeltCard = React.memo(function FeltCard({ testID, card, dimmed, ...pose }: CardProps) {
  const { colors } = useTheme();
  const { x, y, width, height, flips, dealIn } = pose;
  const { moveStyle, backStyle } = useCardPose({ ...pose, faceDown: card.face_down });
  // The cards are one list (dealer, then each hand), so a card dealt to a hand, or the hole card
  // lifting as it turns, would draw under the later hands' cards: it is lifted above them
  // (#3720 review). It stays lifted until the next action; at rest no hands overlap.
  const lifted = dealIn || flips;
  return (
    <View
      testID={testID}
      style={[styles.card, { left: x, top: y, width, height }, lifted && styles.lifted]}
    >
      <Reanimated.View style={[styles.fill, moveStyle]}>
        <PlayingCard card={card} width={width} height={height} disabled={dimmed} />
        {flips && !card.face_down ? (
          <Reanimated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, backStyle]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <PlayingCard card={{ ...card, face_down: true }} width={width} height={height} />
          </Reanimated.View>
        ) : null}
        {card.face_down && (
          // The hole card: a table-level outline so the deck's back reads
          // against the felt whatever the deck (#3580).
          <View
            testID={`${testID}-outline`}
            pointerEvents="none"
            style={[
              styles.outline,
              {
                width: width + 2 * OUTLINE,
                height: height + 2 * OUTLINE,
                borderColor: holeCardOutline(colors),
              },
            ]}
          />
        )}
      </Reanimated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    position: "absolute",
  },
  lifted: {
    zIndex: 1,
  },
  fill: {
    width: "100%",
    height: "100%",
  },
  outline: {
    position: "absolute",
    left: -OUTLINE,
    top: -OUTLINE,
    borderWidth: OUTLINE,
    borderRadius: 7,
  },
});
