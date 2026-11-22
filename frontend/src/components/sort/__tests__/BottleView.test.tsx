import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { AccessibilityInfo, StyleSheet } from "react-native";
import { resetReduceMotionForTests } from "../../shared/useReduceMotion";
import {
  COMPLETE_BADGE_MS,
  COMPLETE_PULSE_MS,
  REFUSED_SHAKE_MS,
  SELECT_LIFT_MS,
  SELECT_SETTLE_MS,
} from "../../../game/sort/motion";
import { ThemeProvider } from "../../../theme/ThemeContext";
import BottleView, { COLORBLIND_SYMBOLS } from "../BottleView";
import type { Color } from "../../../game/sort/types";

function withTheme(children: React.ReactNode) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe("BottleView", () => {
  it("labels an empty bottle correctly", async () => {
    const { getByLabelText } = await render(withTheme(<BottleView bottle={[]} index={0} />));
    expect(getByLabelText("Bottle 1, empty")).toBeTruthy();
  });

  it("labels a partially filled bottle with count info", async () => {
    const bottle: Color[] = ["red", "blue"];
    const { getByLabelText } = await render(withTheme(<BottleView bottle={bottle} index={1} />));
    expect(getByLabelText("Bottle 2, 2 of 4 filled")).toBeTruthy();
  });

  it("labels a selected bottle with the pour instruction", async () => {
    const bottle: Color[] = ["red"];
    const { getByLabelText } = await render(
      withTheme(<BottleView bottle={bottle} index={2} selected />)
    );
    expect(getByLabelText(/Bottle 3 selected/)).toBeTruthy();
  });

  it("labels a solved bottle as complete", async () => {
    const solved: Color[] = ["red", "red", "red", "red"];
    const { getByLabelText } = await render(withTheme(<BottleView bottle={solved} index={0} />));
    expect(getByLabelText("Bottle 1, complete")).toBeTruthy();
  });

  it("fires onTap when pressed", async () => {
    const onTap = jest.fn();
    const { getByLabelText } = await render(
      withTheme(<BottleView bottle={[]} index={0} onTap={onTap} />)
    );
    await fireEvent.press(getByLabelText("Bottle 1, empty"));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("renders a ball for each color in the bottle", async () => {
    const bottle: Color[] = ["red", "blue", "green"];
    const { getByLabelText } = await render(withTheme(<BottleView bottle={bottle} index={0} />));
    expect(getByLabelText("Red")).toBeTruthy();
    expect(getByLabelText("Blue")).toBeTruthy();
    expect(getByLabelText("Green")).toBeTruthy();
  });
});

// #3658: Colorblind Mode symbols draw as plain text glyphs on iOS and Android, never as emoji.
describe("COLORBLIND_SYMBOLS (#3658)", () => {
  const entries = Object.entries(COLORBLIND_SYMBOLS);
  // The shape family of each symbol (see the comment on COLORBLIND_SYMBOLS). No two colours
  // may share one, so they stay apart at a glance.
  const FAMILY: Record<string, string> = {
    "▲": "triangle",
    "●": "circle",
    "■": "square",
    "★": "star",
    "⬡": "hexagon",
    "◆": "diamond",
    "✱": "asterisk",
    "✚": "plus",
    "↑": "arrow",
    "✿": "flower",
    "♪": "note",
    "∞": "infinity",
    "☾": "crescent",
    "✕": "cross",
  };

  it("has a symbol for every colour, all different", () => {
    expect(entries).toHaveLength(14);
    expect(new Set(Object.values(COLORBLIND_SYMBOLS)).size).toBe(entries.length);
  });

  it("gives every colour its own shape family", () => {
    const families = Object.values(COLORBLIND_SYMBOLS).map((s) => FAMILY[s]);
    expect(families).not.toContain(undefined);
    expect(new Set(families).size).toBe(entries.length);
  });

  it.each(entries)("%s: a single plain text glyph, not emoji-capable", (_color, symbol) => {
    // One code point: no variation selector (U+FE0E or U+FE0F) to be dropped or drawn as a box
    // by Android's per-glyph SVG text layout.
    expect([...symbol]).toHaveLength(1);
    expect(symbol).not.toMatch(/\p{Emoji}/u);
    expect(symbol).not.toMatch(/\p{Emoji_Presentation}/u);
    expect(symbol).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("BottleView hint destination (#3658)", () => {
  it("adds the hint to the bottle's label only when it is the destination", async () => {
    const bottle: Color[] = ["red"];
    const { getByLabelText, queryByLabelText, rerender } = await render(
      withTheme(<BottleView bottle={bottle} index={0} hintTarget />)
    );
    expect(getByLabelText("Bottle 1, 1 of 4 filled. Hint: pour here")).toBeTruthy();
    await rerender(withTheme(<BottleView bottle={bottle} index={0} />));
    expect(queryByLabelText(/Hint: pour here/)).toBeNull();
    expect(getByLabelText("Bottle 1, 1 of 4 filled")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// #3660 — select lift, refused shake, bottle-complete pulse, level-in
// ---------------------------------------------------------------------------

describe("BottleView motion (#3660)", () => {
  // The jest Reanimated mock runs `withTiming` as a plain function, so spying on it shows
  // which animations a change starts, and with what duration.
  const reanimated = jest.requireMock("react-native-reanimated") as {
    withTiming: (v: number, cfg?: { duration?: number }) => number;
    withRepeat: (v: unknown) => unknown;
  };
  let timing: jest.SpyInstance;
  let repeat: jest.SpyInstance;
  let reduceQuery: jest.SpyInstance | undefined;
  const open: Color[] = ["red", "blue"];
  const solved: Color[] = ["red", "red", "red", "red"];
  const almost: Color[] = ["red", "red", "red"];

  beforeEach(() => {
    resetReduceMotionForTests();
    timing = jest.spyOn(reanimated, "withTiming");
    repeat = jest.spyOn(reanimated, "withRepeat");
  });
  afterEach(() => {
    timing.mockRestore();
    repeat.mockRestore();
    reduceQuery?.mockRestore();
    reduceQuery = undefined;
    resetReduceMotionForTests();
  });
  const reduceMotionOn = () => {
    reduceQuery = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  };

  type Styled = { props: { style?: unknown } };
  const style = (getByTestId: (id: string) => Styled, index = 0) =>
    StyleSheet.flatten(getByTestId(`bottle-view-${index}`).props.style) as {
      opacity?: number;
      transform: Record<string, number>[];
    };
  const translate = (st: ReturnType<typeof style>, key: string) =>
    st.transform.find((t) => key in t)![key]!;

  describe("select", () => {
    it("lifts once, in the select duration, and does not repeat", async () => {
      const { rerender } = await render(
        withTheme(<BottleView bottle={open} index={0} bottleHeight={156} />)
      );
      timing.mockClear();
      await rerender(withTheme(<BottleView bottle={open} index={0} bottleHeight={156} selected />));
      expect(timing).toHaveBeenCalledTimes(1);
      expect(timing.mock.calls[0]![0]).toBe(1);
      expect(timing.mock.calls[0]![1]).toEqual(
        expect.objectContaining({ duration: SELECT_LIFT_MS })
      );
      expect(SELECT_LIFT_MS).toBeLessThanOrEqual(200);
      expect(repeat).not.toHaveBeenCalled();
      // Staying selected through more renders starts nothing: it holds.
      await rerender(withTheme(<BottleView bottle={open} index={0} bottleHeight={156} selected />));
      expect(timing).toHaveBeenCalledTimes(1);
    });

    it("holds lifted, by a share of the bottle's height", async () => {
      const { rerender, getByTestId } = await render(
        withTheme(<BottleView bottle={open} index={0} bottleHeight={156} />)
      );
      expect(translate(style(getByTestId), "translateY")).toBe(-0);
      await rerender(withTheme(<BottleView bottle={open} index={0} bottleHeight={156} selected />));
      await rerender(withTheme(<BottleView bottle={open} index={0} bottleHeight={156} selected />));
      expect(translate(style(getByTestId), "translateY")).toBeCloseTo(-7.8, 1);
    });

    it("never lifts past the row gap on a tall bottle", async () => {
      const { rerender, getByTestId } = await render(
        withTheme(<BottleView bottle={open} index={0} bottleHeight={300} selected />)
      );
      await rerender(withTheme(<BottleView bottle={open} index={0} bottleHeight={300} selected />));
      expect(translate(style(getByTestId), "translateY")).toBe(-8);
    });

    it("deselecting settles it back in the settle duration", async () => {
      const { rerender } = await render(withTheme(<BottleView bottle={open} index={0} selected />));
      timing.mockClear();
      await rerender(withTheme(<BottleView bottle={open} index={0} />));
      expect(timing).toHaveBeenCalledTimes(1);
      expect(timing.mock.calls[0]![0]).toBe(0);
      expect(timing.mock.calls[0]![1]).toEqual(
        expect.objectContaining({ duration: SELECT_SETTLE_MS })
      );
    });

    it("a bottle that mounts selected (a restored game) is lifted with no animation", async () => {
      const { getByTestId } = await render(
        withTheme(<BottleView bottle={open} index={0} bottleHeight={156} selected />)
      );
      expect(timing).not.toHaveBeenCalled();
      expect(translate(style(getByTestId), "translateY")).toBeCloseTo(-7.8, 1);
    });

    it("Reduce Motion: lifted at once, with no animation", async () => {
      reduceMotionOn();
      const { rerender, getByTestId } = await render(
        withTheme(<BottleView bottle={open} index={0} bottleHeight={156} />)
      );
      await act(async () => {});
      timing.mockClear();
      await rerender(withTheme(<BottleView bottle={open} index={0} bottleHeight={156} selected />));
      await rerender(withTheme(<BottleView bottle={open} index={0} bottleHeight={156} selected />));
      expect(timing).not.toHaveBeenCalled();
      expect(translate(style(getByTestId), "translateY")).toBeCloseTo(-7.8, 1);
    });
  });

  describe("refused pour", () => {
    it("shakes once per bump, in the shake duration", async () => {
      const { rerender } = await render(
        withTheme(<BottleView bottle={open} index={0} refusedSeq={0} />)
      );
      timing.mockClear();
      await rerender(withTheme(<BottleView bottle={open} index={0} refusedSeq={1} />));
      expect(timing).toHaveBeenCalledTimes(1);
      expect(timing.mock.calls[0]![1]).toEqual(
        expect.objectContaining({ duration: REFUSED_SHAKE_MS })
      );
      expect(REFUSED_SHAKE_MS).toBeLessThanOrEqual(250);
      // The same seq again (any re-render) is not another shake.
      await rerender(withTheme(<BottleView bottle={open} index={0} refusedSeq={1} />));
      expect(timing).toHaveBeenCalledTimes(1);
      await rerender(withTheme(<BottleView bottle={open} index={0} refusedSeq={2} />));
      expect(timing).toHaveBeenCalledTimes(2);
    });

    it("does not shake when its seq resets to 0 because another bottle was refused", async () => {
      const { rerender } = await render(
        withTheme(<BottleView bottle={open} index={0} refusedSeq={0} />)
      );
      await rerender(withTheme(<BottleView bottle={open} index={0} refusedSeq={1} />));
      timing.mockClear();
      // Another bottle is refused: SortBoard passes this one 0.
      await rerender(withTheme(<BottleView bottle={open} index={0} refusedSeq={0} />));
      expect(timing).not.toHaveBeenCalled();
      // A later refusal of this bottle shakes it again.
      await rerender(withTheme(<BottleView bottle={open} index={0} refusedSeq={3} />));
      expect(timing).toHaveBeenCalledTimes(1);
    });

    it("a bottle that mounts with a seq (a remount) plays nothing", async () => {
      await render(withTheme(<BottleView bottle={open} index={0} refusedSeq={4} />));
      expect(timing).not.toHaveBeenCalled();
    });

    it("Reduce Motion: no shake", async () => {
      reduceMotionOn();
      const { rerender } = await render(
        withTheme(<BottleView bottle={open} index={0} refusedSeq={0} />)
      );
      await act(async () => {});
      timing.mockClear();
      await rerender(withTheme(<BottleView bottle={open} index={0} refusedSeq={1} />));
      expect(timing).not.toHaveBeenCalled();
    });
  });

  describe("bottle complete", () => {
    it("pulses and pops the badge when a pour completes it, within the ceiling", async () => {
      const { rerender, queryByLabelText } = await render(
        withTheme(<BottleView bottle={almost} index={0} />)
      );
      timing.mockClear();
      await rerender(withTheme(<BottleView bottle={solved} index={0} />));
      expect(queryByLabelText("Bottle 1, complete")).toBeTruthy();
      const durations = timing.mock.calls.map((c) => c[1].duration).sort();
      expect(durations).toEqual([COMPLETE_BADGE_MS, COMPLETE_PULSE_MS].sort());
      expect(Math.max(...durations)).toBeLessThanOrEqual(450);
    });

    it("a bottle that becomes solved by an undo only shows its badge: no pulse, no pop", async () => {
      const { rerender, queryByLabelText } = await render(
        withTheme(<BottleView bottle={almost} index={0} undoSeq={0} />)
      );
      timing.mockClear();
      await rerender(withTheme(<BottleView bottle={solved} index={0} undoSeq={1} />));
      expect(queryByLabelText("Bottle 1, complete")).toBeTruthy();
      expect(timing).not.toHaveBeenCalled();
      // A later pour (the count unchanged) completing it does animate.
      await rerender(withTheme(<BottleView bottle={almost} index={0} undoSeq={1} />));
      timing.mockClear();
      await rerender(withTheme(<BottleView bottle={solved} index={0} undoSeq={1} />));
      expect(timing).toHaveBeenCalledTimes(2);
    });

    it("a bottle already solved on a fresh board or a restore does not animate", async () => {
      await render(withTheme(<BottleView bottle={solved} index={0} />));
      expect(timing).not.toHaveBeenCalled();
    });

    it("an emptied bottle is not 'completed'", async () => {
      const { rerender } = await render(withTheme(<BottleView bottle={open} index={0} />));
      timing.mockClear();
      await rerender(withTheme(<BottleView bottle={[]} index={0} />));
      expect(timing).not.toHaveBeenCalled();
    });

    it("Reduce Motion: the badge appears with no animation", async () => {
      reduceMotionOn();
      const { rerender } = await render(withTheme(<BottleView bottle={almost} index={0} />));
      await act(async () => {});
      timing.mockClear();
      await rerender(withTheme(<BottleView bottle={solved} index={0} />));
      expect(timing).not.toHaveBeenCalled();
    });
  });

  describe("level in", () => {
    it("hides a bottle before its turn on the board's clock and shows it once the clock is 1", async () => {
      const clock = { value: 0 };
      const ui = (c: number) => {
        clock.value = c;
        return withTheme(
          <BottleView
            bottle={open}
            index={0}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            entryClock={clock as any}
            entryDelayMs={100}
          />
        );
      };
      const { rerender, getByTestId } = await render(ui(0));
      expect(style(getByTestId).opacity).toBe(0);
      await rerender(ui(1)); // a tap sets the clock to 1: every bottle is in place
      expect(style(getByTestId).opacity).toBe(1);
      expect(translate(style(getByTestId), "translateY")).toBe(-0);
    });

    it("without a clock (a restored game) it is simply there", async () => {
      const { getByTestId } = await render(withTheme(<BottleView bottle={open} index={0} />));
      expect(style(getByTestId).opacity).toBe(1);
    });
  });
});
