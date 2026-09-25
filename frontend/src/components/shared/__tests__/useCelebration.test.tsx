import React from "react";
import { Text } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useCelebration, type CelebrationReducedMotion } from "../useCelebration";

const TIMING = {
  badgeSpring: { damping: 10, stiffness: 120 },
  particleSpring: { damping: 8, stiffness: 100 },
  particleStaggerMs: 50,
  exitAtMs: 1000,
  doneAtMs: 1500,
  badgeFadeOutMs: 300,
  particleFadeOutMs: 200,
};

function Harness(props: {
  visible: boolean;
  onDone: () => void;
  reducedMotion: CelebrationReducedMotion;
}) {
  const { hidden, badgeStyle, particleStyles } = useCelebration({
    ...TIMING,
    ...props,
    particleCount: 3,
  });
  if (hidden) return null;
  return (
    <>
      <Text testID="badge" style={badgeStyle}>
        badge
      </Text>
      {particleStyles.map((s, i) => (
        <Text key={i} testID={`p${i}`} style={s}>
          p
        </Text>
      ))}
    </>
  );
}

const STATIC: CelebrationReducedMotion = { mode: "static", doneAfterMs: 700 };

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  (useReducedMotion as jest.Mock).mockReturnValue(false);
});

describe("useCelebration", () => {
  it("renders one animated style per particle and calls onDone at doneAtMs", async () => {
    const onDone = jest.fn();
    await render(<Harness visible onDone={onDone} reducedMotion={STATIC} />);
    expect(screen.getByTestId("p2")).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1499);
    });
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does nothing while not visible", async () => {
    const onDone = jest.fn();
    await render(<Harness visible={false} onDone={onDone} reducedMotion={STATIC} />);
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it("clears its timers on unmount", async () => {
    const onDone = jest.fn();
    const r = await render(<Harness visible onDone={onDone} reducedMotion={STATIC} />);
    await act(async () => {
      await r.unmount();
    });
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it("with Reduce Motion and a static policy, finishes at doneAfterMs instead of doneAtMs", async () => {
    (useReducedMotion as jest.Mock).mockReturnValue(true);
    const onDone = jest.fn();
    await render(<Harness visible onDone={onDone} reducedMotion={STATIC} />);
    // Still rendered (a still frame), unlike the skip policy.
    expect(screen.getByTestId("badge")).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(699);
    });
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    // The motion path's timers never ran.
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("with Reduce Motion and a skip policy, renders nothing and finishes at once", async () => {
    (useReducedMotion as jest.Mock).mockReturnValue(true);
    const onDone = jest.fn();
    await render(<Harness visible onDone={onDone} reducedMotion={{ mode: "skip" }} />);
    expect(screen.queryByTestId("badge")).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
