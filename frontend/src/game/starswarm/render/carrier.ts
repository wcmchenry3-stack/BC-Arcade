/**
 * #2843: the Carrier's weapon and attack-run visuals as shared display-list geometry: the beam
 * charge telegraph, each released traveling beam, and the attack-run brace telegraph.
 *
 * Both renderers replay the same ops: `buildFrame` (native Skia) appends them as-is, and
 * `GameCanvas.web.tsx` replays them on its 2D context with `drawPickupOps`, so the two cannot
 * drift apart. Only `rect`, `circle` and `poly` ops appear here.
 *
 * Visual language: the beam is violet (the Carrier's colour). Its charge shows the column the
 * bolt will take as a thin line plus a swelling orb at the emitter; a released beam is a fast
 * bolt — soft glow, bright core, a white-hot head at its leading edge. The attack-run brace is
 * amber (a different colour, so a brace and a charge never read as the same telegraph): a
 * tightening ring around the Carrier and a downward chevron under it.
 */
import { carrierBeamCharge, carrierRunBrace } from "../engine";
import { withAlpha } from "./color";
import type { DrawOp } from "./frame";
import { debugOpKeys } from "./opKeys";
import type { CarrierBeam, StarSwarmState } from "../types";

/** 0xRRGGBB — the beam's violet and the brace's amber. */
export const BEAM_RGB = 0xb06cff;
export const BRACE_RGB = 0xffaa28;
const BEAM_GLOW = withAlpha(BEAM_RGB, 0.35);
const BEAM_CORE = withAlpha(0xe6cdff, 0.9);

/** Draw ops for one released beam: glow, core, then its head — appended to `ops` (#2963). */
export function carrierBeamOps(b: CarrierBeam, ops: DrawOp[] = []): DrawOp[] {
  const top = b.y - b.length;
  const key = debugOpKeys() ? `cbeam-${b.id}` : undefined;
  ops.push(
    {
      k: "rect",
      key: key && `${key}-glow`,
      x: b.x - b.halfWidth - 4,
      y: top,
      w: b.halfWidth * 2 + 8,
      h: b.length,
      color: BEAM_GLOW,
    },
    {
      k: "rect",
      key: key && `${key}-core`,
      x: b.x - b.halfWidth * 0.5,
      y: top,
      w: b.halfWidth,
      h: b.length,
      color: BEAM_CORE,
    },
    {
      k: "circle",
      key: key && `${key}-head`,
      cx: b.x,
      cy: b.y,
      r: b.halfWidth * 0.9,
      color: 0xffffffff,
    }
  );
  return ops;
}

/**
 * Every Carrier telegraph and released beam in `state`, back to front — appended to `ops` when
 * given (#2963: `buildFrame` passes its own list), and returned.
 */
export function carrierOps(state: StarSwarmState, ops: DrawOp[] = []): DrawOp[] {
  const dbg = debugOpKeys();

  const brace = carrierRunBrace(state);
  if (brace) {
    const p = brace.progress;
    ops.push({
      k: "circle",
      key: dbg ? "carrier-brace-ring" : undefined,
      cx: brace.x,
      cy: brace.y,
      r: brace.r * (1.3 - 0.3 * p),
      color: withAlpha(BRACE_RGB, 0.35 + 0.55 * p),
      stroke: 3,
    });
    const cy = brace.y + brace.r + 6;
    ops.push({
      k: "poly",
      key: dbg ? "carrier-brace-chevron" : undefined,
      points: [brace.x - 10, cy, brace.x + 10, cy, brace.x, cy + 10],
      color: withAlpha(BRACE_RGB, 0.4 + 0.6 * p),
    });
  }

  const charge = carrierBeamCharge(state);
  if (charge) {
    ops.push({
      k: "rect",
      key: dbg ? "beam-telegraph" : undefined,
      x: charge.x - 2,
      y: charge.y,
      w: 4,
      h: state.canvasH,
      color: withAlpha(BEAM_RGB, 0.1 + charge.progress * 0.35),
    });
    ops.push({
      k: "circle",
      key: dbg ? "beam-charge" : undefined,
      cx: charge.x,
      cy: charge.y + 6,
      r: 4 + charge.progress * 8,
      color: withAlpha(BEAM_RGB, 0.4 + charge.progress * 0.5),
    });
  }

  for (const b of state.carrierBeams) carrierBeamOps(b, ops);
  return ops;
}
