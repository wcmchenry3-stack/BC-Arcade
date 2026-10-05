import { act, renderHook } from "@testing-library/react-native";

import { SAVE_DEBOUNCE_MS, useMahjongPersistence } from "../useMahjongPersistence";
import { clearGame, saveGame } from "../storage";
import { createGame, getAnyFreePair, selectTile } from "../engine";
import { TURTLE_LAYOUT } from "../layouts/turtle";
import type { MahjongState } from "../types";

jest.mock("../storage", () => ({
  saveGame: jest.fn(() => Promise.resolve()),
  clearGame: jest.fn(() => Promise.resolve()),
}));

const mockSave = saveGame as jest.Mock;
const mockClear = clearGame as jest.Mock;

/** A deal with its clock running, as after the first tap. */
function running(): MahjongState {
  return { ...createGame(TURTLE_LAYOUT, 7), startedAt: 1_000 };
}

function match(state: MahjongState): MahjongState {
  const [a, b] = getAnyFreePair(state.tiles)!;
  return selectTile(selectTile(state, a), b);
}

async function setup(initial: MahjongState | null, loaded = true) {
  const loadedRef = { current: loaded };
  const hook = await renderHook(
    ({ state }: { state: MahjongState | null }) => useMahjongPersistence(state, loadedRef),
    { initialProps: { state: initial } }
  );
  return {
    result: hook.result,
    show: (state: MahjongState | null) => hook.rerender({ state }),
    unmount: () => hook.unmount(),
  };
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] });
  mockSave.mockClear();
  mockClear.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useMahjongPersistence (#2961)", () => {
  it("writes nothing before the mount's load has resolved", async () => {
    await setup(createGame(TURTLE_LAYOUT, 7), false);
    await advance(5 * SAVE_DEBOUNCE_MS);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("writes a change made with the clock stopped at once (a new deal)", async () => {
    const deal = createGame(TURTLE_LAYOUT, 7);
    await setup(deal);
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenLastCalledWith(deal);
  });

  it("debounces a change made with the clock running, from the last such change", async () => {
    const first = running();
    const { show } = await setup(first);
    await advance(SAVE_DEBOUNCE_MS);
    mockSave.mockClear();
    const one = match(first);
    await show(one);
    await advance(SAVE_DEBOUNCE_MS - 100);
    const two = match(one);
    await show(two);
    await advance(SAVE_DEBOUNCE_MS - 100);
    expect(mockSave).not.toHaveBeenCalled();
    await advance(100);
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenLastCalledWith(two);
  });

  it("writes nothing for a selection, and keeps a pending write on schedule", async () => {
    const first = running();
    const { show } = await setup(first);
    await advance(SAVE_DEBOUNCE_MS);
    mockSave.mockClear();
    const free = getAnyFreePair(first.tiles)!;
    await show(selectTile(first, free[0]));
    await advance(5 * SAVE_DEBOUNCE_MS);
    expect(mockSave).not.toHaveBeenCalled();

    const matched = match(first);
    await show(matched);
    await advance(SAVE_DEBOUNCE_MS - 100);
    const [a] = getAnyFreePair(matched.tiles)!;
    const selected = selectTile(matched, a);
    await show(selected);
    await advance(100);
    // On the match's schedule, with the newest state.
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenLastCalledWith(selected);
  });

  it("saveNow writes at once and supersedes the pending write", async () => {
    const first = running();
    const { show, result } = await setup(first);
    const matched = match(first);
    await show(matched);
    mockSave.mockClear();
    const paused: MahjongState = { ...matched, startedAt: null, paused: true };
    await act(async () => result.current.saveNow(paused));
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenLastCalledWith(paused);
    await show(paused);
    await advance(5 * SAVE_DEBOUNCE_MS);
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it("writes the pending state on unmount and leaves no timer behind", async () => {
    const first = running();
    const { show, unmount } = await setup(first);
    const matched = match(first);
    await show(matched);
    mockSave.mockClear();
    await unmount();
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenLastCalledWith(matched);
    expect(jest.getTimerCount()).toBe(0);
    await advance(5 * SAVE_DEBOUNCE_MS);
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it("writes the pending state when the game is set to null", async () => {
    const first = running();
    const { show } = await setup(first);
    const matched = match(first);
    await show(matched);
    mockSave.mockClear();
    await show(null);
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenLastCalledWith(matched);
  });

  it("discardSave cancels the pending write and clears the slot", async () => {
    const first = running();
    const { show, result, unmount } = await setup(first);
    await show(match(first));
    mockSave.mockClear();
    await act(async () => result.current.discardSave());
    expect(mockClear).toHaveBeenCalledTimes(1);
    await advance(5 * SAVE_DEBOUNCE_MS);
    await unmount();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("never writes a cleared board, and drops the write pending before it", async () => {
    const first = running();
    const { show } = await setup(first);
    await show(match(first));
    mockSave.mockClear();
    await show({ ...first, tiles: [], isComplete: true });
    await advance(5 * SAVE_DEBOUNCE_MS);
    expect(mockSave).not.toHaveBeenCalled();
  });
});
