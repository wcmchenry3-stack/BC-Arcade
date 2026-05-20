import { createPieceQueue, advanceQueue } from "../pieceQueue2";
import { DROPPABLE_PIECE_TIERS } from "../pieceDefs";

function seededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (Math.imul(48271, s) + (s >>> 16)) | 0;
    return (s >>> 0) / 0x100000000;
  };
}

describe("createPieceQueue", () => {
  it("current and next are valid droppable tiers", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const q = createPieceQueue([], seededRng(seed));
      expect(DROPPABLE_PIECE_TIERS).toContain(q.current);
      expect(DROPPABLE_PIECE_TIERS).toContain(q.next);
    }
  });

  it("works with no arguments", () => {
    const q = createPieceQueue();
    expect(DROPPABLE_PIECE_TIERS).toContain(q.current);
    expect(DROPPABLE_PIECE_TIERS).toContain(q.next);
  });

  it("respects provided history for drought/streak avoidance", () => {
    // Anti-streak is a hard ban (weight = 0), not probabilistic — all seeds must avoid tier 0
    const history = [0, 0, 0, 0];
    for (let seed = 1; seed <= 50; seed++) {
      const q = createPieceQueue(history, seededRng(seed));
      expect(q.current).not.toBe(0);
    }
  });
});

describe("advanceQueue", () => {
  it("sets current to old next", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = seededRng(seed);
      const queue = createPieceQueue([], rng);
      const history = [queue.current];
      const advanced = advanceQueue(queue, history, false, rng);
      expect(advanced.current).toBe(queue.next);
    }
  });

  it("next is a valid droppable tier", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = seededRng(seed);
      const queue = createPieceQueue([], rng);
      const history = [queue.current];
      const advanced = advanceQueue(queue, history, false, rng);
      expect(DROPPABLE_PIECE_TIERS).toContain(advanced.next);
    }
  });

  it("does not mutate the input queue", () => {
    const rng = seededRng(7);
    const queue = createPieceQueue([], rng);
    const before = { current: queue.current, next: queue.next };
    advanceQueue(queue, [queue.current], false, rng);
    expect(queue.current).toBe(before.current);
    expect(queue.next).toBe(before.next);
  });

  it("suppresses high tiers in danger state", () => {
    const highTiers = DROPPABLE_PIECE_TIERS.filter((t) => t >= 3);
    const safe = Array.from({ length: 200 }, (_, i) => {
      const rng = seededRng(i + 1);
      const q = createPieceQueue([], rng);
      return advanceQueue(q, [q.current], false, rng).next;
    });
    const danger = Array.from({ length: 200 }, (_, i) => {
      const rng = seededRng(i + 1);
      const q = createPieceQueue([], rng);
      return advanceQueue(q, [q.current], true, rng).next;
    });
    const safeHigh = safe.filter((t) => highTiers.includes(t)).length;
    const dangerHigh = danger.filter((t) => highTiers.includes(t)).length;
    expect(dangerHigh).toBeLessThan(safeHigh);
  });

  it("chains correctly over multiple advances", () => {
    const rng = seededRng(42);
    let q = createPieceQueue([], rng);
    const history: number[] = [q.current, q.next];

    for (let i = 0; i < 20; i++) {
      const prevNext = q.next;
      q = advanceQueue(q, history, false, rng);
      history.push(q.next);
      if (history.length > 10) history.shift();

      expect(q.current).toBe(prevNext);
      expect(DROPPABLE_PIECE_TIERS).toContain(q.current);
      expect(DROPPABLE_PIECE_TIERS).toContain(q.next);
    }
  });
});
