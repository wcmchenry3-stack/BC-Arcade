import AsyncStorage from "@react-native-async-storage/async-storage";
import fixture from "../../../../../backend/tests/fixtures/daily_word_parity.json";
import { dailyWordApi } from "../api";
import {
  findOfflinePuzzle,
  localDateString,
  offlineAnswerFor,
  resolveOfflinePuzzle,
  warmUpcoming,
} from "../offlinePuzzles";
import { LAST_CONNECTED_KEY } from "../../_shared/lastConnected";

jest.mock("../api", () => ({ dailyWordApi: { getUpcoming: jest.fn() } }));

const getUpcoming = dailyWordApi.getUpcoming as jest.Mock;

// The fixture's three English days: 13, 14 and 15 October 2026.
const UPCOMING = fixture.answer_blobs
  .filter((b) => b.puzzle_id.includes(":en:"))
  .map((b) => ({ puzzle_id: b.puzzle_id, word_length: 5, answer_blob: b.answer_blob }));
const ANSWERS = ["crane", "abbey", "zesty"];
const UPCOMING_KEY = "daily_word_upcoming_en";

/** Noon UTC on 2026-10-<day>. */
const at = (day: number) => Date.UTC(2026, 9, day, 12);

beforeEach(async () => {
  await AsyncStorage.clear();
  getUpcoming.mockReset();
  // Offset 0 throughout, so the device's local day is the UTC day.
  jest.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(0);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("localDateString", () => {
  it("is the local date at the offset, days ahead", () => {
    const now = Date.UTC(2026, 9, 13, 23, 30);
    expect(localDateString(0, 0, now)).toBe("2026-10-13");
    expect(localDateString(60, 0, now)).toBe("2026-10-14");
    expect(localDateString(-600, 2, now)).toBe("2026-10-15");
  });
});

describe("warmUpcoming", () => {
  it("stores the puzzles ahead, scrambled", async () => {
    jest.spyOn(Date, "now").mockReturnValue(at(13));
    getUpcoming.mockResolvedValue(UPCOMING);
    await warmUpcoming(0, "en");
    expect(getUpcoming).toHaveBeenCalledWith(0, "en");
    const raw = (await AsyncStorage.getItem(UPCOMING_KEY))!;
    expect(JSON.parse(raw)).toEqual(UPCOMING);
    // The answers are not stored as plain text (#3022).
    for (const a of ANSWERS) expect(raw).not.toContain(a);
  });

  it("skips the fetch once the cache reaches two days ahead", async () => {
    jest.spyOn(Date, "now").mockReturnValue(at(13));
    getUpcoming.mockResolvedValue(UPCOMING);
    await warmUpcoming(0, "en");
    await warmUpcoming(0, "en");
    expect(getUpcoming).toHaveBeenCalledTimes(1);
  });

  it("fetches again the next day", async () => {
    getUpcoming.mockResolvedValue(UPCOMING);
    jest.spyOn(Date, "now").mockReturnValue(at(13));
    await warmUpcoming(0, "en");
    jest.spyOn(Date, "now").mockReturnValue(at(14));
    await warmUpcoming(0, "en");
    expect(getUpcoming).toHaveBeenCalledTimes(2);
  });

  it("does not fetch online-only languages", async () => {
    await warmUpcoming(0, "hi");
    expect(getUpcoming).not.toHaveBeenCalled();
  });

  it("drops malformed entries and keeps the cache on a bad response", async () => {
    jest.spyOn(Date, "now").mockReturnValue(at(13));
    getUpcoming.mockResolvedValueOnce([UPCOMING[0], { puzzle_id: "x" }, null]);
    await warmUpcoming(0, "en");
    expect(JSON.parse((await AsyncStorage.getItem(UPCOMING_KEY))!)).toEqual([UPCOMING[0]]);

    getUpcoming.mockResolvedValueOnce({});
    await warmUpcoming(0, "en");
    expect(JSON.parse((await AsyncStorage.getItem(UPCOMING_KEY))!)).toEqual([UPCOMING[0]]);
  });

  it("swallows errors", async () => {
    getUpcoming.mockRejectedValue(new TypeError("Network request failed"));
    await expect(warmUpcoming(0, "en")).resolves.toBeUndefined();
    expect(await AsyncStorage.getItem(UPCOMING_KEY)).toBeNull();
  });
});

describe("findOfflinePuzzle / offlineAnswerFor", () => {
  beforeEach(async () => {
    await AsyncStorage.setItem(UPCOMING_KEY, JSON.stringify(UPCOMING));
  });

  it.each([13, 14, 15])("plays the puzzle for local day %i", async (day) => {
    const found = await findOfflinePuzzle(0, "en", at(day));
    expect(found).toEqual({
      puzzle_id: `2026-10-${day}:en:2`,
      word_length: 5,
      answer: ANSWERS[day - 13],
    });
  });

  it("has none once the days fetched ahead are over", async () => {
    expect(await findOfflinePuzzle(0, "en", at(16))).toBe("none");
  });

  it("reports never when nothing was fetched, or for an online-only language", async () => {
    await AsyncStorage.removeItem(UPCOMING_KEY);
    expect(await findOfflinePuzzle(0, "en", at(13))).toBe("never");
    expect(await findOfflinePuzzle(0, "hi", at(13))).toBe("never");
  });

  it("ignores a corrupt cache", async () => {
    await AsyncStorage.setItem(UPCOMING_KEY, "{oops");
    expect(await findOfflinePuzzle(0, "en", at(13))).toBe("never");
  });

  it("decodes the answer for a cached puzzle id only", async () => {
    expect(await offlineAnswerFor("2026-10-14:en:2")).toBe("abbey");
    expect(await offlineAnswerFor("2026-10-20:en:2")).toBeNull();
    expect(await offlineAnswerFor("2026-10-13:hi")).toBeNull();
  });
});

describe("resolveOfflinePuzzle (days 1-3 playable, day 4 exhausted)", () => {
  beforeEach(async () => {
    await AsyncStorage.setItem(UPCOMING_KEY, JSON.stringify(UPCOMING));
    // Last connected on the morning of day 1.
    await AsyncStorage.setItem(LAST_CONNECTED_KEY, String(Date.UTC(2026, 9, 13, 8)));
  });

  it.each([13, 14, 15])("day %i offline plays its puzzle", async (day) => {
    const found = await resolveOfflinePuzzle(0, "en", at(day));
    expect(found).toMatchObject({ puzzle_id: `2026-10-${day}:en:2` });
  });

  it("day 4 is exhausted", async () => {
    expect(await resolveOfflinePuzzle(0, "en", at(16))).toBe("exhausted");
  });

  it("is exhausted once the window is used up, even with a puzzle cached", async () => {
    await AsyncStorage.setItem(LAST_CONNECTED_KEY, String(Date.UTC(2026, 9, 10, 8)));
    expect(await resolveOfflinePuzzle(0, "en", at(13))).toBe("exhausted");
  });

  it("falls back (null) when nothing was ever fetched and the window is open", async () => {
    await AsyncStorage.removeItem(UPCOMING_KEY);
    expect(await resolveOfflinePuzzle(0, "en", at(13))).toBeNull();
  });

  it("is exhausted when nothing was fetched and the window is used up", async () => {
    await AsyncStorage.removeItem(UPCOMING_KEY);
    expect(await resolveOfflinePuzzle(0, "en", at(20))).toBe("exhausted");
  });

  it("does not apply to online-only languages", async () => {
    expect(await resolveOfflinePuzzle(0, "hi", at(20))).toBeNull();
  });
});
