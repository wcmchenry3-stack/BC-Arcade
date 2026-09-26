import { bonusCountdown, bonusEarned, upperSum, winnerColumn } from "../yachtScorecardModel";

describe("upperSum", () => {
  it("sums only filled upper categories", () => {
    expect(
      upperSum({
        ones: 3,
        twos: null,
        threes: 9,
        fours: 0,
        fives: 15,
        sixes: 18,
      })
    ).toBe(45);
  });

  it("ignores lower-section categories", () => {
    expect(
      upperSum({
        ones: 3,
        twos: 6,
        threes: 9,
        fours: 12,
        fives: 15,
        sixes: 18,
        three_of_a_kind: 30,
        full_house: 25,
        yacht: 50,
      })
    ).toBe(63);
  });

  it("returns 0 when nothing is filled", () => {
    expect(upperSum({})).toBe(0);
  });
});

describe("bonusCountdown", () => {
  it("returns 63 minus current sum when below threshold", () => {
    expect(bonusCountdown(0)).toBe(63);
    expect(bonusCountdown(40)).toBe(23);
    expect(bonusCountdown(62)).toBe(1);
  });

  it("clamps to 0 at or above threshold", () => {
    expect(bonusCountdown(63)).toBe(0);
    expect(bonusCountdown(80)).toBe(0);
  });
});

describe("bonusEarned", () => {
  it("is true once upper sum reaches 63", () => {
    expect(bonusEarned(62)).toBe(false);
    expect(bonusEarned(63)).toBe(true);
    expect(bonusEarned(99)).toBe(true);
  });
});

describe("winnerColumn", () => {
  it("picks higher side; ties return 'tie'", () => {
    expect(winnerColumn(200, 150)).toBe("you");
    expect(winnerColumn(150, 200)).toBe("opp");
    expect(winnerColumn(150, 150)).toBe("tie");
  });
});
