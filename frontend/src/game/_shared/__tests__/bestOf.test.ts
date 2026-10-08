import { bestOf } from "../bestOf";

describe("bestOf", () => {
  it("first result sets the best but is never a new best (lower is better)", () => {
    expect(bestOf(0, 42, true)).toEqual({ best: 42, improved: true, isNewBest: false });
  });

  it("first result sets the best but is never a new best (higher is better)", () => {
    expect(bestOf(0, 900, false)).toEqual({ best: 900, improved: true, isNewBest: false });
  });

  it("treats non-finite and negative priors as no best", () => {
    expect(bestOf(NaN, 5, true).isNewBest).toBe(false);
    expect(bestOf(-3, 5, true)).toEqual({ best: 5, improved: true, isNewBest: false });
  });

  it("beating an existing best is a new best", () => {
    expect(bestOf(50, 40, true)).toEqual({ best: 40, improved: true, isNewBest: true });
    expect(bestOf(500, 600, false)).toEqual({ best: 600, improved: true, isNewBest: true });
  });

  it("tying or missing an existing best is not a new best and keeps the prior", () => {
    expect(bestOf(50, 50, true)).toEqual({ best: 50, improved: false, isNewBest: false });
    expect(bestOf(50, 60, true)).toEqual({ best: 50, improved: false, isNewBest: false });
    expect(bestOf(500, 400, false)).toEqual({ best: 500, improved: false, isNewBest: false });
  });
});
