import AsyncStorage from "@react-native-async-storage/async-storage";
import { dailyWordApi } from "../api";
import { loadTodayMeta } from "../storage";
import { localDateKey, warmTodayMeta } from "../todayMeta";

jest.mock("../api", () => ({ dailyWordApi: { getToday: jest.fn() } }));

const getToday = dailyWordApi.getToday as jest.Mock;
const META = { puzzle_id: "2026-05-03:en", word_length: 5 };

describe("warmTodayMeta (#2925)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    getToday.mockReset();
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
