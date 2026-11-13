import { computeDurationMs } from "../Twenty48Screen";
import type { Twenty48State } from "../../game/twenty48/types";

const state = (startedAt: number | null, accumulatedMs: number) =>
  ({ startedAt, accumulatedMs }) as unknown as Twenty48State;

describe("computeDurationMs (#3738)", () => {
  it("adds the running segment to the banked time", () => {
    expect(computeDurationMs(state(1_000, 500), 4_000)).toBe(3_500);
  });
  it("is never negative when the device clock went back", () => {
    expect(computeDurationMs(state(9_000, 0), 1_000)).toBe(0);
    expect(computeDurationMs(state(null, -4_000), 1_000)).toBe(0);
  });
  it("is never NaN", () => {
    expect(computeDurationMs(state(null, NaN), 1_000)).toBe(0);
  });
});
