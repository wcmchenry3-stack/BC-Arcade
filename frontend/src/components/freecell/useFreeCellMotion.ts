/**
 * FreeCell's card motion and the sounds timed to it (#3573, owner decision "A. Match Solitaire";
 * docs/games/freecell.md, "Motion and sound timing"). The screen's half of the shared stack
 * (`components/cards/`): the flight store, the cue clock, the holds (the riffle and the result
 * card wait for the last landing) and Auto-Complete's riffle.
 *
 * The engine stays instant. Each action calls `start` with the board before and after it: its
 * cards fly (`planFreeCellMotion`) and its sound cues are timed from the plan (`cueTimes`), so
 * the screen's event handlers schedule each sound with `cueAt` instead of playing it at the
 * state change. A card already in flight is re-targeted from where it is shown (no motion lock).
 * With Reduce Motion, while the player is away, or for a move that flips Large cards' fallback
 * (the board is re-laid out at another card size), nothing flies and every cue is at the instant.
 */
import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { createCardFlightStore, type CardFlightStore } from "../cards/cardFlights";
import {
  cueTimes,
  FLIGHT_BACKSTOP_MS,
  INSTANT_CUES,
  type CueTimes,
  type MotionPlan,
  type MoveKind,
} from "../cards/cardMotion";
import { launchMotion } from "../cards/launchMotion";
import { useCueClock, type CueTag } from "../cards/useCueClock";
import { freeCellMotionLayout, planFreeCellMotion } from "./freecellMotion";
import type { FreeCellState } from "../../game/freecell/types";
import type { TableGeometry } from "../../game/_shared/cards/tableLayout";
import type { DropOffset } from "../../game/_shared/drag/DragContext";
import { GHOST_LIFT } from "../../game/_shared/drag/dragGeometry";
import { useAutoCompleteRiffle } from "../../game/_shared/useRunSound";
import { FREECELL_AUTO_COMPLETE, FREECELL_SOUNDS } from "../../game/freecell/sounds";

/** The sound cues of the action in motion, and when it started. */
export interface ActionCues extends CueTimes {
  readonly at: number;
  readonly kind: MoveKind;
  /** The action's id: a later action that calls it off cancels its cues. */
  readonly action: number;
  /**
   * Whether the action moved a card: false when every card it moved was shown already where it
   * now lies (sent back before it left), so nothing lands and it has no landing sound.
   */
  readonly moved: boolean;
}

/** The board's geometry as it is drawn, for the planner. */
interface MotionGeometry {
  readonly geometry: TableGeometry;
  /** The tableau card's width the board will be drawn at after `state` (Large cards' fallback). */
  readonly cardWidthAfter: (state: FreeCellState) => number;
}

export interface FreeCellMotionInput {
  readonly state: FreeCellState | null;
  /** Auto-Complete is running (the board is input-locked, #2225). */
  readonly autoCompleting: boolean;
  /** The player is away (`usePauseWhileAway`): no cue plays. */
  readonly awayRef: { readonly current: boolean };
  readonly reduceMotion: boolean;
  /** Card place, for the cards of an action called off whose landing sound had not played. */
  readonly playCardPlace: () => void;
}

export interface FreeCellMotion {
  /** The board's flight store (`CardFlightContext`). */
  readonly flights: CardFlightStore;
  /** True from Auto-Complete's first card on: the run's own card sounds stay quiet. */
  readonly riffleRunRef: React.MutableRefObject<boolean>;
  /** The result card waits for the winning action's last landing (or its backstop). */
  readonly winHold: boolean;
  /** The action in motion's cues. */
  readonly cueRef: { readonly current: ActionCues };
  /** The board's geometry (set by `useFreeCellMotionGeometry`). */
  readonly geometryRef: React.MutableRefObject<MotionGeometry | null>;
  /**
   * Plans and launches an action's motion: `prev` is the board drawn now, `next` the board it
   * commits. A drop passes where the ghost was let go. Call it before committing `next`.
   */
  start(kind: MoveKind, prev: FreeCellState, next: FreeCellState, offset?: DropOffset): MotionPlan;
  /** Plays `play` at `ms` after the action in motion started (unless the player is away). */
  cueAt(play: () => void, ms: number, tag?: CueTag): void;
  /** Auto-Complete moved a card (true), or its run ended (false): the riffle starts there. */
  setStepped(stepped: boolean): void;
  /** The winning Auto-Complete step: the riffle plays on until its last landing. */
  holdRiffle(): void;
  /** A new deal: every card lands, every cue goes, the holds are released. */
  stop(): void;
  /** The player left: as `stop`, and a riffle held for the last landing ends without its settle. */
  leave(): void;
}

const EMPTY_PLAN: MotionPlan = {
  flights: [],
  moved: 0,
  contactMs: 0,
  firstEdgeMs: null,
  revealEdgeMs: null,
  cancelled: [],
  settled: [],
  owesFlip: false,
};

export function useFreeCellMotion(input: FreeCellMotionInput): FreeCellMotion {
  const { state, autoCompleting, awayRef, reduceMotion, playCardPlace } = input;
  // A fresh store per mount: nothing on the table at mount (a restore) ever flies.
  const [flights] = useState(createCardFlightStore);
  // Every delayed cue and hold release: cancelled on a new deal, on leaving and on unmount.
  const cues = useCueClock();
  const [riffleHold, setRiffleHold] = useState(false);
  const riffleHoldRef = useRef(false);
  // The hold ended (or the run won) while the player was away: the riffle stops without its
  // settle, since a cue due while away is not played.
  const [riffleQuiet, setRiffleQuiet] = useState(false);
  // Auto-Complete has moved its first card. With motion the riffle starts there, not with the
  // move that started the run (still in flight, with its own card place). With Reduce Motion
  // nothing is in flight, and the riffle starts with the run, as before #3573.
  const [stepped, setStepped] = useState(false);
  const [winHold, setWinHold] = useState(false);
  const cueRef = useRef<ActionCues>({
    ...INSTANT_CUES,
    at: 0,
    kind: "tap",
    action: 0,
    moved: false,
  });
  const actionIdRef = useRef(0);
  const geometryRef = useRef<MotionGeometry | null>(null);
  // Read at each move, not captured: Auto-Complete's queued steps keep the `start` they were
  // queued with, and must still see Reduce Motion turned on mid-run (#3712 review).
  const reduceMotionRef = useRef(reduceMotion);

  // Auto-Complete's riffle (#3563); see useAutoCompleteRiffle for what it mutes.
  const riffleRunRef = useAutoCompleteRiffle(
    (autoCompleting && (stepped || reduceMotion)) || riffleHold,
    riffleQuiet ? null : state,
    FREECELL_AUTO_COMPLETE,
    FREECELL_SOUNDS
  );

  const setHold = useCallback((on: boolean) => {
    riffleHoldRef.current = on;
    setRiffleHold(on);
  }, []);
  const releaseWin = useCallback(() => setWinHold(false), []);

  const start = useCallback(
    (kind: MoveKind, prev: FreeCellState, next: FreeCellState, offset?: DropOffset) => {
      const now = Date.now();
      const action = ++actionIdRef.current;
      const g = geometryRef.current;
      // A drop settles from where the ghost was let go (drawn GHOST_LIFT above the finger's card).
      const drop = offset ? { x: offset.dx, y: offset.dy - GHOST_LIFT } : undefined;
      const layout = g === null ? null : freeCellMotionLayout(g.geometry);
      if (
        g === null ||
        layout === null ||
        reduceMotionRef.current ||
        awayRef.current ||
        g.cardWidthAfter(next) !== g.geometry.cardWidth
      ) {
        // Nothing moves: a card still in flight lands now (from before the setting changed, or
        // on a board about to be re-laid out at another card size).
        flights.clear();
        // An instant move still lands, at the instant.
        cueRef.current = { ...INSTANT_CUES, at: now, kind, action, moved: true };
        return layout === null ? EMPTY_PLAN : planFreeCellMotion({ prev, next, kind, layout });
      }
      const plan = planFreeCellMotion({
        prev,
        next,
        kind,
        layout,
        drop,
        shownAt: (key) => flights.shownAt(key, now),
      });
      // The actions this one calls off (it moves a card they had in flight): their pending cues
      // go; their other cards still land, with a card place if theirs had not played yet.
      const winning = next.isComplete && plan.flights.length > 0;
      launchMotion({
        plan,
        now,
        action,
        store: flights,
        clock: cues,
        playPlace: () => {
          if (!awayRef.current && !riffleRunRef.current) playCardPlace();
        },
        onLanded: winning ? releaseWin : undefined,
      });
      cueRef.current = { ...cueTimes(plan), at: now, kind, action, moved: plan.moved > 0 };
      // The result card waits for the winning landing, or its backstop.
      if (winning) {
        setWinHold(true);
        cues.schedule(releaseWin, plan.contactMs + FLIGHT_BACKSTOP_MS);
      }
      return plan;
    },
    [flights, cues, awayRef, riffleRunRef, playCardPlace, releaseWin]
  );

  const cueAt = useCallback(
    (play: () => void, ms: number, tag: CueTag = "other") => {
      cues.schedule(
        () => {
          if (!awayRef.current) play();
        },
        cueRef.current.at + ms - Date.now(),
        cueRef.current.action,
        tag
      );
    },
    [cues, awayRef]
  );

  const holdRiffle = useCallback(() => {
    if (awayRef.current) {
      setRiffleQuiet(true);
      return;
    }
    const { at, settle } = cueRef.current;
    // Instant (Reduce Motion): the riffle ends with the step, as before.
    if (settle <= 0) return;
    setHold(true);
    // The settle's peak on the last contact (it plays when the riffle ends).
    cues.schedule(
      () => {
        if (awayRef.current) setRiffleQuiet(true);
        setHold(false);
      },
      at + settle - Date.now()
    );
  }, [awayRef, cues, setHold]);

  const stop = useCallback(() => {
    cues.cancelAll();
    flights.clear();
    setHold(false);
    setRiffleQuiet(false);
    setStepped(false);
    setWinHold(false);
  }, [cues, flights, setHold]);

  const leave = useCallback(() => {
    cues.cancelAll();
    flights.clear();
    if (riffleHoldRef.current) setRiffleQuiet(true);
    setHold(false);
    setWinHold(false);
  }, [cues, flights, setHold]);

  // Reduce Motion turned on mid-flight: every card in flight lands at once (a held result card
  // still waits for its backstop, at most FLIGHT_BACKSTOP_MS after the landing was due).
  useEffect(() => {
    reduceMotionRef.current = reduceMotion;
    if (reduceMotion) flights.clear();
  }, [reduceMotion, flights]);

  return {
    flights,
    riffleRunRef,
    winHold,
    cueRef,
    geometryRef,
    start,
    cueAt,
    setStepped,
    holdRiffle,
    stop,
    leave,
  };
}

/**
 * Hands the board's geometry to the planner, after each commit. A board re-laid out at another
 * size (the felt resized, the bottom band grown, Large cards toggled or their fallback) lands
 * every card in flight: their positions were planned on the old one.
 */
export function useFreeCellMotionGeometry(
  motion: FreeCellMotion,
  geometry: TableGeometry,
  cardWidthAfter: (state: FreeCellState) => number
): void {
  const { geometryRef, flights } = motion;
  useLayoutEffect(() => {
    geometryRef.current = { geometry, cardWidthAfter };
  }, [geometryRef, geometry, cardWidthAfter]);
  const { cardWidth, cardHeight, topCardWidth, topCardHeight, gap, padding, rowGap } = geometry;
  const { tableauHeight } = geometry;
  useLayoutEffect(
    () => flights.clear(),
    [
      flights,
      cardWidth,
      cardHeight,
      topCardWidth,
      topCardHeight,
      gap,
      padding,
      rowGap,
      tableauHeight,
    ]
  );
}
