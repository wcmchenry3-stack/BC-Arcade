import React from "react";
import { AccessibilityInfo, Text } from "react-native";
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

/** Reduce Motion on both at launch and in the live setting. */
function reduceMotionOn() {
  (useReducedMotion as jest.Mock).mockReturnValue(true);
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  // The preset's AccessibilityInfo methods are shared jest.fns; put them back.
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockImplementation(() =>
    Promise.resolve(false)
  );
  (AccessibilityInfo.addEventListener as jest.Mock).mockImplementation(() => ({
    remove: jest.fn(),
  }));
  jest.useRealTimers();
  jest.restoreAllMocks();
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
    reduceMotionOn();
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
    reduceMotionOn();
    const onDone = jest.fn();
    await render(<Harness visible onDone={onDone} reducedMotion={{ mode: "skip" }} />);
    expect(screen.queryByTestId("badge")).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("uses the setting as it is when the celebration starts, not at app launch", async () => {
    // Launched with Reduce Motion off; the player turns it on before winning.
    let emit: (v: boolean) => void = () => {};
    jest
      .spyOn(AccessibilityInfo, "addEventListener")
      .mockImplementation((_e: string, handler: (v: boolean) => void) => {
        emit = handler;
        return { remove: jest.fn() } as unknown as ReturnType<
          typeof AccessibilityInfo.addEventListener
        >;
      });
    const onDone = jest.fn();
    const r = await render(<Harness visible={false} onDone={onDone} reducedMotion={STATIC} />);
    await act(async () => emit(true));
    await r.rerender(<Harness visible onDone={onDone} reducedMotion={STATIC} />);
    await act(async () => {
      jest.advanceTimersByTime(700);
    });
    // The still-frame path, not the 1.5 s motion path.
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
