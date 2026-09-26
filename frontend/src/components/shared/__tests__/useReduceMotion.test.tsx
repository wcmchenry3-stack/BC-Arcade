import React from "react";
import { AccessibilityInfo, Text } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useReduceMotion } from "../useReduceMotion";

function Probe() {
  return <Text testID="rm">{String(useReduceMotion())}</Text>;
}

type Listener = (value: boolean) => void;

function captureListener() {
  let listener: Listener = () => {};
  const remove = jest.fn();
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockImplementation((_event: string, handler: Listener) => {
      listener = handler;
      return { remove } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>;
    });
  return { emit: (v: boolean) => listener(v), remove };
}

afterEach(() => {
  // The preset's AccessibilityInfo methods are shared jest.fns; put them back.
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockImplementation(() =>
    Promise.resolve(false)
  );
  (AccessibilityInfo.addEventListener as jest.Mock).mockImplementation(() => ({
    remove: jest.fn(),
  }));
  jest.restoreAllMocks();
  (useReducedMotion as jest.Mock).mockReturnValue(false);
});

describe("useReduceMotion", () => {
  it("starts from the launch-time value before the async read lands", async () => {
    (useReducedMotion as jest.Mock).mockReturnValue(true);
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockReturnValue(new Promise(() => {}));
    await render(<Probe />);
    expect(screen.getByTestId("rm").props.children).toBe("true");
  });

  it("takes the current setting when it differs from the launch value", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    await render(<Probe />);
    await act(async () => {});
    expect(screen.getByTestId("rm").props.children).toBe("true");
  });

  it("follows the setting when the player changes it mid-session", async () => {
    const { emit } = captureListener();
    await render(<Probe />);
    await act(async () => {});
    expect(screen.getByTestId("rm").props.children).toBe("false");
    await act(async () => emit(true));
    expect(screen.getByTestId("rm").props.children).toBe("true");
    await act(async () => emit(false));
    expect(screen.getByTestId("rm").props.children).toBe("false");
  });

  it("unsubscribes on unmount", async () => {
    const { remove } = captureListener();
    const r = await render(<Probe />);
    await act(async () => {
      await r.unmount();
    });
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
