/**
 * #3904 proposals (scratch branch): play one seeded game with the variant in CASCADE_VARIANT and
 * write board snapshots for the phone mocks: a mid-game pile (`midFrac` of the time to the win)
 * and the last frame before two capstones resolve into the win.
 * Usage: CASCADE_VARIANT='{...}' npx tsx tools/sim/cascade-3904-snap.ts <bot> <seed> <out.json> [midFrac]
 */
import { writeFileSync } from "node:fs";
import { CascadeEngine } from "../../frontend/src/game/cascade/engine";
import { CAPSTONE_TIER, TIERS } from "../../frontend/src/game/cascade/tiers";
import { WALL_THICKNESS } from "../../frontend/src/game/cascade/constants";
import { BOTS } from "../../frontend/src/game/cascade/sim/bots";
import { runGame } from "../../frontend/src/game/cascade/sim/runGame";

type Snap = { t: number; score: number; pieces: { tier: number; x: number; y: number; angle: number; scale: number }[] };
const [bot, seedS, out, midS] = process.argv.slice(2);
const frames: Snap[] = [];
let t = 0;
const make = () => {
  const e = new CascadeEngine({});
  const step = e.step.bind(e);
  e.step = (ms: number) => {
    const r = step(ms);
    t += ms;
    const s = e.getState();
    frames.push({
      t,
      score: s.score,
      pieces: s.pieces.map((p) => ({ tier: p.tier, x: p.x, y: p.y, angle: p.angle, scale: p.scale })),
    });
    if (frames.length > 40000) frames.shift();
    return r;
  };
  return e;
};
const m = runGame({ seed: Number(seedS), hz: 60, bot: BOTS[bot!]!, maxSimMs: 600_000, stopOnWin: true, config: { createEngine: make } });
const winT = m.timeToWinMs ?? m.simMs;
// Today's rule wins on MAKING the capstone: its "about to win" frame has two tier-10s instead.
const winTier = process.env.CASCADE_VARIANT ? CAPSTONE_TIER : CAPSTONE_TIER - 1;
const caps = (s: Snap) => s.pieces.filter((p) => p.tier === winTier).length;
let pre: Snap | undefined;
for (let i = frames.length - 1; i >= 0; i--) if (frames[i]!.t < winT && caps(frames[i]!) >= 2) { pre = frames[i]; break; }
const midT = winT * Number(midS ?? 0.6);
const mid = frames.find((f) => f.t >= midT);
writeFileSync(out!, JSON.stringify({ seed: Number(seedS), won: m.won, winT, wall: WALL_THICKNESS, radii: TIERS.map((x) => x.radius), mid, pre }));
console.log(out, m.won, Math.round(winT / 1000), "pre caps", pre ? caps(pre) : 0);
