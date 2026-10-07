import { playTimedPhases } from "../timedPhases";

describe("playTimedPhases", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("runs each phase at its time, then ends", () => {
    const calls: string[] = [];
    playTimedPhases(
      {
        phases: [
          { at: 200, run: () => calls.push("shake") },
          { at: 700, run: () => calls.push("fade") },
        ],
        endAt: 1000,
      },
      () => calls.push("end")
    );

    jest.advanceTimersByTime(199);
    expect(calls).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(calls).toEqual(["shake"]);
    jest.advanceTimersByTime(500);
    expect(calls).toEqual(["shake", "fade"]);
    jest.advanceTimersByTime(299);
    expect(calls).toEqual(["shake", "fade"]);
    jest.advanceTimersByTime(1);
    expect(calls).toEqual(["shake", "fade", "end"]);
  });

  it("ends with no phases at all (the reduce-motion shape)", () => {
    const onEnd = jest.fn();
    playTimedPhases({ phases: [], endAt: 300 }, onEnd);
    jest.advanceTimersByTime(299);
    expect(onEnd).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("cancels every pending step, including the end", () => {
    const run = jest.fn();
    const onEnd = jest.fn();
    const cancel = playTimedPhases(
      {
        phases: [
          { at: 100, run },
          { at: 500, run },
        ],
        endAt: 800,
      },
      onEnd
    );
    jest.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(1);

    cancel();
    jest.advanceTimersByTime(10_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
  });
});
