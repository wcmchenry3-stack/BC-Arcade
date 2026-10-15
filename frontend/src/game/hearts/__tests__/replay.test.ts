/**
 * Hearts replay recording (#3283, epic #3273): the card and event encodings,
 * their byte sizes against the registry caps, the unit rules of `HeartsReplay`
 * (a hand is two events, parts on a flush, a deal that survives a kill,
 * numbering that survives a resume), the kill switch, and the golden replay —
 * whole seeded games played through the real engine, AI and GameRecorder, then
 * rebuilt from the saved events alone, for all four seats.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { BugReportLimiter } from "../../_shared/bugReportLimiter";
import * as queueConfig from "../../_shared/eventQueueConfig";
import {
  HEARTS_HAND_OPENED_MAX_BYTES,
  HEARTS_HAND_PLAYED_MAX_BYTES,
  gameEventRegistry,
  recordingConfigFor,
  resetLogConfig,
} from "../../_shared/eventQueueConfig";
import { EventStore } from "../../_shared/eventStore";
import { GameEventClientImpl } from "../../_shared/gameEventClient";
import { GameRecorder, type RecordingDropReport } from "../../_shared/gameRecorder";
import { PendingGamesStore } from "../../_shared/pendingGamesStore";
import { createSeededRng, dealGame, isGameOver, setRng } from "../engine";
import {
  BLUR_MIN_TRICKS,
  HeartsReplay,
  MAX_PARTS_PER_HAND,
  TARGET_SCORE,
  cardCode,
  cardsCode,
  decodeCards,
  gameStartedData,
  handOpenedData,
  handScore,
  openedUnit,
  playedUnit,
  principleNumber,
  type PendingPort,
  type ReplayUnit,
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
const len = (value: unknown) => JSON.stringify(value).length;

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
  const withPass = (): HeartsState => ({
    ...dealGame("conservative"),
    passSelections: [hand("QSAH2C"), hand("3C4C5C"), hand("6D7D8D"), hand("9STSJS")],
  });

  it("hand_opened: hand number, direction index, the four hands and the cards passed", () => {
    const state = withPass();
    const data = handOpenedData(state, [[], [], [], []]);
    expect(data).toEqual({
      h: 1,
      d: 0,
      c: state.playerHands.map(cardsCode),
      p: ["QSAH2C", "3C4C5C", "6D7D8D", "9STSJS"],
    });
    expect((data.c as string[]).every((c) => c.length === 26)).toBe(true);
  });

  it("hand_opened: the CPU principles are 3 digits a seat, only when some exist", () => {
    const state = withPass();
    expect(
      handOpenedData(state, [[], ["P8-PASS", "P8-PASS", "P4-DANGER"], [], ["P8-PASS", null, null]])
    ).toMatchObject({ r: "000884000800" });
    expect(handOpenedData(state, [[], [null, null, null], [], []])).not.toHaveProperty("r");
  });

  it("hand_opened: a hold hand has no pass", () => {
    const hold: HeartsState = { ...dealGame("conservative"), handNumber: 4, passDirection: "none" };
    expect(handOpenedData(hold)).toEqual({ h: 4, d: 3, c: hold.playerHands.map(cardsCode) });
  });

  it("the hand's score: applied deltas, totals, and the shooter only on a moon", () => {
    const base = dealGame("conservative");
    const quiet: HeartsState = {
      ...base,
      scoreHistory: [[13, 0, 13, 0]],
      cumulativeScores: [13, 0, 13, 0],
      wonCards: [[], [], [], []],
    };
    expect(handScore(quiet)).toEqual({ s: [13, 0, 13, 0], t: [13, 0, 13, 0] });
    const hearts: Card[] = Array.from({ length: 13 }, (_, i) => ({
      suit: "hearts" as const,
      rank: (i + 1) as Card["rank"],
    }));
    const moon: HeartsState = {
      ...base,
      scoreHistory: [[26, 26, 0, 26]],
      cumulativeScores: [26, 26, 0, 26],
      wonCards: [[], [], [...hearts, { suit: "spades", rank: 12 }], []],
    };
    expect(handScore(moon)).toEqual({ s: [26, 26, 0, 26], t: [26, 26, 0, 26], m: 2 });
  });
});

// ---------------------------------------------------------------------------
// Sizes against the registry caps
// ---------------------------------------------------------------------------

describe("event sizes", () => {
  it("the registry holds a cap for each replay type, as the shared constants", () => {
    const events = gameEventRegistry.hearts.events;
    expect(events.hand_opened.maxBytes).toBe(HEARTS_HAND_OPENED_MAX_BYTES);
    expect(events.hand_played.maxBytes).toBe(HEARTS_HAND_PLAYED_MAX_BYTES);
    for (const type of ["hand_opened", "hand_played"] as const) {
      expect(events[type].tier).toBe(queueConfig.Priority.REPLAY);
      expect(capOf(type)).toBeLessThan(queueConfig.logConfig.MAX_EVENT_PAYLOAD_BYTES);
    }
  });

  it("the worst honest event of each type is the size the cap comment states, a third under its cap", () => {
    // hand 60, unit 900, a 10-digit t_ms, every number at its widest
    const env = { v: 1, unit: 900, t_ms: 2147483647 };
    const hand26 = "TCQDKHAS2C3D4H5S6C7D8H9STH".slice(0, 26);
    const opened = {
      ...env,
      h: 59,
      d: 2,
      c: [hand26, hand26, hand26, hand26],
      p: ["QSAH2C", "QSAH2C", "QSAH2C", "QSAH2C"],
      r: "888888888888",
    };
    const played = {
      ...env,
      h: 60,
      l: 3,
      c: "QSAH2C3D".repeat(13),
      r: "8888".repeat(13),
      s: [26, 26, 26, 0],
      t: [125, 125, 125, 125],
      m: 3,
    };
    expect([len(opened), len(played)]).toEqual([232, 264]);
    expect(len(opened)).toBeLessThanOrEqual(capOf("hand_opened") * 0.7);
    expect(len(played)).toBeLessThanOrEqual(capOf("hand_played") * 0.7);
  });

  describe("a whole game", () => {
    let game: PlayedGame;
    beforeAll(() => {
      game = playRecordedGame({});
    });

    it("is two events a hand, each under its type's cap, with the envelope", () => {
      const hands = game.final.scoreHistory.length;
      expect(game.saved).toHaveLength(2 * hands);
      for (const e of game.saved) {
        expect({ type: e.type, ok: len(e.data) <= capOf(e.type) }).toEqual({
          type: e.type,
          ok: true,
        });
        expect(e.data).toMatchObject({ v: 1, unit: expect.any(Number), t_ms: expect.any(Number) });
        expect(e.data).not.toHaveProperty("part");
      }
    });

    it("the recording stays far inside the session cap", () => {
      const total = game.saved.reduce((n, e) => n + len(e.data), 0);
      expect(total).toBeLessThan(caps.sessionMaxBytes / 4);
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

    /** A hand_opened whose JSON (envelope included) is exactly `target` long. */
    function paddedTo(target: number): Record<string, unknown> {
      const base = { ...handOpenedData(dealGame("conservative")), pad: "" };
      const bare = len({ v: 1, unit: 1, t_ms: 0, ...base });
      return { ...base, pad: "x".repeat(target - bare) };
    }

    it("an event exactly at its cap is saved whole", () => {
      const { recorder, saved, reports } = recorderFor();
      recorder.beginUnit(1);
      recorder.record("hand_opened", paddedTo(HEARTS_HAND_OPENED_MAX_BYTES));
      recorder.closeUnit();
      recorder.endSession();
      expect(saved).toHaveLength(1);
      expect(len((saved[0] as { data: unknown }).data)).toBe(HEARTS_HAND_OPENED_MAX_BYTES);
      expect(reports).toEqual([]);
    });

    it("one byte over is dropped and reported, not truncated or split", () => {
      const { recorder, saved, reports } = recorderFor();
      recorder.beginUnit(1);
      recorder.record("hand_opened", paddedTo(HEARTS_HAND_OPENED_MAX_BYTES + 1));
      recorder.closeUnit();
      recorder.endSession();
      expect(saved).toEqual([]);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ dropped_oversize: 1, saved: 0 });
    });
  });
});

// ---------------------------------------------------------------------------
// HeartsReplay: units, parts, the pending deal, resume
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

  const units = (calls: Call[]) => calls.filter((c) => c.op === "beginUnit").map((c) => c.arg);
  const recorded = (calls: Call[]) =>
    calls.filter((c) => c.op === "record").map((c) => c.arg as [string, Record<string, unknown>]);

  /** The trick that ends trick `tricksDone` of hand `h` (a quiet club trick led by seat 1). */
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

  const passing = (h = 2): HeartsState => ({
    ...dealGame("conservative"),
    handNumber: h,
    passSelections: [hand("2C3C4C"), hand("2D3D4D"), hand("2S3S4S"), hand("2H3H4H")],
  });

  it("numbers units by hand: the opening, then a part at the trick it starts, all unique and increasing", () => {
    expect(openedUnit(1)).toBe(1);
    expect(playedUnit(1, 1)).toBe(3);
    expect(playedUnit(1, 13)).toBe(15);
    expect(openedUnit(2)).toBe(16);
    const all = Array.from({ length: 16 }, (_, h) => [
      openedUnit(h + 1),
      ...Array.from({ length: 13 }, (_, n) => playedUnit(h + 1, n + 1)),
    ]).flat();
    expect(all).toEqual([...all].sort((a, b) => a - b));
    expect(new Set(all).size).toBe(all.length);
  });

  it("opens a pass hand when the pass is committed, as one unit", () => {
    const { sink, calls } = spySink();
    const replay = new HeartsReplay(sink);
    replay.dealt(passing()); // a pass hand: nothing until the pass
    expect(calls).toEqual([]);
    replay.passed(passing(), [[], [], [], []]);
    expect(calls.map((c) => c.op)).toEqual(["beginUnit", "record", "closeUnit"]);
    expect(calls[0]).toEqual({ op: "beginUnit", arg: openedUnit(2) });
    expect(recorded(calls)[0]![0]).toBe("hand_opened");
    expect(recorded(calls)[0]![1]).toHaveProperty("p");
  });

  it("opens a hold hand at the deal, with no pass", () => {
    const { sink, calls } = spySink();
    const replay = new HeartsReplay(sink);
    replay.dealt({ ...dealGame("conservative"), handNumber: 4, passDirection: "none" });
    expect(units(calls)).toEqual([openedUnit(4)]);
    expect(recorded(calls)[0]![1]).not.toHaveProperty("p");
  });

  it("keeps the tricks in memory and hands over one hand_played, with the score, when the hand ends", () => {
    const { sink, calls } = spySink();
    const replay = new HeartsReplay(sink);
    for (let n = 0; n < 12; n++) {
      const t = trickIn(3, n);
      replay.trick(t.prev, t.trick, t.next);
    }
    expect(calls).toEqual([]); // nothing reaches the recorder mid-hand
    const last = trickIn(3, 12, true);
    replay.trick(last.prev, last.trick, last.next);
    expect(units(calls)).toEqual([playedUnit(3, 1)]);
    const [[type, data]] = recorded(calls);
    expect(type).toBe("hand_played");
    expect(data).toMatchObject({ h: 3, l: 0, s: [13, 0, 13, 0], t: [13, 0, 13, 0] });
    expect(data).not.toHaveProperty("n");
    expect(data).not.toHaveProperty("r");
    expect((data.c as string).length).toBe(13 * 8);
  });

  it("a flush hands over the tricks so far as a part, and the rest follows as the next part", () => {
    const { sink, calls } = spySink();
    const replay = new HeartsReplay(sink);
    for (let n = 0; n < 5; n++) {
      const t = trickIn(3, n);
      replay.trick(t.prev, t.trick, t.next);
    }
    replay.flush();
    expect(calls.map((c) => c.op)).toEqual(["beginUnit", "record", "closeUnit", "flush"]);
    expect(units(calls)).toEqual([playedUnit(3, 1)]);
    expect((recorded(calls)[0]![1].c as string).length).toBe(5 * 8);
    expect(recorded(calls)[0]![1]).not.toHaveProperty("s"); // not the hand's end

    replay.flush(); // nothing new: nothing handed over again
    expect(recorded(calls)).toHaveLength(1);

    for (let n = 5; n < 12; n++) {
      const t = trickIn(3, n);
      replay.trick(t.prev, t.trick, t.next);
    }
    const last = trickIn(3, 12, true);
    replay.trick(last.prev, last.trick, last.next);
    expect(units(calls)).toEqual([playedUnit(3, 1), playedUnit(3, 6)]);
    const second = recorded(calls)[1]![1];
    expect(second).toMatchObject({ h: 3, n: 6, l: 0, s: [13, 0, 13, 0] });
    expect((second.c as string).length).toBe(8 * 8);
  });

  describe("parts are bounded", () => {
    function playTricks(replay: HeartsReplay, from: number, to: number) {
      for (let n = from; n < to; n++) {
        const t = trickIn(3, n);
        replay.trick(t.prev, t.trick, t.next);
      }
    }
    const partsOf = (calls: Call[]) => recorded(calls).filter(([t]) => t === "hand_played");

    it("a blur makes a part only for at least 3 tricks", () => {
      const { sink, calls } = spySink();
      const replay = new HeartsReplay(sink);
      playTricks(replay, 0, 2);
      replay.flush({ minTricks: BLUR_MIN_TRICKS });
      expect(partsOf(calls)).toHaveLength(0);
      expect(calls.filter((c) => c.op === "flush")).toHaveLength(1); // the queue still gets what the recorder holds
      playTricks(replay, 2, 3);
      replay.flush({ minTricks: BLUR_MIN_TRICKS });
      expect(partsOf(calls)).toHaveLength(1);
      expect((partsOf(calls)[0]![1].c as string).length).toBe(3 * 8);
    });

    it("opening the scorecard every trick makes no part at all", () => {
      const { sink, calls } = spySink();
      const replay = new HeartsReplay(sink);
      for (let n = 0; n < 12; n++) {
        playTricks(replay, n, n + 1);
        replay.flush({ minTricks: BLUR_MIN_TRICKS });
        if (n % 3 === 2) expect(partsOf(calls).length).toBeLessThanOrEqual(3);
      }
      expect(partsOf(calls).length).toBeLessThanOrEqual(MAX_PARTS_PER_HAND);
    });

    it("a hand has at most MAX_PARTS_PER_HAND parts before its last row, however often the app is backgrounded", () => {
      const { sink, calls } = spySink();
      const replay = new HeartsReplay(sink);
      for (let n = 0; n < 12; n++) {
        playTricks(replay, n, n + 1);
        replay.flush(); // the app is backgrounded after every trick
      }
      expect(partsOf(calls)).toHaveLength(MAX_PARTS_PER_HAND);
      const last = trickIn(3, 12, true);
      replay.trick(last.prev, last.trick, last.next);
      const rows = partsOf(calls);
      expect(rows).toHaveLength(MAX_PARTS_PER_HAND + 1);
      // nothing lost: the last row carries the tricks the cap held back, and the score
      expect(rows.map(([, d]) => (d.c as string).length / 8).reduce((a, b) => a + b, 0)).toBe(13);
      expect(rows[rows.length - 1]![1]).toHaveProperty("s");
    });

    it("leaving the game is not bounded: the tricks so far always go to the session", () => {
      const { sink, calls } = spySink();
      const replay = new HeartsReplay(sink);
      for (let n = 0; n < 6; n++) {
        playTricks(replay, n, n + 1);
        replay.flush();
      }
      expect(partsOf(calls)).toHaveLength(MAX_PARTS_PER_HAND);
      replay.flush({ force: true });
      expect(partsOf(calls)).toHaveLength(MAX_PARTS_PER_HAND + 1);
    });

    it("the count starts again with the next hand", () => {
      const { sink, calls } = spySink();
      const replay = new HeartsReplay(sink);
      for (let n = 0; n < 4; n++) {
        playTricks(replay, n, n + 1);
        replay.flush();
      }
      const t = trickIn(4, 0);
      replay.trick(t.prev, t.trick, t.next);
      replay.flush();
      expect(partsOf(calls).filter(([, d]) => d.h === 4)).toHaveLength(1);
    });
  });

  it("units made before a game session opens wait, in order, and go when it does", () => {
    const { sink, calls, setOpen } = spySink(false);
    const replay = new HeartsReplay(sink);
    replay.passed(passing(1), [[], [], [], []]);
    expect(calls).toEqual([]);
    setOpen(true);
    replay.publish();
    expect(units(calls)).toEqual([openedUnit(1)]);
    replay.publish();
    expect(units(calls)).toHaveLength(1);
  });

  it("keeps a bounded number of units for a session that never opens, dropping the newest", () => {
    const { sink, calls, setOpen } = spySink(false);
    const replay = new HeartsReplay(sink);
    for (let h = 1; h <= 100; h++) replay.passed(passing(h), [[], [], [], []]);
    setOpen(true);
    replay.publish();
    const begun = units(calls) as number[];
    expect(begun).toHaveLength(32);
    expect(begun[0]).toBe(openedUnit(1)); // a clean prefix, not a suffix
    expect(begun[31]).toBe(openedUnit(32));
  });

  it("reset forgets what waits (a new game starts clean)", () => {
    const { sink, calls } = spySink(false);
    const replay = new HeartsReplay(sink);
    const t = trickIn(1, 0);
    replay.passed(passing(1), [[], [], [], []]);
    replay.trick(t.prev, t.trick, t.next);
    replay.reset();
    replay.flush();
    expect(calls).toEqual([{ op: "flush" }]);
  });

  it("a game resumed after a kill carries on from its restored state: beginUnit(n) with the hand's and trick's own number", () => {
    const { sink, calls } = spySink();
    const replay = new HeartsReplay(sink);
    const t = trickIn(7, 8); // hand 7, 9th trick, nothing recorded in this process before
    replay.trick(t.prev, t.trick, t.next);
    replay.flush();
    expect(units(calls)).toEqual([playedUnit(7, 9)]);
    expect(recorded(calls)[0]![1]).toMatchObject({ h: 7, n: 9 });
    expect(playedUnit(7, 9)).toBe(6 * 15 + 2 + 9); // 101, not 1: no unit repeats one saved before the kill
  });

  it("a CPU play's principle belongs to its trick only", () => {
    const { sink, calls } = spySink();
    const replay = new HeartsReplay(sink);
    const a = trickIn(1, 0);
    const b = trickIn(1, 1);
    replay.notePlay(3, "P2-FREE-TRICK");
    replay.notePlay(2, null);
    replay.trick(a.prev, a.trick, a.next);
    replay.trick(b.prev, b.trick, b.next);
    replay.flush();
    // plays in order 0,1,2,3 for both tricks: seat 3 played P2 in the first only
    expect(recorded(calls)[0]![1].r).toBe("00020000");
  });

  describe("a deal kept across a kill (the pending port)", () => {
    function fakePort(log: Call[] = []) {
      let stored: ReplayUnit[] | null = null;
      const port: PendingPort = {
        save: (u) => {
          stored = [...u];
          log.push({ op: "port.save" });
        },
        clear: () => {
          stored = null;
          log.push({ op: "port.clear" });
        },
        flush: () => log.push({ op: "port.flush" }),
      };
      return { port, get: () => stored, log };
    }

    it("is written when a unit waits for a session, and cleared when it is handed over", () => {
      const { sink, setOpen } = spySink(false);
      const { port, get } = fakePort();
      const replay = new HeartsReplay(sink, port);
      replay.passed(passing(1), [[], [], [], []]);
      expect(get()?.map((u) => u.n)).toEqual([openedUnit(1)]);
      setOpen(true);
      replay.publish();
      expect(get()).toBeNull();
    });

    it("is not written when a session is open", () => {
      const { sink } = spySink(true);
      const { port, get } = fakePort();
      new HeartsReplay(sink, port).passed(passing(2), [[], [], [], []]);
      expect(get()).toBeNull();
    });

    it("is restored by a new process and handed over first when its session opens", () => {
      const first = spySink(false);
      const store = fakePort();
      new HeartsReplay(first.sink, store.port).passed(passing(1), [[], [], [], []]);
      const kept = store.get()!;

      // a new process: nothing in memory, a session not yet open
      const next = spySink(false);
      const replay = new HeartsReplay(next.sink, store.port);
      replay.restore(kept, 1);
      expect(next.calls).toEqual([]);
      expect(store.get()?.map((u) => u.n)).toEqual([openedUnit(1)]); // still kept
      next.setOpen(true);
      replay.publish();
      expect(units(next.calls)).toEqual([openedUnit(1)]);
      expect(recorded(next.calls)[0]![0]).toBe("hand_opened");
      expect(store.get()).toBeNull();
    });

    it("is dropped, not repeated, by a restore into an open session: it was handed over before the kill", () => {
      const { sink, calls } = spySink(true);
      const store = fakePort();
      const kept: ReplayUnit[] = [
        { n: openedUnit(5), events: [{ type: "hand_opened", data: { h: 5 } }] },
      ];
      const replay = new HeartsReplay(sink, store.port);
      replay.restore(kept, 5);
      replay.publish();
      expect(units(calls)).toEqual([]);
      expect(store.get()).toBeNull();
      expect(store.log.map((c) => c.op)).toEqual(["port.clear"]);
    });

    it("drops a stale hand when it restores the others", () => {
      const { sink, calls, setOpen } = spySink(false);
      const store = fakePort();
      const kept: ReplayUnit[] = [
        { n: openedUnit(1), events: [{ type: "hand_opened", data: { h: 1 } }] },
        { n: openedUnit(5), events: [{ type: "hand_opened", data: { h: 5 } }] },
      ];
      const replay = new HeartsReplay(sink, store.port);
      replay.restore(kept, 5);
      expect(store.get()?.map((u) => u.n)).toEqual([openedUnit(5)]);
      setOpen(true);
      replay.publish();
      expect(units(calls)).toEqual([openedUnit(5)]);
    });

    it("hands the unit to the queue (recorder flush) before it lets go of the kept copy", () => {
      const log: Call[] = [];
      const { sink, calls, setOpen } = spySink(false);
      const loggedSink: ReplaySink = {
        ...sink,
        closeUnit: () => {
          sink.closeUnit();
          log.push({ op: "closeUnit" });
        },
        flush: () => {
          sink.flush();
          log.push({ op: "recorder.flush" });
        },
      };
      const store = fakePort(log);
      const replay = new HeartsReplay(loggedSink, store.port);
      replay.passed(passing(1), [[], [], [], []]);
      setOpen(true);
      log.length = 0;
      replay.publish();
      // closeUnit only schedules an idle save: the queue must have it before the copy goes
      expect(log.map((c) => c.op)).toEqual(["closeUnit", "recorder.flush", "port.clear"]);
      expect(calls.filter((c) => c.op === "flush")).toHaveLength(1);
    });

    it("does not flush the recorder on a publish that kept no copy (the common case)", () => {
      const { sink, calls } = spySink(true);
      const replay = new HeartsReplay(sink, fakePort().port);
      replay.passed(passing(2), [[], [], [], []]);
      expect(calls.filter((c) => c.op === "flush")).toEqual([]);
    });

    it("clears the store on reset only when something may be stored", () => {
      const { sink } = spySink(true);
      const store = fakePort();
      const replay = new HeartsReplay(sink, store.port);
      replay.passed(passing(2), [[], [], [], []]); // session open: nothing stored
      replay.reset();
      expect(store.log).toEqual([]);

      const closed = spySink(false);
      const waiting = fakePort();
      const second = new HeartsReplay(closed.sink, waiting.port);
      second.passed(passing(1), [[], [], [], []]);
      second.reset();
      expect(waiting.log.map((c) => c.op)).toEqual(["port.save", "port.clear"]);
    });

    it("a flush asks the port to write what it put off", () => {
      const { sink } = spySink(false);
      const store = fakePort();
      const replay = new HeartsReplay(sink, store.port);
      replay.passed(passing(1), [[], [], [], []]);
      replay.flush();
      expect(store.log.map((c) => c.op)).toEqual(["port.save", "port.flush"]);
    });
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

  /** A whole game with the recorder's switch as given, saved into the real queue. */
  async function playToTheQueue(switchOn: boolean) {
    const { store, client, gameId } = await newClient();
    const saveMany = jest.spyOn(store, "enqueueMany");
    const saveEvent = jest.spyOn(store, "enqueueEvent");
    const setItem = AsyncStorage.setItem as jest.Mock;
    setItem.mockClear();
    const stringify = jest.spyOn(JSON, "stringify");
    const game = playRecordedGame({
      enabled: () => switchOn,
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

  it("with the switch off, the recorder keeps, saves, writes and serialises nothing", async () => {
    const off = await playToTheQueue(false);
    expect(off.game.saved).toEqual([]);
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

    const opened = game.saved.find((e) => e.type === "hand_opened")!.data as {
      h: number;
      p: string[];
    };
    expect(opened.h).toBe(1);
    expect(opened.p[0]!.startsWith("QS")).toBe(true); // seat 0 passed the queen, left to seat 1
    // the queen taker follows from the plays: whoever it is has the queen's 13 points
    expect(game.final.scoreHistory[0]![rebuilt.queenTakers[0]!]!).toBeGreaterThanOrEqual(13);
    // and seat 1 played it: with the pass removed from the record it cannot
    const without = game.saved.map((e) =>
      e.type === "hand_opened" && (e.data as { h: number }).h === 1
        ? { ...e, data: { ...e.data, p: undefined } }
        : e
    );
    expect(rebuildGame(without).problems.join("\n")).toMatch(/does not hold/);
  });

  it("a moon shot: the shooter's 0 and 26 for the others, all four seats' totals rebuilt", () => {
    setRng(createSeededRng(9));
    const game = playRecordedGame(moonShotOptions());
    expect(game.final.scoreHistory[MOON_HAND - 1]).toEqual([26, 0, 26, 26]);
    const rebuilt = expectRebuilt(game);
    expect(rebuilt.moon[MOON_HAND - 1]).toBe(MOON_SHOOTER);
    expect(rebuilt.deltas[MOON_HAND - 1]).toEqual([26, 0, 26, 26]);
    const scored = game.saved
      .filter((e) => e.type === "hand_played" && "s" in e.data)
      .map((e) => e.data as { h: number; s: number[]; m?: number });
    expect(scored.find((d) => d.h === MOON_HAND)).toMatchObject({
      s: [26, 0, 26, 26],
      m: MOON_SHOOTER,
    });
    expect(scored.filter((d) => d.m !== undefined)).toHaveLength(1);
  });

  it("a game flushed mid-hand (the app went to the background) rebuilds the same, from the parts", () => {
    setRng(createSeededRng(2));
    const whole = playRecordedGame({});
    setRng(createSeededRng(2));
    const parts = playRecordedGame({
      // background after the 3rd and 4th tricks of hand 2, and the 12th of hand 5
      flushAfter: (s) =>
        (s.handNumber === 2 && (s.tricksPlayedInHand === 3 || s.tricksPlayedInHand === 4)) ||
        (s.handNumber === 5 && s.tricksPlayedInHand === 12),
    });
    expect(parts.saved.length).toBe(whole.saved.length + 3);
    const partsOf2 = parts.saved
      .filter((e) => e.type === "hand_played" && (e.data as { h: number }).h === 2)
      .map((e) => e.data as { n?: number; unit: number; s?: unknown });
    expect(partsOf2.map((p) => p.n ?? 1)).toEqual([1, 4, 5]);
    expect(partsOf2.map((p) => p.unit)).toEqual([
      playedUnit(2, 1),
      playedUnit(2, 4),
      playedUnit(2, 5),
    ]);
    expect(partsOf2.map((p) => "s" in p)).toEqual([false, false, true]);
    const rebuilt = expectRebuilt(parts);
    expect(rebuilt.totals).toEqual(rebuildGame(whole.saved).totals);
  });

  it("records two events a hand, with the unit numbers the hand and trick give", () => {
    setRng(createSeededRng(2));
    const game = playRecordedGame({});
    const hands = game.final.scoreHistory.length;
    const unitOf = (type: string) => game.units.filter(([, t]) => t === type).map(([n]) => n);
    expect(unitOf("hand_opened")).toEqual(
      Array.from({ length: hands }, (_, i) => openedUnit(i + 1))
    );
    expect(unitOf("hand_played")).toEqual(
      Array.from({ length: hands }, (_, i) => playedUnit(i + 1, 1))
    );
    // a save per event: two a hand, not sixteen
    expect(game.saves).toEqual(Array.from({ length: 2 * hands }, () => 1));
  });

  describe("the rebuild notices a recorder that loses information", () => {
    let game: PlayedGame;
    beforeAll(() => {
      setRng(createSeededRng(3));
      game = playRecordedGame({});
    });

    it("without a pass, the receiving seat is missing cards it later plays", () => {
      const events = game.saved.map((e) =>
        e.type === "hand_opened" && "p" in e.data ? { ...e, data: { ...e.data, p: undefined } } : e
      );
      const rebuilt = rebuildGame(events);
      expect(rebuilt.problems.length).toBeGreaterThan(0);
      expect(rebuilt.problems[0]).toMatch(/does not hold/);
    });

    it("without a hand_played, the totals no longer add up", () => {
      const rebuilt = rebuildGame(game.saved.filter((e) => e.type !== "hand_played"));
      expect(rebuilt.totals).not.toEqual([...game.final.cumulativeScores]);
    });

    it("a card recorded wrongly is caught against the hands", () => {
      let done = false;
      const events = game.saved.map((e) => {
        if (done || e.type !== "hand_played") return e;
        done = true;
        const c = (e.data as { c: string }).c;
        return { ...e, data: { ...e.data, c: "2D3D4D5D" + c.slice(8) } };
      });
      expect(rebuildGame(events).problems.length).toBeGreaterThan(0);
    });

    it("a hand that ends without its score row is caught, at the next hand and at the end", () => {
      let seen = false;
      const noScore = game.saved.map((e) => {
        if (!seen && e.type === "hand_played" && "s" in e.data) {
          seen = true;
          const { s: _s, t: _t, m: _m, ...rest } = e.data as Record<string, unknown>;
          return { ...e, data: rest };
        }
        return e;
      });
      expect(rebuildGame(noScore).problems.join("\n")).toMatch(/ends without its score/);
      // the last hand: cut the game's final row
      const lastRow = game.saved.length - 1;
      expect(rebuildGame(game.saved.slice(0, lastRow)).problems.join("\n")).toMatch(
        /ends without its score/
      );
    });

    it("a part that skips a trick is caught", () => {
      setRng(createSeededRng(3));
      const parted = playRecordedGame({
        flushAfter: (s) => s.handNumber === 1 && s.tricksPlayedInHand === 4,
      });
      const events = parted.saved.filter(
        (e) =>
          !(
            e.type === "hand_played" &&
            (e.data as { n?: number }).n === undefined &&
            (e.data as { h: number }).h === 1
          )
      );
      expect(rebuildGame(events).problems.join("\n")).toMatch(/starts at trick 5, expected 1/);
    });
  });
});
