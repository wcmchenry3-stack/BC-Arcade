import { nextCue } from "../nextCue";

const CUES = [0, 72_000, 155_000, 269_000, 326_000] as const;

describe("nextCue (#3638)", () => {
  it("before the first cue after 0:00 gives that cue", () => {
    expect(nextCue(0, CUES)).toBe(72_000);
    expect(nextCue(1, CUES)).toBe(72_000);
  });

  it("between cues gives the next one", () => {
    expect(nextCue(100_000, CUES)).toBe(155_000);
    expect(nextCue(300_000, CUES)).toBe(326_000);
  });

  it("exactly on a cue gives the one after it", () => {
    expect(nextCue(72_000, CUES)).toBe(155_000);
    expect(nextCue(269_000, CUES)).toBe(326_000);
  });

  it("at or after the last cue wraps to 0:00", () => {
    expect(nextCue(326_000, CUES)).toBe(0);
    expect(nextCue(419_999, CUES)).toBe(0);
  });

  it("works on unsorted cues", () => {
    expect(nextCue(100_000, [326_000, 0, 155_000, 72_000])).toBe(155_000);
  });

  it("empty or invalid input gives 0", () => {
    expect(nextCue(10_000, [])).toBe(0);
    expect(nextCue(Number.NaN, CUES)).toBe(0);
    expect(nextCue(Infinity, CUES)).toBe(0);
    expect(nextCue(-5, CUES)).toBe(0);
    expect(nextCue(10_000, [Number.NaN, -1, Infinity])).toBe(0);
  });
});
