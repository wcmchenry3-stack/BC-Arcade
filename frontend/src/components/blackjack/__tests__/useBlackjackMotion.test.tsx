/**
 * #3812: the settled queue owns the run's cue. A toast and its cue go in together
 * (`whenSettled(fn, { cue })`) and play from the same callback, so they cannot drift apart. A plan
 * with one frame has nothing to wait for: it settles at once, and its toast and cue play together,
 * then. (`planMotion` never plans one with a result today: a settling plan always has chip frames,
 * so the plan here is stubbed.)
 */
import { act, renderHook } from "@testing-library/react-native";

import {
  newGame,
  placeBet,
  toViewState,
  type Card,
  type EngineState,
} from "../../../game/blackjack/engine";
import { fullStage, planMotion, type SoundCue, type Timeline } from "../blackjackMotion";
import { useBlackjackMotion } from "../useBlackjackMotion";

jest.mock("../blackjackMotion", () => ({
  ...jest.requireActual("../blackjackMotion"),
  planMotion: jest.fn(),
}));
const mockPlan = planMotion as jest.Mock;

const card = (rank: string): Card => ({ rank, suit: "♠" });
const DECK = [card("9"), card("7"), card("8"), card("6"), card("5"), card("4"), card("3")];

/** A plan of one frame (the round settles at once), with a result unless `resultAt` is null. */
function oneFrame(after: EngineState, resultAt: number | null): Timeline {
  return {
    frames: [{ at: 0, stage: fullStage(toViewState(after)) }],
    cues: [],
    slideMs: 0,
    flips: false,
    resultAt,
    chimeAt: null,
    momentAt: null,
    endMs: 0,
    held: [],
  };
}

async function setup() {
  const played: [SoundCue, boolean][] = [];
  const awayRef = { current: false };
  const before = newGame([...DECK], { startingChips: 100 });
  const after = placeBet(before, 10);
  const hook = await renderHook(
    (p: { engine: EngineState }) =>
      useBlackjackMotion({
        engine: p.engine,
        reduceMotion: false,
        awayRef,
        playCue: (cue, skipped) => played.push([cue, skipped]),
      }),
    { initialProps: { engine: before } }
  );
  /** The player's action: the engine changes to `after`, replayed by the (stubbed) plan. */
  const play = async (resultAt: number | null) => {
    mockPlan.mockReturnValueOnce(oneFrame(after, resultAt));
    await act(async () => hook.result.current.act(() => hook.rerender({ engine: after })));
  };
  return { hook, played, play };
}

beforeEach(() => mockPlan.mockReset());

describe("a one-frame plan (#3812)", () => {
  it("plays the run cue with its toast, once, as it settles", async () => {
    const { hook, played, play } = await setup();
    await play(0);
    expect(hook.result.current.settled).toBe(true);
    const toast = jest.fn();
    await act(async () => hook.result.current.whenSettled(toast, { cue: "milestone" }));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(played).toEqual([["milestone", false]]);
    // One cue: nothing plays it a second time later.
    await act(async () => hook.result.current.skip());
    await act(async () => hook.result.current.leave());
    expect(played).toEqual([["milestone", false]]);
  });

  it("is dropped on purpose when the plan has no result: the toast still shows", async () => {
    const { hook, played, play } = await setup();
    await play(null);
    const toast = jest.fn();
    await act(async () => hook.result.current.whenSettled(toast, { cue: "milestone" }));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(played).toEqual([]);
  });

  it("a round no action played (a restore) plays no cue, the toast still shows", async () => {
    const { hook, played } = await setup();
    const toast = jest.fn();
    await act(async () => hook.result.current.whenSettled(toast, { cue: "comeback" }));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(played).toEqual([]);
  });
});
