import { heartsResult, heartsStandings } from "../result";

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
