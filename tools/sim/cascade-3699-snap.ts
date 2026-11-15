/**
 * #3699 proposals (scratch branch): play one seeded game to its win and write the real frames the
 * celebration mocks start from: the last `PRE_MS` before the win, the win event, and `POST_MS` of
 * the win tail (the screen keeps stepping while the capstone grows in, `winTail.ts`).
 * Usage: npx tsx tools/sim/cascade-3699-snap.ts <bot> <seed> <out.json>
 */
import { writeFileSync } from "node:fs";
import { CascadeEngine } from "../../frontend/src/game/cascade/engine";
import { CAPSTONE_TIER, TIERS } from "../../frontend/src/game/cascade/tiers";
import { BOTS } from "../../frontend/src/game/cascade/sim/bots";
import { runGame } from "../../frontend/src/game/cascade/sim/runGame";

type Snap = {
  t: number;
  score: number;
  pieces: { id: number; tier: number; x: number; y: number; angle: number; scale: number }[];
};
const PRE_MS = 800;
const POST_MS = 700;
const FRAME_MS = 1000 / 60;
const [bot, seedS, out] = process.argv.slice(2);
const frames: Snap[] = [];
let t = 0;
let engine: CascadeEngine | null = null;
let win: { x: number; y: number; id: number; t: number } | null = null;
const record = (e: CascadeEngine) => {
  const s = e.getState();
  frames.push({
    t,
    score: s.score,
    pieces: s.pieces.map((p) => ({
      id: p.id,
      tier: p.tier,
      x: p.x,
      y: p.y,
      angle: p.angle,
      scale: p.scale,
    })),
  });
  if (frames.length > 4000) frames.shift();
};
const make = () => {
  const e = new CascadeEngine({});
  engine = e;
  const step = e.step.bind(e);
  e.step = (ms: number) => {
    const r = step(ms);
    t += ms;
    for (const ev of r.events as unknown as { type: string; x: number; y: number; id: number }[]) {
      if (ev.type === "win" && !win) win = { x: ev.x, y: ev.y, id: ev.id, t };
    }
    record(e);
    return r;
  };
  // runGame destroys its engine when the run ends; keep this one for the win tail.
  e.destroy = () => {};
  return e;
};
const m = runGame({
  seed: Number(seedS),
  hz: 60,
  bot: BOTS[bot!]!,
  maxSimMs: 600_000,
  config: { createEngine: make },
});
if (!m.won || !win || !engine) {
  console.log("no win", m.endedBy);
  process.exit(2);
}
const w = win as { x: number; y: number; id: number; t: number };
// The win tail: the screen keeps stepping until the capstone has grown in.
for (let i = 0; i < POST_MS / FRAME_MS; i++) (engine as CascadeEngine).step(FRAME_MS);
const clip = frames.filter((f) => f.t >= w.t - PRE_MS);
writeFileSync(
  out!,
  JSON.stringify({
    seed: Number(seedS),
    bot,
    win: w,
    capTier: CAPSTONE_TIER,
    radii: TIERS.map((x) => x.radius),
    drawn: TIERS.map((x) => x.drawnRadius),
    merges: m.merges,
    frames: clip,
  })
);
console.log(out, "win at", Math.round(w.t / 1000), "s, pieces", clip.at(-1)!.pieces.length, "score", clip.at(-1)!.score);
