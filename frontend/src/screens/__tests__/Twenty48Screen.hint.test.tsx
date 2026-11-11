/**
 * @jest-environment jsdom
 *
 * #3688: 2048's Hint button (the action bar Mahjong shares), the suggested swipe over the board for
 * 2 s, cleared by a swipe, the 2 s "no hint" message, the always-on instruction lines gone, and
 * the layout at 390 x 844 and 320 x 568.
 */
import React from "react";
import { render, waitFor, fireEvent, act, within } from "@testing-library/react-native";
import { AccessibilityInfo, Dimensions, Platform } from "react-native";
import Twenty48Screen from "../Twenty48Screen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame, saveGame } from "../../game/twenty48/storage";
import type { Twenty48State } from "../../game/twenty48/types";

(Platform as { OS: string }).OS = "web";

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
const mockEnqueueEvent = jest.fn();
const mockEnqueueEvents = jest.fn();
jest.mock("../../game/_shared/gameEventClient", () =>
  mockScreenDeps().mockGameEventClient({
    startGame: jest.fn().mockReturnValue("game-id"),
    enqueueEvent: (...a: unknown[]) => mockEnqueueEvent(...a),
    enqueueEvents: (...a: unknown[]) => mockEnqueueEvents(...a),
  })
);
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({}));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());
jest.mock("../../game/_shared/displayNameSync", () => mockScreenDeps().mockDisplayNameSync({}));

const nav = {
  setOptions: jest.fn(),
  navigate: jest.fn(),
  goBack: jest.fn(),
  popToTop: jest.fn(),
  addListener: jest.fn(() => () => {}),
} as unknown as Parameters<typeof Twenty48Screen>[0]["navigation"];

type Cell = [row: number, col: number, value: number];
function stateOf(cells: Cell[], over = false): Twenty48State {
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
    game_over: over,
    has_won: false,
    startedAt: null,
    accumulatedMs: 0,
  };
}

// Up merges two pairs (columns 0 and 3), left merges one: the hint is up.
const HINT_UP = stateOf([
  [0, 0, 2],
  [1, 0, 2],
  [0, 3, 4],
  [1, 3, 4],
  [2, 1, 8],
  [2, 2, 8],
]);
// A full board with no equal neighbours: no move at all.
const STUCK = stateOf(
  [0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3].map((c): Cell => [r, c, (r + c) % 2 === 0 ? 2 : 4])),
  true
);

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

function setWindow(width: number, height: number) {
  Dimensions.set({ window: { width, height, scale: 2, fontScale: 1 } });
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  setWindow(750, 1334);
});

describe("2048 — instructions are not always on screen", () => {
  it("shows neither of the old instruction lines", async () => {
    const r = await open(HINT_UP);
    expect(r.queryByText("Swipe to move tiles")).toBeNull();
    expect(r.queryByText("Or use arrow keys")).toBeNull();
    expect(r.queryByTestId("twenty48-hint")).toBeNull();
  });

  it("has a Hint button, labelled, in the action bar under the board", async () => {
    const r = await open(HINT_UP);
    const bar = r.getByTestId("twenty48-action-bar");
    const hint = within(bar).getByTestId("twenty48-hint-button");
    expect(hint.props.accessibilityLabel).toBe("Show a hint: suggests a swipe for 2 seconds");
    expect(hint.props.accessibilityRole).toBe("button");
    expect(within(bar).getByText("Hint")).toBeTruthy();
    // New Game moved here from the top row, with the label it always had.
    expect(within(bar).getByLabelText("Start a new 2048 game")).toBeTruthy();
  });
});

describe("2048 — the hint", () => {
  it("shows the engine's swipe as an arrow and a label, and announces it", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const r = await open(HINT_UP);
    await fireEvent.press(r.getByTestId("twenty48-hint-button"));
    // Web: the arrow key too.
    expect(r.getByTestId("twenty48-hint-text")).toHaveTextContent("Swipe up or ↑");
    expect(announce).toHaveBeenCalledWith("Hint: Swipe up");
    // Over the board, not beside it.
    expect(within(r.getByTestId("twenty48-board")).getByTestId("twenty48-hint")).toBeTruthy();
  });

  it("leaves the game as it was: no move, no save, nothing recorded", async () => {
    const r = await open(HINT_UP);
    (saveGame as jest.Mock).mockClear();
    mockEnqueueEvent.mockClear();
    mockEnqueueEvents.mockClear();
    await fireEvent.press(r.getByTestId("twenty48-hint-button"));
    expect(saveGame).not.toHaveBeenCalled();
    expect(mockEnqueueEvent).not.toHaveBeenCalled();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    expect(r.getAllByText(/^\d+$/).map((n) => n.props.children)).toContain(8);
  });

  it("clears after 2 s", async () => {
    const r = await open(HINT_UP);
    jest.useFakeTimers();
    await fireEvent.press(r.getByTestId("twenty48-hint-button"));
    expect(r.getByTestId("twenty48-hint")).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1999);
    });
    expect(r.queryByTestId("twenty48-hint")).not.toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(r.queryByTestId("twenty48-hint")).toBeNull();
  });

  it("clears on a swipe (here an arrow key) and the swipe still moves", async () => {
    const r = await open(HINT_UP);
    await fireEvent.press(r.getByTestId("twenty48-hint-button"));
    expect(r.getByTestId("twenty48-hint")).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });
    expect(r.queryByTestId("twenty48-hint")).toBeNull();
    expect(saveGame).toHaveBeenCalled();
  });

  it("a second press restarts the 2 s", async () => {
    const r = await open(HINT_UP);
    jest.useFakeTimers();
    await fireEvent.press(r.getByTestId("twenty48-hint-button"));
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    await fireEvent.press(r.getByTestId("twenty48-hint-button"));
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(r.queryByTestId("twenty48-hint")).not.toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(r.queryByTestId("twenty48-hint")).toBeNull();
  });

  it("shows 'no hint' for 2 s on a stuck board, with no arrow", async () => {
    const r = await open(STUCK);
    // The game-over card is up over the stuck board, so its content counts as hidden.
    const any = { includeHiddenElements: true };
    jest.useFakeTimers();
    await fireEvent.press(r.getByTestId("twenty48-hint-button", any));
    expect(r.getByTestId("twenty48-no-hint-toast", any)).toHaveTextContent("No hint available");
    expect(r.queryByTestId("twenty48-hint", any)).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(r.queryByTestId("twenty48-no-hint-toast", any)).toBeNull();
  });

  it("is off while the win card is up", async () => {
    const won = { ...HINT_UP, has_won: true };
    const r = await open(won);
    expect(
      r.getByTestId("twenty48-hint-button", { includeHiddenElements: true }).props
        .accessibilityState.disabled
    ).toBe(true);
  });
});

describe("2048 — layout", () => {
  const SIZES: Array<[number, number, number]> = [
    // width, height, expected board width (the screen's width - 32, up to 360)
    [390, 844, 358],
    [320, 568, 288],
  ];

  it.each(SIZES)(
    "%i x %i: the board is centred in the free height at full width",
    async (w, h, board) => {
      setWindow(w, h);
      const r = await open(HINT_UP);
      // A free height as the shell leaves it: the window less the header (64), the stats row (~50),
      // the action bar (64), the bottom gap (16) and the status area.
      const free = h - 64 - 50 - 64 - 16 - 44;
      await fireEvent(r.getByTestId("twenty48-board-area"), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: w - 32, height: free } },
      });
      const grid = r.getByLabelText("Game board");
      const style = Object.assign({}, ...[grid.props.style].flat(Infinity).filter(Boolean));
      expect(style.width).toBe(board);
      expect(style.height).toBe(board);
      expect(style.height).toBeLessThanOrEqual(free);
      const area = r.getByTestId("twenty48-board-area");
      const areaStyle = Object.assign({}, ...[area.props.style].flat(Infinity).filter(Boolean));
      expect(areaStyle.justifyContent).toBe("center");
      expect(areaStyle.flex).toBe(1);
    }
  );

  it("caps the board to the free height when the screen is short", async () => {
    setWindow(390, 600);
    const r = await open(HINT_UP);
    await fireEvent(r.getByTestId("twenty48-board-area"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 358, height: 300 } },
    });
    const grid = r.getByLabelText("Game board");
    const style = Object.assign({}, ...[grid.props.style].flat(Infinity).filter(Boolean));
    expect(style.width).toBe(284); // 300 less 8 above and 8 below
  });

  it("puts the stats row, the board and the action bar all inside the swipe area", async () => {
    const r = await open(HINT_UP);
    const area = within(r.getByTestId("twenty48-play-area"));
    expect(area.getByTestId("twenty48-board")).toBeTruthy();
    expect(area.getByTestId("twenty48-action-bar")).toBeTruthy();
    expect(area.getByText("Highest Tile")).toBeTruthy();
    expect(area.getByText("Score")).toBeTruthy();
  });
});
