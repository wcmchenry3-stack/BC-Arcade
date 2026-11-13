/**
 * #3684 render readout (MahjongRenderDiag): nothing at all outside a test build or on web; in
 * a test build on native a "diag" chip opens a readout refreshed twice a second, the variant
 * buttons pick a variant and re-deal, and the UI heartbeat runs only while switched on.
 */
import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { Platform } from "react-native";
import * as Reanimated from "react-native-reanimated";

import MahjongRenderDiag, { DIAG_REFRESH_MS } from "../MahjongRenderDiag";
import { getRenderVariant, noteDealStart, resetRenderDiag } from "../../../game/mahjong/renderDiag";

const ORIGINAL = process.env.EXPO_PUBLIC_TEST_HOOKS;
const setActive = jest.fn();
let frame: (() => void) | undefined;

beforeEach(() => {
  process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
  resetRenderDiag();
  setActive.mockClear();
  frame = undefined;
  jest.useFakeTimers();
  jest.spyOn(Reanimated, "useFrameCallback").mockImplementation(((cb: () => void) => {
    frame = cb;
    return { setActive, isActive: false, callbackId: 1 };
  }) as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  if (ORIGINAL === undefined) delete process.env.EXPO_PUBLIC_TEST_HOOKS;
  else process.env.EXPO_PUBLIC_TEST_HOOKS = ORIGINAL;
  resetRenderDiag();
});

async function mount(onRedeal = jest.fn()) {
  await render(
    <MahjongRenderDiag
      motionTiles={144}
      dealing={() => true}
      reduceMotion={false}
      onRedeal={onRedeal}
    />
  );
  return onRedeal;
}

const readout = () =>
  within(screen.getByTestId("mahjong-diag"))
    .queryAllByText(/=/)
    .map((n) => String(n.props.children));

describe("MahjongRenderDiag (#3684)", () => {
  it("renders nothing outside a test build", async () => {
    delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    await mount();
    expect(screen.queryByTestId("mahjong-diag-toggle")).toBeNull();
    expect(screen.queryByTestId("mahjong-diag")).toBeNull();
    expect(screen.queryByTestId("mahjong-variant-b")).toBeNull();
    expect(screen.toJSON()).toBeNull();
  });

  it("renders nothing on web, even in a test build", async () => {
    jest.replaceProperty(Platform, "OS", "web");
    await mount();
    expect(screen.toJSON()).toBeNull();
  });

  it("shows only the chip until it is tapped, then the readout, refreshed twice a second", async () => {
    await mount();
    expect(screen.getByTestId("mahjong-diag-toggle")).toBeTruthy();
    expect(screen.queryByTestId("mahjong-diag")).toBeNull();
    await fireEvent.press(screen.getByTestId("mahjong-diag-toggle"));
    expect(readout()).toContain("motion=144 dealing=Y p=-");
    const progress = { value: 0.1 };
    await act(async () => {
      noteDealStart(progress);
    });
    progress.value = 0.25;
    await act(async () => {
      jest.advanceTimersByTime(DIAG_REFRESH_MS);
    });
    expect(readout()).toContain("motion=144 dealing=Y p=0.250");
    expect(readout()).toContain("deals=1 dealTimer=0 skip=0");
  });

  it("the UI heartbeat runs only while switched on, and counts frames", async () => {
    await mount();
    await fireEvent.press(screen.getByTestId("mahjong-diag-toggle"));
    expect(setActive).toHaveBeenLastCalledWith(false);
    expect(readout().some((l) => l.startsWith("ui=off"))).toBe(true);
    await fireEvent.press(screen.getByTestId("mahjong-diag-ui-hb"));
    expect(setActive).toHaveBeenLastCalledWith(true);
    frame!();
    frame!();
    await act(async () => {
      jest.advanceTimersByTime(DIAG_REFRESH_MS);
    });
    expect(readout().some((l) => l.startsWith("ui=2f"))).toBe(true);
  });

  it("a variant button picks the variant, turns the heartbeat off and re-deals", async () => {
    const onRedeal = await mount();
    await fireEvent.press(screen.getByTestId("mahjong-diag-toggle"));
    await fireEvent.press(screen.getByTestId("mahjong-diag-ui-hb"));
    await fireEvent.press(screen.getByTestId("mahjong-variant-a"));
    expect(getRenderVariant()).toBe("a");
    expect(screen.getByText("old (a)")).toBeTruthy();
    expect(screen.getByText("fixed (c)")).toBeTruthy();
    expect(onRedeal).toHaveBeenCalledTimes(1);
    expect(setActive).toHaveBeenLastCalledWith(false);
    await fireEvent.press(screen.getByTestId("mahjong-variant-b"));
    expect(getRenderVariant()).toBe("b");
    expect(onRedeal).toHaveBeenCalledTimes(2);
  });
});
