/**
 * #2956: the native Star Swarm canvas (GameCanvas.tsx, the iOS/Android Skia renderer).
 *
 * Skia is replaced by a recording stub, the engine and the frame builder are the real modules
 * wrapped in jest.fn (so a test can force one transition, e.g. "this tick the score went up"),
 * and requestAnimationFrame is driven by hand: `frame(ts)` runs exactly one iteration of the
 * canvas's loop. What is pinned is behaviour, not pixels:
 *  - publish gating (#2563): a frame is built for the Picture only when `sameFrame` says the
 *    inputs changed, so a paused or finished game publishes nothing;
 *  - the HUD (#2566) commits to React only when a HUD value changed;
 *  - devOptions are read through a ref on every tick and on reset;
 *  - pause/resume (no delta spike), the pre-wave countdown, and every engine-event callback.
 * The drawing itself (buildFrame / drawFrame) is tested in game/starswarm/__tests__.
 */
import React, { Profiler } from "react";
import { AccessibilityInfo } from "react-native";
import { render, screen } from "@testing-library/react-native";
import * as Sentry from "@sentry/react-native";
import { createPicture, useImage } from "@shopify/react-native-skia";

import GameCanvas from "../GameCanvas";
import type { GameCanvasHandle } from "../GameCanvas";
import * as engine from "../../../game/starswarm/engine";
import { buildFrame } from "../../../game/starswarm/render/frame";
import { drawFrame } from "../../../game/starswarm/render/drawFrame";
import { pickupCues } from "../../../game/starswarm/render/pickupCue";
import type { StarSwarmState } from "../../../game/starswarm/types";
import {
  CANVAS_TEST_H as H,
  CANVAS_TEST_W as W,
  createRafHarness,
  seededStarSwarm,
} from "./helpers/canvasFixtures";

jest.mock("@shopify/react-native-skia", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return {
    Canvas: ({ children, ...props }: { children?: React.ReactNode }) =>
      createElement(View, { testID: "skia-canvas", ...props }, children),
    // #2963: a Group shows its transform (a plain array, or a derived value) for the starfield tests
    Group: ({ children, transform }: { children?: React.ReactNode; transform?: unknown }) =>
      createElement(View, { testID: "skia-group", transform }, children),
    Picture: () => null,
    // Run the recorder at once against a dummy canvas, as Skia would on the UI thread.
    createPicture: jest.fn((draw: (canvas: object) => void, size: object) => {
      draw({ drawColor: () => {}, drawCircle: () => {} });
      return { size };
    }),
    Skia: {
      Paint: () => ({ setAntiAlias: () => {}, setColor: () => {} }),
      Color: (c: number) => c,
    },
    useImage: jest.fn(() => null),
  };
});

// The real engine, every function wrapped so a test can force a single transition.
jest.mock("../../../game/starswarm/engine", () => {
  const actual = jest.requireActual("../../../game/starswarm/engine");
  const wrapped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(actual)) {
    wrapped[k] = typeof v === "function" ? jest.fn(v as (...a: unknown[]) => unknown) : v;
  }
  return wrapped;
});
jest.mock("../../../game/starswarm/render/frame", () => {
  const actual = jest.requireActual("../../../game/starswarm/render/frame");
  return { ...actual, buildFrame: jest.fn(actual.buildFrame) };
});
// #2567: frame-time sampling is on in pre-launch builds; turn it on so getFrameStats reports.
jest.mock("../../../game/_shared/envFlags", () => ({
  ...jest.requireActual("../../../game/_shared/envFlags"),
  isPreLaunchApiBuild: () => true,
}));
jest.mock("../../../game/starswarm/render/drawFrame", () => ({ drawFrame: jest.fn() }));
jest.mock("../../../game/starswarm/render/pickupCue", () => {
  const actual = jest.requireActual("../../../game/starswarm/render/pickupCue");
  return { ...actual, pickupCues: jest.fn(actual.pickupCues) };
});

const actualEngine = jest.requireActual<typeof engine>("../../../game/starswarm/engine");
const actualPickupCues = jest.requireActual<
  typeof import("../../../game/starswarm/render/pickupCue")
>("../../../game/starswarm/render/pickupCue").pickupCues;

const mockEngine = engine as unknown as Record<string, jest.Mock>;
const mockTick = engine.tick as unknown as jest.Mock;
const mockBuildFrame = buildFrame as unknown as jest.Mock;
const mockDrawFrame = drawFrame as unknown as jest.Mock;
const mockPickupCues = pickupCues as unknown as jest.Mock;
const mockUseImage = useImage as unknown as jest.Mock;

// --- a hand-cranked requestAnimationFrame (helpers/canvasFixtures.ts) ------------------------

const raf = createRafHarness({ frameMs: 16 });
const { frame, frames } = raf;
const seeded = seededStarSwarm;

beforeEach(() => {
  raf.install();
  // Every wrapped engine function back to the real one; ticks are the identity unless a test
  // says otherwise, so nothing random happens between two frames.
  for (const [k, fn] of Object.entries(mockEngine)) {
    if (typeof fn === "function" && "mockReset" in fn) {
      fn.mockReset();
      fn.mockImplementation((actualEngine as unknown as Record<string, jest.Mock>)[k]);
    }
  }
  mockTick.mockImplementation((s: StarSwarmState) => s);
  mockPickupCues.mockReset();
  mockPickupCues.mockImplementation(actualPickupCues);
  mockBuildFrame.mockClear();
  mockDrawFrame.mockReset();
  mockUseImage.mockReset();
  mockUseImage.mockReturnValue(null);
  (Sentry.captureException as jest.Mock).mockClear();
  (Sentry.captureMessage as jest.Mock).mockClear();
});

// Spies (Date.now, performance.now, AccessibilityInfo) are restored even when a test fails.
afterEach(() => jest.restoreAllMocks());
afterAll(() => raf.uninstall());

/** Make the next tick return `change(prev)`. */
function nextTick(change: (s: StarSwarmState) => StarSwarmState) {
  mockTick.mockImplementationOnce((s: StarSwarmState) => change(s));
}

type CanvasProps = React.ComponentProps<typeof GameCanvas>;

async function mount(props: Partial<CanvasProps> = {}) {
  const ref = React.createRef<GameCanvasHandle>();
  const commits = { count: 0 };
  const ui = (p: Partial<CanvasProps>) => (
    <Profiler id="canvas" onRender={() => (commits.count += 1)}>
      <GameCanvas ref={ref} width={W} height={H} scale={1} {...props} {...p} />
    </Profiler>
  );
  const utils = await render(ui({}));
  return {
    ...utils,
    ref,
    commits,
    rerender: (p: Partial<CanvasProps>) => utils.rerender(ui(p)),
  };
}

// ----------------------------------------------------------------------------------------------

describe("Star Swarm GameCanvas (native) — mount and HUD", () => {
  it("renders the labelled Skia canvas and the HUD from a seeded state", async () => {
    await mount({ initialState: seeded({ score: 120, wave: 3 }), highScore: 500 });
    expect(screen.getByTestId("skia-canvas").props.accessibilityLabel).toMatch(/Star Swarm game/);
    expect(screen.getByText("SCORE 120")).toBeTruthy();
    expect(screen.getByText("BEST 500")).toBeTruthy();
    expect(screen.getByText("WAVE 3")).toBeTruthy();
    expect(screen.getByText("Lieutenant J.G. ×1.5")).toBeTruthy();
    expect(screen.getByText("GUNS L1 · HULL –")).toBeTruthy();
    // A restored session skips the pre-wave countdown.
    expect(screen.queryByText("3")).toBeNull();
  });

  it("seeds the Picture with the first frame and draws it through drawFrame", async () => {
    const state = seeded();
    await mount({ initialState: state });
    expect(mockBuildFrame).toHaveBeenCalled();
    expect(mockBuildFrame.mock.calls[0][0]).toBe(state);
    expect(mockDrawFrame).toHaveBeenCalled();
  });

  it("best shows the live score once it beats the stored high score", async () => {
    await mount({ initialState: seeded({ score: 900 }), highScore: 500 });
    expect(screen.getByText("BEST 900")).toBeTruthy();
  });

  it("shows the shield / lightning indicator for an active duration power-up", async () => {
    const pu = { remainingMs: 2500, shieldAbsorbed: 0 };
    const { unmount } = await mount({
      initialState: seeded({ activePowerUp: { ...pu, type: "shield" } }),
    });
    expect(screen.getByText("SHIELD")).toBeTruthy();
    await unmount();
    await mount({ initialState: seeded({ activePowerUp: { ...pu, type: "lightning" } }) });
    expect(screen.getByText("LIGHTNING")).toBeTruthy();
    expect(screen.queryByText("SHIELD")).toBeNull();
  });

  it("shows the ROUT!, CARRIER SIGHTED and MISSION COMPLETE banners from the state", async () => {
    mockEngine.fleeingCount!.mockReturnValue(2);
    const { unmount } = await mount({ initialState: seeded() });
    expect(screen.getByText("ROUT!")).toBeTruthy();
    await unmount();
    mockEngine.fleeingCount!.mockImplementation(actualEngine.fleeingCount);

    const boss = await mount({ initialState: seeded({ wave: 5, phase: "SwoopIn" }) });
    expect(screen.getByText("CARRIER SIGHTED")).toBeTruthy();
    await boss.unmount();

    mockEngine.showMissionCompleteBanner!.mockReturnValue(true);
    await mount({ initialState: seeded() });
    expect(screen.getByText("MISSION COMPLETE")).toBeTruthy();
  });
});

describe("Star Swarm GameCanvas (native) — frame publish gating (#2563)", () => {
  it("publishes every frame the engine state moves, without re-rendering React", async () => {
    const { commits } = await mount({ initialState: seeded() });
    await frame(); // first frame: dt 0
    mockBuildFrame.mockClear();
    const before = commits.count;
    for (let i = 0; i < 5; i++) {
      nextTick((s) => ({ ...s, nextDiveTimer: s.nextDiveTimer - 1 }));
      await frame();
    }
    expect(mockBuildFrame).toHaveBeenCalledTimes(5);
    // Nothing on the HUD changed, so React never committed.
    expect(commits.count).toBe(before);
  });

  it("#2963: a frame where only the starfield moved publishes nothing — it scrolls on its own", async () => {
    const { commits } = await mount({ initialState: seeded() });
    await frame();
    mockBuildFrame.mockClear();
    const before = commits.count;
    await frames(5); // ticks are the identity here: only the stars move
    expect(mockBuildFrame).not.toHaveBeenCalled();
    expect(commits.count).toBe(before);
  });

  it("a paused game neither ticks nor publishes", async () => {
    const { rerender } = await mount({ initialState: seeded() });
    await frames(2);
    await rerender({ isPaused: true });
    await frame(); // settles: nothing moved since the last publish
    mockTick.mockClear();
    mockBuildFrame.mockClear();
    await frames(10);
    expect(mockTick).not.toHaveBeenCalled();
    expect(mockBuildFrame).not.toHaveBeenCalled();
  });

  it("a game-over freeze frame neither ticks nor publishes", async () => {
    const { commits } = await mount({ initialState: seeded({ phase: "GameOver" }) });
    await frame();
    mockBuildFrame.mockClear();
    const before = commits.count;
    await frames(10);
    expect(mockTick).not.toHaveBeenCalled();
    expect(mockBuildFrame).not.toHaveBeenCalled();
    expect(commits.count).toBe(before);
  });

  it("republishes a paused frame when a dev-panel injection changes the state", async () => {
    const { ref } = await mount({ initialState: seeded(), isPaused: true });
    await frames(2);
    mockBuildFrame.mockClear();
    ref.current!.triggerPowerUp("shield");
    await frame();
    expect(mockEngine.applyPowerUp).toHaveBeenCalledWith(expect.anything(), "shield");
    expect(mockBuildFrame).toHaveBeenCalledTimes(1);
    expect(screen.getByText("SHIELD")).toBeTruthy();
  });

  it("republishes when a sprite finishes loading, even while paused", async () => {
    const { rerender } = await mount({ initialState: seeded(), isPaused: true });
    mockBuildFrame.mockClear();
    mockUseImage.mockReturnValue({ width: 8, height: 8 });
    await rerender({ isPaused: true });
    expect(mockBuildFrame).toHaveBeenCalled();
    const lastOpts = mockBuildFrame.mock.calls.at(-1)![1];
    expect(lastOpts.loaded.playerShip).toBe(true);
    expect(lastOpts.loaded.explosion.every(Boolean)).toBe(true);
  });

  it("reports a renderer throw to Sentry once, on the JS thread", async () => {
    mockDrawFrame.mockImplementation(() => {
      throw new Error("boom");
    });
    const { rerender } = await mount({ initialState: seeded() });
    // Every render re-records the Picture (the Reanimated mock runs useDerivedValue inline), and
    // HUD commits re-render too: the renderer keeps throwing, the report goes out once.
    for (let score = 1; score <= 3; score++) {
      nextTick((s) => ({ ...s, score }));
      await frame();
    }
    await rerender({ highScore: 9999 });
    expect(mockDrawFrame.mock.calls.length).toBeGreaterThan(2);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "starswarm.drawFrame: Error: boom",
      expect.objectContaining({ tags: { subsystem: "starswarm.render" } })
    );
  });
});

describe("Star Swarm GameCanvas (native) — starfield (#2963)", () => {
  const PICTURES_PER_STARFIELD = 4; // the background and the three depth layers
  /** The layer offsets, read off the StarLayer groups' derived transforms. */
  const layerOffsets = () =>
    screen
      .getAllByTestId("skia-group")
      .map((g) => g.props.transform as { value?: { translateY: number }[] } | undefined)
      .filter((t) => t && "value" in t)
      .map((t) => t!.value![0]!.translateY);

  it("records the starfield once, not per frame, and slides each layer by its own offset", async () => {
    const mockCreatePicture = createPicture as unknown as jest.Mock;
    mockCreatePicture.mockClear();
    const { rerender } = await mount({ initialState: seeded() });
    // the scene Picture, plus the background and the three depth layers
    expect(mockCreatePicture).toHaveBeenCalledTimes(1 + PICTURES_PER_STARFIELD);
    expect(layerOffsets()).toEqual([0, 0, 0]);
    await frame(); // dt 0
    await frames(10); // 160 ms of scrolling
    mockCreatePicture.mockClear();
    await rerender({ highScore: 1 }); // the test Reanimated derives values at render
    // only the scene Picture is re-recorded (the mock derives it inline on every render)
    expect(mockCreatePicture).toHaveBeenCalledTimes(1);
    // far, mid and near layers at 0.02, 0.05 and 0.1 px/ms
    const [far, mid, near] = layerOffsets();
    expect(far).toBeCloseTo(160 * 0.02);
    expect(mid).toBeCloseTo(160 * 0.05);
    expect(near).toBeCloseTo(160 * 0.1);
  });

  it("holds still while paused, and a new game scrolls from the top again", async () => {
    const { rerender } = await mount({ initialState: seeded(), resetTick: 0 });
    await frame();
    await frames(5);
    await rerender({ isPaused: true });
    const paused = layerOffsets();
    expect(paused[2]).toBeGreaterThan(0);
    await frames(5);
    await rerender({ isPaused: true, highScore: 2 });
    expect(layerOffsets()).toEqual(paused);
    await rerender({ isPaused: false, resetTick: 1 });
    await rerender({ isPaused: false, resetTick: 1, highScore: 3 });
    expect(layerOffsets()).toEqual([0, 0, 0]);
  });
});

describe("Star Swarm GameCanvas (native) — HUD commits (#2566)", () => {
  it("commits to React when the score changes, and reports it", async () => {
    const onScoreChange = jest.fn();
    const { commits } = await mount({ initialState: seeded(), onScoreChange });
    await frame();
    const before = commits.count;
    nextTick((s) => ({ ...s, score: s.score + 50 }));
    await frame();
    expect(onScoreChange).toHaveBeenCalledWith(50);
    expect(screen.getByText("SCORE 50")).toBeTruthy();
    expect(commits.count).toBeGreaterThan(before);
    // A tick that changes nothing visible on the HUD costs no commit.
    const after = commits.count;
    nextTick((s) => ({ ...s, player: { ...s.player, x: s.player.x + 3 } }));
    await frame();
    expect(commits.count).toBe(after);
    expect(onScoreChange).toHaveBeenCalledTimes(1);
  });

  it("shows the hull ladder and the pickup cue toast on an upgrade", async () => {
    const onUpgrade = jest.fn();
    await mount({ initialState: seeded(), onUpgrade });
    await frame();
    nextTick((s) => ({ ...s, player: { ...s.player, hull: 1 } }));
    await frame();
    expect(onUpgrade).toHaveBeenCalledWith({ kind: "hullUp", guns: 1, hull: 1 });
    expect(screen.getByText("GUNS L1 · HULL ◆")).toBeTruthy();
    // Spoken through onUpgrade instead, so the toast is hidden from screen readers.
    expect(screen.queryByTestId("starswarm-pickup-cue")).toBeNull();
    expect(
      screen.getByTestId("starswarm-pickup-cue", { includeHiddenElements: true })
    ).toHaveTextContent("HULL +1");
  });

  it("announces a maxed pickup (no upgrade event fires for it)", async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    await mount({ initialState: seeded() });
    await frame();
    mockPickupCues.mockReturnValueOnce([{ kind: "guns", max: true, level: 3 }]);
    nextTick((s) => ({ ...s, score: s.score + 1 }));
    await frame();
    expect(announce).toHaveBeenCalledWith("GUNS MAX");
    expect(
      screen.getByTestId("starswarm-pickup-cue", { includeHiddenElements: true })
    ).toHaveTextContent("GUNS MAX");
  });

  it("flashes 1UP on a bonus life until the flash expires", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(50_000);
    const onBonusLife = jest.fn();
    await mount({ initialState: seeded(), onBonusLife });
    await frame();
    nextTick((s) => ({ ...s, bonusLivesAwarded: s.bonusLivesAwarded + 1 }));
    await frame();
    expect(onBonusLife).toHaveBeenCalledTimes(1);
    expect(screen.getByText("1UP")).toBeTruthy();
    now.mockReturnValue(52_000);
    await frame();
    expect(screen.queryByText("1UP")).toBeNull();
  });
});

describe("Star Swarm GameCanvas (native) — pause / resume and the countdown", () => {
  it("resumes without a delta spike: the first tick after resume has dt 0", async () => {
    const { rerender } = await mount({ initialState: seeded() });
    await frames(2);
    await rerender({ isPaused: true });
    await frame(5000);
    mockTick.mockClear();
    await rerender({ isPaused: false });
    await frame(5000);
    expect(mockTick).toHaveBeenCalledTimes(1);
    expect(mockTick.mock.calls[0][1]).toBe(0);
    await frame(100);
    // ...and long frames are capped so the engine never jumps.
    expect(mockTick.mock.calls[1][1]).toBe(33);
  });

  it("a new game counts down 3-2-1 with the engine frozen, then starts ticking", async () => {
    await mount();
    expect(screen.getByText("3")).toBeTruthy();
    await frame(); // dt 0
    await frames(31, 33); // 1023 ms
    expect(screen.getByText("2")).toBeTruthy();
    expect(mockTick).not.toHaveBeenCalled();
    await frames(62, 33); // past 3000 ms
    expect(screen.queryByText("1")).toBeNull();
    await frame();
    expect(mockTick).toHaveBeenCalled();
  });

  it("a wave start re-arms the countdown with the wave banner and decays the mission timer", async () => {
    const onBossWave = jest.fn();
    const { ref } = await mount({ initialState: seeded({ wave: 4 }), onBossWave });
    await frame();
    nextTick((s) => ({ ...s, wave: 5, phase: "SwoopIn", missionCompleteTimer: 600 }));
    await frame();
    expect(onBossWave).toHaveBeenCalledTimes(1);
    expect(screen.getByText("— WAVE 5 —")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    mockTick.mockClear();
    await frames(3, 33);
    expect(mockTick).not.toHaveBeenCalled();
    expect(ref.current!.getState().missionCompleteTimer).toBeLessThan(600);
  });
});

describe("Star Swarm GameCanvas (native) — devOptions and reset", () => {
  it("reads devOptions through the ref on every tick, without a reset", async () => {
    const { rerender } = await mount({ initialState: seeded() });
    await frame();
    await rerender({
      devOptions: {
        pauseStraggler: true,
        playerFireDisabled: true,
        enemyFireDisabled: true,
        asteroidsDisabled: true,
        dodgeDisabled: true,
        flakDisabled: true,
        routDisabled: true,
      },
    });
    mockTick.mockClear();
    await frame();
    const input = mockTick.mock.calls[0][0] as StarSwarmState;
    expect(input).toMatchObject({
      pauseStraggler: true,
      playerFireDisabled: true,
      enemyFireDisabled: true,
      asteroidsDisabled: true,
      dodgeDisabled: true,
      flakDisabled: true,
      routDisabled: true,
    });
  });

  it("resetTick starts a new game from the dev options and announces a boss wave", async () => {
    const onBossWave = jest.fn();
    const { ref, rerender } = await mount({ initialState: seeded({ score: 900 }), onBossWave });
    await frame();
    await rerender({
      resetTick: 1,
      difficulty: "Ensign",
      devOptions: { wave: 5, difficulty: "Captain", stragglerEnabled: true },
    });
    expect(mockEngine.initStarSwarm).toHaveBeenLastCalledWith(
      W,
      H,
      5,
      expect.any(Number),
      "Captain",
      true
    );
    const state = ref.current!.getState();
    expect(state.wave).toBe(5);
    expect(state.difficulty).toBe("Captain");
    expect(onBossWave).toHaveBeenCalledTimes(1);
    expect(screen.getByText("SCORE 0")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(ref.current!.getPlayerX()).toBe(W / 2);
  });

  it("resetTick without dev options uses the difficulty prop", async () => {
    const { ref, rerender } = await mount({ initialState: seeded() });
    await rerender({ resetTick: 2, difficulty: "Commander" });
    expect(ref.current!.getState().difficulty).toBe("Commander");
    expect(ref.current!.getState().wave).toBe(1);
  });

  it("infinite lives undoes a lost life and the game over it caused", async () => {
    const onPlayerHit = jest.fn();
    const onGameOver = jest.fn();
    const { ref, rerender } = await mount({ onPlayerHit, onGameOver });
    await rerender({ resetTick: 1, devOptions: { infiniteLives: true } });
    await frame();
    await frames(95, 33); // run out the countdown
    const lives = ref.current!.getState().player.lives;
    nextTick((s) => ({ ...s, phase: "GameOver", player: { ...s.player, lives: lives - 1 } }));
    await frame();
    const state = ref.current!.getState();
    expect(state.player.lives).toBe(lives);
    expect(state.player.invincibleTimer).toBe(2000);
    expect(state.phase).not.toBe("GameOver");
    expect(onGameOver).not.toHaveBeenCalled();
    expect(onPlayerHit).not.toHaveBeenCalled();
  });
});

describe("Star Swarm GameCanvas (native) — engine-event callbacks", () => {
  it("reports a hit, an explosion, a power-up and a laser shot", async () => {
    const cb = {
      onPlayerHit: jest.fn(),
      onExplosion: jest.fn(),
      onPowerUpCollect: jest.fn(),
      onLaserFire: jest.fn(),
    };
    await mount({ initialState: seeded(), ...cb });
    await frame();
    nextTick((s) => ({ ...s, player: { ...s.player, lives: s.player.lives - 1 } }));
    await frame();
    expect(cb.onPlayerHit).toHaveBeenCalledTimes(1);

    nextTick((s) => ({
      ...s,
      explosions: [...s.explosions, { id: 1 } as unknown as StarSwarmState["explosions"][number]],
    }));
    await frame();
    expect(cb.onExplosion).toHaveBeenCalledTimes(1);

    nextTick((s) => ({
      ...s,
      activePowerUp: { type: "lightning", remainingMs: 4000, shieldAbsorbed: 0 },
    }));
    await frame();
    expect(cb.onPowerUpCollect).toHaveBeenCalledWith("lightning");

    nextTick((s) => ({ ...s, player: { ...s.player, shootCooldown: 200 } }));
    await frame();
    expect(cb.onLaserFire).toHaveBeenCalledTimes(1);
  });

  it("forwards every Carrier event, the rout, a lost Buddy and a wave clear", async () => {
    const cb = {
      onCarrierExposed: jest.fn(),
      onCarrierEvent: jest.fn(),
      onRout: jest.fn(),
      onBuddyLost: jest.fn(),
      onWaveClear: jest.fn(),
    };
    await mount({ initialState: seeded(), ...cb });
    await frame();
    for (const fn of [
      "carrierJustExposed",
      "carrierBeamJustStarted",
      "carrierBeamJustFired",
      "reinforcementsJustLaunched",
      "carrierAttackRunJustStarted",
      "carrierFinalStandJustStarted",
      "routJustStarted",
      "buddyJustLost",
    ]) {
      mockEngine[fn]!.mockReturnValueOnce(true);
    }
    mockEngine.fleeingCount!.mockReturnValueOnce(4);
    nextTick((s) => ({ ...s, phase: "Extraction", player: { ...s.player, x: 40 } }));
    await frame();
    expect(cb.onCarrierExposed).toHaveBeenCalledTimes(1);
    expect(cb.onCarrierEvent.mock.calls.map((c) => c[0])).toEqual([
      "beamCharge",
      "beamFire",
      "reinforce",
      "attackRun",
      "finalStand",
    ]);
    expect(cb.onRout).toHaveBeenCalledWith(4);
    expect(cb.onBuddyLost).toHaveBeenCalledTimes(1);
    expect(cb.onWaveClear).toHaveBeenCalledTimes(1);
  });

  it("follows the autopilot: the drag anchor tracks the ship during extraction", async () => {
    const { ref } = await mount({ initialState: seeded() });
    await frame();
    nextTick((s) => ({ ...s, phase: "Extraction", player: { ...s.player, x: 77 } }));
    await frame();
    expect(ref.current!.getPlayerX()).toBe(77);
  });

  it("calls onGameOver once, with the final score and wave, then freezes", async () => {
    const onGameOver = jest.fn();
    const onPlayerHit = jest.fn();
    await mount({ initialState: seeded({ wave: 2 }), onGameOver, onPlayerHit });
    await frame();
    nextTick((s) => ({
      ...s,
      score: 4321,
      phase: "GameOver",
      player: { ...s.player, lives: 0 },
    }));
    await frame();
    expect(onGameOver).toHaveBeenCalledWith(4321, 2);
    // The last life lost is the game over itself, not a hit.
    expect(onPlayerHit).not.toHaveBeenCalled();
    mockBuildFrame.mockClear();
    mockTick.mockClear();
    await frames(5);
    expect(onGameOver).toHaveBeenCalledTimes(1);
    expect(mockTick).not.toHaveBeenCalled();
    expect(mockBuildFrame).not.toHaveBeenCalled();
  });

  it("reports a tick that throws and keeps the loop alive", async () => {
    await mount({ initialState: seeded() });
    await frame();
    mockTick.mockImplementationOnce(() => {
      throw new Error("tick failed");
    });
    await frame();
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { subsystem: "starswarm.loop" },
    });
    await frame();
    expect(raf.hasPendingFrame()).toBe(true);
  });

  it("uses the latest callback props without restarting the loop", async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = await mount({ initialState: seeded(), onScoreChange: first });
    await frame();
    await rerender({ onScoreChange: second });
    nextTick((s) => ({ ...s, score: 10 }));
    await frame();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(10);
    // One requestAnimationFrame chain for the component's lifetime.
    expect(global.requestAnimationFrame).toHaveBeenCalledTimes(3);
  });
});

describe("Star Swarm GameCanvas (native) — imperative handle", () => {
  it("clamps getPlayerX to the play field and feeds setPlayerX / setFire to the tick", async () => {
    const { ref } = await mount({ initialState: seeded() });
    const hw = actualEngine.PLAYER_W / 2;
    ref.current!.setPlayerX(-50);
    expect(ref.current!.getPlayerX()).toBe(hw);
    ref.current!.setPlayerX(9999);
    expect(ref.current!.getPlayerX()).toBe(W - hw);
    ref.current!.setPlayerX(123);
    ref.current!.setFire(false);
    await frame();
    expect(mockTick.mock.calls[0][2]).toEqual({ playerX: 123, fire: false });
  });

  it("applies throwAsteroid and killEscorts once each, on the next frame", async () => {
    const { ref } = await mount({ initialState: seeded() });
    ref.current!.throwAsteroid();
    ref.current!.killEscorts();
    await frame();
    await frame();
    expect(mockEngine.throwAsteroid).toHaveBeenCalledTimes(1);
    expect(mockEngine.killEscorts).toHaveBeenCalledTimes(1);
  });

  it("returns the live state and a frame-stats summary", async () => {
    const state = seeded({ score: 7 });
    const { ref } = await mount({ initialState: state });
    expect(ref.current!.getState()).toBe(state);
    // RN hands RAF the performance.now() clock; the readout's window is measured on it too.
    jest.spyOn(performance, "now").mockImplementation(() => raf.now());
    await frames(3);
    expect(ref.current!.getFrameStats()).toEqual(
      expect.objectContaining({ avgMs: 16, p95Ms: 16, frames: expect.any(Number) })
    );
  });

  it("stops its frame loop on unmount", async () => {
    const { unmount } = await mount({ initialState: seeded() });
    expect(raf.hasPendingFrame()).toBe(true);
    await unmount();
    expect(global.cancelAnimationFrame).toHaveBeenCalled();
    expect(raf.hasPendingFrame()).toBe(false);
  });
});

describe("Star Swarm GameCanvas (native) — the real engine", () => {
  it("plays 120 frames of a seeded game and publishes each one", async () => {
    mockTick.mockImplementation(actualEngine.tick);
    const onGameOver = jest.fn();
    const { ref } = await mount({ initialState: seeded(), onGameOver });
    mockBuildFrame.mockClear();
    await frames(120);
    expect(mockTick).toHaveBeenCalledTimes(120);
    expect(mockBuildFrame).toHaveBeenCalledTimes(120);
    expect(ref.current!.getState().phase).not.toBe("GameOver");
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
