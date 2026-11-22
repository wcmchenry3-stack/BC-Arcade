import fs from "fs";
import path from "path";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ChallengeGoal } from "../api";
import {
  dayStartOn,
  factsFor,
  goalMetBy,
  NEW_LEVELS_KIND,
  withLocalProgress,
} from "../localProgress";
import { loadOfflineDay, saveUpcoming } from "../offlineCache";
import { readSortDayStart, recordSortSolve, resetSortDayStartForTests } from "../../sort/dayStart";
// The same cases backend/tests/test_daily_challenge_sort_levels.py scores on the server,
// so the device and the server agree. Path: 5 levels up from __tests__/ to the repo root.
import fixture from "../../../../../backend/tests/fixtures/sort_new_levels_parity.json";

// #4028: Bottle Sort's relative "solve N new levels", scored offline.

interface Case {
  readonly name: string;
  readonly day_start_best: number;
  readonly solves: readonly number[];
  readonly target: number;
  readonly met: boolean;
}

const DAY = "2026-11-21";

function newLevels(target: number, completed = false): ChallengeGoal {
  return {
    id: `sort:${NEW_LEVELS_KIND}:${target}`,
    gameSlug: "sort",
    kind: NEW_LEVELS_KIND,
    target,
    completed,
  };
}

const sortGames = (solves: readonly number[]) =>
  solves.map((s) => ({ gameType: "sort", facts: { won: true, final_score: s } }));

beforeEach(async () => {
  await AsyncStorage.clear();
  resetSortDayStartForTests();
});

describe("offline vs server: the shared fixture", () => {
  it.each((fixture.cases as Case[]).map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const challenge = { challengeId: DAY, goals: [newLevels(c.target)] };
    const out = withLocalProgress(challenge, sortGames(c.solves), { sort: c.day_start_best });
    expect(out.goals[0]!.completed).toBe(c.met);
  });
});

describe("the relative check", () => {
  it("is never met without the day's baseline", () => {
    const goal = newLevels(1);
    expect(goalMetBy(goal, { final_score: 50 })).toBe(false);
    expect(goalMetBy(goal, { final_score: 50 }, {})).toBe(false);
    expect(goalMetBy(goal, { final_score: 50 }, { sort: 0 })).toBe(true);
  });

  it("ignores a new_levels value in the game's own facts", () => {
    const goal = newLevels(1);
    const forged = { final_score: 10, new_levels: 9 };
    expect(goalMetBy(goal, forged, { sort: 10 })).toBe(false);
    expect(factsFor(goal, forged, { sort: 10 })).toEqual({ final_score: 10, new_levels: 0 });
  });

  it("leaves every other goal's facts alone, Sort's absolute level goal included", () => {
    const level = { ...newLevels(5), kind: "final_score_at_least", id: "x" };
    expect(factsFor(level, { final_score: 5 })).toEqual({ final_score: 5 });
    expect(goalMetBy(level, { final_score: 5 }, { sort: 99 })).toBe(true);
  });
});

describe("Sort's day-start best (game/sort/dayStart.ts)", () => {
  it("is recorded on the day's first solve only, from the standing before it", async () => {
    await recordSortSolve(DAY, 10); // the day's first solve: 10 before it
    await recordSortSolve(DAY, 11); // later solves that day include the first one
    expect(await readSortDayStart()).toEqual({ day: DAY, best: 10 });
    // Another app run the same day reads what is stored instead of overwriting it.
    resetSortDayStartForTests();
    await recordSortSolve(DAY, 12);
    expect(await readSortDayStart()).toEqual({ day: DAY, best: 10 });
    // The next day's first solve starts from that day's standing.
    await recordSortSolve("2026-11-22", 12);
    expect(await readSortDayStart()).toEqual({ day: "2026-11-22", best: 12 });
  });

  it("writes about 30 bytes", async () => {
    await recordSortSolve(DAY, 120);
    const raw = await AsyncStorage.getItem("@sort/day_start");
    expect(raw).not.toBeNull();
    expect(raw!.length).toBeLessThanOrEqual(40);
  });

  it("names only the day it was taken for", async () => {
    await recordSortSolve(DAY, 7);
    expect(await dayStartOn(DAY)).toEqual({ sort: 7 });
    expect(await dayStartOn("2026-11-22")).toEqual({});
    await AsyncStorage.setItem("@sort/day_start", JSON.stringify({ day: DAY, best: -1 }));
    expect(await dayStartOn(DAY)).toEqual({});
  });

  it("reaches the offline card through loadOfflineDay", async () => {
    await saveUpcoming(DAY, [{ challengeId: DAY, goals: [newLevels(2)] }]);
    await recordSortSolve(DAY, 30);
    const now = Date.parse(`${DAY}T12:00:00Z`);
    const offline = await loadOfflineDay(DAY, 0, now);
    expect(offline.dayStart).toEqual({ sort: 30 });
    const out = withLocalProgress(offline.base!, sortGames([31, 32]), offline.dayStart);
    expect(out.goals[0]!.completed).toBe(true);
  });
});

describe("copy", () => {
  const LOCALES_DIR = path.resolve(__dirname, "../../../i18n/locales");
  const locales = fs
    .readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name);

  it("covers every locale directory", () => {
    expect(locales.length).toBeGreaterThanOrEqual(13);
  });

  it.each(locales)("%s words the goal with {{game}}", (locale) => {
    const file = path.join(LOCALES_DIR, locale, "daily_challenge.json");
    const copy = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
    const other = copy[`goal.sort.${NEW_LEVELS_KIND}_other`];
    expect(other).toContain("{{game}}");
    expect(other).toContain("{{count}}");
  });
});
