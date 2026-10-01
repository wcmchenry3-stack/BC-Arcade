import type { TFunction } from "i18next";
import { starSwarmSourceLabel } from "../StarSwarmSection";

/** Echoes the key (and interpolation values) so the test sees which string was asked for. */
const t = ((key: string, opts?: Record<string, string>) =>
  opts ? `${key}(${opts.source}|${opts.mod})` : key) as unknown as TFunction;

describe("starSwarmSourceLabel (#2843 Guardian rename)", () => {
  it("labels the Guardian tier, and a pre-rename 'Boss' source as Guardian too", () => {
    expect(starSwarmSourceLabel(t, "Guardian")).toBe("profile:detail.starswarm.source.Guardian");
    expect(starSwarmSourceLabel(t, "Boss")).toBe("profile:detail.starswarm.source.Guardian");
    expect(starSwarmSourceLabel(t, "Boss:dive")).toBe(starSwarmSourceLabel(t, "Guardian:dive"));
  });

  it("shows an unknown source's raw id", () => {
    expect(starSwarmSourceLabel(t, "Mothership")).toBe("Mothership");
  });
});
