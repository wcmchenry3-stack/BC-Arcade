import { MULTISETS_BY_SIZE } from "../multisetIndex";

describe("multisetIndex — multiset tables", () => {
  // Multisets of n dice over 6 faces = C(n+5, 5).
  const expected = [1, 6, 21, 56, 126, 252];

  it.each([0, 1, 2, 3, 4, 5])("size %i has the correct number of multisets", (n) => {
    expect(MULTISETS_BY_SIZE[n]!.values).toHaveLength(expected[n]!);
  });

  it("probabilities sum to 1 for each size", () => {
    for (let n = 0; n <= 5; n++) {
      const total = MULTISETS_BY_SIZE[n]!.prob.reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1.0, 10);
    }
  });

  it("indexOf round-trips every multiset", () => {
    for (const m of MULTISETS_BY_SIZE) {
      m.values.forEach((v, i) => expect(m.indexOf.get(v.join(","))).toBe(i));
    }
  });
});
