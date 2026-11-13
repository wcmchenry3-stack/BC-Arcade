/**
 * Blackjack replay builders (#3284): the round log's fields, the compact card
 * encoding, byte sizes against the cap, and the recorder's behaviour at that cap
 * and with the kill switch off.
 */
import type { EnqueueEventInput } from "../../_shared/gameEventClient";
import {
  BLACKJACK_EVENT_MAX_BYTES,
  BLACKJACK_SESSION_MAX_BYTES,
  gameEventRegistry,
  recordingConfigFor,
  recordingEventCap,
} from "../../_shared/eventQueueConfig";
import { GameRecorder } from "../../_shared/gameRecorder";
import {
  doubleDown,
  hit,
  newGame,
  placeBet,
  split,
  stand,
  standOnTwentyOne,
  type Card,
  type EngineState,
} from "../engine";
import {
  autoStands,
  encodeCard,
  handResolvedData,
  logAction,
  logDealer,
  openRoundLog,
  resumedRoundLog,
  roundPlayedData,
  type RecordedAction,
} from "../replay";

const SUITS: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
function card(code: string): Card {
  const r = code.slice(0, -1);
  return { rank: r === "T" ? "10" : r, suit: SUITS[code.slice(-1)]! };
}
/** A fresh game that will deal `draws` in order (the engine draws from the end). */
function gameWith(draws: readonly string[], chips = 100): EngineState {
  const filler = Array.from({ length: 100 }, () => card("2C"));
  return newGame([...filler, ...[...draws].reverse().map(card)], {
    startingChips: chips,
    runGoal: null,
    betMin: 5,
    betMax: 25,
  });
}

/** The recorder's envelope at its widest: a 5-digit unit and a day of play in ms. */
const WIDEST_ENVELOPE = { v: 1, unit: 99_999, t_ms: 86_400_000 };
const size = (data: Record<string, unknown>) =>
  JSON.stringify({ ...data, ...WIDEST_ENVELOPE }).length;

describe("card encoding", () => {
  it("is the rank and the suit, with T for ten", () => {
    expect(encodeCard({ rank: "Q", suit: "♠" })).toBe("QS");
    expect(encodeCard({ rank: "10", suit: "♥" })).toBe("TH");
    expect(encodeCard({ rank: "A", suit: "♦" })).toBe("AD");
    expect(encodeCard({ rank: "2", suit: "♣" })).toBe("2C");
  });

  it("gives all 52 cards a distinct two-character code", () => {
    const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    const codes = new Set<string>();
    for (const suit of Object.values(SUITS)) {
      for (const rank of ranks) {
        const code = encodeCard({ rank, suit });
        expect(code).toMatch(/^[A2-9TJQK][SHDC]$/);
        codes.add(code);
      }
    }
    expect(codes.size).toBe(52);
  });
});

describe("the round log", () => {
  it("the bet and the deal: chips from before the bet, both hands, the shoe and what is left", () => {
    const prev = gameWith(["TS", "6C", "9D", "7H"]);
    const next = placeBet(prev, 25);
    expect(roundPlayedData(openRoundLog(prev, next))).toEqual({
      b: [25, 100],
      p: ["TS", "9D"],
      d: ["6C", "7H"], // [hole, up]
      sh: 312,
      rem: 100,
    });
  });

  it("a natural reports the chips before the bet, not after the payout", () => {
    const prev = gameWith(["AS", "6C", "KD", "7H"]);
    const next = placeBet(prev, 10); // 3:2 on the spot
    expect(next.chips).toBe(115);
    expect(openRoundLog(prev, next).b).toEqual([10, 100]);
  });

  it("a hit and a double carry the card they drew, a stand carries nothing", () => {
    const dealt = placeBet(gameWith(["5S", "TC", "6D", "7H", "9C", "2D"]), 10);
    const log = openRoundLog(gameWith([]), dealt);
    const afterHit = hit(dealt);
    logAction(log, dealt, afterHit, "hit");
    logAction(log, afterHit, stand(afterHit), "stand");
    expect(log.a).toEqual([
      ["h", 0, "9C"],
      ["s", 0],
    ]);
    const doubled = openRoundLog(gameWith([]), dealt);
    logAction(doubled, dealt, doubleDown(dealt), "double");
    expect(doubled.a).toEqual([["d", 0, "9C"]]);
  });

  it("a split carries both resulting hands", () => {
    const dealt = placeBet(gameWith(["8S", "TC", "8H", "7D", "3D", "KC"]), 10);
    const log = openRoundLog(gameWith([]), dealt);
    logAction(log, dealt, split(dealt), "split");
    expect(log.a).toEqual([
      [
        "p",
        0,
        [
          ["8S", "3D"],
          ["8H", "KC"],
        ],
      ],
    ]);
  });

  it("a hit on the second split hand names that hand", () => {
    const dealt = placeBet(gameWith(["8S", "TC", "8H", "7D", "3D", "KC", "2H"]), 10);
    const afterStand = stand(split(dealt)); // hand 0 done, hand 1 active
    expect(afterStand.active_hand_index).toBe(1);
    const log = openRoundLog(gameWith([]), dealt);
    logAction(log, afterStand, hit(afterStand), "hit");
    expect(log.a).toEqual([["h", 1, "2H"]]);
  });

  it("the dealer's play: the draws, the total and the bust flag", () => {
    const dealt = placeBet(gameWith(["TS", "6C", "9D", "TD", "TH"]), 10);
    const log = openRoundLog(gameWith([]), dealt);
    logDealer(log, dealt, stand(dealt));
    expect(log.dl).toEqual({ d: ["TH"], t: 26, b: 1 });
  });

  it("a dealer that stands draws nothing, and sends no bust flag", () => {
    const dealt = placeBet(gameWith(["TS", "TC", "9D", "7D"]), 10);
    const log = openRoundLog(gameWith([]), dealt);
    logDealer(log, dealt, stand(dealt));
    expect(log.dl).toEqual({ d: [], t: 17 });
  });

  it("no dealer play when the player busts, on a natural, or mid-round", () => {
    const dealt = placeBet(gameWith(["TS", "7C", "6D", "8H", "KH"]), 10);
    const bust = openRoundLog(gameWith([]), dealt);
    logDealer(bust, dealt, hit(dealt));
    expect(bust.dl).toBeUndefined();
    const natural = gameWith(["AS", "5C", "KD", "9H"]);
    const nlog = openRoundLog(natural, placeBet(natural, 10));
    logDealer(nlog, natural, placeBet(natural, 10));
    expect(nlog.dl).toBeUndefined();
    const mid = openRoundLog(gameWith([]), dealt);
    logDealer(mid, dealt, dealt);
    expect(mid.dl).toBeUndefined();
  });

  it("after a split the dealer plays once, for all the hands", () => {
    const dealt = placeBet(gameWith(["8S", "6C", "8H", "TD", "3D", "KC", "TS"]), 10);
    const split1 = split(dealt);
    const mid = stand(split1);
    const log = openRoundLog(gameWith([]), dealt);
    logDealer(log, split1, mid);
    expect(log.dl).toBeUndefined(); // hand 1 still to act
    logDealer(log, mid, stand(mid));
    expect(log.dl).toEqual({ d: ["TS"], t: 26, b: 1 });
  });

  it("the payload leaves out what is empty: a natural has no actions and no dealer", () => {
    const natural = gameWith(["AS", "5C", "KD", "9H"]);
    const data = roundPlayedData(openRoundLog(natural, placeBet(natural, 10)));
    expect(data).not.toHaveProperty("a");
    expect(data).not.toHaveProperty("dl");
    expect(data).not.toHaveProperty("r");
  });

  it("a dealer natural found by the peek (#3741): the deal and the chips before it, no actions, no dealer play", () => {
    const game = gameWith(["TS", "KC", "8H", "AD"]);
    const settled = placeBet(game, 10);
    expect(settled.outcome).toBe("lose");
    const log = openRoundLog(game, settled);
    logDealer(log, game, settled);
    expect(roundPlayedData(log)).toEqual({
      b: [10, 100],
      p: ["TS", "8H"],
      d: ["KC", "AD"],
      sh: 312,
      rem: 100,
    });
    expect(
      handResolvedData(0, settled.outcome!, settled.payout, settled.chips, settled.player_hand)
    ).toEqual({
      i: 0,
      o: "lose",
      p: -10,
      ch: 90,
      c: ["TS", "8H"],
    });
  });

  it("a round found mid-hand after a kill has no deal and is marked resumed", () => {
    const s = { ...placeBet(gameWith(["8S", "6C", "8H", "TD"]), 10), round: 7 };
    expect(roundPlayedData(resumedRoundLog(s))).toEqual({
      b: [10, 100],
      d: ["6C", "TD"],
      sh: 312,
      rem: 100,
      r: 1,
    });
  });

  it("hand_resolved: the hand's full cards, outcome, payout and the chips after", () => {
    expect(handResolvedData(1, "lose", -20, 80, [card("TS"), card("6D"), card("KH")])).toEqual({
      i: 1,
      o: "lose",
      p: -20,
      ch: 80,
      c: ["TS", "6D", "KH"],
    });
  });
});

describe("21 stands on its own (#3764): logged as the Stand a tap makes", () => {
  /** The round's log after each of `steps` from the deal, as the game context logs it. */
  function played(dealt: EngineState, steps: [(s: EngineState) => EngineState, RecordedAction][]) {
    const log = openRoundLog(gameWith([]), dealt);
    let s = dealt;
    for (const [fn, action] of steps) {
      const next = fn(s);
      logAction(log, s, next, action);
      if (next.phase !== "player") logDealer(log, s, next);
      s = next;
    }
    return { log, s };
  }

  it("a single hand hit to 21: the hit, the stand, then the dealer's play", () => {
    // 7+4 hits a T (21); dealer T+6 draws a 2 (18). The same entries a hit and a tapped Stand
    // made before #3764, so a reader cannot tell them apart (and need not).
    const dealt = placeBet(gameWith(["7S", "TC", "4H", "6D", "TD", "2H"]), 10);
    const { log, s } = played(dealt, [[hit, "hit"]]);
    expect(s.phase).toBe("result");
    expect(roundPlayedData(log)).toEqual({
      b: [10, 100],
      p: ["7S", "4H"],
      d: ["TC", "6D"],
      sh: 312,
      rem: 102,
      a: [
        ["h", 0, "TD"],
        ["s", 0],
      ],
      dl: { d: ["2H"], t: 18 },
    });
  });

  it("a hit below 21 logs no stand", () => {
    const dealt = placeBet(gameWith(["7S", "TC", "4H", "6D", "9D"]), 10);
    expect(played(dealt, [[hit, "hit"]]).log.a).toEqual([["h", 0, "9D"]]);
  });

  it("a split hand hit to 21: the hit, then the stand for that hand", () => {
    // 8s split: 8+3 and 8+2. Hand 1 hits a K (21); play moves to hand 2.
    const dealt = placeBet(gameWith(["8S", "6C", "8H", "9D", "3D", "2C", "KC"]), 10);
    const { log, s } = played(dealt, [
      [split, "split"],
      [hit, "hit"],
    ]);
    expect(s.active_hand_index).toBe(1);
    expect(log.a.slice(1)).toEqual([
      ["h", 0, "KC"],
      ["s", 0],
    ]);
  });

  it("a split hand dealt 21 is stood after the split; one dealt 21 later, after the action that reached it", () => {
    // 10s split: T+A (21) and T+7. The split stands hand 1 at once.
    const first = placeBet(gameWith(["TS", "6C", "TH", "9D", "AD", "7C"]), 10);
    expect(played(first, [[split, "split"]]).log.a).toEqual([
      [
        "p",
        0,
        [
          ["TS", "AD"],
          ["TH", "7C"],
        ],
      ],
      ["s", 0],
    ]);
    // 10s split: T+7 and T+A (21). The Stand on hand 1 passes hand 2 over: the dealer plays.
    const second = placeBet(gameWith(["TS", "6C", "TH", "9D", "7D", "AC", "2H"]), 10);
    const { log, s } = played(second, [
      [split, "split"],
      [stand, "stand"],
    ]);
    expect(s.phase).toBe("result");
    expect(log.a.slice(1)).toEqual([
      ["s", 0],
      ["s", 1],
    ]);
    expect(log.dl).toEqual({ d: ["2H"], t: 17 });
  });

  it("a split double to 21 logs the double only: the double ends its hand, no stand after it", () => {
    // 8s split: 8+3 and 8+2. Hand 1 doubles a K (21); play moves to hand 2.
    const dealt = placeBet(gameWith(["8S", "6C", "8H", "9D", "3D", "2C", "KC"]), 10);
    const { log, s } = played(dealt, [
      [split, "split"],
      [doubleDown, "double"],
    ]);
    expect(s.active_hand_index).toBe(1);
    expect(log.a.slice(1)).toEqual([["d", 0, "KC"]]);
  });

  it("several stands from one action are logged in table order", () => {
    // 10s split, both hands dealt an Ace: the split stands hand 1, then hand 2; the dealer plays.
    const dealt = placeBet(gameWith(["TS", "6C", "TH", "9D", "AD", "AC", "2H"]), 10);
    const { log, s } = played(dealt, [[split, "split"]]);
    expect(s.phase).toBe("result");
    expect(log.a).toEqual([
      [
        "p",
        0,
        [
          ["TS", "AD"],
          ["TH", "AC"],
        ],
      ],
      ["s", 0],
      ["s", 1],
    ]);
  });

  it("split aces log no stand, even on 21", () => {
    const dealt = placeBet(gameWith(["AS", "6C", "AH", "9D", "KD", "5C", "2H"]), 10);
    const { log, s } = played(dealt, [[split, "split"]]);
    expect(s.phase).toBe("result");
    expect(log.a).toHaveLength(1);
    expect(log.a[0]![0]).toBe("p");
  });

  it("a save on 21 from before #3764, stood on load: the resumed round logs the stand and the dealer", () => {
    const saved: EngineState = {
      ...placeBet(gameWith(["7S", "TC", "4H", "6D"]), 10),
      round: 3,
    };
    const on21: EngineState = {
      ...saved,
      player_hand: [...saved.player_hand, card("TD")],
      deck: [...saved.deck, card("2H")],
    };
    const next = standOnTwentyOne(on21);
    const log = resumedRoundLog(on21);
    logAction(log, on21, next, "stand");
    logDealer(log, on21, next);
    expect(roundPlayedData(log)).toEqual({
      b: [10, 100],
      d: ["TC", "6D"],
      sh: 312,
      rem: 101,
      a: [["s", 0]],
      dl: { d: ["2H"], t: 18 },
      r: 1,
    });
  });

  it("autoStands names only the hands the engine stood", () => {
    const dealt = placeBet(gameWith(["7S", "TC", "4H", "6D", "TD", "2H"]), 10);
    expect(autoStands(dealt, hit(dealt), "hit")).toEqual([0]);
    expect(autoStands(dealt, stand(dealt), "stand")).toEqual([]);
    expect(autoStands(dealt, doubleDown(dealt), "double")).toEqual([]);
  });

  it("the widest single-hand round, 20 hits and the stand on 21, is under the cap", () => {
    const aces = (n: number) => Array.from({ length: n }, () => "AS");
    const widest = {
      b: [2_000_000_000, 2_000_000_000],
      p: aces(2),
      d: aces(2),
      sh: 832,
      rem: 832,
      a: [...aces(20).map((c) => ["h", 0, c]), ["s", 0]],
      dl: { d: aces(22), t: 26, b: 1 },
    };
    expect(size(widest)).toBeLessThanOrEqual(BLACKJACK_EVENT_MAX_BYTES);
  });
});

describe("sizes against the cap", () => {
  const cards = (n: number) => Array.from({ length: n }, () => "AS");

  it("the widest legal event of each type, with the widest envelope, is under the cap", () => {
    // A hand holds 21 cards without busting (aces and twos from a 6-deck shoe) and one more busts it.
    const worst: Record<string, Record<string, unknown>> = {
      // 20 hits on one hand, a dealer drawing 22, the widest numbers
      round_played: {
        b: [2_000_000_000, 2_000_000_000],
        p: cards(2),
        d: cards(2),
        sh: 832,
        rem: 832,
        a: cards(20).map((c) => ["h", 0, c]),
        dl: { d: cards(22), t: 26, b: 1 },
      },
      // a hand of 22 cards, paid out with the widest figures
      hand_resolved: { i: 3, o: "blackjack", p: -2_000_000_000, ch: 2_000_000_000, c: cards(22) },
    };
    const sizes = Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, size(v)]));
    for (const [type, bytes] of Object.entries(sizes)) {
      expect({ type, ok: bytes <= BLACKJACK_EVENT_MAX_BYTES }).toEqual({ type, ok: true });
    }
    // A fixed record of the arithmetic quoted in docs/games/blackjack.md.
    expect(sizes).toEqual({ round_played: 517, hand_resolved: 206 });
  });

  it("every Blackjack event is capped by the one shared figure", () => {
    const config = recordingConfigFor("blackjack");
    expect(config.sessionMaxBytes).toBe(BLACKJACK_SESSION_MAX_BYTES);
    for (const type of Object.keys(gameEventRegistry.blackjack.events)) {
      expect({ type, cap: recordingEventCap(config, type) }).toEqual({
        type,
        cap: BLACKJACK_EVENT_MAX_BYTES,
      });
    }
  });

  it("no hand event is chunkable: an oversized one is dropped, not split", () => {
    for (const spec of Object.values(gameEventRegistry.blackjack.events)) {
      expect(spec).not.toHaveProperty("chunkField");
    }
  });
});

describe("the recorder at the byte cap and with the kill switch off", () => {
  function recorder(enabled = true) {
    const saves: EnqueueEventInput[][] = [];
    const reports: unknown[] = [];
    const r = new GameRecorder<"blackjack">({
      gameType: "blackjack",
      sink: {
        canAccept: () => true,
        enqueueMany: (events) => {
          saves.push([...events]);
          return true;
        },
      },
      schedule: () => undefined,
      report: (x) => reports.push(x),
      enabled: () => enabled,
    });
    return { r, saves, reports };
  }

  /** A hand_resolved whose JSON is exactly `bytes` long once the recorder adds its envelope. */
  function padded(bytes: number): Record<string, unknown> {
    const base = { v: 1, unit: 1, t_ms: 0, i: 0, o: "win", p: 10, ch: 110, c: [] as string[] };
    const have = JSON.stringify(base).length;
    const fill = bytes - have - 2; // the quotes of the one string
    return { i: 0, o: "win", p: 10, ch: 110, c: ["x".repeat(Math.max(0, fill))] };
  }

  it("an event of exactly the cap is saved whole; one byte over is dropped and reported", () => {
    const { r, saves, reports } = recorder();
    r.startSession();
    r.beginUnit(1);
    r.record("hand_resolved", padded(BLACKJACK_EVENT_MAX_BYTES));
    r.closeUnit();
    r.beginUnit(2);
    r.record("hand_resolved", padded(BLACKJACK_EVENT_MAX_BYTES + 1));
    r.closeUnit();
    r.endSession();
    expect(saves).toHaveLength(1);
    expect(saves[0]).toHaveLength(1);
    expect(JSON.stringify(saves[0]![0]!.data).length).toBe(BLACKJACK_EVENT_MAX_BYTES);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toEqual(expect.objectContaining({ dropped_oversize: 1, saved: 1 }));
  });

  it("with the kill switch off the recorder holds nothing, measures nothing and saves nothing", () => {
    const { r, saves, reports } = recorder(false);
    r.startSession();
    for (let unit = 1; unit <= 50; unit += 1) {
      r.beginUnit(unit);
      r.record("round_played", {
        b: [10, 100],
        p: ["TS", "9D"],
        d: ["6C", "7H"],
        sh: 312,
        rem: 300,
      });
      r.record("hand_resolved", { i: 0, o: "win", p: 10, ch: 110, c: ["TS", "9D"] });
      r.closeUnit();
      expect(r.held).toBe(0);
    }
    r.flush();
    r.endSession();
    expect(saves).toEqual([]);
    expect(reports).toEqual([]);
  });

  it("stops at the run's session cap: a clean prefix of whole events, then nothing more", () => {
    const { r, saves, reports } = recorder();
    r.startSession();
    for (let unit = 1; unit <= 2_000; unit += 1) {
      r.beginUnit(unit);
      r.record("round_played", {
        b: [10, 100],
        p: ["TS", "9D"],
        d: ["6C", "7H"],
        sh: 312,
        rem: 300,
        a: [
          ["h", 0, "5S"],
          ["s", 0],
        ],
        dl: { d: ["TS"], t: 26, b: 1 },
      });
      r.record("hand_resolved", { i: 0, o: "win", p: 10, ch: 110, c: ["TS", "9D", "5S"] });
      r.closeUnit();
      r.flush();
    }
    r.endSession();
    const events = saves.flat();
    const bytes = events.reduce((n, e) => n + JSON.stringify(e.data).length, 0);
    expect(bytes).toBeLessThanOrEqual(BLACKJACK_SESSION_MAX_BYTES);
    expect(bytes).toBeGreaterThan(BLACKJACK_SESSION_MAX_BYTES - BLACKJACK_EVENT_MAX_BYTES);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toEqual(expect.objectContaining({ game_type: "blackjack" }));
  });
});
