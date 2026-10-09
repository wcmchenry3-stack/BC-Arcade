import { pushCapped, UNDO_CAP, withUndo } from "../undoStack";

interface Toy {
  readonly n: number;
  readonly undoStack: readonly Toy[];
  readonly note?: string;
}

const toy = (n: number, undoStack: readonly Toy[] = []): Toy => ({ n, undoStack });

describe("pushCapped", () => {
  it("appends the entry on top", () => {
    expect(pushCapped([1, 2], 3)).toEqual([1, 2, 3]);
  });

  it("does not mutate the input", () => {
    const stack = [1, 2];
    pushCapped(stack, 3);
    expect(stack).toEqual([1, 2]);
  });

  it("drops the oldest entries past the cap", () => {
    expect(pushCapped([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
    expect(pushCapped([1, 2, 3, 4, 5], 6, 3)).toEqual([4, 5, 6]);
  });

  it("defaults to UNDO_CAP (50)", () => {
    expect(UNDO_CAP).toBe(50);
    const full = Array.from({ length: 50 }, (_, i) => i);
    const next = pushCapped(full, 50);
    expect(next).toHaveLength(50);
    expect(next[0]).toBe(1);
    expect(next[49]).toBe(50);
  });

  it("matches Mahjong's previous slice-then-append form for every length", () => {
    // Pre-#2986 mahjong/engine.ts: [...stack.slice(-(UNDO_CAP - 1)), entry]
    for (let len = 0; len <= 60; len++) {
      const stack = Array.from({ length: len }, (_, i) => i);
      expect(pushCapped(stack, -1, UNDO_CAP)).toEqual([...stack.slice(-(UNDO_CAP - 1)), -1]);
    }
  });
});

describe("withUndo", () => {
  it("attaches prev's history plus a snapshot of prev to next", () => {
    const prev = toy(1, [toy(0)]);
    const next = withUndo(prev, { n: 2 });
    expect(next.n).toBe(2);
    expect(next.undoStack).toEqual([toy(0), toy(1)]);
  });

  it("clears the snapshot's own undoStack so snapshots never nest", () => {
    const prev = toy(3, [toy(1), toy(2)]);
    const next = withUndo(prev, { n: 4 });
    for (const snap of next.undoStack) expect(snap.undoStack).toEqual([]);
  });

  it("keeps the rest of prev in the snapshot", () => {
    const prev: Toy = { n: 1, undoStack: [], note: "kept" };
    expect(withUndo(prev, { n: 2 }).undoStack[0]).toEqual({ n: 1, undoStack: [], note: "kept" });
  });

  it("caps the history, evicting the oldest", () => {
    let s = toy(0);
    for (let i = 1; i <= 5; i++) s = withUndo(s, { n: i }, 3);
    expect(s.undoStack.map((x) => x.n)).toEqual([2, 3, 4]);
  });

  it("defaults to UNDO_CAP", () => {
    let s = toy(0);
    for (let i = 1; i <= 60; i++) s = withUndo(s, { n: i });
    expect(s.undoStack).toHaveLength(UNDO_CAP);
    expect(s.undoStack[0]?.n).toBe(10);
  });

  it("writes undoStack after next's fields and leaves both inputs untouched", () => {
    const prev = toy(1);
    const nextIn = { n: 2, note: "x" };
    const out = withUndo(prev, nextIn);
    expect(Object.keys(out)).toEqual(["n", "note", "undoStack"]);
    expect(prev.undoStack).toEqual([]);
    expect(nextIn).toEqual({ n: 2, note: "x" });
  });
});
