/**
 * Solitaire's flight layer (#3572): the cards an action moved, drawn flying from where they
 * were to where they now are, above every pile.
 *
 * The engine stays instant. An action commits its state, and the screen hands the planned
 * flights (`planMotion`, solitaireMotion.ts) to this board's `CardFlightStore`. While a card is
 * in the store its real view in a pile is drawn transparent (`HiddenWhileFlying`), and the
 * `CardFlightLayer` (the board's last child, so it draws above the top row and the tableau)
 * draws a copy on the UI thread: one linear Reanimated timing per flight, eased and turned in a
 * worklet. Its end comes back through runOnJS, with a JS backstop (`FLIGHT_BACKSTOP_MS`), and
 * lands the card: the copy goes, the real card shows. JS sees one launch per action and one
 * landing per card, never a frame.
 *
 * Nothing replays: flights come only from actions (never from a state change seen on mount or
 * restore), and the store is empty at mount and emptied on a new deal.
 */
import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";
import Reanimated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import PlayingCard from "../shared/PlayingCard";
import { TransparentFace } from "../cards/TransparentFace";
import type { CanonicalSuit } from "../../game/_shared/decks/types";
import { useCardSize } from "../../game/_shared/CardSizeContext";
import { easeOutCubic, FLIGHT_BACKSTOP_MS, type FlightSpec, type Shown } from "./solitaireMotion";

/**
 * A flight in the air: its spec, when it was launched, its id (a re-target is a new id) and the
 * action it belongs to (its sound cues are that action's).
 */
export interface Flight extends FlightSpec {
  readonly id: number;
  readonly startedAt: number;
  readonly action: number;
}

export interface CardFlightStore {
  /** The flights in the air, bottom first. A new array on every change. */
  getFlights(): readonly Flight[];
  /** True while `key`'s card is drawn by the flight layer (its real view is hidden). */
  isFlying(key: string): boolean;
  /**
   * Where and how `key`'s card is shown at `now` (a new action re-targets it from there), or
   * null when it is not in flight. From the flight's own clock and easing, so no UI-thread read.
   */
  shownAt(key: string, now: number): Shown | null;
  /**
   * Launches action `action`'s flights at `now`. A card already in flight is re-targeted: its
   * old flight goes and the new one starts from where it was shown. `onLanded` is called once,
   * when every flight of this action has landed (or been re-targeted by a later action).
   */
  launch(flights: readonly FlightSpec[], now: number, action: number, onLanded?: () => void): void;
  /** A flight's end (its UI-thread callback or its backstop). Repeat calls do nothing. */
  land(id: number): void;
  /** Lands these cards' flights now (a turn a later action called off). */
  landKeys(keys: readonly string[]): void;
  /**
   * When the last of `action`'s moving cards still in flight lands (a `Date.now()` time),
   * leaving out `except` (the cards a later action takes over), or null when none is left.
   */
  lastContactOf(action: number, except: ReadonlySet<string>): number | null;
  /** Drops every flight and every pending `onLanded` (a new deal, a restore, leaving). */
  clear(): void;
  subscribe(listener: () => void): () => void;
}

interface Group {
  pending: Set<number>;
  onLanded: () => void;
}

export function createCardFlightStore(): CardFlightStore {
  let flights: readonly Flight[] = [];
  let byKey = new Map<string, Flight>();
  let groups: Group[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();

  const emit = () => listeners.forEach((l) => l());
  const set = (list: readonly Flight[]) => {
    flights = list;
    byKey = new Map(list.map((f) => [f.key, f]));
    emit();
  };
  /** Settles the groups that `ids` were the last pending flights of. */
  const settle = (ids: readonly number[]) => {
    const done: Group[] = [];
    for (const g of groups) {
      for (const id of ids) g.pending.delete(id);
      if (g.pending.size === 0) done.push(g);
    }
    if (done.length === 0) return;
    groups = groups.filter((g) => !done.includes(g));
    done.forEach((g) => g.onLanded());
  };

  return {
    getFlights: () => flights,
    isFlying: (key) => byKey.has(key),
    shownAt(key, now) {
      const f = byKey.get(key);
      if (f === undefined) return null;
      const raw = f.durationMs <= 0 ? 1 : (now - f.startedAt - f.delayMs) / f.durationMs;
      const p = Math.min(1, Math.max(0, raw));
      const e = easeOutCubic(p);
      return {
        x: f.from.x + (f.to.x - f.from.x) * e,
        y: f.from.y + (f.to.y - f.from.y) * e,
        // The face the flight layer draws: the old one until the turn's edge-on point.
        faceUp: p < 0.5 ? f.fromFaceUp : f.toFaceUp,
        toFaceUp: f.toFaceUp,
        to: f.to,
        remainingMs: Math.max(0, f.startedAt + f.delayMs + f.durationMs - now),
        action: f.action,
      };
    },
    launch(specs, now, action, onLanded) {
      if (specs.length === 0) {
        onLanded?.();
        return;
      }
      const launched = specs.map((s): Flight => ({ ...s, id: nextId++, startedAt: now, action }));
      const keys = new Set(launched.map((f) => f.key));
      const replaced = flights.filter((f) => keys.has(f.key)).map((f) => f.id);
      if (onLanded) groups.push({ pending: new Set(launched.map((f) => f.id)), onLanded });
      set([...flights.filter((f) => !keys.has(f.key)), ...launched]);
      settle(replaced);
    },
    land(id) {
      if (!flights.some((f) => f.id === id)) return;
      set(flights.filter((f) => f.id !== id));
      settle([id]);
    },
    lastContactOf(action, except) {
      let last: number | null = null;
      for (const f of flights) {
        if (f.action !== action || except.has(f.key)) continue;
        if (f.from.x === f.to.x && f.from.y === f.to.y) continue;
        const end = f.startedAt + f.delayMs + f.durationMs;
        last = last === null ? end : Math.max(last, end);
      }
      return last;
    },
    landKeys(keys) {
      const drop = new Set(keys);
      const ids = flights.filter((f) => drop.has(f.key)).map((f) => f.id);
      if (ids.length === 0) return;
      set(flights.filter((f) => !drop.has(f.key)));
      settle(ids);
    },
    clear() {
      groups = [];
      if (flights.length > 0) set([]);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The board's flight store; null outside a Solitaire board (the piles then never hide). */
export const CardFlightContext = createContext<CardFlightStore | null>(null);

const noSubscribe = () => () => undefined;

/**
 * A value read from the board's flight store; re-renders only when it changes, so select a
 * primitive. `fallback` outside a board.
 */
export function useFlightSelector<T>(select: (store: CardFlightStore) => T, fallback: T): T {
  const store = useContext(CardFlightContext);
  const get = () => (store === null ? fallback : select(store));
  return useSyncExternalStore(store?.subscribe ?? noSubscribe, get, get);
}

/**
 * A pile's view of a card that may be in flight: transparent while the flight layer draws it.
 * Kept in the tree (its label, testID and touch target stay). It is the card's gesture child:
 * the gesture's own view (the `ref` and `collapsable` GestureDetector clones on) stays opaque,
 * so the card still takes a tap or a drag on iOS and Android while it flies or turns (a new
 * action may re-target it); only the view inside it turns transparent (`TransparentFace`).
 * Outside a board it is the card alone.
 */
export function HiddenWhileFlying({
  cardKey,
  children,
  ...passed
}: {
  readonly cardKey: string;
  readonly children: React.ReactElement;
  readonly [prop: string]: unknown;
}) {
  const onBoard = useContext(CardFlightContext) !== null;
  const hidden = useFlightSelector((s) => s.isFlying(cardKey), false);
  if (!onBoard) {
    return Object.keys(passed).length > 0
      ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, passed)
      : children;
  }
  return (
    <TransparentFace hidden={hidden} {...passed}>
      {children}
    </TransparentFace>
  );
}

/**
 * The board's flight layer: the board's last child, covering it, so a card in flight draws
 * above every pile. Never takes a touch, and is hidden from screen readers (the real card is
 * in its pile, with its label).
 */
export function CardFlightLayer({ store }: { readonly store: CardFlightStore }) {
  const flights = useSyncExternalStore(store.subscribe, store.getFlights, store.getFlights);
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.layer]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      testID="solitaire-flight-layer"
    >
      {flights.map((f) => (
        <FlightCard key={f.id} flight={f} onEnd={store.land} />
      ))}
    </View>
  );
}

/**
 * One card's flight on the UI thread: a linear timing over its delay and duration, eased
 * (out-cubic) and turned (a card that turns over shows its old face until the edge-on point,
 * halfway through its own time, then its new one) in the worklet.
 */
const FlightCard = React.memo(function FlightCard({
  flight,
  onEnd,
}: {
  readonly flight: Flight;
  readonly onEnd: (id: number) => void;
}) {
  const { cardWidth, cardHeight } = useCardSize();
  // Fixed at mount: a flight never changes, a re-target is a new one.
  const [f] = useState(flight);
  const total = f.delayMs + f.durationMs;
  const turns = f.fromFaceUp !== f.toFaceUp;
  const clock = useSharedValue(0);

  useEffect(() => {
    const id = f.id;
    const end = () => onEnd(id);
    // On the action's clock, like its sound cues: a commit that mounts this late (a busy JS
    // thread) starts the flight part-way, so the contact still lands with its sound.
    const late = Math.min(total, Math.max(0, Date.now() - f.startedAt));
    const left = total - late;
    const backstop = setTimeout(end, left + FLIGHT_BACKSTOP_MS);
    clock.value = total <= 0 ? 0 : late / total;
    clock.value = withTiming(1, { duration: left, easing: Easing.linear }, (finished) => {
      "worklet";
      if (finished) runOnJS(end)();
    });
    return () => {
      clearTimeout(backstop);
      cancelAnimation(clock);
    };
    // Once per flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { delayMs, durationMs } = f;
  const fx = f.from.x;
  const fy = f.from.y;
  const dx = f.to.x - fx;
  const dy = f.to.y - fy;
  const progress = (t: number) => {
    "worklet";
    if (durationMs <= 0) return 1;
    return Math.min(1, Math.max(0, (t * total - delayMs) / durationMs));
  };
  const moveStyle = useAnimatedStyle(() => {
    const p = progress(clock.value);
    const e = easeOutCubic(p);
    return {
      transform: [
        { translateX: fx + dx * e },
        { translateY: fy + dy * e },
        { scaleX: turns ? Math.abs(Math.cos(Math.PI * p)) : 1 },
      ],
    };
  });
  const oldFaceStyle = useAnimatedStyle(() => ({
    opacity: progress(clock.value) < 0.5 ? 1 : 0,
  }));

  const card = (faceUp: boolean) => (
    <PlayingCard
      suit={f.card.suit as CanonicalSuit}
      rank={f.card.rank}
      faceDown={!faceUp}
      width={cardWidth}
      height={cardHeight}
    />
  );
  return (
    <Reanimated.View style={[styles.flight, moveStyle]} testID={`solitaire-flight-${f.key}`}>
      {card(f.toFaceUp)}
      {turns ? (
        <Reanimated.View style={[StyleSheet.absoluteFill, oldFaceStyle]}>
          {card(f.fromFaceUp)}
        </Reanimated.View>
      ) : null}
    </Reanimated.View>
  );
});

const styles = StyleSheet.create({
  layer: {
    // Above the top row and the tableau on every platform (the layer is also their last sibling).
    zIndex: 10,
    elevation: 10,
  },
  flight: {
    position: "absolute",
    left: 0,
    top: 0,
  },
});
