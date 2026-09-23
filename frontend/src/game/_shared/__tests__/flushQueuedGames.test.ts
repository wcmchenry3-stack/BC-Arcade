const mockFlush = jest.fn();
jest.mock("../syncWorker", () => ({
  syncWorker: { flush: () => mockFlush() },
}));

import { flushQueuedGames } from "../flushQueuedGames";

beforeEach(() => {
  mockFlush.mockReset();
});

describe("flushQueuedGames", () => {
  it("flushes the queue and resolves", async () => {
    mockFlush.mockResolvedValue({});
    await expect(flushQueuedGames()).resolves.toBeUndefined();
    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  it("shares one flush between concurrent callers, and both wait for it", async () => {
    let finish: () => void = () => {};
    mockFlush.mockReturnValue(
      new Promise<object>((resolve) => {
        finish = () => resolve({});
      })
    );
    const settled: string[] = [];
    const first = flushQueuedGames().then(() => settled.push("first"));
    const second = flushQueuedGames().then(() => settled.push("second"));
    await Promise.resolve();
    expect(settled).toEqual([]);

    finish();
    await Promise.all([first, second]);
    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(settled).toEqual(["first", "second"]);
  });

  it("flushes again once the previous flush has finished", async () => {
    mockFlush.mockResolvedValue({});
    await flushQueuedGames();
    await flushQueuedGames();
    expect(mockFlush).toHaveBeenCalledTimes(2);
  });

  it("swallows a failed flush so the caller can still do its own read", async () => {
    mockFlush.mockRejectedValueOnce(new Error("offline"));
    await expect(flushQueuedGames()).resolves.toBeUndefined();

    // ...and a failure doesn't wedge later calls.
    mockFlush.mockResolvedValue({});
    await flushQueuedGames();
    expect(mockFlush).toHaveBeenCalledTimes(2);
  });
});
