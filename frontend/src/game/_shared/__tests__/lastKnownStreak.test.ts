import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  LAST_KNOWN_STREAK_KEY,
  clearLastKnownStreak,
  getLastKnownStreak,
  saveLastKnownStreak,
} from "../lastKnownStreak";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("lastKnownStreak", () => {
  it("is null when nothing was saved", async () => {
    expect(await getLastKnownStreak()).toBeNull();
  });

  it("round-trips a streak, including 0, and keeps the latest", async () => {
    await saveLastKnownStreak(7);
    expect(await getLastKnownStreak()).toBe(7);
    await saveLastKnownStreak(0);
    expect(await getLastKnownStreak()).toBe(0);
  });

  it("ignores a corrupt value and can be cleared", async () => {
    await AsyncStorage.setItem(LAST_KNOWN_STREAK_KEY, "-3");
    expect(await getLastKnownStreak()).toBeNull();
    await saveLastKnownStreak(4);
    await clearLastKnownStreak();
    expect(await getLastKnownStreak()).toBeNull();
  });

  it("never throws when storage fails", async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("disk full"));
    await expect(saveLastKnownStreak(2)).resolves.toBeUndefined();
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error("unreadable"));
    expect(await getLastKnownStreak()).toBeNull();
  });
});
