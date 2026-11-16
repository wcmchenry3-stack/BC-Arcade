/**
 * App side of the Cascade time-bonus parity check (#3700).
 *
 * Reads the fixture backend/tests/test_cascade_result.py also reads, so the
 * bonus the result card shows cannot drift from the one the server stores.
 */
// Path: 5 levels up from __tests__/ to the repo root, then into backend/tests/fixtures/.
import fixture from "../../../../../backend/tests/fixtures/cascade_time_bonus.json";
import { BONUS_MAX, BONUS_RULE, MIN_WIN_MS, PAR_TIME_MS, timeBonus } from "../timeBonus";

describe("timeBonus matches the server's cascade.time_bonus", () => {
  it("uses the fixture's rule", () => {
    expect({
      bonus_rule: BONUS_RULE,
      bonus_max: BONUS_MAX,
      par_time_ms: PAR_TIME_MS,
      min_win_ms: MIN_WIN_MS,
    }).toEqual(fixture.rule);
  });

  it.each(fixture.cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(timeBonus(c.outcome, c.duration_ms)).toBe(c.bonus);
  });
});

describe("timeBonus", () => {
  it("rounds the duration to whole ms first, as the app sends it", () => {
    expect(timeBonus("win", 19_999.6)).toBe(timeBonus("win", 20_000));
    expect(timeBonus("win", 19_999.4)).toBe(0);
  });

  it("is 0 for a duration that is not a number", () => {
    expect(timeBonus("win", undefined)).toBe(0);
    expect(timeBonus("win", Number.NaN)).toBe(0);
    expect(timeBonus("win", Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("never goes up as the win gets slower", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let t = MIN_WIN_MS; t <= PAR_TIME_MS + 1_000; t += 997) {
      const bonus = timeBonus("win", t);
      expect(bonus).toBeLessThanOrEqual(previous);
      expect(bonus).toBeGreaterThanOrEqual(0);
      previous = bonus;
    }
  });
});
