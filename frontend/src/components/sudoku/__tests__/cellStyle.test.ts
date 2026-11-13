import { cellBackground, cellMetrics, composite, parseColor } from "../cellStyle";

describe("parseColor", () => {
  it("reads #rrggbb and rgba()", () => {
    expect(parseColor("#8ff5ff")).toEqual([143, 245, 255, 1]);
    expect(parseColor("rgba(255,113,108,0.16)")).toEqual([255, 113, 108, 0.16]);
    expect(parseColor("rgb(1, 2, 3)")).toEqual([1, 2, 3, 1]);
  });
  it("rejects anything else, loudly", () => {
    expect(() => parseColor("teal")).toThrow();
  });
});

describe("composite", () => {
  it("lays washes over a base, first lowest", () => {
    expect(composite("#000000", "rgba(255,255,255,0.5)")).toBe("#808080");
    expect(composite("#000000", "rgba(255,255,255,1)", "rgba(0,0,0,0.5)")).toBe("#808080");
  });
});

describe("cellBackground", () => {
  const input = {
    base: "#101010",
    selectedFill: "#00ff00",
    washes: {
      peer: "rgba(255,255,255,0.1)",
      same: "rgba(255,255,255,0.2)",
      conflict: "rgba(255,0,0,0.5)",
    },
    selected: false,
    peer: false,
    sameDigit: false,
    conflict: false,
  };
  it("is the base with no relation to the selection", () => {
    expect(cellBackground(input)).toBe("#101010");
  });
  it("is solid for the selected cell, whatever else applies", () => {
    expect(cellBackground({ ...input, selected: true, peer: true, conflict: true })).toBe(
      "#00ff00"
    );
  });
  it("paints one wash, the strongest: conflict, then same digit, then peer", () => {
    const peer = cellBackground({ ...input, peer: true });
    const same = cellBackground({ ...input, peer: true, sameDigit: true });
    const conflict = cellBackground({ ...input, peer: true, sameDigit: true, conflict: true });
    expect(peer).toBe(composite("#101010", input.washes.peer));
    expect(same).toBe(composite("#101010", input.washes.same));
    expect(conflict).toBe(composite("#101010", input.washes.conflict));
  });
});

describe("cellMetrics", () => {
  it("scales the digit and notes with the cell", () => {
    const small = cellMetrics(31);
    const big = cellMetrics(58); // a 6×6 board on a phone
    expect(small.digit).toBe(19);
    expect(big.digit).toBeGreaterThan(small.digit);
    expect(big.note).toBeGreaterThan(small.note);
  });
  it("keeps a floor so a tiny cell still draws legible digits and notes", () => {
    const tiny = cellMetrics(10);
    expect(tiny.digit).toBeGreaterThanOrEqual(12);
    expect(tiny.note).toBeGreaterThanOrEqual(7);
  });
  it("fits a 3×3 note grid inside the cell at 320 pt wide (a ~31 pt cell)", () => {
    const m = cellMetrics(31);
    // three rows of notes, each (note size + 1) tall, inside the cell's height less 2 pt padding
    expect(3 * (m.note + 1)).toBeLessThanOrEqual(31 - 2);
    // three columns, each a digit wide (~0.7 em), inside the width
    expect(3 * m.note * 0.8).toBeLessThanOrEqual(31 - 2);
  });
});
