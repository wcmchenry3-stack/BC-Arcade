/**
 * #2956: the Mahjong layout detail screen (debug, opened from the inspector). It deals the layout
 * with a fixed seed into the read-only board, labels it with its tier and tile count, and lets
 * the board be pinched and panned within the camera's zoom bounds.
 *
 * The board (GameCanvas) is stubbed to record what it is given. Pinch and pan handlers are
 * captured from the gesture builders, and shared values are made stable across renders (the
 * global Reanimated mock re-creates them), so a gesture's effect shows up in the board's
 * animated transform after a re-render.
 */
import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";

import MahjongLayoutDetailScreen from "../MahjongLayoutDetailScreen";
import { LAYOUTS, getLayout } from "../../game/mahjong/layouts/registry";
import { createGame } from "../../game/mahjong/engine";
import type { MahjongState } from "../../game/mahjong/types";

const mockGoBack = jest.fn();
const mockRoute = { params: { layoutId: "turtle" } };
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({ goBack: mockGoBack, navigate: jest.fn() }), {
    useRoute: () => mockRoute,
  })
);

const mockBoard: { state: MahjongState | null; onTilePress: ((id: number) => void) | null } = {
  state: null,
  onTilePress: null,
};
jest.mock("../../components/mahjong/GameCanvas", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: (props: { state: MahjongState; onTilePress: (id: number) => void }) => {
      mockBoard.state = props.state;
      mockBoard.onTilePress = props.onTilePress;
      return <View testID="mahjong-board" />;
    },
  };
});

/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (e?: any) => void;
const mockGestures: Record<string, Record<string, Handler>> = {};
jest.mock("react-native-gesture-handler", () => {
  const builder = (kind: string) => () => {
    const handlers: Record<string, Handler> = {};
    mockGestures[kind] = handlers;
    const b: any = new Proxy(
      {},
      {
        get: (_t, prop: string) => (arg?: unknown) => {
          if (prop.startsWith("on")) handlers[prop] = arg as Handler;
          return b;
        },
      }
    );
    return b;
  };
  return {
    GestureDetector: ({ children }: any) => children,
    Gesture: {
      Pinch: builder("pinch"),
      Pan: builder("pan"),
      Simultaneous: (...g: unknown[]) => g,
    },
  };
});

/* eslint-enable @typescript-eslint/no-explicit-any */

// Stable shared values: one object per hook call site for the component's lifetime (the global
// mock in jest.setup.ts hands out a fresh object on every render).
const reanimated = jest.requireMock<Record<string, unknown>>("react-native-reanimated");
const globalUseSharedValue = reanimated.useSharedValue;
function useStableSharedValue(init: unknown) {
  return React.useState(() => ({ value: init }))[0];
}
beforeAll(() => {
  reanimated.useSharedValue = useStableSharedValue;
});
afterAll(() => {
  reanimated.useSharedValue = globalUseSharedValue;
});

beforeEach(() => {
  mockGoBack.mockClear();
  mockRoute.params.layoutId = "turtle";
  mockBoard.state = null;
});

/** The board's animated wrapper transform, as `{ translateX, translateY, scale }`. */
function boardTransform() {
  const wrapper = screen.getByTestId("mahjong-board").parent!;
  const style = StyleSheet.flatten(wrapper.props.style) as {
    transform: Record<string, number>[];
  };
  return Object.assign({}, ...style.transform) as {
    translateX: number;
    translateY: number;
    scale: number;
  };
}

describe("MahjongLayoutDetailScreen", () => {
  it("titles the board with the layout's name, tier and tile count", async () => {
    await render(<MahjongLayoutDetailScreen />);
    const turtle = LAYOUTS.find((m) => m.id === "turtle")!;
    expect(screen.getByText(turtle.name)).toBeTruthy();
    expect(screen.getByText(`T${turtle.tier} · ${turtle.tileCount} tiles`)).toBeTruthy();
  });

  it("deals the layout with the fixed inspector seed, so it always looks the same", async () => {
    mockRoute.params.layoutId = "pyramid";
    await render(<MahjongLayoutDetailScreen />);
    const expected = createGame(getLayout("pyramid"), 0);
    expect(mockBoard.state!.tiles).toEqual(expected.tiles);
    // Read-only: a tile press does nothing.
    expect(() => mockBoard.onTilePress!(expected.tiles[0]!.id)).not.toThrow();
  });

  it("an unknown layout id falls back to the turtle board, titled with the id", async () => {
    mockRoute.params.layoutId = "no-such-layout";
    await render(<MahjongLayoutDetailScreen />);
    expect(screen.getByText("no-such-layout")).toBeTruthy();
    expect(screen.queryByText(/tiles$/)).toBeNull();
    expect(mockBoard.state!.tiles).toEqual(createGame(getLayout("turtle"), 0).tiles);
  });

  it("back goes back", async () => {
    await render(<MahjongLayoutDetailScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Go back to home screen" }));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it("starts fitted and centred, then pinches within the zoom bounds", async () => {
    const { rerender } = await render(<MahjongLayoutDetailScreen />);
    const start = boardTransform();
    expect(start).toMatchObject({ translateX: 0, translateY: 0 });
    const min = start.scale;

    // Zoom out past the fit: clamped at the fitted scale.
    mockGestures.pinch!.onUpdate!({ scale: 0.25 });
    await rerender(<MahjongLayoutDetailScreen />);
    expect(boardTransform().scale).toBe(min);

    // Zoom in a little, release, then zoom in again from there.
    mockGestures.pinch!.onUpdate!({ scale: 1.2 });
    mockGestures.pinch!.onEnd!();
    await rerender(<MahjongLayoutDetailScreen />);
    const zoomed = boardTransform().scale;
    expect(zoomed).toBeCloseTo(min * 1.2);

    // A huge pinch stops at the max zoom.
    mockGestures.pinch!.onUpdate!({ scale: 1000 });
    await rerender(<MahjongLayoutDetailScreen />);
    const max = boardTransform().scale;
    expect(max).toBeGreaterThan(zoomed);
    expect(max).toBeLessThan(zoomed * 1000);
  });

  it("pans by the finger's translation, accumulating across gestures", async () => {
    const { rerender } = await render(<MahjongLayoutDetailScreen />);
    mockGestures.pan!.onUpdate!({ translationX: 30, translationY: -20 });
    mockGestures.pan!.onEnd!();
    await rerender(<MahjongLayoutDetailScreen />);
    expect(boardTransform()).toMatchObject({ translateX: 30, translateY: -20 });
    mockGestures.pan!.onUpdate!({ translationX: 5, translationY: 5 });
    await rerender(<MahjongLayoutDetailScreen />);
    expect(boardTransform()).toMatchObject({ translateX: 35, translateY: -15 });
  });
});
