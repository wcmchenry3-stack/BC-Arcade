/**
 * #3928: aiming's rules (tap vs drag, cancel, re-arm, the wall clamp) and the landing cast.
 */
import {
  AIM_STATE,
  aimAfterMove,
  aimAfterTime,
  aimDropX,
  aimGuideAlpha,
  aimLive,
  aimPieceX,
  aimReleaseDrops,
  landingY,
} from "../aim";
import { MOTION } from "../motion";
import { SPAWNER } from "../lidVisuals";
import { createFramePacker, packFrame, type FramePiece } from "../render/frame";
import { buildBoardStyle } from "../render/boardStyle";
import { CASCADE_LID_PALETTE } from "../../../theme/theme.cascade";
import { FLOOR_THICKNESS, WALL_THICKNESS, WORLD_HEIGHT, WORLD_WIDTH } from "../constants";

const A = MOTION.aim;
const { idle, pressed, aiming, cancelled, released } = AIM_STATE;
const RADIUS = buildBoardStyle(CASCADE_LID_PALETTE.light).radius;
const FLOOR = WORLD_HEIGHT - FLOOR_THICKNESS;

function frameOf(pieces: FramePiece[]): Float64Array {
  const packer = createFramePacker();
  packFrame(packer, { pieces }, 0);
  return packer.buf.slice(0, packer.length);
}
const piece = (tier: number, x: number, y: number, scale = 1): FramePiece => ({
  id: x,
  tier,
  x,
  y,
  angle: 0,
  scale,
});

describe("tap or drag", () => {
  it("a press released inside the tap window, without moving, drops (a tap)", () => {
    expect(aimAfterMove(pressed, A.tapSlopPt)).toBe(pressed);
    expect(aimAfterTime(pressed, A.guideDelayMs - 1)).toBe(pressed);
    expect(aimReleaseDrops(pressed, 120)).toBe(true);
  });

  it("moving past the slop, or holding past the delay, starts aiming", () => {
    expect(aimAfterMove(pressed, A.tapSlopPt + 0.5)).toBe(aiming);
    expect(aimAfterTime(pressed, A.guideDelayMs)).toBe(aiming);
    expect(aimReleaseDrops(aiming, 300)).toBe(true);
  });

  it("time does not move any other state", () => {
    for (const s of [idle, aiming, cancelled, released]) expect(aimAfterTime(s, 10_000)).toBe(s);
  });
});

describe("cancel (system only; leaving the board never cancels, #4081)", () => {
  it("a move never cancels: the aim state only ever goes pressed to aiming", () => {
    expect(aimAfterMove(pressed, 3)).toBe(pressed);
    expect(aimAfterMove(aiming, 80)).toBe(aiming);
    expect(aimAfterMove(aiming, 10_000)).toBe(aiming);
  });

  it("a cancelled aim stays cancelled on a move (no re-arm) and a release drops nothing", () => {
    expect(aimAfterMove(cancelled, 80)).toBe(cancelled);
    expect(aimReleaseDrops(cancelled, 200)).toBe(false);
  });

  it("an idle or released aim ignores moves; nothing drops from them", () => {
    expect(aimAfterMove(idle, 50)).toBe(idle);
    expect(aimAfterMove(released, 50)).toBe(released);
    expect(aimReleaseDrops(idle, 200)).toBe(false);
    expect(aimReleaseDrops(released, 200)).toBe(false);
  });

  it("never drops at a non-finite x (#3922)", () => {
    expect(aimReleaseDrops(aiming, Number.NaN)).toBe(false);
    expect(aimReleaseDrops(pressed, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("the wall clamp", () => {
  it("the drop x keeps the whole piece between the walls, as engine.drop does", () => {
    expect(aimDropX(0, 20)).toBe(WALL_THICKNESS + 20);
    expect(aimDropX(WORLD_WIDTH, 20)).toBe(WORLD_WIDTH - WALL_THICKNESS - 20);
    expect(aimDropX(200, 20)).toBe(200);
  });
});

describe("landing cast (first contact, straight down)", () => {
  it("lands on the floor when nothing is under it", () => {
    expect(landingY(frameOf([]), RADIUS, 200, 15)).toBe(FLOOR - 15);
    expect(landingY(frameOf([piece(3, 60, 500)]), RADIUS, 300, 15)).toBe(FLOOR - 15);
  });

  it("lands on a single piece: straight above it, and on its shoulder", () => {
    const R = RADIUS[4]!;
    const f = frameOf([piece(4, 200, 500)]);
    expect(landingY(f, RADIUS, 200, 10)).toBeCloseTo(500 - (R + 10), 6);
    const dx = 20;
    expect(landingY(f, RADIUS, 200 + dx, 10)).toBeCloseTo(
      500 - Math.sqrt((R + 10) ** 2 - dx ** 2),
      6
    );
    // Just past its reach: the floor.
    expect(landingY(f, RADIUS, 200 + R + 10 + 0.01, 10)).toBe(FLOOR - 10);
  });

  it("with overlapping pieces under the column, the highest contact wins", () => {
    const f = frameOf([piece(6, 200, 520), piece(2, 215, 440), piece(1, 180, 470)]);
    const contact = (tier: number, x: number, y: number) => {
      const s = RADIUS[tier]! + 12;
      const dx = 200 - x;
      return Math.abs(dx) < s ? y - Math.sqrt(s * s - dx * dx) : Infinity;
    };
    const want = Math.min(contact(6, 200, 520), contact(2, 215, 440), contact(1, 180, 470));
    expect(landingY(f, RADIUS, 200, 12)).toBeCloseTo(want, 6);
  });

  it("a piece still growing in counts at its drawn size", () => {
    const R = RADIUS[5]!;
    const f = frameOf([piece(5, 200, 500, 0.5)]);
    expect(landingY(f, RADIUS, 200, 10)).toBeCloseTo(500 - (R * 0.5 + 10), 6);
  });

  it("at the wall clamp, it casts at the clamped x", () => {
    const f = frameOf([piece(3, WALL_THICKNESS + 30, 520)]);
    const x = aimDropX(0, 15);
    expect(landingY(f, RADIUS, x, 15)).toBeLessThan(FLOOR - 15);
  });
});

describe("the piece and the guide over time", () => {
  it("the piece is at the finger from the first press: no glide from the ring (#4081)", () => {
    for (const ms of [0, 1, 50, A.guideDelayMs, 10_000]) {
      expect(aimPieceX(pressed, 320, 0, ms, false, 15)).toBe(320);
      expect(aimPieceX(aiming, 320, 0, ms, false, 15)).toBe(320);
    }
    expect(aimPieceX(idle, 320, 0, 0, false, 15)).toBe(SPAWNER.cx);
    // after a cancel it glides back to the ring in returnMs
    expect(aimPieceX(cancelled, 0, 320, 0, false, 15)).toBe(320);
    expect(aimPieceX(cancelled, 0, 320, A.returnMs, false, 15)).toBe(SPAWNER.cx);
  });

  it("a drag past an edge and back never draws the piece at the ring's centre", () => {
    const xs = [100, 40, 0, -50, -50, 0, 40, 100, 200, 400, 900, 400, 200];
    const drawn = xs.map((x) => aimPieceX(aiming, x, 0, 0, false, 15));
    // exactly the clamped finger x, at every sample
    expect(drawn).toEqual(xs.map((x) => aimDropX(x, 15)));
    for (let i = 0; i < xs.length; i++) {
      if (aimDropX(xs[i]!, 15) !== SPAWNER.cx) expect(drawn[i]).not.toBe(SPAWNER.cx);
    }
  });

  it("the guide fades in, and out after a release or a cancel", () => {
    expect(aimGuideAlpha(aiming, 0, false)).toBe(0);
    expect(aimGuideAlpha(aiming, A.inMs, false)).toBe(1);
    expect(aimGuideAlpha(released, 0, false)).toBe(1);
    expect(aimGuideAlpha(released, A.outMs, false)).toBe(0);
    expect(aimGuideAlpha(pressed, 500, false)).toBe(0);
  });

  // Review S4: the piece goes where the drop and the guide go, clamped by its radius.
  it("the piece is at the wall-clamped drop x, and glides back from it", () => {
    expect(aimPieceX(aiming, 0, 0, 0, false, 15)).toBe(aimDropX(0, 15));
    expect(aimPieceX(pressed, 999, 0, 0, false, 15)).toBe(aimDropX(999, 15));
    expect(aimPieceX(aiming, 999, 0, 0, true, 15)).toBe(aimDropX(999, 15));
    expect(aimPieceX(cancelled, 0, 999, 0, false, 15)).toBe(aimDropX(999, 15));
    // A cancelled tap (no start) stays in the ring.
    expect(aimPieceX(cancelled, 0, Number.NaN, 0, false, 15)).toBe(SPAWNER.cx);
  });

  it("Reduce Motion (unchanged): the piece is at the finger at once, back in the ring at once; the guide shows and hides at once", () => {
    expect(aimPieceX(aiming, 320, 0, 0, true, 15)).toBe(320);
    expect(aimPieceX(cancelled, 0, 320, 0, true, 15)).toBe(SPAWNER.cx);
    expect(aimGuideAlpha(aiming, 0, true)).toBe(1);
    expect(aimGuideAlpha(released, 0, true)).toBe(0);
    expect(aimGuideAlpha(cancelled, 0, true)).toBe(0);
  });

  it("keeps the motion clock running only while there is something to animate", () => {
    expect(aimLive(pressed, 0, false)).toBe(true);
    expect(aimLive(aiming, 9999, false)).toBe(true); // the dash march
    // Reduce Motion: nothing moves with time while aiming, so the clock may stop (review N2).
    expect(aimLive(aiming, 0, true)).toBe(false);
    expect(aimLive(pressed, 0, true)).toBe(true); // it still has to become aiming
    expect(aimLive(released, A.outMs - 1, false)).toBe(true);
    expect(aimLive(released, A.outMs, false)).toBe(false);
    expect(aimLive(cancelled, A.returnMs + A.outMs, false)).toBe(false);
    expect(aimLive(released, 0, true)).toBe(false);
    expect(aimLive(idle, 0, false)).toBe(false);
  });
});
