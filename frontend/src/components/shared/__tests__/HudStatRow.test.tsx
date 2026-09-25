import React from "react";
import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { HudStatRow } from "../HudStatRow";

async function renderRow(props: React.ComponentProps<typeof HudStatRow>) {
  return await render(
    <ThemeProvider>
      <HudStatRow {...props} />
    </ThemeProvider>
  );
}

const style = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style);

describe("HudStatRow", () => {
  it("renders every stat inside one summary region", async () => {
    await renderRow({
      testID: "hud",
      stats: [
        { key: "a", text: "Easy" },
        { key: "b", text: "12 moves", muted: true },
      ],
    });
    expect(screen.getByTestId("hud").props.accessibilityRole).toBe("summary");
    expect(screen.getByText("Easy")).toBeTruthy();
    expect(screen.getByText("12 moves")).toBeTruthy();
  });

  it("uses muted color for muted stats", async () => {
    await renderRow({
      stats: [
        { key: "a", text: "Easy" },
        { key: "b", text: "12 moves", muted: true },
      ],
    });
    expect(style("12 moves").color).not.toBe(style("Easy").color);
  });

  it("switches to 16pt for size lg and bolds bold stats", async () => {
    await renderRow({ size: "lg", stats: [{ key: "t", text: "FreeCell", bold: true }] });
    expect(style("FreeCell").fontSize).toBe(16);
    expect(style("FreeCell").fontWeight).toBe("700");
  });

  it("passes a screen-reader label through when it differs from the text", async () => {
    await renderRow({
      stats: [{ key: "time", text: "03:12", accessibilityLabel: "Elapsed 3 minutes 12 seconds" }],
    });
    expect(screen.getByLabelText("Elapsed 3 minutes 12 seconds")).toBeTruthy();
  });
});
