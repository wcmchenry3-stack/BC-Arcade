import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react-native";
import {
  useGameRestored,
  usePersistedGameState,
  type PersistedGameStateOptions,
} from "../usePersistedGameState";

interface Game {
  readonly moves: number;
}

/** A load the test resolves (or rejects) by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(
  load: () => Promise<Game | null>,
  onRestored: (loaded: Game | null) => void = () => {}
) {
  const save = jest.fn<Promise<void>, [Game]>(() => Promise.resolve());
  const clear = jest.fn<Promise<void>, []>(() => Promise.resolve());
  const options: PersistedGameStateOptions<Game> = { load, save, clear };
  return {
    save,
    clear,
    render: () =>
      renderHook(() => {
        const game = usePersistedGameState(options);
        useGameRestored(game, onRestored);
        return game;
      }),
  };
}

describe("usePersistedGameState", () => {
  it("restores the saved game on mount and hands it to the restore handler", async () => {
    const saved = { moves: 4 };
    const onRestored = jest.fn();
    const { render } = setup(() => Promise.resolve(saved), onRestored);
    const { result } = await render();

    expect(result.current.loading).toBe(false);
    expect(result.current.hasLoadedRef.current).toBe(true);
    expect(result.current.state).toBe(saved);
    expect(result.current.stateRef.current).toBe(saved);
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(onRestored).toHaveBeenCalledWith(saved);
  });

  it("starts fresh on a null load: no state, no save, the handler gets null", async () => {
    const onRestored = jest.fn();
    const { render, save } = setup(() => Promise.resolve(null), onRestored);
    const { result } = await render();

    expect(result.current.loading).toBe(false);
    expect(result.current.hasLoadedRef.current).toBe(true);
    expect(result.current.state).toBeNull();
    expect(onRestored).toHaveBeenCalledWith(null);
    expect(save).not.toHaveBeenCalled();
  });

  it("lets the restore handler replace the loaded state in the same batch", async () => {
    const saved = { moves: 4 };
    const adjusted = { moves: 5 };
    const save = jest.fn<Promise<void>, [Game]>(() => Promise.resolve());
    const rendered: (Game | null)[] = [];
    const { result } = await renderHook(() => {
      const game = usePersistedGameState<Game>({ load: () => Promise.resolve(saved), save });
      rendered.push(game.state);
      useGameRestored(game, () => game.setState(adjusted));
      return game;
    });

    expect(result.current.state).toBe(adjusted);
    // Only the replacement renders and is saved.
    expect(rendered).not.toContain(saved);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(adjusted);
  });

  it("saves nothing before the load lands, then saves every change", async () => {
    const load = deferred<Game | null>();
    const { render, save } = setup(() => load.promise);
    const { result } = await render();

    expect(result.current.loading).toBe(true);
    // A state set while the save is still being read must not overwrite it.
    await act(async () => result.current.setState({ moves: 0 }));
    expect(save).not.toHaveBeenCalled();
    expect(result.current.hasLoadedRef.current).toBe(false);

    const saved = { moves: 7 };
    await act(async () => load.resolve(saved));
    expect(result.current.state).toBe(saved);
    // The loaded state is saved back, as the screens always did.
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith(saved);

    const next = { moves: 8 };
    await act(async () => result.current.setState(next));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(next);
    expect(result.current.stateRef.current).toBe(next);

    // A null state (pre-game) saves nothing.
    await act(async () => result.current.setState(null));
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.stateRef.current).toBeNull();
  });

  it("sets nothing when the load lands after unmount (alive guard)", async () => {
    const load = deferred<Game | null>();
    const onRestored = jest.fn();
    const { render, save } = setup(() => load.promise, onRestored);
    const { result, unmount } = await render();
    const before = result.current;

    await act(async () => unmount());
    await act(async () => load.resolve({ moves: 3 }));

    expect(onRestored).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(before.hasLoadedRef.current).toBe(false);
    expect(result.current.state).toBeNull();
  });

  it("under StrictMode restores once and saves nothing before the load lands", async () => {
    const loads: ReturnType<typeof deferred<Game | null>>[] = [];
    const save = jest.fn<Promise<void>, [Game]>(() => Promise.resolve());
    const onRestored = jest.fn();
    const { result } = await renderHook(
      () => {
        const game = usePersistedGameState<Game>({
          load: () => {
            const d = deferred<Game | null>();
            loads.push(d);
            return d.promise;
          },
          save,
        });
        useGameRestored(game, onRestored);
        return game;
      },
      { wrapper: StrictMode }
    );

    await act(async () => result.current.setState({ moves: 0 }));
    expect(save).not.toHaveBeenCalled();

    // StrictMode's discarded mount loads too; whichever lands, the handler runs once.
    const saved = { moves: 6 };
    await act(async () => loads.forEach((d) => d.resolve(saved)));
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(onRestored).toHaveBeenCalledWith(saved);
    expect(result.current.state).toBe(saved);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(saved);
  });

  it("calls the handler of the latest commit even before its passive effects flush", async () => {
    const load = deferred<Game | null>();
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = await renderHook(
      ({ handler }: { handler: (g: Game | null) => void }) => {
        const game = usePersistedGameState<Game>({ load: () => load.promise, save: jest.fn() });
        useGameRestored(game, handler);
        return game;
      },
      { initialProps: { handler: first } }
    );
    await rerender({ handler: second });
    await act(async () => load.resolve(null));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(null);
  });

  it("reload runs the load again: loading turns true, then the handler runs with the result", async () => {
    const loads: ReturnType<typeof deferred<Game | null>>[] = [];
    const onRestored = jest.fn();
    const { render, save } = setup(() => {
      const d = deferred<Game | null>();
      loads.push(d);
      return d.promise;
    }, onRestored);
    const { result } = await render();
    await act(async () => loads[0]!.resolve(null));
    expect(onRestored).toHaveBeenLastCalledWith(null);
    expect(result.current.loading).toBe(false);

    await act(async () => result.current.reload());
    expect(result.current.loading).toBe(true);
    expect(loads).toHaveLength(2);

    const saved = { moves: 2 };
    await act(async () => loads[1]!.resolve(saved));
    expect(result.current.loading).toBe(false);
    expect(result.current.state).toBe(saved);
    expect(onRestored).toHaveBeenCalledTimes(2);
    expect(onRestored).toHaveBeenLastCalledWith(saved);
    expect(save).toHaveBeenCalledWith(saved);
  });

  it("reload drops a load still in flight, and a reload landing after unmount sets nothing", async () => {
    const loads: ReturnType<typeof deferred<Game | null>>[] = [];
    const onRestored = jest.fn();
    const { render } = setup(() => {
      const d = deferred<Game | null>();
      loads.push(d);
      return d.promise;
    }, onRestored);
    const { result, unmount } = await render();

    await act(async () => result.current.reload());
    await act(async () => loads[0]!.resolve({ moves: 1 }));
    expect(onRestored).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);

    await act(async () => loads[1]!.resolve({ moves: 2 }));
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ moves: 2 });

    await act(async () => result.current.reload());
    await act(async () => unmount());
    await act(async () => loads[2]!.resolve({ moves: 3 }));
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it("saves nothing while a reload is in flight", async () => {
    const loads: ReturnType<typeof deferred<Game | null>>[] = [];
    const { render, save } = setup(() => {
      const d = deferred<Game | null>();
      loads.push(d);
      return d.promise;
    });
    const { result } = await render();
    await act(async () => loads[0]!.resolve({ moves: 1 }));
    save.mockClear();

    await act(async () => result.current.reload());
    expect(result.current.hasLoadedRef.current).toBe(false);
    await act(async () => result.current.setState({ moves: 9 }));
    expect(save).not.toHaveBeenCalled();

    await act(async () => loads[1]!.resolve({ moves: 2 }));
    expect(save).toHaveBeenCalledWith({ moves: 2 });
    expect(save).not.toHaveBeenCalledWith({ moves: 9 });
  });

  it("loads once, not on re-render", async () => {
    const load = jest.fn(() => Promise.resolve<Game | null>({ moves: 1 }));
    const { render } = setup(load);
    const { rerender } = await render();
    await rerender({});
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("ends loading without enabling saves when the load rejects", async () => {
    const onRestored = jest.fn();
    const { render, save } = setup(() => Promise.reject(new Error("disk")), onRestored);
    const { result } = await render();

    expect(result.current.loading).toBe(false);
    expect(result.current.hasLoadedRef.current).toBe(false);
    expect(onRestored).not.toHaveBeenCalled();
    await act(async () => result.current.setState({ moves: 1 }));
    expect(save).not.toHaveBeenCalled();
  });

  it("swallows a failed save", async () => {
    const save = jest.fn(() => Promise.reject(new Error("full")));
    const { result } = await renderHook(() =>
      usePersistedGameState<Game>({ load: () => Promise.resolve(null), save })
    );
    await act(async () => result.current.setState({ moves: 1 }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("clear deletes the save and swallows a failure; it is stable across renders", async () => {
    const { render, clear } = setup(() => Promise.resolve(null));
    const { result, rerender } = await render();
    const first = result.current.clear;

    await act(async () => result.current.clear());
    expect(clear).toHaveBeenCalledTimes(1);

    clear.mockImplementationOnce(() => Promise.reject(new Error("locked")));
    await act(async () => result.current.clear());
    expect(clear).toHaveBeenCalledTimes(2);

    await rerender({});
    expect(result.current.clear).toBe(first);
  });

  it("clear is a no-op without a clear option", async () => {
    const { result } = await renderHook(() =>
      usePersistedGameState<Game>({
        load: () => Promise.resolve(null),
        save: () => Promise.resolve(),
      })
    );
    expect(() => result.current.clear()).not.toThrow();
  });

  it("keeps a state the screen wrote to stateRef ahead of its commit until a new state", async () => {
    const { render } = setup(() => Promise.resolve({ moves: 1 }));
    const { result, rerender } = await render();
    const ahead = { moves: 2 };
    result.current.stateRef.current = ahead;
    // An unrelated re-render doesn't put the older committed state back.
    await rerender({});
    expect(result.current.stateRef.current).toBe(ahead);
  });
});
