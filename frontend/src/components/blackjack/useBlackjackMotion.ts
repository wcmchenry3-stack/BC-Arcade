/**
 * Blackjack's card and chip motion on the screen (#3581): runs the timelines `planMotion`
 * plans (blackjackMotion.ts) on a cancellable cue clock, and tells the felt what to draw.
 *
 * - Only the player's actions move: the screen calls `expect()` before it applies one, and the
 *   change it makes is replayed. Anything else (the restored game at mount, New Game, a new
 *   hand's betting) is drawn at once, silently: nothing replays on restore, resume or return.
 * - Input stays live (#3575): `complete()` lands everything still moving at once, and the screen
 *   calls it before every action, so a tap is never dropped and never waits.
 * - With Reduce Motion, or while the player is away, nothing moves and each of the action's
 *   sounds plays once, at the instant (none while away). Reduce Motion turned on, or the player
 *   leaving (`leave()`), mid-motion lands everything at once.
 * - Every pending cue is cancelled on New Game (`reset()`) and on unmount (`useCueClock`).
 *
 * JS runs only at a stage's start (a handful per action), never per frame: the cards' and
 * chips' motion runs on the UI thread (FeltCard, ChipSprite).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { toViewState, type EngineState } from "../../game/blackjack/engine";
import type { BlackjackState } from "../../game/blackjack/types";
import { useCueClock, type CueClock } from "../cards/useCueClock";
import {
  assignCardIds,
  CHIP_BET_MS,
  feltSignature,
  planMotion,
  RESULT_CUES,
  stageView,
  type CardIds,
  type ChipShown,
  type SoundCue,
  type Stage,
  type Timeline,
} from "./blackjackMotion";

/** How the felt's cards move in this render. */
export interface CardMotion {
  /** Cards dealt by the action in motion: each flies in when it is first drawn. */
  readonly dealing: ReadonlySet<string>;
  /** The hole card, when the action in motion turns it. */
  readonly flipping: ReadonlySet<string>;
  /** How long a card moving to a new place slides (0: it jumps). */
  readonly slideMs: number;
  /** Bumped when everything lands at once: a card still moving jumps to its place. */
  readonly epoch: number;
}

export interface BlackjackMotionInput {
  readonly engine: EngineState | null;
  readonly reduceMotion: boolean;
  /** The player is away (`usePauseWhileAway`): no cue plays. */
  readonly awayRef: { readonly current: boolean };
  /**
   * Plays a sound (and its moment's effect: a flash, the celebration). `skipped`: the result's
   * chime of a motion the player cut short, played at once with no effect.
   */
  readonly playCue: (cue: SoundCue, skipped: boolean) => void;
}

export interface BlackjackMotion {
  /** What the felt draws (the settled round cut to the stage shown), or null before a game. */
  readonly view: BlackjackState | null;
  readonly ids: CardIds;
  readonly cards: CardMotion;
  /** Chips moving on the felt. */
  readonly chips: readonly ChipShown[];
  /** The chip count shown (the settled count only after the payout). */
  readonly shownChips: number | null;
  /** True when nothing is moving: the felt shows the settled round. */
  readonly settled: boolean;
  /**
   * Whether nothing is moving right now (an effect of the render that applied an action runs
   * before that render's `settled` catches up).
   */
  isSettled(): boolean;
  /** A stage is shown with motion (the banner and the tags pop in). */
  readonly animating: boolean;
  /** Split hands whose own result shows so far; undefined: every hand's. */
  readonly revealedHands: number | undefined;
  /**
   * The next change of the game is the player's action: replay it. Anything still moving lands
   * at once first (a tap mid-motion), the result's chime, if still due, sounding then.
   */
  expect(): void;
  /** The player left: everything still moving lands at once, silently. */
  leave(): void;
  /** New Game: every cue goes, nothing plays. */
  reset(): void;
  /** A chip from the tray into the betting circle, with its sound. */
  betChip(): void;
  /** Runs `fn` once the round is settled (at once when it is). */
  whenSettled(fn: () => void): void;
}

interface Shown {
  /** The settled round. */
  readonly final: BlackjackState | null;
  readonly ids: CardIds;
  /** The stage drawn; null: the settled round. */
  readonly stage: Stage | null;
  /** The chip count before the action (shown until it settles). */
  readonly prevChips: number;
  readonly cards: CardMotion;
}

const NO_IDS: CardIds = { dealer: [], hands: [] };
/** The cue clock's groups: the action in motion, and the tray's chips (betting). */
const MOTION = 1;
const TRAY = 2;
const NONE: ReadonlySet<string> = new Set();
const STILL: CardMotion = { dealing: NONE, flipping: NONE, slideMs: 0, epoch: 0 };

/** Each sound of `cues` once, in order: an action's sounds at the instant (Reduce Motion). */
function onceEach(cues: readonly { readonly sound: SoundCue }[]): SoundCue[] {
  return [...new Set(cues.map((c) => c.sound))];
}

/** How the cards of `ids` move in `plan`: the new ones are dealt, the hole card may turn. */
function cardMotionOf(before: CardIds, ids: CardIds, plan: Timeline, epoch: number): CardMotion {
  const had = new Set([...before.dealer, ...before.hands.flat()]);
  const dealing = new Set([...ids.dealer, ...ids.hands.flat()].filter((id) => !had.has(id)));
  const hole = ids.dealer[0];
  const flipping = plan.flips && hole !== undefined ? new Set([hole]) : NONE;
  return { dealing, flipping, slideMs: plan.slideMs, epoch };
}

/** A chip from the tray into the betting circle (betting is not an engine action). */
function useTrayChips(
  clock: CueClock,
  reduceMotionRef: { readonly current: boolean },
  playChip: () => void
) {
  const [trayChips, setTrayChips] = useState<readonly ChipShown[]>([]);
  const chipIdRef = useRef(1_000_000);
  const betChip = useCallback(() => {
    playChip();
    if (reduceMotionRef.current) return;
    const chip: ChipShown = {
      id: ++chipIdRef.current,
      kind: "bet",
      hand: 0,
      durationMs: CHIP_BET_MS,
    };
    setTrayChips((c) => [...c, chip]);
    clock.schedule(() => setTrayChips((c) => c.filter((x) => x !== chip)), CHIP_BET_MS, TRAY);
  }, [clock, reduceMotionRef, playChip]);
  const clearTray = useCallback(() => {
    clock.cancelGroup(TRAY);
    setTrayChips((c) => (c.length === 0 ? c : []));
  }, [clock]);
  return { trayChips, betChip, clearTray };
}

/** Callbacks waiting for the round to settle (the run's toasts): run at once when it is. */
function useSettledQueue(stageRef: { readonly current: Stage | null }) {
  const fnsRef = useRef<(() => void)[]>([]);
  const whenSettled = useCallback(
    (fn: () => void) => {
      if (stageRef.current === null) fn();
      else fnsRef.current.push(fn);
    },
    [stageRef]
  );
  const runSettled = useCallback(() => {
    const fns = fnsRef.current;
    fnsRef.current = [];
    fns.forEach((fn) => fn());
  }, []);
  const dropSettled = useCallback(() => {
    fnsRef.current = [];
  }, []);
  return { whenSettled, runSettled, dropSettled };
}

const NOTHING_SHOWN: Shown = { final: null, ids: NO_IDS, stage: null, prevChips: 0, cards: STILL };

interface Last {
  readonly engine: EngineState;
  readonly view: BlackjackState;
  readonly ids: CardIds;
  readonly sig: string;
}

export function useBlackjackMotion(input: BlackjackMotionInput): BlackjackMotion {
  const { engine, reduceMotion, awayRef, playCue } = input;
  const clock = useCueClock();
  const [shown, setShown] = useState<Shown>(NOTHING_SHOWN);
  /** The last game state seen, and its ids. */
  const lastRef = useRef<Last | null>(null);
  /** The game state the player's action was applied to (`expect()`). */
  const expectRef = useRef<EngineState | null>(null);
  /** The stage drawn, for the callbacks (the state may not have committed yet). */
  const stageRef = useRef<Stage | null>(null);
  /** The result's chime, while it is still due. */
  const chimeRef = useRef<SoundCue | null>(null);
  const nextIdRef = useRef(0);
  // Read when a cue runs or an action lands, never captured (#3712 review): a queued cue must see
  // Reduce Motion turned on since, and the latest sounds.
  const reduceMotionRef = useRef(reduceMotion);
  const playCueRef = useRef(playCue);
  useLayoutEffect(() => {
    playCueRef.current = playCue;
  }, [playCue]);

  const fresh = useCallback(() => `c${++nextIdRef.current}`, []);
  /** Plays a cue, unless the player is away. */
  const cue = useCallback(
    (sound: SoundCue, skipped = false) => {
      if (!awayRef.current) playCueRef.current(sound, skipped);
    },
    [awayRef]
  );
  const playChip = useCallback(() => cue("chipBet"), [cue]);
  const { trayChips, betChip, clearTray } = useTrayChips(clock, reduceMotionRef, playChip);

  const { whenSettled, runSettled, dropSettled } = useSettledQueue(stageRef);

  /** Lands everything at once. `chime`: the result's chime, if still due, plays now. */
  const land = useCallback(
    (chime: boolean) => {
      clock.cancelGroup(MOTION);
      const due = chimeRef.current;
      chimeRef.current = null;
      if (stageRef.current === null) return;
      stageRef.current = null;
      if (chime && due !== null) cue(due, true);
      runSettled();
      setShown((s) => ({ ...s, stage: null, cards: { ...STILL, epoch: s.cards.epoch + 1 } }));
    },
    [clock, cue, runSettled]
  );

  /** Runs an action's timeline: each stage and each sound at its time. */
  const run = useCallback(
    (plan: Timeline) => {
      const lastFrame = plan.frames[plan.frames.length - 1]!;
      for (const f of plan.frames.slice(1)) {
        const isLast = f === lastFrame;
        const show = () => {
          stageRef.current = isLast ? null : f.stage;
          setShown((s) => ({ ...s, stage: stageRef.current }));
          if (isLast) runSettled();
        };
        clock.schedule(show, f.at, MOTION);
      }
      for (const c of plan.cues) {
        const isChime = RESULT_CUES.includes(c.sound) && c.at === plan.resultAt;
        if (isChime) chimeRef.current = c.sound;
        const play = () => {
          if (isChime) chimeRef.current = null;
          cue(c.sound);
        };
        clock.schedule(play, c.at, MOTION);
      }
    },
    [clock, cue, runSettled]
  );

  useLayoutEffect(() => {
    if (engine === null) {
      lastRef.current = null;
      return;
    }
    const last = lastRef.current;
    const from = last !== null && expectRef.current === last.engine ? last : null;
    expectRef.current = null;
    const next = toViewState(engine);
    const sig = feltSignature(next);
    if (last !== null && last.sig === sig) {
      // The same felt (the events were cleared, a save copied the state): nothing moves.
      lastRef.current = { ...last, engine, view: next };
      return;
    }
    // Whatever still moves lands first, silently (an action has landed it already).
    land(false);
    const ids = assignCardIds(from, next, fresh);
    lastRef.current = { engine, view: next, ids, sig };
    const plan = from === null ? null : planMotion(from.view, next);
    const prevChips = last?.view.chips ?? next.chips;
    if (from === null || plan === null || reduceMotionRef.current || awayRef.current) {
      // At once. An action's sounds still play, each once, at the instant (none while away).
      if (plan !== null) onceEach(plan.cues).forEach((sound) => cue(sound));
      setShown((s) => ({
        final: next,
        ids,
        stage: null,
        prevChips,
        cards: { ...STILL, epoch: s.cards.epoch + 1 },
      }));
      runSettled();
      return;
    }
    const settledNow = plan.frames.length === 1;
    stageRef.current = settledNow ? null : plan.frames[0]!.stage;
    setShown((s) => ({
      final: next,
      ids,
      stage: stageRef.current,
      prevChips,
      cards: cardMotionOf(from.ids, ids, plan, s.cards.epoch),
    }));
    run(plan);
    if (settledNow) runSettled();
  }, [engine, land, run, fresh, cue, awayRef, runSettled]);

  // Reduce Motion turned on mid-motion: everything lands at once.
  useEffect(() => {
    reduceMotionRef.current = reduceMotion;
    if (reduceMotion) land(true);
  }, [reduceMotion, land]);

  const expect = useCallback(() => {
    land(true);
    expectRef.current = lastRef.current?.engine ?? null;
  }, [land]);

  const leave = useCallback(() => {
    clearTray();
    land(false);
  }, [land, clearTray]);

  const reset = useCallback(() => {
    dropSettled();
    expectRef.current = null;
    clearTray();
    land(false);
  }, [land, clearTray, dropSettled]);

  const isSettled = useCallback(() => stageRef.current === null, []);

  const { final, stage } = shown;
  const view = useMemo(
    () => (final === null ? null : stage ? stageView(final, stage) : final),
    [final, stage]
  );
  const chips = useMemo(() => [...(stage?.chips ?? []), ...trayChips], [stage, trayChips]);
  const unsettled = stage !== null && !stage.settled;

  return {
    view,
    ids: shown.ids,
    cards: shown.cards,
    chips,
    shownChips: final === null ? null : unsettled ? shown.prevChips : final.chips,
    settled: stage === null,
    isSettled,
    animating: stage !== null,
    revealedHands: stage?.result ? stage.revealed : undefined,
    expect,
    leave,
    reset,
    betChip,
    whenSettled,
  };
}
