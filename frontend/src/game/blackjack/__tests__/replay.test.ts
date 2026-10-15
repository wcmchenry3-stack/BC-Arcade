/**
 * Blackjack replay event builders (#3284): fields, the compact card encoding,
 * byte sizes against the type's cap, and the recorder's behaviour at that cap
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
  type Card,
  type EngineState,
} from "../engine";
import {
  betPlacedData,
  dealerPlayedData,
  encodeCard,
  handDealtData,
  handResolvedData,
  playerActionData,
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

describe("builders", () => {
  it("bet_placed: the wager and the chips left, read from before the bet settles", () => {
    const prev = gameWith(["TS", "6C", "9D", "7H"]);
    const next = placeBet(prev, 25);
    expect(betPlacedData(prev, next)).toEqual({ amount: 25, chips_remaining: 75 });
  });

  it("bet_placed on a natural still reports the chips after the bet, not after the payout", () => {
    const prev = gameWith(["AS", "6C", "KD", "7H"]);
    const next = placeBet(prev, 10); // 3:2 on the spot
    expect(next.chips).toBe(115);
    expect(betPlacedData(prev, next)).toEqual({ amount: 10, chips_remaining: 90 });
  });

  it("hand_dealt: both hands, the shoe size and the cards left after the deal", () => {
    const next = placeBet(gameWith(["TS", "6C", "9D", "7H"]), 10);
    expect(handDealtData(next)).toEqual({
      p: ["TS", "9D"],
      d: ["6C", "7H"], // [hole, up]
      sh: 312,
      rem: 100,
    });
  });

  it("player_action: a hit carries the card, a stand carries nothing", () => {
    const dealt = placeBet(gameWith(["5S", "TC", "6D", "7H", "9C"]), 10);
    const hitState = hit(dealt);
    expect(playerActionData(dealt, hitState, "hit")).toEqual({ a: "h", i: 0, c: "9C" });
    expect(playerActionData(dealt, dealt, "stand")).toEqual({ a: "s", i: 0 });
  });

  it("player_action: a double carries the one card it drew", () => {
    const dealt = placeBet(gameWith(["5S", "TC", "6D", "7H", "9C"]), 10);
    expect(playerActionData(dealt, doubleDown(dealt), "double")).toEqual({
      a: "d",
      i: 0,
      c: "9C",
    });
  });

  it("player_action: a split carries both resulting hands", () => {
    const dealt = placeBet(gameWith(["8S", "TC", "8H", "7D", "3D", "KC"]), 10);
    expect(playerActionData(dealt, split(dealt), "split")).toEqual({
      a: "p",
      i: 0,
      h: [
        ["8S", "3D"],
        ["8H", "KC"],
      ],
    });
  });

  it("player_action: a hit on the second split hand names that hand", () => {
    const dealt = placeBet(gameWith(["8S", "TC", "8H", "7D", "3D", "KC", "2H"]), 10);
    const split1 = split(dealt);
    const afterStand = stand(split1); // hand 0 done, hand 1 active
    expect(afterStand.active_hand_index).toBe(1);
    const afterHit = hit(afterStand);
    expect(playerActionData(afterStand, afterHit, "hit")).toEqual({ a: "h", i: 1, c: "2H" });
  });

  it("dealer_played: the hole card, the draws, the total and the bust flag", () => {
    const dealt = placeBet(gameWith(["TS", "6C", "9D", "TD", "TH"]), 10);
    const next = stand(dealt);
    expect(dealerPlayedData(dealt, next)).toEqual({ h: "6C", d: ["TH"], t: 26, b: 1 });
  });

  it("dealer_played: a dealer that stands draws nothing, and no bust flag is sent", () => {
    const dealt = placeBet(gameWith(["TS", "TC", "9D", "7D"]), 10);
    expect(dealerPlayedData(dealt, stand(dealt))).toEqual({ h: "TC", d: [], t: 17 });
  });

  it("dealer_played: none when the player busts, none on a natural, none mid-round", () => {
    const dealt = placeBet(gameWith(["TS", "7C", "6D", "8H", "KH"]), 10);
    expect(dealerPlayedData(dealt, hit(dealt))).toBeNull(); // bust: the dealer never plays
    const natural = gameWith(["AS", "5C", "KD", "9H"]);
    expect(dealerPlayedData(natural, placeBet(natural, 10))).toBeNull(); // settled on the deal
    expect(dealerPlayedData(dealt, dealt)).toBeNull();
  });

  it("dealer_played: after a split it plays once for all the hands", () => {
    const dealt = placeBet(gameWith(["8S", "6C", "8H", "TD", "3D", "KC", "TS"]), 10);
    const split1 = split(dealt);
    const mid = stand(split1);
    expect(dealerPlayedData(split1, mid)).toBeNull(); // hand 1 still to act
    const end = stand(mid);
    expect(dealerPlayedData(mid, end)).toEqual({ h: "6C", d: ["TS"], t: 26, b: 1 });
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

describe("sizes against the cap", () => {
  const cards = (n: number) => Array.from({ length: n }, () => "TD");

  it("the widest event of each type, with the widest envelope, is under the cap", () => {
    const worst: Record<string, Record<string, unknown>> = {
      bet_placed: { amount: 2_000_000_000, chips_remaining: 2_000_000_000 },
      hand_dealt: { p: cards(2), d: cards(2), sh: 832, rem: 832 },
      // a split of a pair into two hands of two, on the fourth hand
      player_action: { a: "p", i: 3, h: [cards(2), cards(2)] },
      // a dealer hand of 12 draws
      dealer_played: { h: "TD", d: cards(12), t: 26, b: 1 },
      // a hand of 14 cards, paid out with the widest figures
      hand_resolved: { i: 3, o: "blackjack", p: -2_000_000_000, ch: 2_000_000_000, c: cards(14) },
    };
    const sizes = Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, size(v)]));
    for (const [type, bytes] of Object.entries(sizes)) {
      expect({ type, ok: bytes <= BLACKJACK_EVENT_MAX_BYTES }).toEqual({ type, ok: true });
    }
    // A fixed record of the arithmetic quoted in docs/games/blackjack.md.
    expect(sizes).toEqual({
      bet_placed: 85,
      hand_dealt: 87,
      player_action: 80,
      dealer_played: 124,
      hand_resolved: 166,
    });
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
    // each ',"XX"' adds 5 bytes; a first card adds 4 (no comma): fill with one long "card" string
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
      r.record("bet_placed", { amount: 10, chips_remaining: 90 });
      r.record("hand_dealt", { p: ["TS", "9D"], d: ["6C", "7H"], sh: 312, rem: 300 });
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
    let unit = 0;
    // 2,000 rounds of ~590 B would be far past the 192 KB cap
    while (unit < 2_000) {
      unit += 1;
      r.beginUnit(unit);
      r.record("bet_placed", { amount: 10, chips_remaining: 90 });
      r.record("hand_dealt", { p: ["TS", "9D"], d: ["6C", "7H"], sh: 312, rem: 300 });
      r.record("player_action", { a: "h", i: 0, c: "5S" });
      r.record("player_action", { a: "s", i: 0 });
      r.record("dealer_played", { h: "6C", d: ["TS"], t: 26, b: 1 });
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
