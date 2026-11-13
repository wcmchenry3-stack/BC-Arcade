/**
 * The HUD notice chip's holds and announcement (#3797): one timer per kind, restarted by a new
 * notice of that kind, cleared on reset and unmount; the full sentence announced once.
 */

import React from "react";
import { AccessibilityInfo } from "react-native";
import { act, render, renderHook } from "@testing-library/react-native";
import type { SharedValue } from "react-native-reanimated";

import HudNotice, { useHudNoticeHolds, type HudNoticeData } from "../HudNotice";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

describe("useHudNoticeHolds", () => {
  it("a second milestone 1500 ms into the first keeps its full 1800 ms hold", async () => {
    const { result } = await renderHook(() => useHudNoticeHolds());
    await act(async () => result.current.show("milestone", 1800, 100));
    await advance(1500);
    await act(async () => result.current.show("milestone", 1800, 200));
    await advance(1799);
    expect(result.current.milestone).toBe(200);
    await advance(1);
    expect(result.current.milestone).toBeNull();
  });

  it("a second comeback 2000 ms into the first keeps its full 2800 ms hold", async () => {
    const { result } = await renderHook(() => useHudNoticeHolds());
    await act(async () => result.current.show("comeback", 2800));
    await advance(2000);
    await act(async () => result.current.show("comeback", 2800));
    await advance(2799);
    expect(result.current.comeback).toBe(true);
    await advance(1);
    expect(result.current.comeback).toBe(false);
  });

  it("kinds hold independently", async () => {
    const { result } = await renderHook(() => useHudNoticeHolds());
    await act(async () => {
      result.current.show("milestone", 1800, 100);
      result.current.show("comeback", 2800);
    });
    await advance(1800);
    expect(result.current.milestone).toBeNull();
    expect(result.current.comeback).toBe(true);
    await advance(1000);
    expect(result.current.comeback).toBe(false);
  });

  it("reset clears the notices and their timers", async () => {
    const { result } = await renderHook(() => useHudNoticeHolds());
    await act(async () => result.current.show("comeback", 2800));
    await advance(1000);
    await act(async () => result.current.reset());
    expect(result.current.comeback).toBe(false);
    await act(async () => result.current.show("comeback", 2800));
    // The first hold's timer (due at 2800 ms) must not cut the new one short.
    await advance(1800);
    expect(result.current.comeback).toBe(true);
  });

  it("unmounting with a hold pending clears its timer", async () => {
    const clear = jest.spyOn(globalThis, "clearTimeout");
    const { result, unmount } = await renderHook(() => useHudNoticeHolds());
    await act(async () => result.current.show("comeback", 2800));
    const before = clear.mock.calls.length;
    await unmount();
    expect(clear.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("HudNotice announcement", () => {
  const notice = (label: string): HudNoticeData => ({
    kind: "milestone",
    text: "Milestone: 100",
    label,
    opacity: { value: 1 } as SharedValue<number>,
    background: "#000000",
  });

  it("announces the full sentence once, not again on a re-render", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const n = notice("Milestone reached: 100 chips!");
    const { rerender, getByTestId } = await render(<HudNotice notice={n} textColor="#ffffff" />);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("Milestone reached: 100 chips!");
    await rerender(<HudNotice notice={{ ...n }} textColor="#ffffff" />);
    expect(announce).toHaveBeenCalledTimes(1);
    const chip = getByTestId("blackjack-hud-notice");
    expect(chip.props.accessibilityLabel).toBe("Milestone reached: 100 chips!");
    expect(chip.props.accessibilityLiveRegion).toBeUndefined();
  });
});
