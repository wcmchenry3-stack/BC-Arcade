/**
 * @jest-environment jsdom
 *
 * #3689: 2048's motion on the screen: the win card waits about a second for the 2048 tile and its
 * glow, the game-over card about 0.6 s for the dimmed, shaking board, both at once under Reduce
 * Motion (read live: turning it on mid-beat releases the card), a finished game that was restored
 * shows its card at once; swipes fire on their threshold, once per gesture; up to two swipes queue
 * behind a slide, and the queued move is not applied inside a state updater.
 */
import React from "react";
import { render, waitFor, act, fireEvent } from "@testing-library/react-native";
import { Platform } from "react-native";
import Twenty48Screen from "../Twenty48Screen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame, saveGame } from "../../game/twenty48/storage";
import { seedNextTileId, move as engineMove } from "../../game/twenty48/engine";
import type { Twenty48State } from "../../game/twenty48/types";
import { GAME_OVER_BEAT_MS, MOVE_LOCK_MS, WIN_BEAT_MS } from "../../game/twenty48/motion";
import { SWIPE_THRESHOLD_PX } from "../../game/twenty48/input";
import { detectedGesture } from "../../test-utils/mockScreenDeps";
import type { DetectorRender } from "../../test-utils/mockScreenDeps";

(Platform as { OS: string }).OS = "web";

let mockReduceMotion = false;
jest.mock("../../components/shared/useReduceMotion", () => ({
  ...jest.requireActual("../../components/shared/useReduceMotion"),
  useReduceMotion: () => mockReduceMotion,
}));

const mockDetected: DetectorRender[] = [];
jest.mock("react-native-gesture-handler", () =>
  mockScreenDeps().mockGestureHandler(() => mockDetected)
);

const mockShellNavigate = jest.fn();
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({ navigate: mockShellNavigate }), { actual: true })
);
jest.mock("../../game/twenty48/storage", () => ({
  saveGame: jest.fn(() => Promise.resolve()),
  clearGame: jest.fn(() => Promise.resolve()),
  loadGame: jest.fn().mockResolvedValue(null),
  saveBestScore: jest.fn(),
  loadBestScore: jest.fn().mockResolvedValue(0),
}));
jest.mock("../../game/twenty48/engine", () => {
  const actual = jest.requireActual("../../game/twenty48/engine");
  return {
    __esModule: true,
    ...actual,
    move: jest.fn((...args: unknown[]) => (actual.move as (...a: unknown[]) => unknown)(...args)),
  };
});
jest.mock("../../game/_shared/gameEventClient", () =>
  mockScreenDeps().mockGameEventClient({ startGame: jest.fn().mockReturnValue("game-id") })
);
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({}));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());
jest.mock("../../game/_shared/displayNameSync", () => mockScreenDeps().mockDisplayNameSync({}));

const mockedMove = engineMove as unknown as jest.Mock;

const nav = {
  setOptions: jest.fn(),
  navigate: jest.fn(),
  goBack: jest.fn(),
  popToTop: jest.fn(),
  addListener: jest.fn(() => () => {}),
} as unknown as Parameters<typeof Twenty48Screen>[0]["navigation"];

type Cell = [row: number, col: number, value: number];
function stateOf(cells: Cell[], over: Partial<Twenty48State> = {}): Twenty48State {
  const board = Array.from({ length: 4 }, () => Array<number>(4).fill(0));
  cells.forEach(([r, c, v]) => {
    board[r]![c] = v;
  });
  return {
    board,
    tiles: cells.map(([row, col, value], i) => ({
      id: i + 1,
      value,
      row,
      col,
      prevRow: row,
      prevCol: col,
      isNew: false,
      isMerge: false,
    })),
    score: 0,
    scoreDelta: 0,
    game_over: false,
    has_won: false,
    startedAt: null,
    accumulatedMs: 0,
    ...over,
  };
}

const START = stateOf([
  [0, 3, 2],
  [2, 1, 4],
]);
// 1024 + 1024: the swipe left makes 2048.
const WIN = stateOf(
  [
    [0, 0, 2048],
    [3, 3, 2],
  ],
  { has_won: true, score: 2048, scoreDelta: 2048, events: ["win2048"] }
);
// A full board with no equal neighbours: the swipe that gets here ends the game.
const STUCK = stateOf(
  [0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3].map((c): Cell => [r, c, (r + c) % 2 === 0 ? 2 : 4])),
  { game_over: true, score: 10, scoreDelta: 4, events: ["gameOver"] }
);
const FINISHED_WIN = { ...WIN, events: undefined };
const FINISHED_STUCK = { ...STUCK, events: undefined };

async function open(saved: Twenty48State | null) {
  (loadGame as jest.Mock).mockResolvedValueOnce(saved);
  const r = await render(
    <ThemeProvider>
      <Twenty48Screen navigation={nav} />
    </ThemeProvider>
  );
  await waitFor(() => expect(r.getAllByText(/^\d+$/).length).toBeGreaterThan(0));
  return r;
}

function key(k: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
}

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

beforeEach(() => {
  mockReduceMotion = false;
  mockDetected.length = 0;
  mockedMove.mockClear();
  (saveGame as jest.Mock).mockClear();
  seedNextTileId(100);
});
afterEach(() => {
  jest.useRealTimers();
  mockedMove.mockImplementation((...args: unknown[]) =>
    (jest.requireActual("../../game/twenty48/engine").move as (...a: unknown[]) => unknown)(...args)
  );
});

describe("2048 beats: the result card waits for the move's last moment", () => {
  it("the win card follows the 2048 tile by the win beat, not before", async () => {
    const r = await open(START);
    jest.useFakeTimers();
    mockedMove.mockImplementationOnce(() => WIN);
    await act(async () => key("ArrowLeft"));

    // The tile that won is on the board, and there is no card in the same render.
    expect(r.getByLabelText("2048")).toBeTruthy();
    expect(r.queryByTestId("twenty48-result")).toBeNull();
    await advance(WIN_BEAT_MS - 1);
    expect(r.queryByTestId("twenty48-result")).toBeNull();
    await advance(1);
    expect(r.getByTestId("twenty48-result")).toBeTruthy();
    expect(r.getByText("You Win!")).toBeTruthy();
  });

  it("the game-over card follows by the game-over beat, with the board dimmed meanwhile", async () => {
    const r = await open(START);
    jest.useFakeTimers();
    mockedMove.mockImplementationOnce(() => STUCK);
    await act(async () => key("ArrowLeft"));

    expect(r.queryByTestId("twenty48-result")).toBeNull();
    expect(r.getByTestId("twenty48-dim")).toBeTruthy();
    await advance(GAME_OVER_BEAT_MS - 1);
    expect(r.queryByTestId("twenty48-result")).toBeNull();
    await advance(1);
    expect(r.getByText("Game Over")).toBeTruthy();
    // The board stays dimmed under the card: no bright flash before its scrim fades in (#3725).
    // The board is behind the open card, so it is queried with hidden elements included.
    expect(r.getByTestId("twenty48-dim", { includeHiddenElements: true })).toBeTruthy();
  });

  it("the 2048 move that also ends the game shows the win card, after the win beat", async () => {
    const r = await open(START);
    jest.useFakeTimers();
    mockedMove.mockImplementationOnce(() => ({
      ...STUCK,
      has_won: true,
      events: ["win2048", "gameOver"],
    }));
    await act(async () => key("ArrowLeft"));
    await advance(GAME_OVER_BEAT_MS);
    // The win beat is the longer one: no card of either kind comes up after the game-over beat.
    expect(r.queryByTestId("twenty48-result")).toBeNull();
    await advance(WIN_BEAT_MS - GAME_OVER_BEAT_MS);
    expect(r.getByText("You Win!")).toBeTruthy();
  });

  it("no move is taken behind the held win card, and the hint is off", async () => {
    const r = await open(START);
    jest.useFakeTimers();
    mockedMove.mockImplementationOnce(() => WIN);
    await act(async () => key("ArrowLeft"));
    await advance(MOVE_LOCK_MS + 10);
    mockedMove.mockClear();
    await act(async () => key("ArrowRight"));
    expect(mockedMove).not.toHaveBeenCalled();
    expect(r.getByTestId("twenty48-hint-button").props.accessibilityState?.disabled).toBe(true);
  });

  it("New Game during the beat ends it: the old card never comes up over the new board", async () => {
    const r = await open(START);
    jest.useFakeTimers();
    mockedMove.mockImplementationOnce(() => STUCK);
    await act(async () => key("ArrowLeft"));
    await act(async () => {
      await fireEvent.press(r.getByTestId("twenty48-new-game-button"));
    });
    await advance(GAME_OVER_BEAT_MS * 2);
    expect(r.queryByTestId("twenty48-result")).toBeNull();
    expect(r.queryByTestId("twenty48-dim", { includeHiddenElements: true })).toBeNull();
  });
});

describe("2048 beats: Reduce Motion", () => {
  it("shows the win card at once", async () => {
    mockReduceMotion = true;
    const r = await open(START);
    mockedMove.mockImplementationOnce(() => WIN);
    await act(async () => key("ArrowLeft"));
    expect(r.getByText("You Win!")).toBeTruthy();
  });

  it("shows the game-over card at once, with no dim", async () => {
    mockReduceMotion = true;
    const r = await open(START);
    mockedMove.mockImplementationOnce(() => STUCK);
    await act(async () => key("ArrowLeft"));
    expect(r.getByText("Game Over")).toBeTruthy();
    expect(r.queryByTestId("twenty48-dim", { includeHiddenElements: true })).toBeNull();
  });

  it("turning it on mid-beat releases the card now, and the card stays up", async () => {
    const r = await open(START);
    jest.useFakeTimers();
    mockedMove.mockImplementationOnce(() => WIN);
    await act(async () => key("ArrowLeft"));
    await advance(300);
    expect(r.queryByTestId("twenty48-result")).toBeNull();

    mockReduceMotion = true;
    await r.rerender(
      <ThemeProvider>
        <Twenty48Screen navigation={nav} />
      </ThemeProvider>
    );
    expect(r.getByText("You Win!")).toBeTruthy();
    // The cancelled timer doesn't toggle anything later, and turning it off doesn't replay a beat.
    mockReduceMotion = false;
    await r.rerender(
      <ThemeProvider>
        <Twenty48Screen navigation={nav} />
      </ThemeProvider>
    );
    await advance(WIN_BEAT_MS);
    expect(r.getByText("You Win!")).toBeTruthy();
  });
});

describe("2048 beats: a restored finished game", () => {
  it("shows the game-over card at once", async () => {
    const r = await open(FINISHED_STUCK);
    expect(r.getByText("Game Over")).toBeTruthy();
    expect(r.queryByTestId("twenty48-dim", { includeHiddenElements: true })).toBeNull();
  });

  it("shows the win card at once", async () => {
    const r = await open(FINISHED_WIN);
    expect(r.getByText("You Win!")).toBeTruthy();
  });
});

describe("2048 input: the move queue", () => {
  /** Every swipe is a valid move: the engine's answer is the same board a point richer. */
  function everyMoveWorks() {
    mockedMove.mockImplementation((s: Twenty48State) => ({
      ...s,
      score: s.score + 1,
      scoreDelta: 1,
    }));
  }
  const directions = () => mockedMove.mock.calls.map((c) => c[1]);

  it("keeps two swipes made during a slide and plays them in order; a third is dropped", async () => {
    await open(START);
    jest.useFakeTimers();
    everyMoveWorks();
    await act(async () => {
      key("ArrowLeft");
      key("ArrowUp");
      key("ArrowRight");
      key("ArrowDown");
    });
    expect(directions()).toEqual(["left"]);
    await advance(MOVE_LOCK_MS);
    expect(directions()).toEqual(["left", "up"]);
    await advance(MOVE_LOCK_MS);
    expect(directions()).toEqual(["left", "up", "right"]);
    await advance(MOVE_LOCK_MS * 3);
    expect(directions()).toEqual(["left", "up", "right"]);
  });

  it("applies a queued move once, even where React runs state updaters twice (StrictMode)", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(START);
    const r = await render(
      <React.StrictMode>
        <ThemeProvider>
          <Twenty48Screen navigation={nav} />
        </ThemeProvider>
      </React.StrictMode>
    );
    await waitFor(() => expect(r.getAllByText(/^\d+$/).length).toBeGreaterThan(0));
    jest.useFakeTimers();
    everyMoveWorks();
    await act(async () => {
      key("ArrowLeft");
      key("ArrowUp");
    });
    await advance(MOVE_LOCK_MS * 3);
    expect(directions()).toEqual(["left", "up"]);
  });

  it("a no-effect move releases the lock at once and the next queued move still plays", async () => {
    await open(START);
    jest.useFakeTimers();
    let calls = 0;
    mockedMove.mockImplementation((s: Twenty48State) => {
      calls += 1;
      if (calls === 2) throw new Error("Move has no effect.");
      return { ...s, score: s.score + 1, scoreDelta: 1 };
    });
    await act(async () => {
      key("ArrowLeft");
      key("ArrowUp"); // queued, then refused by the engine
      key("ArrowRight"); // queued behind it
    });
    await advance(MOVE_LOCK_MS * 3);
    expect(directions()).toEqual(["left", "up", "right"]);
  });

  it("New Game cancels the old move's lock: it can't end the new board's move early (#3725 review)", async () => {
    const r = await open(START);
    jest.useFakeTimers();
    // A move that scores nothing, so New Game needs no confirmation.
    mockedMove.mockImplementationOnce((s: Twenty48State) => ({ ...s, scoreDelta: 0 }));
    await act(async () => key("ArrowLeft"));
    await act(async () => {
      await fireEvent.press(r.getByTestId("twenty48-new-game-button"));
    });
    await advance(MOVE_LOCK_MS / 2);
    everyMoveWorks();
    await act(async () => {
      key("ArrowLeft"); // the new board's first move takes the lock
      key("ArrowUp"); // queued behind it
    });
    // The old move's lock would have ended here and played the queued move half a lock early.
    await advance(MOVE_LOCK_MS / 2 + 10);
    expect(directions()).toEqual(["left", "left"]);
    await advance(MOVE_LOCK_MS / 2);
    expect(directions()).toEqual(["left", "left", "up"]);
  });

  it("moves queued behind the winning move are dropped", async () => {
    const r = await open(START);
    jest.useFakeTimers();
    mockedMove.mockImplementationOnce(() => WIN);
    await act(async () => {
      key("ArrowLeft");
      key("ArrowUp");
      key("ArrowRight");
    });
    await advance(WIN_BEAT_MS + MOVE_LOCK_MS);
    expect(mockedMove).toHaveBeenCalledTimes(1);
    expect(r.getByText("You Win!")).toBeTruthy();
  });
});

describe("2048 input: the swipe fires on its threshold", () => {
  const pan = () => detectedGesture(mockDetected, "pan", { testID: "twenty48-play-area" })!;
  const update = (x: number, y: number) =>
    act(async () => {
      pan().onUpdate!({ translationX: x, translationY: y });
    });

  it("moves once the finger has travelled the threshold, before it lifts, and only once", async () => {
    await open(START);
    jest.useFakeTimers();
    await act(async () => pan().onBegin!({}));
    await update(SWIPE_THRESHOLD_PX - 1, 2);
    expect(mockedMove).not.toHaveBeenCalled();

    await update(SWIPE_THRESHOLD_PX, 2);
    expect(mockedMove).toHaveBeenCalledTimes(1);
    expect(mockedMove.mock.calls[0]![1]).toBe("right");

    // The rest of the drag, and the lift, add nothing.
    await advance(MOVE_LOCK_MS * 2);
    await update(SWIPE_THRESHOLD_PX + 40, 2);
    await update(-60, 2);
    await act(async () => pan().onFinalize!({}));
    await advance(MOVE_LOCK_MS * 2);
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it("there is no move on lift: the gesture has no end handler", async () => {
    await open(START);
    expect(pan().onEnd).toBeUndefined();
  });

  it("the next gesture fires its own move", async () => {
    await open(START);
    jest.useFakeTimers();
    await act(async () => pan().onBegin!({}));
    await update(SWIPE_THRESHOLD_PX + 2, 0);
    await act(async () => pan().onFinalize!({}));
    await advance(MOVE_LOCK_MS * 2);

    await act(async () => pan().onBegin!({}));
    await update(0, -(SWIPE_THRESHOLD_PX + 2));
    expect(mockedMove.mock.calls.map((c) => c[1])).toEqual(["right", "up"]);
  });

  it("the gesture is one object for the screen's life: a move landing mid-drag doesn't rebuild it", async () => {
    await open(START);
    jest.useFakeTimers();
    const before = mockDetected.at(-1)!.gesture;
    await act(async () => pan().onBegin!({}));
    await update(SWIPE_THRESHOLD_PX + 5, 0); // a move, so a re-render
    expect(mockDetected.at(-1)!.gesture).toBe(before);
  });
});
