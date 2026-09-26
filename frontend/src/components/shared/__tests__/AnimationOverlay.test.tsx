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
    const overlay = getByTestId("animation-overlay", { includeHiddenElements: true });
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

    const overlay = getByTestId("animation-overlay-static", { includeHiddenElements: true });
    expect(overlay.props.pointerEvents).toBe("none");
  });
});

describe("AnimationOverlay — accessibility (#2711)", () => {
  it("labels the backdrop as the skip button when shown", async () => {
    const onDismiss = jest.fn();
    const { getByRole } = await render(<AnimationOverlay visible={true} onDismiss={onDismiss} />);
    const skip = getByRole("button", { name: "Skip celebration" });
    await fireEvent.press(skip);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("labels the backdrop in the reduced-motion fallback too", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const { getByRole, getByTestId } = await render(
      <AnimationOverlay visible={true} onDismiss={jest.fn()} />
    );
    await act(async () => {});
    expect(getByTestId("animation-overlay-static")).toBeTruthy();
    expect(getByRole("button", { name: "Skip celebration" })).toBeTruthy();
  });

  it("hides the overlay from screen readers while it is not shown", async () => {
    const { getByTestId, queryByRole } = await render(
      <AnimationOverlay visible={false} onDismiss={jest.fn()} />
    );
    const overlay = getByTestId("animation-overlay", { includeHiddenElements: true });
    expect(overlay.props["aria-hidden"]).toBe(true);
    expect(queryByRole("button", { name: "Skip celebration" })).toBeNull();
  });

  it("hides the reduced-motion fallback from screen readers while it is not shown", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const { getByTestId, queryByRole } = await render(
      <AnimationOverlay visible={false} onDismiss={jest.fn()} />
    );
    await act(async () => {});
    const overlay = getByTestId("animation-overlay-static", { includeHiddenElements: true });
    expect(overlay.props["aria-hidden"]).toBe(true);
    expect(queryByRole("button", { name: "Skip celebration" })).toBeNull();
  });
});

describe("AnimationOverlay — dismissTestID (#2643)", () => {
  it("puts the id on the backdrop only while shown, and pressing it dismisses", async () => {
    const onDismiss = jest.fn();
    const { queryByTestId, getByTestId, rerender } = await render(
      <AnimationOverlay visible={false} onDismiss={onDismiss} dismissTestID="cele" />
    );
    // Not merely hidden from queries: the idle overlay carries no such id at all.
    expect(queryByTestId("cele", { includeHiddenElements: true })).toBeNull();

    await rerender(<AnimationOverlay visible onDismiss={onDismiss} dismissTestID="cele" />);
    await fireEvent.press(getByTestId("cele"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("adds no id when none is given", async () => {
    const { getByRole } = await render(<AnimationOverlay visible onDismiss={jest.fn()} />);
    expect(getByRole("button", { name: "Skip celebration" }).props.testID).toBeUndefined();
  });
});
