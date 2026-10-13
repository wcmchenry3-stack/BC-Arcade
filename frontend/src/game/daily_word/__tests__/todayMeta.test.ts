import AsyncStorage from "@react-native-async-storage/async-storage";
import { dailyWordApi } from "../api";
import { loadTodayMeta } from "../storage";
import i18n from "i18next";
import { __forceStoreBuildForTests } from "../../_shared/buildFlavour";
import { dailyWordLanguages, getLanguage, localDateKey, warmTodayMeta } from "../todayMeta";

jest.mock("../api", () => ({ dailyWordApi: { getToday: jest.fn(), getUpcoming: jest.fn() } }));

const getToday = dailyWordApi.getToday as jest.Mock;
const getUpcoming = dailyWordApi.getUpcoming as jest.Mock;
const META = { puzzle_id: "2026-05-03:en", word_length: 5 };

describe("warmTodayMeta (#2925)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    getToday.mockReset();
    getUpcoming.mockReset();
    // Freeze the clock so the written and asserted keys can't straddle midnight.
    jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 4, 3, 12));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("writes the key the screen reads", async () => {
    getToday.mockResolvedValue(META);
    await warmTodayMeta(120, "en");
    expect(getToday).toHaveBeenCalledWith(120, "en");
    expect(await loadTodayMeta(localDateKey(120, "en"))).toEqual(META);
  });

  it("skips the fetch when today's meta is already cached", async () => {
    getToday.mockResolvedValue(META);
    await warmTodayMeta(0, "en");
    await warmTodayMeta(0, "en");
    expect(getToday).toHaveBeenCalledTimes(1);
  });

  it("also stores the puzzles ahead for offline play (#3230)", async () => {
    getToday.mockResolvedValue(META);
    const ahead = [{ puzzle_id: "2026-05-05:en:2", word_length: 5, answer_blob: "AAAAAAA=" }];
    getUpcoming.mockResolvedValue(ahead);
    await warmTodayMeta(0, "en");
    expect(getUpcoming).toHaveBeenCalledWith(0, "en");
    expect(JSON.parse((await AsyncStorage.getItem("daily_word_upcoming_en"))!)).toEqual(ahead);
  });

  it("does not fetch puzzles ahead for an online-only language", async () => {
    getToday.mockResolvedValue({ puzzle_id: "2026-05-03:hi", word_length: 4 });
    await warmTodayMeta(0, "hi");
    expect(getUpcoming).not.toHaveBeenCalled();
  });

  it("swallows errors and caches nothing", async () => {
    getToday.mockRejectedValue(new TypeError("Network request failed"));
    getUpcoming.mockRejectedValue(new TypeError("Network request failed"));
    await expect(warmTodayMeta(0, "en")).resolves.toBeUndefined();
    expect(await loadTodayMeta(localDateKey(0, "en"))).toBeNull();
  });
});

describe("getLanguage (#3153)", () => {
  const original = i18n.language;

  afterEach(async () => {
    __forceStoreBuildForTests(false);
    await i18n.changeLanguage(original);
  });

  it("native store build: maps hi to en", async () => {
    __forceStoreBuildForTests(true);
    await i18n.changeLanguage("hi");
    expect(getLanguage("ios")).toBe("en");
    expect(getLanguage("android")).toBe("en");
    expect(dailyWordLanguages("ios")).toEqual(["en"]);
  });

  it("web keeps hi even when the build is a store build", async () => {
    __forceStoreBuildForTests(true);
    await i18n.changeLanguage("hi");
    expect(getLanguage("web")).toBe("hi");
  });

  it("internal build: maps hi to hi on native", async () => {
    await i18n.changeLanguage("hi");
    expect(getLanguage("ios")).toBe("hi");
  });

  it("falls back to en for languages without a puzzle", async () => {
    await i18n.changeLanguage("de");
    expect(getLanguage("ios")).toBe("en");
    await i18n.changeLanguage("ja");
    expect(getLanguage("ios")).toBe("en");
  });

  // #3241 — fr-CA and es have puzzles, held back from store builds until #3201.
  it("internal build: maps fr-CA to fr and es to es on native", async () => {
    await i18n.changeLanguage("fr-CA");
    expect(getLanguage("ios")).toBe("fr");
    expect(getLanguage("android")).toBe("fr");
    await i18n.changeLanguage("es");
    expect(getLanguage("ios")).toBe("es");
    expect(getLanguage("android")).toBe("es");
  });

  it("web plays fr and es even in a store build", async () => {
    __forceStoreBuildForTests(true);
    await i18n.changeLanguage("fr-CA");
    expect(getLanguage("web")).toBe("fr");
    await i18n.changeLanguage("es");
    expect(getLanguage("web")).toBe("es");
  });

  it("native store build: fr-CA and es still get the English puzzle", async () => {
    __forceStoreBuildForTests(true);
    await i18n.changeLanguage("fr-CA");
    expect(getLanguage("ios")).toBe("en");
    expect(getLanguage("android")).toBe("en");
    await i18n.changeLanguage("es");
    expect(getLanguage("ios")).toBe("en");
    expect(getLanguage("android")).toBe("en");
    expect(dailyWordLanguages("ios")).toEqual(["en"]);
  });

  it("knows fr and es as Daily Word languages off the store", () => {
    expect(dailyWordLanguages("web")).toEqual(expect.arrayContaining(["en", "hi", "fr", "es"]));
  });

  it("keeps en as en in a store build", async () => {
    __forceStoreBuildForTests(true);
    await i18n.changeLanguage("en");
    expect(getLanguage("ios")).toBe("en");
  });
});
