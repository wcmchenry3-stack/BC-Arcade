/**
 * loadCanvasKit (#2960): loads Skia's web runtime for Cascade on web, from the `.wasm` Metro
 * bundles (our own origin), once, with a timeout and a retry after a failure.
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

  it("rejects when the load stalls past the timeout, and a retry waits for the same load", async () => {
    jest.useFakeTimers();
    const load = deferred<unknown>();
    mockInit.mockReturnValue(load.promise);

    const first = loadCanvasKit();
    jest.advanceTimersByTime(CANVASKIT_LOAD_TIMEOUT_MS);
    await expect(first).rejects.toThrow(/did not load within/);

    const retry = loadCanvasKit();
    load.resolve(FAKE_CANVASKIT);
    await retry;
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect((globalThis as G).CanvasKit).toBe(FAKE_CANVASKIT);
  });

  it("gives a slow connection about a minute before it shows the error", () => {
    expect(CANVASKIT_LOAD_TIMEOUT_MS).toBe(60_000);
  });
});
