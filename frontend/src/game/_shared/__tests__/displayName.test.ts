import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import {
  clearDisplayName,
  getCachedDisplayName,
  loadDisplayName,
  resetDisplayNameCacheForTests,
  storeAssignedDisplayName,
  useDisplayName,
} from "../displayName";

beforeEach(async () => {
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
});

describe("load/store (the device's copy of the server-assigned name, #2778)", () => {
  it("returns null when nothing is stored", async () => {
    await expect(loadDisplayName()).resolves.toBeNull();
  });

  it("persists an assigned name that a fresh load reads back", async () => {
    await expect(storeAssignedDisplayName("Brave Otter 4821")).resolves.toBe(true);
    expect(getCachedDisplayName()).toBe("Brave Otter 4821");
    resetDisplayNameCacheForTests();
    await expect(loadDisplayName()).resolves.toBe("Brave Otter 4821");
  });

  it("ignores a blank name", async () => {
    await expect(storeAssignedDisplayName("   ")).resolves.toBe(false);
    await expect(loadDisplayName()).resolves.toBeNull();
  });

  it("keeps the name in memory when storage fails", async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("disk full"));
    await expect(storeAssignedDisplayName("Calm Owl 12")).resolves.toBe(false);
    await expect(loadDisplayName()).resolves.toBe("Calm Owl 12");
  });

  it("ignores a stored blank value", async () => {
    await AsyncStorage.setItem("player_display_name", "   ");
    await expect(loadDisplayName()).resolves.toBeNull();
  });

  it("clears the name", async () => {
    await storeAssignedDisplayName("Calm Owl 12");
    await expect(clearDisplayName()).resolves.toBe(true);
    await expect(loadDisplayName()).resolves.toBeNull();
    await expect(AsyncStorage.getItem("player_display_name")).resolves.toBeNull();
  });
});

describe("useDisplayName", () => {
  it("loads the stored name", async () => {
    await AsyncStorage.setItem("player_display_name", "Calm Owl 12");
    const { result } = await renderHook(() => useDisplayName());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.name).toBe("Calm Owl 12");
  });

  it("shares a change across every mounted hook", async () => {
    const a = await renderHook(() => useDisplayName());
    const b = await renderHook(() => useDisplayName());
    await waitFor(() => expect(b.result.current.isLoaded).toBe(true));

    await act(async () => {
      await storeAssignedDisplayName("Sunny Seal 77");
    });
    expect(a.result.current.name).toBe("Sunny Seal 77");
    expect(b.result.current.name).toBe("Sunny Seal 77");

    await act(async () => {
      await clearDisplayName();
    });
    expect(a.result.current.name).toBeNull();
    expect(b.result.current.name).toBeNull();
  });
});
