/**
 * #3562: Lightning's beams as shared display-list geometry.
 *
 * Both renderers replay the same ops: `buildFrame` (native Skia) appends them as-is, and
 * `GameCanvas.web.tsx` replays them on its 2D context with `drawPickupOps`, so the two cannot
 * drift apart (the `render/carrier.ts` pattern). Only `poly` and `circle` ops appear here.
 *
 * One beam per gun, from the ship's nose to the top of the screen (or to the rock that stops it),
 * exactly the engine's beams (`lightningBeamAt`, the same function the damage pulse reads), drawn
 * only while `lightningBeamOn`. #3594 restyled it in the projectile look (blue-white with an edge
 * crackle). Each beam is five ops, back to front: a soft blue glow, the blue-white body (a ribbon
 * whose edges are jagged), the crackle (that same ribbon's outline, stroked in a pale blue), a
 * white-hot core, and a flare on the gun. The jagged edge is re-drawn every `CRACKLE_MS` from a
 * stateless hash of the Lightning timer, so it flickers without any state and is the same on
 * both canvases.
 *
 * Per frame it allocates only the ops themselves and three point lists per beam (the body and
 * its crackle share one), as before the restyle; the beam geometry goes into one module scratch.
 */
import {
  lightningBeamAt,
  lightningBeamCount,
  newLightningBeam,
  hashFrac,
  type LightningBeam,
} from "../engine";
import { withAlpha } from "./color";
import {
  LIGHTNING_BEAM_GLOW_RGB,
  LIGHTNING_BEAM_RGB,
  LIGHTNING_CRACKLE_RGB,
  WHITE_RGB,
} from "./palette";
import type { DrawOp } from "./frame";
import { debugOpKeys } from "./opKeys";
import type { StarSwarmState } from "../types";

const GLOW = withAlpha(LIGHTNING_BEAM_GLOW_RGB, 0.35);
const BODY = withAlpha(LIGHTNING_BEAM_RGB, 0.8);
const CRACKLE = withAlpha(LIGHTNING_CRACKLE_RGB, 0.9);
/** The crackle line's width, px. */
export const CRACKLE_STROKE = 1;
const CORE = withAlpha(WHITE_RGB, 0.95);
const FLARE = withAlpha(WHITE_RGB, 0.8);

/** The glow reaches this far past the beam's edge, px. */
const GLOW_PAD = 4;
/** The core's share of the beam's half-width. */
const CORE_SHARE = 0.35;
/** The crackle's segments along a beam, and how often it is re-drawn, ms. */
export const CRACKLE_SEGMENTS = 8;
export const CRACKLE_MS = 50;
/** How far a crackle point sits from the axis, as a share of the half-width: [MIN, MIN + SPAN]. */
const CRACKLE_MIN = 0.55;
const CRACKLE_SPAN = 0.5;

const BEAM: LightningBeam = newLightningBeam();

/** A rectangle along the beam, `h` either side of its axis, as a flat closed polygon. */
function quad(b: LightningBeam, h: number): number[] {
  const nx = -b.uy * h;
  const ny = b.ux * h;
  const ex = b.ox + b.ux * b.len;
  const ey = b.oy + b.uy * b.len;
  return [b.ox + nx, b.oy + ny, ex + nx, ey + ny, ex - nx, ey - ny, b.ox - nx, b.oy - ny];
}

/** The crackling ribbon: up one edge and back down the other, each point jittered by the hash. */
function ribbon(b: LightningBeam, seed: number): number[] {
  const nx = -b.uy;
  const ny = b.ux;
  const out: number[] = [];
  for (let side = 1; side >= -1; side -= 2) {
    for (let k = 0; k <= CRACKLE_SEGMENTS; k++) {
      const j = side === 1 ? k : CRACKLE_SEGMENTS - k;
      const t = (b.len * j) / CRACKLE_SEGMENTS;
      const h = b.halfW * (CRACKLE_MIN + CRACKLE_SPAN * hashFrac(seed + j * 7.31 + side * 3.7));
      out.push(b.ox + b.ux * t + nx * h * side, b.oy + b.uy * t + ny * h * side);
    }
  }
  return out;
}

/**
 * Every Lightning beam in `state`, glow → body → crackle → core → flare per beam — appended to `ops` when
 * given (`buildFrame` passes its own list), and returned. Nothing while the beam is off.
 */
export function lightningBeamOps(state: StarSwarmState, ops: DrawOp[] = []): DrawOp[] {
  const n = lightningBeamCount(state);
  if (n === 0) return ops;
  const dbg = debugOpKeys();
  const tick = Math.floor((state.activePowerUp?.remainingMs ?? 0) / CRACKLE_MS);
  for (let i = 0; i < n; i++) {
    const b = lightningBeamAt(state, i, state.asteroids, BEAM);
    const key = dbg ? `lbeam-${i}` : undefined;
    const edge = ribbon(b, tick * 31.7 + i * 13.1); // shared by the body and its crackle
    ops.push(
      { k: "poly", key: key && `${key}-glow`, points: quad(b, b.halfW + GLOW_PAD), color: GLOW },
      { k: "poly", key: key && `${key}-body`, points: edge, color: BODY },
      {
        k: "poly",
        key: key && `${key}-crackle`,
        points: edge,
        color: CRACKLE,
        stroke: CRACKLE_STROKE,
      },
      { k: "poly", key: key && `${key}-core`, points: quad(b, b.halfW * CORE_SHARE), color: CORE },
      { k: "circle", key: key && `${key}-flare`, cx: b.ox, cy: b.oy, r: b.halfW, color: FLARE }
    );
  }
  return ops;
}
