import {
  barColor,
  computeStandings,
  detectMoonInRow,
  progressFraction,
  scoreColor,
} from "../heartsRoundsModel";

const colors = {
  bonus: "BONUS",
  error: "ERROR",
  text: "TEXT",
  accent: "ACCENT",
};

describe("computeStandings", () => {
  it("picks lowest as leader, highest as losing", () => {
    expect(computeStandings([10, 30, 20, 40])).toEqual({ leaderIndex: 0, losingIndex: 3 });
    expect(computeStandings([99, 5, 50, 80])).toEqual({ leaderIndex: 1, losingIndex: 0 });
  });

  it("breaks ties by first-seen index", () => {
    expect(computeStandings([0, 0, 0, 0])).toEqual({ leaderIndex: 0, losingIndex: 0 });
  });
});

describe("progressFraction", () => {
  it("clamps to [0, 1]", () => {
    expect(progressFraction(0)).toBe(0);
    expect(progressFraction(50)).toBe(0.5);
    expect(progressFraction(100)).toBe(1);
    expect(progressFraction(120)).toBe(1);
    expect(progressFraction(-5)).toBe(0);
  });
});

describe("scoreColor", () => {
  it("returns bonus for leader, error for losing, text otherwise", () => {
    const standing = { leaderIndex: 1, losingIndex: 3 };
    expect(scoreColor(0, standing, colors)).toBe("TEXT");
    expect(scoreColor(1, standing, colors)).toBe("BONUS");
    expect(scoreColor(2, standing, colors)).toBe("TEXT");
    expect(scoreColor(3, standing, colors)).toBe("ERROR");
  });
});

describe("barColor", () => {
  const standing = { leaderIndex: 1, losingIndex: 3 };

  it("returns error when total ≥ 80, regardless of standing", () => {
    expect(barColor(1, 80, standing, colors)).toBe("ERROR");
    expect(barColor(1, 99, standing, colors)).toBe("ERROR");
  });

  it("returns bonus for leader below threshold", () => {
    expect(barColor(1, 79, standing, colors)).toBe("BONUS");
    expect(barColor(1, 0, standing, colors)).toBe("BONUS");
  });

  it("returns accent for non-leader, non-danger", () => {
    expect(barColor(0, 50, standing, colors)).toBe("ACCENT");
    expect(barColor(2, 0, standing, colors)).toBe("ACCENT");
  });
});

describe("detectMoonInRow", () => {
  it("returns shooterIndex when exactly one 0 + three 26s", () => {
    expect(detectMoonInRow([0, 26, 26, 26])).toEqual({ shooterIndex: 0 });
    expect(detectMoonInRow([26, 26, 0, 26])).toEqual({ shooterIndex: 2 });
  });

  it("returns null for non-moon rows", () => {
    expect(detectMoonInRow([5, 8, 12, 1])).toBeNull();
    expect(detectMoonInRow([0, 0, 0, 0])).toBeNull();
    expect(detectMoonInRow([26, 26, 26, 26])).toBeNull();
    // Raw handScores form (pre-fix) — does NOT trigger moon styling.
    expect(detectMoonInRow([26, 0, 0, 0])).toBeNull();
  });

  it("returns null for non-4-length rows", () => {
    expect(detectMoonInRow([0, 26, 26])).toBeNull();
    expect(detectMoonInRow([])).toBeNull();
  });
});
