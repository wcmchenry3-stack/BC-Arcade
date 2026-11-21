import { act, renderHook } from "@testing-library/react-native";

import type { TileStatus } from "../../game/_shared/lobbyStatus";
import { LOBBY_STATUS_READERS } from "../../components/home/lobbyStatusReaders";
import { HIDDEN_GAMES } from "../../entitlements/gameVisibility";
import { useLobbyTileStatus } from "../useLobbyTileStatus";

const resume: TileStatus = { kind: "resume" };
const best: TileStatus = { kind: "best", value: 10, unit: "score" };

function makeNav() {
  const listeners: Array<() => void> = [];
  const unsubscribe = jest.fn();
  return {
    navigation: {
      addListener: jest.fn((_event: "focus", cb: () => void) => {
        listeners.push(cb);
        return unsubscribe;
      }),
    },
    focus: () => listeners.forEach((cb) => cb()),
    unsubscribe,
  };
}

/** Runs the timer that defers the reads past first paint, then their promises. */
async function flushReads() {
  await act(async () => {
    jest.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useLobbyTileStatus (#4008)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("starts empty and reads nothing until after first paint", async () => {
    const yacht = jest.fn().mockResolvedValue(resume);
    const { navigation } = makeNav();
    const { result } = await renderHook(() => useLobbyTileStatus(["yacht"], navigation, { yacht }));
    expect(result.current).toEqual({});
    expect(yacht).not.toHaveBeenCalled();
    await flushReads();
    expect(yacht).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ yacht: resume });
  });

  it("starts every read in one batch, before any has landed", async () => {
    let releaseYacht: (s: TileStatus) => void = () => undefined;
    const yacht = jest.fn(() => new Promise<TileStatus | undefined>((r) => (releaseYacht = r)));
    const twenty48 = jest.fn().mockResolvedValue(best);
    const { navigation } = makeNav();
    const { result } = await renderHook(() =>
      useLobbyTileStatus(["yacht", "twenty48"], navigation, { yacht, twenty48 })
    );
    await flushReads();
    // The slow read is still out; the other was started with it, not after it.
    expect(yacht).toHaveBeenCalledTimes(1);
    expect(twenty48).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({});
    await act(async () => {
      releaseYacht(resume);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current).toEqual({ yacht: resume, twenty48: best });
  });

  it("reads only the slugs it is given, and only those with a reader", async () => {
    const yacht = jest.fn().mockResolvedValue(resume);
    const hidden = jest.fn().mockResolvedValue(resume);
    const { navigation } = makeNav();
    // "cascade" is not visible (not in the list); "sort" is visible but has no reader.
    const { result } = await renderHook(() =>
      useLobbyTileStatus(["yacht", "sort"], navigation, { yacht, cascade: hidden })
    );
    await flushReads();
    expect(hidden).not.toHaveBeenCalled();
    expect(result.current).toEqual({ yacht: resume });
    expect(result.current.sort).toBeUndefined();
  });

  it("reads again on focus and only then, not on a re-render", async () => {
    const yacht = jest.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(resume);
    const nav = makeNav();
    const readers = { yacht };
    const { result, rerender } = await renderHook(() =>
      useLobbyTileStatus(["yacht"], nav.navigation, readers)
    );
    await flushReads();
    expect(result.current).toEqual({ yacht: undefined });
    await rerender({});
    await flushReads();
    expect(yacht).toHaveBeenCalledTimes(1);

    await act(async () => nav.focus());
    await flushReads();
    expect(yacht).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ yacht: resume });
  });

  it("shares one read between the mount and the focus that follows it", async () => {
    const yacht = jest.fn().mockResolvedValue(resume);
    const nav = makeNav();
    await renderHook(() => useLobbyTileStatus(["yacht"], nav.navigation, { yacht }));
    await act(async () => nav.focus());
    await flushReads();
    expect(yacht).toHaveBeenCalledTimes(1);
  });

  it("gives a tile no status when its read fails or throws, and keeps the others", async () => {
    const yacht = jest.fn().mockRejectedValue(new Error("disk"));
    const twenty48 = jest.fn(() => {
      throw new Error("sync");
    });
    const solitaire = jest.fn().mockResolvedValue(best);
    const { navigation } = makeNav();
    const { result } = await renderHook(() =>
      useLobbyTileStatus(["yacht", "twenty48", "solitaire"], navigation, {
        yacht,
        twenty48,
        solitaire,
      })
    );
    await flushReads();
    expect(result.current.yacht).toBeUndefined();
    expect(result.current.twenty48).toBeUndefined();
    expect(result.current.solitaire).toEqual(best);
  });

  it("drops a status that is gone on the next read", async () => {
    const yacht = jest.fn().mockResolvedValueOnce(resume).mockResolvedValueOnce(undefined);
    const nav = makeNav();
    const readers = { yacht };
    const { result } = await renderHook(() =>
      useLobbyTileStatus(["yacht"], nav.navigation, readers)
    );
    await flushReads();
    expect(result.current.yacht).toEqual(resume);
    await act(async () => nav.focus());
    await flushReads();
    expect(result.current.yacht).toBeUndefined();
  });

  it("does not set state after unmount, and stops listening", async () => {
    const yacht = jest.fn().mockResolvedValue(resume);
    const nav = makeNav();
    const { unmount } = await renderHook(() =>
      useLobbyTileStatus(["yacht"], nav.navigation, { yacht })
    );
    await unmount();
    await flushReads();
    expect(yacht).not.toHaveBeenCalled();
    expect(nav.unsubscribe).toHaveBeenCalled();
  });
});

describe("LOBBY_STATUS_READERS (#4008)", () => {
  it("lists no hidden game, so a store bundle holds none of their storage code", () => {
    for (const slug of Object.keys(LOBBY_STATUS_READERS)) {
      expect(HIDDEN_GAMES.has(slug)).toBe(false);
    }
  });

  it("covers the resumable and best-keeping free games and Daily Word", () => {
    expect(Object.keys(LOBBY_STATUS_READERS).sort()).toEqual([
      "daily_word",
      "freecell",
      "solitaire",
      "sudoku",
      "twenty48",
      "yacht",
    ]);
  });
});
