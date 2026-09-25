import React from "react";
import { act, render } from "@testing-library/react-native";
import { useReducedMotion } from "react-native-reanimated";
import { YachtCelebrationAnimation } from "../YachtCelebrationAnimation";

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  (useReducedMotion as jest.Mock).mockReturnValue(false);
});

describe("YachtCelebrationAnimation (#2606)", () => {
  it("plays for 2.8 s, then dismisses", async () => {
    const onDismiss = jest.fn();
    await render(<YachtCelebrationAnimation visible onDismiss={onDismiss} />);
    await act(async () => {
      jest.advanceTimersByTime(2799);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("with Reduce Motion on, shows a still frame and dismisses after 1.5 s", async () => {
    (useReducedMotion as jest.Mock).mockReturnValue(true);
    const onDismiss = jest.fn();
    const r = await render(<YachtCelebrationAnimation visible onDismiss={onDismiss} />);
    expect(r.getByText("YACHT!")).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
