import React from "react";
import { render } from "@testing-library/react-native";
import ScorePill from "../ScorePill";
import { ThemeProvider } from "../../../theme/ThemeContext";

async function renderPill(props: Parameters<typeof ScorePill>[0]) {
  return await render(
    <ThemeProvider>
      <ScorePill {...props} />
    </ThemeProvider>
  );
}

describe("ScorePill", () => {
  describe("player variant", () => {
    it("renders the numeric score", async () => {
      const { getByText } = await renderPill({ value: 17, variant: "player" });
      expect(getByText("17")).toBeTruthy();
    });

    it("appends * for a soft hand", async () => {
      const { getByText } = await renderPill({ value: 17, soft: true, variant: "player" });
      expect(getByText("17*")).toBeTruthy();
    });

    it("has accessibilityLabel 'Player score 17'", async () => {
      const { getByLabelText } = await renderPill({ value: 17, variant: "player" });
      expect(getByLabelText("Player score 17")).toBeTruthy();
    });

    it("has accessibilityLabel 'Player score 17*' for soft hand", async () => {
      const { getByLabelText } = await renderPill({ value: 17, soft: true, variant: "player" });
      expect(getByLabelText("Player score 17*")).toBeTruthy();
    });
  });

  describe("dealer variant", () => {
    it("renders the numeric score", async () => {
      const { getByText } = await renderPill({ value: 9, variant: "dealer" });
      expect(getByText("9")).toBeTruthy();
    });

    it("has accessibilityLabel 'Dealer score 9'", async () => {
      const { getByLabelText } = await renderPill({ value: 9, variant: "dealer" });
      expect(getByLabelText("Dealer score 9")).toBeTruthy();
    });

    it("renders '?' when concealed", async () => {
      const { getByText } = await renderPill({ value: 9, concealed: true, variant: "dealer" });
      expect(getByText("?")).toBeTruthy();
    });

    it("has accessibilityLabel 'Dealer score hidden' when concealed", async () => {
      const { getByLabelText } = await renderPill({ value: 9, concealed: true, variant: "dealer" });
      expect(getByLabelText("Dealer score hidden")).toBeTruthy();
    });
  });
});
