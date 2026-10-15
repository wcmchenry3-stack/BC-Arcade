/**
 * Hearts replay recording (#3283, epic #3273): the card and event encodings,
 * their byte sizes against the registry caps, the unit rules of `HeartsReplay`
 * (a trick saved after its collect animation, a synchronous flush, numbering
 * that survives a resume), the kill switch, and the golden replay — whole
 * seeded games played through the real engine, AI and GameRecorder, then
 * rebuilt from the saved events alone, for all four seats.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { BugReportLimiter } from "../../_shared/bugReportLimiter";
import * as queueConfig from "../../_shared/eventQueueConfig";
import {
  HEARTS_HAND_DEALT_MAX_BYTES,
  HEARTS_HAND_SCORED_MAX_BYTES,
  HEARTS_PASS_COMMITTED_MAX_BYTES,
  HEARTS_TRICK_COMPLETED_MAX_BYTES,
  gameEventRegistry,
  recordingConfigFor,
  resetLogConfig,
} from "../../_shared/eventQueueConfig";
import { EventStore } from "../../_shared/eventStore";
import { GameEventClientImpl } from "../../_shared/gameEventClient";
import { GameRecorder, type RecordingDropReport } from "../../_shared/gameRecorder";
import { PendingGamesStore } from "../../_shared/pendingGamesStore";
import { createSeededRng, dealGame, isGameOver, playCard, setRng } from "../engine";
import {
  HeartsReplay,
  TARGET_SCORE,
  cardCode,
  cardsCode,
  dealUnit,
  decodeCards,
  gameStartedData,
  handDealtData,
  handScoredData,
  passCommittedData,
  passUnit,
  principleNumber,
  trickCompletedData,
  trickUnit,
  type ReplaySink,
} from "../replay";
import type { PrincipleId } from "../conservative/terms";
import type { Card, HeartsState } from "../types";
import { SUITS } from "../types";
import {
  MOON_HAND,
  MOON_SHOOTER,
  hand,
  moonShotOptions,
  playRecordedGame,
  queenPassOptions,
  rebuildGame,
  type PlayedGame,
} from "./helpers/replayGame";

const caps = recordingConfigFor("hearts");
const capOf = (type: string) => queueConfig.recordingEventCap(caps, type);

const HEARTS_TYPES = ["hand_dealt", "pass_committed", "trick_completed", "hand_scored"] as const;

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

describe("card encoding", () => {
  const deck: Card[] = SUITS.flatMap((suit) =>
    Array.from({ length: 13 }, (_, i) => ({ suit, rank: (i + 1) as Card["rank"] }))
  );

  it("is two ASCII characters, rank then suit, and unique across the deck", () => {
    const codes = deck.map(cardCode);
    for (const code of codes) expect(code).toMatch(/^[2-9TJQKA][CDHS]$/);
    expect(new Set(codes).size).toBe(52);
  });

  it("names the face cards, the ten and the ace as the issue shows", () => {
    expect(cardCode({ suit: "spades", rank: 12 })).toBe("QS");
    expect(cardCode({ suit: "clubs", rank: 10 })).toBe("TC");
    expect(cardCode({ suit: "hearts", rank: 1 })).toBe("AH");
    expect(cardCode({ suit: "diamonds", rank: 2 })).toBe("2D");
  });

  it("joins a card list with no separator and decodes it back", () => {
    expect(cardsCode(hand("QSAH2C"))).toBe("QSAH2C");
    expect(cardsCode([])).toBe("");
    expect(decodeCards(cardsCode(deck))).toEqual(deck);
  });

  it("rejects a code that is not a card", () => {
    expect(() => decodeCards("1S")).toThrow(/Not a card/);
    expect(() => decodeCards("QX")).toThrow(/Not a card/);
  });
});

describe("principles", () => {
  const IDS: PrincipleId[] = [
    "P1-DUCK",
    "P2-FREE-TRICK",
    "P3-SHED",
    "P4-DANGER",
    "P5-QUEEN",
    "P6-DISCARD",
    "P7-MOON-GUARD",
    "P8-PASS",
    "P9-EXIT",
  ];

  it("is the n of P<n>-..., and 0 for none", () => {
    for (const id of IDS) expect(principleNumber(id)).toBe(Number(id.slice(1, 2)));
    expect(principleNumber(null)).toBe(0);
    expect(principleNumber(undefined)).toBe(0);
  });
});

describe("gameStartedData", () => {
  it("records the seats, the preset and the target score next to initial_score", () => {
    expect(gameStartedData("conservative")).toEqual({
      initial_score: 0,
      preset: "conservative",
      target: 100,
      seats: ["human", "conservative", "conservative", "conservative"],
    });
  });

  it("names each seat's persona on the mixed table", () => {
    expect(gameStartedData("mixed")).toEqual({
      initial_score: 0,
      preset: "mixed",
      target: 100,
      seats: ["human", "cautious", "schemer", "daring"],
    });
  });

  it("uses the engine's target score", () => {
    expect(isGameOver([TARGET_SCORE - 1, 0, 0, 0])).toBe(false);
    expect(isGameOver([0, 0, TARGET_SCORE, 0])).toBe(true);
  });
});

describe("event builders", () => {
  it("hand_dealt: hand number, pass direction index and the four hands, 13 cards each", () => {
    const state = dealGame("conservative");
    const data = handDealtData(state);
    expect(data).toEqual({ h: 1, d: 0, c: state.playerHands.map(cardsCode) });
    expect((data.c as string[]).every((c) => c.length === 26)).toBe(true);
  });

  it("pass_committed: the cards each seat passed, and the CPU principles only when some exist", () => {
    const state: HeartsState = {
      ...dealGame("conservative"),
      passSelections: [hand("QSAH2C"), hand("3C4C5C"), hand("6D7D8D"), hand("9STSJS")],
    };
    expect(passCommittedData(state, [[], [], [], []])).toEqual({
      h: 1,
      p: ["QSAH2C", "3C4C5C", "6D7D8D", "9STSJS"],
    });
    expect(
      passCommittedData(state, [
        [],
        ["P8-PASS", "P8-PASS", "P4-DANGER"],
        [],
        ["P8-PASS", null, null],
      ])
    ).toEqual({
      h: 1,
      p: ["QSAH2C", "3C4C5C", "6D7D8D", "9STSJS"],
      r: [0, [8, 8, 4], 0, [8, 0, 0]],
    });
  });

  describe("trick_completed and hand_scored", () => {
    /** A fresh hand where seat 2 leads the 2♣ and everyone follows clubs. */
    function openingTrick() {
      const hands = [hand("3C9HKH"), hand("4CQS5D"), hand("2CTD6D"), hand("5C7D8D")];
      const prev: HeartsState = {
        ...dealGame("conservative"),
        handNumber: 2,
        passDirection: "right",
        phase: "playing",
        playerHands: hands,
        currentLeaderIndex: 2,
        currentPlayerIndex: 2,
        passingComplete: true,
      };
      let s = prev;
      const plays: [number, Card][] = [
        [2, hand("2C")[0]!],
        [3, hand("5C")[0]!],
        [0, hand("3C")[0]!],
        [1, hand("4C")[0]!],
      ];
      for (const [seat, card] of plays) s = playCard(s, seat, card);
      return {
        prev,
        next: s,
        trick: plays.map(([playerIndex, card]) => ({ playerIndex, card })),
      };
    }

    it("a quiet trick: lead, cards in play order, winner; zero fields left out", () => {
      const { prev, next, trick } = openingTrick();
      expect(trickCompletedData(prev, trick, next, [0, 0, 0, 0])).toEqual({
        h: 2,
        n: 1,
        l: 2,
        c: "2C5C3C4C",
        w: 3,
      });
    });

    it("carries the CPU principles by play order, points, hearts broken and the queen", () => {
      const { prev, trick } = openingTrick();
      const next = {
        ...prev,
        currentLeaderIndex: 1,
        heartsBroken: true,
        tricksPlayedInHand: 6,
      } as HeartsState;
      const withQueen = [
        { playerIndex: 2, card: hand("2D")[0]! },
        { playerIndex: 3, card: hand("QS")[0]! },
        { playerIndex: 0, card: hand("9H")[0]! },
        { playerIndex: 1, card: hand("KD")[0]! },
      ];
      expect(
        trickCompletedData({ ...prev, tricksPlayedInHand: 6 }, withQueen, next, [0, 5, 0, 6])
      ).toEqual({
        h: 2,
        n: 7,
        l: 2,
        c: "2DQS9HKD",
        w: 1,
        pt: 14,
        hb: 1,
        q: 1,
        r: [0, 6, 0, 5],
      });
      expect(trick).toHaveLength(4);
    });

    it("hand_scored: the applied deltas, the totals, and the shooter only on a moon", () => {
      const base = dealGame("conservative");
      const quiet: HeartsState = {
        ...base,
        scoreHistory: [[13, 0, 13, 0]],
        cumulativeScores: [13, 0, 13, 0],
        wonCards: [[], [], [], []],
      };
      expect(handScoredData(quiet)).toEqual({ h: 1, s: [13, 0, 13, 0], t: [13, 0, 13, 0] });
      const shooter: Card[] = [
        ...SUITS.filter((s) => s === "hearts").flatMap((suit) =>
          Array.from({ length: 13 }, (_, i) => ({ suit, rank: (i + 1) as Card["rank"] }))
        ),
        { suit: "spades", rank: 12 },
      ];
      const moon: HeartsState = {
        ...base,
        scoreHistory: [[26, 26, 0, 26]],
        cumulativeScores: [26, 26, 0, 26],
        wonCards: [[], [], shooter, []],
      };
      expect(handScoredData(moon)).toEqual({ h: 1, s: [26, 26, 0, 26], t: [26, 26, 0, 26], m: 2 });
    });
  });
});

// ---------------------------------------------------------------------------
// Sizes against the registry caps
// ---------------------------------------------------------------------------

describe("event sizes", () => {
  const len = (value: unknown) => JSON.stringify(value).length;

  it("the registry holds a cap for each replay type, as the shared constants", () => {
    const events = gameEventRegistry.hearts.events;
    expect(events.hand_dealt.maxBytes).toBe(HEARTS_HAND_DEALT_MAX_BYTES);
    expect(events.pass_committed.maxBytes).toBe(HEARTS_PASS_COMMITTED_MAX_BYTES);
    expect(events.trick_completed.maxBytes).toBe(HEARTS_TRICK_COMPLETED_MAX_BYTES);
    expect(events.hand_scored.maxBytes).toBe(HEARTS_HAND_SCORED_MAX_BYTES);
    for (const type of HEARTS_TYPES) {
      expect(events[type].tier).toBe(queueConfig.Priority.REPLAY);
      expect(capOf(type)).toBeLessThan(queueConfig.logConfig.MAX_EVENT_PAYLOAD_BYTES);
    }
  });

  it("the worst honest event of each type is the size the cap comment states, a third under its cap", () => {
    // hand 60, unit 900, a 10-digit t_ms, every number at its widest
    const env = { v: 1, unit: 900, t_ms: 2147483647 };
    const hand26 = "TCQDKHAS2C3D4H5S6C7D8H9STH".slice(0, 26);
    const dealt = { ...env, h: 60, d: 3, c: [hand26, hand26, hand26, hand26] };
    const pass = {
      ...env,
      h: 59,
      p: ["QSAH2C", "QSAH2C", "QSAH2C", "QSAH2C"],
      r: [
        [8, 8, 8],
        [8, 8, 8],
        [8, 8, 8],
        [8, 8, 8],
      ],
    };
    const trick = {
      ...env,
      h: 60,
      n: 13,
      l: 3,
      c: "QSAH2C3D",
      w: 1,
      pt: 26,
      hb: 1,
      q: 1,
      r: [8, 8, 8, 8],
    };
    const scored = { ...env, h: 60, s: [26, 26, 26, 0], t: [125, 125, 125, 125], m: 3 };
    expect([len(dealt), len(pass), len(trick), len(scored)]).toEqual([171, 123, 112, 88]);
    expect(len(dealt)).toBeLessThanOrEqual(capOf("hand_dealt") * 0.7);
    expect(len(pass)).toBeLessThanOrEqual(capOf("pass_committed") * 0.7);
    expect(len(trick)).toBeLessThanOrEqual(capOf("trick_completed") * 0.7);
    expect(len(scored)).toBeLessThanOrEqual(capOf("hand_scored") * 0.7);
  });

  describe("a whole game", () => {
    let game: PlayedGame;
    beforeAll(() => {
      game = playRecordedGame({});
    });

    it("every saved event is under its type's cap, with the envelope", () => {
      expect(game.saved.length).toBeGreaterThan(0);
      for (const e of game.saved) {
        const size = len(e.data);
        expect({ type: e.type, ok: size <= capOf(e.type) }).toEqual({ type: e.type, ok: true });
        expect(e.data).toMatchObject({ v: 1, unit: expect.any(Number), t_ms: expect.any(Number) });
        expect(e.data).not.toHaveProperty("part");
      }
    });

    it("the recording stays far inside the session cap", () => {
      const total = game.saved.reduce((n, e) => n + len(e.data), 0);
      expect(total).toBeLessThan(caps.sessionMaxBytes / 2);
    });
  });

  describe("at the boundary of a cap (the recorder never truncates)", () => {
    function recorderFor() {
      const saved: unknown[] = [];
      const reports: RecordingDropReport[] = [];
      const recorder = new GameRecorder<"hearts">({
        gameType: "hearts",
        sink: {
          canAccept: () => true,
          enqueueMany: (batch) => {
            saved.push(...batch);
            return true;
          },
        },
        schedule: (task) => task(),
        report: (r) => reports.push(r),
      });
      recorder.startSession();
      return { recorder, saved, reports };
    }

    /** A hand_dealt whose JSON (envelope included) is exactly `target` long. */
    function paddedTo(target: number): Record<string, unknown> {
      const base = { ...handDealtData(dealGame("conservative")), pad: "" };
      const bare = len({ v: 1, unit: 1, t_ms: 0, ...base });
      return { ...base, pad: "x".repeat(target - bare) };
    }

    it("an event exactly at its cap is saved whole", () => {
      const { recorder, saved, reports } = recorderFor();
      recorder.beginUnit(1);
      recorder.record("hand_dealt", paddedTo(HEARTS_HAND_DEALT_MAX_BYTES));
      recorder.closeUnit();
      recorder.endSession();
      expect(saved).toHaveLength(1);
      expect(len((saved[0] as { data: unknown }).data)).toBe(HEARTS_HAND_DEALT_MAX_BYTES);
      expect(reports).toEqual([]);
    });

    it("one byte over is dropped and reported, not truncated or split", () => {
      const { recorder, saved, reports } = recorderFor();
      recorder.beginUnit(1);
      recorder.record("hand_dealt", paddedTo(HEARTS_HAND_DEALT_MAX_BYTES + 1));
      recorder.closeUnit();
      recorder.endSession();
      expect(saved).toEqual([]);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ dropped_oversize: 1, saved: 0 });
    });
  });
});

// ---------------------------------------------------------------------------
// HeartsReplay: units, the animation, flush, resume
// ---------------------------------------------------------------------------

describe("HeartsReplay", () => {
  interface Call {
    readonly op: string;
    readonly arg?: unknown;
  }

  function spySink(open = true): {
    sink: ReplaySink;
    calls: Call[];
    setOpen: (v: boolean) => void;
  } {
    const calls: Call[] = [];
    let isOpen = open;
    const sink: ReplaySink = {
      isOpen: () => isOpen,
      beginUnit: (n) => {
        calls.push({ op: "beginUnit", arg: n });
        return n;
      },
      record: (type, data) => calls.push({ op: "record", arg: [type, data] }),
      closeUnit: () => calls.push({ op: "closeUnit" }),
      flush: () => calls.push({ op: "flush" }),
    };
    return { sink, calls, setOpen: (v) => (isOpen = v) };
  }

  /** The trick that ends trick `tricksDone` of hand `h`, played from a crafted `prev`. */
  function trickIn(h: number, tricksDone: number, over = false) {
    const prev = {
      ...dealGame("conservative"),
      handNumber: h,
      phase: "playing",
      tricksPlayedInHand: tricksDone,
    } as HeartsState;
    const next = {
      ...prev,
      tricksPlayedInHand: tricksDone + 1,
      currentLeaderIndex: 1,
      phase: over ? "dealing" : "playing",
      scoreHistory: [[13, 0, 13, 0]],
      cumulativeScores: [13, 0, 13, 0],
      wonCards: [[], [], [], []],
    } as HeartsState;
    const trick = [
      { playerIndex: 0, card: hand("2C")[0]! },
      { playerIndex: 1, card: hand("KC")[0]! },
      { playerIndex: 2, card: hand("3C")[0]! },
      { playerIndex: 3, card: hand("4C")[0]! },
    ];
    return { prev, next, trick };
  }

  it("numbers units by hand and trick: deal, pass, then the 13 tricks, 15 to a hand", () => {
    expect(dealUnit(1)).toBe(1);
    expect(passUnit(1)).toBe(2);
    expect(trickUnit(1, 1)).toBe(3);
    expect(trickUnit(1, 13)).toBe(15);
    expect(dealUnit(2)).toBe(16);
    const all = Array.from({ length: 16 }, (_, h) => [
      dealUnit(h + 1),
      passUnit(h + 1),
      ...Array.from({ length: 13 }, (_, n) => trickUnit(h + 1, n + 1)),
    ]).flat();
    expect(all).toEqual(Array.from({ length: all.length }, (_, i) => i + 1));
  });

  it("holds a trick until its collect animation is over, then hands it over as one unit", () => {
    const { sink, calls } = spySink();
    const replay = new HeartsReplay(sink, () => true);
    const { prev, next, trick } = trickIn(2, 4);
    replay.trick(prev, trick, next);
    expect(calls).toEqual([]); // nothing reaches the recorder during the animation
    replay.settle();
    expect(calls.map((c) => c.op)).toEqual(["beginUnit", "record", "closeUnit"]);
    expect(calls[0]).toEqual({ op: "beginUnit", arg: trickUnit(2, 5) });
    expect((calls[1]!.arg as [string, unknown])[0]).toBe("trick_completed");
    replay.settle(); // a second settle has nothing left
    expect(calls).toHaveLength(3);
  });

  it("a trick that ends the hand needs no animation: it goes at once with hand_scored in the same unit", () => {
    const { sink, calls } = spySink();
    const replay = new HeartsReplay(sink, () => true);
    const { prev, next, trick } = trickIn(1, 12, true);
    replay.trick(prev, trick, next);
    expect(calls.map((c) => c.op)).toEqual(["beginUnit", "record", "record", "closeUnit"]);
    expect(calls[0]).toEqual({ op: "beginUnit", arg: trickUnit(1, 13) });
    expect(calls.slice(1, 3).map((c) => (c.arg as [string])[0])).toEqual([
      "trick_completed",
      "hand_scored",
    ]);
  });

  it("a new trick settles a trick whose animation never reported", () => {
    const { sink, calls } = spySink();
    const replay = new HeartsReplay(sink, () => true);
    const a = trickIn(1, 0);
    const b = trickIn(1, 1);
    replay.trick(a.prev, a.trick, a.next);
    replay.trick(b.prev, b.trick, b.next);
    expect(calls.filter((c) => c.op === "beginUnit").map((c) => c.arg)).toEqual([trickUnit(1, 1)]);
    replay.settle();
    expect(calls.filter((c) => c.op === "beginUnit").map((c) => c.arg)).toEqual([
      trickUnit(1, 1),
      trickUnit(1, 2),
    ]);
  });

  it("flush hands over the trick still in its animation and saves synchronously, once", () => {
    const { sink, calls } = spySink();
    const replay = new HeartsReplay(sink, () => true);
    const { prev, next, trick } = trickIn(3, 6);
    replay.trick(prev, trick, next);
    replay.flush();
    expect(calls.map((c) => c.op)).toEqual(["beginUnit", "record", "closeUnit", "flush"]);
    expect(calls[0]).toEqual({ op: "beginUnit", arg: trickUnit(3, 7) });
    replay.flush();
    expect(calls.filter((c) => c.op === "record")).toHaveLength(1); // not recorded twice
  });

  it("units made before a game session opens wait, in order, and go when it does", () => {
    const { sink, calls, setOpen } = spySink(false);
    const replay = new HeartsReplay(sink, () => true);
    replay.dealt(dealGame("conservative"));
    replay.passed(
      {
        ...dealGame("conservative"),
        passSelections: [hand("2C3C4C"), hand("2D3D4D"), hand("2S3S4S"), hand("2H3H4H")],
      },
      [[], [], [], []]
    );
    expect(calls).toEqual([]);
    setOpen(true);
    replay.publish();
    expect(calls.filter((c) => c.op === "beginUnit").map((c) => c.arg)).toEqual([
      dealUnit(1),
      passUnit(1),
    ]);
    replay.publish();
    expect(calls.filter((c) => c.op === "beginUnit")).toHaveLength(2);
  });

  it("keeps a bounded number of units for a session that never opens", () => {
    const { sink, calls, setOpen } = spySink(false);
    const replay = new HeartsReplay(sink, () => true);
    for (let i = 0; i < 100; i++) replay.dealt({ ...dealGame("conservative"), handNumber: i + 1 });
    setOpen(true);
    replay.publish();
    const begun = calls.filter((c) => c.op === "beginUnit").map((c) => c.arg as number);
    expect(begun).toHaveLength(32);
    expect(begun[0]).toBe(dealUnit(1)); // a clean prefix, not a suffix
  });

  it("reset forgets what waits (a new game starts clean)", () => {
    const { sink, calls } = spySink(false);
    const replay = new HeartsReplay(sink, () => true);
    const { prev, next, trick } = trickIn(1, 0);
    replay.dealt(dealGame("conservative"));
    replay.trick(prev, trick, next);
    replay.reset();
    replay.flush();
    expect(calls).toEqual([{ op: "flush" }]);
  });

  it("a game resumed after a kill carries on from its restored state: beginUnit(n) with the hand's and trick's own number", () => {
    // A fresh HeartsReplay, as after a restart: nothing recorded in this process.
    const { sink, calls } = spySink();
    const replay = new HeartsReplay(sink, () => true);
    const { prev, next, trick } = trickIn(7, 8); // hand 7, 9th trick
    replay.trick(prev, trick, next);
    replay.settle();
    expect(calls[0]).toEqual({ op: "beginUnit", arg: trickUnit(7, 9) });
    expect(trickUnit(7, 9)).toBe(6 * 15 + 2 + 9); // 101, not 1: no unit repeats one saved before the kill
  });

  it("a CPU play's principle belongs to its trick only", () => {
    const { sink, calls } = spySink();
    const replay = new HeartsReplay(sink, () => true);
    const a = trickIn(1, 0);
    const b = trickIn(1, 1);
    replay.notePlay(3, "P2-FREE-TRICK");
    replay.notePlay(2, null);
    replay.trick(a.prev, a.trick, a.next);
    replay.trick(b.prev, b.trick, b.next);
    replay.settle();
    const records = calls
      .filter((c) => c.op === "record")
      .map((c) => c.arg as [string, Record<string, unknown>]);
    expect(records[0]![1].r).toEqual([0, 0, 0, 2]); // plays in order 0,1,2,3: seat 3 played P2
    expect(records[1]![1]).not.toHaveProperty("r");
  });
});

// ---------------------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------------------

describe("kill switch (fail-safe)", () => {
  async function newClient() {
    await AsyncStorage.clear();
    resetLogConfig();
    const store = new EventStore();
    const client = new GameEventClientImpl(store, new PendingGamesStore(), new BugReportLimiter());
    await client.init();
    const gameId = client.startGame("hearts");
    client.markStarted(gameId);
    await new Promise((r) => setTimeout(r, 10));
    return { store, client, gameId };
  }

  afterEach(() => {
    jest.restoreAllMocks();
    resetLogConfig();
  });

  async function playToTheQueue(switchOn: boolean) {
    const { store, client, gameId } = await newClient();
    const saveMany = jest.spyOn(store, "enqueueMany");
    const saveEvent = jest.spyOn(store, "enqueueEvent");
    const setItem = AsyncStorage.setItem as jest.Mock;
    setItem.mockClear();
    jest.spyOn(queueConfig, "isRecordingEnabled").mockReturnValue(switchOn);
    const stringify = jest.spyOn(JSON, "stringify");
    const game = playRecordedGame({
      onSave: (batch) => {
        client.enqueueEvents(gameId, batch);
      },
    });
    const stringified = stringify.mock.calls.length;
    stringify.mockRestore();
    await new Promise((r) => setTimeout(r, 10));
    return {
      game,
      stringified,
      saves: saveMany.mock.calls.length + saveEvent.mock.calls.length,
      writes: setItem.mock.calls.length,
    };
  }

  it("with the switch on, a game reaches the queue (the control)", async () => {
    const on = await playToTheQueue(true);
    expect(on.game.saved.length).toBeGreaterThan(0);
    expect(on.saves).toBeGreaterThan(0);
    expect(on.writes).toBeGreaterThan(0);
  });

  it("with the switch off, nothing is recorded, saved or written, and nothing is serialised", async () => {
    const off = await playToTheQueue(false);
    expect(off.game.saved).toEqual([]);
    expect(off.game.units).toEqual([]);
    expect(off.saves).toBe(0);
    expect(off.writes).toBe(0);
    expect(off.stringified).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Golden replay: whole games rebuilt from the saved events alone
// ---------------------------------------------------------------------------

describe("golden replay", () => {
  function expectRebuilt(game: PlayedGame) {
    const rebuilt = rebuildGame(game.saved);
    expect(rebuilt.problems).toEqual([]);
    // all four seats' scores, from the events alone
    expect(rebuilt.totals).toEqual([...game.final.cumulativeScores]);
    expect(rebuilt.deltas).toEqual(game.final.scoreHistory.map((row) => [...row]));
    expect(rebuilt.hands.every((h) => h.length === 0)).toBe(true); // every card was played
    return rebuilt;
  }

  it.each([1, 2, 3, 11])(
    "a seeded game (seed %i) rebuilds its scores for all four seats",
    (seed) => {
      setRng(createSeededRng(seed));
      const game = playRecordedGame({});
      expect(game.final.phase).toBe("game_over");
      expect(game.final.scoreHistory.length).toBeGreaterThanOrEqual(4);
      expect(Math.max(...game.final.cumulativeScores)).toBeGreaterThanOrEqual(TARGET_SCORE);
      expectRebuilt(game);
    }
  );

  it("a hand where the queen is passed: the receiver holds it, plays it, and the pass decides the rebuild", () => {
    setRng(createSeededRng(5));
    const game = playRecordedGame(queenPassOptions());
    const rebuilt = expectRebuilt(game);

    const pass = game.saved.find((e) => e.type === "pass_committed")!.data as {
      h: number;
      p: string[];
    };
    expect(pass.h).toBe(1);
    expect(pass.p[0]!.startsWith("QS")).toBe(true); // seat 0 passed the queen, left to seat 1
    const queenTrick = game.saved
      .filter((e) => e.type === "trick_completed")
      .map((e) => e.data as { h: number; l: number; c: string; q?: number; w: number })
      .find((t) => t.h === 1 && t.c.includes("QS"))!;
    const seatOfQueen = (queenTrick.l + queenTrick.c.indexOf("QS") / 2) % 4;
    expect(seatOfQueen).toBe(1);
    expect(queenTrick.q).toBe(1);
    expect(rebuilt.queenTakers[0]).toBe(queenTrick.w);
    // the queen's 13 points are in hand 1's deltas for whoever took it
    expect(game.final.scoreHistory[0]![queenTrick.w]!).toBeGreaterThanOrEqual(13);
  });

  it("a moon shot: the shooter's 0 and 26 for the others, all four seats' totals rebuilt", () => {
    setRng(createSeededRng(9));
    const game = playRecordedGame(moonShotOptions());
    expect(game.final.scoreHistory[MOON_HAND - 1]).toEqual([26, 0, 26, 26]);
    const rebuilt = expectRebuilt(game);
    expect(rebuilt.moon[MOON_HAND - 1]).toBe(MOON_SHOOTER);
    expect(rebuilt.deltas[MOON_HAND - 1]).toEqual([26, 0, 26, 26]);
    const scored = game.saved
      .filter((e) => e.type === "hand_scored")
      .map((e) => e.data as { h: number; s: number[]; m?: number });
    expect(scored.find((d) => d.h === MOON_HAND)).toMatchObject({
      s: [26, 0, 26, 26],
      m: MOON_SHOOTER,
    });
    expect(scored.filter((d) => d.m !== undefined)).toHaveLength(1);
  });

  it("records one recorder unit per trick, with the unit numbers the hand and trick give", () => {
    setRng(createSeededRng(2));
    const game = playRecordedGame({});
    const hands = game.final.scoreHistory.length;
    const unitOf = (type: string) => game.units.filter(([, t]) => t === type).map(([n]) => n);
    expect(unitOf("hand_dealt")).toEqual(Array.from({ length: hands }, (_, i) => dealUnit(i + 1)));
    expect(unitOf("trick_completed")).toHaveLength(13 * hands);
    expect(new Set(unitOf("trick_completed")).size).toBe(13 * hands); // one unit per trick
    // hand_scored rides on the 13th trick's unit: no unit of its own
    expect(unitOf("hand_scored")).toEqual(
      Array.from({ length: hands }, (_, i) => trickUnit(i + 1, 13))
    );
    // the recorder saved a deal, a pass (3 hands in 4) and a trick per save: no more saves than units
    const units = new Set(game.units.map(([n]) => n));
    expect(game.saves.length).toBeLessThanOrEqual(units.size);
    expect(game.saved.filter((e) => e.type === "pass_committed")).toHaveLength(
      Array.from({ length: hands }, (_, i) => i + 1).filter((h) => h % 4 !== 0).length
    );
  });

  describe("the rebuild notices a recorder that loses information", () => {
    let game: PlayedGame;
    beforeAll(() => {
      setRng(createSeededRng(3));
      game = playRecordedGame({});
    });

    it("without a pass_committed, the receiving seat is missing cards it later plays", () => {
      const rebuilt = rebuildGame(game.saved.filter((e) => e.type !== "pass_committed"));
      expect(rebuilt.problems.length).toBeGreaterThan(0);
      expect(rebuilt.problems[0]).toMatch(/does not hold/);
    });

    it("without a trick, a hand's points and the totals no longer add up", () => {
      let dropped = false;
      const rebuilt = rebuildGame(
        game.saved.filter((e) => {
          if (!dropped && e.type === "trick_completed" && (e.data as { pt?: number }).pt) {
            dropped = true;
            return false;
          }
          return true;
        })
      );
      expect(dropped).toBe(true);
      expect(rebuilt.problems.length).toBeGreaterThan(0);
    });

    it("a card recorded wrongly is caught against the hands", () => {
      const events = game.saved.map((e) =>
        e.type === "trick_completed" && (e.data as { h: number; n: number }).n === 2
          ? { ...e, data: { ...e.data, c: "2D3D4D5D" } }
          : e
      );
      expect(rebuildGame(events).problems.length).toBeGreaterThan(0);
    });
  });
});
