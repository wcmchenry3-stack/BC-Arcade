/**
 * #4079 — `starswarm.shipStuck`: the three detectors (true and false positives), the frame-loop
 * tracker's gate, holding the event until the run is not played, the per-process cap (counted
 * at detection, even when Sentry's budget is spent), the store-build sample, the server dial,
 * the unmount reset and the shape of the event. Jest runs with `__DEV__ === true`, so the
 * default here is an internal build; `__forceStoreBuildForTests` gives the store-build rules.
 */
import * as Sentry from "@sentry/react-native";

import { __forceStoreBuildForTests } from "../../_shared/buildFlavour";
import {
  captureThrottledMessage,
  resetSentryThrottle,
  sentryThrottle,
} from "../../_shared/sentryThrottle";
import {
  __resetSentryDialForTests,
  acceptSentryDial,
  sentryDialFilter,
} from "../../../utils/sentryDial";
import { CANVAS_H, CANVAS_W, PLAYER_W, initStarSwarm } from "../engine";
import type { GamePhase, StarSwarmState } from "../types";
import { RNGH_VERSION } from "../rnghVersion";
import {
  SHIP_STUCK_CHECK_EVERY_MS,
  SHIP_STUCK_MAX_EVENTS,
  SHIP_STUCK_MESSAGE,
  SHIP_STUCK_MIN_FINGER_PX,
  SHIP_STUCK_MIN_MS,
  SHIP_STUCK_SAMPLE_RATE,
  checkShipStuck,
  endShipStuckSession,
  flushShipStuckReport,
  inwardFingerPx,
  isGestureNoChange,
  isShipOffCanvas,
  isShipUnresponsive,
  noteShipDragBegin,
  noteShipDragEnd,
  noteShipDragIgnored,
  noteShipDragMove,
} from "../stuckShipReport";

const capture = Sentry.captureMessage as jest.Mock;
const HW = PLAYER_W / 2;
const MAX_X = CANVAS_W - HW;
const shipStuckCalls = () => capture.mock.calls.filter((c) => c[0] === SHIP_STUCK_MESSAGE);

function stateAt(x: number, phase: GamePhase = "Playing", wave = 1): StarSwarmState {
  const s = initStarSwarm(CANVAS_W, CANVAS_H, wave, 7, "LieutenantJG");
  return { ...s, phase, wave, player: { ...s.player, x } };
}

/** Runs the frame loop's check every `step` ms from `from` to `to` (inclusive); returns hits. */
function runFrames(
  state: StarSwarmState,
  from: number,
  to: number,
  mode: "play" | "paused" | "countdown" = "play",
  step = 16
): number {
  let hits = 0;
  for (let now = from; now <= to; now += step)
    if (checkShipStuck(now, state, mode === "paused", mode === "countdown")) hits += 1;
  return hits;
}

/**
 * The #4079 symptom, fed to the tracker directly: a stale anchor keeps rawX past the right edge,
 * so Controls keeps commanding MAX_X while the finger moves left (scale 1.5).
 */
function staleAnchorDrag(fingerTx: number) {
  noteShipDragMove(MAX_X, MAX_X + 200 + fingerTx / 1.5, MAX_X + 200, fingerTx, 1.5);
}

/** A held event is sent once the run stops being played: a paused frame. */
function sendHeld(at = 100_000) {
  return checkShipStuck(at, stateAt(MAX_X), true, false);
}

beforeEach(() => {
  capture.mockClear();
  resetSentryThrottle();
  __forceStoreBuildForTests(false);
});

afterEach(() => {
  __forceStoreBuildForTests(false);
  __resetSentryDialForTests();
  jest.restoreAllMocks();
});

describe("isShipOffCanvas", () => {
  it("is false anywhere in the clamp range, and within half a pixel of it", () => {
    for (const x of [HW, CANVAS_W / 2, MAX_X, HW - 0.5, MAX_X + 0.5])
      expect(isShipOffCanvas(x, HW, CANVAS_W, "Playing")).toBe(false);
  });

  it("is true past either edge, or for a non-finite X", () => {
    for (const x of [HW - 1, MAX_X + 1, NaN, Infinity, -Infinity])
      expect(isShipOffCanvas(x, HW, CANVAS_W, "Playing")).toBe(true);
    expect(isShipOffCanvas(MAX_X + 5, HW, CANVAS_W, "GameOver")).toBe(true);
  });

  it("is silent during Extraction (the autopilot has the ship)", () => {
    expect(isShipOffCanvas(NaN, HW, CANVAS_W, "Extraction")).toBe(false);
    expect(isShipOffCanvas(MAX_X + 50, HW, CANVAS_W, "Extraction")).toBe(false);
  });
});

describe("inwardFingerPx", () => {
  it("near an edge, counts movement away from it only", () => {
    // Ship at the right edge: moving left (negative translation) is inward.
    expect(inwardFingerPx(MAX_X, HW, CANVAS_W, 100, 40, 1.5)).toBe(40);
    expect(inwardFingerPx(MAX_X, HW, CANVAS_W, 100, 160, 1.5)).toBe(-40);
    // 23 px from the left edge: moving right is inward, left is outward.
    expect(inwardFingerPx(HW + 23, HW, CANVAS_W, -100, -40, 1.5)).toBe(40);
    expect(inwardFingerPx(HW + 23, HW, CANVAS_W, -40, -100, 1.5)).toBe(-40);
  });

  it("24 px or more from both edges, counts movement either way", () => {
    for (const x of [CANVAS_W / 2, HW + 24, MAX_X - 24, 100]) {
      expect(inwardFingerPx(x, HW, CANVAS_W, 0, 60, 1.5)).toBe(40);
      expect(inwardFingerPx(x, HW, CANVAS_W, 0, -60, 1.5)).toBe(40);
    }
  });

  it("is NaN for an unusable scale", () => {
    for (const s of [0, -1, NaN, Infinity])
      expect(inwardFingerPx(MAX_X, HW, CANVAS_W, 0, -90, s)).toBeNaN();
  });
});

describe("isShipUnresponsive", () => {
  const IN = SHIP_STUCK_MIN_FINGER_PX;
  it("is true when the finger moved 24 px inward and the ship was still for 500 ms", () => {
    expect(isShipUnresponsive(true, IN, SHIP_STUCK_MIN_MS, "Playing", true)).toBe(true);
    expect(isShipUnresponsive(true, 90, 900, "SwoopIn", true)).toBe(true);
    // The player drives the ship in the pickup wait too.
    expect(isShipUnresponsive(true, 90, 900, "ClearAwaitingPickups", true)).toBe(true);
  });

  it("is false for a short stall, a small move, an outward move, NaN, or no drag", () => {
    expect(isShipUnresponsive(true, IN, SHIP_STUCK_MIN_MS - 1, "Playing", true)).toBe(false);
    expect(isShipUnresponsive(true, IN - 1, 5000, "Playing", true)).toBe(false);
    expect(isShipUnresponsive(true, -300, 5000, "Playing", true)).toBe(false);
    expect(isShipUnresponsive(true, NaN, 5000, "Playing", true)).toBe(false);
    expect(isShipUnresponsive(false, 300, 5000, "Playing", true)).toBe(false);
  });

  it("is silent while paused or in the countdown, in Extraction and at game over", () => {
    expect(isShipUnresponsive(true, 300, 5000, "Playing", false)).toBe(false);
    for (const phase of ["Extraction", "GameOver"] as const)
      expect(isShipUnresponsive(true, 300, 5000, phase, true)).toBe(false);
  });
});

describe("isGestureNoChange", () => {
  it("is true when the end is 24 canvas px past the last delivered translation", () => {
    expect(isGestureNoChange(3, 100, 100 + 24 * 1.5, 1.5)).toBe(true);
    expect(isGestureNoChange(3, 100, 100 - 60, 1.5)).toBe(true);
  });

  it("is true when no onChange arrived and the gesture ended 24 px from its start", () => {
    expect(isGestureNoChange(0, 0, -36, 1.5)).toBe(true);
  });

  it("is false for a delivered gesture, a short tap, or unusable numbers", () => {
    expect(isGestureNoChange(5, 300, 300, 1.5)).toBe(false);
    expect(isGestureNoChange(5, 300, 310, 1.5)).toBe(false);
    expect(isGestureNoChange(0, 0, 10, 1.5)).toBe(false);
    expect(isGestureNoChange(0, 0, NaN, 1.5)).toBe(false);
    expect(isGestureNoChange(0, 0, 500, 0)).toBe(false);
  });
});

describe("checkShipStuck — unresponsive", () => {
  it("detects a stale anchor: the finger moves left, the ship stays at the right edge", () => {
    noteShipDragBegin(MAX_X, 1.5);
    staleAnchorDrag(300);
    const ship = stateAt(MAX_X);
    expect(runFrames(ship, 0, 300)).toBe(0); // the baseline: the ship last moved here
    staleAnchorDrag(300 - 60); // 40 canvas px inward
    expect(runFrames(ship, 316, 900)).toBe(1);
    // Held, not sent: the run is being played.
    expect(shipStuckCalls()).toHaveLength(0);
    sendHeld();
    expect(shipStuckCalls()).toHaveLength(1);
    const [message, opts] = shipStuckCalls()[0]!;
    expect(message).toBe("starswarm.shipStuck");
    expect(opts.level).toBe("warning");
    expect(opts.fingerprint).toEqual([SHIP_STUCK_MESSAGE]);
    expect(opts.tags).toEqual({
      kind: "unresponsive",
      side: "right",
      phase: "Playing",
      rnghVersion: RNGH_VERSION,
    });
    expect(opts.extra).toEqual({
      playerX: MAX_X,
      playerXFinite: true,
      commandedX: MAX_X,
      rawX: MAX_X + 200 + 160,
      anchorX: MAX_X + 200,
      translationX: 240,
      endTranslationX: -1,
      fingerInwardPx: 40,
      changes: 2,
      scale: 1.5,
      wave: 1,
      dragActive: true,
      msShipStill: expect.any(Number),
    });
    expect(opts.extra.msShipStill).toBeGreaterThanOrEqual(SHIP_STUCK_MIN_MS);
    // Numbers and booleans only, a few hundred bytes before the SDK's device context.
    for (const v of Object.values(opts.extra)) expect(typeof v).not.toBe("string");
    expect(JSON.stringify({ message, ...opts }).length).toBeLessThan(700);
  });

  it("a flick across the canvas inside one check window, then held at the edge, is silent", () => {
    noteShipDragBegin(MAX_X, 1);
    const ship = stateAt(MAX_X);
    noteShipDragMove(MAX_X, MAX_X, MAX_X, 0, 1);
    expect(runFrames(ship, 0, 0)).toBe(0); // baseline: ship at 343, finger at 0
    // Within 250 ms: past the left edge, then back past the right with a small overshoot.
    // applyDrag re-anchors on each clamp, so the commands go 17 then 343 while the finger ends
    // 68 px left of where it started: the overshoots were thrown away. Without the re-baseline
    // on a moved command that read as 68 px "inward" against a still ship.
    noteShipDragMove(HW, -360, 40, -400, 1); // clamped at the left edge
    noteShipDragMove(MAX_X, MAX_X + 6, MAX_X + 6 + 68, -68, 1); // back past the right edge
    // The engine ship is back at 343 at the next check; the finger then pushes on outward.
    for (let now = 250, tx = -68; now < 4000; now += 16, tx += 1) {
      noteShipDragMove(MAX_X, MAX_X + 1, MAX_X - tx, tx, 1);
      checkShipStuck(now, ship, false, false);
    }
    expect(flushShipStuckReport()).toBe(false);
  });

  it("a ship frozen near the centre is caught whichever way the finger moves", () => {
    for (const dir of [1, -1]) {
      resetSentryThrottle();
      capture.mockClear();
      noteShipDragBegin(CANVAS_W / 2, 1);
      // A stale anchor in the middle: the command stays on the ship while the finger moves.
      noteShipDragMove(CANVAS_W / 2, CANVAS_W / 2, CANVAS_W / 2, 0, 1);
      const ship = stateAt(CANVAS_W / 2);
      runFrames(ship, 0, 0);
      noteShipDragMove(CANVAS_W / 2, CANVAS_W / 2, CANVAS_W / 2 - dir * 60, dir * 60, 1);
      expect(runFrames(ship, 250, 900)).toBe(1);
      sendHeld();
      expect(shipStuckCalls()[0]![1].extra.fingerInwardPx).toBe(60);
    }
  });

  it("waits out the full 500 ms of stillness", () => {
    noteShipDragBegin(MAX_X, 1.5);
    staleAnchorDrag(0);
    const ship = stateAt(MAX_X);
    runFrames(ship, 0, 0);
    staleAnchorDrag(-90);
    expect(runFrames(ship, 250, SHIP_STUCK_MIN_MS - 1)).toBe(0);
    expect(runFrames(ship, SHIP_STUCK_MIN_MS, SHIP_STUCK_MIN_MS + 300)).toBe(1);
  });

  it("edge-hugging, the finger moving on outward past the edge, is not reported", () => {
    noteShipDragBegin(300, 1);
    const ship = stateAt(MAX_X);
    for (let now = 0, tx = 50; now < 5000; now += 16, tx += 3) {
      noteShipDragMove(MAX_X, 300 + tx, 300, tx, 1);
      checkShipStuck(now, ship, false, false);
    }
    expect(flushShipStuckReport()).toBe(false);
  });

  it("a finger held still against a still ship is not reported", () => {
    noteShipDragBegin(MAX_X, 1.5);
    staleAnchorDrag(120);
    expect(runFrames(stateAt(MAX_X), 0, 5000)).toBe(0);
  });

  it("a ship that follows the finger is never reported", () => {
    noteShipDragBegin(180, 1);
    for (let now = 0; now < 5000; now += 16) {
      const tx = -((now / 16) % 120);
      noteShipDragMove(180 + tx, 180 + tx, 180, tx, 1);
      checkShipStuck(now, stateAt(180 + tx), false, false);
    }
    expect(flushShipStuckReport()).toBe(false);
  });

  it("the countdown and the pause are silent, and their time doesn't count as stillness", () => {
    noteShipDragBegin(MAX_X, 1.5);
    staleAnchorDrag(0);
    const ship = stateAt(MAX_X, "SwoopIn");
    staleAnchorDrag(-150);
    expect(runFrames(ship, 0, 3000, "countdown")).toBe(0);
    expect(runFrames(ship, 3000, 3200, "paused")).toBe(0);
    // Ticking again: the stillness and the finger's baseline start now.
    expect(runFrames(ship, 3216, 6000)).toBe(0);
    expect(flushShipStuckReport()).toBe(false);
  });

  it("a drag the autopilot ignores (Extraction) is not reported, nor right after it", () => {
    noteShipDragBegin(200, 1);
    noteShipDragMove(200, 200, 200, 0, 1);
    for (let now = 0, tx = 0; now < 3000; now += 16, tx -= 2) {
      noteShipDragIgnored(tx, 1);
      checkShipStuck(now, stateAt(120, "Extraction"), false, false);
    }
    // Next wave: the ship is re-centred and the finger held still.
    expect(runFrames(stateAt(CANVAS_W / 2, "SwoopIn", 2), 3016, 6000)).toBe(0);
    expect(flushShipStuckReport()).toBe(false);
  });

  it("no drag, no unresponsive report", () => {
    noteShipDragBegin(MAX_X, 1.5);
    staleAnchorDrag(300);
    noteShipDragEnd(300, stateAt(MAX_X));
    staleAnchorDrag(0);
    expect(runFrames(stateAt(MAX_X), 0, 3000)).toBe(0);
    expect(flushShipStuckReport()).toBe(false);
  });

  it("checks at most every 250 ms: frames in between don't read the state", () => {
    expect(SHIP_STUCK_CHECK_EVERY_MS).toBe(250);
    const state = stateAt(NaN);
    let reads = 0;
    const counted = { ...state };
    Object.defineProperty(counted, "player", {
      get: () => {
        reads += 1;
        return state.player;
      },
    });
    checkShipStuck(0, stateAt(100), false, false);
    for (let now = 16; now < 250; now += 16) checkShipStuck(now, counted, false, false);
    expect(reads).toBe(0);
    checkShipStuck(250, counted, false, false);
    expect(reads).toBeGreaterThan(0);
  });
});

describe("noteShipDragEnd — noChange", () => {
  it("detects a gesture whose moves were never delivered", () => {
    noteShipDragBegin(MAX_X, 1.5);
    noteShipDragEnd(-150, stateAt(MAX_X)); // no onChange at all, 100 canvas px left
    sendHeld();
    expect(shipStuckCalls()).toHaveLength(1);
    const [, opts] = shipStuckCalls()[0]!;
    expect(opts.tags).toMatchObject({ kind: "noChange", side: "right" });
    expect(opts.extra).toMatchObject({ changes: 0, endTranslationX: -150, scale: 1.5 });
  });

  it("detects a gesture that ended far past its last delivered move", () => {
    noteShipDragBegin(MAX_X, 1.5);
    staleAnchorDrag(300);
    noteShipDragEnd(150, stateAt(MAX_X));
    sendHeld();
    expect(shipStuckCalls()[0]![1].tags.kind).toBe("noChange");
  });

  it("a delivered gesture, a short tap and a repeated end are silent", () => {
    noteShipDragBegin(MAX_X, 1.5);
    staleAnchorDrag(300);
    noteShipDragEnd(300, stateAt(MAX_X));
    noteShipDragEnd(-900, stateAt(MAX_X)); // onFinalize after onEnd: the drag is over
    noteShipDragBegin(MAX_X, 1.5);
    noteShipDragEnd(6, stateAt(MAX_X));
    noteShipDragBegin(MAX_X, 1.5);
    noteShipDragEnd(NaN, stateAt(MAX_X)); // onFinalize with no translation
    expect(flushShipStuckReport()).toBe(false);
  });
});

describe("checkShipStuck — offCanvas", () => {
  it("detects an off-canvas ship, drag or not, and a NaN X as side unknown", () => {
    expect(runFrames(stateAt(NaN), 0, 0)).toBe(1);
    sendHeld();
    const [, opts] = shipStuckCalls()[0]!;
    expect(opts.tags).toMatchObject({ kind: "offCanvas", side: "unknown" });
    expect(opts.extra).toMatchObject({ playerX: -1, playerXFinite: false, dragActive: false });
  });

  it("is silent during Extraction", () => {
    expect(runFrames(stateAt(MAX_X + 40, "Extraction"), 0, 2000)).toBe(0);
  });
});

describe("no upload while the run is played", () => {
  it("a detection while playing sends nothing until a pause, then exactly one event", () => {
    runFrames(stateAt(NaN), 0, 0);
    expect(runFrames(stateAt(MAX_X), 250, 5000)).toBe(0);
    expect(capture).not.toHaveBeenCalled();
    expect(runFrames(stateAt(MAX_X), 5250, 5250, "paused")).toBe(1);
    expect(runFrames(stateAt(MAX_X), 5500, 9000, "paused")).toBe(0);
    expect(shipStuckCalls()).toHaveLength(1);
  });

  it("…or until game over", () => {
    runFrames(stateAt(NaN), 0, 0);
    runFrames(stateAt(MAX_X, "GameOver"), 250, 250);
    expect(shipStuckCalls()).toHaveLength(1);
  });

  it("the countdown and Extraction are mid-run: the event stays held through both", () => {
    runFrames(stateAt(NaN), 0, 0);
    runFrames(stateAt(MAX_X, "Extraction"), 250, 3000);
    runFrames(stateAt(CANVAS_W / 2, "SwoopIn", 2), 3016, 6000, "countdown");
    runFrames(stateAt(CANVAS_W / 2, "SwoopIn", 2), 6016, 8000);
    expect(capture).not.toHaveBeenCalled();
    sendHeld();
    expect(shipStuckCalls()).toHaveLength(1);
  });

  it("…or when Controls unmounts", () => {
    runFrames(stateAt(NaN), 0, 0);
    endShipStuckSession();
    expect(shipStuckCalls()).toHaveLength(1);
  });
});

describe("caps, sample and dial", () => {
  it("at most one per process: the second trigger sends nothing", () => {
    expect(SHIP_STUCK_MAX_EVENTS).toBe(1);
    runFrames(stateAt(NaN), 0, 0);
    sendHeld(250);
    noteShipDragBegin(MAX_X, 1.5);
    noteShipDragEnd(-300, stateAt(MAX_X));
    expect(runFrames(stateAt(MAX_X + 30), 500, 4000)).toBe(0);
    sendHeld();
    expect(shipStuckCalls()).toHaveLength(1);
  });

  it("a spent Sentry budget still spends the cap: no retry every 250 ms", () => {
    for (let i = 0; i < 10; i++)
      captureThrottledMessage(`other.${i}`, "other", { level: "warning" });
    capture.mockClear();
    runFrames(stateAt(NaN), 0, 0);
    runFrames(stateAt(NaN), 250, 60_000, "paused");
    expect(capture).not.toHaveBeenCalled();
    // One drop (the one attempt), not one per check.
    expect(sentryThrottle.droppedCount).toBe(1);
  });

  it("store builds: decided once per process at the sample rate, then at most one", () => {
    expect(SHIP_STUCK_SAMPLE_RATE).toBe(0.25);
    __forceStoreBuildForTests(true);
    const out = jest.spyOn(Math, "random").mockReturnValue(0.25);
    runFrames(stateAt(NaN), 0, 2000, "paused");
    noteShipDragBegin(MAX_X, 1.5);
    noteShipDragEnd(-300, stateAt(MAX_X));
    runFrames(stateAt(NaN), 2016, 5000, "paused");
    expect(capture).not.toHaveBeenCalled();
    expect(out).toHaveBeenCalledTimes(1);
    out.mockRestore();

    resetSentryThrottle();
    const inn = jest.spyOn(Math, "random").mockReturnValue(0.24);
    runFrames(stateAt(NaN), 0, 2000, "paused");
    expect(shipStuckCalls()).toHaveLength(1);
    expect(inn).toHaveBeenCalledTimes(1);
  });

  it("store builds: a process sampled out returns before reading the state", () => {
    __forceStoreBuildForTests(true);
    jest.spyOn(Math, "random").mockReturnValue(0.9);
    checkShipStuck(0, stateAt(NaN), false, false); // decides the sample (out)
    const throwing = { ...stateAt(NaN) };
    Object.defineProperty(throwing, "player", {
      get: () => {
        throw new Error("state read");
      },
    });
    expect(checkShipStuck(1000, throwing, false, false)).toBe(false);
    expect(capture).not.toHaveBeenCalled();
  });

  it("store builds: a healthy ship never spends the sample", () => {
    __forceStoreBuildForTests(true);
    const random = jest.spyOn(Math, "random");
    noteShipDragBegin(180, 1);
    noteShipDragMove(MAX_X, MAX_X + 100, 180, 400, 1);
    runFrames(stateAt(MAX_X), 0, 3000);
    noteShipDragEnd(400, stateAt(MAX_X));
    expect(random).not.toHaveBeenCalled();
  });

  it("the server dial off drops it in beforeSend", async () => {
    runFrames(stateAt(NaN), 0, 0);
    sendHeld();
    const [, opts] = shipStuckCalls()[0]!;
    const event = { message: SHIP_STUCK_MESSAGE, level: opts.level };
    expect(sentryDialFilter(event)).toBe(event);
    await acceptSentryDial({ client_sentry: { enabled: false, sample_rate: 1 } });
    expect(sentryDialFilter(event)).toBeNull();
  });
});

describe("endShipStuckSession", () => {
  it("forgets a drag that never saw onFinalize, so a later visit isn't reported", () => {
    noteShipDragBegin(MAX_X, 1.5);
    staleAnchorDrag(300);
    endShipStuckSession(); // left the screen mid-drag
    // Back on the same wave; the finger's last numbers are still in the tracker's past.
    expect(runFrames(stateAt(MAX_X), 0, 5000)).toBe(0);
    staleAnchorDrag(0);
    expect(runFrames(stateAt(MAX_X), 5016, 9000)).toBe(0);
    expect(flushShipStuckReport()).toBe(false);
  });
});
