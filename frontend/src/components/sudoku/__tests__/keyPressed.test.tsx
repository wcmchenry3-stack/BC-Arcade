/**
 * The pressed state of the digit keys and the action bar's buttons (#3774): a dip and a dim while
 * the finger is down. It is press feedback, not motion, so it is the same under Reduce Motion.
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import NumberPad from "../NumberPad";
import GameActionBar from "../../shared/GameActionBar";
import type { Grid } from "../../../game/sudoku/types";

let mockReduceMotion = false;
jest.mock("../../shared/useReduceMotion", () => ({
  ...jest.requireActual("../../shared/useReduceMotion"),
  useReduceMotion: () => mockReduceMotion,
}));

const emptyGrid: Grid = Array.from({ length: 9 }, () =>
  Array.from({ length: 9 }, () => ({
    value: 0 as const,
    given: false,
    notes: new Set<never>(),
    isError: false,
  }))
);
const flat = (el: { props: { style?: unknown } }) =>
  StyleSheet.flatten(el.props.style as never) as {
    transform?: { scale: number }[];
    opacity?: number;
  };

// A finger down on a Pressable, as the responder system sends them.
const touch = { nativeEvent: { touches: [], changedTouches: [], timestamp: 0 }, persist() {} };
const down = (el: never) => fireEvent(el, "responderGrant", touch);

describe.each([false, true])("pressed state (Reduce Motion %s)", (reduce) => {
  beforeEach(() => {
    mockReduceMotion = reduce;
  });

  it("a digit key dips and dims while pressed", async () => {
    const r = await render(
      <ThemeProvider>
        <NumberPad grid={emptyGrid} variant="classic" notesMode={false} onDigit={() => {}} />
      </ThemeProvider>
    );
    const key = r.getByTestId("sudoku-digit-4");
    expect(flat(key).transform).toBeUndefined();
    await down(key);
    expect(flat(r.getByTestId("sudoku-digit-4")).transform).toEqual([{ scale: 0.96 }]);
    expect(flat(r.getByTestId("sudoku-digit-4")).opacity).toBeLessThan(1);
  });

  it("an action bar button dips and dims while pressed", async () => {
    const r = await render(
      <ThemeProvider>
        <GameActionBar
          testID="bar"
          height={56}
          actions={[
            {
              key: "erase",
              icon: "backspace",
              label: "Erase",
              accessibilityLabel: "Erase",
              color: "#8ff5ff",
              onPress: () => {},
              testID: "bar-erase",
            },
          ]}
        />
      </ThemeProvider>
    );
    expect(flat(r.getByTestId("bar-erase")).transform).toBeUndefined();
    await down(r.getByTestId("bar-erase"));
    expect(flat(r.getByTestId("bar-erase")).transform).toEqual([{ scale: 0.94 }]);
    expect(flat(r.getByTestId("bar-erase")).opacity).toBeLessThan(1);
  });
});
