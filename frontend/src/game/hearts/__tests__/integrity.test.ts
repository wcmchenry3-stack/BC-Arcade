/**
 * Hearts integrity validators (#745).
 */

import * as Sentry from "@sentry/react-native";
import {
  commitPass,
  dealGame,
  dealNextHand,
  getValidPlays,
  playCard,
  selectPassCard,
} from "../engine";
import { checkHeartsIntegrity, createIntegrityReporter } from "../integrity";
import type { HeartsState } from "../types";

jest.mock("@sentry/react-native", () => ({
  captureMessage: jest.fn(),
}));

const captureMessage = Sentry.captureMessage as jest.Mock;

function mkState(overrides: Partial<HeartsState> = {}): HeartsState {
  return { ...dealGame(), phase: "playing", ...overrides };
}

beforeEach(() => {
  captureMessage.mockClear();
});

describe("checkHeartsIntegrity — clean state", () => {
  it("returns no findings on a fresh deal", () => {
    expect(checkHeartsIntegrity(dealGame())).toEqual([]);
  });

  it("accepts a real two-round history that reconciles to totals", () => {
    // Two valid hands that sum to 26 each, totals match running sum.
    const state = mkState({
      phase: "playing",
      handNumber: 3,
      cumulativeScores: [13, 14, 13, 12],
      scoreHistory: [
        [3, 9, 8, 6],
        [10, 5, 5, 6],
      ],
    });
    expect(checkHeartsIntegrity(state)).toEqual([]);
  });

  it("accepts a moon-shot row ([0,26,26,26]) without flagging sum != 26", () => {
    const state = mkState({
      handNumber: 2,
      cumulativeScores: [0, 26, 26, 26],
      scoreHistory: [[0, 26, 26, 26]],
    });
    expect(checkHeartsIntegrity(state)).toEqual([]);
  });
});

describe("checkHeartsIntegrity — bug repro from issue body", () => {
  it("flags totals-vs-rounds mismatch when scoreHistory was lost", () => {
    // The exact #745 scenario: scoreHistory shows only round 1, but cumulativeScores
    // reflect 13 hands of accumulated points. Round 1 row = [0,18,0,8] sums to 26
    // (valid hand), but totals = [48,105,87,98] don't reconcile.
    const state = mkState({
      handNumber: 14,
      cumulativeScores: [48, 105, 87, 98],
      scoreHistory: [[0, 18, 0, 8]],
    });
    const findings = checkHeartsIntegrity(state);
    expect(findings.some((f) => f.key === "totals_vs_rounds_mismatch")).toBe(true);
  });
});

describe("checkHeartsIntegrity — per-round invariants", () => {
  it("flags a row that sums to something other than 26 (and isn't a moon)", () => {
    const state = mkState({
      handNumber: 2,
      cumulativeScores: [10, 5, 3, 2],
      scoreHistory: [[10, 5, 3, 2]], // sums to 20
    });
    const findings = checkHeartsIntegrity(state);
    expect(findings.some((f) => f.key === "round_sum_ne_26")).toBe(true);
  });

  it("flags a per-player round score > 26", () => {
    const state = mkState({
      handNumber: 2,
      cumulativeScores: [27, 0, 0, 0],
      scoreHistory: [[27, 0, 0, 0]], // sum is 27, but the > 26 check fires too
    });
    const findings = checkHeartsIntegrity(state);
    expect(findings.some((f) => f.key === "round_player_over_26")).toBe(true);
  });
});

describe("checkHeartsIntegrity — handNumber alignment", () => {
  it("flags scoreHistory.length mismatch with handNumber during play", () => {
    // handNumber 3, phase 'playing' → expects 2 completed rounds. 0 rows = bad.
    const state = mkState({
      phase: "playing",
      handNumber: 3,
      cumulativeScores: [0, 0, 0, 0],
      scoreHistory: [],
    });
    const findings = checkHeartsIntegrity(state);
    expect(findings.some((f) => f.key === "rounds_vs_handnumber_mismatch")).toBe(true);
  });
});

describe("checkHeartsIntegrity — spurious game over", () => {
  it("flags game_over on hand 1 with empty scoreHistory but a >100 total", () => {
    const state = mkState({
      phase: "game_over",
      handNumber: 1,
      cumulativeScores: [120, 50, 30, 10],
      scoreHistory: [],
      isComplete: true,
      winnerIndex: 3,
    });
    const findings = checkHeartsIntegrity(state);
    expect(findings.some((f) => f.key === "spurious_game_over")).toBe(true);
  });
});

describe("checkHeartsIntegrity — deck conservation (#2224)", () => {
  const deckFindings = (s: HeartsState) =>
    checkHeartsIntegrity(s).filter((f) => f.key === "deck_not_conserved");

  /** Play one whole hand with first-legal-card plays, asserting after every step. */
  function playHandChecking(start: HeartsState): HeartsState {
    let s = start;
    if (s.phase === "passing") {
      for (let p = 0; p < 4; p++) {
        for (const c of s.playerHands[p]!.slice(0, 3)) s = selectPassCard(s, p, c);
        expect(deckFindings(s)).toEqual([]); // mid-selection
      }
      s = commitPass(s);
      expect(deckFindings(s)).toEqual([]);
    }
    while (s.phase === "playing") {
      const p = s.currentPlayerIndex;
      s = playCard(s, p, getValidPlays(s, p)[0]!);
      expect(deckFindings(s)).toEqual([]);
    }
    return s;
  }

  it("passes on a valid fresh deal", () => {
    expect(deckFindings(dealGame())).toEqual([]);
  });

  it("passes at every step of several full games (passing, mid-trick, hand end, game over)", () => {
    for (let g = 0; g < 5; g++) {
      let s = dealGame();
      for (let hands = 0; hands < 60; hands++) {
        s = playHandChecking(s);
        // dealing / game_over: all 52 sit in the won piles
        expect(deckFindings(s)).toEqual([]);
        if (s.phase === "game_over") break;
        s = dealNextHand(s);
        expect(deckFindings(s)).toEqual([]);
      }
      expect(s.phase).toBe("game_over");
    }
  });

  it("flags a duplicated card", () => {
    const s = dealGame();
    const hands = s.playerHands.map((h) => [...h]);
    hands[1]![0] = hands[0]![0]!; // same card now in two hands, one card missing
    const f = deckFindings({ ...s, playerHands: hands });
    expect(f).toHaveLength(1);
    expect(f[0]!.extra["uniqueCards"]).toBe(51);
  });

  it("flags a missing card", () => {
    const s = dealGame();
    const hands = s.playerHands.map((h) => [...h]);
    hands[3]!.pop();
    const f = deckFindings({ ...s, playerHands: hands });
    expect(f).toHaveLength(1);
    expect(f[0]!.extra["totalCards"]).toBe(51);
  });

  it("flags an extra card and a malformed card", () => {
    const s = dealGame();
    const extra = { ...s, wonCards: [[s.playerHands[0]![0]!], [], [], []] };
    expect(deckFindings(extra)).toHaveLength(1);
    const hands = s.playerHands.map((h) => [...h]);
    hands[0]![0] = { suit: "bogus", rank: 99 } as never;
    expect(deckFindings({ ...s, playerHands: hands })).toHaveLength(1);
  });

  it("is reported once through the reporter", () => {
    const s = dealGame();
    const hands = s.playerHands.map((h) => [...h]);
    hands[3]!.pop();
    const report = createIntegrityReporter();
    report({ ...s, playerHands: hands });
    report({ ...s, playerHands: hands });
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });
});

describe("createIntegrityReporter — Sentry wiring + dedupe", () => {
  it("captures a Sentry warning per-finding on first sighting", () => {
    const report = createIntegrityReporter();
    const state = mkState({
      handNumber: 14,
      cumulativeScores: [48, 105, 87, 98],
      scoreHistory: [[0, 18, 0, 8]],
    });
    report(state);
    expect(captureMessage).toHaveBeenCalled();
    const call = captureMessage.mock.calls[0]!;
    expect(call[1]).toMatchObject({
      level: "warning",
      tags: { subsystem: "hearts.integrity", check: "totals_vs_rounds_mismatch" },
    });
  });

  it("does not re-fire the same check across repeated calls (dedupe)", () => {
    const report = createIntegrityReporter();
    const state = mkState({
      handNumber: 14,
      cumulativeScores: [48, 105, 87, 98],
      scoreHistory: [[0, 18, 0, 8]],
    });
    report(state);
    const firstCount = captureMessage.mock.calls.length;
    report(state);
    expect(captureMessage.mock.calls.length).toBe(firstCount);
  });

  it("omits player names from extra payload", () => {
    const report = createIntegrityReporter();
    report(
      mkState({
        handNumber: 14,
        cumulativeScores: [48, 105, 87, 98],
        scoreHistory: [[0, 18, 0, 8]],
      })
    );
    const extras = captureMessage.mock.calls.flatMap((c) => Object.values(c[1].extra ?? {}));
    const stringified = JSON.stringify(extras);
    expect(stringified).not.toMatch(/playerNames|playerLabels/);
  });
});
