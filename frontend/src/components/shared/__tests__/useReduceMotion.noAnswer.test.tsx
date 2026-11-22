import React from "react";
import { AccessibilityInfo, Text } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import { useReducedMotion } from "react-native-reanimated";
import { resetReduceMotionForTests, useReduceMotionStatus } from "../useReduceMotion";

function Probe() {
  const { enabled, known } = useReduceMotionStatus();
  return <Text testID="rm">{`${enabled}:${known}`}</Text>;
}

afterEach(() => {
  resetReduceMotionForTests();
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockImplementation(() =>
    Promise.resolve(false)
  );
  jest.restoreAllMocks();
  (useReducedMotion as jest.Mock).mockReturnValue(false);
});

describe("useReduceMotion when the OS query gives no answer (#3606)", () => {
  it("does not throw, and carries on with the launch-time value as known", async () => {
    (useReducedMotion as jest.Mock).mockReturnValue(true);
    // A reset or restored mock of the query returns nothing, not a promise.
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockImplementation(() => undefined);
    await render(<Probe />);
    await act(async () => {});
    expect(screen.getByTestId("rm").props.children).toBe("true:true");
  });
});
