/**
 * MahjongScreen board interaction (#2957): the pinch and pan gestures on the
 * board, the developer panel, a hint cleared by the next tap, the shuffle
 * prompt's zoom-to-fit under Reduce Motion, CONTINUE from a saved game, and
 * the exits. The tile canvas is a stand-in of pressable tiles; the gesture
 * handler records the board's gesture so a test can fire its callbacks.
 */

import React from "react";
import { AccessibilityInfo, Platform, StyleSheet } from "react-native";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import MahjongScreen from "../MahjongScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import * as mahjongStorage from "../../game/mahjong/storage";
import type { MahjongState } from "../../game/mahjong/types";
import { detectedGesture } from "../../test-utils/mockScreenDeps";
import type { DetectorRender } from "../../test-utils/mockScreenDeps";

const mockDetected: DetectorRender[] = [];
jest.mock("react-native-gesture-handler", () =>
  mockScreenDeps().mockGestureHandler(() => mockDetected)
);

jest.mock("../../components/mahjong/GameCanvas", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View, Pressable, Text } = require("react-native");
  function MockGameCanvas({
    state,
    onTilePress,
    hintIds,
  }: {
    state: { tiles: readonly { id: number }[] };
    onTilePress: (id: number) => void;
    hintIds: ReadonlySet<number>;
  }) {
    return (
      <View testID="game-canvas">
        {state.tiles.map((tile) => (
          <Pressable
            key={tile.id}
            accessibilityLabel={`mock-tile-${tile.id}`}
            onPress={() => onTilePress(tile.id)}
          />
        ))}
        <Text testID="hint-ids-size">{hintIds?.size ?? 0}</Text>
      </View>
    );
  }
  MockGameCanvas.displayName = "MockGameCanvas";
  return { __esModule: true, default: MockGameCanvas };
});

const mockLoadTileAssets = jest.fn();
jest.mock("../../components/mahjong/tileAssetLoader", () => ({
  loadTileAssets: () => mockLoadTileAssets(),
}));

const mockPopToTop = jest.fn();
const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(
    () => ({
      popToTop: mockPopToTop,
      goBack: jest.fn(),
      navigate: mockNavigate,
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    { useFocusEffect: () => undefined }
  )
);
jest.mock("../../game/_shared/gameEventClient", () => mockScreenDeps().mockGameEventClient());
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getGameRank: jest.fn() }));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());
jest.mock("../../game/_shared/displayNameSync", () => mockScreenDeps().mockDisplayNameSync());

/** A board in progress with one free matching pair, ids 0 and 1. */
function pairBoard(overrides: Partial<MahjongState> = {}): MahjongState {
  return {
    _v: 1,
    tiles: [
      { id: 0, suit: "characters", rank: 1, faceId: 8, col: 0, row: 0, layer: 0 },
      { id: 1, suit: "characters", rank: 1, faceId: 8, col: 2, row: 0, layer: 0 },
    ],
    selected: null,
    pairsRemoved: 0,
    score: 0,
    shufflesLeft: 3,
    undoStack: [],
    isComplete: false,
    isDeadlocked: false,
    startedAt: null,
    accumulatedMs: 0,
    dealId: "TEST",
    ...overrides,
  } as unknown as MahjongState;
}

/** Two tiles stacked, so nothing but the top one is free: no pair to match. */
function blockedBoard(): MahjongState {
  return pairBoard({
    tiles: [
      { id: 0, suit: "characters", rank: 1, faceId: 8, col: 0, row: 0, layer: 0 },
      { id: 1, suit: "characters", rank: 1, faceId: 8, col: 0, row: 0, layer: 1 },
    ] as unknown as MahjongState["tiles"],
  });
}

async function mountOn(state: MahjongState | null) {
  if (state) await AsyncStorage.setItem("mahjong_game", JSON.stringify(state));
  const view = await render(
    <ThemeProvider>
      <MahjongScreen />
    </ThemeProvider>
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

const press = (label: string) =>
  act(async () => {
    await fireEvent.press(screen.getByLabelText(label));
  });

const HINT = "Show a hint — highlights one valid pair for 2 seconds";

beforeEach(async () => {
  jest.clearAllMocks();
  mockDetected.length = 0;
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("board gestures", () => {
  /** The board's transform now, read from the viewport's first child. */
  function transform() {
    const board = screen.getByTestId("mahjong-board-viewport").children[0] as {
      props: { style: unknown };
    };
    const t = StyleSheet.flatten(board.props.style as never).transform as Array<
      Record<string, number>
    >;
    return {
      x: t.find((e) => "translateX" in e)!.translateX!,
      y: t.find((e) => "translateY" in e)!.translateY!,
      scale: t.find((e) => "scale" in e)!.scale!,
    };
  }
  const refresh = () =>
    screen.rerender(
      <ThemeProvider>
        <MahjongScreen />
      </ThemeProvider>
    );
  const pinch = () => detectedGesture(mockDetected, "pinch")!;
  const pan = () => detectedGesture(mockDetected, "pan")!;

  async function pinchTo(factor: number) {
    await act(async () => {
      pinch().onUpdate!({ scale: factor });
      pinch().onEnd!();
    });
    await refresh();
  }

  it("starts fitted to the screen, with no offset", async () => {
    await mountOn(pairBoard());
    const start = transform();
    expect(start.x).toBe(0);
    expect(start.y).toBe(0);
    expect(start.scale).toBeGreaterThan(0);
  });

  it("zooms in with a pinch, up to a limit", async () => {
    await mountOn(pairBoard());
    const fitted = transform().scale;
    await pinchTo(1.2);
    expect(transform().scale).toBeCloseTo(fitted * 1.2, 5);

    await pinchTo(1000);
    const limit = transform().scale;
    expect(limit).toBeGreaterThan(fitted * 1.2);
    await pinchTo(1000);
    expect(transform().scale).toBe(limit);
  });

  it("never zooms out past fitted to the screen", async () => {
    await mountOn(pairBoard());
    const fitted = transform().scale;
    await pinchTo(0.001);
    expect(transform().scale).toBe(fitted);
  });

  it("cannot pan a board that fits the screen", async () => {
    await mountOn(pairBoard());
    await act(async () => {
      pan().onUpdate!({ translationX: 500, translationY: -500 });
      pan().onEnd!();
    });
    await refresh();
    expect(transform().x).toBeCloseTo(0, 5);
    expect(transform().y).toBeCloseTo(0, 5);
  });

  it("pans a zoomed-in board, up to its edges, and keeps the offset between drags", async () => {
    await mountOn(pairBoard());
    await pinchTo(1000);

    await act(async () => {
      pan().onUpdate!({ translationX: 100_000, translationY: 100_000 });
    });
    await refresh();
    const edge = transform();
    expect(edge.x).toBeGreaterThan(0);

    await act(async () => {
      pan().onUpdate!({ translationX: -100_000, translationY: -100_000 });
    });
    await refresh();
    expect(transform().x).toBeCloseTo(-edge.x, 5);
    expect(transform().y).toBeCloseTo(-edge.y, 5);

    // The drag ends there; the next drag starts from that offset.
    await act(async () => {
      pan().onEnd!();
    });
    await act(async () => {
      pan().onUpdate!({ translationX: 10, translationY: 0 });
    });
    await refresh();
    expect(transform().x).toBeCloseTo(-edge.x + 10, 5);
  });

  it("pulls the offset back inside the edges when zooming out", async () => {
    await mountOn(pairBoard());
    await pinchTo(1000);
    await act(async () => {
      pan().onUpdate!({ translationX: 100_000, translationY: 100_000 });
      pan().onEnd!();
    });
    await refresh();
    expect(transform().x).toBeGreaterThan(0);

    await pinchTo(0.001);
    expect(transform().x).toBeCloseTo(0, 5);
    expect(transform().y).toBeCloseTo(0, 5);
  });
});

describe("hints", () => {
  it("a tile tap clears the hint at once", async () => {
    jest.useFakeTimers();
    await mountOn(pairBoard());
    await press(HINT);
    expect(screen.getByTestId("hint-ids-size").props.children).toBe(2);
    await press("mock-tile-0");
    expect(screen.getByTestId("hint-ids-size").props.children).toBe(0);
  });

  it("the hint fades by itself after two seconds", async () => {
    jest.useFakeTimers();
    await mountOn(pairBoard());
    await press(HINT);
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId("hint-ids-size").props.children).toBe(0);
  });

  it("asking again restarts the two seconds", async () => {
    jest.useFakeTimers();
    await mountOn(pairBoard());
    await press(HINT);
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    await press(HINT);
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(screen.getByTestId("hint-ids-size").props.children).toBe(2);
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(screen.getByTestId("hint-ids-size").props.children).toBe(0);
  });

  it("the no-hint message goes away by itself, and restarts when asked again", async () => {
    jest.useFakeTimers();
    await mountOn(blockedBoard());
    await press(HINT);
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    await press(HINT);
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(screen.getByTestId("no-hint-toast")).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(screen.queryByTestId("no-hint-toast")).toBeNull();
  });
});

describe("shuffle prompt", () => {
  it("shows when no pair is free, and shuffling from it uses a shuffle", async () => {
    await mountOn(blockedBoard());
    expect(screen.getByText("NO MOVES")).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByText(/^Shuffle \(3\)/));
    });
    expect(screen.getByText(/SHUFFLE 2/)).toBeTruthy();
  });

  it("is shown under Reduce Motion too", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    await mountOn(blockedBoard());
    expect(screen.getByText("NO MOVES")).toBeTruthy();
  });
});

describe("developer panel", () => {
  const open = () => press("Toggle dev panel");

  it("opens and closes from the DEV button", async () => {
    await mountOn(pairBoard());
    expect(screen.queryByText("DEV — Mahjong")).toBeNull();
    await open();
    expect(screen.getByText("DEV — Mahjong")).toBeTruthy();
    await open();
    expect(screen.queryByText("DEV — Mahjong")).toBeNull();
  });

  it("opens from a long press on the clock", async () => {
    await mountOn(pairBoard());
    await act(async () => {
      await fireEvent(screen.getByTestId("mahjong-clock"), "longPress");
    });
    expect(screen.getByText("DEV — Mahjong")).toBeTruthy();
  });

  it("shows the board's numbers and its free pairs", async () => {
    await mountOn(pairBoard());
    await open();
    expect(screen.getByText("tiles: 2 / pairs removed: 0")).toBeTruthy();
    expect(screen.getByText("free tiles: 2 / free pairs: 1")).toBeTruthy();
    expect(screen.getByText("shuffles left: 3 / score: 0")).toBeTruthy();
    expect(screen.getByText("deal #TEST / undo depth: 0")).toBeTruthy();
    expect(screen.getByText("free pairs")).toBeTruthy();
    expect(screen.getByText(/c1 ↔ c1 \(ids 0,1\)/)).toBeTruthy();
    expect(screen.queryByText("no free pairs")).toBeNull();
  });

  it("says so when there are no free pairs", async () => {
    await mountOn(blockedBoard());
    await open();
    expect(screen.getByText("no free pairs")).toBeTruthy();
    expect(screen.queryByText("free pairs")).toBeNull();
  });

  it("switches the free-tile overlay on and off", async () => {
    await mountOn(pairBoard());
    await open();
    expect(screen.getByText("overlay: off")).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByText("overlay: off"));
    });
    expect(screen.getByText("overlay: ON")).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByText("overlay: ON"));
    });
    expect(screen.getByText("overlay: off")).toBeTruthy();
  });

  it("opens the layout inspector", async () => {
    await mountOn(pairBoard());
    await open();
    await act(async () => {
      await fireEvent.press(screen.getByText("Layout Inspector →"));
    });
    expect(mockNavigate).toHaveBeenCalledWith("MahjongLayoutInspector");
  });
});

describe("on web", () => {
  const listeners = new Map<string, (e: { shiftKey: boolean; key: string }) => void>();
  const original = {
    add: (window as unknown as Record<string, unknown>).addEventListener,
    remove: (window as unknown as Record<string, unknown>).removeEventListener,
  };

  beforeEach(() => {
    jest.replaceProperty(Platform, "OS", "web");
    listeners.clear();
    Object.assign(window, {
      addEventListener: jest.fn((type: string, cb: never) => listeners.set(type, cb)),
      removeEventListener: jest.fn((type: string) => listeners.delete(type)),
    });
    mockLoadTileAssets.mockResolvedValue(["a.svg", "b.svg"]);
  });

  afterEach(async () => {
    // Unmount while the stand-ins are still there: the screen removes its listener.
    await cleanup();
    Object.assign(window, { addEventListener: original.add, removeEventListener: original.remove });
  });

  it("loads the tile images for the flying pair", async () => {
    await mountOn(pairBoard());
    expect(mockLoadTileAssets).toHaveBeenCalled();
  });

  it("Shift+D toggles the developer panel", async () => {
    await mountOn(pairBoard());
    const key = (shiftKey: boolean, k: string) =>
      act(async () => {
        listeners.get("keydown")!({ shiftKey, key: k });
      });
    await key(true, "D");
    expect(screen.getByText("DEV — Mahjong")).toBeTruthy();
    await key(false, "D"); // no Shift: ignored
    expect(screen.getByText("DEV — Mahjong")).toBeTruthy();
    await key(true, "D");
    expect(screen.queryByText("DEV — Mahjong")).toBeNull();
  });

  it("stops listening when the screen goes away", async () => {
    const view = await mountOn(pairBoard());
    expect(listeners.has("keydown")).toBe(true);
    await view.unmount();
    expect(listeners.has("keydown")).toBe(false);
  });
});

describe("CONTINUE", () => {
  /** Plays a saved board, then leaves it through New Game to the layout picker. */
  async function toLayoutPicker() {
    await mountOn(pairBoard());
    await press("More options");
    await act(async () => {
      await fireEvent.press(screen.getByText("New Game"));
    });
    const confirm = screen.queryByLabelText("Start New");
    if (confirm) {
      await act(async () => {
        await fireEvent.press(confirm);
      });
    }
    expect(screen.getByLabelText("Continue")).toBeTruthy();
  }

  it("goes back to the saved board", async () => {
    await toLayoutPicker();
    await press("Continue");
    expect(screen.getByLabelText("mock-tile-0")).toBeTruthy();
    expect(screen.queryByLabelText("Continue")).toBeNull();
  });

  it("drops the button when the save has gone", async () => {
    await toLayoutPicker();
    await AsyncStorage.removeItem("mahjong_game");
    await press("Continue");
    expect(screen.queryByLabelText("Continue")).toBeNull();
    expect(screen.queryByLabelText("mock-tile-0")).toBeNull();
    expect(screen.getByLabelText("Turtle")).toBeTruthy();
  });

  it("drops the button when the save cannot be read", async () => {
    await toLayoutPicker();
    jest.spyOn(mahjongStorage, "loadGame").mockRejectedValueOnce(new Error("disk"));
    await press("Continue");
    expect(screen.queryByLabelText("Continue")).toBeNull();
    expect(screen.getByLabelText("Turtle")).toBeTruthy();
  });
});

describe("leaving", () => {
  it("goes back to the lobby from the layout picker", async () => {
    await mountOn(null);
    await press("Go back to home screen");
    expect(mockPopToTop).toHaveBeenCalledTimes(1);
  });

  it("goes back to the lobby from the board", async () => {
    await mountOn(pairBoard());
    await press("Go back to home screen");
    expect(mockPopToTop).toHaveBeenCalledTimes(1);
  });

  it("goes home from a won board's card", async () => {
    await mountOn(pairBoard({ tiles: [], isComplete: true, pairsRemoved: 72, score: 3600 }));
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Home" }));
    });
    expect(mockPopToTop).toHaveBeenCalledTimes(1);
  });
});
