import React from "react";
import { AccessibilityInfo } from "react-native";
import { render, act, fireEvent } from "@testing-library/react-native";
import { AnimationOverlay } from "../AnimationOverlay";

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AnimationOverlay — pointer events", () => {
  it("is pointer-transparent when visible=false", async () => {
    const { getByTestId } = await render(
      <AnimationOverlay visible={false} onDismiss={jest.fn()} />
    );
    const overlay = getByTestId("animation-overlay");
    expect(overlay.props.pointerEvents).toBe("none");
  });

  it("is interactive when visible=true", async () => {
    const { getByTestId } = await render(<AnimationOverlay visible={true} onDismiss={jest.fn()} />);
    const overlay = getByTestId("animation-overlay");
    expect(overlay.props.pointerEvents).toBe("auto");
  });
});

describe("AnimationOverlay — children", () => {
  it("renders children without crashing", async () => {
    const { getByTestId } = await render(
      <AnimationOverlay visible={true} onDismiss={jest.fn()}>
        <></>
      </AnimationOverlay>
    );
    expect(getByTestId("animation-overlay")).toBeTruthy();
  });

  it("calls onDismiss when backdrop is pressed", async () => {
    const onDismiss = jest.fn();
    const { getByTestId } = await render(<AnimationOverlay visible={true} onDismiss={onDismiss} />);
    // The Pressable backdrop is the first child of the overlay
    const overlay = getByTestId("animation-overlay");
    // Fire press on the first child (backdrop Pressable)
    await fireEvent.press(overlay.children[0]);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("AnimationOverlay — reduced motion", () => {
  it("renders the static fallback when isReduceMotionEnabled returns true", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);

    const { getByTestId } = await render(<AnimationOverlay visible={true} onDismiss={jest.fn()} />);

    // Flush the AccessibilityInfo.isReduceMotionEnabled promise.
    await act(async () => {});

    expect(getByTestId("animation-overlay-static")).toBeTruthy();
  });

  it("static fallback is pointer-transparent when visible=false", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);

    const { getByTestId } = await render(
      <AnimationOverlay visible={false} onDismiss={jest.fn()} />
    );
    await act(async () => {});

    const overlay = getByTestId("animation-overlay-static");
    expect(overlay.props.pointerEvents).toBe("none");
  });
});
