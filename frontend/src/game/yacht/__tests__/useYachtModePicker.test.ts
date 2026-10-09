import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook } from "@testing-library/react-native";
import { useYachtModePicker } from "../useYachtModePicker";
import { lastDifficultyKey } from "../../_shared/lastDifficulty";
import { __setPremiumLevelsForTests } from "../../../entitlements/premiumLevels";

// The key and JSON shape Yacht has always stored the last mode under (#1129).
// Players already have it on their devices, so it must keep loading as is.
const LEGACY_PREF_KEY = "yacht_pref_v1";

const flush = () => act(async () => {});

async function storedPref(): Promise<unknown> {
  const raw = await AsyncStorage.getItem(LEGACY_PREF_KEY);
  return raw === null ? null : JSON.parse(raw);
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

afterEach(() => {
  __setPremiumLevelsForTests(null);
});

describe("useYachtModePicker", () => {
  it("opens on Solo at medium when nothing is stored", async () => {
    const { result } = await renderHook(() => useYachtModePicker());
    await flush();
    expect(result.current.mode).toBe("solo");
    expect(result.current.difficulty).toBe("medium");
  });

  it("restores a last mode saved before the move to useLastDifficulty", async () => {
    await AsyncStorage.setItem(LEGACY_PREF_KEY, JSON.stringify({ mode: "vs", difficulty: "hard" }));
    const { result } = await renderHook(() => useYachtModePicker());
    await flush();
    expect(result.current.mode).toBe("vs");
    expect(result.current.difficulty).toBe("hard");
  });

  it("keeps writing the same key and format, never the shared slot", async () => {
    const { result } = await renderHook(() => useYachtModePicker());
    await flush();
    await act(async () => result.current.setDifficulty("easy"));
    await act(async () => {
      result.current.chooseVs();
    });
    await flush();
    expect(await storedPref()).toEqual({ mode: "vs", difficulty: "easy" });
    expect(await AsyncStorage.getItem(lastDifficultyKey("yacht"))).toBeNull();
  });

  it("chooseVs starts at the picker's difficulty", async () => {
    const { result } = await renderHook(() => useYachtModePicker());
    await flush();
    await act(async () => result.current.setDifficulty("hard"));
    let started: string | undefined;
    await act(async () => {
      started = result.current.chooseVs();
    });
    expect(started).toBe("hard");
  });

  it("Solo keeps the last VS difficulty played, not one merely tapped", async () => {
    await AsyncStorage.setItem(LEGACY_PREF_KEY, JSON.stringify({ mode: "vs", difficulty: "easy" }));
    const { result } = await renderHook(() => useYachtModePicker());
    await flush();
    await act(async () => result.current.setDifficulty("hard"));
    await act(async () => result.current.chooseSolo());
    await flush();
    expect(await storedPref()).toEqual({ mode: "solo", difficulty: "easy" });
  });

  it("reload re-opens the picker on what is stored", async () => {
    const { result } = await renderHook(() => useYachtModePicker());
    await flush();
    await act(async () => result.current.setDifficulty("hard"));
    await act(async () => {
      result.current.chooseVs();
    });
    await act(async () => result.current.setDifficulty("easy"));
    await act(async () => result.current.reload());
    expect(result.current.mode).toBe("vs");
    expect(result.current.difficulty).toBe("hard");
  });

  it("a stored difficulty that is now premium opens at medium (#1129)", async () => {
    __setPremiumLevelsForTests({ yacht: ["hard"] });
    await AsyncStorage.setItem(LEGACY_PREF_KEY, JSON.stringify({ mode: "vs", difficulty: "hard" }));
    const { result } = await renderHook(() => useYachtModePicker());
    await flush();
    expect(result.current.mode).toBe("vs");
    expect(result.current.difficulty).toBe("medium");
  });
});
