/**
 * #3561: the Carrier's bay-launch path factory — a deterministic flight from the bay to a slot.
 */
import { evalCubic } from "../engine/geometry";
import { bayLaunchPath } from "../engine/geometry";
import { rng, seedRng } from "../engine/rng";

describe("bayLaunchPath (#3561)", () => {
  const bay = { x: 200, y: 120 };
  const slot = { fx: 150, fy: 260 };

  it("starts at the bay and ends in the slot", () => {
    for (let idx = 0; idx < 6; idx++) {
      const p = bayLaunchPath(bay.x, bay.y, slot.fx, slot.fy, idx);
      expect(evalCubic(p, 0)).toEqual(bay);
      expect(evalCubic(p, 1)).toEqual({ x: slot.fx, y: slot.fy });
    }
  });

  it("drops out of the bay first (heads down, off to alternating sides), with per-index variety", () => {
    const paths = [0, 1, 2, 3].map((i) => bayLaunchPath(bay.x, bay.y, slot.fx, slot.fy, i));
    for (const p of paths) expect(p.p1.y).toBeGreaterThan(bay.y);
    expect(Math.sign(paths[0]!.p1.x - bay.x)).toBe(-1);
    expect(Math.sign(paths[1]!.p1.x - bay.x)).toBe(1);
    expect(new Set(paths.map((p) => JSON.stringify(p))).size).toBe(4);
  });

  it("is deterministic and never touches the seeded random stream", () => {
    seedRng(7);
    const a = bayLaunchPath(bay.x, bay.y, slot.fx, slot.fy, 2);
    const next = rng();
    seedRng(7);
    const b = bayLaunchPath(bay.x, bay.y, slot.fx, slot.fy, 2);
    expect(b).toEqual(a);
    expect(rng()).toBe(next); // the call in between consumed nothing
  });
});
