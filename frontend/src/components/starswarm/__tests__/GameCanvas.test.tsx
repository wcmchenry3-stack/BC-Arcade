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
import { AccessibilityInfo, StyleSheet } from "react-native";
import { render, screen, within } from "@testing-library/react-native";
import * as Sentry from "@sentry/react-native";
import { Skia, createPicture, useImage } from "@shopify/react-native-skia";

import GameCanvas from "../GameCanvas";
import type { GameCanvasHandle } from "../GameCanvas";
import * as engine from "../../../game/starswarm/engine";
import { buildFrame } from "../../../game/starswarm/render/frame";
import { drawFrame } from "../../../game/starswarm/render/drawFrame";
import { collectCueTop, pickupCues } from "../../../game/starswarm/render/pickupCue";
import {
  HUD_CHIP_COLOR,
  HUD_LAYOUT,
  HUD_MAX_FONT_SCALE,
  HUD_TEXT,
} from "../../../game/starswarm/render/hudStyle";
import { typography } from "../../../theme/typography";
import * as hudStyle from "../../../game/starswarm/render/hudStyle";
import type { StarSwarmState } from "../../../game/starswarm/types";
import { nebulaBlobs } from "../../../game/starswarm/render/nebula";
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
      return { size, dispose: () => {} };
    }),
    Skia: {
      Paint: () => ({
        setAntiAlias: () => {},
        setColor: () => {},
        setShader: () => {},
        dispose: () => {},
      }),
      Color: (c: number) => c,
      Shader: { MakeRadialGradient: jest.fn(() => ({ dispose: () => {} })) }, // #3597: the nebula in the backdrop
    },
    TileMode: { Clamp: 0 },
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
    // #3598: caption over numeral; screen readers still hear "SCORE 120" etc. as one element
    expect(screen.getByLabelText("SCORE 120")).toHaveTextContent("SCORE120");
    expect(screen.getByLabelText("BEST 500")).toHaveTextContent("BEST500");
    expect(screen.getByLabelText("WAVE 3")).toHaveTextContent("WAVE3");
    expect(screen.getByText("Lieutenant J.G. ×1.5")).toBeTruthy();
    expect(screen.getByText("GUNS L1")).toBeTruthy();
    expect(screen.getByText("HULL 0")).toBeTruthy();
    // A restored session skips the pre-wave countdown.
    expect(screen.queryByTestId("starswarm-countdown")).toBeNull();
  });

  it("#3598: the HUD is in the brand fonts, from the shared HUD styles", async () => {
    await mount({ initialState: seeded({ score: 120, wave: 3 }), highScore: 500 });
    const font = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style);
    expect(font("SCORE").fontFamily).toBe(typography.label);
    expect(font("120").fontFamily).toBe(typography.heading);
    expect(font("120").textShadowColor).toBe(HUD_TEXT.numeral.glow);
    expect(font("500").fontFamily).toBe(typography.headingLight);
    expect(font("Lieutenant J.G. ×1.5").fontFamily).toBe(typography.bodyMedium);
    expect(font("GUNS L1").fontFamily).toBe(typography.label);
    expect(font("3").fontFamily).toBe(typography.heading);
    for (const t of ["SCORE", "120", "500", "3", "GUNS L1", "HULL 0"]) {
      expect(font(t).fontWeight).toBeUndefined();
      expect(font(t).fontSize).toBeGreaterThanOrEqual(8);
      // font scaling allowed, capped so the HUD stays on one line
      expect(screen.getByText(t).props.maxFontSizeMultiplier).toBe(HUD_MAX_FONT_SCALE);
      expect(screen.getByText(t).props.numberOfLines).toBe(1);
    }
  });

  it("#3598 (owner): score and best are grouped and read naturally to screen readers", async () => {
    await mount({ initialState: seeded({ score: 12450 }), highScore: 48200 });
    expect(screen.getByTestId("starswarm-hud-score")).toHaveTextContent("12,450");
    expect(screen.getByTestId("starswarm-hud-best")).toHaveTextContent("48,200");
    // the same helper the web canvas draws with
    expect(screen.getByTestId("starswarm-hud-score")).toHaveTextContent(
      hudStyle.formatHudNumber(12450, "en")
    );
    expect(screen.getByLabelText("SCORE 12,450")).toBeTruthy();
    expect(screen.getByLabelText("BEST 48,200")).toBeTruthy();
    // the widest score shrinks to fit its column rather than truncating
    expect(screen.getByTestId("starswarm-hud-score").props.adjustsFontSizeToFit).toBe(true);
  });

  it("#3598 (owner): formats only when the HUD commits a new number, never per frame", async () => {
    const spy = jest.spyOn(hudStyle, "formatHudNumber");
    try {
      await mount({ initialState: seeded({ score: 300 }) });
      await frame();
      const settled = spy.mock.calls.length;
      for (let i = 0; i < 10; i++) {
        nextTick((s) => ({ ...s, player: { ...s.player, x: s.player.x + 1 } }));
        await frame();
      }
      expect(spy.mock.calls.length).toBe(settled);
      nextTick((s) => ({ ...s, score: s.score + 100 }));
      await frame();
      expect(spy.mock.calls.length).toBeGreaterThan(settled);
      expect(screen.getByTestId("starswarm-hud-score")).toHaveTextContent("400");
    } finally {
      spy.mockRestore();
    }
  });

  it("#3598: the GUNS and HULL chips stack in the left column, cyan over plating blue", async () => {
    await mount({ initialState: seeded() });
    const chips = screen.getByTestId("starswarm-hud-chips");
    expect(StyleSheet.flatten(chips.props.style).flexDirection).toBeUndefined(); // a column
    const [guns, hull] = chips.children as unknown as { props: { style: unknown } }[];
    const g = StyleSheet.flatten(guns!.props.style as never) as Record<string, unknown>;
    const h = StyleSheet.flatten(hull!.props.style as never) as Record<string, unknown>;
    expect(g.borderColor).toBe(HUD_CHIP_COLOR.guns);
    expect(h.borderColor).toBe(HUD_CHIP_COLOR.hull);
    expect(h.marginTop).toBe(HUD_LAYOUT.chipGap);
    expect(g.height).toBe(HUD_LAYOUT.chipHeight);
    expect(StyleSheet.flatten(screen.getByText("GUNS L1").props.style).color).toBe(
      HUD_CHIP_COLOR.guns
    );
  });

  it("#3598: the top bar is inset by the shared margins (not mirrored in RTL)", async () => {
    await mount({ initialState: seeded() });
    const bar = StyleSheet.flatten(screen.getByTestId("starswarm-hud-top").props.style);
    expect(bar.top).toBe(HUD_LAYOUT.top);
    expect(bar.left).toBe(HUD_LAYOUT.marginX);
    expect(bar.right).toBe(HUD_LAYOUT.marginX);
    expect(bar.flexDirection).toBe("row");
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
    expect(screen.getByLabelText("BEST 900")).toBeTruthy();
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

  it("#3476/#3598: the power-up timer sits under the lives, in the top-right column", async () => {
    await mount({
      initialState: seeded({
        activePowerUp: { type: "shield", remainingMs: 2500, shieldAbsorbed: 0 },
      }),
    });
    const bar = screen.getByTestId("starswarm-hud-top");
    expect(StyleSheet.flatten(bar.props.style).bottom).toBeUndefined();
    // the top bar holds the lives and, after them in the same right column, the timer
    expect(within(bar).getByTestId("starswarm-lives")).toBeTruthy();
    expect(within(bar).getByTestId("starswarm-powerup")).toBeTruthy();
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf('"starswarm-powerup"')).toBeGreaterThan(tree.indexOf('"starswarm-lives"'));
    expect(tree.indexOf('"starswarm-lives"')).toBeGreaterThan(tree.indexOf("WAVE 1"));
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

describe("Star Swarm GameCanvas (native) — lives row placement (#2150, #3598)", () => {
  it("flows under the wave number, so a large font scale moves it down with no measuring", async () => {
    await mount({ initialState: seeded({ score: 1 }) });
    const lives = screen.getByTestId("starswarm-lives");
    const style = StyleSheet.flatten(lives.props.style);
    expect(style.position).toBeUndefined();
    expect(style.top).toBeUndefined();
    expect(style.alignSelf).toBe("flex-end");
    expect(screen.getAllByTestId("starswarm-life")).toHaveLength(3);
  });
});

describe("Star Swarm GameCanvas (native) — collect-the-power-ups cue (#3187)", () => {
  const pickup = {
    id: 9001,
    type: "shield" as const,
    x: 100,
    y: 200,
    vy: 0.05,
    width: 20,
    height: 20,
    despawnTimer: 5000,
  };
  const waiting = () =>
    seeded({ enemies: [], phase: "ClearAwaitingPickups" as const, powerUps: [pickup] });
  const cueId = "starswarm-collect-powerups-cue";

  it("shows the cue, with its accessible label, while pickups hold the cleared wave", async () => {
    await mount({ initialState: waiting() });
    expect(screen.getByText("QUICK, GRAB 'EM — THEY CARRY OVER!")).toBeTruthy(); // #3512
    expect(screen.getByTestId(cueId).props.accessibilityLabel).toMatch(
      /Collect the remaining power-ups/
    );
  });

  it("stays on one line, shrinking to fit rather than wrapping", async () => {
    await mount({ initialState: waiting() });
    const cue = screen.getByTestId(cueId);
    expect(cue.props.numberOfLines).toBe(1);
    expect(cue.props.adjustsFontSizeToFit).toBe(true);
    expect(cue.props.minimumFontScale).toBeGreaterThan(0);
  });

  it.each([320, 480, 640])(
    "engine height 640 shown at %i dp (as StarSwarmScreen does): below the toast zone, clear of the banner",
    async (displayH) => {
      await mount({ initialState: waiting(), height: 640, scale: displayH / 640 });
      const wrap = screen.getByTestId(cueId).parent!;
      const top = StyleSheet.flatten(wrap.props.style).top as number;
      expect(top).toBeGreaterThanOrEqual(105);
      expect(top + 22).toBeLessThanOrEqual(displayH / 2 - 14);
    }
  );

  it("shows nothing during normal play or at game over", async () => {
    const play = await mount({ initialState: seeded({ powerUps: [pickup] }) });
    expect(screen.queryByTestId(cueId)).toBeNull();
    await play.unmount();
    await mount({ initialState: { ...waiting(), phase: "GameOver" } });
    expect(screen.queryByTestId(cueId)).toBeNull();
  });

  it("appears when the last enemy dies with a pickup out and goes when it is gone", async () => {
    await mount({ initialState: seeded({ powerUps: [pickup] }) });
    await frame();
    expect(screen.queryByTestId(cueId)).toBeNull();
    nextTick((s) => ({ ...s, enemies: [], phase: "ClearAwaitingPickups" }));
    await frame();
    expect(screen.getByTestId(cueId)).toBeTruthy();
    nextTick((s) => ({ ...s, powerUps: [], phase: "Extraction" }));
    await frame();
    expect(screen.queryByTestId(cueId)).toBeNull();
  });

  it("speaks the cue once as it appears", async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    announce.mockClear(); // the RN jest mock keeps calls made by earlier tests
    await mount({ initialState: waiting() });
    await frame();
    await frame();
    const spoken = announce.mock.calls.filter(([m]) => /power-ups/.test(String(m)));
    expect(spoken).toHaveLength(1);
  });
});

describe("Star Swarm GameCanvas (native) — crack-the-asteroid cue (#3568)", () => {
  const rock = {
    id: 9100,
    kind: "large" as const,
    x: 60,
    y: 120,
    vx: 0,
    vy: 0.05,
    radius: 22,
    hp: 6,
    rotation: 0,
    spin: 0,
    hitFlashTimer: 0,
    hitEnemyIds: [],
  };
  const pickup = {
    id: 9001,
    type: "shield" as const,
    x: 100,
    y: 200,
    vy: 0.05,
    width: 20,
    height: 20,
    despawnTimer: 5000,
  };
  const rockOnly = () =>
    seeded({ enemies: [], phase: "ClearAwaitingPickups" as const, asteroids: [rock] });
  const crackId = "starswarm-crack-asteroids-cue";
  const collectId = "starswarm-collect-powerups-cue";

  it("shows the crack line, with its accessible label, while only a rock holds the wave", async () => {
    await mount({ initialState: rockOnly() });
    expect(screen.getByText("CRACK IT FOR SALVAGE!")).toBeTruthy();
    expect(screen.getByTestId(crackId).props.accessibilityLabel).toMatch(/crack it open/);
    expect(screen.queryByTestId(collectId)).toBeNull();
  });

  it("sits in the collect cue's slot and stays on one line", async () => {
    await mount({ initialState: rockOnly(), height: 640, scale: 1 });
    const cue = screen.getByTestId(crackId);
    expect(cue.props.numberOfLines).toBe(1);
    expect(cue.props.adjustsFontSizeToFit).toBe(true);
    const top = StyleSheet.flatten(cue.parent!.props.style).top as number;
    expect(top).toBe(collectCueTop(640));
  });

  it("the pickup cue wins when a pickup is out too", async () => {
    await mount({ initialState: { ...rockOnly(), powerUps: [pickup] } });
    expect(screen.getByTestId(collectId)).toBeTruthy();
    expect(screen.queryByTestId(crackId)).toBeNull();
  });

  it("shows nothing in normal play, in the extraction or at game over", async () => {
    const play = await mount({ initialState: seeded({ asteroids: [rock] }) });
    expect(screen.queryByTestId(crackId)).toBeNull();
    await play.unmount();
    const ex = await mount({ initialState: { ...rockOnly(), phase: "Extraction" } });
    expect(screen.queryByTestId(crackId)).toBeNull();
    await ex.unmount();
    await mount({ initialState: { ...rockOnly(), phase: "GameOver" } });
    expect(screen.queryByTestId(crackId)).toBeNull();
  });

  it("swaps with the pickup cue as pickups arrive and leave", async () => {
    await mount({ initialState: rockOnly() });
    await frame();
    expect(screen.getByTestId(crackId)).toBeTruthy();
    nextTick((s) => ({ ...s, powerUps: [pickup] }));
    await frame();
    expect(screen.queryByTestId(crackId)).toBeNull();
    expect(screen.getByTestId(collectId)).toBeTruthy();
    nextTick((s) => ({ ...s, powerUps: [] }));
    await frame();
    expect(screen.getByTestId(crackId)).toBeTruthy();
  });

  it("speaks the cue once as it appears", async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    announce.mockClear();
    await mount({ initialState: rockOnly() });
    await frame();
    await frame();
    const spoken = announce.mock.calls.filter(([m]) => /crack it open/.test(String(m)));
    expect(spoken).toHaveLength(1);
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
    expect(lastOpts.loaded.p1Base).toBe(true);
    expect(lastOpts.loaded.p1Plating2).toBe(true);
  });

  it("#3600: builds the frame with the chosen ship, the default when none is given", async () => {
    const { rerender } = await mount({ initialState: seeded(), isPaused: true });
    expect(mockBuildFrame.mock.calls.at(-1)![1].ship).toBe("p1");
    mockBuildFrame.mockClear();
    // no resetTick and no frame change: only the ship prop republishes the picture
    await rerender({ initialState: seeded(), isPaused: true, ship: "p3" });
    expect(mockBuildFrame).toHaveBeenCalled();
    expect(mockBuildFrame.mock.calls.at(-1)![1].ship).toBe("p3");
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

  it("#3597: bakes the nebula into the background once, never per frame", async () => {
    const gradients = Skia.Shader.MakeRadialGradient as unknown as jest.Mock;
    gradients.mockClear();
    const { rerender } = await mount({ initialState: seeded() });
    const blobs = nebulaBlobs(W, H).length;
    expect(gradients).toHaveBeenCalledTimes(blobs);
    mockTick.mockImplementation(actualEngine.tick);
    await frames(60);
    await rerender({ highScore: 1 });
    await frames(60);
    expect(gradients).toHaveBeenCalledTimes(blobs);
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
    expect(screen.getByLabelText("SCORE 50")).toBeTruthy();
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
    expect(screen.getByText("HULL 1")).toBeTruthy();
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

  it("#3512: shows NEXT WAVE when a power-up is banked, UP! when it applies; each spoken once", async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    announce.mockClear();
    const { commits } = await mount({
      initialState: seeded({ phase: "ClearAwaitingPickups", enemies: [] }),
    });
    await frame();
    nextTick((s) => ({ ...s, bankedPowerUp: "shield" }));
    await frame();
    const toast = () => screen.getByTestId("starswarm-pickup-cue", { includeHiddenElements: true });
    expect(toast()).toHaveTextContent("SHIELD → NEXT WAVE");
    expect(toast().props.numberOfLines).toBe(1);
    expect(toast().props.adjustsFontSizeToFit).toBe(true);
    // held banked: later frames neither repeat the announcement nor commit to React
    const settled = commits.count;
    await frames(5);
    expect(commits.count).toBe(settled);
    nextTick((s) => ({ ...s, phase: "SwoopIn" }));
    await frame();
    nextTick((s) => ({ ...s, phase: "Playing", bankedPowerUp: null }));
    await frame();
    expect(toast()).toHaveTextContent("SHIELD UP!");
    await frames(3);
    const spoken = announce.mock.calls.map(([m]) => String(m));
    expect(spoken.filter((m) => m === "Shield saved for the next wave.")).toHaveLength(1);
    expect(spoken.filter((m) => m === "Shield up.")).toHaveLength(1);
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
    // #3598: the wave numeral is a "1" of its own now, so read the countdown digit by its id
    const digit = () => screen.queryByTestId("starswarm-countdown");
    expect(digit()).toHaveTextContent("3");
    await frame(); // dt 0
    await frames(31, 33); // 1023 ms
    expect(digit()).toHaveTextContent("2");
    expect(mockTick).not.toHaveBeenCalled();
    await frames(62, 33); // past 3000 ms
    expect(digit()).toBeNull();
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
      true,
      undefined,
      { timelineOn: false } // #3393: no timelineEnabled prop, so the run records no timelines
    );
    const state = ref.current!.getState();
    expect(state.wave).toBe(5);
    expect(state.difficulty).toBe("Captain");
    expect(onBossWave).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("SCORE 0")).toBeTruthy();
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

  it("#3251: infinite lives flags the died close it reverts, and the rest of the wave, dev", async () => {
    const { ref, rerender } = await mount();
    await rerender({ resetTick: 1, devOptions: { infiniteLives: true } });
    await frame();
    await frames(95, 33); // run out the countdown
    // the real engine's GameOver tick: lives gone, the wave closed as died
    nextTick((s) => {
      const over = { ...s, phase: "GameOver" as const, player: { ...s.player, lives: 0 } };
      const died = actualEngine.closeWave(over, "died");
      return {
        ...over,
        lastClosedWave: died,
        closedWaves: [...s.closedWaves, actualEngine.toWirePayload(died)],
      };
    });
    await frame();
    const state = ref.current!.getState();
    expect(state.phase).not.toBe("GameOver");
    expect(state.closedWaves).toEqual([expect.objectContaining({ outcome: "died", dev: true })]);
    // the wave plays on flagged, so its later cleared close is dev too
    expect(state.waveStats.dev).toBe(true);
    expect(actualEngine.closeWave(state, "cleared").dev).toBe(true);
  });

  it("#3251: without infinite lives, a died close is left as the engine made it", async () => {
    const { ref } = await mount({ initialState: seeded() });
    await frame();
    let engineState: StarSwarmState | null = null;
    nextTick((s) => {
      const over = { ...s, phase: "GameOver" as const, player: { ...s.player, lives: 0 } };
      const died = actualEngine.toWirePayload(actualEngine.closeWave(over, "died"));
      engineState = { ...over, closedWaves: [died] };
      return engineState;
    });
    await frame();
    expect(ref.current!.getState()).toBe(engineState);
    expect(ref.current!.getState().closedWaves[0]!.dev).toBe(false);
  });
});

describe("Star Swarm GameCanvas (native) — engine-event callbacks", () => {
  it("reports a hit, an explosion and a power-up", async () => {
    const cb = {
      onPlayerHit: jest.fn(),
      onExplosion: jest.fn(),
      onPowerUpCollect: jest.fn(),
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
      "reinforcementBayJustOpened",
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

  it("#3561: raises reinforce on the bay-open edge, not when the Grunts launch", async () => {
    const onCarrierEvent = jest.fn();
    await mount({ initialState: seeded(), onCarrierEvent });
    await frame();
    mockEngine.reinforcementsJustLaunched!.mockReturnValue(true);
    nextTick((s) => s);
    await frame();
    expect(onCarrierEvent).not.toHaveBeenCalledWith("reinforce");
    mockEngine.reinforcementsJustLaunched!.mockReset();
    mockEngine.reinforcementBayJustOpened!.mockReturnValueOnce(true);
    nextTick((s) => s);
    await frame();
    expect(onCarrierEvent.mock.calls.map((c) => c[0])).toEqual(["reinforce"]);
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

describe("Star Swarm GameCanvas (native) — the wave-timeline flag (#3393)", () => {
  it("asks timelineEnabled once when it creates a run, never per frame or render", async () => {
    const timelineEnabled = jest.fn(() => true);
    const { ref, rerender } = await mount({ timelineEnabled });
    expect(timelineEnabled).toHaveBeenCalledTimes(1);
    expect(ref.current!.getState()).toMatchObject({ timelineOn: true, timelineLost: false });
    expect(ref.current!.getState().waveTimeline).not.toBeNull();
    // frames and re-renders (a HUD commit, a new prop) don't ask again
    await frames(30);
    await rerender({ highScore: 99 });
    await frames(5);
    expect(timelineEnabled).toHaveBeenCalledTimes(1);
    // a new run asks again, and its answer is the new run's flag for good
    timelineEnabled.mockReturnValue(false);
    await rerender({ resetTick: 1 });
    expect(timelineEnabled).toHaveBeenCalledTimes(2);
    expect(ref.current!.getState()).toMatchObject({ timelineOn: false, waveTimeline: null });
    await frames(5);
    expect(timelineEnabled).toHaveBeenCalledTimes(2);
  });

  it("without the prop, a run records no timelines", async () => {
    const { ref } = await mount();
    expect(ref.current!.getState()).toMatchObject({ timelineOn: false, waveTimeline: null });
  });

  it("a restored run keeps its own flag and doesn't ask", async () => {
    const timelineEnabled = jest.fn(() => true);
    const { ref } = await mount({ initialState: seeded(), timelineEnabled });
    expect(timelineEnabled).not.toHaveBeenCalled();
    expect(ref.current!.getState().timelineOn).toBe(false);
  });
});

describe("Star Swarm GameCanvas (native) — one run per mount and per reset (#3416)", () => {
  it("builds the run once on mount and once per reset, never once per render", async () => {
    const { rerender } = await mount();
    expect(mockEngine.initStarSwarm).toHaveBeenCalledTimes(1);
    // forced re-renders (new props, HUD commits, frames) must not rebuild a discarded run
    await rerender({ highScore: 1 });
    await rerender({ highScore: 2 });
    await rerender({ highScore: 3 });
    await frames(10);
    expect(mockEngine.initStarSwarm).toHaveBeenCalledTimes(1);
    await rerender({ resetTick: 1 });
    expect(mockEngine.initStarSwarm).toHaveBeenCalledTimes(2);
    await rerender({ resetTick: 1, highScore: 4 });
    await rerender({ resetTick: 1, highScore: 5 });
    expect(mockEngine.initStarSwarm).toHaveBeenCalledTimes(2);
  });

  it("a restored run never builds a new one on mount or re-render", async () => {
    // regression guard: also passes without the #3416 fix (a restored run never calls initStarSwarm)
    const { rerender } = await mount({ initialState: seeded() });
    await rerender({ highScore: 1 });
    await rerender({ highScore: 2 });
    expect(mockEngine.initStarSwarm).not.toHaveBeenCalled();
  });
});

describe("Star Swarm GameCanvas (native) — sound events (#3526)", () => {
  const step = frame;
  const steps = frames;

  const shielded = { type: "shield" as const, remainingMs: 5000, shieldAbsorbed: 0 };
  const explosion = { id: 1 } as unknown as StarSwarmState["explosions"][number];
  /** The wave's collected tally, one higher for `type` (what the engine does on a collection). */
  const collected = (
    s: StarSwarmState,
    type: "bomb" | "shield" | "salvage" | "hull"
  ): StarSwarmState => ({
    ...s,
    waveStats: {
      ...s.waveStats,
      powerUps: {
        ...s.waveStats.powerUps,
        collected: {
          ...s.waveStats.powerUps.collected,
          [type]: s.waveStats.powerUps.collected[type] + 1,
        },
      },
    },
  });

  it("a Smart Bomb detonation reports onBombBlast and skips the generic explosion that tick", async () => {
    const cb = { onBombBlast: jest.fn(), onExplosion: jest.fn() };
    await mount({ initialState: seeded(), ...cb });
    await step();
    nextTick((s) => ({ ...s, bombFlashTimer: 300, explosions: [...s.explosions, explosion] }));
    await step();
    expect(cb.onBombBlast).toHaveBeenCalledTimes(1);
    expect(cb.onExplosion).not.toHaveBeenCalled();
    // the flash only counts down on the following ticks: no second blast
    nextTick((s) => ({ ...s, bombFlashTimer: 284 }));
    await step();
    expect(cb.onBombBlast).toHaveBeenCalledTimes(1);
  });

  it("a dev-panel Smart Bomb reports onBombBlast once, outside the tick", async () => {
    const cb = { onBombBlast: jest.fn(), onExplosion: jest.fn() };
    const { ref } = await mount({ initialState: seeded(), ...cb });
    await step();
    ref.current!.triggerPowerUp("bomb");
    await step();
    await step();
    expect(cb.onBombBlast).toHaveBeenCalledTimes(1);
    // another injection is not a bomb
    ref.current!.triggerPowerUp("shield");
    await step();
    expect(cb.onBombBlast).toHaveBeenCalledTimes(1);
  });

  it("a collected crate or plating reports onPowerUpCollect from the tally, even at max level", async () => {
    const onPowerUpCollect = jest.fn();
    await mount({ initialState: seeded(), onPowerUpCollect });
    await step();
    nextTick((s) => collected(s, "salvage"));
    await step();
    nextTick((s) => collected(s, "hull"));
    await step();
    expect(onPowerUpCollect.mock.calls).toEqual([["salvage"], ["hull"]]);
  });

  it("an ordinary explosion still reports onExplosion", async () => {
    const cb = { onBombBlast: jest.fn(), onExplosion: jest.fn() };
    await mount({ initialState: seeded(), ...cb });
    await step();
    nextTick((s) => ({ ...s, explosions: [...s.explosions, explosion] }));
    await step();
    expect(cb.onExplosion).toHaveBeenCalledTimes(1);
    expect(cb.onBombBlast).not.toHaveBeenCalled();
  });

  /** A rock of `kind` mid-field (cast: the sound check reads only id, kind, position, velocity). */
  const rock = (id: number, kind: "large" | "small") =>
    ({ id, kind, x: 100, y: 100, vx: 0, vy: 0.1, radius: 10, hp: 1 }) as never;
  /** One rock broke this tick: it leaves the list, a `player` break is counted and it explodes. */
  const rockBroke = (s: StarSwarmState, id: number, extraExplosions = 0): StarSwarmState => ({
    ...s,
    asteroids: s.asteroids.filter((a) => a.id !== id),
    explosions: [...s.explosions, ...Array(1 + extraExplosions).fill(explosion)],
    waveStats: {
      ...s.waveStats,
      rocks: {
        ...s.waveStats.rocks,
        broken: { ...s.waveStats.rocks.broken, player: s.waveStats.rocks.broken.player + 1 },
      },
    },
  });

  it("a rock break reports onRockBreak by size and skips the generic explosion (#3560)", async () => {
    const cb = { onRockBreak: jest.fn(), onExplosion: jest.fn() };
    await mount({ initialState: seeded(), ...cb });
    await step();
    nextTick((s) => ({ ...s, asteroids: [rock(901, "large"), rock(902, "small")] }));
    await step();
    nextTick((s) => rockBroke(s, 902));
    await step();
    expect(cb.onRockBreak.mock.calls).toEqual([["small"]]);
    nextTick((s) => rockBroke(s, 901));
    await step();
    expect(cb.onRockBreak.mock.calls).toEqual([["small"], ["large"]]);
    expect(cb.onExplosion).not.toHaveBeenCalled();
  });

  it("a rock break and an enemy kill on one tick sound both (#3560)", async () => {
    const cb = { onRockBreak: jest.fn(), onExplosion: jest.fn() };
    await mount({ initialState: seeded(), ...cb });
    await step();
    nextTick((s) => ({ ...s, asteroids: [rock(901, "large")] }));
    await step();
    nextTick((s) => rockBroke(s, 901, 1));
    await step();
    expect(cb.onRockBreak.mock.calls).toEqual([["large"]]);
    expect(cb.onExplosion).toHaveBeenCalledTimes(1);
  });

  it("a Smart Bomb tick that clears rocks plays the bomb blast only (#3560)", async () => {
    const cb = { onBombBlast: jest.fn(), onRockBreak: jest.fn(), onExplosion: jest.fn() };
    await mount({ initialState: seeded(), ...cb });
    await step();
    nextTick((s) => ({ ...s, asteroids: [rock(901, "large")] }));
    await step();
    nextTick((s) => ({ ...rockBroke(s, 901), bombFlashTimer: 300 }));
    await step();
    expect(cb.onBombBlast).toHaveBeenCalledTimes(1);
    expect(cb.onRockBreak).not.toHaveBeenCalled();
    expect(cb.onExplosion).not.toHaveBeenCalled();
  });

  it("a collected power-up (banked or not) reports onPowerUpCollect once, even if its buff rises on that tick", async () => {
    const onPowerUpCollect = jest.fn();
    await mount({ initialState: seeded(), onPowerUpCollect });
    await step();
    nextTick((s) => collected(s, "bomb"));
    await step();
    expect(onPowerUpCollect.mock.calls).toEqual([["bomb"]]);
    nextTick((s) => ({ ...collected(s, "shield"), activePowerUp: shielded }));
    await step();
    expect(onPowerUpCollect.mock.calls).toEqual([["bomb"], ["shield"]]);
  });

  it("a banked power-up taking effect on the next wave is not announced a second time", async () => {
    const onPowerUpCollect = jest.fn();
    await mount({ initialState: seeded({ bankedPowerUp: "shield" }), onPowerUpCollect });
    await step();
    nextTick((s) => ({ ...s, bankedPowerUp: null, activePowerUp: shielded }));
    await step();
    expect(onPowerUpCollect).not.toHaveBeenCalled();
  });

  it("reports each loop only when its condition changes", async () => {
    const onLoopChange = jest.fn();
    await mount({ initialState: seeded(), onLoopChange });
    await step();
    await steps(3);
    expect(onLoopChange).not.toHaveBeenCalled();

    nextTick((s) => ({ ...s, activePowerUp: shielded }));
    await step();
    nextTick((s) => ({ ...s, activePowerUp: shielded }));
    await step();
    expect(onLoopChange.mock.calls).toEqual([["shield", true]]);

    nextTick((s) => ({
      ...s,
      activePowerUp: null,
      buddyShips: [{ id: 1, phase: "OnStation" } as never],
    }));
    await step();
    expect(onLoopChange.mock.calls.slice(1)).toEqual([
      ["shield", false],
      ["buddy", true],
    ]);

    nextTick((s) => ({
      ...s,
      buddyShips: [],
      enemies: s.enemies.map((e, i) => (i === 0 ? { ...e, isAlive: true, phase: "Fleeing" } : e)),
    }));
    await step();
    expect(onLoopChange.mock.calls.slice(3)).toEqual([
      ["buddy", false],
      ["rout", true],
    ]);
  });
});

describe("Star Swarm GameCanvas (native) — Shield, Buddy and Lightning sounds (#3560)", () => {
  const step = () => frames(1);
  const mockTick = engine.tick as jest.MockedFunction<typeof engine.tick>;
  const realTick = jest.requireActual<typeof engine>("../../../game/starswarm/engine").tick;
  const nextTick = (change: (s: StarSwarmState) => StarSwarmState) =>
    mockTick.mockImplementationOnce((s) => change(s));
  beforeEach(() => mockTick.mockImplementation((s) => s));
  afterEach(() => mockTick.mockImplementation(realTick));

  const buff = (type: "shield" | "lightning", remainingMs: number) => ({
    type,
    remainingMs,
    shieldAbsorbed: 0,
  });
  const explosion = { id: 1 } as unknown as StarSwarmState["explosions"][number];
  const launched = (s: StarSwarmState): StarSwarmState => ({
    ...s,
    runStats: { ...s.runStats, buddyLaunched: s.runStats.buddyLaunched + 1 },
    buddyShips: [...s.buddyShips, { id: 7, phase: "Entering" } as never],
  });
  const phased = (s: StarSwarmState, phase: "OnStation" | "Leaving"): StarSwarmState => ({
    ...s,
    buddyShips: s.buddyShips.map((b) => ({ ...b, phase })),
  });

  it("a Shield cues on once, warns once at 1 s left, and cues off once when it ends", async () => {
    const onSoundCue = jest.fn();
    await mount({ initialState: seeded(), onSoundCue });
    await step();
    nextTick((s) => ({ ...s, activePowerUp: buff("shield", 5000) }));
    await step();
    nextTick((s) => ({ ...s, activePowerUp: buff("shield", 1016) }));
    await step();
    nextTick((s) => ({ ...s, activePowerUp: buff("shield", 1000) }));
    await step();
    nextTick((s) => ({ ...s, activePowerUp: buff("shield", 984) }));
    await step();
    nextTick((s) => ({ ...s, activePowerUp: null }));
    await step();
    await step();
    expect(onSoundCue.mock.calls).toEqual([["shieldOn"], ["shieldWarn"], ["shieldOff"]]);
  });

  it("Lightning replacing a Shield cues the Shield off and starts the Lightning loop", async () => {
    const onSoundCue = jest.fn();
    const onLoopChange = jest.fn();
    await mount({ initialState: seeded(), onSoundCue, onLoopChange });
    await step();
    nextTick((s) => ({ ...s, activePowerUp: buff("shield", 3000) }));
    await step();
    nextTick((s) => ({ ...s, activePowerUp: buff("lightning", 5000) }));
    await step();
    expect(onSoundCue.mock.calls).toEqual([["shieldOn"], ["shieldOff"]]);
    expect(onLoopChange.mock.calls).toEqual([
      ["shield", true],
      ["shield", false],
      ["lightning", true],
    ]);
    nextTick((s) => ({ ...s, activePowerUp: null }));
    await step();
    expect(onLoopChange).toHaveBeenLastCalledWith("lightning", false);
  });

  it("a Buddy cues in when launched, out when it peels off; its loop runs only on station", async () => {
    const onSoundCue = jest.fn();
    const onLoopChange = jest.fn();
    await mount({ initialState: seeded(), onSoundCue, onLoopChange });
    await step();
    nextTick(launched);
    await step();
    expect(onSoundCue.mock.calls).toEqual([["buddyIn"]]);
    expect(onLoopChange).not.toHaveBeenCalled(); // Entering: the thrusters cover it
    nextTick((s) => phased(s, "OnStation"));
    await step();
    expect(onLoopChange.mock.calls).toEqual([["buddy", true]]);
    nextTick((s) => phased(s, "Leaving"));
    await step();
    expect(onSoundCue.mock.calls).toEqual([["buddyIn"], ["buddyOut"]]);
    expect(onLoopChange.mock.calls).toEqual([
      ["buddy", true],
      ["buddy", false],
    ]);
    // a second launch cues in again
    nextTick((s) => launched({ ...s, buddyShips: [] }));
    await step();
    expect(onSoundCue.mock.calls.at(-1)).toEqual(["buddyIn"]);
  });

  it("a Buddy shot down reports onBuddyLost, no out cue, and skips the generic explosion", async () => {
    const cb = { onBuddyLost: jest.fn(), onExplosion: jest.fn(), onSoundCue: jest.fn() };
    await mount({ initialState: seeded(), ...cb });
    await step();
    nextTick(launched);
    await step();
    nextTick((s) => phased(s, "OnStation"));
    await step();
    cb.onSoundCue.mockClear();
    nextTick((s) => ({
      ...s,
      buddyShips: [],
      runStats: { ...s.runStats, buddyLost: s.runStats.buddyLost + 1 },
      explosions: [...s.explosions, explosion],
    }));
    await step();
    expect(cb.onBuddyLost).toHaveBeenCalledTimes(1);
    expect(cb.onExplosion).not.toHaveBeenCalled();
    expect(cb.onSoundCue).not.toHaveBeenCalled();
    // an ordinary explosion on a later tick still sounds
    nextTick((s) => ({ ...s, explosions: [...s.explosions, { ...explosion, id: 2 }] })); // a new explosion (new id)
    await step();
    expect(cb.onExplosion).toHaveBeenCalledTimes(1);
  });

  it("dev-panel injections sound too: Shield cues on, Lightning starts its loop, Buddy cues in", async () => {
    const onSoundCue = jest.fn();
    const onLoopChange = jest.fn();
    const { ref } = await mount({ initialState: seeded(), onSoundCue, onLoopChange });
    await step();
    ref.current!.triggerPowerUp("shield");
    await step();
    await step();
    expect(onSoundCue.mock.calls).toEqual([["shieldOn"]]);
    expect(onLoopChange.mock.calls).toEqual([["shield", true]]);
    ref.current!.triggerPowerUp("lightning");
    await step();
    await step();
    expect(onSoundCue.mock.calls).toEqual([["shieldOn"], ["shieldOff"]]);
    expect(onLoopChange.mock.calls.slice(1)).toEqual([
      ["shield", false],
      ["lightning", true],
    ]);
    ref.current!.triggerPowerUp("buddy");
    await step();
    expect(onSoundCue.mock.calls.at(-1)).toEqual(["buddyIn"]);
  });
});
