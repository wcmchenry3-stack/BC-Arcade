/**
 * #3699 (iOS demo on #3924): the celebration's style is built ahead, in idle time, once the board
 * holds a tier-9 piece, and the board says when the won game's celebration can be drawn.
 */
import React from "react";
import { act, create } from "react-test-renderer";
import { useCelebrationStyle, type UseCelebrationStyleArgs } from "../useCelebrationStyle";
import type { CelebrationStyle } from "../../../game/cascade/render/drawCelebration";

const mockBuild = jest.fn();
jest.mock("../../../game/cascade/render/celebrationStyle", () => ({
  celebrationStyleKey: ({ setId, theme, pxPerUnit }: Record<string, unknown>) =>
    `${setId}|${theme}|${pxPerUnit}`,
  celebrationStyleFor: (...args: unknown[]) => mockBuild(...args),
  lastCelebrationBuildMs: () => 12,
}));

const STYLE = { kind: "rays", reduceMotion: false } as unknown as CelebrationStyle;

let latest: CelebrationStyle | null = null;
function Probe(props: UseCelebrationStyleArgs) {
  latest = useCelebrationStyle(props);
  return null;
}

const BASE: UseCelebrationStyleArgs = {
  setId: "fruits",
  theme: "light",
  pxPerUnit: 3,
  fallback: null,
  prepare: false,
  won: false,
  reduceMotion: false,
};

describe("useCelebrationStyle", () => {
  let onReady: jest.Mock;
  let renderer: ReturnType<typeof create>;
  const render = async (props: Partial<UseCelebrationStyleArgs>) => {
    await act(async () => {
      const el = <Probe {...BASE} onReady={onReady} {...props} />;
      if (renderer) renderer.update(el);
      else renderer = create(el);
    });
  };
  const idle = async () => {
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    mockBuild.mockReset().mockReturnValue(STYLE);
    onReady = jest.fn();
    latest = null;
    renderer = undefined as unknown as ReturnType<typeof create>;
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("builds nothing during play until a tier-9 piece is on the board", async () => {
    await render({});
    await idle();
    expect(mockBuild).not.toHaveBeenCalled();
    expect(latest).toBeNull();
  });

  it("pre-warms in idle time, not in the render, and is not ready before the win", async () => {
    await render({ prepare: true });
    expect(mockBuild).not.toHaveBeenCalled(); // scheduled, not run in the commit
    await idle();
    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(mockBuild.mock.calls[0]![0]).toEqual({ setId: "fruits", theme: "light", pxPerUnit: 3 });
    expect(latest).toBeNull();
    expect(onReady).not.toHaveBeenCalled();
    // The win: ready at once, no second build.
    await render({ prepare: true, won: true });
    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(latest).toMatchObject({ kind: "rays", reduceMotion: false });
  });

  it("a win before the pre-warm ran builds at once (after the commit), then is ready", async () => {
    await render({ prepare: true });
    await render({ prepare: true, won: true });
    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(latest).not.toBeNull();
    // The cancelled idle task does not build again.
    await idle();
    expect(mockBuild).toHaveBeenCalledTimes(1);
  });

  it("is ready even when the style cannot be built (no Skia): the card must not wait", async () => {
    mockBuild.mockReturnValue(null);
    await render({ won: true });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(latest).toBeNull();
  });

  it("lays Reduce Motion over the built style without rebuilding it", async () => {
    await render({ won: true });
    await render({ won: true, reduceMotion: true });
    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(latest).toMatchObject({ reduceMotion: true });
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("a new game is not ready until its own win", async () => {
    await render({ won: true });
    await render({ won: false });
    expect(latest).toBeNull();
    await render({ won: true });
    expect(onReady).toHaveBeenCalledTimes(2);
    expect(mockBuild).toHaveBeenCalledTimes(1);
  });
});
