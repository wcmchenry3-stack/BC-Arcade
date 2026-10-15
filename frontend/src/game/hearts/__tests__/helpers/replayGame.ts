/**
 * Test support for the Hearts replay (#3283): plays a whole game through the
 * real engine and AI, records it through the real `HeartsReplay` and
 * `GameRecorder`, and rebuilds a game from the saved events alone.
 */

import type { EnqueueEventInput } from "../../../_shared/gameEventClient";
import { GameRecorder } from "../../../_shared/gameRecorder";
import { explainCardToPlay, explainCardsToPass } from "../../ai";
import type { PrincipleId } from "../../conservative/terms";
import {
  commitPass,
  dealGame,
  dealNextHand,
  getValidPlays,
  playCard,
  selectPassCard,
} from "../../engine";
import { HeartsReplay, decodeCards, type ReplaySink } from "../../replay";
import { resolvePersona } from "../../types";
import type { AiPreset, Card, HeartsState, TrickCard } from "../../types";

export interface PlayOptions {
  readonly preset?: AiPreset;
  /** Replaces the deal of each hand (`state` is the fresh deal); default: as dealt. */
  readonly craft?: (state: HeartsState) => HeartsState;
  /** The card a seat plays; undefined: the AI's choice. */
  readonly choose?: (state: HeartsState, seat: number) => Card | undefined;
  /** The cards seat 0 passes; undefined: the AI's choice. */
  readonly humanPass?: (state: HeartsState) => readonly Card[] | undefined;
  /** The recorder's kill switch; unset: its default (the replay dial). */
  readonly enabled?: () => boolean;
  /** Called after each trick with the state; true flushes (the app went to the background there). */
  readonly flushAfter?: (state: HeartsState) => boolean;
  /** Called with each save, to route the events somewhere real (the queue). */
  readonly onSave?: (batch: readonly EnqueueEventInput[]) => void;
  /** Stop after this many hands (the state is then not final). */
  readonly maxHands?: number;
}

export interface PlayedGame {
  /** The engine's state at the end. */
  readonly final: HeartsState;
  /** Every event the recorder saved, in order, envelope included. */
  readonly saved: EnqueueEventInput[];
  /** The `[unit, type]` of each recorded event, in the order it reached the recorder. */
  readonly units: [number, string][];
  /** How many events each save (`enqueueMany` call) took, in order. */
  readonly saves: number[];
}

/** A hand's cards from codes: `hand("ACKC...")`. */
export const hand = (code: string): Card[] => decodeCards(code);

const rankValue = (c: Card): number => (c.rank === 1 ? 14 : c.rank);

/** The highest-ranked legal card (the first, on a tie). */
export function highestLegal(state: HeartsState, seat: number): Card {
  const legal = getValidPlays(state, seat);
  return legal.reduce((best, c) => (rankValue(c) > rankValue(best) ? c : best), legal[0]!);
}

/** The lowest-ranked legal card (the first, on a tie). */
export function lowestLegal(state: HeartsState, seat: number): Card {
  const legal = getValidPlays(state, seat);
  return legal.reduce((best, c) => (rankValue(c) < rankValue(best) ? c : best), legal[0]!);
}

/** The hand the scripted moon shot is dealt in: a hold hand (no pass), so the deal is the play. */
export const MOON_HAND = 4;
/** The seat that shoots the moon in `moonShotOptions`. */
export const MOON_SHOOTER = 1;

/**
 * Hand 1 is dealt with the queen of spades in seat 0 (the rest of the deal stays
 * whole), and seat 0 passes it, with its two first other cards, to the left.
 */
export function queenPassOptions(): PlayOptions {
  const queen = hand("QS")[0]!;
  const isQueen = (c: Card) => c.suit === queen.suit && c.rank === queen.rank;
  return {
    craft: (state) => {
      if (state.handNumber !== 1) return state;
      const holder = state.playerHands.findIndex((h) => h.some(isQueen));
      if (holder <= 0) return state;
      const given = state.playerHands[0]![state.playerHands[0]!.length - 1]!;
      const hands = state.playerHands.map((h, seat) => {
        if (seat === 0) return [...h.slice(0, -1), queen];
        if (seat === holder) return h.map((c) => (isQueen(c) ? given : c));
        return [...h];
      });
      return { ...state, playerHands: hands };
    },
    humanPass: (state) => {
      if (state.handNumber !== 1) return undefined; // later hands: the AI's choice
      const mine = state.playerHands[0]!;
      const q = mine.find(isQueen)!;
      return [q, ...mine.filter((c) => c !== q).slice(0, 2)];
    },
  };
}

/**
 * Hand `MOON_HAND` is dealt so that seat `MOON_SHOOTER` holds the top cards of
 * every suit and plays its highest legal card while the others play their lowest:
 * it wins all 13 tricks, every heart and the queen of spades with them.
 */
export function moonShotOptions(): PlayOptions {
  return {
    craft: (state) =>
      state.handNumber === MOON_HAND
        ? {
            ...state,
            playerHands: [
              hand("5S6S7S8S9STSJS6H7H8H9HTHJH"),
              hand("ACKCQCJCADKDQDASKSQSAHKHQH"),
              hand("2C3C4C5C6C7C8C9CTC2H3H4H5H"),
              hand("2D3D4D5D6D7D8D9DTDJD2S3S4S"),
            ],
            currentLeaderIndex: 2, // holds the 2 of clubs
            currentPlayerIndex: 2,
          }
        : state,
    choose: (state, seat) =>
      state.handNumber !== MOON_HAND
        ? undefined
        : seat === MOON_SHOOTER
          ? highestLegal(state, seat)
          : lowestLegal(state, seat),
  };
}

/** Both scripts in one game: a queen passed in hand 1 and a moon shot in hand 4. */
export function queenAndMoonOptions(): PlayOptions {
  const queen = queenPassOptions();
  const moon = moonShotOptions();
  return {
    craft: (state) => moon.craft!(queen.craft!(state)),
    humanPass: queen.humanPass,
    choose: moon.choose,
  };
}

export function playRecordedGame(options: PlayOptions = {}): PlayedGame {
  const preset = options.preset ?? "conservative";
  const saved: EnqueueEventInput[] = [];
  const units: [number, string][] = [];
  const saves: number[] = [];
  // a clock that moves 750 ms per read, so a seeded game records the same `t_ms` every run
  let clock = 0;
  const recorder = new GameRecorder<"hearts">({
    gameType: "hearts",
    now: () => (clock += 750),
    enabled: options.enabled,
    sink: {
      canAccept: () => true,
      enqueueMany: (batch) => {
        saved.push(...batch);
        saves.push(batch.length);
        options.onSave?.(batch);
        return true;
      },
    },
    schedule: (task) => task(), // the idle moment comes at once
  });
  recorder.startSession();
  let currentUnit = 0;
  const sink: ReplaySink = {
    isOpen: () => true,
    beginUnit: (n) => {
      currentUnit = n;
      return recorder.beginUnit(n);
    },
    record: (type, data) => {
      units.push([currentUnit, type]);
      recorder.record(type, data);
    },
    closeUnit: () => recorder.closeUnit(),
    flush: () => recorder.flush(),
  };
  const replay = new HeartsReplay(sink);
  const craft = options.craft ?? ((s: HeartsState) => s);

  let state = craft(dealGame(preset));
  replay.dealt(state);
  let hands = 1;
  while (state.phase !== "game_over") {
    if (state.phase === "passing") {
      let s = state;
      const principles: (PrincipleId | null)[][] = [[], [], [], []];
      for (let seat = 0; seat < 4; seat++) {
        const persona = resolvePersona(s.aiDifficulty, seat);
        const chosen = seat === 0 ? options.humanPass?.(s) : undefined;
        const cards =
          chosen?.map((card) => ({ card, principle: null })) ??
          explainCardsToPass([...(s.playerHands[seat] ?? [])], s.passDirection, persona, seat);
        for (const { card, principle } of cards) {
          s = selectPassCard(s, seat, card);
          // the human seat has no principle, whatever the AI would have said
          principles[seat]!.push(seat === 0 ? null : principle);
        }
      }
      replay.passed(s, principles);
      state = commitPass(s);
    } else if (state.phase === "playing") {
      const seat = state.currentPlayerIndex;
      const persona = resolvePersona(state.aiDifficulty, seat);
      const decision = explainCardToPlay(
        [...(state.playerHands[seat] ?? [])],
        [...state.currentTrick],
        state,
        seat,
        persona
      );
      const card = options.choose?.(state, seat) ?? decision.card;
      if (seat !== 0) replay.notePlay(seat, decision.principle);
      const prev = state;
      const trick: readonly TrickCard[] | null =
        state.currentTrick.length === 3
          ? [...state.currentTrick, { card, playerIndex: seat }]
          : null;
      state = playCard(state, seat, card);
      if (trick) {
        replay.trick(prev, trick, state);
        if (options.flushAfter?.(state)) replay.flush();
      }
    } else if (state.phase === "dealing") {
      if (options.maxHands !== undefined && hands >= options.maxHands) break;
      state = craft(dealNextHand(state));
      hands += 1;
      replay.dealt(state);
    } else {
      throw new Error(`Unexpected phase ${state.phase}`);
    }
  }
  replay.flush();
  recorder.endSession();
  return { final: state, saved, units, saves };
}

// ── Rebuilding a game from its events alone ─────────────────────────────────

export interface Rebuilt {
  /** The running totals after the last score. */
  readonly totals: number[];
  /** Each hand's applied deltas, rebuilt from the tricks (the moon applied). */
  readonly deltas: number[][];
  /** The moon shooter of each hand, or null. */
  readonly moon: (number | null)[];
  /** The seat that took the queen of spades in each hand. */
  readonly queenTakers: (number | null)[];
  /** The cards each seat holds at the end of the events (a finished game: none). */
  readonly hands: string[][];
  /** Everything that did not hold together: a card played that the seat did not hold, a gap in the tricks... */
  readonly problems: string[];
}

const RANKS = "23456789TJQKA";
const PASS_OFFSET = [1, 3, 2]; // left, right, across (types.ts passOffset)
const split = (code: string): string[] => code.match(/../g) ?? [];

/**
 * A game's scores, rebuilt from the saved events and nothing else: the hands
 * come from `hand_opened`, every play is checked against the hand the seat
 * holds, and each hand's winners, points and moon are derived from the plays
 * (the winner of a trick leads the next), then compared with the recorded
 * score. A hand may arrive in parts (`n` the first trick of a part).
 */
export function rebuildGame(events: readonly EnqueueEventInput[]): Rebuilt {
  const problems: string[] = [];
  let hands: string[][] = [[], [], [], []];
  let taken: number[] = [0, 0, 0, 0];
  let queenTaker: number | null = null;
  let nextTrick = 1;
  let expectedLead: number | null = null;
  let totals = [0, 0, 0, 0];
  const deltas: number[][] = [];
  const moon: (number | null)[] = [];
  const queenTakers: (number | null)[] = [];

  const take = (seat: number, card: string, where: string) => {
    const i = hands[seat]!.indexOf(card);
    if (i < 0) problems.push(`${where}: seat ${seat} does not hold ${card}`);
    else hands[seat]!.splice(i, 1);
  };

  for (const e of events) {
    const d = e.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const at = `h${d.h} ${e.type}`;
    if (e.type === "hand_opened") {
      hands = (d.c as string[]).map(split);
      if (d.p) {
        const offset = PASS_OFFSET[d.d]!;
        const passed = (d.p as string[]).map(split);
        passed.forEach((cards, from) => cards.forEach((c) => take(from, c, at)));
        passed.forEach((cards, from) => hands[(from + offset) % 4]!.push(...cards));
      }
      taken = [0, 0, 0, 0];
      queenTaker = null;
      nextTrick = 1;
      expectedLead = null;
    } else if (e.type === "hand_played") {
      const first = d.n ?? 1;
      if (first !== nextTrick)
        problems.push(`${at}: starts at trick ${first}, expected ${nextTrick}`);
      const cards = split(d.c as string);
      let lead: number = d.l;
      if (expectedLead !== null && lead !== expectedLead) {
        problems.push(`${at}: lead ${lead}, expected ${expectedLead}`);
      }
      if (d.r !== undefined && (d.r as string).length !== cards.length) {
        problems.push(`${at}: ${(d.r as string).length} principles for ${cards.length} plays`);
      }
      for (let k = 0; k * 4 < cards.length; k++) {
        const trick = cards.slice(k * 4, k * 4 + 4);
        trick.forEach((c, i) => take((lead + i) % 4, c, `${at} t${first + k}`));
        const led = trick[0]![1];
        let best = 0;
        trick.forEach((c, i) => {
          if (c[1] === led && RANKS.indexOf(c[0]!) > RANKS.indexOf(trick[best]![0]!)) best = i;
        });
        const winner = (lead + best) % 4;
        let points = trick.filter((c) => c[1] === "H").length;
        if (trick.includes("QS")) {
          points += 13;
          queenTaker = winner;
        }
        taken[winner]! += points;
        lead = winner;
      }
      nextTrick = first + cards.length / 4;
      expectedLead = lead;
      if (d.s) {
        if (nextTrick !== 14) problems.push(`${at}: scored after ${nextTrick - 1} tricks`);
        const shooter = taken.findIndex((p) => p === 26);
        const delta = taken.map((p, i) => (shooter < 0 ? p : i === shooter ? 0 : 26));
        if (JSON.stringify(delta) !== JSON.stringify(d.s)) {
          problems.push(`${at}: deltas ${JSON.stringify(delta)}, recorded ${JSON.stringify(d.s)}`);
        }
        if ((shooter < 0 ? undefined : shooter) !== d.m) {
          problems.push(`${at}: moon ${shooter}, recorded ${d.m}`);
        }
        totals = totals.map((t, i) => t + delta[i]!);
        if (JSON.stringify(totals) !== JSON.stringify(d.t)) {
          problems.push(`${at}: totals ${JSON.stringify(totals)}, recorded ${JSON.stringify(d.t)}`);
        }
        deltas.push(delta);
        moon.push(shooter < 0 ? null : shooter);
        queenTakers.push(queenTaker);
      }
    }
  }
  return { totals, deltas, moon, queenTakers, hands, problems };
}
