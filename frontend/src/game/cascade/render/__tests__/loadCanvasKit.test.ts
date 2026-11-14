/**
 * loadCanvasKit (#2960): loads Skia's web runtime for Cascade on web, from the `.wasm` Metro
 * bundles (our own origin), once, with a timeout and a retry (a fresh load) after a failure or a timeout.
 */
import { Asset } from "expo-asset";

const mockInit = jest.fn();
jest.mock("canvaskit-wasm/bin/full/canvaskit", () => ({
  __esModule: true,
  default: (opts: unknown) => mockInit(opts),
}));
jest.mock("expo-asset", () => ({
  Asset: { fromModule: jest.fn(() => ({ uri: "/assets/canvaskit.0123abcd.wasm" })) },
}));

import {
  CANVASKIT_LOAD_TIMEOUT_MS,
  __resetCanvasKitLoaderForTests,
  loadCanvasKit,
} from "../loadCanvasKit";

type G = { CanvasKit?: unknown };
const FAKE_CANVASKIT = { MakeCanvas: () => null };

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  delete (globalThis as G).CanvasKit;
  __resetCanvasKitLoaderForTests();
  mockInit.mockReset();
  jest.useRealTimers();
});

afterAll(() => {
  delete (globalThis as G).CanvasKit;
});

describe("loadCanvasKit", () => {
  it("puts CanvasKit on the global, from the bundled wasm on this origin", async () => {
    mockInit.mockResolvedValue(FAKE_CANVASKIT);
    await loadCanvasKit();
    expect((globalThis as G).CanvasKit).toBe(FAKE_CANVASKIT);

    const { locateFile } = mockInit.mock.calls[0]![0] as { locateFile: (f: string) => string };
    expect(locateFile("canvaskit.wasm")).toBe("/assets/canvaskit.0123abcd.wasm");
    // The id Metro gave the `.wasm` asset (fileMock under jest), not a CDN URL.
    expect(Asset.fromModule).toHaveBeenCalledWith(1);
  });

  it("loads once: later and concurrent calls reuse it", async () => {
    mockInit.mockResolvedValue(FAKE_CANVASKIT);
    await Promise.all([loadCanvasKit(), loadCanvasKit()]);
    await loadCanvasKit();
    expect(mockInit).toHaveBeenCalledTimes(1);
  });

  it("does nothing when CanvasKit is already loaded", async () => {
    (globalThis as G).CanvasKit = FAKE_CANVASKIT;
    await loadCanvasKit();
    expect(mockInit).not.toHaveBeenCalled();
  });

  it("rejects on a failed load, and a second call retries it", async () => {
    mockInit.mockRejectedValueOnce(new Error("network"));
    await expect(loadCanvasKit()).rejects.toThrow("network");
    expect((globalThis as G).CanvasKit).toBeUndefined();

    mockInit.mockResolvedValueOnce(FAKE_CANVASKIT);
    await loadCanvasKit();
    expect(mockInit).toHaveBeenCalledTimes(2);
    expect((globalThis as G).CanvasKit).toBe(FAKE_CANVASKIT);
  });

  it("rejects when the load stalls past the timeout, and a retry starts a fresh load", async () => {
    jest.useFakeTimers();
    const stalled = deferred<unknown>();
    const fresh = deferred<unknown>();
    mockInit.mockReturnValueOnce(stalled.promise).mockReturnValueOnce(fresh.promise);

    const first = loadCanvasKit();
    jest.advanceTimersByTime(CANVASKIT_LOAD_TIMEOUT_MS);
    await expect(first).rejects.toThrow(/did not load within/);

    const retry = loadCanvasKit();
    expect(mockInit).toHaveBeenCalledTimes(2);
    fresh.resolve(FAKE_CANVASKIT);
    await retry;
    expect((globalThis as G).CanvasKit).toBe(FAKE_CANVASKIT);
  });

  it("a retry after a timeout can time out and start another fresh load", async () => {
    jest.useFakeTimers();
    mockInit.mockReturnValue(new Promise(() => {}));
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = loadCanvasKit();
      jest.advanceTimersByTime(CANVASKIT_LOAD_TIMEOUT_MS);
      await expect(result).rejects.toThrow(/did not load within/);
      expect(mockInit).toHaveBeenCalledTimes(attempt);
    }
  });

  it("an abandoned load that resolves late sets CanvasKit but never replaces a newer one", async () => {
    jest.useFakeTimers();
    const stalled = deferred<unknown>();
    const fresh = deferred<unknown>();
    const staleKit = { MakeCanvas: () => "stale" };
    mockInit.mockReturnValueOnce(stalled.promise).mockReturnValueOnce(fresh.promise);

    const first = loadCanvasKit();
    jest.advanceTimersByTime(CANVASKIT_LOAD_TIMEOUT_MS);
    await expect(first).rejects.toThrow(/did not load within/);
    const retry = loadCanvasKit();

    // The abandoned one lands first: harmless, it is a working CanvasKit and the global is set.
    stalled.resolve(staleKit);
    await Promise.resolve();
    expect((globalThis as G).CanvasKit).toBe(staleKit);

    // The retry's own load then lands: the retry resolves, and the global is not swapped.
    fresh.resolve(FAKE_CANVASKIT);
    await retry;
    expect((globalThis as G).CanvasKit).toBe(staleKit);
    await loadCanvasKit();
    expect(mockInit).toHaveBeenCalledTimes(2);
  });

  it("gives a slow connection about a minute before it shows the error", () => {
    expect(CANVASKIT_LOAD_TIMEOUT_MS).toBe(60_000);
  });
});
