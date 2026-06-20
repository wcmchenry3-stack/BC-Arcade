/**
 * Smoke tests for the Mahjong GameCanvas component.
 *
 * Canvas rendering (Skia / Canvas 2D) is not assertable in Jest — tests
 * verify that the component mounts without crashing and that overlays
 * appear for the correct game states.
 */

import React from "react";
import { create, act } from "react-test-renderer";
import type { MahjongState } from "../../../game/mahjong/types";
import { createGame } from "../../../game/mahjong/engine";
import { TURTLE_LAYOUT } from "../../../game/mahjong/layouts/turtle";
import { calculateMahjongLayout, makeBoardCamera } from "../../../game/mahjong/layout";

// Skia requires a native module — stub the whole package.
jest.mock("@shopify/react-native-skia", () => ({
  Canvas: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Fill: () => null,
  Group: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Rect: () => null,
  ImageSVG: () => null,
  useSVG: () => null,
}));

// expo-asset is unavailable in jsdom — return a no-op stub.
jest.mock("expo-asset", () => ({
  Asset: {
    fromModule: () => ({
      downloadAsync: async () => {},
      localUri: null,
      uri: null,
    }),
  },
}));

// Use the web variant (no Skia). The canvas ref will be null in jsdom, which
// the component handles gracefully via the `if (!ctx) return` guard.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { default: GameCanvas } = require("../GameCanvas.web");

const testCamera = makeBoardCamera(
  calculateMahjongLayout({
    screenWidth: 768,
    screenHeight: 1024,
    safeAreaTop: 0,
    safeAreaBottom: 0,
    boardRows: 8,
    boardCols: 12,
    boardLayers: 4,
  })
);

function makeState(overrides: Partial<MahjongState> = {}): MahjongState {
  return { ...createGame(TURTLE_LAYOUT, 12345), ...overrides };
}

const noop = () => {};

describe("GameCanvas (web)", () => {
  it("renders without crashing on a fresh game", async () => {
    await act(() => {
      create(
        <GameCanvas
          state={makeState()}
          camera={testCamera}
          onTilePress={noop}
          onShufflePress={noop}
          onNewGamePress={noop}
        />
      );
    });
  });

  it("shows the win overlay when isComplete", async () => {
    const state = makeState({ isComplete: true, tiles: [], pairsRemoved: 72, score: 1220 });
    let tree: ReturnType<typeof create>;
    await act(() => {
      tree = create(
        <GameCanvas
          state={state}
          camera={testCamera}
          onTilePress={noop}
          onShufflePress={noop}
          onNewGamePress={noop}
        />
      );
    });
    // i18n returns keys in tests — check for the key, not the translated string.
    expect(JSON.stringify(tree!.toJSON())).toContain("overlay.youWon");
  });

  it("does not render the deadlock overlay locally (delegate to MahjongScreen)", async () => {
    // The overlay JSX lives in MahjongScreen so it covers the viewport, not the
    // board-sized canvas view. GameCanvas still tracks the 500 ms delay internally
    // (for gameActive), but must not render overlay text itself.
    jest.useFakeTimers();
    const state = makeState({ isDeadlocked: true, shufflesLeft: 0 });
    let tree: ReturnType<typeof create>;
    await act(() => {
      tree = create(
        <GameCanvas
          state={state}
          camera={testCamera}
          onTilePress={noop}
          onShufflePress={noop}
          onNewGamePress={noop}
        />
      );
    });
    expect(JSON.stringify(tree!.toJSON())).not.toContain("overlay.deadlocked");
    await act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(JSON.stringify(tree!.toJSON())).not.toContain("overlay.deadlocked");
    jest.useRealTimers();
  });

  it("does not render the shuffle CTA locally (delegate to MahjongScreen)", async () => {
    // tiles=[] means hasFreePairs([]) === false; isComplete=false, shufflesLeft>0 → showShuffleCTA=true
    // GameCanvas sets gameActive=false to block tile taps, but the overlay lives in MahjongScreen.
    const state = makeState({
      tiles: [],
      isComplete: false,
      isDeadlocked: false,
      shufflesLeft: 2,
    });
    let tree: ReturnType<typeof create>;
    await act(() => {
      tree = create(
        <GameCanvas
          state={state}
          camera={testCamera}
          onTilePress={noop}
          onShufflePress={noop}
          onNewGamePress={noop}
        />
      );
    });
    const str = JSON.stringify(tree!.toJSON());
    expect(str).not.toContain("overlay.noMoves");
    expect(str).not.toContain("overlay.shuffleButton");
  });

  it("does not show any overlay during normal play", async () => {
    const state = makeState();
    let tree: ReturnType<typeof create>;
    await act(() => {
      tree = create(
        <GameCanvas
          state={state}
          camera={testCamera}
          onTilePress={noop}
          onShufflePress={noop}
          onNewGamePress={noop}
        />
      );
    });
    const str = JSON.stringify(tree!.toJSON());
    expect(str).not.toContain("overlay.youWon");
    expect(str).not.toContain("overlay.noMoves");
    expect(str).not.toContain("overlay.deadlocked");
  });
});
