/**
 * Hearts replay recording (#3283, epic #3273): the production form of the
 * dev-only hand log (`debugLog.ts`), minus `DebugPosition` (large, and
 * rebuildable from the deal and the plays).
 *
 * `game_started` carries the seats and the preset (`gameStartedData`). Each hand
 * then records, through the shared GameRecorder (`useGameRecorder`), one event
 * per thing that decides the score:
 *
 *   hand_dealt      {h, d, c}              the four starting hands
 *   pass_committed  {h, p, r?}             the three cards each seat passed
 *   trick_completed {h, n, l, c, w, pt?, hb?, q?, r?}   one trick, all four plays
 *   hand_scored     {h, s, t, m?}          the hand's deltas and the running totals
 *
 * (plus the recorder's envelope `v`, `unit`, `t_ms`). The wire form is
 * specified in backend/hearts/events.py and docs/games/hearts.md ("Replay
 * recording"). Cards are two characters, rank then suit (`"QS"`, `"TC"`), and a
 * card list is its codes joined with no separator (`"QSAH2C"`): the four hands
 * of a deal are 112 characters, not 270. What can be derived is not recorded:
 * the seat of a play is `(lead + index) % 4`, a received pass is what the seat
 * `d` away passed, the legality of every play follows from the hands.
 *
 * Cost → performance → data:
 *  - CPU principles come from the decision the AI already returned
 *    (`explainCardToPlay` / `explainCardsToPass`); no AI work is added. They are
 *    recorded as the number `n` of `P<n>-...`, one digit.
 *  - Building an event is a few string joins over 4-13 cards; nothing is
 *    serialised or stored here. The recorder measures and saves at an idle
 *    moment, never inside a gesture or animation callback.
 *  - One recorder unit, and so one storage write, per deal, per pass and per
 *    trick (`hand_scored` rides on the 13th trick). A trick is handed to the
 *    recorder only after its collect animation (`settle`), or at once when it
 *    ends the hand (no animation), so the save never competes with the animation.
 *  - `flush` hands over everything waiting and saves it synchronously: the
 *    screen calls it when it leaves the foreground, so a kill loses nothing more.
 *  - With the kill switch off (`enabled()` false) every method returns before it
 *    builds anything.
 *
 * Unit numbers follow from the hand and the trick, not from a counter
 * (`dealUnit`, `passUnit`, `trickUnit`), so a game resumed after a kill carries
 * on from its restored state: the units are passed to `beginUnit(n)` explicitly
 * (GAME-CONTRACT §2.10). What a kill loses is the unit still waiting (the trick
 * in its animation); a reader sees the gap in `n` / `h`.
 */

import { isRecordingEnabled, type EventTypeOf } from "../_shared/eventQueueConfig";
import { detectMoon, isQueenOfSpades } from "./engine";
import type { PrincipleId } from "./conservative/terms";
import { resolvePersona } from "./types";
import type { AiPreset, Card, HeartsState, PassDirection, TrickCard } from "./types";

/** The points that end the game (the engine's `isGameOver`). */
export const TARGET_SCORE = 100;

/** The pass direction of hand `h` is `PASS_DIRECTIONS[(h - 1) % 4]`; `d` on the wire is the index. */
const PASS_DIRECTIONS: readonly PassDirection[] = ["left", "right", "across", "none"];

/** Recorder units per hand: deal, pass, then 13 tricks. */
const UNITS_PER_HAND = 15;

/** The unit of hand `h`'s deal. */
export function dealUnit(h: number): number {
  return (h - 1) * UNITS_PER_HAND + 1;
}

/** The unit of hand `h`'s pass. */
export function passUnit(h: number): number {
  return (h - 1) * UNITS_PER_HAND + 2;
}

/** The unit of trick `n` (1..13) of hand `h`; the last one also holds `hand_scored`. */
export function trickUnit(h: number, n: number): number {
  return (h - 1) * UNITS_PER_HAND + 2 + n;
}

/**
 * Units that wait for a game session (the deal and pass of hand 1 are made
 * before the first card opens one) are kept up to this many; past it, new ones
 * are dropped (a clean prefix). A real game holds at most a few.
 */
const MAX_WAITING_UNITS = 32;

// ── Cards ───────────────────────────────────────────────────────────────────

const RANK_CHAR = "?A23456789TJQK";
const SUIT_CHAR: Readonly<Record<Card["suit"], string>> = {
  clubs: "C",
  diamonds: "D",
  hearts: "H",
  spades: "S",
};

/** `"QS"`: rank (`2`-`9`, `T`, `J`, `Q`, `K`, `A`) then suit (`C`, `D`, `H`, `S`). */
export function cardCode(card: Card): string {
  return RANK_CHAR.charAt(card.rank) + SUIT_CHAR[card.suit];
}

/** A card list as its codes joined with no separator: `"QSAH2C"`. */
export function cardsCode(cards: readonly Card[]): string {
  let out = "";
  for (const card of cards) out += cardCode(card);
  return out;
}

/**
 * The cards of a card list code, for tests and offline tooling.
 * @internal No production caller (knip --production, #3126).
 */
export function decodeCards(code: string): Card[] {
  const suits: Record<string, Card["suit"]> = {
    C: "clubs",
    D: "diamonds",
    H: "hearts",
    S: "spades",
  };
  const cards: Card[] = [];
  for (let i = 0; i < code.length; i += 2) {
    const rank = RANK_CHAR.indexOf(code.charAt(i));
    const suit = suits[code.charAt(i + 1)];
    if (rank < 1 || suit === undefined) throw new Error(`Not a card: ${code.slice(i, i + 2)}`);
    cards.push({ rank: rank as Card["rank"], suit });
  }
  return cards;
}

// ── Principles ──────────────────────────────────────────────────────────────

/** The number `n` of the conservative CPU's `P<n>-...` principle (docs/hearts/CONSERVATIVE_AI.md §2.2). */
const PRINCIPLE_NUMBER: Readonly<Record<PrincipleId, number>> = {
  "P1-DUCK": 1,
  "P2-FREE-TRICK": 2,
  "P3-SHED": 3,
  "P4-DANGER": 4,
  "P5-QUEEN": 5,
  "P6-DISCARD": 6,
  "P7-MOON-GUARD": 7,
  "P8-PASS": 8,
  "P9-EXIT": 9,
};

/** A principle's number on the wire; 0 for none (the human, a legacy persona, a forced play). */
export function principleNumber(principle: PrincipleId | null | undefined): number {
  return principle ? PRINCIPLE_NUMBER[principle] : 0;
}

// ── Event data (without the recorder's envelope) ────────────────────────────

/** The seats and preset of a new game: `game_started`'s data. `seats` are `"human"` or the persona. */
export function gameStartedData(preset: AiPreset): Record<string, unknown> {
  const seats = [0, 1, 2, 3].map((seat) => (seat === 0 ? "human" : resolvePersona(preset, seat)));
  return { initial_score: 0, preset, target: TARGET_SCORE, seats };
}

/** `hand_dealt` of a hand just dealt: `state.playerHands` are the four starting hands. */
export function handDealtData(state: HeartsState): Record<string, unknown> {
  return {
    h: state.handNumber,
    d: PASS_DIRECTIONS.indexOf(state.passDirection),
    c: state.playerHands.map(cardsCode),
  };
}

/**
 * `pass_committed`: `state.passSelections` are the cards each seat chose;
 * `principles[seat]` the principle behind each of that seat's cards (the CPU's),
 * left out where no seat has one.
 */
export function passCommittedData(
  state: HeartsState,
  principles: readonly (readonly (PrincipleId | null)[])[]
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    h: state.handNumber,
    p: state.passSelections.map(cardsCode),
  };
  const r = [0, 1, 2, 3].map((seat) => {
    const numbers = (principles[seat] ?? []).map(principleNumber);
    return numbers.some((n) => n > 0) ? numbers : 0;
  });
  if (r.some((entry) => entry !== 0)) data.r = r;
  return data;
}

function trickPoints(cards: readonly Card[]): number {
  let points = 0;
  for (const card of cards) {
    if (card.suit === "hearts") points += 1;
    else if (isQueenOfSpades(card)) points += 13;
  }
  return points;
}

/**
 * `trick_completed` for `trick` (in play order), played from `prev`, which
 * resolved to `next`. `principles[seat]` is the principle behind that seat's
 * play (0: none).
 */
export function trickCompletedData(
  prev: HeartsState,
  trick: readonly TrickCard[],
  next: HeartsState,
  principles: readonly number[]
): Record<string, unknown> {
  const cards = trick.map((tc) => tc.card);
  const data: Record<string, unknown> = {
    h: prev.handNumber,
    n: prev.tricksPlayedInHand + 1,
    l: trick[0]?.playerIndex ?? 0,
    c: cardsCode(cards),
    w: next.currentLeaderIndex,
  };
  const points = trickPoints(cards);
  if (points > 0) data.pt = points;
  if (next.heartsBroken) data.hb = 1;
  if (cards.some(isQueenOfSpades)) data.q = 1;
  const r = trick.map((tc) => principles[tc.playerIndex] ?? 0);
  if (r.some((n) => n > 0)) data.r = r;
  return data;
}

/** `hand_scored` of the hand `next` just finished (its `scoreHistory` ends with the hand's deltas). */
export function handScoredData(next: HeartsState): Record<string, unknown> {
  const data: Record<string, unknown> = {
    h: next.handNumber,
    s: [...(next.scoreHistory[next.scoreHistory.length - 1] ?? [0, 0, 0, 0])],
    t: [...next.cumulativeScores],
  };
  const moon = detectMoon(next.wonCards);
  if (moon !== null) data.m = moon;
  return data;
}

// ── Recording ───────────────────────────────────────────────────────────────

/** The Hearts event types the recorder takes from this module. */
export type ReplayEventType = Extract<
  EventTypeOf<"hearts">,
  "hand_dealt" | "pass_committed" | "trick_completed" | "hand_scored"
>;

/** What `HeartsReplay` records into: `useGameRecorder("hearts")` plus whether a game session is open. */
export interface ReplaySink {
  /** Whether a game session is open to take units now. */
  isOpen(): boolean;
  beginUnit(n: number): number;
  record(type: ReplayEventType, data: Record<string, unknown>): void;
  closeUnit(): void;
  /** Save everything the recorder holds, synchronously. */
  flush(): void;
}

interface Unit {
  readonly n: number;
  readonly events: readonly {
    readonly type: ReplayEventType;
    readonly data: Record<string, unknown>;
  }[];
}

export class HeartsReplay {
  /** Complete units waiting for a game session to hand to the recorder. */
  private ready: Unit[] = [];
  /** The trick whose collect animation is still running. */
  private deferred: Unit | null = null;
  /** The principle behind each seat's play in the trick in progress. */
  private notes: number[] = [0, 0, 0, 0];

  constructor(
    private readonly sink: ReplaySink,
    private readonly enabled: () => boolean = () => isRecordingEnabled("hearts")
  ) {}

  /** The principle behind a CPU seat's play, from the decision the AI already made. */
  notePlay(seat: number, principle: PrincipleId | null): void {
    if (!this.enabled()) return;
    this.notes[seat] = principleNumber(principle);
  }

  /** A hand was dealt (`state` is the fresh deal). */
  dealt(state: HeartsState): void {
    if (!this.enabled()) return;
    this.add({
      n: dealUnit(state.handNumber),
      events: [{ type: "hand_dealt", data: handDealtData(state) }],
    });
    this.publish();
  }

  /** The pass was committed; `state` still holds the selections, `principles` the CPU's per seat. */
  passed(state: HeartsState, principles: readonly (readonly (PrincipleId | null)[])[]): void {
    if (!this.enabled()) return;
    this.add({
      n: passUnit(state.handNumber),
      events: [{ type: "pass_committed", data: passCommittedData(state, principles) }],
    });
    this.publish();
  }

  /**
   * A trick was played: `prev` is the state before its last card, `next` after.
   * A trick that ends the hand (`next` is no longer "playing") is complete with
   * `hand_scored` and goes to the recorder now; any other waits for `settle`.
   */
  trick(prev: HeartsState, trick: readonly TrickCard[], next: HeartsState): void {
    if (!this.enabled()) return;
    const events: Unit["events"] = [
      {
        type: "trick_completed",
        data: trickCompletedData(prev, trick, next, this.notes),
      },
    ];
    this.notes = [0, 0, 0, 0];
    const handOver = next.phase !== "playing";
    const unit: Unit = {
      n: trickUnit(prev.handNumber, prev.tricksPlayedInHand + 1),
      events: handOver ? [...events, { type: "hand_scored", data: handScoredData(next) }] : events,
    };
    this.settle();
    if (handOver) {
      this.add(unit);
      this.publish();
    } else {
      this.deferred = unit;
    }
  }

  /** The trick's collect animation is over: hand it to the recorder, which saves it at the next idle moment. */
  settle(): void {
    const unit = this.deferred;
    if (unit === null) return;
    this.deferred = null;
    this.add(unit);
    this.publish();
  }

  /**
   * Hand the waiting units to the recorder, if a game session is open. Called
   * after each unit is complete and once a session opens (the first card).
   */
  publish(): void {
    if (this.ready.length === 0 || !this.sink.isOpen()) return;
    const units = this.ready;
    this.ready = [];
    for (const unit of units) {
      this.sink.beginUnit(unit.n);
      for (const e of unit.events) this.sink.record(e.type, e.data);
      this.sink.closeUnit();
    }
  }

  /** Everything waiting goes to the recorder and is saved now: the app leaves the foreground, or the screen unmounts. */
  flush(): void {
    if (!this.enabled()) return;
    this.settle();
    this.publish();
    this.sink.flush();
  }

  /** A game was left: forget what is waiting (flush first to keep it). */
  reset(): void {
    this.ready = [];
    this.deferred = null;
    this.notes = [0, 0, 0, 0];
  }

  private add(unit: Unit): void {
    if (this.ready.length < MAX_WAITING_UNITS) this.ready.push(unit);
  }
}
