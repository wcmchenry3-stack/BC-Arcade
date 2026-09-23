import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import {
  DISPLAY_NAME_MAX_LENGTH,
  loadDisplayName,
  normalizeDisplayName,
  resetDisplayNameCacheForTests,
  saveDisplayName,
  useDisplayName,
} from "../displayName";

beforeEach(async () => {
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
});

describe("normalizeDisplayName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeDisplayName("  Riley  ")).toBe("Riley");
  });

  it("rejects empty and whitespace-only names", () => {
    expect(normalizeDisplayName("")).toBeNull();
    expect(normalizeDisplayName("   ")).toBeNull();
  });

  it("accepts exactly the max length and rejects one more", () => {
    expect(normalizeDisplayName("a".repeat(DISPLAY_NAME_MAX_LENGTH))).toHaveLength(32);
    expect(normalizeDisplayName("a".repeat(DISPLAY_NAME_MAX_LENGTH + 1))).toBeNull();
  });
});

describe("load/save", () => {
  it("returns null when nothing is stored", async () => {
    await expect(loadDisplayName()).resolves.toBeNull();
  });

  it("persists a trimmed name that a fresh load reads back", async () => {
    await expect(saveDisplayName("  Riley ")).resolves.toBe("Riley");
    resetDisplayNameCacheForTests();
    await expect(loadDisplayName()).resolves.toBe("Riley");
  });

  it("rejects an invalid name without touching storage", async () => {
    await saveDisplayName("Riley");
    (AsyncStorage.setItem as jest.Mock).mockClear();
    await expect(saveDisplayName("   ")).resolves.toBeNull();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    await expect(loadDisplayName()).resolves.toBe("Riley");
  });

  it("returns null when storage fails", async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("disk full"));
    await expect(saveDisplayName("Riley")).resolves.toBeNull();
  });

  it("ignores a stored value that is no longer valid", async () => {
    await AsyncStorage.setItem("player_display_name", "   ");
    await expect(loadDisplayName()).resolves.toBeNull();
  });
});

describe("useDisplayName", () => {
  it("loads the stored name", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    const { result } = await renderHook(() => useDisplayName());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.name).toBe("Riley");
  });

  it("shares a save across every mounted hook", async () => {
    const a = await renderHook(() => useDisplayName());
    const b = await renderHook(() => useDisplayName());
    await waitFor(() => expect(b.result.current.isLoaded).toBe(true));

    await act(async () => {
      await a.result.current.setName("Sam");
    });

    expect(a.result.current.name).toBe("Sam");
    expect(b.result.current.name).toBe("Sam");
  });
});
