import { CANVAS_W, PLAYER_W } from "../engine";

const hw = PLAYER_W / 2; // 17
const MIN_X = hw; // 17
const MAX_X = CANVAS_W - hw; // 343

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function applyDrag(
  shipXAtDragStart: number,
  translationX: number,
  scale: number
): { newX: number; nextDragStart: number } {
  const rawX = shipXAtDragStart + translationX / scale;
  const newX = clamp(rawX, MIN_X, MAX_X);
  const nextDragStart = rawX !== newX ? newX - translationX / scale : shipXAtDragStart;
  return { newX, nextDragStart };
}

// ---------------------------------------------------------------------------
// Normal drag (no clamping)
// ---------------------------------------------------------------------------
describe("applyDrag — no edge contact", () => {
  const scale = 1.5;

  it("moves ship by translationX / scale", () => {
    const { newX } = applyDrag(180, 30, scale);
    expect(newX).toBeCloseTo(180 + 30 / scale, 5);
  });

  it("does not alter the drag-start ref when not clamped", () => {
    const { nextDragStart } = applyDrag(180, 30, scale);
    expect(nextDragStart).toBe(180);
  });

  it("works in the negative (leftward) direction", () => {
    const { newX, nextDragStart } = applyDrag(180, -30, scale);
    expect(newX).toBeCloseTo(180 - 30 / scale, 5);
    expect(nextDragStart).toBe(180);
  });
});

// ---------------------------------------------------------------------------
// Right-edge overshoot: finger pushes ship past CANVAS_W - hw
// ---------------------------------------------------------------------------
describe("applyDrag — right-edge overshoot", () => {
  const scale = 1.5;
  const startX = 340; // close to right edge (343)

  it("clamps newX to MAX_X when raw exceeds it", () => {
    // 340 + 50/1.5 = 373.3 → clamp to 343
    const { newX } = applyDrag(startX, 50, scale);
    expect(newX).toBe(MAX_X);
  });

  it("adjusts nextDragStart so reverse drag responds immediately", () => {
    // After overshoot, nextDragStart should be MAX_X - translationX/scale
    const translationX = 50;
    const { nextDragStart } = applyDrag(startX, translationX, scale);
    expect(nextDragStart).toBeCloseTo(MAX_X - translationX / scale, 5);
  });

  it("ship moves left immediately on direction reversal after overshoot", () => {
    // Simulate: drag right (overshoot), then drag slightly less right
    const translationX1 = 50;
    const { nextDragStart } = applyDrag(startX, translationX1, scale);

    // translationX decreases by 20 screen px (user starts reversing)
    const translationX2 = translationX1 - 20;
    const { newX: newX2 } = applyDrag(nextDragStart, translationX2, scale);

    // Ship should have moved left by 20/scale canvas units from MAX_X
    expect(newX2).toBeCloseTo(MAX_X - 20 / scale, 5);
  });

  it("no dead zone: even a 1px reversal moves the ship", () => {
    const { nextDragStart } = applyDrag(startX, 50, scale);
    const { newX } = applyDrag(nextDragStart, 49, scale);
    expect(newX).toBeCloseTo(MAX_X - 1 / scale, 5);
  });

  it("without the fix, reversing 1px after a 50px overshoot does not move the ship", () => {
    // OLD behaviour: nextDragStart stays at startX (340) after an overshoot.
    // Peak overshoot: translationX = 50. User reverses 1 screen px → translationX = 49.
    const rawXOld = startX + 49 / scale; // 340 + 32.67 = 372.67 → still past MAX_X
    const newXOld = clamp(rawXOld, MIN_X, MAX_X);
    expect(newXOld).toBe(MAX_X); // ship is still stuck at the edge

    // Only after reversing far enough that rawX drops below MAX_X does the ship move.
    // translationX = 0 → rawX = 340, which is below 343, so the ship finally leaves the edge.
    const rawXOld2 = startX + 0 / scale;
    const newXOld2 = clamp(rawXOld2, MIN_X, MAX_X);
    expect(newXOld2).toBe(startX); // ship jumps back to startX, not MAX_X
  });
});

// ---------------------------------------------------------------------------
// Left-edge overshoot: finger pushes ship past hw
// ---------------------------------------------------------------------------
describe("applyDrag — left-edge overshoot", () => {
  const scale = 1.5;
  const startX = 20; // close to left edge (17)

  it("clamps newX to MIN_X when raw is below it", () => {
    // 20 + (-50)/1.5 = -13.3 → clamp to 17
    const { newX } = applyDrag(startX, -50, scale);
    expect(newX).toBe(MIN_X);
  });

  it("adjusts nextDragStart so rightward reversal responds immediately", () => {
    const translationX = -50;
    const { nextDragStart } = applyDrag(startX, translationX, scale);
    expect(nextDragStart).toBeCloseTo(MIN_X - translationX / scale, 5);
  });

  it("ship moves right immediately on direction reversal after left overshoot", () => {
    const { nextDragStart } = applyDrag(startX, -50, scale);

    // translationX increases by 20 screen px (user reverses toward right)
    const { newX } = applyDrag(nextDragStart, -30, scale);
    expect(newX).toBeCloseTo(MIN_X + 20 / scale, 5);
  });
});

// ---------------------------------------------------------------------------
// Continuous overshoot: multiple onChange events against the same edge
// ---------------------------------------------------------------------------
describe("applyDrag — sustained right-edge press", () => {
  const scale = 1;

  it("ship stays at MAX_X across many increasing-translationX events", () => {
    let nextDragStart = MAX_X; // ship starts at the edge

    for (let tx = 0; tx <= 200; tx += 5) {
      const { newX, nextDragStart: nd } = applyDrag(nextDragStart, tx, scale);
      expect(newX).toBe(MAX_X);
      nextDragStart = nd;
    }
  });

  it("after sustained press, reversal by 1 moves the ship left by 1", () => {
    let nextDragStart = MAX_X; // ship starts at the edge
    for (let tx = 0; tx <= 200; tx += 5) {
      ({ nextDragStart } = applyDrag(nextDragStart, tx, scale));
    }
    // translationX drops by 1 from last value (200 → 199)
    const { newX } = applyDrag(nextDragStart, 199, scale);
    expect(newX).toBeCloseTo(MAX_X - 1, 5);
  });
});

// ---------------------------------------------------------------------------
// Scale sensitivity
// ---------------------------------------------------------------------------
describe("applyDrag — scale conversion", () => {
  it("correctly converts screen px to canvas units at scale 2", () => {
    const { newX } = applyDrag(180, 60, 2);
    expect(newX).toBeCloseTo(180 + 30, 5); // 60 screen px / 2 = 30 canvas units
  });

  it("correctly converts screen px to canvas units at scale 0.8", () => {
    const { newX } = applyDrag(180, 40, 0.8);
    expect(newX).toBeCloseTo(180 + 50, 5); // 40 / 0.8 = 50
  });
});
