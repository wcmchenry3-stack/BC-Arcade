/**
 * Reports a Star Swarm ship that is stuck (#4079): a Sentry event, not a breadcrumb.
 *
 * "Ship stuck at the edge" has come back six times (#1504, #1549, #1811, #2004, #2846, #4079)
 * and never once reached Sentry: the only signal was the boundary breadcrumb in Controls, and a
 * breadcrumb only leaves the device inside a later error event. Hitting an edge is also normal
 * play. The useful signal is "the finger is moving the ship and the ship is not following",
 * judged from the finger itself, not from Controls' clamped output (a stale anchor keeps that
 * output pinned at the edge, equal to the engine X, while the finger moves away). Three kinds:
 * - `unresponsive`: during one drag, the finger has moved at least SHIP_STUCK_MIN_FINGER_PX
 *   (24 canvas px) in a direction the ship can follow since the engine ship last moved by
 *   SHIP_STUCK_STILL_PX (1 px) and the drag's command last changed by 1 px, and the ship has
 *   been still for at least SHIP_STUCK_MIN_MS (500 ms), while the player drives it (SwoopIn /
 *   Playing / ClearAwaitingPickups) and the engine ticks (not paused, no countdown). Within
 *   24 px of an edge only movement away from it counts; farther from both edges either
 *   direction does. Catches a stale or lost anchor (the #4079 symptom: the command stays pinned
 *   at the edge while the finger moves away) and a ship held after an unusable event.
 *   Edge-hugging (the finger moving outward, past the edge), a finger held still, and a flick
 *   whose overshoot the clamp threw away (the command moved, so the reference is reset) are not
 *   it. A command that keeps changing while the engine ignores it is also reset each time, so
 *   it is not caught here (it would need a broken canvas ref).
 * - `noChange`: checked once per gesture, at `onEnd` / `onFinalize`. The gesture ended at least
 *   24 canvas px from the last translation an `onChange` delivered, or delivered no `onChange`
 *   at all while ending 24 px from where it began: the library dropped the moves.
 * - `offCanvas`: the engine's `player.x` is not finite, or outside
 *   [hw − SHIP_STUCK_EDGE_EPSILON, canvasW − hw + SHIP_STUCK_EDGE_EPSILON], outside Extraction
 *   (the autopilot climbs off the top; y is not checked). `setPlayerX` now drops non-finite
 *   values, so this is mostly for a restored or corrupted state or an engine bug; kept because
 *   it costs three comparisons per check.
 * Blind spot: a gesture that delivers no callbacks at all (no `onBegin`, no `onEnd`) leaves the
 * tracker inactive and is not detected.
 *
 * When it runs: Controls writes the drag's numbers into one module-level object on each pan
 * event (field writes, no allocation). GameCanvas's existing JS frame loop calls
 * `checkShipStuck` once per frame, after the tick; it returns after one comparison unless
 * SHIP_STUCK_CHECK_EVERY_MS (250 ms) has passed, and then does a few comparisons on numbers
 * already there. Nothing runs in the Skia frame build, nothing is measured, nothing is stored.
 * Web never runs the frame check: GameCanvas.web.tsx does not call it (and web never
 * initialises Sentry).
 *
 * Never uploaded mid-run (CLAUDE.md: no uploads while a game is played): a detection builds
 * the event once and holds it. It is sent only when the run is paused (which includes leaving
 * the app: Controls flushes when `isPaused` turns true), at game over, or when Controls
 * unmounts. The pre-wave countdown and Extraction are mid-run and keep it held.
 *
 * Volume (CLAUDE.md: Cost → Performance → Data):
 * - A ship that follows the finger: nothing sent, nothing stored. Per game and per day: ≈ 0.
 * - `starswarm.shipStuck` event: numbers and enums only (no ids, no free text), about 2 KB with
 *   the SDK's device context; no screenshot, no attachment.
 * - Caps: at most SHIP_STUCK_MAX_EVENTS (1) per app process, all kinds together, counted at
 *   detection whether or not Sentry's throttle then lets it through (so a spent budget never
 *   means a retry). Store builds send only in a SHIP_STUCK_SAMPLE_RATE (25%) share of
 *   processes, decided once per process on the first detection (a process sampled out returns
 *   before any maths after that). On top, `captureThrottledMessage` sends one
 *   `starswarm.shipStuck` per session and counts against the shared hourly budget.
 * - Per day the cap scales with app launches (one process per launch): worst case, a bug that
 *   sticks every store player's ship, ≤ 0.25 × launches × 2 KB per device per day (25% of
 *   processes, 1 event each), however many games each launch plays. Internal builds: at most
 *   1 per process.
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
/** How far (canvas px) the finger must move inward, or go undelivered, before it counts. */
export const SHIP_STUCK_MIN_FINGER_PX = 24;
/** The engine ship counts as still while it moves less than this (canvas px)… */
export const SHIP_STUCK_STILL_PX = 1;
/** …for at least this long. */
export const SHIP_STUCK_MIN_MS = 500;
/** At most this many `starswarm.shipStuck` events per process (internal and store builds). */
export const SHIP_STUCK_MAX_EVENTS = 1;
/** Store builds: share of processes that may send it at all (decided once). */
export const SHIP_STUCK_SAMPLE_RATE = 0.25;

export type ShipStuckKind = "offCanvas" | "unresponsive" | "noChange";

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

/** Phases where the player drives the ship (the autopilot has it in Extraction). */
export function playerDrivesShip(phase: GamePhase): boolean {
  return phase === "Playing" || phase === "SwoopIn" || phase === "ClearAwaitingPickups";
}

/**
 * How far (canvas px) the finger moved, between `txFrom` and `txNow` (screen px), in a direction
 * the ship can follow. Within SHIP_STUCK_MIN_FINGER_PX of an edge only movement away from that
 * edge counts (negative when it moved outward: edge-hugging); farther from both edges the ship
 * can follow either way, so the absolute movement counts. NaN when the scale or a translation
 * is unusable. Pure.
 */
export function inwardFingerPx(
  shipX: number,
  halfWidth: number,
  canvasW: number,
  txFrom: number,
  txNow: number,
  scale: number
): number {
  if (!(scale > 0) || !Number.isFinite(scale)) return NaN;
  const moved = (txNow - txFrom) / scale;
  const roomLeft = shipX - halfWidth;
  const roomRight = canvasW - halfWidth - shipX;
  if (roomLeft >= SHIP_STUCK_MIN_FINGER_PX && roomRight >= SHIP_STUCK_MIN_FINGER_PX)
    return Math.abs(moved);
  return roomRight < roomLeft ? -moved : moved;
}

/**
 * True when a drag moved the finger inward and the engine ship did not follow. Pure.
 * `inwardPx`: `inwardFingerPx` since the ship last moved. `msStill`: how long it has not.
 * `ticking`: the engine ticks this frame (not paused, no pre-wave countdown).
 */
export function isShipUnresponsive(
  dragActive: boolean,
  inwardPx: number,
  msStill: number,
  phase: GamePhase,
  ticking: boolean
): boolean {
  if (!dragActive || !ticking || !playerDrivesShip(phase)) return false;
  // NaN compares false: an unusable scale is not evidence.
  return inwardPx >= SHIP_STUCK_MIN_FINGER_PX && msStill >= SHIP_STUCK_MIN_MS;
}

/**
 * True when a gesture's end is SHIP_STUCK_MIN_FINGER_PX past what `onChange` delivered: it
 * ended that far from the last delivered translation, or delivered none and ended that far from
 * where it began. Pure.
 */
export function isGestureNoChange(
  changes: number,
  lastTx: number,
  endTx: number,
  scale: number
): boolean {
  if (!Number.isFinite(endTx) || !(scale > 0) || !Number.isFinite(scale)) return false;
  const undelivered = changes > 0 ? endTx - lastTx : endTx;
  return Math.abs(undelivered) / scale >= SHIP_STUCK_MIN_FINGER_PX;
}

// --- Tracker: one plain object, written in place --------------------------------------------

interface Tracker {
  dragActive: boolean;
  /** `onChange` events this gesture (moves and ignored ones alike). */
  changes: number;
  commandedX: number;
  rawX: number;
  anchorX: number;
  /** The last delivered translation (screen px) and the scale it came with. */
  translationX: number;
  scale: number;
  /** The last usable scale this gesture, for the maths. */
  goodScale: number;
  endTranslationX: number;
  lastCheckMs: number;
  /** The engine X the stillness is measured from, since when, and the finger's then. */
  stillX: number;
  stillSinceMs: number;
  stillTx: number;
  /** False until a check in an eligible frame sets the stillness baseline. */
  watching: boolean;
}

const t: Tracker = {
  dragActive: false,
  changes: 0,
  commandedX: NaN,
  rawX: NaN,
  anchorX: NaN,
  translationX: 0,
  scale: NaN,
  goodScale: NaN,
  endTranslationX: NaN,
  lastCheckMs: -Infinity,
  stillX: NaN,
  stillSinceMs: 0,
  stillTx: 0,
  watching: false,
};

interface PendingEvent {
  readonly tags: Record<string, string>;
  readonly extra: Record<string, unknown>;
}

let eventsSent = 0;
let sampledIn: boolean | null = null;
let pending: PendingEvent | null = null;

const usableScale = (s: number) => Number.isFinite(s) && s > 0;

function resetDrag(): void {
  t.dragActive = false;
  t.changes = 0;
  t.commandedX = NaN;
  t.rawX = NaN;
  t.anchorX = NaN;
  t.translationX = 0;
  t.scale = NaN;
  t.goodScale = NaN;
  t.endTranslationX = NaN;
  t.watching = false;
}

/** A drag started (Controls `onBegin`, in the drag zone), anchored at `anchorX`. */
export function noteShipDragBegin(anchorX: number, scale: number): void {
  resetDrag();
  t.dragActive = true;
  t.anchorX = anchorX;
  t.scale = scale;
  if (usableScale(scale)) t.goodScale = scale;
}

/** An `onChange` arrived: the finger's translation and scale, whatever Controls does with it. */
function noteChange(translationX: number, scale: number): void {
  t.changes += 1;
  t.translationX = translationX;
  t.scale = scale;
  if (usableScale(scale)) t.goodScale = scale;
}

/** The drag commanded the ship to `commandedX` (Controls `onChange`, after `applyDrag`). */
export function noteShipDragMove(
  commandedX: number,
  rawX: number,
  anchorX: number,
  translationX: number,
  scale: number
): void {
  noteChange(translationX, scale);
  // #4079 round 2: a command that moved re-baselines the stillness and the finger's reference
  // at the next check, so a fast flick whose overshoot the clamp threw away inside one 250 ms
  // window can't read as "inward" afterwards. A stale anchor keeps the command pinned, so it
  // is still caught.
  if (!(Math.abs(commandedX - t.commandedX) < SHIP_STUCK_STILL_PX)) t.watching = false;
  t.commandedX = commandedX;
  t.rawX = rawX;
  t.anchorX = anchorX;
}

/** An `onChange` arrived while the autopilot has the ship: delivered, but not a command. */
export function noteShipDragIgnored(translationX: number, scale: number): void {
  noteChange(translationX, scale);
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

/**
 * Builds the event once and holds it for `flushPendingIfIdle`. Counted against the cap here,
 * at detection, whatever Sentry's throttle later says.
 */
function detect(
  kind: ShipStuckKind,
  state: StarSwarmState | null | undefined,
  nowMs: number,
  inwardPx: number
): boolean {
  if (!allowed()) return false;
  eventsSent += 1;
  const x = state?.player.x ?? NaN;
  const canvasW = state?.canvasW ?? NaN;
  const side = !Number.isFinite(x) ? "unknown" : x >= canvasW / 2 ? "right" : "left";
  pending = {
    tags: {
      kind,
      side,
      phase: state?.phase ?? "unknown",
      rnghVersion: RNGH_VERSION,
    },
    extra: {
      playerX: r1(x),
      playerXFinite: Number.isFinite(x),
      commandedX: r1(t.commandedX),
      rawX: r1(t.rawX),
      anchorX: r1(t.anchorX),
      translationX: r1(t.translationX),
      endTranslationX: r1(t.endTranslationX),
      fingerInwardPx: r1(inwardPx),
      changes: t.changes,
      scale: r2(t.scale), // a scale rounded to 0.1 would lose the layout
      wave: state?.wave ?? -1,
      dragActive: t.dragActive,
      msShipStill: t.watching ? r1(nowMs - t.stillSinceMs) : -1,
    },
  };
  return true;
}

/** Sends the held event, if there is one. Returns whether Sentry's throttle let it through. */
export function flushShipStuckReport(): boolean {
  if (pending === null) return false;
  const { tags, extra } = pending;
  pending = null;
  return captureThrottledMessage(SHIP_STUCK_MESSAGE, SHIP_STUCK_MESSAGE, {
    level: "warning",
    tags,
    extra,
  });
}

/**
 * The drag ended (Controls `onEnd` / `onFinalize`, the first of the two). `endTranslationX` is
 * the end event's translation; `state` the engine state then. Runs the once-per-gesture
 * `noChange` check; an event it holds is sent only on pause, at game over, or when Controls
 * unmounts.
 */
export function noteShipDragEnd(
  endTranslationX: number,
  state: StarSwarmState | null | undefined
): void {
  if (!t.dragActive) return;
  t.endTranslationX = endTranslationX;
  if (
    eventsSent < SHIP_STUCK_MAX_EVENTS &&
    !(sampledIn === false && isStoreBuild()) &&
    isGestureNoChange(t.changes, t.translationX, endTranslationX, t.goodScale)
  ) {
    detect("noChange", state, NaN, NaN);
  }
  resetDrag();
}

/**
 * Whether a held event may go now: the run is paused or over (CLAUDE.md: no upload mid-run;
 * the pre-wave countdown and Extraction are mid-run). Leaving the screen flushes it too.
 */
function mayUpload(state: StarSwarmState, paused: boolean): boolean {
  return paused || state.phase === "GameOver";
}

/**
 * The frame loop's check, after the tick. `paused`: the run is paused; `countdown`: the
 * pre-wave countdown is running (the engine ticks when neither is). Returns whether it detected
 * or sent. One comparison between checks; nothing at
 * all once this process's cap is spent (and nothing is held) or its store sample came out
 * against it.
 */
export function checkShipStuck(
  nowMs: number,
  state: StarSwarmState,
  paused: boolean,
  countdown: boolean
): boolean {
  if (eventsSent >= SHIP_STUCK_MAX_EVENTS && pending === null) return false;
  if (nowMs - t.lastCheckMs < SHIP_STUCK_CHECK_EVERY_MS) return false;
  t.lastCheckMs = nowMs;
  if (pending !== null) {
    if (!mayUpload(state, paused)) return false;
    flushShipStuckReport();
    return true;
  }
  // A store process sampled out never sends: skip the maths.
  if (sampledIn === false && isStoreBuild()) return false;

  const ticking = !paused && !countdown;
  const { player, phase } = state;
  if (isShipOffCanvas(player.x, player.width / 2, state.canvasW, phase)) {
    return detect("offCanvas", state, nowMs, NaN);
  }
  if (!t.dragActive || !ticking || !playerDrivesShip(phase)) {
    t.watching = false;
    return false;
  }
  if (!t.watching || Math.abs(player.x - t.stillX) >= SHIP_STUCK_STILL_PX) {
    t.watching = true;
    t.stillX = player.x;
    t.stillSinceMs = nowMs;
    t.stillTx = t.translationX;
    return false;
  }
  const inward = inwardFingerPx(
    player.x,
    player.width / 2,
    state.canvasW,
    t.stillTx,
    t.translationX,
    t.goodScale
  );
  if (!isShipUnresponsive(true, inward, nowMs - t.stillSinceMs, phase, ticking)) return false;
  return detect("unresponsive", state, nowMs, inward);
}

/**
 * Controls unmounted: send a held event (the run is no longer on screen) and forget the drag,
 * so a later screen never sees a drag that ended without `onFinalize`. Keeps the per-process
 * count and the store sample.
 */
export function endShipStuckSession(): void {
  flushShipStuckReport();
  resetDrag();
  t.lastCheckMs = -Infinity;
}

/**
 * Tests only: forget the drag, the held event, the per-process count and the store sample.
 * @internal Exported for tests only; no production caller (knip --production, #3126).
 */
export function resetShipStuckReportForTests(): void {
  resetDrag();
  t.lastCheckMs = -Infinity;
  t.stillX = NaN;
  t.stillSinceMs = 0;
  t.stillTx = 0;
  eventsSent = 0;
  sampledIn = null;
  pending = null;
}

onSentryThrottleReset(resetShipStuckReportForTests);
