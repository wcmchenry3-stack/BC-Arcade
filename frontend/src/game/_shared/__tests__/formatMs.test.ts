import { msToNextSecond } from "../formatMs";

describe("msToNextSecond", () => {
  it("is the time left in the current second, 1000 on a boundary", () => {
    expect(msToNextSecond(0)).toBe(1000);
    expect(msToNextSecond(400)).toBe(600);
    expect(msToNextSecond(65_999)).toBe(1);
    expect(msToNextSecond(66_000)).toBe(1000);
  });

  it("handles a negative elapsed time", () => {
    expect(msToNextSecond(-400)).toBe(400);
  });
});
