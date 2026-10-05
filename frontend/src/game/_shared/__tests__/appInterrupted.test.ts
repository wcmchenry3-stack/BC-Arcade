import { isAppInterrupted } from "../appInterrupted";

describe("isAppInterrupted", () => {
  it.each(["background", "inactive"])("%s is interrupted", (state) => {
    expect(isAppInterrupted(state)).toBe(true);
  });

  it.each(["active", "unknown", "extension", null, undefined, () => "active"])(
    "%p is not",
    (state) => {
      expect(isAppInterrupted(state)).toBe(false);
    }
  );
});
