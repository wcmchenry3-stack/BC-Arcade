import AsyncStorage from "@react-native-async-storage/async-storage";
import { LEGACY_SCORE_QUEUE_KEY, clearLegacyScoreQueue } from "../legacyScoreQueue";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("clearLegacyScoreQueue (#2644)", () => {
  it("removes what an older build left in the score queue", async () => {
    const leftover = [{ id: "q-1", game_type: "solitaire", payload: { player_name: "Riley" } }];
    await AsyncStorage.setItem(LEGACY_SCORE_QUEUE_KEY, JSON.stringify(leftover));
    await AsyncStorage.setItem("other_key", "kept");

    await clearLegacyScoreQueue();

    expect(await AsyncStorage.getItem(LEGACY_SCORE_QUEUE_KEY)).toBeNull();
    expect(await AsyncStorage.getItem("other_key")).toBe("kept");
  });

  it("is a no-op when there is nothing to clear", async () => {
    await expect(clearLegacyScoreQueue()).resolves.toBeUndefined();
  });

  it("never rejects", async () => {
    const removeItem = jest
      .spyOn(AsyncStorage, "removeItem")
      .mockRejectedValueOnce(new Error("disk"));
    await expect(clearLegacyScoreQueue()).resolves.toBeUndefined();
    removeItem.mockRestore();
  });
});
