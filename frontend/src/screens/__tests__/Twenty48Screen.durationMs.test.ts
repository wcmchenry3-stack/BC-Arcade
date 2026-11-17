import { monotonicNow } from "../../game/_shared/monotonicNow";
import { newGame } from "../../game/twenty48/engine";
import { computeDurationMs } from "../Twenty48Screen";

describe("2048 duration_ms (#3925)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("is an integer even when performance.now is fractional", () => {
    const mono = jest.spyOn(performance, "now").mockReturnValue(1000.25);
    const started = { ...newGame(), startedAt: monotonicNow(), accumulatedMs: 500 };
    mono.mockReturnValue(61_234.987);
    const ms = computeDurationMs(started);
    expect(Number.isInteger(ms)).toBe(true);
    expect(ms).toBe(500 + (61_234 - 1000));
  });
});
