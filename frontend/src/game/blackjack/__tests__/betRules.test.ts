import { isLegalBet, lastStake, maxBet, quickBets, trayChips } from "../betRules";
import { legalBetRange, newGame, placeBet, type EngineState } from "../engine";

const beginner = { betMin: 5, betMax: 25 };

/** Whether the engine itself takes the bet, to check the dock agrees with it. */
function engineTakes(chips: number, amount: number): boolean {
  try {
    placeBet(newGame(undefined, { startingChips: chips, ...beginner }), amount);
    return true;
  } catch {
    return false;
  }
}

describe("bet rules (#3580)", () => {
  it("agree with placeBet for every amount and stack", () => {
    for (const chips of [0, 3, 5, 12, 25, 40, 100]) {
      for (let amount = 0; amount <= 60; amount++) {
        expect(isLegalBet(amount, { chips, ...beginner })).toBe(
          chips > 0 && engineTakes(chips, amount)
        );
      }
    }
  });

  it("the engine exports the range placeBet enforces", () => {
    expect(legalBetRange({ chips: 0, ...beginner })).toBeNull();
    expect(legalBetRange({ chips: 3, ...beginner })).toEqual({ min: 3, max: 3 });
    expect(legalBetRange({ chips: 12, ...beginner })).toEqual({ min: 5, max: 12 });
    expect(legalBetRange({ chips: 100, ...beginner })).toEqual({ min: 5, max: 25 });
  });

  it("max is the stack below the table maximum", () => {
    expect(maxBet({ chips: 12, ...beginner })).toBe(12);
    expect(maxBet({ chips: 100, ...beginner })).toBe(25);
  });

  it("the tray offers one all-in chip on a short stack", () => {
    expect(trayChips([5, 10, 25], { chips: 3, ...beginner })).toEqual([3]);
    expect(trayChips([5, 10, 25], { chips: 30, ...beginner })).toEqual([5, 10, 25]);
  });

  it("the last stake is the bet before a double down", () => {
    expect(lastStake({ bet: 20, doubled: true })).toBe(10);
    expect(lastStake({ bet: 20, doubled: false })).toBe(20);
  });

  const result = (o: Partial<EngineState>) => ({
    bet: 10,
    doubled: false,
    chips: 100,
    ...beginner,
    ...o,
  });

  it("Rebet and 2× are allowed when the engine would take them", () => {
    expect(quickBets(result({}))).toEqual({
      rebet: 10,
      rebetAllowed: true,
      double: 20,
      doubleAllowed: true,
    });
  });

  it("2× is not allowed above the table maximum", () => {
    expect(quickBets(result({ bet: 15 })).doubleAllowed).toBe(false);
    expect(quickBets(result({ bet: 15 })).rebetAllowed).toBe(true);
  });

  it("neither is allowed beyond the stack", () => {
    const q = quickBets(result({ bet: 20, chips: 15 }));
    expect(q.rebetAllowed).toBe(false);
    expect(q.doubleAllowed).toBe(false);
  });

  it("on a short stack only the all-in is legal, so a larger rebet is not", () => {
    const q = quickBets(result({ bet: 5, chips: 4 }));
    expect(q.rebetAllowed).toBe(false);
    // ...but a rebet of exactly the stack is the all-in.
    expect(quickBets(result({ bet: 4, chips: 4 })).rebetAllowed).toBe(true);
  });

  it("after a double down Rebet deals the original stake", () => {
    expect(quickBets(result({ bet: 20, doubled: true })).rebet).toBe(10);
  });

  it("nothing is allowed with no chips", () => {
    const q = quickBets(result({ chips: 0 }));
    expect(q.rebetAllowed).toBe(false);
    expect(q.doubleAllowed).toBe(false);
  });
});
