/**
 * #2960: the physics loop does not drive React. Per-frame data goes to a shared value read by the
 * board's Skia Picture, so stepping the engine commits nothing unless something the React tree
 * shows changes (the score, a merge burst, the queue after a drop).
 *
 * Commits are counted with React's `Profiler` around the whole screen. Before #2960 the loop
 * called `setScore` / `setPieces` / `setDangerRatio` / `setCanDrop` every frame: 60 frames of
 * moving pieces made 60 commits, and a fully asleep board still made 60 (the engine allocated a
 * fresh pieces array per frame, so `setPieces` never bailed out).
 */
import React, { Profiler } from "react";
import { act, create } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import CascadeScreen from "../CascadeScreen";
import CascadeBoard from "../../components/cascade/CascadeBoard";
import { FRAME_HEADER, FRAME_STRIDE, PIECE_FIELD } from "../../game/cascade/render/frame";

jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({
    popToTop: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  }))
);
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getGameRank: jest.fn() }));
jest.mock("../../api/players", () => ({
  playersApi: { putMe: jest.fn(() => Promise.resolve({ display_name: "Brave Otter 4821" })) },
}));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());
jest.mock("../../game/_shared/gameEventClient", () => mockScreenDeps().mockGameEventClient({}));
jest.mock("../../components/cascade/FruitGlyph", () => "FruitGlyph");
jest.mock("../../components/cascade/NextFruitPreview", () => "NextFruitPreview");
jest.mock("../../components/cascade/ThemeSelector", () => () => null);
jest.mock("@shopify/react-native-skia", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  const passThrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, {}, children);
  return {
    useImage: jest.fn().mockReturnValue({ width: 1, height: 1 }),
    Canvas: passThrough,
    Group: passThrough,
    Picture: () => null,
    createPicture: jest.fn(() => null),
    Image: () => null,
    Circle: () => null,
    Line: () => null,
    Path: () => null,
    DashPathEffect: () => null,
    BlurMask: () => null,
  };
});

interface MockPiece {
  id: number;
  tier: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  shapeKind: "circle";
  isSleeping: boolean;
}

/** What the stand-in engine reports on the next `getState()`: a fresh object every call. */
let mockMakeState: () => {
  pieces: MockPiece[];
  score: number;
  gameOver: boolean;
  dangerRatio: number;
  canDrop: boolean;
};
const mockStep = jest.fn(() => ({ events: [] as unknown[] }));
jest.mock("../../game/cascade/engine", () => ({
  CascadeEngine: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    step: mockStep,
    drop: jest.fn(),
    getState: jest.fn(() => mockMakeState()),
    destroy: jest.fn(),
    restore: jest.fn(),
    canDrop: jest.fn(() => true),
  })),
}));

let rafCallbacks: FrameRequestCallback[] = [];
let clock = 0;

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  rafCallbacks = [];
  clock = 0;
  jest.spyOn(global, "requestAnimationFrame").mockImplementation((cb) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  jest.spyOn(global, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function piece(id: number, tier: number, x: number, y: number, isSleeping: boolean): MockPiece {
  return { id, tier, x, y, vx: 0, vy: 0, angle: 0, shapeKind: "circle", isSleeping };
}

function advanceFrame() {
  clock += 16.67;
  const cbs = rafCallbacks.splice(0);
  cbs.forEach((cb) => cb(clock));
}

/** Mounts the screen with a measured board, inside a Profiler that counts commits. */
async function mountCounted() {
  const commits = { count: 0 };
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      <Profiler id="cascade" onRender={() => commits.count++}>
        <CascadeScreen />
      </Profiler>
    );
  });
  await act(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outer = renderer.root.findAll((node: any) => node.props.onLayout !== undefined)[0];
    outer?.props.onLayout({ nativeEvent: { layout: { width: 300, height: 600 } } });
  });
  // Let the first frames land (engine created, first frame published).
  await act(() => {
    advanceFrame();
    advanceFrame();
  });
  return { renderer, commits };
}

/** Each frame in its own act(), so React commits per frame as it would on a device. */
async function runFrames(n: number) {
  for (let i = 0; i < n; i++) {
    await act(() => {
      advanceFrame();
    });
  }
}

describe("CascadeScreen per-frame commits (#2960)", () => {
  it("a second of steps with every body asleep publishes no React commit", async () => {
    mockMakeState = () => ({
      pieces: [piece(1, 0, 120, 500, true), piece(2, 3, 220, 480, true)],
      score: 12,
      gameOver: false,
      dangerRatio: 0,
      canDrop: true,
    });
    const { commits } = await mountCounted();
    commits.count = 0;
    mockStep.mockClear();
    await runFrames(60);
    expect(mockStep).toHaveBeenCalledTimes(60);
    expect(commits.count).toBe(0);
  });

  it("the per-frame path calls no setState: moving pieces, a changing danger and canDrop commit nothing", async () => {
    let frame = 0;
    mockMakeState = () => {
      frame++;
      return {
        pieces: [piece(1, 0, 120 + frame, 200 + frame * 2, false), piece(2, 2, 250, 500, true)],
        score: 0,
        gameOver: false,
        dangerRatio: (frame % 10) / 10,
        canDrop: frame % 2 === 0,
      };
    };
    const { commits } = await mountCounted();
    commits.count = 0;
    await runFrames(60);
    expect(commits.count).toBe(0);
  });

  it("the moving frames still reach the board's shared frame buffer", async () => {
    let frame = 0;
    mockMakeState = () => {
      frame++;
      return {
        pieces: [piece(9, 4, 150, 100 + frame, false)],
        score: 0,
        gameOver: false,
        dangerRatio: 0.25,
        canDrop: false,
      };
    };
    const { renderer } = await mountCounted();
    // CascadeBoard is memoized: find it by its `frame` prop.
    const board = () =>
      renderer.root.findAll((n) => n.props.frame !== undefined && n.props.scale !== undefined)[0]!;
    expect(board().type).toBe((CascadeBoard as unknown as { type: unknown }).type);
    const read = () => board().props.frame.value as Float64Array;
    const before = read()[FRAME_HEADER + PIECE_FIELD.y];
    await runFrames(5);
    const buf = read();
    expect(buf[FRAME_HEADER + PIECE_FIELD.id]).toBe(9);
    expect(buf[FRAME_HEADER + PIECE_FIELD.tier]).toBe(4);
    expect(buf[FRAME_HEADER + PIECE_FIELD.y]).toBe((before ?? 0) + 5);
    expect(buf.length).toBe(FRAME_HEADER + FRAME_STRIDE);
  });

  it("a score change commits only the score, once per new integer", async () => {
    let score = 0;
    mockMakeState = () => ({
      pieces: [],
      score,
      gameOver: false,
      dangerRatio: 0,
      canDrop: true,
    });
    const { renderer, commits } = await mountCounted();
    commits.count = 0;
    score = 8;
    await runFrames(30);
    expect(commits.count).toBe(1);
    expect(JSON.stringify(renderer.toJSON())).toContain('"8"');
  });
});
