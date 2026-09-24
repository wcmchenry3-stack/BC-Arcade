/**
 * #2491: the game-over run-stats breadcrumb — shape, once-per-call, counts only.
 */
import * as Sentry from "@sentry/react-native";
import { initStarSwarm, CANVAS_W, CANVAS_H, emptyTierStats } from "../engine";
import { RUN_STATS_BREADCRUMB, reportRunStats, runStatsBreadcrumbData } from "../telemetry";
import type { StarSwarmState } from "../types";

jest.mock("@sentry/react-native", () => ({
  addBreadcrumb: jest.fn(),
}));

const addBreadcrumb = Sentry.addBreadcrumb as jest.Mock;

function finished(): StarSwarmState {
  const s = initStarSwarm(CANVAS_W, CANVAS_H, 4, 42, "Commander");
  return {
    ...s,
    phase: "GameOver",
    score: 12_345,
    runStats: {
      reinforced: 6,
      armorDeflects: 11,
      beamHits: 2,
      routCaught: 0,
      routEscaped: 0,
      rocksSpawned: 5,
      rocksBrokenByPlayer: 3,
      rocksBrokenByEnemy: 1,
    },
    tierStats: {
      ...emptyTierStats(),
      Grunt: { rolls: 10, dodged: 3, pathRolls: 4, pathDodged: 1, struck: 6, flak: 2 },
      Boss: { rolls: 2, dodged: 2, pathRolls: 0, pathDodged: 0, struck: 0, flak: 1 },
    },
  };
}

beforeEach(() => addBreadcrumb.mockClear());

describe("runStatsBreadcrumbData", () => {
  it("rolls the run counters, the tier table and the run's headline numbers into one object", () => {
    const data = runStatsBreadcrumbData(finished());
    expect(data).toEqual({
      wave: 4,
      difficulty: "Commander",
      score: 12_345,
      reinforced: 6,
      armorDeflects: 11,
      beamHits: 2,
      routCaught: 0,
      routEscaped: 0,
      rocksSpawned: 5,
      rocksBrokenByPlayer: 3,
      rocksBrokenByEnemy: 1,
      tiers: {
        Grunt: { effective: expect.any(Number), rolls: 10, dodged: 3, struck: 6, flak: 2 },
        Elite: { effective: expect.any(Number), rolls: 0, dodged: 0, struck: 0, flak: 0 },
        Boss: { effective: expect.any(Number), rolls: 2, dodged: 2, struck: 0, flak: 1 },
        Carrier: { effective: 0, rolls: 0, dodged: 0, struck: 0, flak: 0 },
      },
    });
    // effective odds are rounded so the breadcrumb stays readable
    expect(data.tiers.Grunt.effective).toBe(Math.round(data.tiers.Grunt.effective * 1000) / 1000);
    expect(data.tiers.Grunt.effective).toBeGreaterThan(0.25); // Commander scales above 1×
  });

  it("carries counts only — every value is a number, a tier table or the difficulty name", () => {
    const data = runStatsBreadcrumbData(finished()) as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(data)) {
      if (key === "difficulty") expect(typeof value).toBe("string");
      else if (key === "tiers") expect(typeof value).toBe("object");
      else expect(typeof value).toBe("number");
    }
  });
});

describe("reportRunStats", () => {
  it("adds exactly one info breadcrumb under the run_stats category", () => {
    reportRunStats(finished());
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(addBreadcrumb).toHaveBeenCalledWith({
      category: RUN_STATS_BREADCRUMB,
      message: "run ended",
      level: "info",
      data: runStatsBreadcrumbData(finished()),
    });
    expect(RUN_STATS_BREADCRUMB).toBe("starswarm.run_stats");
  });
});
