import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook } from "@testing-library/react-native";
import {
  lastDifficultyKey,
  loadLastDifficulty,
  saveLastDifficulty,
  useLastDifficulty,
} from "../lastDifficulty";
import { __setPremiumLevelsForTests } from "../../../entitlements/premiumLevels";

const LEVELS = ["easy", "medium", "hard"] as const;
type Level = (typeof LEVELS)[number];

beforeEach(async () => {
  await AsyncStorage.clear();
});

afterEach(() => {
  __setPremiumLevelsForTests(null);
});

describe("loadLastDifficulty / saveLastDifficulty", () => {
  it("keeps Star Swarm's existing key form", () => {
    expect(lastDifficultyKey("starswarm")).toBe("starswarm.difficulty");
  });

  it("round-trips a level per game", async () => {
    await saveLastDifficulty("sudoku", "hard");
    await saveLastDifficulty("yacht", "easy");
    expect(await loadLastDifficulty("sudoku", LEVELS)).toBe("hard");
    expect(await loadLastDifficulty("yacht", LEVELS)).toBe("easy");
  });

  it("returns null when nothing is stored", async () => {
    expect(await loadLastDifficulty("sudoku", LEVELS)).toBeNull();
  });

  it("ignores a stored value that is no longer a level", async () => {
    await AsyncStorage.setItem("sudoku.difficulty", "expert");
    expect(await loadLastDifficulty("sudoku", LEVELS)).toBeNull();
  });

  it("ignores a stored level that is now premium", async () => {
    await saveLastDifficulty("sudoku", "hard");
    __setPremiumLevelsForTests({ sudoku: ["hard"] });
    expect(await loadLastDifficulty("sudoku", LEVELS)).toBeNull();
  });

  it("returns null when storage fails", async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error("disk"));
    expect(await loadLastDifficulty("sudoku", LEVELS)).toBeNull();
  });
});

describe("useLastDifficulty", () => {
  const flush = () => act(async () => {});

  it("starts at the fallback, then restores the stored level", async () => {
    await saveLastDifficulty("sudoku", "hard");
    const { result } = await renderHook(() => useLastDifficulty<Level>("sudoku", LEVELS, "easy"));
    await flush();
    expect(result.current.difficulty).toBe("hard");
  });

  it("stays on the fallback when nothing is stored", async () => {
    const { result } = await renderHook(() => useLastDifficulty<Level>("sudoku", LEVELS, "easy"));
    await flush();
    expect(result.current.difficulty).toBe("easy");
  });

  it("lets a level set before the stored one loads win", async () => {
    await saveLastDifficulty("sudoku", "hard");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(async () => {
      await gate;
      return "hard";
    });
    const { result } = await renderHook(() => useLastDifficulty<Level>("sudoku", LEVELS, "easy"));
    await act(async () => result.current.setDifficulty("medium"));
    await act(async () => release());
    expect(result.current.difficulty).toBe("medium");
  });

  it("starts at `initial` and does not restore when one is given", async () => {
    await saveLastDifficulty("starswarm", "hard");
    const { result } = await renderHook(() =>
      useLastDifficulty<Level>("starswarm", LEVELS, "easy", { initial: "medium" })
    );
    await flush();
    expect(result.current.difficulty).toBe("medium");
  });

  describe("premium levels", () => {
    beforeEach(() => {
      __setPremiumLevelsForTests({ sudoku: ["hard"] });
    });

    it("a picked premium level becomes the fallback", async () => {
      const { result } = await renderHook(() => useLastDifficulty<Level>("sudoku", LEVELS, "easy"));
      await act(async () => result.current.setDifficulty("medium"));
      await act(async () => result.current.setDifficulty("hard"));
      expect(result.current.difficulty).toBe("easy");
    });

    it("a game started at a premium level starts, and is stored, at the fallback", async () => {
      const { result } = await renderHook(() => useLastDifficulty<Level>("sudoku", LEVELS, "easy"));
      let started: Level | undefined;
      await act(async () => {
        started = result.current.rememberDifficulty("hard");
      });
      expect(started).toBe("easy");
      expect(result.current.difficulty).toBe("easy");
      expect(await AsyncStorage.getItem("sudoku.difficulty")).toBe("easy");
    });

    it("an open level starts as itself", async () => {
      const { result } = await renderHook(() => useLastDifficulty<Level>("sudoku", LEVELS, "easy"));
      let started: Level | undefined;
      await act(async () => {
        started = result.current.rememberDifficulty("medium");
      });
      expect(started).toBe("medium");
    });

    it("keeps a premium `initial` (a run already in progress)", async () => {
      const { result } = await renderHook(() =>
        useLastDifficulty<Level>("sudoku", LEVELS, "easy", { initial: "hard" })
      );
      await flush();
      expect(result.current.difficulty).toBe("hard");
    });

    it("warns in dev when the fallback itself is premium", async () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      await renderHook(() => useLastDifficulty<Level>("sudoku", LEVELS, "hard"));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('default level "hard" is premium'));
      warn.mockRestore();
    });
  });

  it("setDifficulty picks without storing; rememberDifficulty stores", async () => {
    const { result } = await renderHook(() => useLastDifficulty<Level>("hearts", LEVELS, "easy"));
    await flush();
    await act(async () => result.current.setDifficulty("medium"));
    expect(result.current.difficulty).toBe("medium");
    expect(await AsyncStorage.getItem("hearts.difficulty")).toBeNull();

    await act(async () => result.current.rememberDifficulty("hard"));
    expect(result.current.difficulty).toBe("hard");
    expect(await AsyncStorage.getItem("hearts.difficulty")).toBe("hard");
  });
});
