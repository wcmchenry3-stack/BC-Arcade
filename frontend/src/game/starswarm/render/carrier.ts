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
import type { DrawOp } from "./frame";
import type { CarrierBeam, StarSwarmState } from "../types";

export const BEAM_RGB = "176,108,255";
export const BRACE_RGB = "255,170,40";

/** Draw ops for one released beam: glow, core, then its head. */
export function carrierBeamOps(b: CarrierBeam): DrawOp[] {
  const top = b.y - b.length;
  const key = `cbeam-${b.id}`;
  return [
    {
      k: "rect",
      key: `${key}-glow`,
      x: b.x - b.halfWidth - 4,
      y: top,
      w: b.halfWidth * 2 + 8,
      h: b.length,
      color: `rgba(${BEAM_RGB},0.35)`,
    },
    {
      k: "rect",
      key: `${key}-core`,
      x: b.x - b.halfWidth * 0.5,
      y: top,
      w: b.halfWidth,
      h: b.length,
      color: "rgba(230,205,255,0.9)",
    },
    { k: "circle", key: `${key}-head`, cx: b.x, cy: b.y, r: b.halfWidth * 0.9, color: "#ffffff" },
  ];
}

/** Every Carrier telegraph and released beam in `state`, back to front. */
export function carrierOps(state: StarSwarmState): DrawOp[] {
  const ops: DrawOp[] = [];

  const brace = carrierRunBrace(state);
  if (brace) {
    const p = brace.progress;
    ops.push({
      k: "circle",
      key: "carrier-brace-ring",
      cx: brace.x,
      cy: brace.y,
      r: brace.r * (1.3 - 0.3 * p),
      color: `rgba(${BRACE_RGB},${(0.35 + 0.55 * p).toFixed(3)})`,
      stroke: 3,
    });
    const cy = brace.y + brace.r + 6;
    ops.push({
      k: "poly",
      key: "carrier-brace-chevron",
      points: [brace.x - 10, cy, brace.x + 10, cy, brace.x, cy + 10],
      color: `rgba(${BRACE_RGB},${(0.4 + 0.6 * p).toFixed(3)})`,
    });
  }

  const charge = carrierBeamCharge(state);
  if (charge) {
    ops.push({
      k: "rect",
      key: "beam-telegraph",
      x: charge.x - 2,
      y: charge.y,
      w: 4,
      h: state.canvasH,
      color: `rgba(${BEAM_RGB},${(0.1 + charge.progress * 0.35).toFixed(3)})`,
    });
    ops.push({
      k: "circle",
      key: "beam-charge",
      cx: charge.x,
      cy: charge.y + 6,
      r: 4 + charge.progress * 8,
      color: `rgba(${BEAM_RGB},${(0.4 + charge.progress * 0.5).toFixed(3)})`,
    });
  }

  for (const b of state.carrierBeams) ops.push(...carrierBeamOps(b));
  return ops;
}
