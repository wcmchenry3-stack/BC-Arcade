/**
 * #3346: HintFrame — FreeCell's hint overlay. Source and destination must differ in
 * shape (solid + tint vs dashed + no tint), not only in colour, and be at least as thick as
 * Solitaire's 3-px hint border. Colours come from the theme's `bonus` token, so both
 * themes are covered by the token (not by a hard-coded value).
 */
import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";

import { ThemeProvider, dark } from "../../../theme/ThemeContext";
import HintFrame, {
  HINT_DEST_BORDER,
  HINT_SOURCE_BORDER,
  HINT_SOURCE_TINT_OPACITY,
} from "../HintFrame";

const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);

async function draw(node: React.ReactElement) {
  await render(<ThemeProvider>{node}</ThemeProvider>);
}

describe("HintFrame", () => {
  it("source: a solid frame of at least 3 px with a tinted fill", async () => {
    await draw(<HintFrame role="source" radius={6} />);
    expect(HINT_SOURCE_BORDER).toBeGreaterThanOrEqual(3);
    expect(flat("hint-frame-source")).toMatchObject({
      borderStyle: "solid",
      borderWidth: HINT_SOURCE_BORDER,
      borderColor: dark.bonus,
      borderRadius: 6,
    });
    expect(flat("hint-frame-tint")).toMatchObject({
      backgroundColor: dark.bonus,
      opacity: HINT_SOURCE_TINT_OPACITY,
    });
  });

  it("destination: a thicker dashed frame with no fill", async () => {
    await draw(<HintFrame role="destination" radius={6} />);
    expect(flat("hint-frame-destination")).toMatchObject({
      borderStyle: "dashed",
      borderWidth: HINT_DEST_BORDER,
      borderColor: dark.bonus,
    });
    expect(HINT_DEST_BORDER).toBeGreaterThan(HINT_SOURCE_BORDER);
    expect(screen.queryByTestId("hint-frame-tint")).toBeNull();
  });

  it("never intercepts touches", async () => {
    await draw(<HintFrame role="source" radius={6} />);
    expect(screen.getByTestId("hint-frame-source").props.pointerEvents).toBe("none");
  });
});
