/**
 * #2962 / #3047: `useTileFaces` when the face load completes between a mount's render (and
 * commit) and its passive effects. The mount's state was seeded from the module cache during
 * the render, when nothing had loaded; its load effect must still pick up the set that
 * finished in between, or the canvas draws placeholders until it remounts.
 *
 * The gap between commit and passive effects only exists on a concurrent root rendered
 * outside `act`, where React's scheduler runs them as separate tasks. Real-time scheduling
 * cannot hold that gap open reliably (#3047: a `setTimeout(0)` sometimes landed after the
 * effects, sometimes before the render), so this file swaps in React's mock scheduler and
 * steps it by hand: `unstable_flushUntilNextPaint` renders and commits and stops, leaving the
 * passive effects queued until the test flushes them. The mock replaces the scheduler for the
 * whole file, which is why this test lives apart from tileFaces.test.ts.
 */
import React from "react";
import TestRenderer from "react-test-renderer";
import { loadData } from "@shopify/react-native-skia";

import { loadTileSVGs, resetTileFaces, useTileFaces } from "../tileFaces";

jest.mock("scheduler", () => jest.requireActual("scheduler/unstable_mock"));

jest.mock("@shopify/react-native-skia", () => ({
  loadData: jest.fn(),
  Skia: {
    SVG: { MakeFromData: jest.fn((source: unknown) => ({ svg: source })) },
    Surface: {
      Make: jest.fn((width: number, height: number) => ({
        getCanvas: () => ({ scale: jest.fn(), drawSvg: jest.fn() }),
        flush: jest.fn(),
        makeImageSnapshot: jest.fn(() => ({ width, height, dispose: jest.fn() })),
        dispose: jest.fn(),
      })),
    },
  },
}));

const mockLoadData = loadData as unknown as jest.Mock;

/** The mock scheduler React is running on in this file (the "scheduler" module, mocked above). */
const Scheduler = jest.requireMock<{
  reset(): void;
  unstable_flushUntilNextPaint(): void;
  unstable_flushAllWithoutAsserting(): void;
  unstable_hasPendingWork(): boolean;
}>("scheduler");

/** Let resolved promises and the hook's 0 ms rasterisation timer run (real timers). */
const nextTask = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetTileFaces();
  Scheduler.reset();
});

it("faces appear when the load completes between a mount's render and its effects", async () => {
  // Every face's read waits until the test releases it.
  const pending: (() => void)[] = [];
  mockLoadData.mockImplementation((source: unknown, factory: (d: unknown) => unknown) =>
    new Promise<void>((r) => pending.push(r)).then(() => factory(source))
  );
  const loading = loadTileSVGs(); // begun by another canvas
  const seen: (ReturnType<typeof useTileFaces> | "effect")[] = [];
  function Probe() {
    const faces = useTileFaces(40, 52);
    seen.push(faces);
    React.useEffect(() => {
      seen.push("effect");
    }, []);
    return null;
  }
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const actEnv = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = false; // render outside act: a real concurrent root
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => {}); // deprecation note
  try {
    const root = TestRenderer.create(React.createElement(Probe));
    expect(seen).toEqual([]); // nothing runs until the scheduler is stepped
    Scheduler.unstable_flushUntilNextPaint();
    expect(seen).toEqual([null]); // rendered and committed with no SVGs
    expect(Scheduler.unstable_hasPendingWork()).toBe(true); // the passive effects, still queued

    pending.forEach((r) => r());
    await loading;
    expect(seen).toEqual([null]); // the load is done before the mount's effects

    Scheduler.unstable_flushAllWithoutAsserting(); // now the effects run
    expect(seen).toEqual([null, "effect"]);
    for (let i = 0; i < 20 && !Array.isArray(seen.at(-1)); i++) {
      await nextTask(); // the load effect's promise, then the rasterisation timer
      Scheduler.unstable_flushAllWithoutAsserting(); // the re-renders they schedule
    }
    expect(seen.at(-1)).toHaveLength(42);
    expect(mockLoadData).toHaveBeenCalledTimes(42); // the mount reused the finished load

    root.unmount();
    Scheduler.unstable_flushAllWithoutAsserting();
  } finally {
    env.IS_REACT_ACT_ENVIRONMENT = actEnv;
    consoleError.mockRestore();
  }
});
