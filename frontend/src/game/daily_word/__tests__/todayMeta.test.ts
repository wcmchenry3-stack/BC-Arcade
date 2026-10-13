import AsyncStorage from "@react-native-async-storage/async-storage";
import { dailyWordApi } from "../api";
import { loadTodayMeta } from "../storage";
import i18n from "i18next";
import { __forceStoreBuildForTests } from "../../_shared/buildFlavour";
import { dailyWordLanguages, getLanguage, localDateKey, warmTodayMeta } from "../todayMeta";

jest.mock("../api", () => ({ dailyWordApi: { getToday: jest.fn() } }));

const getToday = dailyWordApi.getToday as jest.Mock;
const META = { puzzle_id: "2026-05-03:en", word_length: 5 };

describe("warmTodayMeta (#2925)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    getToday.mockReset();
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

  it("swallows errors and caches nothing", async () => {
    getToday.mockRejectedValue(new TypeError("Network request failed"));
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
    await i18n.changeLanguage("fr-CA");
    expect(getLanguage("ios")).toBe("en");
  });

  it("keeps en as en in a store build", async () => {
    __forceStoreBuildForTests(true);
    await i18n.changeLanguage("en");
    expect(getLanguage("ios")).toBe("en");
  });
});
