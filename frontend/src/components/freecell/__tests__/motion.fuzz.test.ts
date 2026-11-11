/**
 * #3573: a seeded random walk through real FreeCell deals (taps, drops, supermoves and Undos at
 * random moments, often while cards are still in flight, and Auto-Complete when it can start),
 * run through the screen's own motion rules: `planFreeCellMotion`, the flight store,
 * `launchMotion` and the real cue clock on fake timers. The sound cues are scheduled as
 * useFreeCellMotion and FreeCellScreen schedule them. As Solitaire's fuzz test (#3572).
 *
 * After every action, and once everything has landed:
 * - every flight ends on its card's slot, at its slot's size, in the state (correct final
 *   positions), and no flight goes nowhere (a zero-distance card never flies);
 * - no card is left hidden (in flight) once the motion has settled;
 * - an action plays at most one landing sound (card place or the multi-card move), and only
 *   while one of its own cards is landing (never one another action now flies elsewhere);
 * - every flight takes at least MIN_SLIDE_MS (a card never snaps, a slide included).
 */
import {
  applyMove,
  autoComplete,
  canAutoComplete,
  dealGame,
  undoMove,
  validateMove,
} from "../../../game/freecell/engine";
import { SUITS, type FreeCellState, type Move } from "../../../game/freecell/types";
import { createCardFlightStore } from "../../cards/cardFlights";
import { cardKey, cueTimes, MIN_SLIDE_MS, type MoveKind } from "../../cards/cardMotion";
import { launchMotion } from "../../cards/launchMotion";
import { createCueClock, type CueTag } from "../../cards/useCueClock";
import { planFreeCellMotion, type FreeCellMotionLayout } from "../freecellMotion";

const LAYOUT: FreeCellMotionLayout = {
  cardWidth: 40,
  cardHeight: 56,
  topCardWidth: 36,
  topCardHeight: 50,
  gap: 4,
  padding: 6,
  rowGap: 10,
  // The board's step depends on the tallest column, as the real one does.
  faceUpStep: (s) => (s.tableau.some((p) => p.length > 12) ? 14 : 20),
};

const SEEDS = 80;
const STEPS = 90;
const AUTO_STEP_MS = 120;

function legalMoves(s: FreeCellState): Move[] {
  const all: Move[] = [];
  for (let from = 0; from < 8; from++) {
    all.push({ type: "tableau-to-foundation", fromCol: from });
    for (let cell = 0; cell < 4; cell++)
      all.push({ type: "tableau-to-freecell", fromCol: from, toCell: cell });
    for (let to = 0; to < 8; to++) {
      for (let i = 0; i < s.tableau[from]!.length; i++) {
        all.push({ type: "tableau-to-tableau", fromCol: from, fromIndex: i, toCol: to });
      }
    }
  }
  for (let cell = 0; cell < 4; cell++) {
    all.push({ type: "freecell-to-foundation", fromCell: cell });
    for (let to = 0; to < 8; to++)
      all.push({ type: "freecell-to-tableau", fromCell: cell, toCol: to });
  }
  for (const suit of SUITS)
    for (let to = 0; to < 8; to++)
      all.push({ type: "foundation-to-tableau", fromSuit: suit, toCol: to });
  return all.filter((m) => validateMove(s, m));
}

/** Where each card is drawn in `s`, and at what size: the planner's slots, worked out again. */
function slots(s: FreeCellState): Map<string, { x: number; y: number; scale: number }> {
  const m = new Map<string, { x: number; y: number; scale: number }>();
  const x = (i: number) => i * (LAYOUT.cardWidth + LAYOUT.gap);
  const top = LAYOUT.topCardWidth / LAYOUT.cardWidth;
  s.freeCells.forEach((c, i) => {
    if (c) m.set(cardKey(c), { x: x(i), y: LAYOUT.padding, scale: top });
  });
  // Every foundation card: a card still flying in when the next one covers it lands under it.
  SUITS.forEach((suit, k) => {
    for (const card of s.foundations[suit]) {
      m.set(cardKey(card), { x: x(4 + k), y: LAYOUT.padding, scale: top });
    }
  });
  const step = LAYOUT.faceUpStep(s);
  const y0 = LAYOUT.padding + LAYOUT.topCardHeight + LAYOUT.rowGap;
  s.tableau.forEach((pile, col) =>
    pile.forEach((c, i) => m.set(cardKey(c), { x: x(col), y: y0 + i * step, scale: 1 }))
  );
  return m;
}

interface Sound {
  readonly tag: CueTag;
  readonly group: number;
}

function walk(seed: number): string[] {
  let x = seed * 7919;
  const rnd = () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
  let state = dealGame(seed);
  const store = createCardFlightStore();
  const clock = createCueClock();
  const sounds: Sound[] = [];
  const errors: string[] = [];
  const landTimers = new Set<number>();
  let action = 0;
  /** True from Auto-Complete's first card: its cards' own sounds stay quiet (the riffle). */
  let riffle = false;

  /** As FlightCard: each flight lands at its end. */
  const armLandings = () => {
    for (const f of store.getFlights()) {
      if (landTimers.has(f.id)) continue;
      landTimers.add(f.id);
      const end = f.startedAt + f.delayMs + f.durationMs;
      setTimeout(() => store.land(f.id), Math.max(0, end - Date.now()));
    }
  };
  /**
   * A landing sound (card place, the multi-card move) for action `group`: one of that action's
   * own cards must still be in the air, landing. A sound credited to an action whose cards
   * another action now flies (to another target) is the #3712 review's bug.
   */
  const landing = (tag: CueTag, group: number) => {
    if (!store.getFlights().some((f) => f.action === group)) {
      errors.push(`action ${group}: its ${tag} plays with none of its own cards in flight`);
    }
    sounds.push({ tag, group });
  };
  const cue = (group: number, tag: CueTag, ms: number) =>
    clock.schedule(
      () =>
        tag === "place" || tag === "multi" ? landing(tag, group) : sounds.push({ tag, group }),
      ms,
      group,
      tag
    );

  const act = (
    kind: MoveKind,
    next: FreeCellState,
    step: number,
    drop?: { x: number; y: number }
  ) => {
    const now = Date.now();
    const a = ++action;
    const plan = planFreeCellMotion({
      prev: state,
      next,
      kind,
      layout: LAYOUT,
      drop,
      shownAt: (key) => store.shownAt(key, now),
    });
    launchMotion({
      plan,
      now,
      action: a,
      store,
      clock,
      playPlace: (calledOff) => {
        if (!riffle) landing("place", calledOff);
      },
    });
    // The cues, as the screen schedules them.
    const c = cueTimes(plan);
    const events = (next.events ?? []).map((e) => e.type);
    if (kind === "undo") {
      if (plan.moved > 0) cue(a, "place", c.place);
    } else if (!riffle && plan.moved > 0) {
      // As the screen: an action that moved nothing (a card sent back before it left) has no
      // landing sound.
      if (events.includes("cardPlace")) cue(a, "place", c.place);
      if (events.includes("supermove")) {
        if (kind === "drop") cue(a, "place", c.place);
        else cue(a, "multi", c.multi);
      }
    }
    state = next;
    armLandings();
    const at = slots(state);
    for (const f of store.getFlights()) {
      const s = at.get(f.key);
      if (s === undefined) {
        errors.push(`step ${step}: ${f.key} flies to a slot the state does not draw`);
        continue;
      }
      if (f.to.x !== s.x || f.to.y !== s.y) {
        errors.push(`step ${step}: ${f.key} lands at ${f.to.x},${f.to.y}, not ${s.x},${s.y}`);
      }
      if ((f.toScale ?? 1) !== s.scale)
        errors.push(`step ${step}: ${f.key} lands at the wrong size`);
    }
    for (const f of plan.flights) {
      if (f.durationMs < MIN_SLIDE_MS)
        errors.push(`step ${step}: ${f.key} flies in ${f.durationMs} ms`);
      // (A drop let go right on its slot still lands, with its card place.)
      if (
        kind !== "drop" &&
        f.from.x === f.to.x &&
        f.from.y === f.to.y &&
        f.fromScale === f.toScale
      ) {
        errors.push(`step ${step}: ${f.key} flies nowhere`);
      }
    }
    return plan;
  };

  for (let step = 0; step < STEPS && !state.isComplete; step++) {
    jest.advanceTimersByTime(Math.floor(rnd() * 260));
    const r = rnd();
    const moves = legalMoves(state);
    if ((r < 0.25 || moves.length === 0) && state.undoStack.length > 0) {
      act("undo", undoMove(state), step);
      continue;
    }
    if (moves.length === 0) break;
    const move = moves[Math.floor(rnd() * moves.length)]!;
    const dropped = rnd() < 0.3;
    const plan = act(
      dropped ? "drop" : "tap",
      applyMove(state, move),
      step,
      dropped ? { x: Math.floor(rnd() * 80) - 40, y: Math.floor(rnd() * 80) - 48 } : undefined
    );
    if (!canAutoComplete(state)) continue;
    // Auto-Complete: its first card waits for the move's landing, then one every 120 ms.
    jest.advanceTimersByTime(Math.max(AUTO_STEP_MS, plan.contactMs));
    riffle = true;
    while (!state.isComplete) {
      const next = autoComplete(state);
      if (next === state) break;
      act("auto", next, step);
      if (!state.isComplete) jest.advanceTimersByTime(AUTO_STEP_MS);
    }
  }
  jest.advanceTimersByTime(5000);
  if (store.getFlights().length > 0) errors.push(`${store.getFlights().length} cards left hidden`);
  const landings = new Map<number, number>();
  for (const s of sounds) {
    if (s.tag === "place" || s.tag === "multi")
      landings.set(s.group, (landings.get(s.group) ?? 0) + 1);
  }
  for (const [g, n] of landings) if (n > 1) errors.push(`action ${g}: ${n} landing sounds`);
  return errors;
}

beforeEach(() => {
  jest.useFakeTimers({ now: 1_700_000_000_000 });
});
afterEach(() => {
  jest.useRealTimers();
});

it("motion and sounds stay consistent through a random walk", () => {
  const failures: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    for (const e of walk(seed)) failures.push(`seed ${seed}: ${e}`);
  }
  expect(failures.slice(0, 10)).toEqual([]);
});
