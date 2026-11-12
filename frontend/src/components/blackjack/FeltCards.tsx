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
 * Each motion is one linear Reanimated timing, eased in the worklet, in a view mounted for it
 * (keyed by the motion) whose shared values start at the motion's start pose: the first frame
 * drawn is already off the felt, or where the card was, or showing its back (#3720 review). The
 * card works the motion out in render from its props' changes, and where a card is shown from the
 * same curves on the JS clock (no UI-thread read). A JS backstop (`FLIGHT_BACKSTOP_MS` after its
 * end) lands a motion whose end the system cut short, so a card is never left off its place. A
 * new `epoch` lands every card at once.
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

import type { CardResponse } from "../../game/blackjack/types";
import type { FanGeometry } from "../../game/blackjack/layout";
import { FLIGHT_BACKSTOP_MS, type Point } from "../cards/cardMotion";
import PlayingCard from "./PlayingCard";
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
import { CardPlace, NaturalEdge, type NaturalTone } from "./NaturalMoment";

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
  /** A natural's edge on the hand's two cards (#3621). */
  readonly natural?: NaturalTone | null;
  /** When the player's natural moment (lift, glint) started (JS clock); null: static. */
  readonly moment?: number | null;
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
              natural={i < 2 ? (hand.natural ?? null) : null}
              moment={i < 2 ? (hand.moment ?? null) : null}
              liftable={hand.id !== "dealer" && i < 2}
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

/**
 * A motion from `from` to rest, on the JS clock (`start`), with the deal's or a slide's curve.
 * `key` changes with every new motion: its view is mounted with the start pose already set.
 */
interface Segment {
  readonly key: number;
  readonly from: Pose;
  readonly start: number;
  readonly durationMs: number;
  readonly deal: boolean;
}

const restSegment = (key: number): Segment => ({
  key,
  from: REST,
  start: 0,
  durationMs: 0,
  deal: false,
});

/** The JS clock. A function, so a render that reads it states what it reads. */
const now = () => Date.now();

/** How far through `durationMs` a motion that started at `start` is, at `t` (0 → 1). */
function progressAt(start: number, durationMs: number, t: number): number {
  if (durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, (t - start) / durationMs));
}

/** Where a segment shows the card at `t`, relative to its place. */
function poseAt(seg: Segment, t: number): Pose {
  const p = progressAt(seg.start, seg.durationMs, t);
  if (p >= 1) return REST;
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
  /** A natural's edge (#3621), and when its moment started (null: static). */
  readonly natural: NaturalTone | null;
  readonly moment: number | null;
  /** A player's first or second card: it can lift with a natural (the same for its life). */
  readonly liftable: boolean;
}

/** What a card's motion is now: worked out in render from its props' changes. */
interface CardMotionState {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly epoch: number;
  readonly faceDown: boolean;
  readonly dealt: boolean;
  readonly seg: Segment;
  /** When the hole card started to turn (null: it is not turning in this card's life). */
  readonly flipStart: number | null;
  readonly flipKey: number;
}

/**
 * The card's next motion state for these props. Pure but for the clock: in render, so the view
 * of a new motion mounts with its start pose (#3720 review: set in an effect, it showed a frame
 * late, a dealt card popping at its place before it flew in).
 */
function nextMotion(st: CardMotionState, p: CardProps, t: number): CardMotionState {
  const { x, y, width, card, dealIn, flips, slideMs, epoch } = p;
  if (st.epoch !== epoch) {
    // Everything lands at once.
    return {
      ...st,
      x,
      y,
      width,
      epoch,
      faceDown: card.face_down,
      dealt: st.dealt || dealIn,
      seg: restSegment(st.seg.key + 1),
      flipStart: null,
      flipKey: st.flipKey + 1,
    };
  }
  let next = st;
  if (dealIn && !st.dealt) {
    // Dealt: it flies in from off the felt as the deal first draws it.
    const from = { x: p.originX - x, y: p.originY - y, scale: 1, rotate: DEAL_ROTATE_DEG };
    const seg = { key: st.seg.key + 1, from, start: t, durationMs: DEAL_FLIGHT_MS, deal: true };
    next = { ...next, dealt: true, seg, x, y, width };
  } else if (st.x !== x || st.y !== y || st.width !== width) {
    // Moved: it slides from where it is shown to its new place (or jumps, with no slide). A card
    // still being dealt keeps the deal's curve for what is left of its flight.
    const shown = poseAt(st.seg, t);
    const from: Pose = {
      x: st.x + shown.x - x,
      y: st.y + shown.y - y,
      scale: (st.width * shown.scale) / width,
      rotate: shown.rotate,
    };
    const left = st.seg.deal ? Math.max(0, st.seg.start + st.seg.durationMs - t) : 0;
    const durationMs = Math.max(slideMs, left);
    const seg =
      durationMs <= 0
        ? restSegment(st.seg.key + 1)
        : { key: st.seg.key + 1, from, start: t, durationMs, deal: st.seg.deal && left > slideMs };
    next = { ...next, seg, x, y, width };
  }
  if (st.faceDown !== card.face_down) {
    // Turned face up: the hole card flips, when this action turns it.
    const turning = st.faceDown && !card.face_down && flips;
    next = {
      ...next,
      faceDown: card.face_down,
      flipStart: turning ? t : next.flipStart,
      flipKey: turning ? st.flipKey + 1 : st.flipKey,
    };
  }
  return next;
}

const FeltCard = React.memo(function FeltCard(props: CardProps) {
  const { testID, card, dimmed, x, y, width, height } = props;
  const [state, setState] = useState<CardMotionState>(() => {
    const first: CardMotionState = {
      x,
      y,
      width,
      epoch: props.epoch,
      faceDown: card.face_down,
      dealt: false,
      seg: restSegment(0),
      flipStart: null,
      flipKey: 0,
    };
    return nextMotion(first, props, now());
  });
  const next = nextMotion(state, props, now());
  if (next !== state) setState(next);
  // The cards are one list (dealer, then each hand), so a card dealt to a hand, or the hole card
  // lifting as it turns, would draw under the later hands' cards: it is lifted above them while it
  // flies or turns (#3720 review), and drops back as it lands or its turn ends, so the hole card
  // never covers the dealer's next card at rest (#3720 round 2).
  const lifted = useLift(liftEndOf(next));
  return (
    // A natural's two cards lift together (#3621), in their place.
    <CardPlace
      liftable={props.liftable}
      moment={props.moment}
      testID={testID}
      style={[styles.card, { left: x, top: y, width, height }, lifted && styles.lifted]}
    >
      <CardPose key={next.seg.key} seg={next.seg} width={width} height={height} testID={testID}>
        <CardTurn key={next.flipKey} start={next.flipStart} testID={testID}>
          <PlayingCard card={card} width={width} height={height} disabled={dimmed} />
          {next.flipStart !== null && !card.face_down ? (
            <TurnBack start={next.flipStart}>
              <PlayingCard card={{ ...card, face_down: true }} width={width} height={height} />
            </TurnBack>
          ) : null}
        </CardTurn>
      </CardPose>
      {props.natural !== null && (
        <NaturalEdge
          key={props.moment ?? "still"}
          tone={props.natural}
          since={props.moment}
          width={width}
          height={height}
          testID={testID}
        />
      )}
    </CardPlace>
  );
});

/** When the card's flight or turn ends (it is lifted until then), or 0. */
function liftEndOf(st: CardMotionState): number {
  const flight = st.seg.deal ? st.seg.start + st.seg.durationMs : 0;
  const turn = st.flipStart === null ? 0 : st.flipStart + FLIP_MS;
  return Math.max(flight, turn);
}

/** True until `end` (a JS clock time): one re-render when it passes. */
function useLift(end: number): boolean {
  const [, setTick] = useState(0);
  const lifted = now() < end;
  useEffect(() => {
    const left = end - now();
    if (left <= 0) return;
    const timer = setTimeout(() => setTick((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [end]);
  return lifted;
}

/**
 * Runs a 0 → 1 progress from `initial` for what is left of `durationMs`, on the UI thread, with
 * a JS backstop that lands it `FLIGHT_BACKSTOP_MS` after its end if the timing's end never comes.
 */
function useProgress(initial: number, durationMs: number) {
  const [first] = useState(initial);
  const p = useSharedValue(first);
  useEffect(() => {
    if (first >= 1) return;
    const left = durationMs * (1 - first);
    p.value = withTiming(1, { duration: left, easing: Easing.linear });
    const backstop = setTimeout(() => {
      cancelAnimation(p);
      p.set(1);
    }, left + FLIGHT_BACKSTOP_MS);
    return () => {
      clearTimeout(backstop);
      cancelAnimation(p);
    };
    // Once, at mount: a new motion is a new view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return p;
}

/** The card's place-to-place motion (a deal, a slide), mounted at its start pose. */
function CardPose({
  seg,
  width,
  height,
  testID,
  children,
}: {
  readonly seg: Segment;
  readonly width: number;
  readonly height: number;
  readonly testID: string;
  readonly children: React.ReactNode;
}) {
  const p = useProgress(progressAt(seg.start, seg.durationMs, now()), seg.durationMs);
  const { from, deal } = seg;
  const style = useAnimatedStyle(() => {
    const e = deal ? easeDeal(p.value) : easeSlide(p.value);
    const s = from.scale + (1 - from.scale) * e;
    // React Native scales about the view's centre: shift it so the top-left corner holds.
    return {
      transform: [
        { translateX: from.x * (1 - e) - ((1 - s) * width) / 2 },
        { translateY: from.y * (1 - e) - ((1 - s) * height) / 2 },
        { rotate: `${from.rotate * (1 - e)}deg` },
        { scale: s },
      ],
    };
  });
  return (
    <Reanimated.View testID={`${testID}-pose`} style={[styles.fill, style]}>
      {children}
    </Reanimated.View>
  );
}

/** The hole card's turn (Y axis, 180° → 0°, lifting at the midpoint), mounted at its start. */
function CardTurn({
  start,
  testID,
  children,
}: {
  readonly start: number | null;
  readonly testID: string;
  readonly children: React.ReactNode;
}) {
  const t = useProgress(start === null ? 1 : progressAt(start, FLIP_MS, now()), FLIP_MS);
  const style = useAnimatedStyle(() => ({
    transform: [
      { perspective: 800 },
      { rotateY: `${180 * (1 - easeFlip(t.value))}deg` },
      { scale: 1 + (FLIP_LIFT - 1) * Math.sin(Math.PI * t.value) },
    ],
  }));
  return (
    <Reanimated.View testID={`${testID}-turn`} style={[styles.fill, style]}>
      {children}
    </Reanimated.View>
  );
}

/** The card's back over its face until the turn is edge-on (mounted showing). */
function TurnBack({
  start,
  children,
}: {
  readonly start: number;
  readonly children: React.ReactNode;
}) {
  const t = useProgress(progressAt(start, FLIP_MS, now()), FLIP_MS);
  const style = useAnimatedStyle(() => ({ opacity: t.value < 0.5 ? 1 : 0 }));
  return (
    <Reanimated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {children}
    </Reanimated.View>
  );
}

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
});
