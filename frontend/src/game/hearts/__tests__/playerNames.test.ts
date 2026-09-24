import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadPlayerNames, savePlayerNames } from "../playerNames";
import { resetDisplayNameCacheForTests, saveDisplayName } from "../../_shared/displayName";

beforeEach(async () => {
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
});

describe("loadPlayerNames", () => {
  it("returns the defaults when nothing is stored", async () => {
    await expect(loadPlayerNames()).resolves.toEqual(["You", "West", "North", "East"]);
  });

  it("uses the profile display name for the human seat (#2502)", async () => {
    await saveDisplayName("Riley");
    await expect(loadPlayerNames()).resolves.toEqual(["Riley", "West", "North", "East"]);
  });

  it("keeps a seat name the player chose in Hearts over the display name", async () => {
    await saveDisplayName("Riley");
    await savePlayerNames(["Ace", "West", "North", "East"]);
    await expect(loadPlayerNames()).resolves.toEqual(["Ace", "West", "North", "East"]);
  });

  it("keeps following the display name after the player renames a different seat", async () => {
    await saveDisplayName("Riley");
    // The rename form is seeded from loadPlayerNames(), so seat 0 comes back as "Riley".
    const seeded = await loadPlayerNames();
    await savePlayerNames([seeded[0] ?? "", "Bob", "North", "East"]);

    await saveDisplayName("Sam");
    await expect(loadPlayerNames()).resolves.toEqual(["Sam", "Bob", "North", "East"]);
  });
});
