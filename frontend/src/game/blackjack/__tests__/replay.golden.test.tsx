/**
 * Blackjack replay recording, end to end (#3284, epic #3273): a scripted run
 * (a split with a double and a dealer bust, a plain double, a natural, a player
 * bust, a dealer bust) is played through the real context, engine and
 * GameRecorder, and then rebuilt from the saved events alone. Every card and
 * the chip count must match what the engine had.
 *
 * Also here: one save per round, off the interaction path; the synchronous
 * flush when the app goes to the background; unit numbering after a resume;
 * the kill switch; and the shared fixture backend/tests/fixtures/
 * blackjack_replay_v1.json that the backend's tests check (regenerate it with
 * `UPDATE_BLACKJACK_FIXTURE=1 npx jest src/game/blackjack/__tests__/replay.golden.test.tsx`).
 */
import fs from "fs";
import path from "path";
import React from "react";
import { AppState } from "react-native";
import { act, renderHook } from "@testing-library/react-native";

import { BlackjackGameProvider, useBlackjackGame } from "../BlackjackGameContext";
import {
  doubleDown,
  handValue,
  hit,
  newGame,
  newHand,
  placeBet,
  split,
  stand,
  type Card,
  type EngineState,
} from "../engine";
import { TABLE_CONFIGS } from "../tables";
import { loadGame } from "../storage";
import * as queueConfig from "../../_shared/eventQueueConfig";
import type { ProgressSnapshot } from "../../_shared/useGameSync";

jest.mock("../storage", () => ({
  loadGame: jest.fn().mockResolvedValue(null),
  saveGame: jest.fn(),
  clearGame: jest.fn(),
  saveRun: jest.fn().mockResolvedValue(undefined),
  loadRuns: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../../entitlements/premiumLevels", () => ({ isPremiumLevel: () => false }));
jest.mock("../../_shared/lastDifficulty", () => ({ saveLastDifficulty: jest.fn() }));

// The context's game session is faked (the recorder is real): `enqueueMany` is
// the recorder's save, so what it receives is what would reach the queue.
interface Saved {
  type: string;
  data: Record<string, unknown>;
}
const mockSaves: Saved[][] = [];
const mockResume = jest.fn(() => false);
const mockStart = jest.fn();
const mockComplete = jest.fn();
let mockOpen = true;
jest.mock("../../_shared/useGameSync", () => ({
  useGameSync: () => ({
    start: (...a: unknown[]) => mockStart(...a),
    resume: () => mockResume(),
    markStarted: jest.fn(),
    enqueue: jest.fn(),
    enqueueMany: (events: Saved[]) => {
      mockSaves.push([...events]);
      return true;
    },
    complete: (...a: unknown[]) => mockComplete(...a),
    close: jest.fn(),
    setProgressSnapshot: (_g: () => ProgressSnapshot) => undefined,
    getGameId: () => (mockOpen ? "game-1" : null),
    resetPlayWindow: jest.fn(),
  }),
}));

const FIXTURE = path.resolve(
  __dirname,
  "../../../../../backend/tests/fixtures/blackjack_replay_v1.json"
);

// ---------------------------------------------------------------------------
// The scripted run
// ---------------------------------------------------------------------------

const SUITS: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
function card(code: string): Card {
  const r = code.slice(0, -1);
  return { rank: r === "T" ? "10" : r, suit: SUITS[code.slice(-1)]! };
}

/** Cards in the order they are drawn. The engine draws from the end of the array. */
function scriptedDeck(draws: readonly string[]): Card[] {
  // 100 filler cards at the bottom keep the shoe above the reshuffle threshold (78).
  const filler = Array.from({ length: 100 }, () => card("2C"));
  return [...filler, ...[...draws].reverse().map(card)];
}

const ROUND_1 = ["8S", "6C", "8H", "TD", "3D", "KC", "9S", "TS"]; // split, double, dealer bust
const ROUND_2 = ["5H", "TH", "6C", "7D", "9S"]; // double, dealer stands on 17
const ROUND_3 = ["AS", "5C", "KD", "9H"]; // natural blackjack
const ROUND_4 = ["TS", "7C", "6D", "8H", "KH"]; // hit and bust
const ROUND_5 = ["TC", "6S", "9D", "5H", "4D", "8C"]; // stand; dealer draws two and busts
const DRAWS = [...ROUND_1, ...ROUND_2, ...ROUND_3, ...ROUND_4, ...ROUND_5];

const TABLE = TABLE_CONFIGS[0]!;

function startState(): EngineState {
  return newGame(scriptedDeck(DRAWS), {
    startingChips: TABLE.startingChips,
    runGoal: TABLE.runGoal,
    betMin: TABLE.betMin,
    betMax: TABLE.betMax,
    milestones: TABLE.milestones,
  });
}

const clock = { t: 1_000_000 };

function wrapper({ children }: { children: React.ReactNode }) {
  return <BlackjackGameProvider>{children}</BlackjackGameProvider>;
}

type Ctx = ReturnType<typeof useBlackjackGame>;

async function mount(saved: EngineState | null = startState()) {
  (loadGame as jest.Mock).mockResolvedValueOnce(saved);
  const hook = await renderHook(() => useBlackjackGame(), { wrapper });
  await act(async () => {});
  const ctx = (): Ctx => hook.result.current;
  const play = async (fn: (s: EngineState) => EngineState, hint?: Parameters<Ctx["apply"]>[1]) => {
    clock.t += 1500;
    await act(async () => {
      ctx().apply(fn, hint ?? null);
    });
  };
  return { hook, ctx, play };
}

// The recorder's idle moments (requestIdleCallback), run by the test and by nothing else.
const idleTasks: (() => void)[] = [];

/** An idle moment: the recorder saves what a closed round left. */
async function idle() {
  await act(async () => {
    while (idleTasks.length > 0) idleTasks.shift()!();
  });
}

const flat = (): Saved[] => mockSaves.flat();

beforeEach(() => {
  mockSaves.length = 0;
  mockOpen = true;
  mockResume.mockReset().mockReturnValue(false);
  mockStart.mockReset();
  mockComplete.mockReset();
  clock.t = 1_000_000;
  idleTasks.length = 0;
  (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = (cb: () => void) => {
    idleTasks.push(cb);
    return idleTasks.length;
  };
  jest.spyOn(Date, "now").mockImplementation(() => clock.t);
});
afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
});

// ---------------------------------------------------------------------------
// Rebuilding a run from its events alone
// ---------------------------------------------------------------------------

const VALUE: Record<string, number> = {
  A: 11,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 10,
  Q: 10,
  K: 10,
};

function total(cards: readonly string[]): number {
  let sum = 0;
  let aces = 0;
  for (const c of cards) {
    sum += VALUE[c[0]!]!;
    if (c[0] === "A") aces += 1;
  }
  while (sum > 21 && aces > 0) {
    sum -= 10;
    aces -= 1;
  }
  return sum;
}

interface RebuiltRound {
  unit: number;
  bet: number;
  /** The player's hands as they stood when the round ended. */
  hands: string[][];
  /** The dealer's hand as it stood when the round ended. */
  dealer: string[];
  /** Each hand's recorded payout. */
  payouts: number[];
  /** The shoe at the deal. */
  shoe: { size: number; remaining: number };
  dealerPlayed: boolean;
  dealerBust: boolean;
}

interface Rebuilt {
  rounds: RebuiltRound[];
  startingChips: number;
  chips: number;
}

/**
 * Replays the saved events with nothing but the events: the cards and the bet
 * give the hands, the hands give the outcomes, the outcomes give the chips. It
 * checks each `hand_resolved` against what the cards say.
 */
function rebuild(events: readonly Saved[]): Rebuilt {
  const rounds: RebuiltRound[] = [];
  let startingChips = -1;
  let chips = -1;
  let round: RebuiltRound | null = null;
  let bets: number[] = [];
  for (const { type, data } of events) {
    const d = data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (type === "bet_placed") {
      if (startingChips < 0) {
        startingChips = d.chips_remaining + d.amount;
        chips = startingChips;
      }
      expect(d.chips_remaining + d.amount).toBe(chips);
      round = {
        unit: d.unit,
        bet: d.amount,
        hands: [],
        dealer: [],
        payouts: [],
        shoe: { size: 0, remaining: 0 },
        dealerPlayed: false,
        dealerBust: false,
      };
      bets = [d.amount];
      rounds.push(round);
    } else if (type === "hand_dealt") {
      round!.hands = [[...d.p]];
      round!.dealer = [...d.d];
      round!.shoe = { size: d.sh, remaining: d.rem };
    } else if (type === "player_action") {
      const r = round!;
      if (d.a === "h") r.hands[d.i]!.push(d.c);
      if (d.a === "d") {
        r.hands[d.i]!.push(d.c);
        bets[d.i] = bets[d.i]! * 2;
      }
      if (d.a === "p") {
        // the two hands the split made replace the one acted on
        expect(d.h[0][0]).toBe(r.hands[d.i]![0]);
        expect(d.h[1][0]).toBe(r.hands[d.i]![1]);
        r.hands.splice(d.i, 1, d.h[0], d.h[1]);
        bets.splice(d.i, 1, bets[d.i]!, bets[d.i]!);
      }
    } else if (type === "dealer_played") {
      const r = round!;
      expect(d.h).toBe(r.dealer[0]);
      r.dealer.push(...d.d);
      r.dealerPlayed = true;
      r.dealerBust = d.b === 1;
      expect(d.t).toBe(total(r.dealer));
      expect(d.b === 1).toBe(total(r.dealer) > 21);
    } else if (type === "hand_resolved") {
      const r = round!;
      expect(d.c).toEqual(r.hands[d.i]); // the hand's full cards
      const mine = total(r.hands[d.i]!);
      const theirs = total(r.dealer);
      const natural = r.hands.length === 1 && r.hands[0]!.length === 2 && mine === 21;
      let expected: { o: string; p: number };
      const bet = bets[d.i]!;
      if (natural) {
        expected =
          theirs === 21 && r.dealer.length === 2
            ? { o: "push", p: 0 }
            : { o: "blackjack", p: Math.ceil(bet * 1.5) };
      } else if (mine > 21) expected = { o: "lose", p: -bet };
      else if (theirs > 21 || mine > theirs) expected = { o: "win", p: bet };
      else if (mine === theirs) expected = { o: "push", p: 0 };
      else expected = { o: "lose", p: -bet };
      expect({ o: d.o, p: d.p }).toEqual(expected);
      r.payouts[d.i] = d.p;
      // `ch` is the chips after the round: the sum of every hand's payout.
      if (r.payouts.filter((x) => x !== undefined).length === r.hands.length) {
        chips += r.payouts.reduce((a, b) => a + b, 0);
        expect(d.ch).toBe(chips);
      }
    }
  }
  return { rounds, startingChips, chips };
}

// ---------------------------------------------------------------------------
// Golden replay
// ---------------------------------------------------------------------------

const cardCodes = (hand: readonly Card[]) =>
  hand.map(
    (c) =>
      `${c.rank === "10" ? "T" : c.rank}${"♠♥♦♣".indexOf(c.suit) >= 0 ? "SHDC"["♠♥♦♣".indexOf(c.suit)] : "?"}`
  );

describe("Blackjack golden replay (#3284)", () => {
  /** Plays the five scripted rounds; returns what the engine had at the end of each. */
  async function playRun() {
    const m = await mount();
    const truth: { hands: string[][]; dealer: string[]; chips: number }[] = [];
    const endRound = async () => {
      const e = m.ctx().engine!;
      truth.push({
        hands: e.split_count > 0 ? e.player_hands.map(cardCodes) : [cardCodes(e.player_hand)],
        dealer: cardCodes(e.dealer_hand),
        chips: e.chips,
      });
      await idle();
      await m.play(newHand);
    };
    // 1: split the eights, double the first hand, stand the second; the dealer busts
    await m.play((s) => placeBet(s, 10));
    await m.play(split, "split");
    await m.play(doubleDown, "double");
    await m.play(stand, "stand");
    await endRound();
    // 2: double down; the dealer stands on 17
    await m.play((s) => placeBet(s, 10));
    await m.play(doubleDown, "double");
    await endRound();
    // 3: a natural
    await m.play((s) => placeBet(s, 10));
    await endRound();
    // 4: hit and bust
    await m.play((s) => placeBet(s, 10));
    await m.play(hit, "hit");
    await endRound();
    // 5: stand on 19; the dealer draws twice and busts
    await m.play((s) => placeBet(s, 10));
    await m.play(stand, "stand");
    await endRound();
    return { m, truth };
  }

  it("rebuilds every card and the chip count from the saved events alone", async () => {
    const { m, truth } = await playRun();
    await act(async () => {
      await m.ctx().handleCashOut();
    });
    const rebuilt = rebuild(flat());

    expect(rebuilt.rounds).toHaveLength(5);
    expect(rebuilt.startingChips).toBe(100);
    expect(rebuilt.chips).toBe(truth[4]!.chips);
    expect(rebuilt.chips).toBe(165);
    rebuilt.rounds.forEach((r, i) => {
      expect(r.hands).toEqual(truth[i]!.hands);
      expect(r.dealer).toEqual(truth[i]!.dealer);
    });

    // The three cases the story names, with their cards.
    const [r1, r2, r3, r4, r5] = rebuilt.rounds;
    expect(r1!.hands).toEqual([
      ["8S", "3D", "9S"],
      ["8H", "KC"],
    ]); // a split, with a double on the first hand
    expect(r1!.dealer).toEqual(["6C", "TD", "TS"]);
    expect(r1!.dealerBust).toBe(true);
    expect(r1!.payouts).toEqual([20, 10]);
    expect(r2!.hands).toEqual([["5H", "6C", "9S"]]); // a double
    expect(r2!.dealer).toEqual(["TH", "7D"]);
    expect(r3!.hands).toEqual([["AS", "KD"]]);
    expect(r3!.dealerPlayed).toBe(false); // a natural: the dealer does not draw
    expect(r4!.hands).toEqual([["TS", "6D", "KH"]]);
    expect(r4!.dealerPlayed).toBe(false); // the player busted: the dealer does not play
    expect(r5!.dealer).toEqual(["6S", "5H", "4D", "8C"]);
    expect(r5!.dealerBust).toBe(true);
    // the shoe at each deal: 100 filler + the cards not yet dealt, less this deal
    expect(r1!.shoe).toEqual({ size: 312, remaining: 100 + DRAWS.length - 4 });
  });

  it("numbers the rounds as units and keeps the events in the order they happened", async () => {
    const { m } = await playRun();
    await act(async () => {
      await m.ctx().handleCashOut();
    });
    const events = flat();
    expect(events.map((e) => e.data.unit)).toEqual(
      events.map((e) => e.data.unit).sort((a, b) => (a as number) - (b as number))
    );
    expect([...new Set(events.map((e) => e.data.unit))]).toEqual([1, 2, 3, 4, 5]);
    // round 1, in order: the deal, the split, the double, the stand, the dealer, both hands
    expect(events.filter((e) => e.data.unit === 1).map((e) => e.type)).toEqual([
      "bet_placed",
      "hand_dealt",
      "player_action",
      "player_action",
      "player_action",
      "dealer_played",
      "hand_resolved",
      "hand_resolved",
    ]);
    for (const e of events) {
      expect(e.data.v).toBe(1);
      expect(e.data.t_ms).toEqual(expect.any(Number));
    }
  });

  it("matches the fixture the backend checks (regenerate with UPDATE_BLACKJACK_FIXTURE=1)", async () => {
    const { m } = await playRun();
    await act(async () => {
      await m.ctx().handleCashOut();
    });
    const events = flat().map((e) => ({ type: e.type, data: e.data }));
    const fixture = {
      comment:
        "A scripted Blackjack run recorded by the app (frontend/src/game/blackjack/__tests__/replay.golden.test.tsx): " +
        "a split with a double and a dealer bust, a double, a natural, a player bust and a dealer bust. " +
        "The backend's tests validate every event and render the run from it.",
      starting_chips: 100,
      final_chips: 165,
      events,
    };
    if (process.env.UPDATE_BLACKJACK_FIXTURE === "1") {
      fs.writeFileSync(FIXTURE, JSON.stringify(fixture, null, 2) + "\n");
    }
    expect(JSON.parse(fs.readFileSync(FIXTURE, "utf8"))).toEqual(
      JSON.parse(JSON.stringify(fixture))
    );
  });

  it("every event is within the byte cap the backend shares", async () => {
    const { m } = await playRun();
    await act(async () => {
      await m.ctx().handleCashOut();
    });
    for (const e of flat()) {
      expect(JSON.stringify(e.data).length).toBeLessThanOrEqual(
        queueConfig.BLACKJACK_EVENT_MAX_BYTES
      );
    }
  });
});

// ---------------------------------------------------------------------------
// One save per round, off the interaction path
// ---------------------------------------------------------------------------

describe("Blackjack recording: when it saves (#3284)", () => {
  it("saves nothing in the handler, then the whole round in one call at the next idle moment", async () => {
    const m = await mount();
    await m.play((s) => placeBet(s, 10));
    await m.play(split, "split");
    await m.play(doubleDown, "double");
    await m.play(stand, "stand"); // the round ends here
    // The handler returned and the render finished: nothing has been saved yet.
    expect(mockSaves).toHaveLength(0);

    await idle();
    expect(mockSaves).toHaveLength(1);
    expect(mockSaves[0]!.map((e) => e.type)).toEqual([
      "bet_placed",
      "hand_dealt",
      "player_action",
      "player_action",
      "player_action",
      "dealer_played",
      "hand_resolved",
      "hand_resolved",
    ]);
  });

  it("an open round is not saved by the idle moment, only a closed one", async () => {
    const m = await mount();
    await m.play((s) => placeBet(s, 10));
    await idle();
    expect(mockSaves).toHaveLength(0);
  });

  it("each round is one save: three rounds, three calls", async () => {
    const naturals = ["AS", "5C", "KD", "9H", "AH", "6D", "KS", "9C", "AD", "7C", "KH", "8S"];
    const m = await mount(
      newGame(scriptedDeck(naturals), {
        startingChips: TABLE.startingChips,
        runGoal: null,
        betMin: TABLE.betMin,
        betMax: TABLE.betMax,
      })
    );
    for (let round = 1; round <= 3; round += 1) {
      await m.play((s) => placeBet(s, 10)); // a natural settles on the deal
      expect(mockSaves).toHaveLength(round - 1);
      await idle();
      expect(mockSaves).toHaveLength(round);
      await m.play(newHand);
    }
    expect(mockSaves.map((save) => save.map((e) => e.type))).toEqual(
      Array(3).fill(["bet_placed", "hand_dealt", "hand_resolved"])
    );
  });

  it("the app going to the background saves the round so far, synchronously", async () => {
    let listener: ((state: string) => void) | undefined;
    const remove = jest.fn();
    jest.spyOn(AppState, "addEventListener").mockImplementation(((
      _type: string,
      cb: (state: string) => void
    ) => {
      listener = cb;
      return { remove };
    }) as never);
    const m = await mount();
    await m.play((s) => placeBet(s, 10));
    await m.play(hit, "hit");
    expect(mockSaves).toHaveLength(0);

    // No timer, no idle moment: the save is done when the listener returns.
    await act(async () => listener!("background"));
    expect(mockSaves).toHaveLength(1);
    expect(mockSaves[0]!.map((e) => e.type)).toEqual(["bet_placed", "hand_dealt", "player_action"]);

    // The round carries on under the same unit.
    await m.play(stand, "stand");
    await idle();
    expect(mockSaves).toHaveLength(2);
    expect(new Set(flat().map((e) => e.data.unit))).toEqual(new Set([1]));
  });

  it("going inactive saves too; coming back to the foreground does not", async () => {
    let listener: ((state: string) => void) | undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation(((
      _type: string,
      cb: (state: string) => void
    ) => {
      listener = cb;
      return { remove: jest.fn() };
    }) as never);
    const m = await mount();
    await m.play((s) => placeBet(s, 10));
    await act(async () => listener!("active"));
    expect(mockSaves).toHaveLength(0);
    await act(async () => listener!("inactive"));
    expect(mockSaves).toHaveLength(1);
  });

  it("removes the app-state listener when the provider unmounts", async () => {
    const remove = jest.fn();
    jest.spyOn(AppState, "addEventListener").mockImplementation((() => ({ remove })) as never);
    const m = await mount();
    await m.hook.unmount();
    expect(remove).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Resuming after a kill
// ---------------------------------------------------------------------------

describe("Blackjack recording: unit numbers after a resume (#3284, GAME-CONTRACT 2.10)", () => {
  /** A run killed in round 7, mid-hand. */
  function killedMidRound(): EngineState {
    const s = placeBet(startState(), 10);
    return { ...s, phase: "player", round: 7, player_hand: [card("5H"), card("6C")] };
  }

  it("a hand killed mid-round carries on as that round, not round 1", async () => {
    mockResume.mockReturnValue(true);
    const m = await mount(killedMidRound());
    await m.play(stand, "stand");
    await idle();
    const events = flat();
    expect(events.map((e) => e.type)).toEqual(["player_action", "dealer_played", "hand_resolved"]);
    expect(new Set(events.map((e) => e.data.unit))).toEqual(new Set([7]));
  });

  it("the next bet after a resume is the next round", async () => {
    mockResume.mockReturnValue(true);
    const saved: EngineState = { ...startState(), round: 7 };
    const m = await mount(saved);
    await m.play((s) => placeBet(s, 10));
    expect(m.ctx().engine?.round).toBe(8);
    await act(async () => {
      await m.ctx().handleCashOut();
    });
    expect(new Set(flat().map((e) => e.data.unit))).toEqual(new Set([8]));
  });

  it("a session that could not be continued still numbers from the saved game", async () => {
    mockResume.mockReturnValue(false);
    const m = await mount(killedMidRound());
    await m.play(stand, "stand");
    await idle();
    expect(new Set(flat().map((e) => e.data.unit))).toEqual(new Set([7]));
  });

  it("the round count is saved with the game and survives a rules change", async () => {
    const m = await mount({ ...startState(), round: 3 });
    await act(async () => {
      m.ctx().handleRulesChange({ hit_soft_17: true, deck_count: 6, penetration: 0.75 });
    });
    expect(m.ctx().engine?.round).toBe(3);
  });

  it("a fresh run starts at round 1", async () => {
    const m = await mount(startState());
    await m.play((s) => placeBet(s, 10));
    expect(m.ctx().engine?.round).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------------------

describe("Blackjack recording: the kill switch (#3284, #3279)", () => {
  it("with recording off for the game, nothing is recorded or saved", async () => {
    jest.spyOn(queueConfig, "isRecordingEnabled").mockReturnValue(false);
    const m = await mount();
    await m.play((s) => placeBet(s, 10));
    await m.play(split, "split");
    await m.play(doubleDown, "double");
    await m.play(stand, "stand");
    await idle();
    // the game itself played on as normal: two wins, 20 + 10 chips
    expect(m.ctx().engine?.chips).toBe(130);
    await act(async () => {
      await m.ctx().handleCashOut();
    });
    expect(mockSaves).toHaveLength(0);
  });

  it("the hand totals the stats use are unchanged by recording", () => {
    // A guard that the helper used for the golden test agrees with the engine's own.
    for (const hand of [
      ["8S", "3D", "9S"],
      ["AS", "KD"],
      ["TS", "6D", "KH"],
    ]) {
      expect(total(hand)).toBe(handValue(hand.map(card)));
    }
  });
});
