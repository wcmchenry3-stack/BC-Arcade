/**
 * Hearts replay recording (#3283, epic #3273): the production form of the
 * dev-only hand log (`debugLog.ts`), minus `DebugPosition` (large, and
 * rebuildable from the deal and the plays).
 *
 * `game_started` carries the seats and the preset (`gameStartedData`). Each hand
 * then records two events through the shared GameRecorder (`useGameRecorder`):
 *
 *   hand_opened  {h, d, c, p?, r?}              the deal and the pass
 *   hand_played  {h, n?, l, c, r?, s?, t?, m?}  the tricks, and the score
 *
 * (plus the recorder's envelope `v`, `unit`, `t_ms`). The wire form is specified
 * in backend/hearts/events.py and docs/games/hearts.md ("Replay recording").
 *
 * Encoding. A card is two characters, rank then suit (`"QS"`, `"TC"`), and a
 * card list is its codes joined with no separator (`"QSAH2C"`). `hand_played.c`
 * is every play of the tricks in order, 8 characters a trick; only the lead of
 * the first trick (`l`) is recorded, because the winner of a trick leads the
 * next and the winner follows from the cards. Likewise not recorded because
 * derivable: the seat of a play, a trick's points and winner, hearts broken,
 * the queen's taker, what a seat received in the pass. CPU principles are one
 * digit each: the number `n` of `P<n>-...`, taken from the decision the AI
 * already returned (no AI work is added).
 *
 * Cost → performance → data:
 *  - A hand is two rows, not sixteen: the 200 B a stored row costs on the server
 *    is most of what a small event costs. Everything is built in memory (a few
 *    string joins over 4-13 cards); nothing is serialised or stored here.
 *  - The deal and pass are handed to the recorder when the pass is committed
 *    (at the deal, for a hold hand). The tricks are kept in memory as they are
 *    played and handed over as one `hand_played` when the hand ends, so no
 *    recorder work happens mid-hand and the last trick's animation is never in
 *    the way.
 *  - `flush` hands over the tricks played so far as a part of `hand_played`
 *    (the rest follows as the next part, `n` the first trick of the part) and
 *    gives everything the recorder holds to the queue now, synchronously. The
 *    screen calls it when it leaves the foreground, so a kill loses at most the
 *    tricks since. (The queue's AsyncStorage write is still asynchronous.)
 *  - Units that wait for a game session (hand 1's, made before the first card
 *    opens one) are kept in AsyncStorage while they wait (`PendingPort`), so a
 *    kill before the first card does not lose the deal.
 *
 * Unit numbers follow from the hand and the trick (`openedUnit`, `playedUnit`),
 * not from a counter, so a game resumed after a kill carries on from its
 * restored state: units are passed to `beginUnit(n)` explicitly (GAME-CONTRACT
 * §2.10), unique and increasing within a game, parts included.
 */

import type { EventTypeOf } from "../_shared/eventQueueConfig";
import { detectMoon } from "./engine";
import type { PrincipleId } from "./conservative/terms";
import { resolvePersona } from "./types";
import type { AiPreset, Card, HeartsState, PassDirection, TrickCard } from "./types";

/** The points that end the game (the engine's `isGameOver`). */
export const TARGET_SCORE = 100;

/** The pass direction of hand `h` is `PASS_DIRECTIONS[(h - 1) % 4]`; `d` on the wire is the index. */
const PASS_DIRECTIONS: readonly PassDirection[] = ["left", "right", "across", "none"];

/** Unit numbers reserved per hand: the opening, then up to 13 parts of `hand_played`. */
const UNITS_PER_HAND = 15;

/** The unit of hand `h`'s `hand_opened`. */
export function openedUnit(h: number): number {
  return (h - 1) * UNITS_PER_HAND + 1;
}

/** The unit of the `hand_played` part that starts at trick `firstN` (1..13) of hand `h`. */
export function playedUnit(h: number, firstN: number): number {
  return (h - 1) * UNITS_PER_HAND + 2 + firstN;
}

/**
 * Units that wait for a game session are kept up to this many. Past it new ones
 * are dropped, newest first, so what is kept is a clean prefix (the opening of
 * the hand is never lost to a later part). A real game holds one or two.
 */
const MAX_WAITING_UNITS = 32;

/**
 * The most rows of a hand that a flush may make before the hand's last row. Every
 * row costs about 200 B stored on top of its data, so a player who backgrounds
 * the app every trick must not turn a hand into 14 rows (docs/games/hearts.md,
 * "Parts"). Past it, flushes hand the recorder's other units to the queue but
 * leave the hand's tricks in memory (a kill loses them) until the hand ends or
 * the game is left (`force`).
 */
export const MAX_PARTS_PER_HAND = 3;

/** A flush on blur (another screen covers the table) makes a part only for at least this many tricks. */
export const BLUR_MIN_TRICKS = 3;

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

/**
 * `hand_opened`: `state` is the hand as dealt, its pass chosen but not committed
 * (so `playerHands` are the four starting hands and `passSelections` the cards
 * passed). `principles[seat]` is the principle behind each of that seat's cards
 * (the CPU's); `r`, 3 digits a seat, is left out when there are none. No `p`
 * on a hold hand.
 */
export function handOpenedData(
  state: HeartsState,
  principles: readonly (readonly (PrincipleId | null)[])[] = []
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    h: state.handNumber,
    d: PASS_DIRECTIONS.indexOf(state.passDirection),
    c: state.playerHands.map(cardsCode),
  };
  if (state.passDirection === "none") return data;
  data.p = state.passSelections.map(cardsCode);
  let r = "";
  for (let seat = 0; seat < 4; seat++) {
    for (let i = 0; i < 3; i++) r += principleNumber(principles[seat]?.[i]);
  }
  if (/[1-9]/.test(r)) data.r = r;
  return data;
}

/** One trick as recorded in memory: its number, lead seat, four cards and four principle digits. */
interface PlayedTrick {
  readonly n: number;
  readonly l: number;
  readonly c: string;
  readonly r: string;
}

/** The hand's score, once it is over: the applied deltas, the running totals, the moon shooter. */
export function handScore(next: HeartsState): Record<string, unknown> {
  const score: Record<string, unknown> = {
    s: [...(next.scoreHistory[next.scoreHistory.length - 1] ?? [0, 0, 0, 0])],
    t: [...next.cumulativeScores],
  };
  const moon = detectMoon(next.wonCards);
  if (moon !== null) score.m = moon;
  return score;
}

/**
 * `hand_played` for `tricks` (consecutive, from trick `tricks[0].n`) of hand
 * `h`: `n` (only past 1), the lead of the first, every play in order, the
 * principle digits (only when some are not 0), and, for the part that ends
 * the hand, `score`.
 */
function handPlayedData(
  h: number,
  tricks: readonly PlayedTrick[],
  score?: Record<string, unknown>
): Record<string, unknown> {
  const first = tricks[0]!;
  const r = tricks.map((t) => t.r).join("");
  return {
    h,
    ...(first.n > 1 ? { n: first.n } : {}),
    l: first.l,
    c: tricks.map((t) => t.c).join(""),
    ...(/[1-9]/.test(r) ? { r } : {}),
    ...score,
  };
}

// ── Recording ───────────────────────────────────────────────────────────────

/** The Hearts event types the recorder takes from this module. */
export type ReplayEventType = Extract<EventTypeOf<"hearts">, "hand_opened" | "hand_played">;

/** What `HeartsReplay` records into: `useGameRecorder("hearts")` plus whether a game session is open. */
export interface ReplaySink {
  /** Whether a game session is open to take units now. */
  isOpen(): boolean;
  beginUnit(n: number): number;
  record(type: ReplayEventType, data: Record<string, unknown>): void;
  closeUnit(): void;
  /** Give everything the recorder holds to the queue now, synchronously. */
  flush(): void;
}

/** A complete unit: its number and its events. */
export interface ReplayUnit {
  readonly n: number;
  readonly events: readonly {
    readonly type: ReplayEventType;
    readonly data: Record<string, unknown>;
  }[];
}

/** Where units that wait for a game session are kept, so a kill does not lose them. */
export interface PendingPort {
  /** Keep these units. May be written later (off the tap path); `flush` makes it now. */
  save(units: readonly ReplayUnit[]): void;
  clear(): void;
  /** Do any write `save` / `clear` put off, now (the app is leaving the foreground). */
  flush?(): void;
}

export class HeartsReplay {
  /** Complete units waiting to be handed to the recorder (a game session must be open). */
  private ready: ReplayUnit[] = [];
  /** The tricks of the hand in progress not yet handed over, and the hand's number. */
  private tricks: PlayedTrick[] = [];
  private hand = 0;
  /** The principle behind each seat's play in the trick in progress. */
  private notes: number[] = [0, 0, 0, 0];
  /** The pending port may hold units (stored, or about to be): only then does it need clearing. */
  private persisted = false;
  /** Rows of the hand in progress made by a flush so far. */
  private parts = 0;

  constructor(
    private readonly sink: ReplaySink,
    private readonly pending: PendingPort | null = null
  ) {}

  /** The principle behind a CPU seat's play, from the decision the AI already made. */
  notePlay(seat: number, principle: PrincipleId | null): void {
    this.notes[seat] = principleNumber(principle);
  }

  /** A hand was dealt. A hold hand has no pass: it is opened now; any other when the pass is committed. */
  dealt(state: HeartsState): void {
    if (state.passDirection !== "none") return;
    this.open(state, []);
  }

  /** The pass was chosen, before it is committed: `state` still has the starting hands and the selections. */
  passed(state: HeartsState, principles: readonly (readonly (PrincipleId | null)[])[]): void {
    this.open(state, principles);
  }

  /**
   * A trick was played: `prev` is the state before its last card, `next` after.
   * It is kept in memory; the hand's `hand_played` is made when `next` is no
   * longer "playing".
   */
  trick(prev: HeartsState, trick: readonly TrickCard[], next: HeartsState): void {
    if (this.tricks.length > 0 && this.hand !== prev.handNumber) this.closePlayed();
    if (this.hand !== prev.handNumber) this.parts = 0;
    this.hand = prev.handNumber;
    this.tricks.push({
      n: prev.tricksPlayedInHand + 1,
      l: trick[0]?.playerIndex ?? 0,
      c: cardsCode(trick.map((tc) => tc.card)),
      r: trick.map((tc) => this.notes[tc.playerIndex] ?? 0).join(""),
    });
    this.notes = [0, 0, 0, 0];
    if (next.phase !== "playing") {
      this.closePlayed(handScore(next));
      this.publish();
    }
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
    if (this.persisted) {
      // The kept copy is the only one until the queue has the unit: hand it to
      // the queue now (closeUnit only schedules an idle save), then let go.
      this.sink.flush();
      this.unpersist();
    }
  }

  /**
   * Units kept by a process that was killed before they were handed over. The
   * ones of hand `handNumber` (the restored game's) join the waiting units; any
   * others are stale and dropped.
   *
   * `adopted`: the restored game continues the old process's session
   * (`syncResume()` succeeded). Then the kept units were handed over before the
   * kill, or are stale, and are dropped with their stored copy: handing them
   * over again would repeat them. Not adopted, a session that is open now is a
   * fresh one (the first card was played while the load was pending) and has
   * never had them: they are handed over to it at once, otherwise when it opens.
   */
  restore(units: readonly ReplayUnit[], handNumber: number, adopted = false): void {
    if (units.length === 0) return;
    this.persisted = true; // the port holds what was loaded
    if (adopted) {
      this.unpersist();
      return;
    }
    const mine = units.filter((u) => u.events.every((e) => e.data.h === handNumber));
    for (const unit of mine) {
      if (!this.ready.some((u) => u.n === unit.n) && this.ready.length < MAX_WAITING_UNITS) {
        this.ready.push(unit);
      }
    }
    if (mine.length === 0) {
      this.unpersist();
      return;
    }
    if (mine.length < units.length && !this.sink.isOpen()) this.pending?.save(this.ready); // stale ones go
    this.publish();
  }

  /**
   * The tricks so far go to the recorder as a part of `hand_played` and everything
   * it holds is given to the queue now: the app leaves the foreground, another
   * screen covers the table, or the screen unmounts. The tricks to come follow as
   * the next part. Parts are bounded: at most `MAX_PARTS_PER_HAND` before the
   * hand's last row (`force`: the game is being left, no bound), and a blur asks
   * for `minTricks: BLUR_MIN_TRICKS` so opening the scorecard each trick makes none.
   */
  flush(options: { minTricks?: number; force?: boolean } = {}): void {
    const { minTricks = 1, force = false } = options;
    if (this.tricks.length >= minTricks && (force || this.parts < MAX_PARTS_PER_HAND)) {
      this.closePlayed();
    }
    this.publish();
    this.pending?.flush?.();
    this.sink.flush();
  }

  /** A game was left: forget what is waiting (flush first to keep it). */
  reset(): void {
    this.ready = [];
    this.tricks = [];
    this.notes = [0, 0, 0, 0];
    // Also whatever a killed process left: a new game must not inherit it.
    this.parts = 0;
    this.unpersist();
  }

  private open(state: HeartsState, principles: readonly (readonly (PrincipleId | null)[])[]): void {
    this.add({
      n: openedUnit(state.handNumber),
      events: [{ type: "hand_opened", data: handOpenedData(state, principles) }],
    });
    this.publish();
  }

  /** The tricks in memory become a `hand_played` unit (with the hand's score, when it is over). */
  private closePlayed(score?: Record<string, unknown>): void {
    const tricks = this.tricks;
    this.tricks = [];
    this.parts = score ? 0 : this.parts + 1;
    this.add({
      n: playedUnit(this.hand, tricks[0]!.n),
      events: [{ type: "hand_played", data: handPlayedData(this.hand, tricks, score) }],
    });
  }

  private add(unit: ReplayUnit): void {
    // Past the bound the newest unit is dropped, not the oldest: a clean prefix.
    if (this.ready.length >= MAX_WAITING_UNITS) return;
    this.ready.push(unit);
    if (!this.sink.isOpen() && this.pending) {
      this.pending.save(this.ready);
      this.persisted = true;
    }
  }

  private unpersist(): void {
    if (!this.persisted) return;
    this.persisted = false;
    this.pending?.clear();
  }
}
