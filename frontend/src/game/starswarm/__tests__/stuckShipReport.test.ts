/**
 * #4079 — `starswarm.shipStuck`: the two detectors (true and false positives), the frame-loop
 * tracker's gate, the per-process cap, the store-build sample, the server dial and the shape of
 * the event. Jest runs with `__DEV__ === true`, so the default here is an internal build;
 * `__forceStoreBuildForTests` gives the store-build rules.
 */
import * as Sentry from "@sentry/react-native";

import { __forceStoreBuildForTests } from "../../_shared/buildFlavour";
import { resetSentryThrottle } from "../../_shared/sentryThrottle";
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
  SHIP_STUCK_MIN_COMMAND_PX,
  SHIP_STUCK_MIN_MS,
  SHIP_STUCK_SAMPLE_RATE,
  checkShipStuck,
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

function stateAt(x: number, phase: GamePhase = "Playing", wave = 1): StarSwarmState {
  const s = initStarSwarm(CANVAS_W, CANVAS_H, wave, 7, "LieutenantJG");
  return { ...s, phase, wave, player: { ...s.player, x } };
}

/** Runs the frame loop's check every `step` ms from `from` to `to` (inclusive); returns sends. */
function runFrames(
  state: StarSwarmState,
  from: number,
  to: number,
  ticking = true,
  step = 16
): number {
  let sent = 0;
  for (let now = from; now <= to; now += step) if (checkShipStuck(now, state, ticking)) sent += 1;
  return sent;
}

/** The finger commands `commandedX` while the engine ship sits at `shipX` (a stuck ship). */
function stuckDrag(shipX: number, commandedX: number, wave = 1) {
  noteShipDragBegin(shipX);
  noteShipDragMove(commandedX, commandedX, shipX, (commandedX - shipX) * 1.5, 1.5, wave);
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
    expect(isShipOffCanvas(NaN, HW, CANVAS_W, "SwoopIn")).toBe(true);
    expect(isShipOffCanvas(MAX_X + 5, HW, CANVAS_W, "GameOver")).toBe(true);
  });

  it("is silent during Extraction (the autopilot has the ship)", () => {
    expect(isShipOffCanvas(NaN, HW, CANVAS_W, "Extraction")).toBe(false);
    expect(isShipOffCanvas(MAX_X + 50, HW, CANVAS_W, "Extraction")).toBe(false);
  });
});

describe("isShipUnresponsive", () => {
  const far = 200 - SHIP_STUCK_MIN_COMMAND_PX;
  it("is true when a drag commands the ship far from a ship that hasn't moved for 500 ms", () => {
    expect(isShipUnresponsive(true, far, 200, SHIP_STUCK_MIN_MS, "Playing", true)).toBe(true);
    expect(isShipUnresponsive(true, 300, 200, 900, "SwoopIn", true)).toBe(true);
  });

  it("is false for a short stall, a small gap, or no drag", () => {
    expect(isShipUnresponsive(true, far, 200, SHIP_STUCK_MIN_MS - 1, "Playing", true)).toBe(false);
    expect(isShipUnresponsive(true, 200 - 23, 200, 5000, "Playing", true)).toBe(false);
    expect(isShipUnresponsive(false, 0, 200, 5000, "Playing", true)).toBe(false);
  });

  it("edge-hugging with the finger past the edge is not unresponsive (command = clamped edge)", () => {
    expect(isShipUnresponsive(true, MAX_X, MAX_X, 10_000, "Playing", true)).toBe(false);
  });

  it("is silent while paused or in the countdown, and outside SwoopIn / Playing", () => {
    expect(isShipUnresponsive(true, 0, 200, 5000, "Playing", false)).toBe(false);
    for (const phase of ["Extraction", "GameOver", "ClearAwaitingPickups"] as const)
      expect(isShipUnresponsive(true, 0, 200, 5000, phase, true)).toBe(false);
  });

  it("a NaN command never counts", () => {
    expect(isShipUnresponsive(true, NaN, 200, 5000, "Playing", true)).toBe(false);
  });
});

describe("checkShipStuck", () => {
  it("sends one unresponsive warning with the fixed message and the drag's numbers", () => {
    stuckDrag(MAX_X, 250);
    const state = stateAt(MAX_X);
    expect(runFrames(state, 1000, 2000)).toBe(1);
    expect(capture).toHaveBeenCalledTimes(1);
    const [message, opts] = capture.mock.calls[0];
    expect(message).toBe(SHIP_STUCK_MESSAGE);
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
      commandedX: 250,
      rawX: 250,
      anchorX: MAX_X,
      translationX: -139.5,
      scale: 1.5,
      wave: 1,
      dragActive: true,
      msSinceLastChange: expect.any(Number),
    });
    expect(opts.extra.msSinceLastChange).toBeGreaterThanOrEqual(SHIP_STUCK_MIN_MS);
    // Numbers and enums only: no strings in extra, and about 2 KB with device context at most.
    for (const v of Object.values(opts.extra)) expect(typeof v).not.toBe("string");
    expect(JSON.stringify({ message, ...opts }).length).toBeLessThan(600);
  });

  it("waits out the full 500 ms of stillness", () => {
    stuckDrag(MAX_X, 250);
    const state = stateAt(MAX_X);
    expect(runFrames(state, 1000, 1000 + SHIP_STUCK_MIN_MS - 1)).toBe(0);
    expect(runFrames(state, 1000 + SHIP_STUCK_MIN_MS, 1000 + SHIP_STUCK_MIN_MS + 300)).toBe(1);
  });

  it("checks at most every 250 ms: frames in between return after one comparison", () => {
    expect(SHIP_STUCK_CHECK_EVERY_MS).toBe(250);
    noteShipDragBegin(100);
    const state = stateAt(NaN);
    // A getter that counts reads: only the gated frames read the state.
    let reads = 0;
    const counted = { ...state };
    Object.defineProperty(counted, "player", {
      get: () => {
        reads += 1;
        return state.player;
      },
    });
    // A check at 0 opens the gate's window; the frames up to 250 ms must not read the state.
    checkShipStuck(0, stateAt(100), true);
    reads = 0;
    for (let now = 16; now < 250; now += 16) checkShipStuck(now, counted, true);
    expect(reads).toBe(0);
    checkShipStuck(250, counted, true);
    expect(reads).toBeGreaterThan(0);
  });

  it("a ship that follows the finger is never reported", () => {
    noteShipDragBegin(180);
    for (let now = 0, x = 180; now < 5000; now += 16, x = 180 + ((now / 16) % 100)) {
      noteShipDragMove(x, x, 180, x - 180, 1, 1);
      checkShipStuck(now, stateAt(x), true);
    }
    expect(capture).not.toHaveBeenCalled();
  });

  it("edge-hugging, the finger held far past the right edge, is not reported", () => {
    noteShipDragBegin(300);
    // applyDrag clamps the command: the ship is exactly where it was told to be.
    noteShipDragMove(MAX_X, MAX_X + 400, MAX_X - 600, 600, 1, 1);
    expect(runFrames(stateAt(MAX_X), 0, 5000)).toBe(0);
    expect(capture).not.toHaveBeenCalled();
  });

  it("the countdown and the pause are silent, and their time doesn't count as stillness", () => {
    stuckDrag(MAX_X, 250);
    const state = stateAt(MAX_X, "SwoopIn");
    expect(runFrames(state, 0, 3000, false)).toBe(0);
    // Ticking again: the 500 ms start now, not at the countdown's start.
    expect(runFrames(state, 3016, 3016 + SHIP_STUCK_MIN_MS - 20)).toBe(0);
    expect(capture).not.toHaveBeenCalled();
  });

  it("Extraction is silent, and the command held through it is stale afterwards", () => {
    stuckDrag(200, 300);
    expect(runFrames(stateAt(120, "Extraction"), 0, 3000)).toBe(0);
    // Next wave: the ship is re-centred, the finger is held still, no new move arrived.
    expect(runFrames(stateAt(CANVAS_W / 2, "SwoopIn", 2), 3016, 6000)).toBe(0);
    expect(capture).not.toHaveBeenCalled();
  });

  it("a command from an earlier wave never counts", () => {
    stuckDrag(MAX_X, 250, 1);
    expect(runFrames(stateAt(MAX_X, "Playing", 2), 0, 3000)).toBe(0);
  });

  it("a drag the autopilot overrode (noteShipDragIgnored) is not reported", () => {
    stuckDrag(MAX_X, 250);
    noteShipDragIgnored();
    expect(runFrames(stateAt(MAX_X), 0, 3000)).toBe(0);
  });

  it("no drag, no unresponsive report: the drag's end clears it", () => {
    stuckDrag(MAX_X, 250);
    noteShipDragEnd();
    expect(runFrames(stateAt(MAX_X), 0, 3000)).toBe(0);
    expect(capture).not.toHaveBeenCalled();
  });

  it("reports an off-canvas ship, drag or not, and a NaN X as side unknown", () => {
    expect(runFrames(stateAt(NaN), 0, 0)).toBe(1);
    const [, opts] = capture.mock.calls[0];
    expect(opts.tags).toMatchObject({ kind: "offCanvas", side: "unknown" });
    expect(opts.extra).toMatchObject({ playerX: -1, playerXFinite: false, dragActive: false });
  });

  it("an off-canvas X during Extraction is silent", () => {
    expect(runFrames(stateAt(MAX_X + 40, "Extraction"), 0, 2000)).toBe(0);
  });

  it("at most one event per process: the second trigger sends nothing", () => {
    expect(SHIP_STUCK_MAX_EVENTS).toBe(1);
    expect(runFrames(stateAt(NaN), 0, 0)).toBe(1);
    stuckDrag(MAX_X, 250);
    expect(runFrames(stateAt(MAX_X), 300, 3000)).toBe(0);
    expect(runFrames(stateAt(MAX_X + 30), 3300, 4000)).toBe(0);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("store builds: decided once per process at the sample rate, then at most one", () => {
    expect(SHIP_STUCK_SAMPLE_RATE).toBe(0.25);
    __forceStoreBuildForTests(true);
    // Sampled out: never sends this process, and is asked only once.
    const out = jest.spyOn(Math, "random").mockReturnValue(0.25);
    expect(runFrames(stateAt(NaN), 0, 2000)).toBe(0);
    stuckDrag(MAX_X, 250);
    expect(runFrames(stateAt(MAX_X), 2016, 5000)).toBe(0);
    expect(capture).not.toHaveBeenCalled();
    expect(out).toHaveBeenCalledTimes(1);
    out.mockRestore();

    // A new process, sampled in: one event, then the cap.
    resetSentryThrottle();
    const inn = jest.spyOn(Math, "random").mockReturnValue(0.24);
    expect(runFrames(stateAt(NaN), 0, 2000)).toBe(1);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(inn).toHaveBeenCalledTimes(1);
  });

  it("store builds: a process sampled out returns before reading the state", () => {
    __forceStoreBuildForTests(true);
    jest.spyOn(Math, "random").mockReturnValue(0.9);
    checkShipStuck(0, stateAt(NaN), true); // decides the sample (out)
    const throwing = { ...stateAt(NaN) };
    Object.defineProperty(throwing, "player", {
      get: () => {
        throw new Error("state read");
      },
    });
    expect(checkShipStuck(1000, throwing, true)).toBe(false);
    expect(capture).not.toHaveBeenCalled();
  });

  it("store builds: a healthy ship never spends the sample", () => {
    __forceStoreBuildForTests(true);
    const random = jest.spyOn(Math, "random");
    noteShipDragBegin(180);
    noteShipDragMove(MAX_X, MAX_X + 100, 180, 400, 1, 1);
    runFrames(stateAt(MAX_X), 0, 3000);
    expect(random).not.toHaveBeenCalled();
  });

  it("the server dial off drops it in beforeSend", async () => {
    runFrames(stateAt(NaN), 0, 0);
    const [, opts] = capture.mock.calls[0];
    const event = { message: SHIP_STUCK_MESSAGE, level: opts.level };
    expect(sentryDialFilter(event)).toBe(event);
    await acceptSentryDial({ client_sentry: { enabled: false, sample_rate: 1 } });
    expect(sentryDialFilter(event)).toBeNull();
  });
});
