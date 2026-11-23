/**
 * Reports a Star Swarm ship that is stuck (#4079): a Sentry event, not a breadcrumb.
 *
 * "Ship stuck at the edge" has come back six times (#1504, #1549, #1811, #2004, #2846, #4079)
 * and never once reached Sentry: the only signal was the boundary breadcrumb in Controls, and a
 * breadcrumb only leaves the device inside a later error event. Hitting an edge is also normal
 * play. What is not normal, and what this module reports:
 * - `offCanvas`: the engine's `player.x` is not finite, or outside
 *   [hw − SHIP_STUCK_EDGE_EPSILON, canvasW − hw + SHIP_STUCK_EDGE_EPSILON], outside the
 *   Extraction phase (the autopilot climbs off the top; x stays in bounds, y is not checked).
 * - `unresponsive`: during one drag, the finger has commanded the ship at least
 *   SHIP_STUCK_MIN_COMMAND_PX (24) canvas px away from where the engine ship is, and the engine
 *   ship has moved less than SHIP_STUCK_STILL_PX (1) for SHIP_STUCK_MIN_MS (500 ms), in
 *   SwoopIn / Playing with ticks running (not paused, no countdown). Edge-hugging with the
 *   finger past the edge is not it: the command is the clamped edge, where the ship is.
 *
 * When it runs: Controls writes the drag's numbers into a plain module-level object on each pan
 * event (field writes, no allocation). GameCanvas's existing JS frame loop calls
 * `checkShipStuck` once per frame, after the tick; it returns after one comparison unless
 * SHIP_STUCK_CHECK_EVERY_MS (250 ms) has passed, and then does a few comparisons on numbers
 * already there. Nothing runs in the Skia frame build, nothing is measured, nothing is stored.
 * Web never runs it: GameCanvas.web.tsx does not call it (and web never initialises Sentry).
 *
 * Volume (CLAUDE.md: Cost → Performance → Data):
 * - A ship that follows the finger: nothing sent, nothing stored.
 * - `starswarm.shipStuck` event: numbers and enums only (no ids, no free text), about 2 KB with
 *   the SDK's device context; no screenshot, no attachment.
 * - Caps: at most SHIP_STUCK_MAX_EVENTS (1) per app process, both kinds together. Store builds
 *   send only in a SHIP_STUCK_SAMPLE_RATE (25%) share of processes, decided once per process on
 *   the first detection (a process sampled out returns before any maths after that). On top,
 *   `captureThrottledMessage` sends one `starswarm.shipStuck` per session and counts against the
 *   shared hourly budget.
 * - Worst case (every store player stuck): about 0.25 × processes × 2 KB, bounded by the
 *   per-process cap; a healthy release sends close to 0. Internal builds: at most 1 per process.
 * - Dials (no release needed): the server Sentry dial (`utils/sentryDial.ts`,
 *   `CLIENT_SENTRY_ENABLED` / `CLIENT_SENTRY_SAMPLE_RATE`) applies in `beforeSend` like every
 *   other message; the targeted kill switch is a Sentry inbound filter on the
 *   `starswarm.shipStuck` message.
 */
import { isStoreBuild } from "../_shared/buildFlavour";
import { captureThrottledMessage, onSentryThrottleReset } from "../_shared/sentryThrottle";
import { RNGH_VERSION } from "./rnghVersion";
import type { GamePhase, StarSwarmState } from "./types";

/** The event's fixed message, throttle key and fingerprint. */
export const SHIP_STUCK_MESSAGE = "starswarm.shipStuck";
/** The frame loop checks at most this often. */
export const SHIP_STUCK_CHECK_EVERY_MS = 250;
/** `player.x` may sit this far past its clamp range before it counts as off the canvas. */
export const SHIP_STUCK_EDGE_EPSILON = 0.5;
/** The finger must have commanded the ship at least this far (canvas px) from the engine ship. */
export const SHIP_STUCK_MIN_COMMAND_PX = 24;
/** The engine ship counts as still while it moves less than this (canvas px)… */
export const SHIP_STUCK_STILL_PX = 1;
/** …for at least this long. */
export const SHIP_STUCK_MIN_MS = 500;
/** At most this many `starswarm.shipStuck` events per process (internal and store builds). */
export const SHIP_STUCK_MAX_EVENTS = 1;
/** Store builds: share of processes that may send it at all (decided once). */
export const SHIP_STUCK_SAMPLE_RATE = 0.25;

export type ShipStuckKind = "offCanvas" | "unresponsive";

/** True when `x` is not a finite ship centre on the canvas. Silent during Extraction. Pure. */
export function isShipOffCanvas(
  x: number,
  halfWidth: number,
  canvasW: number,
  phase: GamePhase
): boolean {
  if (phase === "Extraction") return false;
  if (!Number.isFinite(x)) return true;
  return (
    x < halfWidth - SHIP_STUCK_EDGE_EPSILON || x > canvasW - halfWidth + SHIP_STUCK_EDGE_EPSILON
  );
}

/**
 * True when a drag is commanding the ship somewhere the engine ship is not going. Pure.
 * `ticking`: the engine ticks this frame (not paused, no pre-wave countdown).
 * `msStill`: how long the engine ship has moved less than SHIP_STUCK_STILL_PX.
 */
export function isShipUnresponsive(
  dragActive: boolean,
  commandedX: number,
  playerX: number,
  msStill: number,
  phase: GamePhase,
  ticking: boolean
): boolean {
  if (!dragActive || !ticking) return false;
  if (phase !== "Playing" && phase !== "SwoopIn") return false;
  // A NaN on either side compares false: offCanvas covers a bad player.x.
  return (
    Math.abs(commandedX - playerX) >= SHIP_STUCK_MIN_COMMAND_PX && msStill >= SHIP_STUCK_MIN_MS
  );
}

// --- Tracker: one plain object, written in place --------------------------------------------

interface Tracker {
  dragActive: boolean;
  /** The wave the command was given in: a command from an earlier wave is stale. */
  commandWave: number;
  commandedX: number;
  rawX: number;
  anchorX: number;
  translationX: number;
  scale: number;
  lastCheckMs: number;
  /** The engine X the stillness is measured from, and since when it has held. */
  stillX: number;
  stillSinceMs: number;
  /** False until a check in an eligible frame sets the stillness baseline. */
  watching: boolean;
}

const t: Tracker = {
  dragActive: false,
  commandWave: -1,
  commandedX: NaN,
  rawX: NaN,
  anchorX: NaN,
  translationX: 0,
  scale: NaN,
  lastCheckMs: -Infinity,
  stillX: NaN,
  stillSinceMs: 0,
  watching: false,
};

let eventsSent = 0;
let sampledIn: boolean | null = null;

/** A drag started (Controls `onBegin`, in the drag zone), anchored at `anchorX`. */
export function noteShipDragBegin(anchorX: number): void {
  t.dragActive = true;
  t.anchorX = anchorX;
  t.commandedX = NaN;
  t.rawX = NaN;
  t.translationX = 0;
  t.watching = false; // the stillness is measured within this drag only
}

/** The drag commanded the ship to `commandedX` (Controls `onChange`, after `applyDrag`). */
export function noteShipDragMove(
  commandedX: number,
  rawX: number,
  anchorX: number,
  translationX: number,
  scale: number,
  wave: number
): void {
  t.commandedX = commandedX;
  t.rawX = rawX;
  t.anchorX = anchorX;
  t.translationX = translationX;
  t.scale = scale;
  t.commandWave = wave;
}

/** The drag's command no longer applies (the autopilot has the ship). */
export function noteShipDragIgnored(): void {
  t.commandedX = NaN;
}

/** The drag ended (Controls `onEnd` / `onFinalize`). */
export function noteShipDragEnd(): void {
  t.dragActive = false;
  t.commandedX = NaN;
  t.watching = false;
}

/** Whether this process may still send one (decides the store sample on first use). */
function allowed(): boolean {
  if (eventsSent >= SHIP_STUCK_MAX_EVENTS) return false;
  if (!isStoreBuild()) return true;
  if (sampledIn === null) sampledIn = Math.random() < SHIP_STUCK_SAMPLE_RATE;
  return sampledIn;
}

const r1 = (n: number) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : -1);
const r2 = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : -1);

function send(kind: ShipStuckKind, state: StarSwarmState, nowMs: number): boolean {
  if (!allowed()) return false;
  const x = state.player.x;
  const side = !Number.isFinite(x) ? "unknown" : x >= state.canvasW / 2 ? "right" : "left";
  const sent = captureThrottledMessage(SHIP_STUCK_MESSAGE, SHIP_STUCK_MESSAGE, {
    level: "warning",
    tags: { kind, side, phase: state.phase, rnghVersion: RNGH_VERSION },
    extra: {
      playerX: r1(x),
      playerXFinite: Number.isFinite(x),
      commandedX: r1(t.commandedX),
      rawX: r1(t.rawX),
      anchorX: r1(t.anchorX),
      translationX: r1(t.translationX),
      scale: r2(t.scale), // a scale rounded to 0.1 would lose the layout
      wave: state.wave,
      dragActive: t.dragActive,
      msSinceLastChange: t.watching ? r1(nowMs - t.stillSinceMs) : -1,
    },
  });
  if (sent) eventsSent += 1;
  return sent;
}

/**
 * The frame loop's check, after the tick. `ticking`: the engine ticked this frame (not paused,
 * no pre-wave countdown). Returns whether it sent. One comparison between checks; nothing at all
 * once this process's cap is spent or its store sample came out against it.
 */
export function checkShipStuck(nowMs: number, state: StarSwarmState, ticking: boolean): boolean {
  if (eventsSent >= SHIP_STUCK_MAX_EVENTS) return false;
  if (nowMs - t.lastCheckMs < SHIP_STUCK_CHECK_EVERY_MS) return false;
  t.lastCheckMs = nowMs;
  // A store process sampled out never sends: skip the maths.
  if (sampledIn === false && isStoreBuild()) return false;

  const { player, phase } = state;
  if (isShipOffCanvas(player.x, player.width / 2, state.canvasW, phase)) {
    return send("offCanvas", state, nowMs);
  }

  const inPlay = phase === "Playing" || phase === "SwoopIn";
  // The autopilot (or the pickup wait, or game over) has the ship: a held command is stale.
  if (!inPlay) t.commandedX = NaN;
  if (!t.dragActive || !inPlay || !ticking) {
    t.watching = false;
    return false;
  }
  if (!t.watching || Math.abs(player.x - t.stillX) >= SHIP_STUCK_STILL_PX) {
    t.watching = true;
    t.stillX = player.x;
    t.stillSinceMs = nowMs;
  }
  const commanded = t.commandWave === state.wave ? t.commandedX : NaN;
  if (
    !isShipUnresponsive(t.dragActive, commanded, player.x, nowMs - t.stillSinceMs, phase, ticking)
  )
    return false;
  return send("unresponsive", state, nowMs);
}

/**
 * Tests only: forget the drag, the per-process count and the store sample.
 * @internal Exported for tests only; no production caller (knip --production, #3126).
 */
export function resetShipStuckReportForTests(): void {
  t.dragActive = false;
  t.commandWave = -1;
  t.commandedX = NaN;
  t.rawX = NaN;
  t.anchorX = NaN;
  t.translationX = 0;
  t.scale = NaN;
  t.lastCheckMs = -Infinity;
  t.stillX = NaN;
  t.stillSinceMs = 0;
  t.watching = false;
  eventsSent = 0;
  sampledIn = null;
}

onSentryThrottleReset(resetShipStuckReportForTests);
