import {
  buildHeartsCompletedResult,
  heartsLeaderboardScore,
  heartsResult,
  heartsStandings,
} from "../result";

describe("buildHeartsCompletedResult (#2838)", () => {
  // Hand 2 is a moon shot by seat 2: 0 for the shooter, 26 for the others.
  const history = [
    [10, 5, 8, 3],
    [26, 26, 0, 26],
    [9, 4, 6, 7],
  ];
  const totals = [45, 35, 14, 36];

  it("carries the post-moon hand rows, totals and leaderboard value", () => {
    const r = buildHeartsCompletedResult(totals, history);
    expect(r).toEqual({
      final_score: 55,
      vs_result: "loss",
      hand_scores: history,
      final_scores: totals,
      human_seat: 0,
    });
    for (let i = 0; i < 4; i++) {
      expect(history.reduce((s, row) => s + row[i]!, 0)).toBe(totals[i]);
    }
  });

  it("copies the rows so later state changes can't alias the payload", () => {
    const r = buildHeartsCompletedResult(totals, history);
    expect(r.hand_scores[0]).not.toBe(history[0]);
  });
});

describe("heartsResult (#2506)", () => {
  it("is a win when the human alone has the lowest score", () => {
    expect(heartsResult([46, 100, 63, 52])).toEqual({
      outcome: "win",
      winnerIndex: 0,
      limitIndex: 1,
    });
  });

  it("is a loss naming the lowest seat otherwise", () => {
    expect(heartsResult([70, 104, 38, 52])).toEqual({
      outcome: "loss",
      winnerIndex: 2,
      limitIndex: 1,
    });
  });

  it("is a draw when the human shares the lowest score", () => {
    expect(heartsResult([40, 100, 40, 52]).outcome).toBe("draw");
  });

  it("is still a loss when two other seats tie for lowest", () => {
    expect(heartsResult([60, 100, 40, 40])).toEqual(
      expect.objectContaining({ outcome: "loss", winnerIndex: 2 })
    );
  });
});

describe("heartsStandings", () => {
  it("orders seats lowest first with shared ranks for ties", () => {
    expect(heartsStandings([52, 100, 40, 40])).toEqual([
      { seat: 2, score: 40, rank: 1 },
      { seat: 3, score: 40, rank: 1 },
      { seat: 0, score: 52, rank: 3 },
      { seat: 1, score: 100, rank: 4 },
    ]);
  });
});

describe("heartsLeaderboardScore", () => {
  it("scores 100 minus the player's points, never below zero", () => {
    expect(heartsLeaderboardScore(46)).toBe(54);
    expect(heartsLeaderboardScore(0)).toBe(100);
    expect(heartsLeaderboardScore(118)).toBe(0);
  });
});
