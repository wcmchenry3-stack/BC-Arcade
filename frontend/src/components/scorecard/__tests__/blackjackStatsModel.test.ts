import { formatPL, plColor, winRatePct } from "../blackjackStatsModel";
import { initialSessionStats } from "../../../game/blackjack/sessionStats";

const colors = { bonus: "BONUS", error: "ERROR", text: "TEXT" };

describe("plColor", () => {
  it("returns bonus for positive, error for negative, text for zero", () => {
    expect(plColor(100, colors)).toBe("BONUS");
    expect(plColor(-50, colors)).toBe("ERROR");
    expect(plColor(0, colors)).toBe("TEXT");
  });
});

describe("formatPL", () => {
  it("renders zero without a sign", () => {
    expect(formatPL(0)).toBe("0");
  });

  it("prefixes a positive number with + and uses thousands separators", () => {
    expect(formatPL(1240)).toBe("+1,240");
    expect(formatPL(50)).toBe("+50");
  });

  it("prefixes a negative number with the proper minus sign and abs value", () => {
    expect(formatPL(-320)).toBe("−320");
    expect(formatPL(-1500)).toBe("−1,500");
  });
});

describe("winRatePct", () => {
  it("returns null when no hands have been played", () => {
    expect(winRatePct(initialSessionStats(1000))).toBeNull();
  });

  it("rounds the percentage to the nearest integer", () => {
    const stats = { ...initialSessionStats(1000), handsPlayed: 8, handsWon: 5 };
    // 5/8 = 0.625 → 63%
    expect(winRatePct(stats)).toBe(63);
  });

  it("returns 100 when every played hand was won", () => {
    const stats = { ...initialSessionStats(1000), handsPlayed: 3, handsWon: 3 };
    expect(winRatePct(stats)).toBe(100);
  });

  it("returns 0 when no hand was won", () => {
    const stats = { ...initialSessionStats(1000), handsPlayed: 4, handsWon: 0 };
    expect(winRatePct(stats)).toBe(0);
  });
});
