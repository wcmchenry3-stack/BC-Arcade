/**
 * Blackjack's card and chip motion on the screen (#3581): runs the timelines `planMotion`
 * plans (blackjackMotion.ts) on a cancellable cue clock, and tells the felt what to draw.
 *
 * - Only the player's actions move: the screen calls `expect()` before it applies one, and the
 *   change it makes is replayed. Anything else (the restored game at mount, New Game, a new
 *   hand's betting) is drawn at once, silently: nothing replays on restore, resume or return.
 * - Input stays live (#3575): `complete()` lands everything still moving at once, and the screen
 *   calls it before every action, so a tap is never dropped and never waits.
 * - With Reduce Motion nothing moves, but each of the action's sounds still plays once, in its
 *   timeline order, `REDUCE_MOTION_SOUND_GAP_MS` apart (the first at the instant), so they do not
 *   stack (owner decision, #3751). While the player is away nothing moves and nothing plays.
 *   Reduce Motion turned on, or the player leaving (`leave()`), mid-motion lands everything at
 *   once; the sounds still due then are dropped, but a result chime still due plays once, now.
 * - A tap or the next action drops the spaced sounds not yet played, but a result chime still due
 *   plays once at once (as for a motion, #3720). The round is settled at once, so the toasts, the
 *   victory screen and the out-of-chips card do not wait for them.
 * - Every pending cue is cancelled on New Game (`reset()`) and on unmount (`useCueClock`).
 * - The run's cues (#3582, #3812): one per round, comeback over milestone, handed in with the
 *   toast (`whenSettled(toast, { cue })`) so one queue owns both: the cue plays from the very
 *   callback that shows the toast, as the round settles (after every hand's chips), or under Reduce
 *   Motion 100 ms after the last spaced sound. A round cut short (a tap, Rebet, leaving, New Game)
 *   drops it: its toast still shows, but the cue would stack on the chime played at once or on the
 *   next deal. A plan with one frame settles at once: the toast and the cue play together, then.
 *
 * JS runs only at a stage's start (a handful per action), never per frame: the cards' and
 * chips' motion runs on the UI thread (FeltCard, ChipSprite), and so does a natural's moment
 * (#3621, NaturalMoment.tsx), handed the time it started; any landing makes it static.
 */
import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { toViewState, type EngineState } from "../../game/blackjack/engine";
import type { BlackjackState } from "../../game/blackjack/types";
import { useCueClock, type CueClock } from "../cards/useCueClock";
import {
  assignCardIds,
  SKIP_HOLD_MS,
  CHIP_BET_MS,
  feltSignature,
  naturalEdges,
  nextChipId,
  NO_NATURALS,
  planMotion,
  RESULT_CUES,
  stageView,
  type CardIds,
  type ChipShown,
  type NaturalEdges,
  type RunCue,
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

/** The naturals the felt marks, and the player's natural moment while it plays (#3621). */
export interface FeltNatural extends NaturalEdges {
  /**
   * When the player's natural moment (lift, glint, sweep) started, on the JS clock; null: none is
   * playing, the edges are static (Reduce Motion, a tap that landed it, a restore, the player away).
   */
  readonly since: number | null;
}

export interface BlackjackMotionInput {
  readonly engine: EngineState | null;
  readonly reduceMotion: boolean;
  /** The player is away (`usePauseWhileAway`): no cue plays. */
  readonly awayRef: { readonly current: boolean };
  /**
   * Plays a sound (and its moment's effect: a flash). `skipped`: the result's
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
  /**
   * True when nothing is moving and the felt shows the game as it is now. Derived in render: in
   * the render that commits an action, before the motion has planned it, it is already false
   * (#3720 review), so nothing keyed to it (the out-of-chips card, the victory screen) shows early.
   */
  readonly settled: boolean;
  /**
   * Reduce Motion's spaced sounds are still due (#3751). The round is settled already: only the
   * felt's tap, which lands them, stays on for it.
   */
  readonly sounding: boolean;
  /** A stage is shown with motion (the banner and the tags pop in). */
  readonly animating: boolean;
  /** Split hands whose own result shows so far; undefined: every hand's. */
  readonly revealedHands: number | undefined;
  /** The dealer's total is "?" (the hole card has not finished turning); undefined: as drawn. */
  readonly dealerConcealed: boolean | undefined;
  /** The naturals marked, and the natural moment playing (#3621). */
  readonly natural: FeltNatural;
  /**
   * Runs the player's action `run`, and replays the change it makes. Anything still moving lands
   * at once first (input stays live). A result still playing out is shown first (owner decision,
   * #3720): the rest of the dealer's cards, the banner with its chime, the chips and the count,
   * held `SKIP_HOLD_MS` before `run` runs. During that beat one more action waits for it.
   */
  act(run: () => void): void;
  /** A tap on the felt mid-motion: everything lands at once (a result, then its beat). */
  skip(): void;
  /** The player left: everything still moving lands at once, silently. */
  leave(): void;
  /** New Game: every cue goes, nothing plays. */
  reset(): void;
  /** A chip from the tray into the betting circle, with its sound. */
  betChip(): void;
  /**
   * Runs `fn` (a toast) once the round is settled (at once when it is). `cue` (#3582, #3812): the
   * round just played crossed a milestone or made a comeback; its sound plays from the same
   * callback as `fn`, as the round settles. One per round, comeback over milestone; dropped when
   * the round is cut short (`fn` still runs), and for a round no action played (a restore).
   */
  whenSettled(fn: () => void, opts?: { readonly cue?: RunCue }): void;
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
  /**
   * What the felt shows at rest when it is not the whole of `final`: a split hand's second card
   * held back until its turn (owner decision, #3720). Null: all of `final`.
   */
  readonly rest: Stage | null;
  /** The felt signature of `final` (null before a game). */
  readonly sig: string | null;
  /** When the player's natural moment started (JS clock), while the motion runs; else null. */
  readonly momentSince: number | null;
}

const NO_IDS: CardIds = { dealer: [], hands: [] };
/** The cue clock's groups: the action in motion, and the tray's chips (betting). */
const MOTION = 1;
const TRAY = 2;
/** The beat after a result cut short, and the action that waits for it. */
const HOLD = 3;
/** The sounds of an action under Reduce Motion, spaced out (#3751). */
const SPACED = 4;
/** Under Reduce Motion, the gap between an action's sounds (owner decision, #3751). */
export const REDUCE_MOTION_SOUND_GAP_MS = 100;
const NONE: ReadonlySet<string> = new Set();
const STILL: CardMotion = { dealing: NONE, flipping: NONE, slideMs: 0, epoch: 0 };

/** Of two run cues for one round, the one that plays (#3582): a comeback over a milestone. */
const RUN_CUE_RANK: Record<RunCue, number> = { milestone: 1, comeback: 2 };

/** Each sound of `cues` once, in order: an action's sounds under Reduce Motion (spaced, #3751). */
function onceEach(cues: readonly { readonly sound: SoundCue }[]): SoundCue[] {
  return [...new Set(cues.map((c) => c.sound))];
}

/** The ids of the cards drawn at rest: each hand's but those it holds back. */
function drawnIds(ids: CardIds, held: readonly number[]): string[] {
  return [...ids.dealer, ...ids.hands.flatMap((h, i) => h.slice(0, h.length - (held[i] ?? 0)))];
}

/**
 * How the cards of `ids` move in `plan`: the ones not drawn before (`before`) are dealt as they
 * are first drawn, and the hole card may turn.
 */
function cardMotionOf(
  before: readonly string[],
  ids: CardIds,
  plan: Timeline,
  epoch: number
): CardMotion {
  const had = new Set(before);
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
  const betChip = useCallback(() => {
    playChip();
    if (reduceMotionRef.current) return;
    const chip: ChipShown = {
      id: nextChipId(),
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
function useSettledFns(stageRef: { readonly current: Stage | null }) {
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

const NOTHING_SHOWN: Shown = {
  final: null,
  ids: NO_IDS,
  stage: null,
  prevChips: 0,
  cards: STILL,
  sig: null,
  rest: null,
  momentSince: null,
};

/** A ref to the latest `value`, updated before paint (and before later layout effects). */
function useLatestRef<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

/**
 * The beat after a result cut short (owner decision, #3720): the result shows at once and holds
 * `SKIP_HOLD_MS` before the action that cut it short runs. Cancelled on leaving, New Game and
 * unmount (the clock).
 */
function useSkipHold(input: {
  readonly clock: CueClock;
  readonly stageRef: { readonly current: Stage | null };
  readonly resultRef: { readonly current: boolean };
  readonly land: (chime: boolean) => void;
  readonly lastRef: { readonly current: Last | null };
  readonly expectRef: { current: EngineState | null };
}) {
  const { clock, stageRef, resultRef, land, lastRef, expectRef } = input;
  const holdingRef = useRef(false);
  const queuedRef = useRef<(() => void) | null>(null);
  /** Runs `run` as the player's action: the change it makes is replayed. */
  const runNow = useCallback(
    (run: () => void) => {
      expectRef.current = lastRef.current?.engine ?? null;
      run();
    },
    [expectRef, lastRef]
  );
  /** Lands everything; a result shows with its chime, and holds. */
  const skip = useCallback(() => {
    const stage = stageRef.current;
    if (stage === null) {
      // Nothing moves, but spaced Reduce Motion sounds may be due (#3751).
      land(true);
      return;
    }
    // A beat only for a result not yet shown: once the banner shows, the chips land and the
    // action runs at once (#3720 round 2).
    const result = resultRef.current && !stage.result;
    land(true);
    if (!result || holdingRef.current) return;
    holdingRef.current = true;
    const end = () => {
      holdingRef.current = false;
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued !== null) runNow(queued);
    };
    clock.schedule(end, SKIP_HOLD_MS, HOLD);
  }, [clock, stageRef, resultRef, land, runNow]);
  const act = useCallback(
    (run: () => void) => {
      if (!holdingRef.current) skip();
      if (holdingRef.current) {
        queuedRef.current ??= run;
        return;
      }
      runNow(run);
    },
    [skip, runNow]
  );
  const dropHold = useCallback(() => {
    clock.cancelGroup(HOLD);
    holdingRef.current = false;
    queuedRef.current = null;
  }, [clock]);
  return { act, skip, dropHold };
}

interface Last {
  readonly engine: EngineState;
  readonly view: BlackjackState;
  readonly ids: CardIds;
  readonly sig: string;
}

/**
 * Runs an action's timeline on the clock (`run`), and lands it at once (`land`). Owns the result's
 * chime while it is still due, so a landing plays it once.
 */
function useTimelineRunner(input: {
  readonly clock: CueClock;
  readonly cue: (sound: SoundCue, skipped?: boolean) => void;
  readonly setShown: React.Dispatch<React.SetStateAction<Shown>>;
  readonly stageRef: { current: Stage | null };
}) {
  const { clock, cue, setShown, stageRef } = input;
  const { whenSettled: queueSettled, runSettled, dropSettled } = useSettledFns(stageRef);
  /** The result's chime, while it is still due. */
  const chimeRef = useRef<SoundCue | null>(null);
  /** The result's chime, while it is still due among the spaced sounds (Reduce Motion, #3751). */
  const spacedChimeRef = useRef<SoundCue | null>(null);
  /** Spaced sounds are still due: a tap on the felt lands them (#3751). */
  const [sounding, setSounding] = useState(false);
  /** The spaced sounds: when the first played, how many there are, and how many are still due. */
  const spacedRef = useRef({ start: 0, count: 0, left: 0 });
  /**
   * Where the round's run cue plays (#3582): as the motion settles, after the spaced sounds, or
   * nowhere (no action settled a round, or it was cut short). And the cue, once one is due.
   */
  const runSlotRef = useRef<"motion" | "spaced" | null>(null);
  const runCueRef = useRef<RunCue | null>(null);
  const dropRunCue = useCallback(() => {
    runSlotRef.current = null;
    runCueRef.current = null;
  }, []);
  /** Plays the round's run cue, if one is due: once. */
  const playRunCue = useCallback(() => {
    const due = runCueRef.current;
    dropRunCue();
    if (due !== null) cue(due);
  }, [cue, dropRunCue]);

  /**
   * Drops the spaced sounds not yet played. `chime`: a result chime still due among them plays
   * once, now, with no effect (as a skipped motion's does, #3720).
   */
  const dropSpaced = useCallback(
    (chime: boolean) => {
      clock.cancelGroup(SPACED);
      spacedRef.current.left = 0;
      setSounding(false);
      const due = spacedChimeRef.current;
      spacedChimeRef.current = null;
      if (chime && due !== null) cue(due, true);
    },
    [clock, cue]
  );

  /** Plays `play` as the next spaced sound, `REDUCE_MOTION_SOUND_GAP_MS` after the last. */
  const spaceNext = useCallback(
    (play: () => void) => {
      const spaced = spacedRef.current;
      const at = spaced.start + spaced.count * REDUCE_MOTION_SOUND_GAP_MS - Date.now();
      spaced.count += 1;
      spaced.left += 1;
      const once = () => {
        spaced.left -= 1;
        if (spaced.left === 0) setSounding(false);
        play();
      };
      clock.schedule(once, at, SPACED);
      if (spaced.left > 0) setSounding(true);
    },
    [clock]
  );

  /**
   * Plays `sounds` in order, `REDUCE_MOTION_SOUND_GAP_MS` apart, the first at once (#3751).
   * `chime`: the one among them that is the round's result chime, if any. `settles`: the action
   * settled the round, so its run cue (#3582) joins the end of the queue.
   */
  const spread = useCallback(
    (sounds: readonly SoundCue[], chime: SoundCue | null, settles: boolean) => {
      spacedChimeRef.current = chime !== null && sounds.includes(chime) ? chime : null;
      spacedRef.current = { start: Date.now(), count: 0, left: 0 };
      runSlotRef.current = settles ? "spaced" : null;
      sounds.forEach((sound) =>
        spaceNext(() => {
          if (sound === spacedChimeRef.current) spacedChimeRef.current = null;
          cue(sound);
        })
      );
    },
    [cue, spaceNext]
  );

  /**
   * Arms the round's run cue (#3582): one per round, comeback over milestone. It plays as the
   * motion settles (`settle`), or under Reduce Motion as the next spaced sound after the chips.
   */
  const armRunCue = useCallback(
    (sound: RunCue) => {
      const slot = runSlotRef.current;
      const due = runCueRef.current;
      if (slot === null || (due !== null && RUN_CUE_RANK[due] >= RUN_CUE_RANK[sound])) return;
      runCueRef.current = sound;
      if (slot === "spaced" && due === null) spaceNext(playRunCue);
    },
    [spaceNext, playRunCue]
  );

  /**
   * Runs `fn` once the round is settled, and plays the run cue handed in with it from the same
   * callback (#3812): the settled queue owns the cue, so the two cannot drift apart. A round that
   * has settled already (a one-frame plan, #3812) plays the cue now, with `fn`; a round no action
   * played (a restore) has no slot, so it plays none.
   */
  const whenSettled = useCallback(
    (fn: () => void, opts?: { readonly cue?: RunCue }) => {
      if (opts?.cue !== undefined) armRunCue(opts.cue);
      queueSettled(fn);
      if (stageRef.current === null && runSlotRef.current === "motion") playRunCue();
    },
    [armRunCue, queueSettled, playRunCue, stageRef]
  );
  /** The motion settled on its own: the toasts, then the run's cue with them (#3582). */
  const settle = useCallback(() => {
    runSettled();
    playRunCue();
  }, [runSettled, playRunCue]);

  /**
   * Lands everything at once. `chime`: the result's chime, if still due, plays now. `always`: a
   * new epoch even when no stage is running (a pop-in may still be).
   */
  const land = useCallback(
    (chime: boolean, always = false) => {
      // A round cut short drops its run cue: it would stack on the chime or the next deal (#3582).
      dropRunCue();
      dropSpaced(chime);
      clock.cancelGroup(MOTION);
      const due = chimeRef.current;
      chimeRef.current = null;
      const moving = stageRef.current !== null;
      if (!moving && !always) return;
      stageRef.current = null;
      if (moving && chime && due !== null) cue(due, true);
      if (moving) runSettled();
      // `always` (Reduce Motion turned on): every card is drawn, none held back any more.
      setShown((s) => ({
        ...s,
        stage: null,
        rest: always ? null : s.rest,
        cards: { ...STILL, epoch: s.cards.epoch + 1 },
        // A natural's moment lands too: its edges stay, static (#3621).
        momentSince: null,
      }));
    },
    [clock, cue, dropRunCue, dropSpaced, runSettled, setShown, stageRef]
  );

  /** Runs an action's timeline: each stage and each sound at its time. */
  const run = useCallback(
    (plan: Timeline) => {
      const lastFrame = plan.frames[plan.frames.length - 1]!;
      runSlotRef.current = plan.resultAt !== null ? "motion" : null;
      for (const f of plan.frames.slice(1)) {
        const isLast = f === lastFrame;
        // The player's natural moment starts with its stage, in the same render (#3621).
        const moment = f.at === plan.momentAt;
        const show = () => {
          stageRef.current = isLast ? null : f.stage;
          const since = moment && !isLast ? Date.now() : null;
          setShown((s) => ({
            ...s,
            stage: stageRef.current,
            momentSince: isLast ? null : (since ?? s.momentSince),
          }));
          // The toasts, and the run's cue with them (#3582): after every hand's chips.
          if (isLast) settle();
        };
        clock.schedule(show, f.at, MOTION);
      }
      for (const c of plan.cues) {
        // The result's chime: a natural's sting before the result counts (`chimeAt`, #3621).
        const isChime = RESULT_CUES.includes(c.sound) && c.at === plan.chimeAt;
        if (isChime) chimeRef.current = c.sound;
        const play = () => {
          if (isChime) chimeRef.current = null;
          cue(c.sound);
        };
        clock.schedule(play, c.at, MOTION);
      }
    },
    [clock, cue, setShown, stageRef, settle]
  );
  return { land, run, spread, whenSettled, runSettled, dropSettled, sounding };
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
  /** The timeline running shows a result (a skip shows it, then holds). */
  const resultRef = useRef(false);
  /** The cards each hand drawn holds back (a split's second card), by hand. */
  const heldRef = useRef<readonly number[]>([]);
  const nextIdRef = useRef(0);
  // Read when a cue runs or an action lands, never captured (#3712 review): a queued cue must see
  // Reduce Motion turned on since, and the latest sounds. Updated before the engine's effect below
  // reads them (#3720 review).
  const reduceMotionRef = useLatestRef(reduceMotion);
  const playCueRef = useLatestRef(playCue);

  const fresh = useCallback(() => `c${++nextIdRef.current}`, []);
  /** Plays a cue, unless the player is away. */
  const cue = useCallback(
    (sound: SoundCue, skipped = false) => {
      if (!awayRef.current) playCueRef.current(sound, skipped);
    },
    [awayRef, playCueRef]
  );
  const playChip = useCallback(() => cue("chipBet"), [cue]);
  const { trayChips, betChip, clearTray } = useTrayChips(clock, reduceMotionRef, playChip);

  const runner = useTimelineRunner({ clock, cue, setShown, stageRef });
  const { land, run, spread, whenSettled, runSettled, dropSettled, sounding } = runner;

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
    const heldBefore = heldRef.current;
    const plan = from === null ? null : planMotion(from.view, next, heldBefore);
    const prevChips = last?.view.chips ?? next.chips;
    if (from === null || plan === null || reduceMotionRef.current || awayRef.current) {
      // At once, every card drawn. An action's sounds still play, each once, in order and
      // `REDUCE_MOTION_SOUND_GAP_MS` apart (#3751); none while away.
      if (plan !== null && !awayRef.current) {
        const chime = plan.cues.find((c) => RESULT_CUES.includes(c.sound) && c.at === plan.chimeAt);
        spread(onceEach(plan.cues), chime?.sound ?? null, plan.resultAt !== null);
      }
      heldRef.current = [];
      resultRef.current = false;
      setShown((s) => ({
        final: next,
        ids,
        stage: null,
        prevChips,
        cards: { ...STILL, epoch: s.cards.epoch + 1 },
        sig,
        rest: null,
        momentSince: null,
      }));
      runSettled();
      return;
    }
    heldRef.current = plan.held;
    resultRef.current = plan.resultAt !== null;
    const rest = plan.held.some((n) => n > 0) ? plan.frames[plan.frames.length - 1]!.stage : null;
    const settledNow = plan.frames.length === 1;
    stageRef.current = settledNow ? null : plan.frames[0]!.stage;
    setShown((s) => ({
      final: next,
      ids,
      stage: stageRef.current,
      prevChips,
      cards: cardMotionOf(drawnIds(from.ids, heldBefore), ids, plan, s.cards.epoch),
      sig,
      rest,
      momentSince: null,
    }));
    run(plan);
    if (settledNow) runSettled();
  }, [engine, land, run, spread, fresh, awayRef, runSettled, reduceMotionRef]);

  // Reduce Motion turned on mid-motion: everything lands at once (a pop-in still running too).
  // Every card drawn too: a split hand's card held back for its turn shows (#3720 round 2).
  useEffect(() => {
    if (!reduceMotion) return;
    heldRef.current = [];
    land(true, true);
  }, [reduceMotion, land]);

  const { act, skip, dropHold } = useSkipHold({
    clock,
    stageRef,
    resultRef,
    land,
    lastRef,
    expectRef,
  });

  const leave = useCallback(() => {
    dropHold();
    clearTray();
    land(false);
  }, [land, clearTray, dropHold]);

  const reset = useCallback(() => {
    dropHold();
    dropSettled();
    expectRef.current = null;
    clearTray();
    land(false);
  }, [land, clearTray, dropSettled, dropHold]);

  const engineSig = useMemo(
    () => (engine === null ? null : feltSignature(toViewState(engine))),
    [engine]
  );
  const { final, stage, rest } = shown;
  const drawn = stage ?? rest;
  const view = useMemo(
    () => (final === null ? null : drawn ? stageView(final, drawn) : final),
    [final, drawn]
  );
  const chips = useMemo(() => [...(stage?.chips ?? []), ...trayChips], [stage, trayChips]);
  const unsettled = stage !== null && !stage.settled;
  // At rest, the settled round's naturals (a restore shows them static, with no motion).
  const edges = drawn ? drawn.natural : final === null ? NO_NATURALS : naturalEdges(final);
  const since = stage !== null && edges.player ? shown.momentSince : null;
  const natural = useMemo<FeltNatural>(
    () => ({ player: edges.player, dealer: edges.dealer, since }),
    [edges.player, edges.dealer, since]
  );

  return {
    view,
    ids: shown.ids,
    cards: shown.cards,
    chips,
    shownChips: final === null ? null : unsettled ? shown.prevChips : final.chips,
    settled: stage === null && (engineSig === null || shown.sig === engineSig),
    sounding,
    animating: stage !== null,
    revealedHands: stage?.result ? stage.revealed : undefined,
    dealerConcealed: drawn ? !drawn.holeCounted : undefined,
    natural,
    act,
    skip,
    leave,
    reset,
    betChip,
    whenSettled,
  };
}
