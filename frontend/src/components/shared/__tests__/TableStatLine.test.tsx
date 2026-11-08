import React from "react";
import { Text, StyleSheet } from "react-native";
import { render } from "@testing-library/react-native";

import { ThemeProvider, dark } from "../../../theme/ThemeContext";
import { typography } from "../../../theme/typography";
import { FeltTable } from "../FeltTable";
import { TABLE_STAT_LINE_HEIGHT, TableStatLine } from "../TableStatLine";
import {
  TABLE_FELT_BORDER_DARK,
  TABLE_FELT_CENTRE_DARK,
  TABLE_FELT_BORDER_LIGHT,
  TABLE_FELT_CENTRE_LIGHT,
} from "../../../theme/theme.table";

const withTheme = (ui: React.ReactElement) => <ThemeProvider>{ui}</ThemeProvider>;

describe("TableStatLine (#3606)", () => {
  it("draws every label and value on one line, in order", async () => {
    const { getByTestId, getByText } = await render(
      withTheme(
        <TableStatLine
          testID="line"
          stats={[
            { key: "moves", label: "Moves", value: "12", accessibilityLabel: "Moves: 12" },
            { key: "score", label: "Score", value: "45", accessibilityLabel: "Score: 45" },
            {
              key: "time",
              label: "Time",
              renderValue: (style) => <Text style={style}>2:14</Text>,
            },
          ]}
        />
      )
    );
    expect(getByText("Moves")).toBeTruthy();
    expect(getByText("12")).toBeTruthy();
    expect(getByText("Score")).toBeTruthy();
    expect(getByText("45")).toBeTruthy();
    expect(getByText("Time")).toBeTruthy();
    expect(getByText("2:14")).toBeTruthy();
    expect(StyleSheet.flatten(getByTestId("line").props.style)).toMatchObject({
      flexDirection: "row",
      justifyContent: "center",
      height: TABLE_STAT_LINE_HEIGHT,
    });
  });

  it("labels are Manrope capitals in the muted colour; values are Space Grotesk in the text colour", async () => {
    const { getByText } = await render(
      withTheme(<TableStatLine stats={[{ key: "m", label: "Moves", value: "3" }]} />)
    );
    const label = StyleSheet.flatten(getByText("Moves").props.style);
    expect(label).toMatchObject({
      fontFamily: typography.label,
      textTransform: "uppercase",
      color: dark.textMuted,
    });
    const value = StyleSheet.flatten(getByText("3").props.style);
    expect(value).toMatchObject({ fontFamily: typography.heading, color: dark.text });
  });

  it("an item with an accessibility label is one element for a screen reader", async () => {
    const { getByLabelText } = await render(
      withTheme(
        <TableStatLine
          stats={[{ key: "m", label: "Moves", value: "3", accessibilityLabel: "Moves: 3" }]}
        />
      )
    );
    expect(getByLabelText("Moves: 3").props.accessible).toBe(true);
  });
});

describe("FeltTable (#3606)", () => {
  it("is a rounded felt in the shared felt tokens, with its children on top", async () => {
    const { getByTestId, getByText } = await render(
      withTheme(
        <FeltTable testID="felt">
          <Text>board</Text>
        </FeltTable>
      )
    );
    expect(getByText("board")).toBeTruthy();
    expect(StyleSheet.flatten(getByTestId("felt").props.style)).toMatchObject({
      borderRadius: 22,
      backgroundColor: TABLE_FELT_CENTRE_DARK,
      borderColor: TABLE_FELT_BORDER_DARK,
    });
  });

  it("has a light-theme felt", () => {
    expect(TABLE_FELT_CENTRE_LIGHT).not.toBe(TABLE_FELT_CENTRE_DARK);
    expect(TABLE_FELT_BORDER_LIGHT).not.toBe(TABLE_FELT_BORDER_DARK);
  });

  it("reports its size through onLayout", async () => {
    const onLayout = jest.fn();
    const { getByTestId } = await render(
      withTheme(<FeltTable testID="felt" onLayout={onLayout} />)
    );
    expect(getByTestId("felt").props.onLayout).toBe(onLayout);
  });
});
