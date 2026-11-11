/**
 * #3572 review round 3: a seeded random walk through real deals (draws, recycles, moves and
 * Undos at random moments, often while cards are still in flight), run through the screen's own
 * motion rules: `planMotion`, the flight store, `launchMotion` and the real cue clock on fake
 * timers. The sound cues are scheduled as SolitaireScreen schedules them.
 *
 * After every action, and once everything has landed:
 * - no card is left hidden (in flight) once the motion has settled;
 * - every flight ends on the face the state gives its card (what is shown matches the state);
 * - an action plays at most one landing sound (card place or the multi-card move);
 * - flips never outnumber the cards seen to turn face up (a turn counts once it gets within
 *   the flip's 28 ms lead of its edge-on point), so no reveal or draw flips twice.
 *
 * It failed on 023db682 (two landing sounds in one action; more flips than turns).
 */
import {
  applyMove,
  createSeededRng,
  dealGame,
  drawFromStock,
  recycleWaste,
  setRng,
  undo,
  validateMove,
} from "../../../game/solitaire/engine";
import type { Move, SolitaireState } from "../../../game/solitaire/types";
import { SUITS } from "../../../game/solitaire/types";
import { createCardFlightStore } from "../../cards/cardFlights";
import { launchMotion } from "../../cards/launchMotion";
import { cardKey, cueTimes, PEAK } from "../../cards/cardMotion";
import { planMotion, type MotionKind, type MotionLayout } from "../solitaireMotion";
import { createCueClock, type CueTag } from "../../cards/useCueClock";

const LAYOUT: MotionLayout = {
  cardWidth: 40,
  cardHeight: 56,
  gap: 4,
  rowGap: 12,
  boardWidth: 7 * 40 + 6 * 4,
  faceDownStep: 8,
  wasteFanOffset: 12,
  faceUpStep: () => 20,
};

const SEEDS = 40;
const STEPS = 80;

function legalMoves(s: SolitaireState): Move[] {
  const all: Move[] = [{ type: "waste-to-foundation" }];
  for (let to = 0; to < 7; to++) {
    all.push(
      { type: "waste-to-tableau", toCol: to },
      { type: "tableau-to-foundation", fromCol: to }
    );
    for (const suit of SUITS)
      all.push({ type: "foundation-to-tableau", fromSuit: suit, toCol: to });
    for (let from = 0; from < 7; from++) {
      for (let i = 0; i < s.tableau[from]!.length; i++) {
        all.push({ type: "tableau-to-tableau", fromCol: from, fromIndex: i, toCol: to });
      }
    }
  }
  return all.filter((m) => validateMove(s, m));
}

/** Every card's face, and whether it is drawn on the table (the planner's `visible`). */
function faces(s: SolitaireState): Map<string, { faceUp: boolean; shown: boolean }> {
  const m = new Map<string, { faceUp: boolean; shown: boolean }>();
  s.stock.forEach((c, i) =>
    m.set(cardKey(c), { faceUp: c.faceUp, shown: i === s.stock.length - 1 })
  );
  const firstShown = s.waste.length - (s.drawMode === 3 ? 3 : 1);
  s.waste.forEach((c, i) => m.set(cardKey(c), { faceUp: c.faceUp, shown: i >= firstShown }));
  for (const suit of SUITS) {
    const pile = s.foundations[suit];
    pile.forEach((c, i) => m.set(cardKey(c), { faceUp: true, shown: i === pile.length - 1 }));
  }
  for (const col of s.tableau)
    for (const c of col) m.set(cardKey(c), { faceUp: c.faceUp, shown: true });
  return m;
}

interface Sound {
  readonly tag: CueTag;
  readonly group: number;
}

function walk(seed: number, drawMode: 1 | 3): string[] {
  setRng(createSeededRng(seed));
  let x = seed * 7919;
  const rnd = () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
  let state = dealGame(drawMode);
  const store = createCardFlightStore();
  const clock = createCueClock();
  const sounds: Sound[] = [];
  const errors: string[] = [];
  /** Flights that turned face up and came within the flip's lead of their edge-on point. */
  const turnedUp = new Set<number>();
  const landTimers = new Set<number>();
  /** Actions whose engine flip had no turn to go with (see below). */
  const noTurn = new Set<number>();
  let action = 0;

  const noteTurns = () => {
    const now = Date.now();
    for (const f of store.getFlights()) {
      const edge = f.startedAt + f.delayMs + f.durationMs / 2;
      if (!f.fromFaceUp && f.toFaceUp && now >= edge - PEAK.flip) turnedUp.add(f.id);
    }
  };
  /** As FlightCard: each flight lands at its end. */
  const armLandings = () => {
    for (const f of store.getFlights()) {
      if (landTimers.has(f.id)) continue;
      landTimers.add(f.id);
      // Note its turn just before it lands (the walk only samples between actions).
      const end = f.startedAt + f.delayMs + f.durationMs;
      const edge = f.startedAt + f.delayMs + f.durationMs / 2 - PEAK.flip;
      if (!f.fromFaceUp && f.toFaceUp) {
        setTimeout(
          () => {
            if (store.getFlights().some((g) => g.id === f.id)) turnedUp.add(f.id);
          },
          Math.max(0, edge - Date.now())
        );
      }
      setTimeout(() => store.land(f.id), Math.max(0, end - Date.now()));
    }
  };
  const cue = (group: number, tag: CueTag, ms: number) =>
    clock.schedule(() => sounds.push({ tag, group }), ms, group, tag);

  for (let step = 0; step < STEPS; step++) {
    jest.advanceTimersByTime(Math.floor(rnd() * 260));
    noteTurns();
    const r = rnd();
    const moves = legalMoves(state);
    let next: SolitaireState;
    let kind: MotionKind;
    if (r < 0.25 && state.undoStack.length > 0) {
      next = undo(state);
      kind = "undo";
    } else if (r < 0.6 || moves.length === 0) {
      next = state.stock.length > 0 ? drawFromStock(state) : recycleWaste(state);
      kind = "stock";
      if (next === state) continue;
    } else {
      next = applyMove(state, moves[Math.floor(rnd() * moves.length)]!);
      kind = "tap";
    }
    const now = Date.now();
    const a = ++action;
    const plan = planMotion({
      prev: state,
      next,
      kind,
      layout: LAYOUT,
      shownAt: (key) => store.shownAt(key, now),
    });
    const { owesFlip } = launchMotion({
      plan,
      now,
      action: a,
      store,
      clock,
      playPlace: (calledOff) => sounds.push({ tag: "place", group: calledOff }),
    });
    // The cues, as the screen schedules them.
    const c = cueTimes(plan);
    const events = next.events ?? [];
    if (kind === "undo") {
      if (plan.moved > 0) cue(a, "place", c.place);
    } else {
      if (events.includes("cardPlace")) cue(a, "place", c.place);
      if (events.includes("multiCardMove")) cue(a, "multi", c.multi);
      // A draw that brings back a card an Undo had not yet turned face down has no turn but
      // keeps the engine's flip: a known, accepted case (review round 3), left out of the count.
      const turns = plan.flights.some((fl) => !fl.fromFaceUp && fl.toFaceUp);
      if (!turns) noTurn.add(a);
      if (events.includes("cardFlip")) cue(a, "flip", c.flip);
      if (events.includes("cardFan")) cue(a, "fan", c.fan);
    }
    if (owesFlip && !events.includes("cardFlip")) cue(a, "flip", c.flip);
    state = next;
    armLandings();
    const f = faces(state);
    for (const fl of store.getFlights()) {
      const card = f.get(fl.key);
      if (card?.shown && card.faceUp !== fl.toFaceUp) {
        errors.push(
          `step ${step}: ${fl.key} ends ${fl.toFaceUp ? "up" : "down"}, state says otherwise`
        );
      }
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
  const flips = sounds.filter((s) => s.tag === "flip" && !noTurn.has(s.group)).length;
  if (flips > turnedUp.size)
    errors.push(`${flips} flips for ${turnedUp.size} cards turned face up`);
  return errors;
}

beforeEach(() => {
  jest.useFakeTimers({ now: 1_700_000_000_000 });
});
afterEach(() => {
  jest.useRealTimers();
});

it.each([1, 3] as const)(
  "Draw %i: motion and sounds stay consistent through a random walk",
  (drawMode) => {
    const failures: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const e of walk(seed, drawMode)) failures.push(`seed ${seed}: ${e}`);
    }
    expect(failures.slice(0, 10)).toEqual([]);
  }
);
