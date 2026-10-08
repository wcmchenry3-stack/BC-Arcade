import { renderHook } from "@testing-library/react-native";
import { useCompletionTransition } from "../useCompletionTransition";

interface Game {
  readonly id: number;
  readonly done: boolean;
}

const playing = (id = 1): Game => ({ id, done: false });
const won = (id = 1): Game => ({ id, done: true });

async function setup(initial: Game | null) {
  const onComplete = jest.fn<void, [Game]>();
  const onAlreadyComplete = jest.fn<void, [Game]>();
  const hook = await renderHook(
    ({ state }: { state: Game | null }) =>
      useCompletionTransition(state, state?.done ?? false, { onComplete, onAlreadyComplete }),
    { initialProps: { state: initial } }
  );
  return { ...hook, onComplete, onAlreadyComplete };
}

describe("useCompletionTransition", () => {
  it("fires on the rising edge of isComplete, with the completed state", async () => {
    const { rerender, onComplete, onAlreadyComplete } = await setup(playing());
    expect(onComplete).not.toHaveBeenCalled();

    const done = won();
    await rerender({ state: done });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(done);
    expect(onAlreadyComplete).not.toHaveBeenCalled();
  });

  it("fires once: a state that stays complete fires nothing more", async () => {
    const { rerender, onComplete, onAlreadyComplete } = await setup(playing());
    await rerender({ state: won() });
    // A copy of the completed state (an events clear, a pause) is no new edge.
    await rerender({ state: { ...won() } });
    await rerender({ state: { ...won() } });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onAlreadyComplete).not.toHaveBeenCalled();
  });

  it("does not fire for a game that is never completed", async () => {
    const { rerender, onComplete } = await setup(null);
    await rerender({ state: playing() });
    await rerender({ state: { ...playing(), id: 2 } });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("a null state rearms the edge: the next game's completion fires again", async () => {
    const { rerender, result, onComplete } = await setup(playing());
    await rerender({ state: won() });
    // Back to pre-game (Solitaire's picker, Mahjong's New Game), then a new
    // game is dealt complete-able and completes.
    await rerender({ state: null });
    result.current.reset();
    await rerender({ state: won(2) });
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenLastCalledWith(won(2));
  });

  it("a completion after a null state with no reset is already recorded", async () => {
    const { rerender, onComplete, onAlreadyComplete } = await setup(playing());
    await rerender({ state: won() });
    await rerender({ state: null });
    await rerender({ state: won() });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onAlreadyComplete).toHaveBeenCalledTimes(1);
  });

  it("an undo after a win and a second win in the same game runs onAlreadyComplete once", async () => {
    const { rerender, onComplete, onAlreadyComplete } = await setup(playing());
    await rerender({ state: won() });
    // Undo out of the win (true → false, no null between), then win again.
    await rerender({ state: playing() });
    const again = won();
    await rerender({ state: again });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onAlreadyComplete).toHaveBeenCalledTimes(1);
    expect(onAlreadyComplete).toHaveBeenCalledWith(again);
  });

  it("a game restored already complete does not fire onComplete", async () => {
    const onComplete = jest.fn<void, [Game]>();
    const onAlreadyComplete = jest.fn<void, [Game]>();
    // The restore marks the loaded game in the same batch that sets it, as a
    // useGameRestored handler does.
    const { rerender, result } = await renderHook(
      ({ state }: { state: Game | null }) =>
        useCompletionTransition(state, state?.done ?? false, { onComplete, onAlreadyComplete }),
      { initialProps: { state: null as Game | null } }
    );
    result.current.markRestoredComplete();
    const restored = won();
    await rerender({ state: restored });

    expect(onComplete).not.toHaveBeenCalled();
    // The edge still runs, after the save, for the screen to clear it.
    expect(onAlreadyComplete).toHaveBeenCalledTimes(1);
    expect(onAlreadyComplete).toHaveBeenCalledWith(restored);
  });

  it("fires again after a new game (reset)", async () => {
    const { rerender, result, onComplete, onAlreadyComplete } = await setup(playing());
    await rerender({ state: won() });
    // New Game deals straight in (no null between).
    result.current.reset();
    await rerender({ state: playing(2) });
    await rerender({ state: won(2) });
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onAlreadyComplete).not.toHaveBeenCalled();
  });

  it("fires for a new game after a restored win once reset", async () => {
    const { rerender, result, onComplete } = await setup(null);
    result.current.markRestoredComplete();
    await rerender({ state: won() });
    expect(onComplete).not.toHaveBeenCalled();
    result.current.reset();
    await rerender({ state: playing(2) });
    await rerender({ state: won(2) });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("reads the latest handlers at the edge", async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = await renderHook(
      ({ state, onComplete }: { state: Game | null; onComplete: (g: Game) => void }) =>
        useCompletionTransition(state, state?.done ?? false, { onComplete }),
      { initialProps: { state: playing() as Game | null, onComplete: first } }
    );
    await rerender({ state: won(), onComplete: second });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("a plain function runs on every rising edge, with no once-per-game guard", async () => {
    const onEdge = jest.fn();
    const { rerender } = await renderHook(
      ({ state }: { state: Game | null }) =>
        useCompletionTransition(state, state?.done ?? false, onEdge),
      { initialProps: { state: playing() as Game | null } }
    );
    await rerender({ state: won() });
    await rerender({ state: playing() });
    await rerender({ state: won() });
    expect(onEdge).toHaveBeenCalledTimes(2);
  });
});
