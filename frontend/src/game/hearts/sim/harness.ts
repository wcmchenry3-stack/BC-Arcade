/**
 * Hearts simulation harness (#2238) — the game runner behind the sim gate
 * (gate.ts), the per-PR smoke test and `scripts/simulate-hearts.ts`.
 *
 * Duplicate-deal replay. A *block* replays one sequence of deals once per
 * line-up of a matchup, so every line-up plays the same cards:
 *
 * - preset matchups (`presetMatchup`) are the tables the app deals — a
 *   human stand-in at seat 0 and three AIs, rotated across seats 1-3 so
 *   each AI plays each seat's cards. They measure per-persona rates and how
 *   hard each preset is for the stand-in; comparing two presets pairs their
 *   blocks, which share deals.
 * - field matchups (`fieldMatchup`) compare personas head to head: one
 *   test seat takes each persona in turn against a fixed field. Within a
 *   block two personas faced identical cards, seats and opponents, so the
 *   difference between them is the persona (duplicate bridge). Measured
 *   variance reduction for win-share differences: 0.8-0.9x; for points per
 *   hand 0.5-0.65x (docs/TESTING.md). Comparing personas that sit at the
 *   *same* table instead (the mixed preset) raises the variance by
 *   1.1-1.3x, because they compete in the same zero-sum games.
 *
 * Block totals — not single games — are the statistical unit in
 * `metrics.ts` and `sprt.ts`.
 *
 * Seat 0 never holds an AI under test: the AI treats seat 0 as the human
 * (Daring's pass and dump targeting aim at it, and ai.ts turns that
 * targeting off for an AI sitting at seat 0), so an AI persona in seat 0
 * would measure a configuration the app never plays.
 *
 * Randomness is split so that play never shifts the deals:
 * - hand h of block b is always dealt from its own stream
 *   (seed, block, h), whatever happened in hands 1..h-1;
 * - each seat's AI noise (ai.ts draws it from the engine's `getRng()`) comes
 *   from its own (seed, block, hand, seat) stream, switched in before every
 *   decision, so one player's noise draws never move another's.
 */

import { detectMoonAttempt, selectCardToPlay, selectCardsToPass } from "../ai";
import {
  commitPass,
  dealGame,
  dealNextHand,
  detectMoon,
  isQueenOfSpades,
  playCard,
  selectPassCard,
  setRng,
} from "../engine";
import type { AiPersona, Card, HeartsState, PassDirection, TrickCard } from "../types";
import { createStream, deriveSeed } from "../../_shared/simRandom";

const DEAL_TAG = 0x4445414c; // "DEAL"
const NOISE_TAG = 0x4e4f4953; // "NOIS"

/** A player strategy. Built-in personas come from `personaPolicy`. */
export interface HeartsPolicy {
  readonly label: string;
  /**
   * The persona whose moon trigger (`detectMoonAttempt`) to instrument.
   * Leave unset for custom policies (e.g. a search-based player): their moon
   * attempts can't be observed, so moon_attempt / moon_success read 0/0.
   */
  readonly persona?: AiPersona;
  pass(hand: Card[], direction: PassDirection, state: HeartsState, seat: number): Card[];
  play(hand: Card[], trick: TrickCard[], state: HeartsState, seat: number): Card;
}

export function personaPolicy(persona: AiPersona): HeartsPolicy {
  return {
    label: persona,
    persona,
    pass: (hand, direction, _state, seat) => selectCardsToPass(hand, direction, persona, seat),
    play: (hand, trick, state, seat) => selectCardToPlay(hand, trick, state, seat, persona),
  };
}

/**
 * Per-seat event counters for one game. Every gated metric in `metrics.ts`
 * is a ratio of two of these, so each rate carries its own denominator.
 */
export interface SeatCounters {
  /** 1 per game — the denominator for per-game rates. */
  seatGames: number;
  /** 1 for an outright win, 1/k when k seats tie for the lowest score. */
  winShare: number;
  /** Final cumulative score (moon-adjusted). */
  points: number;
  handsPlayed: number;
  /** Hands in which this seat took Q♠. */
  qsTaken: number;
  /** Hands in which this seat's earlyMoon/midMoon trigger fired (#2204). */
  moonAttempts: number;
  /** Of those hands, how many this seat went on to shoot the moon in. */
  moonAttemptSuccesses: number;
  /** Hands in which this seat shot the moon, attempted or not. */
  moonShots: number;
  /** Q♠ discarded on a trick led in another suit. */
  qsDumps: number;
  /** Of those dumps, how many landed on the human stand-in (seat 0 won the trick). */
  qsDumpsOnHuman: number;
  /** Passing rounds where the seat could void a suit (held a suit of 1-3 cards). */
  voidOpportunities: number;
  /** Of those rounds, how many the seat's pass emptied a whole suit. */
  voidsCreated: number;
}

export type CounterKey = keyof SeatCounters;

export const COUNTER_KEYS: readonly CounterKey[] = [
  "seatGames",
  "winShare",
  "points",
  "handsPlayed",
  "qsTaken",
  "moonAttempts",
  "moonAttemptSuccesses",
  "moonShots",
  "qsDumps",
  "qsDumpsOnHuman",
  "voidOpportunities",
  "voidsCreated",
];

export function emptyCounters(): SeatCounters {
  return {
    seatGames: 0,
    winShare: 0,
    points: 0,
    handsPlayed: 0,
    qsTaken: 0,
    moonAttempts: 0,
    moonAttemptSuccesses: 0,
    moonShots: 0,
    qsDumps: 0,
    qsDumpsOnHuman: 0,
    voidOpportunities: 0,
    voidsCreated: 0,
  };
}

export function addCounters(into: SeatCounters, from: SeatCounters): void {
  for (const k of COUNTER_KEYS) into[k] += from[k];
}

export interface GameRecord {
  /** Which policy label sat in each seat. */
  readonly labels: readonly [string, string, string, string];
  readonly seats: readonly [SeatCounters, SeatCounters, SeatCounters, SeatCounters];
  readonly finalScores: readonly number[];
  /** The opening 13 cards of each seat, per hand (tests only — see `recordDeals`). */
  readonly deals?: readonly (readonly (readonly Card[])[])[];
}

export type Policies = readonly [HeartsPolicy, HeartsPolicy, HeartsPolicy, HeartsPolicy];

export interface PlayOptions {
  /** Keep every hand's opening deal on the record (tests only). */
  readonly recordDeals?: boolean;
}

/** Final-score win shares: the lowest score wins; a tie splits the win. */
export function winShares(scores: readonly number[]): number[] {
  const best = Math.min(...scores);
  const winners = scores.filter((s) => s === best).length;
  return scores.map((s) => (s === best ? 1 / winners : 0));
}

function dealStream(seed: number, block: number, hand: number): () => number {
  return createStream(deriveSeed(seed, DEAL_TAG, block, hand));
}

/** A suit the seat holds 1-3 cards of — it could pass the whole suit away. */
function canVoidBySuit(hand: readonly Card[]): boolean {
  const counts = new Map<string, number>();
  for (const c of hand) counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
  for (const n of counts.values()) if (n <= 3) return true;
  return false;
}

/** The pass took every card of some suit the seat held. */
function passEmptiesASuit(hand: readonly Card[], passed: readonly Card[]): boolean {
  const passedSuits = new Set(passed.map((c) => c.suit));
  for (const suit of passedSuits) {
    const held = hand.filter((c) => c.suit === suit).length;
    const gone = passed.filter((c) => c.suit === suit).length;
    if (held === gone) return true;
  }
  return false;
}

/**
 * Play one game to 100 points. Hand h is dealt from the (seed, block, h)
 * stream; each seat's noise from (seed, block, h, seat).
 */
export function playGame(
  policies: Policies,
  seed: number,
  block: number,
  options: PlayOptions = {}
): GameRecord {
  const seats = [emptyCounters(), emptyCounters(), emptyCounters(), emptyCounters()] as const;
  const deals: Card[][][] = [];
  let noise: (() => number)[] = [];

  const startHand = (hand: number) => {
    noise = [0, 1, 2, 3].map((seat) =>
      createStream(deriveSeed(seed, NOISE_TAG, block, hand, seat))
    );
  };

  setRng(dealStream(seed, block, 1));
  let state: HeartsState = dealGame("schemer"); // aiDifficulty is informational only
  startHand(1);
  if (options.recordDeals) deals.push(state.playerHands.map((h) => [...h]));

  // Moon attempt pairing (#2204): whether each seat's trigger has fired in
  // the current hand, so a moon at hand end pairs with that hand's attempt.
  let attempted = [false, false, false, false];

  const endHand = (s: HeartsState) => {
    const shooter = detectMoon(s.wonCards);
    for (let i = 0; i < 4; i++) {
      const c = seats[i]!;
      c.handsPlayed++;
      if (shooter === i) {
        c.moonShots++;
        if (attempted[i]) c.moonAttemptSuccesses++;
      }
    }
    attempted = [false, false, false, false];
  };

  while (state.phase !== "game_over") {
    if (state.phase === "passing") {
      for (let seat = 0; seat < 4; seat++) {
        const hand = [...(state.playerHands[seat] ?? [])];
        setRng(noise[seat]!);
        const cards = policies[seat]!.pass([...hand], state.passDirection, state, seat);
        if (canVoidBySuit(hand)) {
          seats[seat]!.voidOpportunities++;
          if (passEmptiesASuit(hand, cards)) seats[seat]!.voidsCreated++;
        }
        for (const card of cards) state = selectPassCard(state, seat, card);
      }
      state = commitPass(state);
    } else if (state.phase === "playing") {
      const seat = state.currentPlayerIndex;
      const policy = policies[seat]!;
      const hand = [...(state.playerHands[seat] ?? [])];
      if (
        policy.persona &&
        !attempted[seat] &&
        detectMoonAttempt(hand, state, seat, policy.persona)
      ) {
        attempted[seat] = true;
        seats[seat]!.moonAttempts++;
      }
      const trick = [...state.currentTrick];
      setRng(noise[seat]!);
      const card = policy.play(hand, [...trick], state, seat);
      const tricksBefore = state.tricksPlayedInHand;
      state = playCard(state, seat, card);
      if (state.tricksPlayedInHand > tricksBefore) {
        // The trick just resolved; its winner leads the next one.
        const cards = [...trick, { card, playerIndex: seat }];
        const winner = state.currentLeaderIndex;
        const queen = cards.find((tc) => isQueenOfSpades(tc.card));
        if (queen) {
          seats[winner]!.qsTaken++;
          if (cards[0]!.card.suit !== "spades") {
            seats[queen.playerIndex]!.qsDumps++;
            if (winner === 0 && queen.playerIndex !== 0) seats[queen.playerIndex]!.qsDumpsOnHuman++;
          }
        }
      }
      if (state.phase === "dealing" || state.phase === "game_over") endHand(state);
    } else if (state.phase === "dealing") {
      const next = state.handNumber + 1;
      setRng(dealStream(seed, block, next));
      state = dealNextHand(state);
      startHand(next);
      if (options.recordDeals) deals.push(state.playerHands.map((h) => [...h]));
    } else {
      throw new Error(`playGame: unexpected phase ${state.phase}`);
    }
  }

  const finalScores = state.cumulativeScores.map((s) => s ?? 0);
  const shares = winShares(finalScores);
  for (let i = 0; i < 4; i++) {
    const c = seats[i]!;
    c.seatGames = 1;
    c.winShare = shares[i]!;
    c.points = finalScores[i]!;
  }

  return {
    labels: policies.map((p) => p.label) as unknown as GameRecord["labels"],
    seats,
    finalScores,
    ...(options.recordDeals ? { deals } : {}),
  };
}

// ---------------------------------------------------------------------------
// Matchups and blocks
// ---------------------------------------------------------------------------

/** Role name for the seat-0 human stand-in in per-role aggregates. */
export const PROXY_ROLE = "proxy";
/** Role name for the fixed seats around a test seat in a field matchup. */
export const FIELD_ROLE = "field";

/** One game set-up: who sits where, and which role each seat's counters count towards. */
export interface Lineup {
  readonly policies: Policies;
  readonly roles: readonly [string, string, string, string];
}

/** Every line-up of a matchup is played once per block, on the block's deals. */
export interface Matchup {
  readonly id: string;
  readonly lineups: readonly Lineup[];
}

type Trio = readonly [HeartsPolicy, HeartsPolicy, HeartsPolicy];

/**
 * The distinct cyclic rotations of three AI players across seats 1-3:
 * three for a mixed line-up, one when all three share a label (every
 * rotation would replay the identical game).
 */
export function aiRotations(ai: Trio): Trio[] {
  const out: Trio[] = [];
  const seen = new Set<string>();
  for (let r = 0; r < 3; r++) {
    const rotated = [ai[r % 3]!, ai[(r + 1) % 3]!, ai[(r + 2) % 3]!] as const;
    const key = rotated.map((p) => p.label).join(",");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(rotated);
    }
  }
  return out;
}

/**
 * A table as the app deals it: the human stand-in at seat 0 and three AI
 * players, rotated across seats 1-3. Roles: the stand-in is `proxy`, each AI
 * counts towards its own label (pooled when a label repeats).
 */
export function presetMatchup(id: string, proxy: HeartsPolicy, ai: Trio): Matchup {
  return {
    id,
    lineups: aiRotations(ai).map((trio) => ({
      policies: [proxy, ...trio] as const,
      roles: [PROXY_ROLE, trio[0].label, trio[1].label, trio[2].label] as const,
    })),
  };
}

/**
 * Duplicate-seat comparison: every other seat is `field` (seat 0 included),
 * and each test policy takes a turn in each of seats 1-3 on the same deals.
 * Two test policies are then compared with the cards, seat and opponents
 * held fixed — the part of the result that differs is the policy.
 */
export function fieldMatchup(
  id: string,
  field: HeartsPolicy,
  tests: readonly HeartsPolicy[]
): Matchup {
  const lineups: Lineup[] = [];
  for (const test of tests) {
    for (let seat = 1; seat <= 3; seat++) {
      const policies = [field, field, field, field];
      const roles = [FIELD_ROLE, FIELD_ROLE, FIELD_ROLE, FIELD_ROLE];
      policies[seat] = test;
      roles[seat] = test.label;
      lineups.push({
        policies: policies as unknown as Policies,
        roles: roles as unknown as Lineup["roles"],
      });
    }
  }
  return { id, lineups };
}

/** Summed counters per role for one block. */
export type RoleCounters = Readonly<Record<string, SeatCounters>>;

export interface BlockRecord {
  readonly index: number;
  readonly roles: RoleCounters;
  /** Every game of the block (only with `keepGames`, for tests). */
  readonly games?: readonly GameRecord[];
}

export interface BlockOptions extends PlayOptions {
  readonly keepGames?: boolean;
}

export function runBlock(
  matchup: Matchup,
  seed: number,
  block: number,
  options: BlockOptions = {}
): BlockRecord {
  const roles: Record<string, SeatCounters> = {};
  const games: GameRecord[] = [];
  for (const lineup of matchup.lineups) {
    const game = playGame(lineup.policies, seed, block, options);
    game.seats.forEach((counters, seat) => {
      addCounters((roles[lineup.roles[seat]!] ??= emptyCounters()), counters);
    });
    if (options.keepGames) games.push(game);
  }
  return { index: block, roles, ...(options.keepGames ? { games } : {}) };
}

/** Blocks `from`..`from + count - 1` of a matchup. */
export function runBlocks(
  matchup: Matchup,
  seed: number,
  from: number,
  count: number
): BlockRecord[] {
  const out: BlockRecord[] = [];
  for (let b = from; b < from + count; b++) out.push(runBlock(matchup, seed, b));
  return out;
}
