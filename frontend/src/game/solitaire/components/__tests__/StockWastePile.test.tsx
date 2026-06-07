import React from "react";
import { render, fireEvent } from "@testing-library/react-native";

import { ThemeProvider } from "../../../../theme/ThemeContext";
import type { Card } from "../../types";
import StockWastePile from "../StockWastePile";
import { DragProvider } from "../../../_shared/drag/DragContext";

function withTheme(children: React.ReactNode) {
  return (
    <DragProvider>
      <ThemeProvider>{children}</ThemeProvider>
    </DragProvider>
  );
}

function card(rank: number): Card {
  return { suit: "spades", rank: rank as Card["rank"], faceUp: true };
}

describe("StockWastePile", () => {
  it("shows the remaining stock count and the waste top card", async () => {
    const stock = [card(1), card(2), card(3), card(4), card(5)];
    const waste = [card(6), card(7)];
    const { getByText, getByLabelText } = await render(
      withTheme(<StockWastePile stock={stock} waste={waste} drawMode={1} />)
    );
    expect(getByText("5")).toBeTruthy(); // stock count
    expect(getByLabelText(/Draw 1 from stock, 5 cards remaining/)).toBeTruthy();
    expect(getByText("7")).toBeTruthy(); // waste top rank
  });

  it("shows the recycle symbol when stock is empty and labels the action accordingly", async () => {
    const { getByText, getByLabelText } = await render(
      withTheme(<StockWastePile stock={[]} waste={[card(1)]} drawMode={3} />)
    );
    expect(getByText("↻")).toBeTruthy();
    expect(getByLabelText(/Recycle waste back to stock \(draw 3\)/)).toBeTruthy();
  });

  it("fires onStockPress when the stock is tapped", async () => {
    const onStockPress = jest.fn();
    const { getByLabelText } = await render(
      withTheme(
        <StockWastePile stock={[card(1)]} waste={[]} drawMode={1} onStockPress={onStockPress} />
      )
    );
    await fireEvent.press(getByLabelText(/Draw 1 from stock/));
    expect(onStockPress).toHaveBeenCalledTimes(1);
  });

  it("fires onWastePress when the waste top is tapped", async () => {
    const onWastePress = jest.fn();
    const { getByRole } = await render(
      withTheme(
        <StockWastePile
          stock={[card(1)]}
          waste={[card(7)]}
          drawMode={1}
          onWastePress={onWastePress}
        />
      )
    );
    // Two buttons rendered: stock (no onStockPress => View, not button) and
    // waste (onWastePress => button). So there should be exactly one button.
    await fireEvent.press(getByRole("button"));
    expect(onWastePress).toHaveBeenCalledTimes(1);
  });

  it("labels the waste as empty when the waste pile is empty", async () => {
    const { getByLabelText } = await render(
      withTheme(<StockWastePile stock={[card(1)]} waste={[]} drawMode={1} />)
    );
    expect(getByLabelText(/Empty waste pile/)).toBeTruthy();
  });

  describe("draw-3 fan", () => {
    it("shows all 3 visible waste cards when 3+ are present", async () => {
      const waste = [card(2), card(5), card(9), card(11)];
      const { getByLabelText } = await render(
        withTheme(<StockWastePile stock={[card(1)]} waste={waste} drawMode={3} />)
      );
      expect(getByLabelText(/9 of Spades/)).toBeTruthy();
      expect(getByLabelText(/J of Spades/)).toBeTruthy();
      // card(2) is not in the visible top-3; card(5) is the oldest visible
      expect(getByLabelText(/5 of Spades/)).toBeTruthy();
    });

    it("shows only the cards present when waste has fewer than 3", async () => {
      const waste = [card(3), card(7)];
      const { getByLabelText, queryByLabelText } = await render(
        withTheme(<StockWastePile stock={[card(1)]} waste={waste} drawMode={3} />)
      );
      expect(getByLabelText(/3 of Spades/)).toBeTruthy();
      expect(getByLabelText(/7 of Spades/)).toBeTruthy();
      // only 2 cards; nothing else visible
      expect(queryByLabelText(/Ace of Spades/)).toBeNull();
    });

    it("only the top card is interactive; background cards have image role", async () => {
      const onWastePress = jest.fn();
      const waste = [card(2), card(5), card(9)];
      const { getByLabelText } = await render(
        withTheme(
          <StockWastePile
            stock={[card(1)]}
            waste={waste}
            drawMode={3}
            onWastePress={onWastePress}
          />
        )
      );
      expect(getByLabelText(/9 of Spades/).props.accessibilityRole).toBe("button");
      expect(getByLabelText(/5 of Spades/).props.accessibilityRole).toBe("image");
      expect(getByLabelText(/2 of Spades/).props.accessibilityRole).toBe("image");

      await fireEvent.press(getByLabelText(/9 of Spades/));
      expect(onWastePress).toHaveBeenCalledTimes(1);
    });
  });
});
