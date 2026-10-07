/**
 * #2962: the screen's shared free set (`useFreeTiles`) is built once per board, and
 * `freeIdsFor` hands it to the engine only for the board it was built from.
 */
import { renderHook } from "@testing-library/react-native";

import * as engine from "../engine";
import { createGame, freeTileIds } from "../engine";
import { getLayout } from "../layouts/registry";
import type { MahjongState } from "../types";
import { freeIdsFor, useFreeTiles } from "../useFreeTiles";

afterEach(() => {
  jest.restoreAllMocks();
});

const game = createGame(getLayout("turtle"), 3);

describe("useFreeTiles", () => {
  it("is the board's free set, rebuilt only when the board changes", async () => {
    const expected = [...freeTileIds(game.tiles)];
    const build = jest.spyOn(engine, "freeTileIds");
    const hook = await renderHook(({ s }: { s: MahjongState | null }) => useFreeTiles(s), {
      initialProps: { s: game },
    });
    const first = hook.result.current;
    expect(first.tiles).toBe(game.tiles);
    expect([...first.ids]).toEqual(expected);
    expect(first.noFreePairs).toBe(false);
    expect(build).toHaveBeenCalledTimes(1);

    // A selection or a clock change keeps the board, and the same object.
    await hook.rerender({ s: { ...game, selected: game.tiles[0]!, accumulatedMs: 5 } });
    expect(hook.result.current).toBe(first);
    expect(build).toHaveBeenCalledTimes(1);

    const fewer = { ...game, tiles: game.tiles.slice(2) };
    await hook.rerender({ s: fewer });
    expect(hook.result.current.tiles).toBe(fewer.tiles);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("reports no free pairs only for an unfinished game", async () => {
    // Two stacked tiles: only the top one is free, so nothing pairs.
    const stuck: MahjongState = {
      ...game,
      tiles: [
        { ...game.tiles[0]!, col: 0, row: 0, layer: 0 },
        { ...game.tiles[1]!, col: 0, row: 0, layer: 1 },
      ],
    };
    const hook = await renderHook(({ s }: { s: MahjongState | null }) => useFreeTiles(s), {
      initialProps: { s: stuck },
    });
    expect(hook.result.current.noFreePairs).toBe(true);
    await hook.rerender({ s: { ...stuck, isComplete: true } });
    expect(hook.result.current.noFreePairs).toBe(false);
    await hook.rerender({ s: null });
    expect(hook.result.current).toMatchObject({ tiles: [], noFreePairs: false });
    expect(hook.result.current.ids.size).toBe(0);
  });
});

describe("freeIdsFor", () => {
  it("gives the free set only for the board it was built from", async () => {
    const hook = await renderHook(() => useFreeTiles(game));
    const free = hook.result.current;
    expect(freeIdsFor(free, game.tiles)).toBe(free.ids);
    // A functional update running on a newer board gets nothing; the engine checks itself.
    expect(freeIdsFor(free, game.tiles.slice(2))).toBeUndefined();
  });
});
