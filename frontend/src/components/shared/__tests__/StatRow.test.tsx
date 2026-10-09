import React from "react";
import { render, screen } from "@testing-library/react-native";
import { StyleSheet, View } from "react-native";
import type { ReactTestInstance } from "react-test-renderer";
import { ThemeProvider, useTheme, type Colors } from "../../../theme/ThemeContext";
import { StatList, StatRow } from "../StatRow";

async function renderInTheme(ui: React.ReactElement) {
  return await render(<ThemeProvider>{ui}</ThemeProvider>);
}

const style = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style);

describe("StatRow", () => {
  it("renders the label and the value", async () => {
    await renderInTheme(<StatRow label="Chips" value="1,000 chips" testID="row" />);
    expect(screen.getByTestId("row")).toBeTruthy();
    expect(screen.getByText("Chips")).toBeTruthy();
    expect(screen.getByText("1,000 chips")).toBeTruthy();
  });

  it("mutes the label and bolds the value", async () => {
    let colors: Colors | undefined;
    function Probe() {
      colors = useTheme().colors;
      return null;
    }
    await renderInTheme(
      <>
        <Probe />
        <StatRow label="Chips" value="1,000 chips" />
      </>
    );
    expect(style("Chips").color).toBe(colors?.textMuted);
    expect(style("Chips").fontWeight).toBe("500");
    expect(style("1,000 chips").color).toBe(colors?.text);
    expect(style("1,000 chips").fontWeight).toBe("700");
  });

  it("uses valueColor for the value when given", async () => {
    await renderInTheme(<StatRow label="Net P/L" value="+50" valueColor="tokenColor" />);
    expect(style("+50").color).toBe("tokenColor");
  });
});

describe("StatList", () => {
  const items = [
    { key: "a", label: "A", value: "1", testID: "row-a" },
    { key: "b", label: "B", value: "2", testID: "row-b" },
    { key: "c", label: "C", value: "3", testID: "row-c" },
  ];

  it("renders every row in order", async () => {
    await renderInTheme(<StatList items={items} />);
    const labels = screen.getAllByText(/^[ABC]$/).map((n) => n.props.children);
    expect(labels).toEqual(["A", "B", "C"]);
  });

  it("puts a divider between rows only", async () => {
    await renderInTheme(
      <View testID="list">
        <StatList items={items} />
      </View>
    );
    // row, divider, row, divider, row
    const children = screen.getByTestId("list").children as ReactTestInstance[];
    expect(children.map((n) => n.props.testID)).toEqual([
      "row-a",
      undefined,
      "row-b",
      undefined,
      "row-c",
    ]);
  });

  it("renders nothing for an empty list", async () => {
    await renderInTheme(
      <View testID="list">
        <StatList items={[]} />
      </View>
    );
    expect(screen.getByTestId("list").children).toHaveLength(0);
  });
});
